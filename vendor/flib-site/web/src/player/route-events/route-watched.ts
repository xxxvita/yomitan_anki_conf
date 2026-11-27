// route-watched.ts — отметка «просмотрен» `flib:route-watched` (спека 2026-11-17
// §4.2 п.2, §6.2, R2-L1, R3-M3, R4-C1, Р24; план B8c).
//
// Форма: `{v:1, route_id, day:"YYYY-MM-DD", seq, items:{<puzzle_id>:{share, seq, meta}}}`.
//   • `day` — дата ПЛАНА (`day.date` состояния), не учебный день сейчас (R2-L2);
//     другой `route_id` или другая дата — содержимое отбрасывается целиком;
//   • `seq` объекта — счётчик записей; КАЖДАЯ постановка `clip_played` (и с
//     меньшей долей) поднимает его и кладёт новое значение в запись ролика;
//   • `share` — максимум доли (правило демона, clip-played.ts clipShare);
//   • `meta` — поля строки этого ВЫДАННОГО ролика из состояния, подтвердившего
//     маршрутный режим (строка `kept_local`, Р24). Названий невыданных здесь нет:
//     плеер пишет только в маршрутном режиме, а `rp` = выданный `current_puzzle_id`;
//   • ≤ 200 записей, первыми вытесняются записи с наименьшим `seq`;
//   • `replaced` (необязательное) — puzzle_id роликов, заменённых с этого браузера
//     в этой эпохе и дате плана (≤ 50): их отметку больше никто не пишет — иначе
//     открытый в другой вкладке плеер вернул бы заменённый ролик строкой
//     `kept_local` (ревью 3а, L2; §7 случай 42г).
// Пишет плеер ПОСЛЕ записи `clip_played` в `flib:route-outbox` и под той же
// блокировкой (outbox.enqueueDurable → afterWrite). Удаляет — сторож
// `pruneWatched` по ответу состояния (читатель — страница маршрута, B10b) и шаг
// замены (`removeWatched`).
import { ROUTE_WATCHED_KEY, safeLocalStorage } from '../../site/cabinet/route/route-storage'
import type { DayClip, RouteState } from '../../site/cabinet/route/route-api'
import type { StateSentProbe } from '../../site/cabinet/route/use-route-state'
import type { RouteEvent, RouteOutbox } from '../../site/cabinet/route/outbox'

export interface WatchedMeta {
  video_id?: string; title?: string; series_title?: string; source?: string; duration_sec?: number; words?: string[]
}
export interface WatchedItem { share: number; seq: number; meta: WatchedMeta }
export interface WatchedObj { v: 1; route_id: string; day: string; seq: number; items: Record<string, WatchedItem>; replaced?: string[] }
export const WATCHED_MAX_REPLACED = 50

export const WATCHED_MAX_ITEMS = 200

function parse(raw: string | null): WatchedObj | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as Partial<WatchedObj>
    if (v?.v !== 1 || typeof v.route_id !== 'string' || typeof v.day !== 'string' || typeof v.seq !== 'number' || !v.items || typeof v.items !== 'object') return null
    return v as WatchedObj
  } catch {
    return null
  }
}

// readWatched — объект хранилища как есть (любой эпохи и даты) или null.
export function readWatched(storage: Storage | null = safeLocalStorage()): WatchedObj | null {
  if (!storage) return null
  try { return parse(storage.getItem(ROUTE_WATCHED_KEY)) } catch { return null }
}

function save(storage: Storage, o: WatchedObj): void {
  try { storage.setItem(ROUTE_WATCHED_KEY, JSON.stringify(o)) } catch { /* хранилище недоступно */ }
}

// watchedFor — записи этой эпохи и даты плана (иначе пусто).
export function watchedFor(routeId: string, day: string, storage: Storage | null = safeLocalStorage()): Record<string, WatchedItem> {
  const o = readWatched(storage)
  return o && o.route_id === routeId && o.day === day ? o.items : {}
}

// olderPlanDate — запись относится к дате плана РАНЬШЕ той, что уже лежит в объекте
// этой эпохи (даты YYYY-MM-DD сравниваются строкой). Такую запись не пишем: страница,
// открытая со вчерашнего дня и закрытая сегодня, иначе сбросила бы сегодняшний
// объект — строку kept_local и «просмотрен» текущего ролика (финальное ревью PR-B,
// L4). Отчёт при этом уходит как обычно (он уже в очереди): отметка вчерашнего дня
// сегодня никому не нужна — читатели берут объект текущей даты плана.
export function olderPlanDate(prev: { route_id: string; day: string } | null, routeId: string, day: string): boolean {
  return !!prev && prev.route_id === routeId && prev.day > day
}

