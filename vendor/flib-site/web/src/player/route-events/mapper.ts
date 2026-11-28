// mapper.ts — сигналы сайта → события шлюза (спека 2026-11-17 §4.8, план B8a).
//
// Каждая функция собирает ОДНО событие со всеми полями конверта (`event_id`,
// `learning_day`, `client_ts`) по правилам полей шлюза
// (`GW/internal/routestate/events.go` checkFieldPlacement / checkLemmas):
//   • слова — в `lemmas`, каждая непустая и в нижнем регистре (порт `wordsOf`);
//   • `sub_ref` — только у `subtitles_shown` (и `clip_replayed`, но сайт его там
//     не ставит: адрес реплики `clip_replayed` ничего демону не даёт);
//   • `rating`/`rate_reason` — только у `clip_rated`;
//   • `native_track_on` сайт не ставит никогда: русская строка на первом
//     проходе скрыта (§4.7 п.5).
// Пустой список слов — события нет (`null`): шлюз примет и пустой, но демону
// такое событие ничего не говорит.
import { l1CopyLemmas, wordsOf } from './lemmas'

export interface Envelope { event_id: string; learning_day: string; client_ts: string }

export interface SiteEvent {
  event_id: string
  type: string
  puzzle_id: string
  learning_day: string
  client_ts: string
  [k: string]: unknown
}

export function newEventId(): string {
  const c = typeof crypto !== 'undefined' ? crypto : undefined
  if (c && typeof c.randomUUID === 'function') return `web:${c.randomUUID()}`
  const h = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
  return `web:${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20)}`
}

// envelope — конверт события В МОМЕНТ СОЗДАНИЯ (§4.8): учебный день и RFC 3339.
export function envelope(learningDay: string, now: Date = new Date(), id: string = newEventId()): Envelope {
  return { event_id: id, learning_day: learningDay, client_ts: now.toISOString() }
}

// Метка источника субтитров — то же правило, что у приложения
// (`VideoPlayerPanel/utils/subs-source.ts`: `/^[a-z][a-z0-9_]{0,39}$/`).
const SOURCE_LABEL = /^[a-z][a-z0-9_]{0,39}$/

// subsSourceOf — `subs_source` по заголовку `X-Subtitle-Source` EN-дорожки:
// `server:<источник>`, без заголовка или с негодным — `server`.
export function subsSourceOf(header: string | null | undefined): string {
  const s = (header ?? '').trim()
  return SOURCE_LABEL.test(s) ? `server:${s}` : 'server'
}

/** Коды причин «Не нравится» — ровно перечень демона (`AC/clip-rating.ts`). */
export const CLIP_DISLIKE_REASONS = [
  'subs_mismatch', 'subs_misaligned', 'speech_not_english', 'lost_in_clip',
  'content', 'video_quality', 'video_unavailable', 'age_restricted',
] as const
export type ClipDislikeReason = typeof CLIP_DISLIKE_REASONS[number]

const lower = (w: string) => (w || '').trim().toLowerCase()

function withLemmas(type: string, puzzleId: string, lemmas: string[], env: Envelope, extra: Record<string, unknown> = {}): SiteEvent | null {
  const ws = [...new Set(lemmas.map(lower).filter(Boolean))]
  if (ws.length === 0) return null
  return { event_id: env.event_id, type, puzzle_id: puzzleId, lemmas: ws, ...extra, learning_day: env.learning_day, client_ts: env.client_ts }
}

// subtitlesShownEvent — снятие размытия на первом проходе (§4.7 п.4): открытое
// слово или ещё размытые слова строки; `sub_ref:"c<i>"`, `subs_kind:1`, `subs_lang:"en"`.
export function subtitlesShownEvent(puzzleId: string, cueIndex: number, words: string[], env: Envelope): SiteEvent | null {
  return withLemmas('subtitles_shown', puzzleId, words.flatMap(w => wordsOf(w)), env, { sub_ref: `c${cueIndex}`, subs_kind: 1, subs_lang: 'en' })
}

// hintRequestedEvent — клик по слову → окно примеров.
export function hintRequestedEvent(puzzleId: string, word: string, env: Envelope): SiteEvent | null {
  return withLemmas('hint_requested', puzzleId, wordsOf(word).slice(0, 1), env)
}

// lineTranslatedEvent — раскрытие перевода строки: слова строки, БЕЗ sub_ref.
export function lineTranslatedEvent(puzzleId: string, lineText: string, env: Envelope): SiteEvent | null {
  return withLemmas('line_translated', puzzleId, wordsOf(lineText), env)
}

// clipReplayedEvent — перемотка назад ≥ 1,5 с: слова текущей реплики.
export function clipReplayedEvent(puzzleId: string, cueText: string, env: Envelope): SiteEvent | null {
  return withLemmas('clip_replayed', puzzleId, wordsOf(cueText), env)
}

// clipboardCopyEvent — копирование выделенного в субтитрах; копия из русской
// строки — слова текущей английской (`l1CopyLemmas`).
export function clipboardCopyEvent(puzzleId: string, selection: string, o: { fromL1: boolean; enLine?: string | null }, env: Envelope): SiteEvent | null {
  const lemmas = o.fromL1 ? l1CopyLemmas(selection, o.enLine) : wordsOf(selection)
  return withLemmas('clipboard_copy', puzzleId, lemmas, env)
}

// clipRatedEvent — «Нравится» / «Не нравится» с причиной. Голого `dislike` без
// причины сайт не шлёт (решение владельца 1): без кода причины — `null`.
// `subs_source` — источник `clip_played` этого открытия в плеере, на странице
// дня — `""` (§4.6, `AC/clip-rating.ts:48-52`).
export function clipRatedEvent(puzzleId: string, o: { rating: 'like' | 'dislike'; reason?: string; subsSource: string }, env: Envelope): SiteEvent | null {
  if (o.rating === 'dislike' && !(CLIP_DISLIKE_REASONS as readonly string[]).includes(o.reason ?? '')) return null
  return {
    event_id: env.event_id, type: 'clip_rated', puzzle_id: puzzleId, rating: o.rating,
    ...(o.rating === 'dislike' ? { rate_reason: o.reason } : {}),
    subs_source: o.subsSource,
    learning_day: env.learning_day, client_ts: env.client_ts,
  }
}
