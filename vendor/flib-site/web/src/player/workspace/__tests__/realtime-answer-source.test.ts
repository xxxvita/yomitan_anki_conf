// realtime-answer-source.test.ts — S3-9 unit tests for RealtimeAnswerSource,
// the lift of the desktop Scribe v2 realtime client (anki_conf
// internal/platform/elevenlabs/client.go) onto the SAME `AnswerSource` seam the
// coordinator already consumes. ALL tests run against a MOCK WebSocket + a
// synthetic-audio inject — NO real gateway, NO prod token, NO mic (barrier).
//
// The 8 contract cases (brief §Тесты):
//  (1) committed_transcript before the deadline → {status:'final', text}
//  (2) only partial_transcript by the deadline → {status:'non-final', partial}
//  (3) zero frames → {status:'timeout'}
//  (4) proxy_error / WS-close with a pending waiter → {status:'error'}
//  (5) abort via signal → resolves cleanly, no leak (session stays open, a late
//      frame for the removed waiter is inert)
//  (6) concurrent calls for DIFFERENT ex.id are independent (one's answer never
//      lands in the other)
//  (7) pushAudio sends an input_audio_chunk frame (base64 + sample_rate correct)
//  (8) budgetMs ceiling is enforced by finalizeLoopFromAnswerSource (F4), not by
//      the source self-limiting — a source that never finalises collapses to
//      null at exactly 3000ms.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  RealtimeAnswerSource,
  type RealtimeSocketLike,
} from '../realtime-answer-source';
import {
  finalizeLoopFromAnswerSource,
  type AnswerOutcome,
} from '../answer-source';

// ---- Mock WebSocket ---------------------------------------------------------

const OPEN = 1;
const CLOSED = 3;

class MockSocket implements RealtimeSocketLike {
  static instances: MockSocket[] = [];
  url: string;
  readyState = 0; // CONNECTING
  sent: string[] = [];
  closed = false;
  closeCalls = 0;
  private listeners: Record<string, Array<(ev: unknown) => void>> = {};

  constructor(url: string) {
    this.url = url;
    MockSocket.instances.push(this);
  }
  addEventListener(type: string, cb: (ev: unknown) => void): void {
    (this.listeners[type] ||= []).push(cb);
  }
  removeEventListener(type: string, cb: (ev: unknown) => void): void {
    this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== cb);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.closeCalls++;
    if (this.closed) return;
    this.closed = true;
    this.readyState = CLOSED;
    this.emit('close', { code: 1000 });
  }
  // --- test drivers ---
  private emit(type: string, ev: unknown): void {
    (this.listeners[type] || []).slice().forEach((f) => f(ev));
  }
  fireOpen(): void {
    this.readyState = OPEN;
    this.emit('open', {});
  }
  message(obj: unknown): void {
    this.emit('message', { data: JSON.stringify(obj) });
  }
  fireError(): void {
    this.emit('error', {});
  }
  fireClose(): void {
    this.readyState = CLOSED;
    this.emit('close', { code: 1006 });
  }
  get lastFrame(): Record<string, unknown> {
    return JSON.parse(this.sent[this.sent.length - 1]);
  }
}

function makeSource(overrides: Partial<ConstructorParameters<typeof RealtimeAnswerSource>[0]> = {}) {
  return new RealtimeAnswerSource({
    socketFactory: (url) => new MockSocket(url),
    fetchTicket: async () => 'deadbeefticket',
    wsBase: 'ws://test.local',
    ...overrides,
  });
}

// Open a live session for `exId` by pushing one synthetic audio chunk (this is
// what opens the WS, per the continuous-listen lifecycle) and firing 'open'.
async function openSession(src: RealtimeAnswerSource, exId: string): Promise<MockSocket> {
  src.pushAudio(exId, new Int16Array([1, 2, 3]));
  // let the injected fetchTicket promise settle → socket created
  await Promise.resolve();
  await Promise.resolve();
  const sock = MockSocket.instances[MockSocket.instances.length - 1];
  sock.fireOpen();
  return sock;
}

beforeEach(() => { MockSocket.instances = []; });

describe('RealtimeAnswerSource — (7) pushAudio → input_audio_chunk wire frame', () => {
  it('opens the WS on first audio and sends a correctly-shaped base64 PCM16 frame', async () => {
    const src = makeSource();
    const sock = await openSession(src, 'ex1');
    // PCM samples 1,2,3 as little-endian s16le → bytes 01 00 02 00 03 00 → base64
    const expectB64 = btoa(String.fromCharCode(1, 0, 2, 0, 3, 0));
    expect(sock.sent.length).toBe(1);
    expect(sock.lastFrame).toEqual({
      message_type: 'input_audio_chunk',
      audio_base_64: expectB64,
      sample_rate: 16000,
    });
    // handshake query carries the Scribe v2 canon
    expect(sock.url).toContain('/api/stt/realtime?');
    expect(sock.url).toContain('ticket=deadbeefticket');
    expect(sock.url).toContain('model_id=scribe_v2_realtime');
    expect(sock.url).toContain('audio_format=pcm_16000');
    expect(sock.url).toContain('commit_strategy=vad');
    expect(sock.url).toContain('include_timestamps=true');
    src.dispose();
  });

  it('buffers audio pushed before OPEN and flushes it on open (no drop)', async () => {
    const src = makeSource();
    src.pushAudio('ex1', new Int16Array([7]));
    await Promise.resolve(); await Promise.resolve();
    const sock = MockSocket.instances[0];
    expect(sock.sent.length).toBe(0); // not open yet — buffered
    sock.fireOpen();
    expect(sock.sent.length).toBe(1); // flushed on open
    src.dispose();
  });
});

