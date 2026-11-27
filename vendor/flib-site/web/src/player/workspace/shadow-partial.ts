// shadow-partial.ts — Срез D: чистый фильтр «живого партиала» по армленному
// упражнению. Вынесен из PlayerPage АДДИТИВНО (тот же идиом, что shadow-phase.ts
// / shadow-attempts-accumulate.ts) для РЕАЛЬНОЙ мутационной проверки без
// монтирования страницы.
//
// RealtimeAnswerSource эмитит onPartial(exerciseId, text) на КАЖДОМ partial_
// transcript. Сессии живут per-exercise и не закрываются на границе (continuous-
// listen), поэтому при быстром re-arm партиал СТАРОЙ (ещё не закрытой) сессии
// может прилететь ПОСЛЕ того, как армлено уже другое упражнение. Показывать его
// в карточке нельзя — он относится к прошлой попытке. Фильтр отбрасывает всё, чей
// exerciseId не совпадает с ТЕКУЩИМ армленным (armedSegmentId() — синхронная
// правда координатора).

/**
 * Возвращает текст партиала, если он относится к текущему армленному упражнению,
 * иначе `null` (игнорировать — НЕ обновлять отображаемый partialText).
 *
 * `''` (пустая строка) для армленного упражнения — ЛЕГИТИМНОЕ значение (сессия
 * очистила интерим на commit/reset), отличимое от reject-`null`: вызывающий
 * трактует `null` как «оставить прежнее», а `''` как «показать пусто».
 */
export function acceptArmedPartial(
  incomingExerciseId: string,
  armedExerciseId: string | null,
  text: string,
): string | null {
  if (armedExerciseId == null) return null
  if (incomingExerciseId !== armedExerciseId) return null
  return text
}
