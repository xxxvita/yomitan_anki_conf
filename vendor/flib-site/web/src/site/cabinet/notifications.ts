// notifications.ts — уведомления левого меню плеера (дизайн 2026-11-19 §4,
// решение владельца 2026-11-19 п.2). Сервера уведомлений нет: список выводится
// на клиенте из того, что уже есть сейчас —
//   • «Ключ закончится через N дней» — срок ключа ≤ 7 дней (снимок сессии);
//   • «День {дата} готов» — в состоянии маршрута есть план на сегодня.
// Новостей нет. Прочитанность — в localStorage (`flib:notif-read`): id
// уведомления несёт префикс ключа и срок / маршрут и дату дня, поэтому новый день
// или новый срок снова непрочитаны. Гостю уведомлений нет.
import type { SessionSnapshot } from '../session'
import type { StateRead } from './route/use-route-state'
import { daysLabel, DEMO_EXPIRY_WARN_DAYS, EXPIRY_WARN_DAYS, expirySoon } from './nav-model'
import { RENEW_HREF } from './key-dates'
import { dayLabel } from './route/DayView'
import { minutesOf } from './route/day-actions'
import { plural } from '../plural'

export interface Notif {
  id: string
  kind: 'day' | 'key'
  title: string
  desc: string
  action: { label: string; href: string }
}

export type NotifSession = Pick<SessionSnapshot, 'authenticated' | 'state' | 'keyPrefix' | 'keyExpiresAt'> & { demo?: boolean }

export const NOTIF_READ_KEY = 'flib:notif-read'
const READ_CAP = 50

export function deriveNotifications(o: { session: NotifSession; read: StateRead | null; now: Date; today: string }): Notif[] {
  const s = o.session
  if (!s.authenticated) return []
  const out: Notif[] = []
  const st = o.read && o.read.result.ok ? o.read.result.data : null
  if (st && st.started && st.day && st.day.date === o.today) {
    const clips = st.day.clips
    const sec = clips.reduce((a, c) => a + (typeof c.duration_sec === 'number' ? c.duration_sec : 0), 0)
    const min = minutesOf(sec)
    out.push({
      id: `day:${st.route_id ?? ''}:${st.day.date}`,
      kind: 'day',
      title: `День ${dayLabel(st.day.date)} готов`,
      desc: `${clips.length} ${plural(clips.length, 'ролик', 'ролика', 'роликов')}${min > 0 ? ` · ${min} мин` : ''}`,
      action: { label: 'Открыть маршрут', href: '/app/route' },
    })
  }
  const soon = s.state === 'expired' ? null : expirySoon(s.keyExpiresAt, o.now, s.demo ? DEMO_EXPIRY_WARN_DAYS : EXPIRY_WARN_DAYS)
  if (soon) {
    out.push({
      id: `key:${s.keyPrefix}:${s.keyExpiresAt}`,
      kind: 'key',
      title: `Ключ закончится через ${daysLabel(soon.days)}`,
      desc: `Ключ действует до ${soon.until}. Продлите его — маршрут сохранится.`,
      action: { label: 'Продлить', href: RENEW_HREF },
    })
  }
  return out
}

export function loadReadIds(): Set<string> {
  try {
    const raw = localStorage.getItem(NOTIF_READ_KEY)
    if (!raw) return new Set()
    const v = JSON.parse(raw) as unknown
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

// markAllRead — «Отметить все прочитанными»: id текущего списка в хранилище
// (последние 50, чтобы ключ не рос без конца).
export function markAllRead(list: Notif[]): Set<string> {
  const ids = loadReadIds()
  for (const n of list) { ids.delete(n.id); ids.add(n.id) }
  const arr = Array.from(ids).slice(-READ_CAP)
  try { localStorage.setItem(NOTIF_READ_KEY, JSON.stringify(arr)) } catch { /* хранилище недоступно */ }
  return new Set(arr)
}

export function unreadCount(list: Notif[], read: Set<string>): number {
  return list.filter(n => !read.has(n.id)).length
}
