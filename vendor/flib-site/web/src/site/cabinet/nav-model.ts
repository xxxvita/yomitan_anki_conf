// nav-model.ts — навигация кабинета v2 (дизайн владельца 2026-11-19,
// docs/design/cabinet-2026-11-19/README.md «Навигация v2»): плашка срока ключа
// за 7 дней до конца и счётчик дня маршрута «k из M» у пункта «Маршрут».
// Чистые функции: без запросов и без React.
import { plural } from '../plural'
import { untilLong } from './key-dates'
import type { StateRead } from './route/use-route-state'
import { buildDayModel } from './route/day-model'
import { localDayInputs } from './route/local-inputs'

// EXPIRY_WARN_DAYS — за сколько дней до конца ключа показывать плашку
// «Ключ закончится через N дней» (дизайн: «За 7 дней до конца»).
export const EXPIRY_WARN_DAYS = 7
// DEMO_EXPIRY_WARN_DAYS — демо-ключ короткий: напоминание в уведомлениях только в
// последние 2 дня (иначе оно висело бы почти весь срок).
export const DEMO_EXPIRY_WARN_DAYS = 2
const DAY_MS = 86_400_000

// daysLabel — «1 день», «2 дня», «5 дней».
export function daysLabel(n: number): string {
  return `${n} ${plural(n, 'день', 'дня', 'дней')}`
}

// expirySoon — ключ кончается в ближайшие 7 дней: сколько дней осталось
// (округление вверх: 4 дня 3 часа — «через 5 дней») и дата «24 ноября».
// Нет даты, неразборная дата, срок уже прошёл — null.
export function expirySoon(iso: string | null, now: Date = new Date(), maxDays: number = EXPIRY_WARN_DAYS): { days: number; until: string } | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  const left = t - now.getTime()
  if (left <= 0) return null
  const days = Math.ceil(left / DAY_MS)
  if (days > maxDays) return null
  const until = untilLong(iso, now)
  return until ? { days, until } : null
}

// routeDayCount — «k из M» дня маршрута из ОБЩЕГО чтения состояния вкладки (без
// своего запроса): k — просмотренные, M — роликов в дне (та же модель дня, что у
// страницы маршрута и Главной). Маршрут не начат, дня нет, чтения нет — null.
export function routeDayCount(read: StateRead | null): { k: number; m: number } | null {
  if (!read || !read.result.ok) return null
  const st = read.result.data
  if (!st.started || !st.day) return null
  const model = buildDayModel(st, localDayInputs(st, read.sent))
  if (model.total <= 0) return null
  return { k: model.watchedCount, m: model.total }
}
