// nav-v2-model.test.ts — навигация v2 (дизайн 2026-11-19, «Навигация v2»):
// плашка «Ключ закончится через N дней» за 7 дней до конца, счётчик дня
// маршрута «k из M»; уведомления плеера, выводимые на клиенте (решение
// владельца 2026-11-19 п.2): срок ключа и готовый день, прочитанность — в
// localStorage.
import { describe, it, expect, beforeEach } from 'vitest'
import { daysLabel, expirySoon, routeDayCount, DEMO_EXPIRY_WARN_DAYS } from '../nav-model'
import { deriveNotifications, loadReadIds, markAllRead, unreadCount } from '../notifications'
import type { StateRead } from '../route/use-route-state'
import type { RouteState } from '../route/route-api'
import { st, del, und, TODAY } from '../route/__tests__/route-page-fakes'

const NOW = new Date('2026-11-19T12:00:00Z')
const iso = (days: number, hours = 0) => new Date(NOW.getTime() + days * 86_400_000 + hours * 3_600_000).toISOString()
const okRead = (state: RouteState): StateRead => ({ result: { ok: true, status: 200, data: state }, sent: { watchedSeq: 0, pendingClipPlayed: new Set() } })

describe('expirySoon — плашка срока ключа (7 дней)', () => {
  it('нет даты, неразборная дата, уже истёк — null', () => {
    expect(expirySoon(null, NOW)).toBeNull()
    expect(expirySoon('nope', NOW)).toBeNull()
    expect(expirySoon(iso(-1), NOW)).toBeNull()
    expect(expirySoon(NOW.toISOString(), NOW)).toBeNull()
  })
  it('больше 7 дней — null; ровно 7 дней — плашка', () => {
    expect(expirySoon(iso(7, 1), NOW)).toBeNull()
    expect(expirySoon(iso(8), NOW)).toBeNull()
    expect(expirySoon(iso(7), NOW)).toEqual({ days: 7, until: expect.any(String) })
  })
  it('остаток округляется вверх: 4 дня 3 часа — «через 5 дней»; 2 часа — «через 1 день»', () => {
    expect(expirySoon(iso(4, 3), NOW)?.days).toBe(5)
    expect(expirySoon(iso(0, 2), NOW)?.days).toBe(1)
  })
  it('порог можно сузить (демо — 2 дня)', () => {
    expect(DEMO_EXPIRY_WARN_DAYS).toBe(2)
    expect(expirySoon(iso(3), NOW, 2)).toBeNull()
    expect(expirySoon(iso(2), NOW, 2)?.days).toBe(2)
  })
  it('дата — «24 ноября»', () => {
    expect(expirySoon('2026-11-24T10:00:00Z', NOW)?.until).toBe('24 ноября')
  })
})

describe('daysLabel — формы числа', () => {
  it.each([[1, '1 день'], [2, '2 дня'], [4, '4 дня'], [5, '5 дней'], [7, '7 дней'], [11, '11 дней'], [21, '21 день']])('%i → %s', (n, s) => {
    expect(daysLabel(n)).toBe(s)
  })
})

describe('routeDayCount — «k из M» у «Маршрута»', () => {
  it('нет чтения, ошибка, маршрут не начат, дня нет — null', () => {
    expect(routeDayCount(null)).toBeNull()
    expect(routeDayCount({ result: { ok: false, status: 503, code: 'x', cls: 'temporary', retryAfter: null, body: null }, sent: { watchedSeq: 0, pendingClipPlayed: new Set() } } as unknown as StateRead)).toBeNull()
    expect(routeDayCount(okRead(st(null, { started: false })))).toBeNull()
    expect(routeDayCount(okRead(st(null)))).toBeNull()
  })
  it('день из трёх, один просмотрен — 1 из 3', () => {
    expect(routeDayCount(okRead(st([del(1, { played: true }), del(2), und()])))).toEqual({ k: 1, m: 3 })
  })
  it('ничего не просмотрено — 0 из 2', () => {
    expect(routeDayCount(okRead(st([del(1), und()])))).toEqual({ k: 0, m: 2 })
  })
})

