// loop-outcome.ts — G3+G4 (task #1068): чистое решение, что делать после границы
// петли упражнения, когда вердикт оценки готов (или eval упал/таймаут). Единый
// хозяин рантайма (см. docs/superpowers/designs/2026-06-18-shadow-loop-runtime-handoff.md):
// оценка ГЕЙТИТ рестарт. Чистая функция — без React, юнит-тест.

export interface LoopOutcomeInput {
  /** Вердикт оценщика; 'timeout'/null/undefined = eval не дал результат → restart. */
  decision?: 'pass' | 'retry' | 'replay' | 'timeout' | null;
  /** Процент STT+LLM (0..100). null/undefined/NaN при ошибке/таймауте → restart. */
  score?: number | null;
  /** Включён ли авто-переход (настройка упражнения). */
  advanceEnabled: boolean;
  /** Порог авто-перехода; undefined → не переходим (робастность «порог не задан»). */
  advanceThreshold?: number;
  /** Передышка между петлями (сек, из настроек упражнения). */
  pauseAtEndSec: number;
  /** Сколько мс уже ушло на оценку (засчитывается в передышку, G4). */
  evalElapsedMs: number;
}

export interface LoopOutcome {
  /** advance = снять петлю и идти вперёд за конец отрезка; restart = повторить петлю. */
  action: 'advance' | 'restart';
  /** Сколько ещё ждать перед действием = max(0, pauseAtEnd*1000 − времяОценки). */
  waitMs: number;
}

export function reduceLoopOutcome(inp: LoopOutcomeInput): LoopOutcome {
  // Guard NaN/нечисловые тайминги (FM7: малформный замер времени оценки) → 0,
  // иначе waitMs=NaN → setTimeout(NaN) сработает мгновенно/некорректно.
  const pause = Number.isFinite(inp.pauseAtEndSec) ? inp.pauseAtEndSec : 0;
  const elapsed = Number.isFinite(inp.evalElapsedMs) ? inp.evalElapsedMs : 0;
  const waitMs = Math.max(0, pause * 1000 - elapsed);
  const canAdvance =
    inp.advanceEnabled === true &&
    typeof inp.advanceThreshold === 'number' &&
    typeof inp.score === 'number' &&
    Number.isFinite(inp.score) &&
    inp.score >= inp.advanceThreshold;
  return { action: canAdvance ? 'advance' : 'restart', waitMs };
}
