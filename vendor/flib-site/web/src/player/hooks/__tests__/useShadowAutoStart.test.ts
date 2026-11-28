// @vitest-environment jsdom
// T2 — lifted verbatim from desktop useShadowAutoStart.test.ts (only path
// changes: './useShadowAutoStart' → '../useShadowAutoStart', '../types' →
// '../../workspace/panel-types'). Covers reduceShadowAutoStart (required
// table test, task-T2-brief.md item 1) + the useShadowAutoStart hook's
// onArm/onLeave (G2) wiring.
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { reduceShadowAutoStart, useShadowAutoStart, type AutoStartState, type AutoStartTick } from '../useShadowAutoStart';
import type { ShadowExerciseAnnotation } from '../../workspace/panel-types';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeExercise(
  id: string,
  startTime: number,
  endTime: number,
): ShadowExerciseAnnotation {
  return {
    id,
    startTime,
    endTime,
    anchorMode: 'time-range',
    settings: {
      loopMode: true,
      advanceEnabled: true,
      advanceThreshold: 80,
      mode: 'subtitle',
      saveAudio: false,
      engines: { asr: 'whisper-local', check: 'llm-local', ocr: 'llm-local' },
    },
    createdAt: '2026-05-19T00:00:00Z',
    updatedAt: '2026-05-19T00:00:00Z',
  };
}

const IDLE_STATE: AutoStartState = { armedId: null, suppressedId: null };

function tick(overrides: Partial<AutoStartTick>): AutoStartTick {
  return {
    currentTime: 0,
    exercises: [],
    shadowActive: false,
    ...overrides,
  };
}

// ── tests ────────────────────────────────────────────────────────────────────