describe('RealtimeAnswerSource — (1) committed_transcript before deadline → final', () => {
  it('resolves {status:"final", text} on committed_transcript', async () => {
    const src = makeSource();
    const sock = await openSession(src, 'ex1');
    const p = src.awaitAnswerByBoundary('ex1', 3000);
    sock.message({ message_type: 'committed_transcript', text: 'the quick brown fox' });
    expect(await p).toEqual({ status: 'final', text: 'the quick brown fox' });
    src.dispose();
  });

  it('committed_transcript_with_timestamps also resolves final (text taken, timing words ignored)', async () => {
    const src = makeSource();
    const sock = await openSession(src, 'ex1');
    const p = src.awaitAnswerByBoundary('ex1', 3000);
    sock.message({
      message_type: 'committed_transcript_with_timestamps',
      text: 'hello world',
      words: [{ word: 'hello' }, { word: 'world' }],
    });
    expect(await p).toEqual({ status: 'final', text: 'hello world' });
    src.dispose();
  });
});

describe('RealtimeAnswerSource — (2)/(3) abort resolves from accumulated state', () => {
  it('(2) partial seen then abort → {status:"non-final", partial}', async () => {
    const src = makeSource();
    const sock = await openSession(src, 'ex1');
    const ctrl = new AbortController();
    const p = src.awaitAnswerByBoundary('ex1', 3000, ctrl.signal);
    sock.message({ message_type: 'partial_transcript', text: 'the quick' });
    ctrl.abort(); // F4 budget timer / coordinator abort
    expect(await p).toEqual({ status: 'non-final', partial: 'the quick' });
    src.dispose();
  });

  it('(3) zero frames then abort → {status:"timeout"}', async () => {
    const src = makeSource();
    await openSession(src, 'ex1');
    const ctrl = new AbortController();
    const p = src.awaitAnswerByBoundary('ex1', 3000, ctrl.signal);
    ctrl.abort();
    expect(await p).toEqual({ status: 'timeout' });
    src.dispose();
  });

  it('(3b) already-aborted signal resolves timeout without registering a waiter', async () => {
    const src = makeSource();
    const ctrl = new AbortController();
    ctrl.abort();
    const outcome = await src.awaitAnswerByBoundary('ex1', 3000, ctrl.signal);
    expect(outcome).toEqual({ status: 'timeout' });
    src.dispose();
  });
});

describe('RealtimeAnswerSource — (4) error surfaces, never silent-final', () => {
  it('proxy_error with a pending waiter → {status:"error", reason}', async () => {
    const src = makeSource();
    const sock = await openSession(src, 'ex1');
    const p = src.awaitAnswerByBoundary('ex1', 3000);
    sock.message({ message_type: 'proxy_error', error_type: 'quota_exceeded' });
    expect(await p).toEqual({ status: 'error', reason: 'quota_exceeded' });
    src.dispose();
  });

  it('WS close while a waiter is pending → {status:"error"} (not a silent hang)', async () => {
    const src = makeSource();
    const sock = await openSession(src, 'ex1');
    const p = src.awaitAnswerByBoundary('ex1', 3000);
    sock.fireClose();
    const outcome = await p;
    expect(outcome.status).toBe('error');
    src.dispose();
  });

  it('WS transport error while a waiter is pending → {status:"error"}', async () => {
    const src = makeSource();
    const sock = await openSession(src, 'ex1');
    const p = src.awaitAnswerByBoundary('ex1', 3000);
    sock.fireError();
    const outcome = await p;
    expect(outcome.status).toBe('error');
    src.dispose();
  });
});

describe('RealtimeAnswerSource — (5) abort is clean, no leak, session survives', () => {
  // REVISED for the S3-9-fix buffer contract: a committed arriving AFTER an abort
  // is NO LONGER dropped — per canon (buffered chan, client.go:208) it BUFFERS as
  // latestFinal. It still must not re-resolve the already-settled (aborted) waiter
  // nor throw. The NEXT boundary then consumes that buffered final. This canonises
  // buffering (was: dropping) without weakening the "abort is clean" guarantees.
  it('aborting one waiter removes it, keeps the session open; a post-abort committed buffers (does not re-resolve the gone waiter) and the next boundary consumes it', async () => {
    const src = makeSource();
    const sock = await openSession(src, 'ex1');
    const ctrl = new AbortController();
    const p = src.awaitAnswerByBoundary('ex1', 3000, ctrl.signal);
    ctrl.abort();
    expect(await p).toEqual({ status: 'timeout' }); // aborted waiter settled once — no dangling promise
    expect(sock.closeCalls).toBe(0); // continuous-listen: a boundary abort does NOT close the session

    // a committed arriving AFTER the abort must NOT resolve the (already-settled)
    // waiter or throw. Per canon it is NOT dropped — it buffers as latestFinal.
    expect(() => sock.message({ message_type: 'committed_transcript', text: 'buffered' })).not.toThrow();

    // the NEXT boundary consumes the buffered final immediately (buffered-chan receive)
    const p2 = src.awaitAnswerByBoundary('ex1', 3000);
    expect(await p2).toEqual({ status: 'final', text: 'buffered' });
    src.dispose();
  });
});

