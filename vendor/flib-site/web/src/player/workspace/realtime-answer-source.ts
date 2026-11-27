// realtime-answer-source.ts — S3-9 (phase ii). The REAL streaming AnswerSource:
// a lift of the desktop Scribe v2 realtime client
// (anki_conf/internal/platform/elevenlabs/client.go) onto the SAME `AnswerSource`
// seam the coordinator already consumes. It DROPS IN on the exact
// `answerSource` prop `FakeAnswerSource` occupied (PlayerPage.tsx) — the
// coordinator, useShadowRuntime, and finalizeLoopFromAnswerSource (F4) are
// UNCHANGED. This file adds ZERO coordinator logic.
//
// ── Wire canon (source of truth: client.go; BFF proxy: internal/bff/stt_realtime.go)
//   Handshake: GET  /api/stt/ws-ticket → {ticket}; then WS
//     /api/stt/realtime?ticket=<hex>&model_id=scribe_v2_realtime
//       &audio_format=pcm_16000&commit_strategy=vad&include_timestamps=true
//       [&language_code=xx]
//   The tpk_ gateway token is injected SERVER-SIDE by the BFF proxy — this
//   client never sees or sends it (barrier).
//   Client→server (audio): JSON text-frame
//     {"message_type":"input_audio_chunk","audio_base_64":"<b64 PCM16 16k mono>","sample_rate":16000}
//   Server→client, keyed by message_type (there is NO is_final field on the raw
//   gateway frames the browser receives — infer by type, exactly as client.go's
//   handleTextMessage synthesises IsFinal):
//     partial_transcript{text}                      → NON-FINAL (interim)
//     committed_transcript{text}                    → FINAL
//     committed_transcript_with_timestamps{text,…}  → FINAL
//     proxy_error / input_error / transcriber_error / error / auth_error /
//       quota_exceeded                              → ERROR
//     proxy_status / session_started                → informational (ignored)
//   commit_strategy=vad → the gateway auto-commits finals on a detected pause;
//   the client sends no explicit commit.
//
// ── Session lifecycle (brief §Сессия, §Для реального Ф2 п.2)
//   • WS-session is PER-EXERCISE, keyed by ex.id. Independent ex.id → independent
//     sockets + independent partial/waiter state → an answer for call N can never
//     land in call N-1's state.
//   • LAZY-OPEN on first pushAudio (audio = the exercise is being spoken). This
//     is deliberate: without audio there is nothing to transcribe, so no WS (and
//     thus NO gateway contact) is opened. awaitAnswerByBoundary alone only
//     registers a waiter on the session STATE; it never opens a socket by
//     itself. This keeps the barrier honest — with the mic un-wired (S3-10) the
//     source touches no gateway.
//   • REUSE across sequential boundaries: each awaitAnswerByBoundary registers a
//     FIFO waiter; each committed_transcript resolves the front waiter; the
//     socket stays open (continuous-listen) for the next boundary.
//   • CLOSE on: (a) error/WS-close while a waiter is pending (fatal), (b) explicit
//     closeSession(exId) / dispose() from the caller on unarm/unmount/exercise-
//     change. A single per-boundary abort (F4's budget timer) does NOT close the
//     session — that would break continuous-listen and re-open per boundary,
//     losing the gateway's VAD continuity. The gateway idle-closes ~15s of
//     silence on its own as a final backstop.
//
// ── budgetMs (F4)
//   This source does NOT run its own budgetMs timer. finalizeLoopFromAnswerSource
//   (F4) enforces the 3000ms ceiling BY CONSTRUCTION (Promise.race + abort via
//   `signal`). On abort the source resolves from its ACCUMULATED state: a partial
//   seen → {status:'non-final', partial}; nothing seen → {status:'timeout'}.
//   Because F4 aborts sourceCtrl synchronously before its own {status:'timeout'}
//   resolve, the source's richer outcome wins the race and reaches onOutcome
//   (T3/T7 seam) intact.

import type { AnswerOutcome, AnswerSource } from './answer-source';
import { FakeAnswerSource } from './answer-source';

