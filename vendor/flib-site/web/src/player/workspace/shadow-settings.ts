import type { ShadowState, ShadowExerciseAnnotation } from './panel-types';

/** Дефолт передышки (сек) между петлями, когда упражнение её не задаёт.
 *  0 = без доп.паузы (как текущее поведение workspace). speak задаёт 2 в S1. */
export const DEFAULT_EXERCISE_PAUSE_SEC = 0;

/** The persisted settings subset of a shadowing exercise, with defaults RESOLVED
 *  (documentPath: string, pauseAtEnd: number — never undefined → no NaN downstream). */
export type ShadowSettings =
  ShadowExerciseAnnotation['settings'] & { documentPath: string; pauseAtEnd: number };

/**
 * Resolve the settings to use when activating shadowing. With an exercise,
 * its saved settings win (documentPath defaulted to '', pauseAtEnd to
 * DEFAULT_EXERCISE_PAUSE_SEC); without one, the current in-memory ShadowState
 * is used (manual activation — unchanged; pauseAtEnd is a per-exercise/workspace
 * concept, not a ShadowState field, so it resolves to the default).
 */
export function effectiveShadowSettings(
  exercise: ShadowExerciseAnnotation | undefined,
  state: ShadowState,
): ShadowSettings {
  if (exercise) {
    return {
      ...exercise.settings,
      documentPath: exercise.settings.documentPath ?? '',
      pauseAtEnd: exercise.settings.pauseAtEnd ?? DEFAULT_EXERCISE_PAUSE_SEC,
    };
  }
  return {
    loopMode: state.loopMode,
    advanceEnabled: state.advanceEnabled,
    advanceThreshold: state.advanceThreshold,
    mode: state.mode,
    customText: state.customText,
    saveAudio: state.saveAudio,
    engines: state.engines,
    documentPath: state.documentPath,
    pauseAtEnd: DEFAULT_EXERCISE_PAUSE_SEC,
  };
}
