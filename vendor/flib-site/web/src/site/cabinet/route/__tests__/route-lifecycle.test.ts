// route-lifecycle.test.ts — очередь во вкладке по снимку сессии (ревью партии 2):
// M3 — после 403 и продления ключа очередь снова шлёт; C1 — «Выход» в другой
// вкладке закрывает очередь, новый вход открывает; L3 — коммит в другой вкладке
// снимает удержание queue_full; RL1 — без метки маршрута очередь не запускается.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { __resetSessionForTests, __setSessionForTests } from '../../../session'
import { __resetRouteOutboxForTests, getRouteOutbox } from '../outbox'
import { __resetRouteRuntimeForTests, startRouteRuntime } from '../route-lifecycle'
import { ROUTE_OUTBOX_KEY } from '../route-storage'

// allKeys — ключи хранилища через length/key(i): Object.keys(localStorage) в этой
// среде (jsdom + Node с собственным localStorage) ключей не перечисляет.
const allKeys = () => Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)!)
const ROUTE = '11111111-1111-4111-8111-111111111111'
function marker(on: boolean) {
  document.head.querySelectorAll('meta[name="flib-route"]').forEach(m => m.remove())
  if (!on) return
  const m = document.createElement('meta'); m.setAttribute('name', 'flib-route'); m.setAttribute('content', '1'); document.head.appendChild(m)
}
const json = (st: number, b: unknown) => new Response(JSON.stringify(b), { status: st, headers: { 'Content-Type': 'application/json' } })
const ok = (n: number) => json(200, { accepted: n, duplicates: 0, rejected: [], evicted_external: 0 })
const wait = (ms: number) => new Promise(r => setTimeout(r, ms))
const ev = (id: string, type = 'clip_rated') => ({ event_id: id, type, puzzle_id: 'youtube::abcdefghijk', rating: 'like' })

let reply: (body: { events: unknown[] }) => Response
let posts: number
// session — ответ GET /api/session (null — 404, как раньше); sessionGets — сколько раз читали.
let session: unknown
let sessionGets: number
beforeEach(() => {
  __resetSessionForTests(); __resetRouteOutboxForTests(); __resetRouteRuntimeForTests()
  localStorage.clear(); posts = 0; session = null; sessionGets = 0
  reply = b => ok(b.events.length)
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    if (url === '/api/me/route/events') { posts++; return reply(JSON.parse(String(init.body))) }
    if (url === '/api/session') { sessionGets++; return session === null ? json(404, {}) : json(200, session) }
    return json(404, {})
  }))
})
const ACTIVE = { cabinet: true, authenticated: true, state: 'active', key_prefix: 'tpk_ab12', demo: false }
afterEach(() => { marker(false); vi.unstubAllGlobals(); __resetRouteOutboxForTests(); __resetSessionForTests() })