/** Minimal structural subset of the browser `WebSocket` this source needs.
 *  Injectable so unit tests drive a mock — the barrier forbids a real socket. */
export interface RealtimeSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: string, listener: (ev: unknown) => void): void;
  removeEventListener(type: string, listener: (ev: unknown) => void): void;
}

export type RealtimeSocketFactory = (url: string) => RealtimeSocketLike;
export type TicketFetcher = () => Promise<string>;

export interface RealtimeAnswerSourceOptions {
  /** WS constructor. Default: `(url) => new WebSocket(url)`. */
  socketFactory?: RealtimeSocketFactory;
  /** One-shot ticket fetch. Default: GET `${basePath}/ws-ticket` → {ticket}. */
  fetchTicket?: TicketFetcher;
  /** Optional 2-letter language_code; empty = gateway auto-detect. */
  languageCode?: string;
  /** BFF base path. Default '/api/stt'. */
  basePath?: string;
  /** PCM sample rate advertised in the audio frame + handshake. Default 16000. */
  sampleRate?: number;
  /** ws(s)://host base. Default derived from window.location. */
  wsBase?: string;
  /** Diagnostic sink. Default: console.warn for errors only. */
  log?: (msg: string, extra?: unknown) => void;
  /** Injectable monotonic clock (ms) — the connect-backoff gate reads it instead
   *  of Date.now so unit tests can drive time deterministically. Default Date.now. */
  now?: () => number;
  /** Срез D: живой listener партиалов. Эмитится на КАЖДОМ partial_transcript
   *  (interim), с exerciseId сессии и последним interim-текстом. НЕ эмитится на
   *  committed-финалах (финал идёт своим путём — awaitAnswerByBoundary/onOutcome).
   *  Аддитивно: без него источник ведёт себя байт-в-байт прежним образом. */
  onPartial?: (exerciseId: string, text: string) => void;
  /** ТЗ №2 [ID:P-hotfix-quota-ux]: одноразовый (per-gate) сигнал «источник стал
   *  недоступен» — фаер РОВНО ОДИН РАЗ на переход gate→dead, чтобы UI показал
   *  человекочитаемый баннер (браузерный WS не отдаёт JS статус/тело
   *  провалившегося upgrade). reason:'quota_exhausted' — квота исчерпана (из тела
   *  тикет-429 / рантайм-квоты); resetsAt (если удалось распарсить) — RFC3339
   *  дедлайн обновления квоты. reason:'unavailable' — 3×429 подряд (BFF per-IP
   *  гейт исчерпан) без quota-маркера. Аддитивно: без него источник ведёт себя
   *  байт-в-байт прежним образом. */
  onUnavailable?: (info: { reason: 'quota_exhausted' | 'unavailable'; resetsAt?: string }) => void;
}

const WS_OPEN = 1;

interface Waiter {
  settled: boolean;
  settle: (o: AnswerOutcome) => void;
}

/** Per-exercise connect-backoff gate (PROD INCIDENT 2026-07-10). Lives in a map
 *  SEPARATE from Session because a failed connect tears the Session down (deleted
 *  from `sessions`) — the backoff must survive that teardown to actually suppress
 *  the next chunk's re-open. Keyed by exerciseId; cleared on a successful connect
 *  (open) and on closeSession (end of arm). A NEW exerciseId (re-arm) gets a fresh
 *  key ⇒ a fresh attempt. */
interface ConnectGate {
  /** Chunks with now() < nextAllowedAt are dropped (no fetch, no queue). */
  nextAllowedAt: number;
  /** Current backoff delay: 0 → 1000 → 2000 → … capped at 30000. */
  delayMs: number;
  /** Streak of ws-ticket 429s; 3 in a row ⇒ dead (BFF per-IP gate exhausted). */
  consecutive429: number;
  /** Fatal: quota_exhausted or 3×429 — no reconnect (quota until re-arm; a
   *  transient 'unavailable' revives after 60s, see pushAudio). */
  dead: boolean;
  /** MED-5: now() at the dead transition — drives the 60s TTL for the transient
   *  'unavailable' dead. `undefined` until the gate first dies. */
  deadAt?: number;
  /** Throttle: last connect-error log timestamp (ms). */
  lastLogAt: number;
  /** ТЗ №2: why the gate died — populated ONCE at the dead transition, read when
   *  the next dropped chunk fires the one-shot onUnavailable. `null` = not dead. */
  deadReason: 'quota_exhausted' | 'unavailable' | null;
  /** resets_at (RFC3339) parsed from a quota-429 body, if present. */
  deadResetsAt?: string;
  /** One-shot latch: onUnavailable fires exactly ONCE per dead gate. */
  unavailableFired: boolean;
}