describe('reduceShadowAutoStart', () => {
  const ex1 = makeExercise('e1', 10, 20);
  const ex2 = makeExercise('e2', 30, 40);

  // ── 1. Playhead enters a region while idle ──────────────────────────────

  it('entering a region while idle → activate + armedId set', () => {
    const { next, action } = reduceShadowAutoStart(IDLE_STATE, tick({
      currentTime: 12,
      exercises: [ex1],
      shadowActive: false,
    }));
    expect(action).toEqual({ type: 'activate', exercise: ex1 });
    expect(next.armedId).toBe('e1');
    expect(next.suppressedId).toBeNull();
  });

  // ── 2. Inside a region with shadow already active (armed) ───────────────

  it('inside armed region + shadow active → none', () => {
    const armed: AutoStartState = { armedId: 'e1', suppressedId: null };
    const { next, action } = reduceShadowAutoStart(armed, tick({
      currentTime: 15,
      exercises: [ex1],
      shadowActive: true,
    }));
    expect(action).toEqual({ type: 'none' });
    expect(next.armedId).toBe('e1');
  });

  // ── 3. Playhead leaves the region while the armed exercise is active ────

  it('leaving armed region while shadow active → deactivate + armedId cleared', () => {
    const armed: AutoStartState = { armedId: 'e1', suppressedId: null };
    const { next, action } = reduceShadowAutoStart(armed, tick({
      currentTime: 25,      // outside [10,20)
      exercises: [ex1],
      shadowActive: true,
    }));
    expect(action).toEqual({ type: 'deactivate' });
    expect(next.armedId).toBeNull();
    expect(next.suppressedId).toBeNull();
  });

  // ── 3b. Недолёт seek-в-A: плейхед на волосок РАНЬШЕ старта (task #1068) ──
  // Рестарт петли сикает в A=startTime, но видео рапортует currentTime на sub-frame
  // меньше цели (напр. 9.97 вместо 10.0). Строгий `>= startTime` считал бы это
  // выходом → teardown истории + второй отсчёт. Допуск ε держит арм.

  it('недолёт в A (currentTime чуть < startTime, в пределах ε) → НЕ deactivate', () => {
    const armed: AutoStartState = { armedId: 'e1', suppressedId: null };
    const { next, action } = reduceShadowAutoStart(armed, tick({
      currentTime: 9.97,    // 0.03с до старта [10,20) — sub-frame-недолёт seek-в-A
      exercises: [ex1],
      shadowActive: true,
    }));
    expect(action).toEqual({ type: 'none' });
    expect(next.armedId).toBe('e1');
  });

  it('реальный уход ДО старта (за пределами ε) → deactivate', () => {
    const armed: AutoStartState = { armedId: 'e1', suppressedId: null };
    const { action } = reduceShadowAutoStart(armed, tick({
      currentTime: 9.0,     // 1.0с до старта — осознанный уход, не недолёт
      exercises: [ex1],
      shadowActive: true,
    }));
    expect(action).toEqual({ type: 'deactivate' });
  });

  // ── 4. Playhead outside all regions, idle ──────────────────────────────

  it('outside all regions while idle → none', () => {
    const { next, action } = reduceShadowAutoStart(IDLE_STATE, tick({
      currentTime: 5,
      exercises: [ex1, ex2],
      shadowActive: false,
    }));
    expect(action).toEqual({ type: 'none' });
    expect(next).toEqual(IDLE_STATE);
  });

  // ── 5. Manual close: armed + shadowActive flips false while inside ──────

  it('manual close while inside armed region → armedId cleared, suppressedId set, none', () => {
    const armed: AutoStartState = { armedId: 'e1', suppressedId: null };
    const { next, action } = reduceShadowAutoStart(armed, tick({
      currentTime: 15,      // still inside [10,20)
      exercises: [ex1],
      shadowActive: false,  // user manually closed
    }));
    expect(action).toEqual({ type: 'none' });
    expect(next.armedId).toBeNull();
    expect(next.suppressedId).toBe('e1');
  });

  // ── 6. Suppressed: playhead still inside the suppressed region, idle ────

  it('suppressed region: still inside + idle → none (NOT re-activated)', () => {
    const suppressed: AutoStartState = { armedId: null, suppressedId: 'e1' };
    const { next, action } = reduceShadowAutoStart(suppressed, tick({
      currentTime: 15,
      exercises: [ex1],
      shadowActive: false,
    }));
    expect(action).toEqual({ type: 'none' });
    expect(next.suppressedId).toBe('e1');   // suppression still held
    expect(next.armedId).toBeNull();
  });

  // ── 7. Suppression lifts: playhead leaves, then re-enters ───────────────

  it('leaving suppressed region → suppressedId cleared', () => {
    const suppressed: AutoStartState = { armedId: null, suppressedId: 'e1' };
    const { next, action } = reduceShadowAutoStart(suppressed, tick({
      currentTime: 25,      // outside [10,20)
      exercises: [ex1],
      shadowActive: false,
    }));
    expect(action).toEqual({ type: 'none' });
    expect(next.suppressedId).toBeNull();   // suppression lifted
  });

  it('after suppression lifts, re-entering region → activate again', () => {
    // Step 1: leave the suppressed region → suppression cleared
    const suppressed: AutoStartState = { armedId: null, suppressedId: 'e1' };
    const step1 = reduceShadowAutoStart(suppressed, tick({
      currentTime: 25,
      exercises: [ex1],
      shadowActive: false,
    }));
    expect(step1.next.suppressedId).toBeNull();

    // Step 2: re-enter the region → should activate
    const step2 = reduceShadowAutoStart(step1.next, tick({
      currentTime: 12,
      exercises: [ex1],
      shadowActive: false,
    }));
    expect(step2.action).toEqual({ type: 'activate', exercise: ex1 });
    expect(step2.next.armedId).toBe('e1');
  });

  // ── 8. Manual activation ARMS the exercise (Live-fix F#2, task #1068) ────

  it('manually-started shadow (armedId=null) inside a region → arm (onArm без activate)', () => {
    // Владелец включает Shadowing вручную (S) ДО въезда в упражнение → shadowActive=true,
    // armedId=null. Раньше watcher не вмешивался (none) → координатор не армился → ни петли,
    // ни грейдинга, ни отсчёта. Теперь: вход в регион при активном shadow → 'arm' (onArm
    // БЕЗ повторного activate — shadow уже слушает). armedId выставляется.
    const noArm: AutoStartState = { armedId: null, suppressedId: null };
    const { next, action } = reduceShadowAutoStart(noArm, tick({
      currentTime: 15,
      exercises: [ex1],
      shadowActive: true,
    }));
    expect(action).toEqual({ type: 'arm', exercise: ex1 });
    expect(next.armedId).toBe('e1');
    expect(next.suppressedId).toBeNull();
  });

  it('manual shadow active, OUTSIDE all regions → none (нечего армить)', () => {
    const noArm: AutoStartState = { armedId: null, suppressedId: null };
    const { next, action } = reduceShadowAutoStart(noArm, tick({
      currentTime: 25,      // outside [10,20)
      exercises: [ex1],
      shadowActive: true,
    }));
    expect(action).toEqual({ type: 'none' });
    expect(next.armedId).toBeNull();
  });

  it('arm-путь уважает suppression: manual active + в подавленном регионе → none', () => {
    // Ручное закрытие подавило e1; повторное включение shadow (S) внутри того же
    // региона НЕ переармливает, пока плейхед не покинет регион.
    const suppressed: AutoStartState = { armedId: null, suppressedId: 'e1' };
    const { next, action } = reduceShadowAutoStart(suppressed, tick({
      currentTime: 15,
      exercises: [ex1],
      shadowActive: true,
    }));
    expect(action).toEqual({ type: 'none' });
    expect(next.armedId).toBeNull();
    expect(next.suppressedId).toBe('e1');
  });

  // ── 9. Boundary conditions ───────────────────────────────────────────────

  it('playhead exactly at startTime → inside region → activate', () => {
    const { action } = reduceShadowAutoStart(IDLE_STATE, tick({
      currentTime: 10,      // == startTime (inclusive)
      exercises: [ex1],
      shadowActive: false,
    }));
    expect(action.type).toBe('activate');
  });

  it('playhead exactly at endTime → outside region → none', () => {
    const { action } = reduceShadowAutoStart(IDLE_STATE, tick({
      currentTime: 20,      // == endTime (exclusive)
      exercises: [ex1],
      shadowActive: false,
    }));
    expect(action.type).toBe('none');
  });

  // ── 10. Multiple exercises ───────────────────────────────────────────────

  it('two exercises: activates the one the playhead is in', () => {
    const { action } = reduceShadowAutoStart(IDLE_STATE, tick({
      currentTime: 35,
      exercises: [ex1, ex2],
      shadowActive: false,
    }));
    expect(action).toEqual({ type: 'activate', exercise: ex2 });
  });

  it('armed on ex1, playhead moves to ex2 region while active → deactivate (leaving ex1)', () => {
    const armed: AutoStartState = { armedId: 'e1', suppressedId: null };
    const { next, action } = reduceShadowAutoStart(armed, tick({
      currentTime: 35,      // in ex2, not ex1
      exercises: [ex1, ex2],
      shadowActive: true,
    }));
    // Watcher deactivates because playhead left the armed (ex1) exercise.
    expect(action).toEqual({ type: 'deactivate' });
    expect(next.armedId).toBeNull();
  });
});

