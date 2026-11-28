// clip-played.ts — сборка `clip_played` (спека 2026-11-17 §4.8, план B8a).
//
// Отчёт о ролике пакует `собратьОтчёт` приложения (subtitle-counter.ts); сайт
// добавляет правило полноты по прогрессу шлюза (таблица `subs_report` §4.8):
//
//   дорожка получена и пуста                         → `absent`, массивов нет
//   ни одна реплика не услышана                      → `""`, только `played_frac`
//   счётчик не сбрасывался И `GET progress` = 404     → `full`
//   то же, `GET progress` = 200 той же дорожки и счёт
//   восстановлен из `state` до первого шага (норма 6) → `full`
//   `GET progress` не удался, дорожка другая, счётчик
//   сбрасывался или различных услышанных `sub_ref`
//   меньше присланного `heard_max`                   → `partial`
//
// `played_frac` — только если отчёт не `full` (правило `route-played-pending.ts`
// приложения: при `full` долю считает демон из массивов).
//
// Деградация больших событий (I7): собранное > 240 КиБ → из элементов убираются
// `lemmas`, и отчёт ОБЯЗАТЕЛЬНО `partial` с `played_frac` (без слов `full`
// завышал бы спотыкание); всё ещё > 240 КиБ → `""` без массивов.
//
// Ведро реплик (M3, line-credit.ts): отчёт, в котором различных услышанных
// реплик больше MAX_HEARD_PER_REPORT, уходит без состава (`""` + `played_frac`) —
// одно событие не может опустошить ведро шлюза (потолок 3000).
import { MAX_HEARD_PER_REPORT } from '../../site/cabinet/route/line-credit'
import { собратьОтчёт, type Счётчик } from './subtitle-counter'
import type { Envelope, SiteEvent } from './mapper'

export const CLIP_PLAYED_DEGRADE_BYTES = 240 * 1024

// ProgressInfo — что сказал `GET /api/me/route/progress` при открытии ролика.
//   not_found — 404: первый просмотр на любом устройстве;
//   restored  — 200 той же дорожки, счёт восстановлен из `state` до первого шага;
//   failed    — запрос не удался;
//   other     — 200, но дорожка другая или счёт не восстановлен.
export interface ProgressInfo { kind: 'not_found' | 'restored' | 'failed' | 'other'; heardMax: number }

export interface ClipPlayedInput {
  puzzleId: string
  counter: Счётчик | null
  // trackResolved — дорожка окончательно получена (или её нет): без этого пустой
  // список реплик неотличим от «ещё едет».
  trackResolved: boolean
  frac: number
  progress: ProgressInfo | null
  subsSource: string
}

const enc = new TextEncoder()
const sizeOf = (v: unknown) => enc.encode(JSON.stringify(v)).length
const round3 = (x: number) => Number(Math.min(1, Math.max(0, Number.isFinite(x) ? x : 0)).toFixed(3))

function distinctHeard(heard: Array<{ sub_ref: string }>): number {
  return new Set(heard.map(h => h.sub_ref)).size
}

export interface BuiltClipPlayed { event: SiteEvent; frac: number }

export function buildClipPlayed(i: ClipPlayedInput, env: Envelope): BuiltClipPlayed {
  const frac = round3(i.frac)
  const r = собратьОтчёт(i.counter, i.trackResolved)
  let report: string = r.subs_report
  let heard: Array<Record<string, unknown>> = r.subs_heard as unknown as Array<Record<string, unknown>>
  let unheard: Array<Record<string, unknown>> = r.subs_unheard as unknown as Array<Record<string, unknown>>
  if (report === 'full') {
    const okProgress = i.progress !== null && (i.progress.kind === 'not_found' || i.progress.kind === 'restored')
    if (!okProgress || distinctHeard(r.subs_heard) < (i.progress?.heardMax ?? 0)) report = 'partial'
  }
  if ((report === 'full' || report === 'partial') && distinctHeard(r.subs_heard) > MAX_HEARD_PER_REPORT) {
    report = ''
  }
  const assemble = (): SiteEvent => {
    const ev: SiteEvent = { event_id: env.event_id, type: 'clip_played', puzzle_id: i.puzzleId, learning_day: env.learning_day, client_ts: env.client_ts }
    if (report !== '') ev.subs_report = report
    if (report === 'full' || report === 'partial') { ev.subs_heard = heard; ev.subs_unheard = unheard }
    if (report !== 'full') ev.played_frac = frac
    ev.subs_source = i.subsSource
    return ev
  }
  let ev = assemble()
  if (sizeOf(ev) > CLIP_PLAYED_DEGRADE_BYTES && (report === 'full' || report === 'partial')) {
    const strip = (x: Record<string, unknown>) => { const { lemmas: _l, ...rest } = x; void _l; return rest }
    heard = heard.map(strip)
    unheard = unheard.map(strip)
    report = 'partial'
    ev = assemble()
    if (sizeOf(ev) > CLIP_PLAYED_DEGRADE_BYTES) {
      report = ''
      ev = assemble()
    }
  }
  return { event: ev, frac }
}

// wordsLessonClipPlayed — зачёт урока слов (§4.13 п.7): `puzzle_id` строки урока
// и доля с 3 знаками; НЕТ `subs_report`, `subs_heard`, `subs_unheard`,
// `subs_source`, `lemmas`. Тот же модуль зовёт страница урока (B10f).
export function wordsLessonClipPlayed(puzzleId: string, frac: number, env: Envelope): SiteEvent {
  return { event_id: env.event_id, type: 'clip_played', puzzle_id: puzzleId, played_frac: round3(frac), learning_day: env.learning_day, client_ts: env.client_ts }
}

// --- доля ролика по правилу демона (clipPlayedShare, ДМ route_snapshot_events.go:1925-1961)

function spanUnion(spans: Array<[number, number]>): number {
  if (spans.length === 0) return 0
  const s = [...spans].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  let total = 0
  let [from, to] = s[0]
  for (const [a, b] of s.slice(1)) {
    if (a > to) { total += to - from; from = a; to = b; continue }
    if (b > to) to = b
  }
  return total + to - from
}

// clipShare — доля, которую демон зачтёт за этот clip_played: при `full` —
// объединение услышанных отрезков в объединении всех (любой отрезок нулевой
// длины — доля по числу реплик), иначе — `played_frac`. Читатель — отметка
// «просмотрен» `flib:route-watched` (§4.2 п.2).
export function clipShare(ev: { [k: string]: unknown }): number {
  if (ev.subs_report !== 'full') return typeof ev.played_frac === 'number' ? ev.played_frac : 0
  const heard = (Array.isArray(ev.subs_heard) ? ev.subs_heard : []) as Array<{ from_ms: number; to_ms: number }>
  const unheard = (Array.isArray(ev.subs_unheard) ? ev.subs_unheard : []) as Array<{ from_ms: number; to_ms: number }>
  let timed = true
  const hs: Array<[number, number]> = []
  const all: Array<[number, number]> = []
  for (const h of heard) { if (h.to_ms <= h.from_ms) timed = false; hs.push([h.from_ms, h.to_ms]); all.push([h.from_ms, h.to_ms]) }
  for (const u of unheard) { if (u.to_ms <= u.from_ms) timed = false; all.push([u.from_ms, u.to_ms]) }
  if (timed) {
    const d = spanUnion(all)
    if (d > 0) return spanUnion(hs) / d
  }
  const n = heard.length + unheard.length
  return n === 0 ? 0 : heard.length / n
}

export const __spanUnion = spanUnion
