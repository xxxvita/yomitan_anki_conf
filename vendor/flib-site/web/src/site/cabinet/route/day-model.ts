// day-model.ts — модель экрана дня из проекции BFF и памяти этого браузера
// (спека 2026-11-17 §4.2, §4.5, §4.12; план B10b). Чистые функции: страница
// маршрута, Главная (B10e) и календарь (B10c) берут признаки отсюда, и
// читатели одного признака не могут разойтись.
//
// Три признака ролика (§4.2, M3):
//   1. «открыт»     = played || queued_played || clip_played ролика в локальной очереди
//                     (сейчас ИЛИ в момент отправки запроса этого состояния — ревью 3а, H1);
//   2. «просмотрен» = kept || kept_local || played
//                     || (отчёт не обработан И локальная отметка ≥ 0,6),
//      где «отчёт не обработан» = queued_played || clip_played в локальной очереди,
//      а отметка — доля `flib:route-watched` той же эпохи и даты плана;
//   3. конец первого прохода — гейт субтитров плеера, здесь не нужен.
//
// Строки `kept_local` (Р24) строит браузер: запись `flib:route-watched` той же
// эпохи и даты плана с долей ≥ 0,6 и подробностями показа (`meta`), ролика нет ни
// среди выданных строк плана, ни в `kept_today`. Порядок — первой записи (порядок
// ключей объекта: перезапись ролика место не меняет).
//
// Правило «до выдачи» (§4.12): невыданная строка не несёт ничего, кроме
// `duration_sec` и `new_words`, — модель тоже ничего больше не кладёт в её строку.
import type { DayClip, DayClipDelivered, DayClipKept, DayClipUndelivered, RouteState } from './route-api'

export const WATCHED_SHARE = 0.6

export interface WatchedEntry { share: number; seq?: number; meta?: { video_id?: string; title?: string; series_title?: string; source?: string; duration_sec?: number; words?: string[] } }

export interface LocalDayInputs {
  // watched — записи `flib:route-watched` ЭТОЙ эпохи и даты плана (иначе пусто).
  watched: Record<string, WatchedEntry>
  // pendingClipPlayed — ролики с clip_played в локальной очереди (вкл. пачку в полёте).
  pendingClipPlayed: ReadonlySet<string>
  // sentPending — ролики, чей clip_played был в локальной очереди В МОМЕНТ ОТПРАВКИ
  // запроса состояния, которое на экране (проба `sent.pendingClipPlayed`): такое
  // состояние могло быть посчитано до того, как шлюз принял отчёт (ревью 3а, H1),
  // поэтому для показа отчёт этих роликов тоже «ещё не обработан».
  sentPending?: ReadonlySet<string>
  // sentWatchedSeq — `seq` объекта `flib:route-watched` в момент отправки этого
  // запроса: запись ролика с бо́льшим `seq` создана или переписана после отправки —
  // её отчёт тоже мог не попасть в это состояние (ревью 3а, R1-L1; тот же признак,
  // что у сторожа удаления, R4-C1).
  sentWatchedSeq?: number
  // lessonHeard — сколько слов урока просмотрено по `flib:route-lesson` (W-L3).
  lessonHeard?: (puzzleId: string) => number
}

export type RowKind = 'kept' | 'kept_local' | 'watched' | 'current' | 'passed' | 'locked'

export interface DayRow {
  kind: RowKind
  index: number                 // место в списке дня, с 1
  puzzleId: string | null       // null — невыданный
  clipKind: 'youtube' | 'words' | 'other' | null
  videoId?: string
  title?: string
  seriesTitle?: string
  source?: string
  durationSec: number
  newWords: number
  words: string[]
  opened: boolean
  watched: boolean
  lesson: boolean               // урок слов (по `kind:"words"` или префиксу `words::`)
  inPlan: boolean               // выданная строка ТЕКУЩЕГО плана (не kept/kept_local, не невыданная)
  replaceable: boolean          // «Заменить» и галка доступны (без учёта replace_available)
}

