// translate-window.ts — чистая логика выбора окна перевода субтитров.
// Вынесена из PlayerPage для юнит-тестируемости (PlayerPage в RTL не поднять).
// Единицы: cue.start/end — СЕКУНДЫ; окно на BFF/шлюз — МИЛЛИсекунды.

// Лимит окна шлюза (2 мин); совпадает с translateWindowMaxMs на BFF.
export const TRANSLATE_WINDOW_MAX_MS = 120000

export interface TimedCue { start: number; end: number }

export interface TranslateWindow {
  fromMs: number
  toMs: number
  /** Индексы cue (из переданных), реально попавшие в окно после кэпа. */
  includedIdx: number[]
  /** Сколько выбранных cue НЕ вошло из-за кэпа >2мин (для тоста «первые K из N»). */
  truncatedCount: number
}

// selectionIndices — какие cue считаются «выбранными».
// ⚠️ Гейт по ws.looping (Fable HIGH-1, канон PlayerPage onBindToSubtitle): голый
// rangeEnd>rangeStart НЕ годится — обычный клик по cue ставит A-B диапазон, и
// «залежавшийся» диапазон при выключенном лупе не должен считаться выборкой.
// Луп активен + невырожденный диапазон → cue, пересекающие [rangeStart,rangeEnd];
// иначе → текущий активный cue (activeIndex), либо пусто, если его нет (-1).
export function selectionIndices(
  cues: TimedCue[],
  ws: { looping: boolean; rangeStart: number; rangeEnd: number },
  activeIndex: number,
): number[] {
  if (ws.looping && ws.rangeEnd > ws.rangeStart) {
    const out: number[] = []
    for (let i = 0; i < cues.length; i++) {
      // open-interval intersection (как cuesIntersectingRange), но по индексу
      if (cues[i].end > ws.rangeStart && cues[i].start < ws.rangeEnd) out.push(i)
    }
    return out
  }
  return activeIndex >= 0 && activeIndex < cues.length ? [activeIndex] : []
}

// windowForIndices — окно [fromMs,toMs] по выбранным индексам, с кэпом 2 мин.
// Пустой набор → null (кнопке нечего переводить → дизейбл/no-op).
export function windowForIndices(cues: TimedCue[], idx: number[]): TranslateWindow | null {
  if (idx.length === 0) return null
  let minStart = Infinity
  let maxEnd = -Infinity
  for (const i of idx) {
    if (cues[i].start < minStart) minStart = cues[i].start
    if (cues[i].end > maxEnd) maxEnd = cues[i].end
  }
  const fromMs = Math.round(minStart * 1000)
  let toMs = Math.round(maxEnd * 1000)
  if (toMs - fromMs > TRANSLATE_WINDOW_MAX_MS) toMs = fromMs + TRANSLATE_WINDOW_MAX_MS
  if (fromMs >= toMs) return null // вырожденный round (суб-мс cue) — нечего слать
  // includedIdx — ТОЛЬКО из выбранных idx, что пересекают финальное окно
  // (Fable HIGH-2: брать «все cue, пересекающие окно» дало бы truncatedCount<0,
  // т.к. невыбранный сосед мог бы попасть в [minStart,maxEnd]).
  const included = idx.filter((i) => {
    const s = Math.round(cues[i].start * 1000)
    const e = Math.round(cues[i].end * 1000)
    return e > fromMs && s < toMs
  })
  return { fromMs, toMs, includedIdx: included, truncatedCount: idx.length - included.length }
}

// menuTargetIndices — цель ПКМ-меню на блоке k: если выбрано несколько И k среди
// них → вся выборка (плюрал); иначе → только блок k (сингуляр). k<0 → пусто.
export function menuTargetIndices(sel: number[], k: number): number[] {
  if (k < 0) return []
  return sel.length > 1 && sel.includes(k) ? sel : [k]
}

// isPluralLabel — лейбл «Перевести блоки субтитров» vs «Перевести (блок)».
export function isPluralLabel(n: number): boolean {
  return n > 1
}

export interface RespCue { start: number; end: number; ru: string }

// matchTranslatedCues — сматчить RU из ответа к отображаемым cue по МАКС.
// перекрытию (клиентский аналог mergeByOverlap в gateway.go). Итерируем
// ОТОБРАЖАЕМЫЕ cue, берём respCue с наибольшим overlap (>0). Пустой ru не пишем.
// Возвращает {индекс отображаемого cue: ru}. Пусто, если перекрытий нет.
export function matchTranslatedCues(displayCues: TimedCue[], respCues: RespCue[]): Record<number, string> {
  const out: Record<number, string> = {}
  for (let i = 0; i < displayCues.length; i++) {
    const d = displayCues[i]
    let bestJ = -1
    let bestOv = 0
    for (let j = 0; j < respCues.length; j++) {
      const ov = overlap(d.start, d.end, respCues[j].start, respCues[j].end)
      if (ov > bestOv) {
        bestOv = ov
        bestJ = j
      }
    }
    if (bestJ >= 0 && respCues[bestJ].ru) out[i] = respCues[bestJ].ru
  }
  return out
}

function overlap(a0: number, a1: number, b0: number, b1: number): number {
  const lo = Math.max(a0, b0)
  const hi = Math.min(a1, b1)
  return hi > lo ? hi - lo : 0
}
