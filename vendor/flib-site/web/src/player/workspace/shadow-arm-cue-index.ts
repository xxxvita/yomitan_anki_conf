// shadow-arm-cue-index.ts — Срез C+D фикс-волна [ID:P-CD-fix]: чистый резолвер
// cue_index, снимаемого на МОМЕНТ арма для записи попытки в ленту истории.
// Вынесен из PlayerPage АДДИТИВНО (тот же идиом, что shadow-phase.ts /
// shadow-attempts-accumulate.ts) для РЕАЛЬНОЙ мутационной проверки без
// монтирования страницы. Закрывает два адверсариальных дефекта:
//
//   H2 — при A-B/time-range-арме playhead может стоять в ПАУЗЕ между cue →
//        activeIndex=-1. Запись с cue_index:-1 невидима навсегда (toPanel/merge
//        в shadow-attempts.ts пропускают `a.cue_index < 0`). Кламп на ПЕРВЫЙ cue,
//        пересекающий армленный отрезок, даёт честный видимый бакет.
//
//   M2 — детектор пересъёмки обязан ловить ЛЮБУЮ смену armed id, включая id1→id2
//        БЕЗ прохода через null (как заармит автопрогон среза E). Проверка
//        `prev == null` ловила только null→id → все попытки автопрогона легли бы
//        в бакет ПЕРВОГО cue. Здесь — `armedId !== prevArmedId`.
import { cuesIntersectingRange } from './bind-range'

export interface ArmCaptureArgs {
  /** armedSegmentId ПРЕДЫДУЩЕГО рендера (ref). */
  prevArmedId: string | null
  /** armedSegmentId ТЕКУЩЕГО рендера (свежий геттер координатора). */
  armedId: string | null
  /** Ранее зафиксированный cue_index (возвращается, если пересъёмки нет). */
  prevCaptured: number
  /** activeIndex ТЕКУЩЕГО рендера. */
  activeIndex: number
  /** Живые cue ({start,end} — форма SubtitleCue). */
  cues: readonly { start: number; end: number }[]
  /** Отрезок армленного упражнения (ephemeral или persisted); null — неизвестен. */
  armedRange: { startTime: number; endTime: number } | null
}

/**
 * Возвращает cue_index, который надо зафиксировать для текущего арма.
 * Пересъёмка происходит ТОЛЬКО при реальной смене armed id на не-null
 * (null→id ИЛИ id1→id2). Если activeIndex валиден (>=0) — берётся он; иначе
 * (playhead вне cue) — кламп на первый cue, пересекающий армленный отрезок;
 * если пересечения нет / отрезок неизвестен — остаётся -1 (честного бакета нет).
 *
 * [ID:P-feed-dead-fix] Апгрейд без даунгрейда при НЕИЗМЕННОМ armedId: если арм
 * стартовал раньше прихода субтитров (cues=[] на pending fetch), первая фиксация
 * честно даёт -1 (клямповать не на что). Голый `return prevCaptured` на этой ветке
 * залипал бы на -1 на весь ран — WRITE (verdict-коммит) и READ (rAF-рендер после
 * сика) в PlayerPage читают этот геттер в РАЗНЫЕ моменты и увидят РАЗНЫЙ live
 * activeIndex → попытки размазываются по разным бакетам вместо накопления в одном.
 * Поэтому: пока prevCaptured ещё -1 — подхватываем первый живой activeIndex (латч
 * на ПЕРВЫЙ cue рана); как только латч встал (prevCaptured>=0) — держим его,
 * даже если playhead уехал на другой cue (даунгрейда/дрифта нет, resolveAttemptBucket
 * остаётся страховкой на случай -1).
 */
export function resolveArmCaptureIndex(args: ArmCaptureArgs): number {
  const { prevArmedId, armedId, prevCaptured, activeIndex, cues, armedRange } = args
  if (armedId == null) return prevCaptured
  // Пересъёмки нет (тот же armed id) — апгрейд без даунгрейда.
  if (armedId === prevArmedId) return prevCaptured >= 0 ? prevCaptured : (activeIndex >= 0 ? activeIndex : prevCaptured)
  if (activeIndex >= 0) return activeIndex
  // H2: playhead в паузе между cue — кламп на первый пересекающий армленный отрезок.
  if (!armedRange) return activeIndex // -1 — нечем кламповать
  const tagged = cues.map((c, i) => ({ startTime: c.start, endTime: c.end, index: i }))
  const first = cuesIntersectingRange(tagged, armedRange.startTime, armedRange.endTime)[0]
  return first ? first.index : activeIndex
}

/**
 * [ID:P-feed-dead] Бакет ленты попыток из ЗАФИКСИРОВАННОГО armCue. И ЗАПИСЬ
 * (аккумулятор истории), и ЧТЕНИЕ (карта Shadowing) ОБЯЗАНЫ звать ЭТОТ резолвер с
 * ОДНИМИ И ТЕМИ ЖЕ входами — иначе бакет записи != бакет чтения и лента мертва.
 *
 * КОРЕНЬ регрессии ТЗ-5: аккумулятор писал попытку под ГОЛЫМ `armCueIndexRef.current`
 * (resolveArmCaptureIndex ЧЕСТНО отдаёт -1, когда activeIndex=-1 И armedRange не
 * пересёк ни одного cue — gap-арм / cues ещё не готовы; см. его док «нечестного
 * бакета не выдумываем»), а карта читала бакет по `armCue >= 0 ? armCue : activeIndex`.
 * При armCue=-1: запись уходила в НЕВИДИМЫЙ бакет "-1" (toPanel/mergeShadowAttempts
 * ForPanel пропускают `cue_index < 0`), а чтение падало на activeIndex → две РАЗНЫЕ
 * ячейки → «повтор N» не появлялся НИКОГДА. Фолбэк на activeIndex (живой cue под
 * playhead'ом) даёт ВИДИМЫЙ бакет; вызов из ОБОИХ мест гарантирует их совпадение.
 * Если и activeIndex=-1 (плейхед реально вне cue) — остаётся -1 симметрично: честного
 * бакета нет, но запись и чтение согласованы (не «полупустая» рассинхронизация).
 */
export function resolveAttemptBucket(armCue: number, activeIndex: number): number {
  return armCue >= 0 ? armCue : activeIndex
}