export interface DayModel {
  rows: DayRow[]
  total: number                 // M
  watchedCount: number          // k
  minutes: number               // T
  watchedMinutes: number        // минуты сегодня (календарь, B10c): по «просмотренным», вкл. kept и kept_local
  words: number                 // W
  current: DayRow | null        // герой
  hasUndelivered: boolean
  dayDone: boolean
  allWatched: boolean           // «просмотрен» каждый выданный ролик дня
}

const isKept = (c: DayClip): c is DayClipKept => c.delivered === true && 'kept' in c && (c as DayClipKept).kept === true
const isPlanDelivered = (c: DayClip): c is DayClipDelivered => c.delivered === true && !isKept(c)

function clipKindOf(kind: string | undefined, puzzleId: string): 'youtube' | 'words' | 'other' {
  if (puzzleId.startsWith('words::')) return 'words'
  if (kind === 'youtube' || kind === 'words') return kind
  if (puzzleId.startsWith('youtube::')) return 'youtube'
  return 'other'
}

function secs(n: number | undefined): number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0
}

// buildDayModel — строки дня в порядке: kept шлюза, kept_local этого устройства,
// строки текущего плана (выданные и невыданные) в его порядке.
export function buildDayModel(state: RouteState, local: LocalDayInputs): DayModel {
  const clips = state.day?.clips ?? []
  const pending = local.pendingClipPlayed
  const rows: DayRow[] = []

  const kept = clips.filter(isKept)
  const plan = clips.filter(c => !isKept(c))
  const known = new Set<string>()
  for (const c of clips) if (c.delivered === true) known.add(c.puzzle_id)

  for (const c of kept) {
    const words = Array.isArray(c.words) ? c.words : []
    rows.push({
      kind: 'kept', index: 0, puzzleId: c.puzzle_id, clipKind: clipKindOf(c.kind, c.puzzle_id),
      videoId: c.video_id, title: c.title, seriesTitle: c.series_title, source: c.source,
      durationSec: secs(c.duration_sec), newWords: words.length, words,
      opened: true, watched: true, lesson: c.puzzle_id.startsWith('words::'), inPlan: false, replaceable: false,
    })
  }

  for (const [pid, w] of Object.entries(local.watched)) {
    if (known.has(pid) || !w || !w.meta || typeof w.share !== 'number' || w.share < WATCHED_SHARE) continue
    const m = w.meta
    const words = Array.isArray(m.words) ? m.words : []
    rows.push({
      kind: 'kept_local', index: 0, puzzleId: pid, clipKind: clipKindOf(undefined, pid),
      videoId: m.video_id, title: m.title, seriesTitle: m.series_title, source: m.source,
      durationSec: secs(m.duration_sec), newWords: words.length, words,
      opened: true, watched: true, lesson: pid.startsWith('words::'), inPlan: false, replaceable: false,
    })
  }

  for (const c of plan) {
    if (!isPlanDelivered(c)) {
      const u = c as DayClipUndelivered
      rows.push({
        kind: 'locked', index: 0, puzzleId: null, clipKind: null, durationSec: secs(u.duration_sec),
        newWords: typeof u.new_words === 'number' ? u.new_words : 0, words: [],
        opened: false, watched: false, lesson: false, inPlan: false, replaceable: false,
      })
      continue
    }
    const pid = c.puzzle_id
    const afterSent = local.sentWatchedSeq !== undefined && (local.watched[pid]?.seq ?? 0) > local.sentWatchedSeq
    const localQueued = pending.has(pid) || !!local.sentPending?.has(pid) || afterSent
    const opened = c.played || c.queued_played || localQueued
    const share = local.watched[pid]?.share ?? 0
    const unprocessed = c.queued_played || localQueued
    const watched = c.played || (unprocessed && share >= WATCHED_SHARE)
    const ck = clipKindOf(c.kind, pid)
    const words = Array.isArray(c.words) ? c.words : []
    rows.push({
      kind: pid === state.current_puzzle_id ? 'current' : watched ? 'watched' : 'passed',
      index: 0, puzzleId: pid, clipKind: ck, videoId: c.video_id, title: c.title, seriesTitle: c.series_title,
      source: c.source, durationSec: secs(c.duration_sec), newWords: typeof c.new_words === 'number' ? c.new_words : words.length,
      words, opened, watched, lesson: ck === 'words', inPlan: true, replaceable: ck !== 'words',
    })
  }

  rows.forEach((r, i) => { r.index = i + 1 })
  const delivered = rows.filter(r => r.kind !== 'locked')
  const current = rows.find(r => r.kind === 'current') ?? null
  const hasUndelivered = rows.some(r => r.kind === 'locked')
  const watchedCount = rows.filter(r => r.watched).length
  const dayDone = !!current && !hasUndelivered && (current.watched || current.clipKind === 'other')
  return {
    rows, total: rows.length, watchedCount,
    minutes: Math.round(rows.reduce((s, r) => s + r.durationSec, 0) / 60),
    watchedMinutes: Math.round(rows.filter(r => r.watched).reduce((s, r) => s + r.durationSec, 0) / 60),
    words: rows.reduce((s, r) => s + r.newWords, 0),
    current, hasUndelivered, dayDone,
    allWatched: delivered.length > 0 && delivered.every(r => r.watched),
  }
}