describe('RealtimeAnswerSource — (FIX#1) early committed buffers, one final = one boundary', () => {
  // The canon (client.go:208) is a BUFFERED chan(10): a final committed by VAD
  // BEFORE the boundary registers a waiter is never lost. The pre-fix lift dropped
  // it (resolveFront found no waiter → discard), so the boundary that opened just
  // after would wait for the NEXT final (user silent) → 3000ms → timeout. This is
  // the test that did NOT exist. Pre-fix it hangs → vitest timeout (red).
  it('committed_transcript arriving BEFORE awaitAnswerByBoundary (same loop) → returns {status:"final"}, not timeout', async () => {
    const src = makeSource();
    const sock = await openSession(src, 'ex1');
    // user finished early: VAD committed the final BEFORE the boundary registered
    sock.message({ message_type: 'committed_transcript', text: 'early answer' });
    // now the boundary opens — must pick up the buffered final immediately
    const ctrl = new AbortController();
    const outcome = await src.awaitAnswerByBoundary('ex1', 3000, ctrl.signal);
    expect(outcome).toEqual({ status: 'final', text: 'early answer' });
    expect(ctrl.signal.aborted).toBe(false); // never needed the abort/timeout path
    src.dispose();
  });

  // Stale-final guard (1б): consuming the buffer clears the slot, so a second
  // boundary with no NEW committed does NOT re-serve the same final.
  it('a buffered final is consumed by exactly ONE boundary — a second boundary (user silent) does NOT get the stale final', async () => {
    const src = makeSource();
    const sock = await openSession(src, 'ex1');
    sock.message({ message_type: 'committed_transcript', text: 'once' });
    expect(await src.awaitAnswerByBoundary('ex1', 3000)).toEqual({ status: 'final', text: 'once' });

    // second boundary, user silent, no new committed → must NOT re-serve 'once'
    const ctrl = new AbortController();
    const p2 = src.awaitAnswerByBoundary('ex1', 3000, ctrl.signal);
    ctrl.abort();
    expect(await p2).toEqual({ status: 'timeout' });
    src.dispose();
  });
});

describe('RealtimeAnswerSource — (FIX#2) partial consumed once, not re-served to the next boundary', () => {
  // latestPartial was cleared ONLY on commit → a boundary N+1 with no new partial
  // returned loop N's stale partial (user sees the previous phrase via onOutcome
  // T3/T7). Now consumption (the non-final/timeout outcome) clears it too.
  it('a partial from loop N consumed in outcome N → boundary N+1 with no new partial → NOT the stale partial', async () => {
    const src = makeSource();
    const sock = await openSession(src, 'ex1');

    const ctrlN = new AbortController();
    const pN = src.awaitAnswerByBoundary('ex1', 3000, ctrlN.signal);
    sock.message({ message_type: 'partial_transcript', text: 'loop N phrase' });
    ctrlN.abort();
    expect(await pN).toEqual({ status: 'non-final', partial: 'loop N phrase' }); // consumed here

    // boundary N+1: user silent, no new partial → must NOT return 'loop N phrase'
    const ctrlN1 = new AbortController();
    const pN1 = src.awaitAnswerByBoundary('ex1', 3000, ctrlN1.signal);
    ctrlN1.abort();
    expect(await pN1).toEqual({ status: 'timeout' });
    src.dispose();
  });
});

describe('RealtimeAnswerSource — (6) concurrent calls for different ex.id are independent', () => {
  it("one exercise's committed_transcript never lands in another's waiter", async () => {
    const src = makeSource();
    const sockA = await openSession(src, 'exA');
    const sockB = await openSession(src, 'exB');
    expect(sockA).not.toBe(sockB); // separate per-exercise WS sessions (keyed by ex.id)

    const pA = src.awaitAnswerByBoundary('exA', 3000);
    const pB = src.awaitAnswerByBoundary('exB', 3000);

    // resolve ONLY exA
    sockA.message({ message_type: 'committed_transcript', text: 'answer A' });
    expect(await pA).toEqual({ status: 'final', text: 'answer A' });

    // pB is still pending — cross-contamination would have resolved it too
    let bSettled = false;
    void pB.then(() => { bSettled = true; });
    await Promise.resolve();
    expect(bSettled).toBe(false);

    sockB.message({ message_type: 'committed_transcript', text: 'answer B' });
    expect(await pB).toEqual({ status: 'final', text: 'answer B' });
    src.dispose();
  });

  it('a partial on exB does not bleed into exA abort state', async () => {
    const src = makeSource();
    const sockA = await openSession(src, 'exA');
    await openSession(src, 'exB');
    const ctrlA = new AbortController();
    const pA = src.awaitAnswerByBoundary('exA', 3000, ctrlA.signal);
    // partial belongs to a DIFFERENT session
    const sockB = MockSocket.instances.find((s) => s !== sockA)!;
    sockB.message({ message_type: 'partial_transcript', text: 'B partial' });
    ctrlA.abort();
    // exA saw no partial → timeout, NOT exB's partial
    expect(await pA).toEqual({ status: 'timeout' });
    src.dispose();
  });
});

describe('RealtimeAnswerSource — (8) budgetMs ceiling enforced by finalizeLoopFromAnswerSource (F4)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('a source that never finalises is collapsed to null at exactly 3000ms by the adapter, source aborted cleanly', async () => {
    const src = makeSource();
    const adapter = finalizeLoopFromAnswerSource(src, () => 'ex1', 3000);

    let result: string | null | 'pending' = 'pending';
    const p = adapter(new AbortController().signal).then((r) => { result = r; });

    await vi.advanceTimersByTimeAsync(2999);
    expect(result).toBe('pending'); // not yet — no final arrived

    await vi.advanceTimersByTimeAsync(1); // exactly 3000ms
    await p;
    expect(result).toBeNull(); // timeout collapses to null (non-final family)
    src.dispose();
  });

  it('a final arriving before the ceiling returns the text (adapter passes it through)', async () => {
    const src = makeSource();
    // open a session synchronously enough under fake timers
    src.pushAudio('ex1', new Int16Array([1]));
    await vi.advanceTimersByTimeAsync(0);
    const sock = MockSocket.instances[0];
    sock.fireOpen();

    const adapter = finalizeLoopFromAnswerSource(src, () => 'ex1', 3000);
    let result: string | null | 'pending' = 'pending';
    const p = adapter(new AbortController().signal).then((r) => { result = r; });
    await vi.advanceTimersByTimeAsync(500);
    sock.message({ message_type: 'committed_transcript', text: 'done' });
    await p;
    expect(result).toBe('done');
    src.dispose();
  });
});

