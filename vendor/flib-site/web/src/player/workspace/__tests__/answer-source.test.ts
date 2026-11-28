// answer-source.test.ts — T-ANS unit tests for the AnswerSource contract:
// FakeAnswerSource forces each of the 5 outcomes deterministically, honours
// the fixed 3000ms budget for `timeout` (fake-timers), and
// finalizeLoopFromAnswerSource collapses the 5-status AnswerOutcome into the
// coordinator's `string | null` finalizeLoop shape correctly while still
// surfacing the full outcome via onOutcome (the T3/T7 seam).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  FakeAnswerSource,
  DEFAULT_ANSWER_BUDGET_MS,
  finalizeLoopFromAnswerSource,
  type AnswerOutcome,
  type AnswerOutcomeEvent,
} from '../answer-source';

describe('FakeAnswerSource — default behaviour', () => {
  it('resolves to a deterministic final outcome by default (no force)', async () => {
    const src = new FakeAnswerSource();
    const outcome = await src.awaitAnswerByBoundary('ex1', DEFAULT_ANSWER_BUDGET_MS);
    expect(outcome).toEqual({ status: 'final', text: 'the quick brown fox', marks: undefined });
  });

  it('honours a custom canonicalText/canonicalMarks', async () => {
    const marks = [{ w: 'hi', kind: 'ok' as const }];
    const src = new FakeAnswerSource({ canonicalText: 'hi there', canonicalMarks: marks });
    const outcome = await src.awaitAnswerByBoundary('ex1', 3000);
    expect(outcome).toEqual({ status: 'final', text: 'hi there', marks });
  });

  it('tracks calls (exerciseId + budgetMs) for every invocation', async () => {
    const src = new FakeAnswerSource();
    await src.awaitAnswerByBoundary('ex1', 3000);
    await src.awaitAnswerByBoundary('ex2', 1500);
    expect(src.calls).toEqual([
      { exerciseId: 'ex1', budgetMs: 3000 },
      { exerciseId: 'ex2', budgetMs: 1500 },
    ]);
  });
});

describe('FakeAnswerSource — forcing each of the 5 outcomes deterministically', () => {
  const cases: AnswerOutcome[] = [
    { status: 'final', text: 'hello world' },
    { status: 'no-response', reason: 'no-connection' },
    { status: 'no-response', reason: 'no-audio' },
    { status: 'error', reason: 'gateway 502' },
    { status: 'non-final', partial: 'hel' },
  ];

  for (const outcome of cases) {
    it(`setForced(${JSON.stringify(outcome)}) → every call resolves to it`, async () => {
      const src = new FakeAnswerSource();
      src.setForced(outcome);
      expect(await src.awaitAnswerByBoundary('ex1', 3000)).toEqual(outcome);
      expect(await src.awaitAnswerByBoundary('ex1', 3000)).toEqual(outcome); // persists
    });
  }

  it('forceOnce applies to exactly the next call, then reverts to default', async () => {
    const src = new FakeAnswerSource();
    src.forceOnce({ status: 'error', reason: 'boom' });
    expect(await src.awaitAnswerByBoundary('ex1', 3000)).toEqual({ status: 'error', reason: 'boom' });
    expect(await src.awaitAnswerByBoundary('ex1', 3000)).toEqual({
      status: 'final', text: 'the quick brown fox', marks: undefined,
    });
  });

  it('forceOnce takes priority over a persistent setForced', async () => {
    const src = new FakeAnswerSource();
    src.setForced({ status: 'no-response', reason: 'no-audio' });
    src.forceOnce({ status: 'non-final', partial: 'par' });
    expect(await src.awaitAnswerByBoundary('ex1', 3000)).toEqual({ status: 'non-final', partial: 'par' });
    // reverts to the persistent force, not the bare default
    expect(await src.awaitAnswerByBoundary('ex1', 3000)).toEqual({ status: 'no-response', reason: 'no-audio' });
  });

  it('clearForce() restores the deterministic default', async () => {
    const src = new FakeAnswerSource();
    src.setForced({ status: 'error', reason: 'x' });
    src.clearForce();
    expect(await src.awaitAnswerByBoundary('ex1', 3000)).toEqual({
      status: 'final', text: 'the quick brown fox', marks: undefined,
    });
  });
});