interface Session {
  exerciseId: string;
  socket: RealtimeSocketLike | null;
  opening: boolean;
  closed: boolean;
  /** True once the WS 'open' fired (ticket valid + gateway accepted). Distinguishes
   *  a connect failure (before open → backoff) from a runtime error (after open →
   *  the existing failSession path, no backoff). */
  connected: boolean;
  latestPartial: string;
  /** One-slot buffer for a FINAL that committed with no boundary waiting yet.
   *  Canon: client.go:208 uses a BUFFERED chan(10) — an early final (VAD commits
   *  before the boundary registers) is never lost. `null` = empty/consumed. The
   *  next awaitAnswerByBoundary consumes it (and clears the slot: one final = one
   *  boundary, so a later boundary can't re-serve a stale final). */
  latestFinal: { text: string } | null;
  pendingAudio: string[];
  waiters: Waiter[];
  listeners: Array<[string, (ev: unknown) => void]>;
}

/** Encode little-endian PCM16 samples to base64 (audio_format=pcm_16000, s16le). */
function pcm16ToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let binary = '';
  const CHUNK = 0x8000; // avoid String.fromCharCode arg-count blowup on big buffers
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function deriveWsBase(): string {
  const loc = typeof window !== 'undefined' ? window.location : undefined;
  const scheme = loc && loc.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = (loc && loc.host) || 'localhost';
  return `${scheme}//${host}`;
}

export class RealtimeAnswerSource implements AnswerSource {
  /** Fatal quota/ban signal (no `g` flag ⇒ stateless, safe to share). */
  private static readonly QUOTA_RE = /quota_exhausted|quota_exceeded/i;

  private readonly socketFactory: RealtimeSocketFactory;
  private readonly fetchTicket: TicketFetcher;
  private readonly languageCode?: string;
  private readonly basePath: string;
  private readonly sampleRate: number;
  private readonly wsBase: string;
  private readonly log: (msg: string, extra?: unknown) => void;
  private readonly onPartial?: (exerciseId: string, text: string) => void;
  private readonly onUnavailable?: (info: { reason: 'quota_exhausted' | 'unavailable'; resetsAt?: string }) => void;
  private readonly now: () => number;

  private readonly sessions = new Map<string, Session>();
  /** Connect-backoff gates, keyed by exerciseId — see ConnectGate. */
  private readonly gates = new Map<string, ConnectGate>();

  constructor(opts: RealtimeAnswerSourceOptions = {}) {
    this.basePath = opts.basePath ?? '/api/stt';
    this.sampleRate = opts.sampleRate ?? 16000;
    this.languageCode = opts.languageCode;
    this.wsBase = opts.wsBase ?? deriveWsBase();
    this.socketFactory = opts.socketFactory ?? ((url) => new WebSocket(url) as unknown as RealtimeSocketLike);
    this.fetchTicket = opts.fetchTicket ?? (async () => {
      const res = await fetch(`${this.basePath}/ws-ticket`, { method: 'GET' });
      if (!res.ok) {
        // Carry the response body into the error so the backoff gate can spot a
        // `quota_exhausted` payload behind a 429 (fatal-marker path). Best-effort.
        let detail = '';
        try { detail = (await res.text()).slice(0, 200); } catch { /* body unreadable */ }
        throw new Error(`ws-ticket ${res.status}${detail ? `: ${detail}` : ''}`);
      }
      const body = (await res.json()) as { ticket?: string };
      if (!body?.ticket) throw new Error('ws-ticket: no ticket in response');
      return body.ticket;
    });
    this.log = opts.log ?? ((msg, extra) => console.warn(`[realtime-answer-source] ${msg}`, extra ?? ''));
    this.onPartial = opts.onPartial;
    this.onUnavailable = opts.onUnavailable;
    this.now = opts.now ?? (() => Date.now());
  }

