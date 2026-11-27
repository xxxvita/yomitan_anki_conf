// route-logout.test.ts — «Выход» с маршрутом кабинета (план B6, спека §4.8, §6.2,
// R2-C1): выгрузка очереди ДО DELETE (cookie ещё жива), после удачного выхода в
// localStorage нет ни одного из пяти ключей маршрута; неудачный выход ничего не
// стирает; без метки маршрута «Выход» прежний (ключи маршрута не трогает).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { __resetSessionForTests, __setSessionForTests, cabinetLogout } from '../../../session'
import { __resetRouteOutboxForTests, getRouteOutbox } from '../outbox'
import { __resetRouteRuntimeForTests, startRouteRuntime } from '../route-lifecycle'

const FIVE_KEYS = ['flib:route-outbox', 'flib:route-ratings', 'flib:route-watched', 'flib:route-lesson', 'flib:examples-cache', 'flib:route-outbox-unload:pA', 'flib:route-outbox-unload:pB']

function setRouteMarker(on: boolean): void {
  document.head.querySelectorAll('meta[name="flib-route"]').forEach(m => m.remove())
  if (!on) return
  const m = document.createElement('meta')
  m.setAttribute('name', 'flib-route')
  m.setAttribute('content', '1')
  document.head.appendChild(m)
}

function resp(status: number, body?: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body ?? {}), { status, headers: { 'Content-Type': 'application/json' } })
}

const ROUTE = '11111111-1111-4111-8111-111111111111'

function stubBFF(deleteOK: boolean) {
  const calls: string[] = []
  let cookie = true
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET'
    calls.push(`${method} ${url}`)
    if (url === '/api/me/route/events') {
      const body = JSON.parse(String(init.body))
      return resp(200, { accepted: body.events.length, duplicates: 0, rejected: [], evicted_external: 0 })
    }
    if (url === '/api/session') {
      if (method === 'DELETE') {
        if (!deleteOK) throw new TypeError('Failed to fetch')
        cookie = false
        return resp(204)
      }
      return cookie
        ? resp(200, { authenticated: true, state: 'active', cabinet: true, key_prefix: 'tpk_a', demo: false, route_allowed: true })
        : resp(200, { authenticated: false, cabinet: true })
    }
    return resp(404)
  }))
  return calls
}

beforeEach(() => {
  __resetSessionForTests()
  __resetRouteOutboxForTests()
  __resetRouteRuntimeForTests()
  localStorage.clear()
})
afterEach(() => {
  vi.unstubAllGlobals()
  setRouteMarker(false)
})

describe('«Выход» и ключи маршрута', () => {
  it('очередь выгружается до DELETE, после выхода пяти ключей нет', async () => {
    setRouteMarker(true)
    const calls = stubBFF(true)
    __setSessionForTests({ cabinet: true, authenticated: true, state: 'active' })
    startRouteRuntime()
    for (const k of FIVE_KEYS) if (k !== 'flib:route-outbox') localStorage.setItem(k, '{"v":1}')
    getRouteOutbox().enqueue(ROUTE, { event_id: 'web:1', type: 'hint_requested', puzzle_id: 'youtube::abcdefghijk', lemmas: ['cat'] })
    expect(await cabinetLogout()).toBe(true)
    const ev = calls.indexOf('POST /api/me/route/events')
    const del = calls.indexOf('DELETE /api/session')
    expect(ev).toBeGreaterThanOrEqual(0)
    expect(ev).toBeLessThan(del)
    for (const k of FIVE_KEYS) expect(localStorage.getItem(k)).toBeNull()
  })

  it('после удачного выхода стирается история «Моих знаний» всех ключей; после неудачного — остаётся', async () => {
    stubBFF(true)
    __setSessionForTests({ cabinet: true, authenticated: true, state: 'active' })
    localStorage.setItem('flib:knowledge-sources:v1:tpk_a', '[]')
    localStorage.setItem('flib:knowledge-sources:v1', '[]')
    localStorage.setItem('flib:other', 'keep')
    expect(await cabinetLogout()).toBe(true)
    expect(localStorage.getItem('flib:knowledge-sources:v1:tpk_a')).toBeNull()
    expect(localStorage.getItem('flib:knowledge-sources:v1')).toBeNull()
    expect(localStorage.getItem('flib:other')).toBe('keep')
    __resetSessionForTests()
    stubBFF(false)
    __setSessionForTests({ cabinet: true, authenticated: true, state: 'active' })
    localStorage.setItem('flib:knowledge-sources:v1:tpk_a', '[]')
    expect(await cabinetLogout()).toBe(false)
    expect(localStorage.getItem('flib:knowledge-sources:v1:tpk_a')).toBe('[]')
  })

  it('неудачный выход ключи маршрута не стирает', async () => {
    setRouteMarker(true)
    stubBFF(false)
    __setSessionForTests({ cabinet: true, authenticated: true, state: 'active' })
    startRouteRuntime()
    localStorage.setItem('flib:route-ratings', '{"v":1}')
    expect(await cabinetLogout()).toBe(false)
    expect(localStorage.getItem('flib:route-ratings')).toBe('{"v":1}')
  })

  it('без метки маршрута очередь не запускается и «Выход» не шлёт событий', async () => {
    setRouteMarker(false)
    const calls = stubBFF(true)
    __setSessionForTests({ cabinet: true, authenticated: true, state: 'active' })
    startRouteRuntime()
    expect(await cabinetLogout()).toBe(true)
    expect(calls.some(c => c.includes('/api/me/route/'))).toBe(false)
  })
})