describe('FakeAnswerSource — timeout honours the budget for real (fake-timers)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('does NOT resolve at budgetMs-1ms, DOES resolve at exactly budgetMs (3000ms)', async () => {
    const src = new FakeAnswerSource();
    src.setForced({ status: 'timeout', partial: 'hel' });

    let resolved: AnswerOutcome | null = null;
    const p = src.awaitAnswerByBoundary('ex1', 3000).then(o => { resolved = o; });

    await vi.advanceTimersByTimeAsync(2999);
    expect(resolved).toBeNull();

    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(resolved).toEqual({ status: 'timeout', partial: 'hel' });
  });
});

describe('FIX F4 — finalizeLoopFromAnswerSource enforces budgetMs BY CONSTRUCTION, not by trusting the source', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('a source hung LONGER than budgetMs is timed out by the adapter at exactly 3000ms, and the source is aborted', async () => {
    const src = new FakeAnswerSource();
    src.hang(10_000); // far past the 3000ms budget — a real bug or a slow network
    const adapter = finalizeLoopFromAnswerSource(src, () => 'ex1', 3000);

    let result: string | null | 'pending' = 'pending';
    const p = adapter(new AbortController().signal).then(r => { result = r; });

    await vi.advanceTimersByTimeAsync(2999);
    expect(result).toBe('pending'); // NOT resolved yet — the source is still "hanging"

    await vi.advanceTimersByTimeAsync(1); // exactly 3000ms total
    await p;
    expect(result).toBeNull(); // timeout collapses to null, same as any other non-final status
    expect(src.abortedCalls).toEqual(['ex1']); // the source was actually told to stop
  });

  it('existing 2999ms/3000ms FakeAnswerSource-forced timeout behaviour is unaffected by the adapter-side enforcement', async () => {
    const src = new FakeAnswerSource();
    src.setForced({ status: 'timeout', partial: 'hel' });
    const adapter = finalizeLoopFromAnswerSource(src, () => 'ex1', 3000);

    let result: string | null | 'pending' = 'pending';
    const p = adapter(new AbortController().signal).then(r => { result = r; });

    await vi.advanceTimersByTimeAsync(2999);
    expect(result).toBe('pending');

    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(result).toBeNull();
  });
});

