import { useEffect, useRef } from 'react';
// WEB-SEAM: import-path reprice only (T2 §3.1) — '../types' (desktop) → T1's
// type-merged panel-types.ts. No other change in this file (verbatim cp).
import type { ShadowExerciseAnnotation } from '../workspace/panel-types';

export interface AutoStartState {
  armedId: string | null;       // id of the exercise the watcher auto-started (null = none)
  suppressedId: string | null;  // id suppressed after a manual close, until the playhead leaves it
}

export type AutoStartAction =
  | { type: 'none' }
  | { type: 'activate'; exercise: ShadowExerciseAnnotation }
  /** Live-fix F#2 (task #1068): shadow УЖЕ активен (включён вручную буквой S), а
   *  плейхед только что въехал в регион упражнения. Армим координатор (onArm) БЕЗ
   *  повторного activate — микрофон уже слушает. */
  | { type: 'arm'; exercise: ShadowExerciseAnnotation }
  | { type: 'deactivate' };

export interface AutoStartTick {
  currentTime: number;
  exercises: ShadowExerciseAnnotation[];
  shadowActive: boolean;
}

// task #1068: допуск на границе СТАРТА упражнения. Рестарт петли сикает в
// A=startTime, но видео рапортует currentTime на sub-frame МЕНЬШЕ цели (напр.
// 9.97 вместо 10.0). Строгий `>= startTime` считал бы это выходом → teardown
// истории + второй отсчёт (плейхед «прыгнул в A, а она за границей»). ε держит
// seek-в-A «внутри». Меньше любого зазора между упражнениями, больше недолёта.
// На конец (end) допуск НЕ нужен — там граница петли/eval разруливается отдельно.
export const EXERCISE_START_EPS = 0.05;

/** Pure state machine for playhead-driven shadowing auto-start. */
export function reduceShadowAutoStart(
  prev: AutoStartState,
  tick: AutoStartTick,
): { next: AutoStartState; action: AutoStartAction } {
  const cur = tick.exercises.find(
    e => tick.currentTime >= e.startTime - EXERCISE_START_EPS && tick.currentTime < e.endTime,
  ) ?? null;
  const next: AutoStartState = { ...prev };
  let action: AutoStartAction = { type: 'none' };

  // 1. Resolve the armed exercise's fate.
  if (prev.armedId !== null) {
    const inArmed = cur !== null && cur.id === prev.armedId;
    if (tick.shadowActive) {
      if (!inArmed) {
        // Playhead left the armed exercise while it was still running.
        action = { type: 'deactivate' };
        next.armedId = null;
      }
      // else: still inside + running → leave it.
    } else {
      // Shadowing went inactive on its own.
      if (inArmed) {
        // User manually closed it while still inside → suppress re-trigger.
        next.suppressedId = prev.armedId;
      }
      next.armedId = null;
    }
  }

  // 2. Lift suppression once the playhead is no longer in the suppressed region.
  if (next.suppressedId !== null && (cur === null || cur.id !== next.suppressedId)) {
    next.suppressedId = null;
  }

  // 3. Entering a region (not suppressed, nothing armed yet).
  //    - shadow idle  → 'activate' (start shadowing + arm the coordinator)
  //    - shadow active → 'arm' (Live-fix F#2: user pressed S manually before the
  //      playhead reached the exercise; just arm — the mic is already listening).
  if (
    action.type === 'none' &&
    cur !== null &&
    next.armedId === null &&
    next.suppressedId !== cur.id
  ) {
    action = tick.shadowActive
      ? { type: 'arm', exercise: cur }
      : { type: 'activate', exercise: cur };
    next.armedId = cur.id;
  }

  return { next, action };
}

export interface UseShadowAutoStartArgs {
  currentTime: number;
  exercises: ShadowExerciseAnnotation[];
  shadowActive: boolean;
  activate: (exercise: ShadowExerciseAnnotation) => void;
  deactivate: () => void;
  /**
   * G2 (task #1068): упражнение АКТИВИРОВАНО — единый сигнал «какое упражнение
   * сейчас активно» (useShadowAutoStart = единый источник). Координатор армит по
   * нему workspace AB-петлю (exerciseWorkspaceParams → restoreWorkspace). Опц.
   */
  onArm?: (exercise: ShadowExerciseAnnotation) => void;
  /**
   * G2: упражнение ПОКИНУТО (playhead вышел из армед-региона → действие
   * 'deactivate'). Координатор решает restore player-snapshot / neutral.
   * ВНИМАНИЕ: при РУЧНОМ закрытии shadow внутри региона редьюсер даёт 'none'
   * (armedId чистится, suppressedId ставится) — onLeave тут НЕ фаерит. Координатор
   * должен сам ловить «shadow стал inactive пока workspace армлен» (по shadowActive)
   * и разармливать. Передаётся id покинутого упражнения. Опц.
   */
  onLeave?: (armedId: string) => void;
}

/** Watches the playhead and auto-starts/stops shadowing exercises. */
export function useShadowAutoStart(args: UseShadowAutoStartArgs): void {
  const stateRef = useRef<AutoStartState>({ armedId: null, suppressedId: null });
  // Stash non-primitive args in refs — only primitives go in the effect deps.
  const exercisesRef = useRef(args.exercises); exercisesRef.current = args.exercises;
  const activateRef = useRef(args.activate); activateRef.current = args.activate;
  const deactivateRef = useRef(args.deactivate); deactivateRef.current = args.deactivate;
  const onArmRef = useRef(args.onArm); onArmRef.current = args.onArm;
  const onLeaveRef = useRef(args.onLeave); onLeaveRef.current = args.onLeave;

  useEffect(() => {
    const prevArmedId = stateRef.current.armedId; // упражнение, которое МОГ покинуть
    const { next, action } = reduceShadowAutoStart(stateRef.current, {
      currentTime: args.currentTime,
      exercises: exercisesRef.current,
      shadowActive: args.shadowActive,
    });
    stateRef.current = next;
    if (action.type === 'activate') {
      activateRef.current(action.exercise);
      onArmRef.current?.(action.exercise); // G2: координатор армит workspace
    } else if (action.type === 'arm') {
      // F#2: shadow уже слушает (ручной S) — только армим координатор, без activate.
      onArmRef.current?.(action.exercise);
    } else if (action.type === 'deactivate') {
      deactivateRef.current();
      if (prevArmedId !== null) onLeaveRef.current?.(prevArmedId); // G2: покинуто
    }
  }, [args.currentTime, args.shadowActive]);
}