  // ── AnswerSource contract ──────────────────────────────────────────────────

  awaitAnswerByBoundary(
    exerciseId: string,
    _budgetMs: number, // F4 owns the ceiling; the source does NOT self-limit
    signal?: AbortSignal,
  ): Promise<AnswerOutcome> {
    const session = this.ensureSession(exerciseId);

    // FIX#1 (canon buffered chan): if a final committed BEFORE this boundary
    // registered a waiter, it sits unconsumed in `latestFinal`. Consume it
    // immediately — no waiter, no wait. Consuming CLEARS the slot (stale-final
    // guard: one final = one boundary) and clears the interim (a final consumes
    // the partial, same as the commit path).
    if (session.latestFinal) {
      const { text } = session.latestFinal;
      session.latestFinal = null;
      session.latestPartial = '';
      return Promise.resolve({ status: 'final', text });
    }

    return new Promise<AnswerOutcome>((resolve) => {
      const waiter: Waiter = { settled: false, settle: () => {} };

      const onAbort = () => {
        // Resolve from ACCUMULATED state (this session's own partial — never
        // another exercise's, they hold separate Session objects).
        const partial = session.latestPartial;
        // FIX#2: consuming the partial in this (non-final/timeout) outcome clears
        // it, so a boundary N+1 with no NEW partial does not re-serve loop N's
        // stale phrase. One partial = one outcome.
        session.latestPartial = '';
        waiter.settle(partial ? { status: 'non-final', partial } : { status: 'timeout' });
      };

      waiter.settle = (outcome: AnswerOutcome) => {
        if (waiter.settled) return;
        waiter.settled = true;
        const i = session.waiters.indexOf(waiter);
        if (i >= 0) session.waiters.splice(i, 1);
        if (signal) signal.removeEventListener('abort', onAbort);
        resolve(outcome);
      };

      if (signal?.aborted) {
        onAbort(); // never registered on the queue
        return;
      }
      session.waiters.push(waiter);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  // ── Audio injection (synthetic in S3-9; real mic = S3-10) ───────────────────

  /** Feed one PCM16 chunk for `exerciseId`. Lazily opens the per-exercise WS on
   *  the first chunk (audio present ⇒ worth transcribing). */
  pushAudio(exerciseId: string, pcm: Int16Array): void {
    // Connect-backoff gate (PROD INCIDENT 2026-07-10). Checked BEFORE ensureSession
    // so a gated chunk opens nothing and creates no empty session. A `dead` gate or
    // an unexpired backoff window DROPS the chunk silently — no fetch, no queued
    // frame (dropping, not buffering, is deliberate: a queue would replay a burst
    // the instant the window opens, re-storming the ticket endpoint).
    const gate = this.gates.get(exerciseId);
    if (gate && gate.dead) {
      // MED-5: a TRANSIENT 'unavailable' dead (3×429 — BFF per-IP gate exhausted)
      // must not be permanent: revive it 60s after the dead transition so the mic
      // can retry once the storm passes. A 'quota_exhausted' dead (month limit)
      // stays dead until re-arm — 60s can't clear a monthly quota.
      if (gate.deadReason === 'unavailable'
          && gate.deadAt != null && this.now() - gate.deadAt >= 60000) {
        gate.dead = false;
        gate.deadReason = null;
        gate.deadAt = undefined;
        gate.consecutive429 = 0;
        gate.delayMs = 0;
        gate.nextAllowedAt = 0;
        gate.unavailableFired = false;
        // fall through to the normal (non-dead) open path below
      } else {
        // ТЗ №2: the gate is dead (quota/ban). Notify the UI ONCE (the very next
        // dropped chunk after the fatal transition — mic streams continuously, so
        // this is ~immediate), then keep silently dropping. The one-shot latch is
        // load-bearing: without it every dropped chunk (tens/sec) would re-fire.
        this.notifyUnavailableOnce(gate);
        return;
      }
    }
    if (gate && gate.nextAllowedAt > this.now()) return;

    const session = this.ensureSession(exerciseId);
    if (session.closed) return;
    const frame = JSON.stringify({
      message_type: 'input_audio_chunk',
      audio_base_64: pcm16ToBase64(pcm),
      sample_rate: this.sampleRate,
    });
    if (session.socket && session.socket.readyState === WS_OPEN) {
      session.socket.send(frame);
    } else {
      session.pendingAudio.push(frame);
      this.openSocket(session);
    }
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  /** Close a single exercise's session (unarm / exercise-change). Pending
   *  waiters resolve as no-response(no-connection) — a deliberate close is not
   *  an error, but the boundary still got no answer. */
  closeSession(exerciseId: string): void {
    // End of arm → drop the backoff gate FIRST (before the early-return): a connect
    // failure may have already torn the Session down, leaving only the gate behind.
    // Re-arming (even the SAME exerciseId) must then start from a clean slate.
    this.gates.delete(exerciseId);
    const session = this.sessions.get(exerciseId);
    if (!session) return;
    this.resolveAll(session, { status: 'no-response', reason: 'no-connection' });
    this.teardown(session);
  }

  /** ТЗ №4 п.3 [ID:P-tz4-fix HIGH-2]: SOFT pause (пауза видео). Closes ONLY the
   *  WS transport and stops streaming, but PRESERVES the session record
   *  (latestFinal/latestPartial — S3-9 buffer survives), the ConnectGate and its
   *  dead-state (so a dead-quota does NOT resurrect on every pause/play and the
   *  onUnavailable one-shot latch stays fired). Resume is automatic: the next
   *  pushAudio lazy-reopens a fresh socket (backoff/dead still respected).
   *
   *  Distinct from closeSession (unarm/exercise-change), which DELETES the gate
   *  (gates.delete) + resolveAll's waiters + teardown drops latestFinal.
   *
   *  Pending waiters: at a pause OUTSIDE eval there are none (the composition
   *  layer's `analyzing` holds transmit until the verdict, so we never suspend
   *  mid-eval). If any DID exist we deliberately do NOT resolve them here (unlike
   *  closeSession's no-connection resolve) — the coordinator's F4 budget timer
   *  (Promise.race abort) settles them from accumulated state instead. */
  suspendSession(exerciseId: string): void {
    const session = this.sessions.get(exerciseId);
    if (!session || session.closed) return;
    // Close only the transport. Remove listeners FIRST so our own socket.close()
    // does not re-enter onClose → failSession/teardown (which would drop the
    // session + latestFinal). The session object stays in `this.sessions` with
    // closed=false so a later pushAudio can reopen it (openSocket guard passes).
    const socket = session.socket;
    if (socket) {
      for (const [type, cb] of session.listeners) socket.removeEventListener(type, cb);
      try { socket.close(); } catch { /* already closing */ }
    }
    session.listeners = [];
    session.socket = null;
    session.opening = false;
    session.connected = false;
    session.pendingAudio = []; // stale pre-pause frames — a fresh open re-streams live audio
    // latestFinal / latestPartial / waiters INTENTIONALLY preserved.
  }

  /** Close every session (unmount). */
  dispose(): void {
    for (const id of [...this.sessions.keys()]) this.closeSession(id);
    // A connect failure tears its Session down (deleted from `sessions`) but leaves
    // the gate behind; those orphans are invisible to the loop above — clear them.
    this.gates.clear();
  }

  // ── internals ────────────────────────────────────────────────────────────────

  private ensureSession(exerciseId: string): Session {
    let session = this.sessions.get(exerciseId);
    if (!session) {
      session = {
        exerciseId,
        socket: null,
        opening: false,
        closed: false,
        connected: false,
        latestPartial: '',
        latestFinal: null,
        pendingAudio: [],
        waiters: [],
        listeners: [],
      };
      this.sessions.set(exerciseId, session);
    }
    return session;
  }

  private openSocket(session: Session): void {
    if (session.closed || session.opening || session.socket) return;
    session.opening = true;
    this.fetchTicket()
      .then((ticket) => {
        if (session.closed) return; // disposed while awaiting the ticket
        const url = this.buildUrl(ticket);
        const socket = this.socketFactory(url);
        session.socket = socket;

        const onOpen = () => this.onConnected(session);
        const onMessage = (ev: unknown) => this.handleMessage(session, ev);
        const onError = () => {
          // Before 'open' a transport error is a CONNECT failure → backoff; after
          // open it is a runtime error → the existing failSession path (no backoff).
          if (session.connected) this.failSession(session, 'websocket transport error');
          else this.failConnect(session, 'websocket transport error');
        };
        const onClose = () => {
          if (session.closed) return; // our own teardown → benign
          if (!session.connected) { this.failConnect(session, 'websocket closed before open'); return; }
          // A close with waiters still pending is fatal for them; with none it is
          // just the continuous-listen socket ending (idle/normal) — tear down.
          if (session.waiters.length) this.failSession(session, 'websocket closed');
          else this.teardown(session);
        };

        socket.addEventListener('open', onOpen);
        socket.addEventListener('message', onMessage);
        socket.addEventListener('error', onError);
        socket.addEventListener('close', onClose);
        session.listeners = [
          ['open', onOpen], ['message', onMessage], ['error', onError], ['close', onClose],
        ];

        // If the mock/real socket is already OPEN by the time listeners attach,
        // flush immediately (defensive — real WebSocket fires 'open' async).
        if (socket.readyState === WS_OPEN) this.onConnected(session);
      })
      .catch((err) => {
        // Ticket fetch / socket construction failure — a CONNECT failure (no open).
        this.failConnect(session, `connect failed: ${(err as Error)?.message ?? err}`);
      })
      .finally(() => { session.opening = false; });
  }

  private buildUrl(ticket: string): string {
    const p = new URLSearchParams();
    p.set('ticket', ticket);
    p.set('model_id', 'scribe_v2_realtime');
    p.set('audio_format', 'pcm_16000');
    p.set('commit_strategy', 'vad');
    p.set('include_timestamps', 'true');
    if (this.languageCode) p.set('language_code', this.languageCode);
    return `${this.wsBase}${this.basePath}/realtime?${p.toString()}`;
  }

  private flushAudio(session: Session): void {
    const socket = session.socket;
    if (!socket || socket.readyState !== WS_OPEN) return;
    for (const frame of session.pendingAudio) socket.send(frame);
    session.pendingAudio = [];
  }

  private handleMessage(session: Session, ev: unknown): void {
    const data = (ev as { data?: unknown })?.data;
    if (typeof data !== 'string') return;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return; // non-JSON frame — ignore
    }
    const type = (msg.message_type as string) ?? (msg.type as string);
    switch (type) {
      case 'partial_transcript':
        session.latestPartial = String(msg.text ?? '');
        // Срез D: живой эмит interim наружу (карточка показывает partialText).
        // ТОЛЬКО на partial — committed-финал ниже НЕ зовёт onPartial (финал
        // идёт своим путём: resolveFrontOrBuffer → awaitAnswerByBoundary).
        this.onPartial?.(session.exerciseId, session.latestPartial);
        break;
      case 'committed_transcript':
      case 'committed_transcript_with_timestamps': {
        const text = String(msg.text ?? '');
        session.latestPartial = ''; // a commit consumes the interim
        this.resolveFrontOrBuffer(session, text);
        break;
      }
      case 'proxy_error':
      case 'input_error':
      case 'transcriber_error':
      case 'error':
      case 'auth_error':
      case 'quota_exceeded': {
        const reason = String(
          msg.error_type ?? msg.error ?? msg.message ?? msg.code ?? type,
        );
        // MED-3a: the frame's message_type IS the fatal signal — a
        // `quota_exceeded` frame carrying only a human-readable `message` (no
        // machine marker) must still mark the gate dead. Trust the type, don't
        // rely on the marker leaking into the reason string.
        this.failSession(session, reason, type === 'quota_exceeded');
        break;
      }
      // proxy_status / session_started / unknown → informational
      default:
        break;
    }
  }

  /** Resolve the FIFO-front pending waiter (the boundary that has been waiting
   *  longest). A final with NO waiter is NOT dropped — it is buffered in the
   *  one-slot `latestFinal` (canon: client.go:208 buffered chan). The next
   *  awaitAnswerByBoundary consumes it. One-slot "latest wins": a fresher final
   *  before the next boundary overwrites an older un-consumed one. */
  private resolveFrontOrBuffer(session: Session, text: string): void {
    const waiter = session.waiters.find((w) => !w.settled);
    if (waiter) {
      waiter.settle({ status: 'final', text });
      return;
    }
    session.latestFinal = { text };
  }

  private failSession(session: Session, reason: string, quotaFatal = false): void {
    this.log(`session ${session.exerciseId} error: ${reason}`);
    // A runtime quota/ban (gateway accepted the WS then rejected) is fatal too —
    // mark the gate dead so the next chunk does not immediately reconnect + re-storm.
    // MED-3a: quotaFatal (message_type==='quota_exceeded') is authoritative even
    // when the human-readable reason lacks the machine marker.
    if (quotaFatal || RealtimeAnswerSource.QUOTA_RE.test(reason)) {
      const gate = this.ensureGate(session.exerciseId);
      if (!gate.dead) { // record the cause once (dead transition) for onUnavailable
        gate.dead = true;
        gate.deadReason = 'quota_exhausted';
        gate.deadAt = this.now();
        const rs = RealtimeAnswerSource.extractResetsAt(reason);
        if (rs) gate.deadResetsAt = rs;
      }
    }
    this.resolveAll(session, { status: 'error', reason });
    this.teardown(session);
  }

  /** Successful connect (WS 'open'): the ticket was valid and the gateway accepted
   *  the socket. Reset the backoff (drop the gate) and flush buffered audio. */
  private onConnected(session: Session): void {
    session.connected = true;
    this.gates.delete(session.exerciseId);
    this.flushAudio(session);
  }

  /** Extract a `resets_at` RFC3339 value out of an error `reason` string (the
   *  ticket-429 body is carried verbatim into the Error message after 02f5cfd).
   *  Stateless (no `g` flag) → safe to run on the class. */
  private static readonly RESETS_RE = /"resets_at"\s*:\s*"([^"]+)"/;
  private static extractResetsAt(reason: string): string | undefined {
    const m = RealtimeAnswerSource.RESETS_RE.exec(reason);
    return m ? m[1] : undefined;
  }

  /** Fire opts.onUnavailable EXACTLY ONCE per dead gate. The `unavailableFired`
   *  guard is the once-latch (removing it re-fires on every subsequent dropped
   *  chunk). reason/resetsAt were recorded at the dead transition. */
  private notifyUnavailableOnce(gate: ConnectGate): void {
    if (gate.unavailableFired) return;
    gate.unavailableFired = true;
    if (!this.onUnavailable) return;
    const info: { reason: 'quota_exhausted' | 'unavailable'; resetsAt?: string } = {
      reason: gate.deadReason ?? 'unavailable',
    };
    if (gate.deadResetsAt) info.resetsAt = gate.deadResetsAt;
    this.onUnavailable(info);
  }

  private ensureGate(exerciseId: string): ConnectGate {
    let gate = this.gates.get(exerciseId);
    if (!gate) {
      gate = { nextAllowedAt: 0, delayMs: 0, consecutive429: 0, dead: false, lastLogAt: Number.NEGATIVE_INFINITY, deadReason: null, unavailableFired: false };
      this.gates.set(exerciseId, gate);
    }
    return gate;
  }

  /** Handle a CONNECT failure (before 'open'): arm the exponential backoff window,
   *  detect the fatal (dead) condition, log at most once per 5s (plus one warn on
   *  the dead transition), then resolve any pending waiters and tear the session
   *  down. The gate SURVIVES the teardown (it lives in `this.gates`). */
  private failConnect(session: Session, reason: string): void {
    const exId = session.exerciseId;
    const gate = this.ensureGate(exId);
    const now = this.now();

    // exponential backoff: 1s → 2s → 4s … capped at 30s
    gate.delayMs = gate.delayMs === 0 ? 1000 : Math.min(gate.delayMs * 2, 30000);
    gate.nextAllowedAt = now + gate.delayMs;

    // fatal-marker: quota_exhausted in the body, or 3 ws-ticket 429s in a row
    const is429 = /ws-ticket 429/.test(reason);
    gate.consecutive429 = is429 ? gate.consecutive429 + 1 : 0;
    const wasDead = gate.dead;
    const isQuota = RealtimeAnswerSource.QUOTA_RE.test(reason);
    if (isQuota || gate.consecutive429 >= 3) {
      gate.dead = true;
      if (!wasDead) { // record the cause once (dead transition) for onUnavailable
        gate.deadReason = isQuota ? 'quota_exhausted' : 'unavailable';
        gate.deadAt = now; // MED-5: TTL anchor for a transient 'unavailable' dead
        const rs = RealtimeAnswerSource.extractResetsAt(reason);
        if (rs) gate.deadResetsAt = rs;
      }
    }

    // logging: exactly one warn on the dead transition; otherwise throttle to 1 / 5s
    if (gate.dead && !wasDead) {
      this.log(`session ${exId} connect DEAD (quota/ban): ${reason} — no reconnect until re-arm`);
    } else if (!gate.dead && now - gate.lastLogAt >= 5000) {
      gate.lastLogAt = now;
      this.log(`session ${exId} connect failed: ${reason} (retry in ${gate.delayMs}ms)`);
    }

    // pending waiters must not hang — a connect failure is an error for them
    this.resolveAll(session, { status: 'error', reason });
    this.teardown(session);
  }

  private resolveAll(session: Session, outcome: AnswerOutcome): void {
    // settle() mutates session.waiters — iterate a snapshot.
    for (const waiter of [...session.waiters]) waiter.settle(outcome);
  }

  private teardown(session: Session): void {
    if (session.closed) {
      this.sessions.delete(session.exerciseId);
      return;
    }
    session.closed = true;
    const socket = session.socket;
    if (socket) {
      for (const [type, cb] of session.listeners) socket.removeEventListener(type, cb);
      try { socket.close(); } catch { /* already closing */ }
    }
    session.listeners = [];
    session.pendingAudio = [];
    this.sessions.delete(session.exerciseId);
  }
}

// ── Dev-switch: Fake ↔ Real ─────────────────────────────────────────────────
//
// PlayerPage wires ONE `answerSource` prop. Which implementation fills it is a
// build-time switch, NOT a coordinator concern:
//   • DEFAULT (prod today, and every test) = FakeAnswerSource. Deterministic,
//     mic-less, network-less — keeps the existing hands-free demo + the whole
//     799-test suite green, and (critically) makes NO gateway contact. Correct
//     until S3-10 wires the real mic and the owner runs the live E2E: without
//     audio the real source would open a WS to the gateway and just time out.
//   • VITE_SHADOW_REALTIME=1 (or 'true') = RealtimeAnswerSource. The owner flips
//     this for the mic E2E (S3-10/S3-11) behind the barrier. Vite statically
//     replaces import.meta.env at build, so an unset flag compiles to Fake with
//     zero runtime cost.
// Tests bypass the env entirely via forceRealtime/forceFake so they never depend
// on ambient config.

export interface SelectAnswerSourceOptions extends RealtimeAnswerSourceOptions {
  forceRealtime?: boolean;
  forceFake?: boolean;
}

export function isRealtimeAnswerEnabled(): boolean {
  try {
    const env = (import.meta as unknown as { env?: Record<string, unknown> }).env;
    const v = env?.VITE_SHADOW_REALTIME;
    return v === '1' || v === 'true';
  } catch {
    return false;
  }
}

export function selectAnswerSource(opts: SelectAnswerSourceOptions = {}): AnswerSource {
  const { forceRealtime, forceFake, ...rtOpts } = opts;
  const useRealtime = forceRealtime ?? (!forceFake && isRealtimeAnswerEnabled());
  return useRealtime ? new RealtimeAnswerSource(rtOpts) : new FakeAnswerSource();
}