// --- кнопки героя (§4.12 «Герой», OQ-B14; §4.13 п.8) -------------------------------

export type HeroAction = 'watch' | 'watch_again' | 'next' | 'lesson'

export interface HeroButtons {
  primary: HeroAction | null
  secondary: HeroAction | null
  // lessonLabel — текст кнопки урока, когда primary или secondary = 'lesson'.
  lessonLabel?: 'Пройти урок' | 'Продолжить урок' | 'Повторить урок'
}

// lessonLabel — текст кнопки урока: «открыт» для ТЕКСТА = признак 1 ИЛИ в
// `flib:route-lesson` этой строки есть просмотренное слово (W-L3).
export function lessonLabelOf(row: DayRow, heard: number): 'Пройти урок' | 'Продолжить урок' | 'Повторить урок' {
  if (row.watched) return 'Повторить урок'
  return row.opened || heard > 0 ? 'Продолжить урок' : 'Пройти урок'
}

// heroButtons — таблица героя. `null` у обеих — день завершён (карточка вместо героя).
export function heroButtons(m: DayModel, heard = 0): HeroButtons {
  const c = m.current
  if (!c || m.dayDone) return { primary: null, secondary: null }
  if (c.clipKind === 'other') return { primary: m.hasUndelivered ? 'next' : null, secondary: null }
  if (c.lesson) {
    const label = lessonLabelOf(c, heard)
    if (c.watched) return { primary: m.hasUndelivered ? 'next' : null, secondary: 'lesson', lessonLabel: label }
    return { primary: 'lesson', secondary: m.hasUndelivered ? 'next' : null, lessonLabel: label }
  }
  if (!c.opened) return { primary: 'watch', secondary: null }
  if (!c.watched) return { primary: 'watch_again', secondary: m.hasUndelivered ? 'next' : null }
  return { primary: 'next', secondary: 'watch_again' }
}

// --- адреса ------------------------------------------------------------------------

export function playerRouteUrl(videoId: string, puzzleId: string): string {
  return `/player?v=${encodeURIComponent(videoId)}&rp=${encodeURIComponent(puzzleId)}`
}

export function playerRcUrl(videoId: string, puzzleId: string): string {
  return `/player?v=${encodeURIComponent(videoId)}&back=route&rc=${encodeURIComponent(puzzleId)}`
}

export function playerBackUrl(videoId: string): string {
  return `/player?v=${encodeURIComponent(videoId)}&back=route`
}

export function playerExtraUrl(videoId: string, puzzleId: string): string {
  return `/player?v=${encodeURIComponent(videoId)}&back=route&rx=${encodeURIComponent(puzzleId)}`
}

export function lessonUrl(puzzleId: string): string {
  return `/app/route/words?rw=${encodeURIComponent(puzzleId)}`
}

// nextGuard — сторож `?next=` (§4.7, N-C1): обмен только если `next` равен
// текущему и в плане есть невыданный ролик.
export function nextGuard(state: RouteState, next: string | null): boolean {
  if (!next || !state.current_puzzle_id || next !== state.current_puzzle_id) return false
  return (state.day?.clips ?? []).some(c => c.delivered === false)
}