describe('RealtimeAnswerSource — (D) onPartial live callback (Срез D)', () => {
  it('fires onPartial(exerciseId, text) on EACH partial_transcript', async () => {
    const seen: Array<[string, string]> = [];
    const src = makeSource({ onPartial: (id, text) => seen.push([id, text]) });
    const sock = await openSession(src, 'ex1');
    sock.message({ message_type: 'partial_transcript', text: 'the' });
    sock.message({ message_type: 'partial_transcript', text: 'the quick' });
    sock.message({ message_type: 'partial_transcript', text: 'the quick brown' });
    expect(seen).toEqual([
      ['ex1', 'the'],
      ['ex1', 'the quick'],
      ['ex1', 'the quick brown'],
    ]);
    src.dispose();
  });

  it('does NOT fire onPartial on committed finals (final goes its own path)', async () => {
    const seen: Array<[string, string]> = [];
    const src = makeSource({ onPartial: (id, text) => seen.push([id, text]) });
    const sock = await openSession(src, 'ex1');
    const p = src.awaitAnswerByBoundary('ex1', 3000);
    sock.message({ message_type: 'committed_transcript', text: 'final only' });
    expect(await p).toEqual({ status: 'final', text: 'final only' });
    sock.message({ message_type: 'committed_transcript_with_timestamps', text: 'ts final', words: [] });
    expect(seen).toEqual([]); // no partial-callback fire for either commit shape
    src.dispose();
  });

  it('passes the OWN exerciseId per session (concurrent ex.id do not cross)', async () => {
    const seen: Array<[string, string]> = [];
    const src = makeSource({ onPartial: (id, text) => seen.push([id, text]) });
    const sockA = await openSession(src, 'exA');
    const sockB = await openSession(src, 'exB');
    sockA.message({ message_type: 'partial_transcript', text: 'A one' });
    sockB.message({ message_type: 'partial_transcript', text: 'B one' });
    expect(seen).toEqual([
      ['exA', 'A one'],
      ['exB', 'B one'],
    ]);
    src.dispose();
  });

  it('without onPartial the source behaves byte-identically (partial still resolves non-final on abort)', async () => {
    const src = makeSource(); // no onPartial
    const sock = await openSession(src, 'ex1');
    const ctrl = new AbortController();
    const p = src.awaitAnswerByBoundary('ex1', 3000, ctrl.signal);
    sock.message({ message_type: 'partial_transcript', text: 'the quick' });
    ctrl.abort();
    expect(await p).toEqual({ status: 'non-final', partial: 'the quick' });
    src.dispose();
  });
});