describe('уведомления плеера (решение владельца 2026-11-19 п.2)', () => {
  beforeEach(() => localStorage.clear())
  const session = (over: Partial<{ authenticated: boolean; state: 'active' | 'expired'; keyPrefix: string; keyExpiresAt: string | null }> = {}) => ({
    authenticated: true, state: 'active' as const, keyPrefix: 'tpk_abcd', keyExpiresAt: iso(30), ...over,
  })

  it('гость — уведомлений нет', () => {
    expect(deriveNotifications({ session: session({ authenticated: false, keyExpiresAt: iso(2) }), read: okRead(st([del(1)])), now: NOW, today: TODAY })).toEqual([])
  })

  it('срок ключа ≤ 7 дней — «Ключ закончится через N дней» + «Продлить» на /buy#renew', () => {
    const list = deriveNotifications({ session: session({ keyExpiresAt: iso(4, 3) }), read: null, now: NOW, today: TODAY })
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ kind: 'key', title: 'Ключ закончится через 5 дней', action: { label: 'Продлить', href: '/buy#renew' } })
  })

  // Ревью v2a: демо-ключ короткий — напоминание о сроке только в последние 2 дня
  // (у полного — 7).
  it('демо: 3 дня — без напоминания; 2 дня и меньше — «Ключ закончится через …»', () => {
    const demo = (days: number, hours = 0) => deriveNotifications({ session: { ...session({ keyExpiresAt: iso(days, hours) }), demo: true }, read: null, now: NOW, today: TODAY })
    expect(demo(3)).toEqual([])
    expect(demo(2, 1)).toEqual([])
    expect(demo(2)[0]?.title).toBe('Ключ закончится через 2 дня')
    expect(demo(0, 5)[0]?.title).toBe('Ключ закончится через 1 день')
    // Полный ключ: 5 дней — напоминание есть.
    expect(deriveNotifications({ session: { ...session({ keyExpiresAt: iso(5) }), demo: false }, read: null, now: NOW, today: TODAY })).toHaveLength(1)
  })

  it('срок больше 7 дней, истёкший ключ, бессрочный — без напоминания', () => {
    expect(deriveNotifications({ session: session({ keyExpiresAt: iso(8) }), read: null, now: NOW, today: TODAY })).toEqual([])
    expect(deriveNotifications({ session: session({ keyExpiresAt: iso(2), state: 'expired' }), read: null, now: NOW, today: TODAY })).toEqual([])
    expect(deriveNotifications({ session: session({ keyExpiresAt: null }), read: null, now: NOW, today: TODAY })).toEqual([])
  })

  it('в состоянии маршрута план на сегодня — «День {дата} готов» + «Открыть маршрут» на /app/route', () => {
    const list = deriveNotifications({ session: session(), read: okRead(st([del(1), und()])), now: NOW, today: TODAY })
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ kind: 'day', action: { label: 'Открыть маршрут', href: '/app/route' } })
    expect(list[0].title).toMatch(/^День \d+ [а-я]+ готов$/)
    expect(list[0].desc).toBe('2 ролика · 9 мин')
  })

  it('план вчерашнего дня, маршрут не начат, нет чтения — дня нет', () => {
    const y = st([del(1)])
    y.day = { ...y.day!, date: '2000-01-01' }
    expect(deriveNotifications({ session: session(), read: okRead(y), now: NOW, today: TODAY })).toEqual([])
    expect(deriveNotifications({ session: session(), read: okRead(st(null, { started: false })), now: NOW, today: TODAY })).toEqual([])
  })

  it('порядок: день, затем срок ключа; id различают ключ/дату и маршрут/день', () => {
    const list = deriveNotifications({ session: session({ keyExpiresAt: iso(3) }), read: okRead(st([del(1)])), now: NOW, today: TODAY })
    expect(list.map(n => n.kind)).toEqual(['day', 'key'])
    expect(list[0].id).toContain(TODAY)
    expect(list[1].id).toContain('tpk_abcd')
  })

  it('прочитанность: «Отметить все прочитанными» помнится в localStorage, новый день снова непрочитан', () => {
    const a = deriveNotifications({ session: session({ keyExpiresAt: iso(3) }), read: okRead(st([del(1)])), now: NOW, today: TODAY })
    expect(unreadCount(a, loadReadIds())).toBe(2)
    markAllRead(a)
    expect(unreadCount(a, loadReadIds())).toBe(0)
    const tomorrow = st([del(1)])
    tomorrow.day = { ...tomorrow.day!, date: '2099-01-01' }
    const b = deriveNotifications({ session: session({ keyExpiresAt: iso(3) }), read: okRead(tomorrow), now: NOW, today: '2099-01-01' })
    expect(unreadCount(b, loadReadIds())).toBe(1)
  })

  it('битое значение в localStorage — всё непрочитано, без исключений', () => {
    localStorage.setItem('flib:notif-read', '{oops')
    const a = deriveNotifications({ session: session({ keyExpiresAt: iso(3) }), read: null, now: NOW, today: TODAY })
    expect(unreadCount(a, loadReadIds())).toBe(1)
  })
})
