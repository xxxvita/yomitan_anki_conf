// @vitest-environment jsdom
// T2 — useAnnotations (lifted verbatim from desktop except the persist-seam
// rewrite — see task-T2-report.md): CRUD, resolveConflicts (lifted scenario
// from desktop useAnnotations.update-conflicts.test.ts, adapted to the
// synchronous AnnotationStore), persist debounce (1000ms, real localStorage —
// no mock, same convention as T-A's annotation-store.test.ts), and G1
// (corrupt-load must NOT initiate a save).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAnnotations } from '../useAnnotations';

const KEY = (videoKey: string) => `flib:shadow-exercises:${videoKey}`;

const settings = {
  loopMode: true, advanceEnabled: true, advanceThreshold: 80,
  mode: 'subtitle' as const, saveAudio: false,
  engines: { asr: 'a', check: 'c', ocr: 'o' },
};

const timeRange = (startTime: number, endTime: number) => ({
  startTime, endTime, anchorMode: 'time-range' as const, settings,
});

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); });

describe('useAnnotations — CRUD', () => {
  // NB: addShadowExercise's RETURN VALUE is not reliable inside the same
  // act() call — `inserted`/`id` are only guaranteed committed to state by
  // the time act() flushes, same quirk desktop's own update-conflicts test
  // documents ("id из состояния... апдейтер, который act флашит ПОСЛЕ
  // возврата вызова"). Read the id back from state, not the call's return.
  it('addShadowExercise adds; deleteShadowExercise removes', () => {
    const { result } = renderHook(() => useAnnotations('/v/x.mp4', [], 0));
    act(() => { result.current.addShadowExercise(timeRange(0, 3)); });
    expect(result.current.shadowExercises).toHaveLength(1);
    const id = result.current.shadowExercises[0].id;
    act(() => { result.current.deleteShadowExercise(id); });
    expect(result.current.shadowExercises).toHaveLength(0);
  });

  it('updateShadowExercise patches fields + bumps updatedAt', () => {
    const { result } = renderHook(() => useAnnotations('/v/x.mp4', [], 0));
    act(() => { result.current.addShadowExercise(timeRange(0, 3)); });
    const id = result.current.shadowExercises[0].id;
    const before = result.current.shadowExercises[0].updatedAt;
    act(() => { vi.advanceTimersByTime(5); }); // fake-timers also freeze Date — advance so updatedAt actually differs
    act(() => { result.current.updateShadowExercise(id, { endTime: 5 }); });
    expect(result.current.shadowExercises[0].endTime).toBe(5);
    expect(result.current.shadowExercises[0].updatedAt).not.toBe(before);
  });

  it('undo/redo restore prior shadowExercises state', () => {
    const { result } = renderHook(() => useAnnotations('/v/x.mp4', [], 0));
    act(() => { result.current.addShadowExercise(timeRange(0, 3)); });
    expect(result.current.shadowExercises).toHaveLength(1);
    act(() => { result.current.undo(); });
    expect(result.current.shadowExercises).toHaveLength(0);
    act(() => { result.current.redo(); });
    expect(result.current.shadowExercises).toHaveLength(1);
  });
});

// Lifted scenario (desktop useAnnotations.update-conflicts.test.ts, audit
// B1/B2): updateShadowExercise({resolveConflicts:true}) must resolve overlaps
// the same way addShadowExercise does — a full-overlap neighbor is dropped
// (and the drop is undoable).
describe('useAnnotations — updateShadowExercise opts.resolveConflicts (lifted B1/B2)', () => {
  it('resolveConflicts:true — a fully-overlapped neighbor is dropped, and the drop is undoable', () => {
    const { result } = renderHook(() => useAnnotations('/v/x.mp4', [], 0));
    act(() => { result.current.addShadowExercise(timeRange(0, 3)); });
    act(() => { result.current.addShadowExercise(timeRange(5, 8), { replaceConflicting: true }); });
    expect(result.current.shadowExercises).toHaveLength(2);
    const movedId = result.current.shadowExercises.find(e => e.startTime === 0)!.id;

    // Move the first exercise to 4..9 — the second (5..8) is now fully inside → dropped.
    act(() => {
      result.current.updateShadowExercise(movedId, { startTime: 4, endTime: 9 }, { resolveConflicts: true });
    });
    expect(result.current.shadowExercises).toHaveLength(1);
    expect(result.current.shadowExercises[0].id).toBe(movedId);
    expect(result.current.shadowExercises[0].startTime).toBe(4);
    expect(result.current.shadowExercises[0].endTime).toBe(9);

    expect(result.current.canUndo).toBe(true);
    act(() => { result.current.undo(); });
    expect(result.current.shadowExercises).toHaveLength(2);
  });

  it('resolveConflicts:false (default) — overlap is left in place (no auto-resolve)', () => {
    const { result } = renderHook(() => useAnnotations('/v/x.mp4', [], 0));
    act(() => { result.current.addShadowExercise(timeRange(0, 3)); });
    act(() => { result.current.addShadowExercise(timeRange(5, 8), { replaceConflicting: true }); });
    const movedId = result.current.shadowExercises.find(e => e.startTime === 0)!.id;
    act(() => { result.current.updateShadowExercise(movedId, { startTime: 4, endTime: 9 }); });
    // No resolveConflicts → both entries persist even though they now overlap.
    expect(result.current.shadowExercises).toHaveLength(2);
  });
});