describe('RealtimeAnswerSource — (backoff) connect-failure gate [P-hotfix-backoff]', () => {
  // PROD INCIDENT 2026-07-10: gateway returned quota_exhausted (429) on the WS
  // realtime-ASR; the client had NO backoff — lazy-open fired on EVERY pushAudio
  // chunk (~tens/sec with the mic armed), storming `GET /api/stt/ws-ticket` (BFF
  // per-IP gate → 429) and (likely) burning the quota. These tests pin the fix:
  // an exponential per-exercise backoff gate + a fatal (dead) marker on quota/3×429.
  //
  // No vi fake timers here: the backoff is a PASSIVE gate checked against an
  // injectable clock (opts.now), not a setTimeout — so we drive time by mutating
  // `clock` and drain the fetch-reject microtask chain via settle().
  let clock: number;
  const now = () => clock;
  async function settle() { for (let i = 0; i < 6; i++) await Promise.resolve(); }

  beforeEach(() => { clock = 0; MockSocket.instances = []; });

  it('(a) within a backoff window, further pushAudio chunks do NOT re-fetch the ws-ticket', async () => {
    // MUTATION TARGET: delete the gate check in pushAudio → each of the 5 chunks
    // (after settle drains the prior teardown) opens a fresh session → 5 fetches → red.
    let fetchCount = 0;
    const src = new RealtimeAnswerSource({
      socketFactory: (url) => new MockSocket(url),
      fetchTicket: async () => { fetchCount++; throw new Error('ws-ticket 500'); },
      wsBase: 'ws://test.local', now, log: () => {},
    });
    // burst of chunks at a FROZEN instant (clock stays 0)
    for (let i = 0; i < 5; i++) { src.pushAudio('ex1', new Int16Array([i])); await settle(); }
    // exactly ONE fetch: the first opened a connect that failed → 1000ms window;
    // the remaining 4 chunks fall inside it and are dropped, not re-fetched.
    expect(fetchCount).toBe(1);
    src.dispose();
  });

  it('(a2) the backoff window is exponential (1s → 2s → 4s): each expiry allows exactly one more attempt', async () => {
    let fetchCount = 0;
    const src = new RealtimeAnswerSource({
      socketFactory: (url) => new MockSocket(url),
      fetchTicket: async () => { fetchCount++; throw new Error('ws-ticket 500'); },
      wsBase: 'ws://test.local', now, log: () => {},
    });
    clock = 0;    src.pushAudio('ex1', new Int16Array([1])); await settle(); // fetch#1, window→[0,1000)
    expect(fetchCount).toBe(1);
    clock = 999;  src.pushAudio('ex1', new Int16Array([1])); await settle(); // inside window
    expect(fetchCount).toBe(1);
    clock = 1000; src.pushAudio('ex1', new Int16Array([1])); await settle(); // fetch#2, window→[1000,3000)
    expect(fetchCount).toBe(2);
    clock = 2999; src.pushAudio('ex1', new Int16Array([1])); await settle(); // inside window
    expect(fetchCount).toBe(2);
    clock = 3000; src.pushAudio('ex1', new Int16Array([1])); await settle(); // fetch#3, window→[3000,7000)
    expect(fetchCount).toBe(3);
    src.dispose();
  });

  it('(b) a quota_exhausted connect failure marks the session DEAD — no fetch even after the window elapses', async () => {
    let fetchCount = 0;
    const warns: string[] = [];
    const src = new RealtimeAnswerSource({
      socketFactory: (url) => new MockSocket(url),
      fetchTicket: async () => { fetchCount++; throw new Error('ws-ticket 429: {"error":"quota_exhausted"}'); },
      wsBase: 'ws://test.local', now, log: (m) => warns.push(m),
    });
    clock = 0; src.pushAudio('ex1', new Int16Array([1])); await settle();
    expect(fetchCount).toBe(1);
    // far past ANY backoff window — a mere backoff would allow a retry here; dead does not
    clock = 10_000_000; src.pushAudio('ex1', new Int16Array([1])); await settle();
    src.pushAudio('ex1', new Int16Array([1])); await settle();
    expect(fetchCount).toBe(1);
    // exactly one warn about the dead transition (не спам)
    expect(warns.filter((w) => /DEAD/.test(w)).length).toBe(1);
    src.dispose();
  });

  it('(b2) three consecutive ws-ticket 429s mark the session DEAD (BFF per-IP gate exhausted)', async () => {
    let fetchCount = 0;
    const src = new RealtimeAnswerSource({
      socketFactory: (url) => new MockSocket(url),
      fetchTicket: async () => { fetchCount++; throw new Error('ws-ticket 429'); },
      wsBase: 'ws://test.local', now, log: () => {},
    });
    clock = 0;    src.pushAudio('ex1', new Int16Array([1])); await settle(); // 429#1, fetch#1
    clock = 1000; src.pushAudio('ex1', new Int16Array([1])); await settle(); // 429#2, fetch#2
    clock = 3000; src.pushAudio('ex1', new Int16Array([1])); await settle(); // 429#3 → dead(unavailable)@3000, fetch#3
    expect(fetchCount).toBe(3);
    // Past the backoff window (3rd delay=4000 → nextAllowedAt=7000) but still
    // WITHIN the MED-5 60s TTL → dead suppresses the retry a mere backoff would allow.
    clock = 8000; src.pushAudio('ex1', new Int16Array([1])); await settle();
    expect(fetchCount).toBe(3); // dead — no fetch#4 despite the backoff window elapsing
    src.dispose();
  });

  it('(c) a NEW exerciseId (re-arm) is not gated by a prior exercise’s dead state', async () => {
    let fetchCount = 0;
    const src = new RealtimeAnswerSource({
      socketFactory: (url) => new MockSocket(url),
      fetchTicket: async () => { fetchCount++; throw new Error('ws-ticket 429: quota_exhausted'); },
      wsBase: 'ws://test.local', now, log: () => {},
    });
    clock = 0; src.pushAudio('ex1', new Int16Array([1])); await settle(); // ex1 → dead, fetch#1
    expect(fetchCount).toBe(1);
    src.pushAudio('ex1', new Int16Array([1])); await settle();            // ex1 dead → no fetch
    expect(fetchCount).toBe(1);
    // a different exercise id gets its OWN fresh gate → a fetch is attempted
    src.pushAudio('ex2', new Int16Array([1])); await settle();
    expect(fetchCount).toBe(2);
    src.dispose();
  });

  it('(c2) closeSession (unarm) clears the gate — re-arming the SAME exerciseId is allowed again', async () => {
    let fetchCount = 0;
    const src = new RealtimeAnswerSource({
      socketFactory: (url) => new MockSocket(url),
      fetchTicket: async () => { fetchCount++; throw new Error('ws-ticket 429: quota_exhausted'); },
      wsBase: 'ws://test.local', now, log: () => {},
    });
    clock = 0; src.pushAudio('ex1', new Int16Array([1])); await settle(); // dead, fetch#1
    expect(fetchCount).toBe(1);
    src.closeSession('ex1'); // end of arm → gate reset
    src.pushAudio('ex1', new Int16Array([1])); await settle(); // fresh arm → fetch attempted
    expect(fetchCount).toBe(2);
    src.dispose();
  });

  it('(d) a successful connect resets the backoff — a later first failure starts again at the 1s window', async () => {
    // MUTATION TARGET: remove the gate reset on 'open' → the post-open failure
    // carries the old 2s delay → the push at clock=2000 stays blocked → fetch#4 never fires → red.
    let mode: 'fail' | 'ok' = 'fail';
    let fetchCount = 0;
    const src = new RealtimeAnswerSource({
      socketFactory: (url) => new MockSocket(url),
      fetchTicket: async () => { fetchCount++; if (mode === 'fail') throw new Error('ws-ticket 500'); return 'tkt'; },
      wsBase: 'ws://test.local', now, log: () => {},
    });
    clock = 0; src.pushAudio('ex1', new Int16Array([1])); await settle();     // fail → window [0,1000)
    expect(fetchCount).toBe(1);
    mode = 'ok';
    clock = 1000; src.pushAudio('ex1', new Int16Array([1])); await settle();  // succeed → socket created
    expect(fetchCount).toBe(2);
    const sock = MockSocket.instances[MockSocket.instances.length - 1];
    sock.fireOpen();  // success signal → backoff reset
    mode = 'fail';
    sock.fireClose(); // no waiter → teardown; gate already reset by open
    clock = 1000; src.pushAudio('ex1', new Int16Array([1])); await settle();  // fresh connect fails → window must be [1000,2000)
    expect(fetchCount).toBe(3);
    clock = 1999; src.pushAudio('ex1', new Int16Array([1])); await settle();  // still inside the FRESH 1s window
    expect(fetchCount).toBe(3);
    clock = 2000; src.pushAudio('ex1', new Int16Array([1])); await settle();  // window was 1000ms (reset), not 2000ms
    expect(fetchCount).toBe(4);
    src.dispose();
  });

  it('(throttle) repeated connect failures log at most once per 5s window', async () => {
    const warns: string[] = [];
    const src = new RealtimeAnswerSource({
      socketFactory: (url) => new MockSocket(url),
      fetchTicket: async () => { throw new Error('ws-ticket 500'); },
      wsBase: 'ws://test.local', now, log: (m) => warns.push(m),
    });
    clock = 0;    src.pushAudio('ex1', new Int16Array([1])); await settle(); // logs (first)
    clock = 1000; src.pushAudio('ex1', new Int16Array([1])); await settle(); // <5s from t0 → suppressed
    clock = 3000; src.pushAudio('ex1', new Int16Array([1])); await settle(); // <5s from t0 → suppressed
    expect(warns.filter((w) => /connect failed/.test(w)).length).toBe(1);
    clock = 7000; src.pushAudio('ex1', new Int16Array([1])); await settle(); // >5s → logs again
    expect(warns.filter((w) => /connect failed/.test(w)).length).toBe(2);
    src.dispose();
  });

  it('(e-regress) happy path is unchanged: one fetch, socket opens, final resolves, no gate interference', async () => {
    let fetchCount = 0;
    const src = new RealtimeAnswerSource({
      socketFactory: (url) => new MockSocket(url),
      fetchTicket: async () => { fetchCount++; return 'tkt'; },
      wsBase: 'ws://test.local', now, log: () => {},
    });
    src.pushAudio('ex1', new Int16Array([1, 2, 3]));
    await settle();
    const sock = MockSocket.instances[MockSocket.instances.length - 1];
    sock.fireOpen();
    const p = src.awaitAnswerByBoundary('ex1', 3000);
    sock.message({ message_type: 'committed_transcript', text: 'ok' });
    expect(await p).toEqual({ status: 'final', text: 'ok' });
    expect(fetchCount).toBe(1); // exactly one ticket fetch across the whole happy path
    src.dispose();
  });

  it('(MED-5) a transient "unavailable" dead (3×429) revives after 60s → a later chunk retries', async () => {
    // MUTATION TARGET: remove the 60s TTL revive branch in pushAudio → the chunk
    // at clock=63000 stays dropped (dead forever) → fetchCount stuck at 3 → red.
    let fetchCount = 0;
    const src = new RealtimeAnswerSource({
      socketFactory: (url) => new MockSocket(url),
      fetchTicket: async () => { fetchCount++; throw new Error('ws-ticket 429'); },
      wsBase: 'ws://test.local', now, log: () => {},
    });
    clock = 0;    src.pushAudio('ex1', new Int16Array([1])); await settle(); // 429#1
    clock = 1000; src.pushAudio('ex1', new Int16Array([1])); await settle(); // 429#2
    clock = 3000; src.pushAudio('ex1', new Int16Array([1])); await settle(); // 429#3 → dead(unavailable)@3000
    expect(fetchCount).toBe(3);
    clock = 62000; src.pushAudio('ex1', new Int16Array([1])); await settle(); // still <60s from deadAt → dropped
    expect(fetchCount).toBe(3);
    clock = 63000; src.pushAudio('ex1', new Int16Array([1])); await settle(); // 60s after deadAt → revive → retry
    expect(fetchCount).toBe(4);
    src.dispose();
  });

  it('(MED-5b) a quota_exhausted dead never revives (a monthly limit does not clear in 60s)', async () => {
    let fetchCount = 0;
    const src = new RealtimeAnswerSource({
      socketFactory: (url) => new MockSocket(url),
      fetchTicket: async () => { fetchCount++; throw new Error('ws-ticket 429: {"error":"quota_exhausted"}'); },
      wsBase: 'ws://test.local', now, log: () => {},
    });
    clock = 0; src.pushAudio('ex1', new Int16Array([1])); await settle(); // dead(quota)@0, fetch#1
    expect(fetchCount).toBe(1);
    clock = 10_000_000; src.pushAudio('ex1', new Int16Array([1])); await settle();
    expect(fetchCount).toBe(1); // quota dead is permanent until re-arm
    src.dispose();
  });
});

