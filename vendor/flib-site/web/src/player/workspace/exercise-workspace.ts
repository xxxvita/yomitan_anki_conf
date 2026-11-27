// exercise-workspace.ts — G2 (task #1068): чистый расчёт параметров workspace
// AB-петли для активируемого shadow-упражнения. Часть «доделать P3b/c»: когда
// упражнение активируется (useShadowAutoStart), workspace заводит петлю по его
// ОТРЕЗКУ согласно настройкам (loopMode/pauseAtEnd). Без React — юнит-тест.
//
// Отрезок берём как [ex.startTime, ex.endTime] (тот же клок, что у region-чека
// useShadowAutoStart: raw currentTime vs raw ex.startTime/endTime). speak-пак с
// offset==0 — точное совпадение; ненулевой subtitle-offset имеет пред-
// существующую region/range рассинхронизацию (вне scope, см. план v2.1).

import type { ShadowExerciseAnnotation } from './panel-types';

export interface ExerciseArmParams {
  rangeStart: number;
  rangeEnd: number;
  looping: boolean;
  pauseAtEnd: number;
  /** Сикать на start ТОЛЬКО если плейхед ВНЕ отрезка; внутри → null (FM8:
   *  не отматывать при линейном просмотре, как toggleABLoop). */
  seekTo: number | null;
}

/**
 * Параметры арминга workspace под отрезок упражнения. resolved — уже
 * разрешённые настройки (effectiveShadowSettings): loopMode + pauseAtEnd.
 * Возвращает null при невалидном отрезке (end<=start).
 */
export function exerciseWorkspaceParams(
  ex: ShadowExerciseAnnotation,
  resolved: { loopMode: boolean; pauseAtEnd: number },
  currentTime: number,
): ExerciseArmParams | null {
  const start = ex.startTime;
  const end = ex.endTime;
  if (!(end > start)) return null;
  // end-EXCLUSIVE, как region-чек useShadowAutoStart (currentTime>=start && <end):
  // на ровно end плейхед «вне» → seek на start (начать петлю с начала отрезка).
  const inside = currentTime >= start && currentTime < end;
  return {
    rangeStart: start,
    rangeEnd: end,
    looping: resolved.loopMode,
    pauseAtEnd: resolved.pauseAtEnd,
    seekTo: inside ? null : start,
  };
}

/**
 * Диапазон A/B-петли для упражнения = его границы. Двойной клик по упражнению в
 * таймлайне ставит A/B ровно сюда (task #1068: магнита нет, ручная установка A/B
 * промахивалась на ±0.1с → плейхед на рестарте выходил за регион, тест моргал).
 * Намеренно ТЕ ЖЕ raw-границы, что rangeStart/rangeEnd у exerciseWorkspaceParams,
 * чтобы ручная установка совпадала со старт-форсом теста.
 */
export function exerciseAbRange(ex: ShadowExerciseAnnotation): { rangeStart: number; rangeEnd: number } {
  return { rangeStart: ex.startTime, rangeEnd: ex.endTime };
}