describe('useAnnotations — WEB-SEAM persist → AnnotationStore (debounced 1000ms)', () => {
  it('a mutation schedules a save that lands in localStorage after 1000ms, keyed by videoPath', () => {
    const { result } = renderHook(() => useAnnotations('vid-persist', [], 0));
    act(() => { result.current.addShadowExercise(timeRange(1, 4)); });
    expect(localStorage.getItem(KEY('vid-persist'))).toBeNull(); // not yet — debounced
    act(() => { vi.advanceTimersByTime(999); });
    expect(localStorage.getItem(KEY('vid-persist'))).toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    const raw = localStorage.getItem(KEY('vid-persist'));
    expect(raw).not.toBeNull();
    const saved = JSON.parse(raw!);
    expect(saved).toHaveLength(1);
    expect(saved[0].startTime).toBe(1);
  });

  it('a fresh mount reloads previously-saved shadowExercises for the same videoPath', () => {
    const { result: r1 } = renderHook(() => useAnnotations('vid-reload', [], 0));
    act(() => { r1.current.addShadowExercise(timeRange(2, 6)); });
    act(() => { vi.advanceTimersByTime(1000); });

    const { result: r2 } = renderHook(() => useAnnotations('vid-reload', [], 0));
    expect(r2.current.shadowExercises).toHaveLength(1);
    expect(r2.current.shadowExercises[0].startTime).toBe(2);
  });
});

describe('useAnnotations — G1 (corrupt load must NOT initiate a save)', () => {
  it('corrupt JSON on disk → empty in-memory shadowExercises, storage left UNTOUCHED (no save)', () => {
    localStorage.setItem(KEY('vid-corrupt'), '{not json');
    const { result } = renderHook(() => useAnnotations('vid-corrupt', [], 0));
    expect(result.current.shadowExercises).toEqual([]);
    // Passive time (no mutation) must not trigger a write — the corrupt entry
    // is still exactly what it was.
    act(() => { vi.advanceTimersByTime(5000); });
    expect(localStorage.getItem(KEY('vid-corrupt'))).toBe('{not json');
  });

  it('after a corrupt load, an explicit mutation DOES persist (deliberate user action, not silent)', () => {
    localStorage.setItem(KEY('vid-corrupt2'), '{not json');
    const { result } = renderHook(() => useAnnotations('vid-corrupt2', [], 0));
    expect(result.current.shadowExercises).toEqual([]);
    act(() => { result.current.addShadowExercise(timeRange(0, 2)); });
    act(() => { vi.advanceTimersByTime(1000); });
    const raw = localStorage.getItem(KEY('vid-corrupt2'));
    expect(raw).not.toBe('{not json');
    expect(JSON.parse(raw!)).toHaveLength(1);
  });

  it('a shape-invalid (non-array) entry is also treated as corrupt (G1), not silently emptied+saved', () => {
    localStorage.setItem(KEY('vid-shape'), JSON.stringify({ not: 'an array' }));
    const { result } = renderHook(() => useAnnotations('vid-shape', [], 0));
    expect(result.current.shadowExercises).toEqual([]);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(localStorage.getItem(KEY('vid-shape'))).toBe(JSON.stringify({ not: 'an array' }));
  });
});

// T2-fix (audit MINOR — safe-degrade on non-corrupt load errors): a load
// failure that ISN'T AnnotationStoreCorruptError (e.g. a SecurityError from
// a locked-down/private-mode localStorage) must not crash the render — it
// used to `throw e` here with no error boundary on this seam.
describe('useAnnotations — non-corrupt load error (T2-fix safe-degrade)', () => {
  it('a SecurityError from localStorage.getItem does not throw, warns, and does not initiate a save', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // vitest.setup.ts backs `localStorage` with an in-memory polyfill class
    // (Node's own global Storage isn't available without --localstorage-file),
    // so the spy target is the polyfill instance itself, not Storage.prototype.
    const getItemSpy = vi.spyOn(globalThis.localStorage, 'getItem').mockImplementation(() => {
      throw new DOMException('access denied', 'SecurityError');
    });
    try {
      expect(() => renderHook(() => useAnnotations('vid-secerr', [], 0))).not.toThrow();
      expect(warn).toHaveBeenCalled();
    } finally {
      getItemSpy.mockRestore();
      warn.mockRestore();
    }
    // No save initiated: nothing was ever written for this key.
    act(() => { vi.advanceTimersByTime(5000); });
    expect(localStorage.getItem(KEY('vid-secerr'))).toBeNull();
  });
});