describe('RealtimeAnswerSource — (unavail) onUnavailable one-shot on gate→dead [P-hotfix-quota-ux]', () => {
  // ТЗ №2: the browser WS never surfaces the failed-upgrade status/body to JS, so
  // the gateway's 429 quota_exhausted is opaque. This source fires onUnavailable
  // ONCE when the gate goes dead so PlayerPage can show a human banner.
  // Same passive-clock harness as the backoff block (no fake timers).
  let clock: number;
  const now = () => clock;
  async function settle() { for (let i = 0; i < 6; i++) await Promise.resolve(); }
  beforeEach(() => { clock = 0; MockSocket.instances = []; });

  it('quota_exhausted connect failure → fires onUnavailable ONCE with reason "quota_exhausted" + resetsAt', async () => {
    // MUTATION TARGET: delete the `unavailableFired` once-guard in
    // notifyUnavailableOnce → the subsequent dropped chunks re-fire → length>1 → red.
    const calls: Array<{ reason: string; resetsAt?: string }> = [];
    const src = new RealtimeAnswerSource({
      socketFactory: (url) => new MockSocket(url),
      fetchTicket: async () => {
        throw new Error('ws-ticket 429: {"error":"quota_exhausted","resets_at":"2026-08-01T00:00:00Z"}');
      },
      wsBase: 'ws://test.local', now, log: () => {},
      onUnavailable: (info) => calls.push(info),
    });
    clock = 0; src.pushAudio('ex1', new Int16Array([1])); await settle(); // opens → dies (quota) → dead
    // subsequent chunks are dropped (dead) — the notice must NOT re-fire
    src.pushAudio('ex1', new Int16Array([1])); await settle();
    src.pushAudio('ex1', new Int16Array([1])); await settle();
    clock = 10_000_000; src.pushAudio('ex1', new Int16Array([1])); await settle();
    expect(calls.length).toBe(1);
    expect(calls[0]).toEqual({ reason: 'quota_exhausted', resetsAt: '2026-08-01T00:00:00Z' });
    src.dispose();
  });

  it('three ws-ticket 429s (no quota body) → fires onUnavailable ONCE with reason "unavailable", no resetsAt', async () => {
    const calls: Array<{ reason: string; resetsAt?: string }> = [];
    const src = new RealtimeAnswerSource({
      socketFactory: (url) => new MockSocket(url),
      fetchTicket: async () => { throw new Error('ws-ticket 429'); },
      wsBase: 'ws://test.local', now, log: () => {},
      onUnavailable: (info) => calls.push(info),
    });
    clock = 0;    src.pushAudio('ex1', new Int16Array([1])); await settle(); // 429#1
    clock = 1000; src.pushAudio('ex1', new Int16Array([1])); await settle(); // 429#2
    clock = 3000; src.pushAudio('ex1', new Int16Array([1])); await settle(); // 429#3 → dead(unavailable)
    // dead now — the next dropped chunk fires the one-shot
    clock = 7000; src.pushAudio('ex1', new Int16Array([1])); await settle();
    clock = 9000; src.pushAudio('ex1', new Int16Array([1])); await settle();
    expect(calls).toEqual([{ reason: 'unavailable' }]);
    src.dispose();
  });

  it('runtime quota error frame (after open) → fires onUnavailable once with reason "quota_exhausted"', async () => {
    const calls: Array<{ reason: string; resetsAt?: string }> = [];
    const src = new RealtimeAnswerSource({
      socketFactory: (url) => new MockSocket(url),
      fetchTicket: async () => 'tkt',
      wsBase: 'ws://test.local', now, log: () => {},
      onUnavailable: (info) => calls.push(info),
    });
    clock = 0; src.pushAudio('ex1', new Int16Array([1])); await settle();
    const sock = MockSocket.instances[MockSocket.instances.length - 1];
    sock.fireOpen();
    // gateway accepted the WS, then rejects with a quota frame (runtime path)
    sock.message({ message_type: 'quota_exceeded', error: 'quota_exceeded' });
    // dead now — a subsequent chunk fires the one-shot
    clock = 10_000_000; src.pushAudio('ex1', new Int16Array([1])); await settle();
    src.pushAudio('ex1', new Int16Array([1])); await settle();
    expect(calls).toEqual([{ reason: 'quota_exhausted' }]);
    src.dispose();
  });

  it('(MED-3a) a quota frame whose message lacks the marker still dies via message_type', async () => {
    // MUTATION TARGET: revert failSession's quota check to QUOTA_RE.test(reason)
    // only → the human-readable message has no marker → gate never dies → no
    // notice fires → red.
    const calls: Array<{ reason: string; resetsAt?: string }> = [];
    const src = new RealtimeAnswerSource({
      socketFactory: (url) => new MockSocket(url),
      fetchTicket: async () => 'tkt',
      wsBase: 'ws://test.local', now, log: () => {},
      onUnavailable: (info) => calls.push(info),
    });
    clock = 0; src.pushAudio('ex1', new Int16Array([1])); await settle();
    const sock = MockSocket.instances[MockSocket.instances.length - 1];
    sock.fireOpen();
    // message_type IS the fatal signal; the only human field carries NO marker.
    sock.message({ message_type: 'quota_exceeded', message: 'You have run out of your monthly allowance' });
    clock = 10_000_000; src.pushAudio('ex1', new Int16Array([1])); await settle();
    expect(calls).toEqual([{ reason: 'quota_exhausted' }]);
    src.dispose();
  });

  it('without onUnavailable the source behaves byte-identically (dead gate still drops, no throw)', async () => {
    let fetchCount = 0;
    const src = new RealtimeAnswerSource({
      socketFactory: (url) => new MockSocket(url),
      fetchTicket: async () => { fetchCount++; throw new Error('ws-ticket 429: {"error":"quota_exhausted"}'); },
      wsBase: 'ws://test.local', now, log: () => {},
    }); // no onUnavailable
    clock = 0; src.pushAudio('ex1', new Int16Array([1])); await settle();
    expect(() => { src.pushAudio('ex1', new Int16Array([1])); }).not.toThrow();
    await settle();
    expect(fetchCount).toBe(1); // dead → no re-fetch, notice absent is inert
    src.dispose();
  });
});