// writeWatched — запись ролика при постановке clip_played: seq объекта +1 и в
// запись, share = максимум. Другая эпоха или более поздняя дата — объект
// начинается заново; более ранняя дата той же эпохи — не пишется (olderPlanDate).
export function writeWatched(routeId: string, day: string, puzzleId: string, share: number, meta: WatchedMeta,
  storage: Storage | null = safeLocalStorage()): void {
  if (!storage || !routeId || !day || !puzzleId) return
  const prev = readWatched(storage)
  if (olderPlanDate(prev, routeId, day)) return
  const same = !!prev && prev.route_id === routeId && prev.day === day
  if (same && Array.isArray(prev!.replaced) && prev!.replaced.includes(puzzleId)) return
  const o: WatchedObj = same
    ? prev!
    : { v: 1, route_id: routeId, day, seq: prev?.seq ?? 0, items: {} }
  o.seq += 1
  const old = o.items[puzzleId]
  o.items[puzzleId] = { share: Math.max(old?.share ?? 0, Number.isFinite(share) ? share : 0), seq: o.seq, meta }
  const ids = Object.keys(o.items)
  if (ids.length > WATCHED_MAX_ITEMS) {
    ids.sort((a, b) => o.items[a].seq - o.items[b].seq)
    for (const id of ids.slice(0, ids.length - WATCHED_MAX_ITEMS)) delete o.items[id]
  }
  save(storage, o)
}

// enqueueClipPlayed — постановка clip_played в очередь И запись отметки ролика —
// ЕДИНСТВЕННЫЙ путь для плеера (B8c) и страницы урока слов (B10f, §4.13 п.7):
// событие сначала в `flib:route-outbox`, затем ПОД ТОЙ ЖЕ блокировкой запись
// `flib:route-watched` (§4.2) — другая вкладка не увидит отметку без отчёта.
// `afterMark` — ещё одна запись под той же блокировкой после отметки (урок слов
// запоминает так отправленную долю, финальное ревью PR-B, L8).
export function enqueueClipPlayed(outbox: Pick<RouteOutbox, 'enqueueDurable'>, o: {
  routeId: string; day: string; event: RouteEvent; share: number; meta: WatchedMeta; frac?: number; storage?: Storage | null
  afterMark?: () => void
}): Promise<void> {
  return outbox.enqueueDurable(o.routeId, o.event, {
    ...(o.frac !== undefined ? { frac: o.frac } : {}),
    afterWrite: () => {
      writeWatched(o.routeId, o.day, o.event.puzzle_id, o.share, o.meta, o.storage === undefined ? safeLocalStorage() : o.storage)
      o.afterMark?.()
    },
  })
}

// removeWatched — шаг замены (§4.6 «Шаги замены», п.2): запись заменяемого ролика.
// С `tombstone` (эпоха и дата плана) ролик ещё и помечается заменённым: его
// отметку больше никто в этой эпохе и дате не напишет.
export function removeWatched(puzzleId: string, storage: Storage | null = safeLocalStorage(),
  tombstone?: { routeId: string; day: string }): void {
  if (!storage) return
  const prev = readWatched(storage)
  if (tombstone && tombstone.routeId && tombstone.day) {
    if (olderPlanDate(prev, tombstone.routeId, tombstone.day)) return
    const o: WatchedObj = prev && prev.route_id === tombstone.routeId && prev.day === tombstone.day
      ? prev
      : { v: 1, route_id: tombstone.routeId, day: tombstone.day, seq: prev?.seq ?? 0, items: {} }
    delete o.items[puzzleId]
    const r = (Array.isArray(o.replaced) ? o.replaced : []).filter(x => x !== puzzleId)
    r.push(puzzleId)
    o.replaced = r.slice(-WATCHED_MAX_REPLACED)
    save(storage, o)
    return
  }
  if (!prev || !prev.items[puzzleId]) return
  delete prev.items[puzzleId]
  save(storage, prev)
}

const isDeliveredPlanRow = (c: DayClip): c is Extract<DayClip, { queued_played: boolean }> =>
  c.delivered === true && 'queued_played' in c && !('kept' in c && (c as { kept?: boolean }).kept)

// pruneWatched — сторож удаления (R2-L1, R3-M3, R4-C1). Запись ролика
// удаляется, только если ВСЁ сразу:
//   • запись УЖЕ БЫЛА на момент отправки запроса состояния и не переписывалась
//     (её seq ≤ seq объекта, запомненного при отправке);
//   • clip_played ролика тогда НЕ было в локальной очереди (вкл. пачку в полёте);
//   • в ответе ролик — выданная строка текущего плана с played:false без queued_played.
// Запись ролика, которого нет ни среди выданных строк плана, ни в kept_today, не
// удаляется: она питает строку kept_local (Р24). Возвращает удалённые puzzle_id.
export function pruneWatched(state: RouteState, sent: StateSentProbe, storage: Storage | null = safeLocalStorage()): string[] {
  if (!storage || !state.route_id || !state.day) return []
  const o = readWatched(storage)
  if (!o || o.route_id !== state.route_id || o.day !== state.day.date) return []
  const removed: string[] = []
  for (const row of state.day.clips) {
    if (!isDeliveredPlanRow(row)) continue
    const it = o.items[row.puzzle_id]
    if (!it) continue
    if (it.seq > sent.watchedSeq) continue
    if (sent.pendingClipPlayed.has(row.puzzle_id)) continue
    if (row.played || row.queued_played) continue
    delete o.items[row.puzzle_id]
    removed.push(row.puzzle_id)
  }
  if (removed.length) save(storage, o)
  return removed
}