describe('route-lifecycle', () => {
  it('M3: 403 key_expired → снимок expired → active (ключ продлён) — очередь снова шлёт', async () => {
    marker(true)
    reply = () => json(403, { error: 'key_expired' })
    __setSessionForTests({ cabinet: true, authenticated: true, state: 'active' })
    startRouteRuntime()
    const box = getRouteOutbox()
    box.enqueue(ROUTE, ev('web:1'))
    await wait(30)
    expect(posts).toBe(1)
    __setSessionForTests({ cabinet: true, authenticated: true, state: 'expired' })
    reply = b => ok(b.events.length)
    __setSessionForTests({ cabinet: true, authenticated: true, state: 'active' })
    expect(await box.flush({ timeoutMs: 2000 })).toBe('sent')
    expect(JSON.parse(localStorage.getItem(ROUTE_OUTBOX_KEY)!).items).toEqual([])
  })

  it('R-M3: 403 key_expired, снимок сессии ни разу не покидал active; ключ продлён → снимок снова active → очередь шлёт сохранённое', async () => {
    marker(true)
    session = ACTIVE // BFF ещё считает ключ живым: перехода нет вовсе
    reply = () => json(403, { error: 'key_expired' })
    __setSessionForTests({ cabinet: true, authenticated: true, state: 'active' })
    startRouteRuntime()
    const box = getRouteOutbox()
    box.enqueue(ROUTE, ev('web:1'))
    await wait(50)
    expect(posts).toBe(2) // отказ → перечитали сессию → active → одна повторная попытка → снова отказ
    expect(sessionGets).toBe(1)
    await wait(200)
    expect(posts).toBe(2) // петли нет: второе перечитывание — не раньше чем через минуту
    box.enqueue(ROUTE, ev('web:2'))
    reply = b => ok(b.events.length) // ключ продлён (биллинг продлевает тот же ключ, сообщения о входе нет)
    __setSessionForTests({ cabinet: true, authenticated: true, state: 'active' }) // возврат на вкладку
    expect(await box.flush({ timeoutMs: 2000 })).toBe('sent')
    expect(JSON.parse(localStorage.getItem(ROUTE_OUTBOX_KEY)!).items).toEqual([])
  })

  it('R-M3/R-L4: 401 на события — сессию перечитывают; она кончилась → очередь закрыта, новые события не ставятся и не шлются', async () => {
    marker(true)
    session = { cabinet: true, authenticated: false, reason: 'session_expired' }
    reply = () => json(401, { error: 'session_invalid' })
    __setSessionForTests({ cabinet: true, authenticated: true, state: 'active' })
    startRouteRuntime()
    const box = getRouteOutbox()
    box.enqueue(ROUTE, ev('web:1'))
    await wait(50)
    expect(sessionGets).toBe(1)
    expect(box.isClosed()).toBe(true)
    box.enqueue(ROUTE, ev('web:2', 'hint_requested'))
    await wait(30)
    expect(posts).toBe(1)
  })

  it('C1: «Выход» в другой вкладке закрывает очередь; новый вход открывает', async () => {
    marker(true)
    __setSessionForTests({ cabinet: true, authenticated: true, state: 'active' })
    startRouteRuntime()
    const box = getRouteOutbox()
    __setSessionForTests({ cabinet: true, authenticated: false, reason: 'logout' })
    box.enqueue(ROUTE, ev('web:after-logout'))
    await box.enqueueDurable(ROUTE, ev('web:after-logout-2', 'clip_played'))
    await wait(30)
    expect(allKeys().filter(k => k.startsWith('flib:route'))).toEqual([])
    __setSessionForTests({ cabinet: true, authenticated: true, state: 'active' })
    box.enqueue(ROUTE, ev('web:after-login'))
    await wait(30)
    expect(posts).toBe(1)
  })

  it('L3: коммит обмена в другой вкладке (канал flib-route) снимает удержание queue_full', async () => {
    marker(true)
    __setSessionForTests({ cabinet: true, authenticated: true, state: 'active' })
    startRouteRuntime()
    const box = getRouteOutbox()
    reply = () => json(429, { error: 'queue_full' })
    box.enqueue(ROUTE, ev('web:held'))
    await wait(30)
    expect(await box.flush({ timeoutMs: 500 })).toBe('refused')
    reply = b => ok(b.events.length)
    const ch = new BroadcastChannel('flib-route'); ch.postMessage({ revision: 9 }); ch.close()
    await wait(50)
    expect(await box.flush({ timeoutMs: 2000 })).toBe('sent')
  })

  it('RL1: без метки маршрута очередь не запускается и сохранённое не шлёт', async () => {
    localStorage.setItem(ROUTE_OUTBOX_KEY, JSON.stringify({ v: 2, items: [{ route_id: ROUTE, event: ev('web:old') }] }))
    marker(false)
    __setSessionForTests({ cabinet: true, authenticated: true, state: 'active' })
    startRouteRuntime()
    await wait(50)
    expect(posts).toBe(0)
    __resetRouteRuntimeForTests()
    marker(true)
    startRouteRuntime()
    await wait(50)
    expect(posts).toBe(1)
  })
})
