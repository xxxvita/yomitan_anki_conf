// restore-batch-guard.test.ts — T2-carry (b): batch-trap guard.
//
// Proves BOTH halves: (1) without the guard, calling resumeFromBoundary
// ('advance') immediately followed — in the SAME synchronous batch — by
// restoreWorkspace({looping:true,...}) leaves the restored loop's boundary
// PERMANENTLY unenforced (boundarySuppressRef never clears); (2) with the
// guard (deferring the looping:true restore to a macrotask), the border
// re-enforces normally afterward. Uses the REAL useWorkspace (T0) + a fake
// adapter — this is exactly the sequence useShadowLoopCoordinator's
// `apply()` → `resumeFromBoundary('advance')` + `endRun` → `restoreWorkspace`
// produces (useShadowLoopCoordinator.ts :485-501), replicated directly here
// without needing the full coordinator.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWorkspace } from '../../hooks/useWorkspace';
import { makeFakeAdapter } from '../../../adapter/__tests__/fake';
import { guardedRestoreWorkspace } from '../restore-batch-guard';

const cues = [{ start: 2, end: 4 }];

afterEach(() => { vi.useRealTimers(); });

describe('WITHOUT the guard (documents the hazard)', () => {
  it('advance + synchronous restore(looping:true) leaves the border unenforced afterward', () => {
    const a = makeFakeAdapter({ t: 2.5 });
    const onLoopBoundary = vi.fn();
    const { result } = renderHook(() =>
      useWorkspace(a, cues, '', false, onLoopBoundary, () => true), // grading-gate always parks
    );
    act(() => { result.current.setABLoop(2, 4); });
    // Reach the boundary → parks (shouldPauseAtBoundary=true).
    act(() => { a._setTime(4.01); result.current._boundaryTickForTest(); });
    expect(onLoopBoundary).toHaveBeenCalledTimes(1);

    // Replicate the coordinator's apply(): resumeFromBoundary('advance') THEN,
    // in the SAME act() batch, restoreWorkspace({looping:true,...}) — NO guard.
    act(() => {
      result.current.resumeFromBoundary('advance');
      result.current.restoreWorkspace({
        rangeStart: 2, rangeEnd: 4, viewStart: 0, viewEnd: 10, looping: true,
      });
    });
    expect(result.current.looping).toBe(true); // loop WAS restored

    // Drive the SAME border again — if boundarySuppressRef stuck true, this
    // silently no-ops (the hazard).
    onLoopBoundary.mockClear();
    act(() => { a._setTime(4.01); result.current._boundaryTickForTest(); });
    expect(onLoopBoundary).not.toHaveBeenCalled(); // hazard reproduced: border dead
  });
});

describe('WITH the guard (T2-carry b fix)', () => {
  it('advance + GUARDED restore(looping:true) re-enforces the border after the deferred macrotask', () => {
    vi.useFakeTimers(); // installed BEFORE the guarded setTimeout(0) is scheduled
    const a = makeFakeAdapter({ t: 2.5 });
    const onLoopBoundary = vi.fn();
    const { result } = renderHook(() =>
      useWorkspace(a, cues, '', false, onLoopBoundary, () => true),
    );
    act(() => { result.current.setABLoop(2, 4); });
    act(() => { a._setTime(4.01); result.current._boundaryTickForTest(); });
    expect(onLoopBoundary).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.resumeFromBoundary('advance');
      guardedRestoreWorkspace(result.current.restoreWorkspace, {
        rangeStart: 2, rangeEnd: 4, viewStart: 0, viewEnd: 10, looping: true,
      });
    });
    // Deferred to a macrotask — not applied yet in this same batch.
    expect(result.current.looping).toBe(false);

    act(() => { vi.advanceTimersByTime(0); });
    expect(result.current.looping).toBe(true); // restored, one tick later

    onLoopBoundary.mockClear();
    act(() => { a._setTime(4.01); result.current._boundaryTickForTest(); });
    expect(onLoopBoundary).toHaveBeenCalledTimes(1); // border re-enforces — fixed
  });

  it('a restore that does NOT reinstate looping applies immediately (no pointless deferred tick)', () => {
    const a = makeFakeAdapter({ t: 2.5 });
    const { result } = renderHook(() => useWorkspace(a, cues, '', false));
    act(() => {
      guardedRestoreWorkspace(result.current.restoreWorkspace, {
        rangeStart: 1, rangeEnd: 3, viewStart: 0, viewEnd: 10, looping: false,
      });
    });
    expect(result.current.rangeStart).toBe(1); // applied synchronously
    expect(result.current.looping).toBe(false);
  });
});

describe('staleness re-check (T2-fix, audit CONFIRMED part a)', () => {
  it('playhead moved past the restored range during the deferred macrotask → does not reinstate looping (no yank-back)', () => {
    vi.useFakeTimers(); // installed BEFORE the guarded setTimeout(0) is scheduled
    const a = makeFakeAdapter({ t: 2.5 });
    const onLoopBoundary = vi.fn();
    const { result } = renderHook(() =>
      useWorkspace(a, cues, '', false, onLoopBoundary, () => true),
    );
    act(() => { result.current.setABLoop(2, 4); });
    act(() => { a._setTime(4.01); result.current._boundaryTickForTest(); });
    expect(onLoopBoundary).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.resumeFromBoundary('advance');
      guardedRestoreWorkspace(
        result.current.restoreWorkspace,
        { rangeStart: 2, rangeEnd: 4, viewStart: 0, viewEnd: 10, looping: true },
        () => a.currentTime(),
      );
    });
    expect(result.current.looping).toBe(false); // still deferred, no commit yet

    // Playhead drifts PAST B (4) while the restore sits in the macrotask
    // queue — simulates a throttled/background tab where playback (or a
    // user scrub) continues during the ≥1s real-world defer delay.
    a._setTime(6);

    act(() => { vi.advanceTimersByTime(0); });
    // Range/view land as a passive bookmark, but looping is NOT reinstated.
    expect(result.current.rangeStart).toBe(2);
    expect(result.current.rangeEnd).toBe(4);
    expect(result.current.looping).toBe(false);

    // No yank-back: with looping false, a boundary tick at the drifted
    // position must not fire at all (nothing to enforce).
    onLoopBoundary.mockClear();
    act(() => { result.current._boundaryTickForTest(); });
    expect(onLoopBoundary).not.toHaveBeenCalled();
  });

  it('playhead still inside the restored range at defer-time → looping IS reinstated (happy path unaffected)', () => {
    vi.useFakeTimers();
    const a = makeFakeAdapter({ t: 2.5 });
    const onLoopBoundary = vi.fn();
    const { result } = renderHook(() =>
      useWorkspace(a, cues, '', false, onLoopBoundary, () => true),
    );
    act(() => { result.current.setABLoop(2, 4); });
    act(() => { a._setTime(3); }); // still inside [2,4) when the restore fires

    act(() => {
      guardedRestoreWorkspace(
        result.current.restoreWorkspace,
        { rangeStart: 2, rangeEnd: 4, viewStart: 0, viewEnd: 10, looping: true },
        () => a.currentTime(),
      );
    });
    act(() => { vi.advanceTimersByTime(0); });
    expect(result.current.looping).toBe(true);
  });
});