describe('finalizeLoopFromAnswerSource — adapter to the coordinator finalizeLoop slot', () => {
  it('final → returns the text', async () => {
    const src = new FakeAnswerSource({ canonicalText: 'canon text' });
    const adapter = finalizeLoopFromAnswerSource(src, () => 'ex1', 3000);
    const ctrl = new AbortController();
    expect(await adapter(ctrl.signal)).toBe('canon text');
  });

  it('every non-final status → null (coordinator treats null as "threshold not reached")', async () => {
    const cases: AnswerOutcome[] = [
      { status: 'no-response', reason: 'no-connection' },
      { status: 'no-response', reason: 'no-audio' },
      { status: 'error', reason: 'boom' },
      { status: 'non-final', partial: 'par' },
    ];
    for (const outcome of cases) {
      const src = new FakeAnswerSource();
      src.setForced(outcome);
      const adapter = finalizeLoopFromAnswerSource(src, () => 'ex1', 3000);
      const ctrl = new AbortController();
      expect(await adapter(ctrl.signal)).toBeNull();
    }
  });

  it('already-aborted signal short-circuits to null WITHOUT calling the source', async () => {
    const src = new FakeAnswerSource();
    const spy = vi.spyOn(src, 'awaitAnswerByBoundary');
    const adapter = finalizeLoopFromAnswerSource(src, () => 'ex1', 3000);
    const ctrl = new AbortController();
    ctrl.abort();
    expect(await adapter(ctrl.signal)).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('passes exerciseId (lazily, from the getter) and budgetMs through to the source', async () => {
    const src = new FakeAnswerSource();
    let currentId = 'ex1';
    const adapter = finalizeLoopFromAnswerSource(src, () => currentId, 1234);
    await adapter(new AbortController().signal);
    currentId = 'ex2';
    await adapter(new AbortController().signal);
    expect(src.calls).toEqual([
      { exerciseId: 'ex1', budgetMs: 1234 },
      { exerciseId: 'ex2', budgetMs: 1234 },
    ]);
  });

  it('onOutcome (WEB-SEAM: outcome render → T3/T7) fires with the FULL AnswerOutcome for every status, including final', async () => {
    const seen: AnswerOutcomeEvent[] = [];
    const src = new FakeAnswerSource();
    const adapter = finalizeLoopFromAnswerSource(src, () => 'ex1', 3000, {
      onOutcome: (e) => seen.push(e),
    });

    await adapter(new AbortController().signal); // default final
    src.setForced({ status: 'non-final', partial: 'par' });
    await adapter(new AbortController().signal);

    expect(seen).toEqual([
      { exerciseId: 'ex1', outcome: { status: 'final', text: 'the quick brown fox', marks: undefined } },
      { exerciseId: 'ex1', outcome: { status: 'non-final', partial: 'par' } },
    ]);
  });

  it('FIX F3: onOutcome payload carries exerciseId (identification for a future T3/T7 stale filter)', async () => {
    const seen: AnswerOutcomeEvent[] = [];
    const src = new FakeAnswerSource({ canonicalText: 'hi' });
    const adapter = finalizeLoopFromAnswerSource(src, () => 'ex42', 3000, {
      onOutcome: (e) => seen.push(e),
    });
    await adapter(new AbortController().signal);
    expect(seen).toEqual([
      { exerciseId: 'ex42', outcome: { status: 'final', text: 'hi', marks: undefined } },
    ]);
  });

  it('FIX F3: onOutcome does NOT fire when the outer signal aborts before the race settles (stale outcome)', async () => {
    const src = new FakeAnswerSource();
    const seen: AnswerOutcomeEvent[] = [];
    const adapter = finalizeLoopFromAnswerSource(src, () => 'ex1', 3000, {
      onOutcome: (e) => seen.push(e),
    });
    const ctrl = new AbortController();
    const p = adapter(ctrl.signal);
    ctrl.abort(); // coordinator moved on (its own eval-timeout / unmount) before the race settled
    const result = await p;
    expect(result).toBeNull();
    expect(seen).toEqual([]);
  });

  it('FIX F2: error outcome is never silent — console.warn fires with the reason before collapsing to null', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const src = new FakeAnswerSource();
    src.setForced({ status: 'error', reason: 'gateway 502' });
    const adapter = finalizeLoopFromAnswerSource(src, () => 'ex1', 3000);
    const result = await adapter(new AbortController().signal);
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('gateway 502'));
    warnSpy.mockRestore();
  });

  it('FIX F2: no-response outcome also warns (recommended — not silently swallowed either)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const src = new FakeAnswerSource();
    src.setForced({ status: 'no-response', reason: 'no-connection' });
    const adapter = finalizeLoopFromAnswerSource(src, () => 'ex1', 3000);
    const result = await adapter(new AbortController().signal);
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('no-connection'));
    warnSpy.mockRestore();
  });

  it('uses DEFAULT_ANSWER_BUDGET_MS (3000) when budgetMs is not passed explicitly', async () => {
    const src = new FakeAnswerSource();
    const adapter = finalizeLoopFromAnswerSource(src, () => 'ex1');
    await adapter(new AbortController().signal);
    expect(src.calls).toEqual([{ exerciseId: 'ex1', budgetMs: 3000 }]);
    expect(DEFAULT_ANSWER_BUDGET_MS).toBe(3000);
  });
});
