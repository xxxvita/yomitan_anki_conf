// route-ratings.ts — оценки роликов маршрута в памяти браузера
// `flib:route-ratings` (спека 2026-11-17 §4.6 «Оценка», §4.12, §6.2; план B10b).
//
// Форма: `{v:1, route_id, items:{<puzzle_id>:"like"|"dislike"}}`, ≤ 500 записей,
// старшие (первые по порядку ключей) вытесняются; другой `route_id` —
// содержимое отбрасывается. Шлюз оценок не отдаёт, поэтому подсветка — только
// отсюда, и на другом устройстве её нет (OQ-B3: снять оценку нельзя).
//
// Писатели: кнопки оценки героя и строк дня, `VideoVoteBar` плеера (при `rp`
// или подтверждённом `rc`) — ПОСЛЕ постановки `clip_rated` в очередь.
// Повторное нажатие на выбранную оценку не шлёт ничего (ревью партии 2, L14).
import { ROUTE_RATINGS_KEY, safeLocalStorage } from './route-storage'
import { envelope, clipRatedEvent, type ClipDislikeReason } from '../../../player/route-events/mapper'
import { forDate } from './learning-day'
import type { RouteOutbox } from './outbox'

export type Rating = 'like' | 'dislike'
export const RATINGS_MAX = 500

interface RatingsObj { v: 1; route_id: string; items: Record<string, Rating> }

function parse(raw: string | null): RatingsObj | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as Partial<RatingsObj>
    if (v?.v !== 1 || typeof v.route_id !== 'string' || !v.items || typeof v.items !== 'object') return null
    return v as RatingsObj
  } catch {
    return null
  }
}

// ratingOf — оценка ролика этой эпохи или null.
export function ratingOf(routeId: string | null, puzzleId: string, storage: Storage | null = safeLocalStorage()): Rating | null {
  if (!storage || !routeId) return null
  let o: RatingsObj | null = null
  try { o = parse(storage.getItem(ROUTE_RATINGS_KEY)) } catch { o = null }
  if (!o || o.route_id !== routeId) return null
  const r = o.items[puzzleId]
  return r === 'like' || r === 'dislike' ? r : null
}

// saveRating — запомнить оценку; другая эпоха — объект начинается заново.
export function saveRating(routeId: string, puzzleId: string, rating: Rating, storage: Storage | null = safeLocalStorage()): void {
  if (!storage || !routeId || !puzzleId) return
  let prev: RatingsObj | null = null
  try { prev = parse(storage.getItem(ROUTE_RATINGS_KEY)) } catch { prev = null }
  const o: RatingsObj = prev && prev.route_id === routeId ? prev : { v: 1, route_id: routeId, items: {} }
  delete o.items[puzzleId]
  o.items[puzzleId] = rating
  const ids = Object.keys(o.items)
  for (const id of ids.slice(0, Math.max(0, ids.length - RATINGS_MAX))) delete o.items[id]
  try { storage.setItem(ROUTE_RATINGS_KEY, JSON.stringify(o)) } catch { /* хранилище недоступно */ }
}

export interface RateArgs {
  routeId: string
  puzzleId: string
  rating: Rating
  reason?: ClipDislikeReason
  subsSource: string            // на странице дня — "" (§4.6)
  snapshotDate: string | null
  outbox: Pick<RouteOutbox, 'enqueueDurable' | 'isClosed'>
  storage?: Storage | null
  now?: Date
}

// rateClip — `clip_rated` в очередь, затем запись оценки. Та же оценка уже
// выбрана — ничего (false). «Не нравится» без кода причины — ничего (решение
// владельца 1: голого dislike нет).
export async function rateClip(a: RateArgs): Promise<boolean> {
  const storage = a.storage === undefined ? safeLocalStorage() : a.storage
  if (ratingOf(a.routeId, a.puzzleId, storage) === a.rating) return false
  const now = a.now ?? new Date()
  const ev = clipRatedEvent(a.puzzleId, { rating: a.rating, reason: a.reason, subsSource: a.subsSource }, envelope(forDate(a.snapshotDate, now), now))
  if (!ev || a.outbox.isClosed()) return false
  await a.outbox.enqueueDurable(a.routeId, ev)
  // «Выход» (здесь или в другой вкладке) во время постановки — ключ не пишем.
  if (a.outbox.isClosed()) return false
  saveRating(a.routeId, a.puzzleId, a.rating, storage)
  return true
}