describe('RealtimeAnswerSource — (suspend) soft pause vs hard close [ID:P-tz4-fix HIGH-2]', () => {
  // ТЗ №4 фикс-волна HIGH-2: пауза видео звала closeSession → gates.delete +
  // resolveAll + потеря latestFinal ⇒ dead-quota воскресала на каждый pause/play,
  // бэкофф обнулялся, забуференный финал терялся. suspendSession закрывает ТОЛЬКО
  // транспорт, сохраняя запись сессии / ConnectGate / dead / latestFinal.
  let clock: number;
  const now = () => clock;
  async function settle() { for (let i = 0; i < 6; i++) await Promise.resolve(); }
  beforeEach(() => { clock = 0; MockSocket.instances = []; });

  it('(h2-a) suspend НЕ трогает dead-quota gate: pause→play → ticket-fetch НЕ вызван, onUnavailable НЕ перефаерился', async () => {
    // MUTATION TARGET: заменить suspendSession→closeSession в useShadowMicStream
    // (или сделать suspendSession звать gates.delete) → gate воскресает → fetch#2 → red.
    let fetchCount = 0;
    const calls: Array<{ reason: string; resetsAt?: string }> = [];
    const src = new RealtimeAnswerSource({
      socketFactory: (url) => new MockSocket(url),
      fetchTicket: async () => { fetchCount++; throw new Error('ws-ticket 429: {"error":"quota_exhausted"}'); },
      wsBase: 'ws://test.local', now, log: () => {},
      onUnavailable: (info) => calls.push(info),
    });
    clock = 0; src.pushAudio('ex1', new Int16Array([1])); await settle(); // dead(quota)@0, fetch#1
    src.pushAudio('ex1', new Int16Array([1])); await settle();            // dropped → onUnavailable fires ONCE
    expect(fetchCount).toBe(1);
    expect(calls.length).toBe(1);

    src.suspendSession('ex1'); // «пауза видео»

    // «play» — далёкий во времени чанк; dead ПЕРЕЖИЛ suspend (gate НЕ удалён).
    clock = 10_000_000; src.pushAudio('ex1', new Int16Array([1])); await settle();
    src.pushAudio('ex1', new Int16Array([1])); await settle();
    expect(fetchCount).toBe(1); // НЕ воскрес — тикет НЕ дёрнут заново
    expect(calls.length).toBe(1); // one-shot latch пережил suspend — баннер не спамит
    src.dispose();
  });

  it('(h2-b) suspend сохраняет забуференный latestFinal (S3-9 жив): финал доставлен на границе после pause→play', async () => {
    // MUTATION TARGET: сделать suspendSession звать teardown/closeSession → сессия
    // удалена, latestFinal потерян → awaitAnswerByBoundary регистрирует waiter,
    // финал 'договорил' НЕ доставлен → red.
    const src = new RealtimeAnswerSource({
      socketFactory: (url) => new MockSocket(url),
      fetchTicket: async () => 'tkt', wsBase: 'ws://test.local', now, log: () => {},
    });
    clock = 0; src.pushAudio('ex1', new Int16Array([1])); await settle();
    const sock = MockSocket.instances[MockSocket.instances.length - 1];
    sock.fireOpen();
    // финал коммитится ДО того, как граница зарегистрировала waiter → буферится в latestFinal
    sock.message({ message_type: 'committed_transcript', text: 'договорил' });

    src.suspendSession('ex1'); // «пауза видео» ПОСЛЕ того, как договорил

    // «play»: возобновляем стрим (lazy-reopen), затем граница потребляет буфер.
    src.pushAudio('ex1', new Int16Array([1])); await settle();
    const outcome = await src.awaitAnswerByBoundary('ex1', 3000);
    expect(outcome).toEqual({ status: 'final', text: 'договорил' });
    src.dispose();
  });

  it('(h2-b2) suspend закрывает транспорт (сокет закрыт), а возобновление lazy-reopen новым сокетом', async () => {
    const src = new RealtimeAnswerSource({
      socketFactory: (url) => new MockSocket(url),
      fetchTicket: async () => 'tkt', wsBase: 'ws://test.local', now, log: () => {},
    });
    clock = 0; src.pushAudio('ex1', new Int16Array([1])); await settle();
    const sock1 = MockSocket.instances[MockSocket.instances.length - 1];
    sock1.fireOpen();
    expect(sock1.closed).toBe(false);

    src.suspendSession('ex1');
    expect(sock1.closed).toBe(true); // транспорт закрыт

    // возобновление → НОВЫЙ сокет (lazy-reopen), а не воскрешение старого
    src.pushAudio('ex1', new Int16Array([1])); await settle();
    const sock2 = MockSocket.instances[MockSocket.instances.length - 1];
    expect(sock2).not.toBe(sock1);
    src.dispose();
  });

  it('(h2-c) closeSession (разарм) — по-прежнему ПОЛНАЯ чистка: latestFinal дропнут (сессия снесена)', async () => {
    // Контраст к (h2-b): closeSession делает teardown + gates.delete, буфер теряется.
    const src = new RealtimeAnswerSource({
      socketFactory: (url) => new MockSocket(url),
      fetchTicket: async () => 'tkt', wsBase: 'ws://test.local', now, log: () => {},
    });
    clock = 0; src.pushAudio('ex1', new Int16Array([1])); await settle();
    const sock = MockSocket.instances[MockSocket.instances.length - 1];
    sock.fireOpen();
    sock.message({ message_type: 'committed_transcript', text: 'договорил' }); // буферится

    src.closeSession('ex1'); // РАЗАРМ → полная чистка

    // свежая граница создаёт НОВУЮ сессию без буфера → abort даёт timeout, НЕ final
    const ctrl = new AbortController();
    const p = src.awaitAnswerByBoundary('ex1', 3000, ctrl.signal);
    ctrl.abort();
    expect(await p).toEqual({ status: 'timeout' }); // буфер БЫЛ дропнут (не 'final')
    src.dispose();
  });

  it('(h2-d) suspend несуществующей сессии — no-op, без throw', async () => {
    const src = makeSource();
    expect(() => src.suspendSession('never-armed')).not.toThrow();
    src.dispose();
  });
});

describe('RealtimeAnswerSource — outcome type conformance', () => {
  it('final outcome matches the AnswerOutcome union shape', async () => {
    const src = makeSource();
    const sock = await openSession(src, 'ex1');
    const p = src.awaitAnswerByBoundary('ex1', 3000);
    sock.message({ message_type: 'committed_transcript', text: 'x' });
    const outcome: AnswerOutcome = await p;
    expect(outcome.status).toBe('final');
    src.dispose();
  });
});