// ── useShadowAutoStart hook: onArm/onLeave (G2) ──────────────────────────────
describe('useShadowAutoStart hook — onArm/onLeave (G2)', () => {
  const ex1 = makeExercise('e1', 10, 20);

  it('активация упражнения → onArm(exercise) рядом с activate', () => {
    const activate = vi.fn();
    const deactivate = vi.fn();
    const onArm = vi.fn();
    const { rerender } = renderHook(
      ({ t, active }) => useShadowAutoStart({
        currentTime: t, exercises: [ex1], shadowActive: active,
        activate, deactivate, onArm,
      }),
      { initialProps: { t: 5, active: false } },
    );
    act(() => { rerender({ t: 12, active: false }); }); // вошёл в [10,20)
    expect(activate).toHaveBeenCalledWith(ex1);
    expect(onArm).toHaveBeenCalledWith(ex1);
  });

  it('выход из армед-региона → onLeave(armedId) рядом с deactivate', () => {
    const activate = vi.fn();
    const deactivate = vi.fn();
    const onLeave = vi.fn();
    const { rerender } = renderHook(
      ({ t, active }) => useShadowAutoStart({
        currentTime: t, exercises: [ex1], shadowActive: active,
        activate, deactivate, onLeave,
      }),
      { initialProps: { t: 5, active: false } },
    );
    act(() => { rerender({ t: 12, active: false }); }); // вошёл → armed e1
    act(() => { rerender({ t: 25, active: true }); });   // вышел, shadow active → deactivate
    expect(deactivate).toHaveBeenCalled();
    expect(onLeave).toHaveBeenCalledWith('e1');
  });

  it('manual-close (shadowActive→false внутри региона) → onLeave НЕ фаерит (контракт)', () => {
    const activate = vi.fn();
    const deactivate = vi.fn();
    const onArm = vi.fn();
    const onLeave = vi.fn();
    const { rerender } = renderHook(
      ({ t, active }) => useShadowAutoStart({
        currentTime: t, exercises: [ex1], shadowActive: active,
        activate, deactivate, onArm, onLeave,
      }),
      { initialProps: { t: 5, active: false } },
    );
    act(() => { rerender({ t: 12, active: false }); }); // вошёл → armed
    act(() => { rerender({ t: 13, active: true }); });   // inside + active → none
    act(() => { rerender({ t: 14, active: false }); });  // ручное закрытие внутри → none
    expect(deactivate).not.toHaveBeenCalled();
    expect(onLeave).not.toHaveBeenCalled(); // координатор сам ловит shadowActive
  });

  it('manual shadow (active с самого начала) входит в регион → onArm без activate (F#2)', () => {
    const activate = vi.fn();
    const deactivate = vi.fn();
    const onArm = vi.fn();
    const { rerender } = renderHook(
      ({ t, active }) => useShadowAutoStart({
        currentTime: t, exercises: [ex1], shadowActive: active,
        activate, deactivate, onArm,
      }),
      { initialProps: { t: 5, active: true } },  // shadow включён вручную ДО входа
    );
    act(() => { rerender({ t: 12, active: true }); }); // вошёл в [10,20) при активном shadow
    expect(onArm).toHaveBeenCalledWith(ex1);
    expect(activate).not.toHaveBeenCalled(); // shadow уже слушает — не переактивируем
  });

  it('manual-armed выход из региона → deactivate + onLeave (shadow off, как в speak)', () => {
    const activate = vi.fn();
    const deactivate = vi.fn();
    const onArm = vi.fn();
    const onLeave = vi.fn();
    const { rerender } = renderHook(
      ({ t, active }) => useShadowAutoStart({
        currentTime: t, exercises: [ex1], shadowActive: active,
        activate, deactivate, onArm, onLeave,
      }),
      { initialProps: { t: 5, active: true } },
    );
    act(() => { rerender({ t: 12, active: true }); }); // вошёл при активном shadow → arm e1
    expect(onArm).toHaveBeenCalledWith(ex1);
    act(() => { rerender({ t: 25, active: true }); });  // вышел → deactivate + onLeave
    expect(deactivate).toHaveBeenCalled();
    expect(onLeave).toHaveBeenCalledWith('e1');
  });

  it('onArm/onLeave опциональны — без них хук работает как раньше', () => {
    const activate = vi.fn();
    const deactivate = vi.fn();
    const { rerender } = renderHook(
      ({ t, active }) => useShadowAutoStart({
        currentTime: t, exercises: [ex1], shadowActive: active, activate, deactivate,
      }),
      { initialProps: { t: 5, active: false } },
    );
    act(() => { rerender({ t: 12, active: false }); });
    expect(activate).toHaveBeenCalledWith(ex1); // не падает без onArm/onLeave
  });
});
