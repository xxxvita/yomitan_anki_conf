// session.test.ts — модуль сессии кабинета (спека 2026-11-17 §3.3, §3.6):
// снимок, двойное чтение гейта Shadowing, перенос flib:tpk по таблице §3.6,
// стирание старых ключей при входе и выходе, канал вкладок.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  __resetSessionForTests, cabinetLogout, clearLegacyKeys, deleteSession, getSession, loginWithKey,
  migrateLegacyKey, refreshSession, startSession,
} from '../session'
import { hasShadowingAccess } from '../../player/shadow-access'
import { saveAccess } from '../access'

const KEY = 'tpk_' + 'a'.repeat(32)
const ACTIVE = {
  authenticated: true, state: 'active', cabinet: true, key_prefix: 'tpk_aaaa', demo: false,
  key_expires_at: '2026-11-24T00:00:00Z', shadowing: true, route_allowed: true,
}

type Reply = { status: number; body?: unknown; headers?: Record<string, string> } | 'network'

function json(r: Exclude<Reply, 'network'>): Response {
  const body = r.body === undefined ? null : JSON.stringify(r.body)
  return new Response(r.status === 204 ? null : body, { status: r.status, headers: { 'Content-Type': 'application/json', ...(r.headers ?? {}) } })
}

// Фальшивый BFF: очередь ответов на метод (последний повторяется).
function fakeBFF(routes: Partial<Record<'GET' | 'POST' | 'DELETE', Reply[]>>) {
  const calls: { method: string; url: string; init: RequestInit }[] = []
  const f = vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = (init.method ?? 'GET') as 'GET' | 'POST' | 'DELETE'
    calls.push({ method, url, init })
    const q = routes[method] ?? [{ status: 500 }]
    const r = q.length > 1 ? q.shift()! : q[0]
    if (r === 'network') throw new TypeError('offline')
    return json(r)
  })
  vi.stubGlobal('fetch', f)
  return calls
}

const posts = (calls: { method: string }[]) => calls.filter(c => c.method === 'POST').length

function setLegacy() {
  localStorage.setItem('flib:tpk', KEY)
  saveAccess({ shadowing: true, keyPrefix: 'tpk_aaaa', checkedAt: '2026-11-01T00:00:00Z' })
}

describe('session', () => {
  beforeEach(() => { localStorage.clear(); __resetSessionForTests() })
  afterEach(() => { __resetSessionForTests(); vi.unstubAllGlobals(); vi.useRealTimers() })

  describe('снимок', () => {
    it('поле catalog сервера попадает в снимок (и у вошедшего, и у гостя); не true — false', async () => {
    fakeBFF({ GET: [{ status: 200, body: { ...ACTIVE, catalog: true } }] })
    await refreshSession()
    expect(getSession().catalog).toBe(true)
    __resetSessionForTests()
    fakeBFF({ GET: [{ status: 200, body: { authenticated: false, cabinet: true, catalog: true } }] })
    await refreshSession()
    expect(getSession().catalog).toBe(true)
    __resetSessionForTests()
    fakeBFF({ GET: [{ status: 200, body: { ...ACTIVE, catalog: 'yes' } }] })
    await refreshSession()
    expect(getSession().catalog).toBe(false)
    __resetSessionForTests()
    fakeBFF({ GET: [{ status: 200, body: ACTIVE }] })
    await refreshSession()
    expect(getSession().catalog).toBe(false)
  })

  it('404 — сессии на сервере нет (status off)', async () => {
      fakeBFF({ GET: [{ status: 404, body: { error: 'not_found' } }] })
      expect((await refreshSession()).status).toBe('off')
    })

    it('active переносит поля, expired/unknown не дают прав', async () => {
      fakeBFF({ GET: [{ status: 200, body: ACTIVE }] })
      const s = await refreshSession()
      expect(s).toMatchObject({ status: 'ready', authenticated: true, state: 'active', keyPrefix: 'tpk_aaaa', demo: false, shadowing: true, routeAllowed: true })
      __resetSessionForTests()
      fakeBFF({ GET: [{ status: 200, body: { ...ACTIVE, state: 'unknown' } }] })
      expect(await refreshSession()).toMatchObject({ state: 'unknown', shadowing: false, routeAllowed: false })
    })

    it('ошибка сети после ready не меняет режим, но снимает «активна»', async () => {
      fakeBFF({ GET: [{ status: 200, body: ACTIVE }, 'network'] })
      await refreshSession()
      const s = await refreshSession()
      expect(s).toMatchObject({ status: 'ready', cabinet: true, authenticated: true, state: 'unknown', shadowing: false })
    })
  })

  describe('гейт Shadowing — двойное чтение', () => {
    it('при 404 — как origin/main: flib:access', async () => {
      fakeBFF({ GET: [{ status: 404 }] })
      await refreshSession()
      expect(hasShadowingAccess()).toBe(false)
      saveAccess({ shadowing: true, keyPrefix: 'x', checkedAt: 'y' })
      expect(hasShadowingAccess()).toBe(true)
    })

    it('при cabinet:false без сессии — как origin/main', async () => {
      fakeBFF({ GET: [{ status: 200, body: { authenticated: false, cabinet: false } }] })
      await refreshSession()
      saveAccess({ shadowing: true, keyPrefix: 'x', checkedAt: 'y' })
      expect(hasShadowingAccess()).toBe(true)
    })

    it('пока ответа нет — старый путь', () => {
      expect(getSession().status).toBe('loading')
      saveAccess({ shadowing: true, keyPrefix: 'x', checkedAt: 'y' })
      expect(hasShadowingAccess()).toBe(true)
    })

    it('активная сессия отвечает сама, даже против flib:access', async () => {
      saveAccess({ shadowing: true, keyPrefix: 'x', checkedAt: 'y' })
      fakeBFF({ GET: [{ status: 200, body: { ...ACTIVE, shadowing: false } }] })
      await refreshSession()
      expect(hasShadowingAccess()).toBe(false)
    })

    it('активная сессия при cabinet:false (откат флага) тоже отвечает', async () => {
      fakeBFF({ GET: [{ status: 200, body: { ...ACTIVE, cabinet: false } }] })
      await refreshSession()
      expect(hasShadowingAccess()).toBe(true)
    })

    it.each(['expired', 'unknown'])('state:%s — старый путь', async (state) => {
      fakeBFF({ GET: [{ status: 200, body: { ...ACTIVE, state } }] })
      await refreshSession()
      expect(hasShadowingAccess()).toBe(false)
      saveAccess({ shadowing: true, keyPrefix: 'x', checkedAt: 'y' })
      expect(hasShadowingAccess()).toBe(true)
    })
  })

  describe('вход', () => {
    it('POST несёт X-Flib-Request и JSON, успех стирает старые ключи', async () => {
      setLegacy()
      localStorage.setItem('flib:tpk-migrate', JSON.stringify({ fails: 1, last_day: '2026-01-01' }))
      const calls = fakeBFF({ POST: [{ status: 200, body: { key_prefix: 'tpk_aaaa', demo: true, key_expires_at: null, shadowing: true, route_allowed: true } }] })
      expect(await loginWithKey(' ' + KEY + ' ')).toEqual({ kind: 'ok' })
      const h = calls[0].init.headers as Record<string, string>
      expect(h['X-Flib-Request']).toBe('1')
      expect(h['Content-Type']).toBe('application/json')
      expect(JSON.parse(String(calls[0].init.body))).toEqual({ key: KEY })
      expect(localStorage.getItem('flib:tpk')).toBeNull()
      expect(localStorage.getItem('flib:access')).toBeNull()
      expect(localStorage.getItem('flib:tpk-migrate')).toBeNull()
      expect(getSession()).toMatchObject({ authenticated: true, state: 'active', demo: true, cabinet: true })
    })

    it.each([
      [400, { error: 'bad_key_format' }, { kind: 'bad_format' }],
      [401, { error: 'invalid_key' }, { kind: 'invalid' }],
      [403, { error: 'key_expired' }, { kind: 'expired' }],
      [403, { error: 'key_revoked' }, { kind: 'revoked' }],
      [403, { error: 'csrf' }, { kind: 'unavailable' }],
      [404, { error: 'not_found' }, { kind: 'off' }],
      [429, { error: 'too_many_attempts', retry_after_sec: 30 }, { kind: 'too_many', retryAfterSec: 30 }],
      [429, { error: 'busy', retry_after_sec: 2 }, { kind: 'busy', retryAfterSec: 2 }],
      [502, { error: 'gateway_unavailable' }, { kind: 'unavailable' }],
      [503, { error: 'gateway_busy' }, { kind: 'unavailable' }],
    ])('%i %o → %o, старые ключи целы', async (status, body, want) => {
      setLegacy()
      fakeBFF({ POST: [{ status, body }] })
      expect(await loginWithKey(KEY)).toEqual(want)
      expect(localStorage.getItem('flib:tpk')).toBe(KEY)
    })
  })

  describe('перенос flib:tpk (таблица §3.6)', () => {
    const ANON = { status: 200, body: { authenticated: false, cabinet: true } }
    const day1 = new Date(2026, 10, 18, 10)
    const day2 = new Date(2026, 10, 19, 10)
    const day3 = new Date(2026, 10, 20, 10)

    it('200 — вход, оба ключа удалены', async () => {
      setLegacy()
      fakeBFF({ GET: [ANON], POST: [{ status: 200, body: ACTIVE }] })
      await refreshSession()
      expect(await migrateLegacyKey(day1)).toBe('ok')
      expect(localStorage.getItem('flib:tpk')).toBeNull()
      expect(localStorage.getItem('flib:access')).toBeNull()
      expect(getSession().authenticated).toBe(true)
    })

    it('403 key_revoked — оба удалены', async () => {
      setLegacy()
      fakeBFF({ GET: [ANON], POST: [{ status: 403, body: { error: 'key_revoked' } }] })
      await refreshSession()
      expect(await migrateLegacyKey(day1)).toBe('revoked')
      expect(localStorage.getItem('flib:tpk')).toBeNull()
      expect(localStorage.getItem('flib:access')).toBeNull()
    })

    it('401 — оставить, счётчик; в тот же день не повторять; три разных дня — удалить', async () => {
      setLegacy()
      const calls = fakeBFF({ GET: [ANON], POST: [{ status: 401, body: { error: 'invalid_key' } }] })
      await refreshSession()
      expect(await migrateLegacyKey(day1)).toBe('invalid')
      expect(localStorage.getItem('flib:tpk')).toBe(KEY)
      expect(JSON.parse(localStorage.getItem('flib:tpk-migrate')!)).toEqual({ fails: 1, last_day: '2026-11-18' })
      expect(await migrateLegacyKey(day1)).toBe('skipped')
      expect(posts(calls)).toBe(1)
      expect(await migrateLegacyKey(day2)).toBe('invalid')
      expect(localStorage.getItem('flib:tpk')).toBe(KEY)
      expect(await migrateLegacyKey(day3)).toBe('invalid')
      expect(localStorage.getItem('flib:tpk')).toBeNull()
      expect(localStorage.getItem('flib:access')).toBeNull()
      expect(localStorage.getItem('flib:tpk-migrate')).toBeNull()
    })

    it('403 key_expired — оставить, повтор не чаще раза в сутки, счётчик неудач не растёт', async () => {
      setLegacy()
      const calls = fakeBFF({ GET: [ANON], POST: [{ status: 403, body: { error: 'key_expired' } }] })
      await refreshSession()
      expect(await migrateLegacyKey(day1)).toBe('expired')
      expect(await migrateLegacyKey(day1)).toBe('skipped')
      expect(await migrateLegacyKey(day2)).toBe('expired')
      expect(posts(calls)).toBe(2)
      expect(localStorage.getItem('flib:tpk')).toBe(KEY)
      expect(JSON.parse(localStorage.getItem('flib:tpk-migrate')!).fails).toBe(0)
    })

    it.each<[string, Reply]>([
      ['429', { status: 429, body: { error: 'too_many_attempts', retry_after_sec: 30 } }],
      ['502', { status: 502, body: { error: 'gateway_unavailable' } }],
      ['503', { status: 503, body: { error: 'gateway_unavailable' } }],
      ['сеть', 'network'],
    ])('%s — оставить, повтор при следующей загрузке (в тот же день)', async (_n, reply) => {
      setLegacy()
      const calls = fakeBFF({ GET: [ANON], POST: [reply] })
      await refreshSession()
      await migrateLegacyKey(day1)
      await migrateLegacyKey(day1)
      expect(posts(calls)).toBe(2)
      expect(localStorage.getItem('flib:tpk')).toBe(KEY)
      expect(localStorage.getItem('flib:tpk-migrate')).toBeNull()
    })

    it.each<[string, Reply]>([
      ['cabinet:false', { status: 200, body: { authenticated: false, cabinet: false } }],
      ['404', { status: 404, body: { error: 'not_found' } }],
      ['сбой GET', { status: 500 }],
    ])('%s — переноса нет, ключи целы', async (_n, reply) => {
      setLegacy()
      const calls = fakeBFF({ GET: [reply], POST: [{ status: 200, body: ACTIVE }] })
      await refreshSession()
      expect(await migrateLegacyKey(day1)).toBe('skipped')
      expect(posts(calls)).toBe(0)
      expect(localStorage.getItem('flib:tpk')).toBe(KEY)
      expect(localStorage.getItem('flib:access')).not.toBeNull()
    })

    it('уже вошёл (кабинет включён, сессия активна) — переноса нет, старые ключи стёрты при встрече (L-5)', async () => {
      setLegacy()
      const calls = fakeBFF({ GET: [{ status: 200, body: ACTIVE }], POST: [{ status: 200, body: ACTIVE }] })
      await refreshSession()
      expect(await migrateLegacyKey(day1)).toBe('skipped')
      expect(posts(calls)).toBe(0)
      expect(localStorage.getItem('flib:tpk')).toBeNull()
      expect(localStorage.getItem('flib:access')).toBeNull()
    })

    it('активная сессия при cabinet:false (откат) — старые ключи НЕ трогаются', async () => {
      setLegacy()
      fakeBFF({ GET: [{ status: 200, body: { ...ACTIVE, cabinet: false } }] })
      await refreshSession()
      expect(localStorage.getItem('flib:tpk')).toBe(KEY)
    })

    it('мусор в flib:tpk не уходит в запрос', async () => {
      localStorage.setItem('flib:tpk', 'tpk_not-a-key')
      const calls = fakeBFF({ GET: [ANON], POST: [{ status: 200, body: ACTIVE }] })
      await refreshSession()
      expect(await migrateLegacyKey(day1)).toBe('skipped')
      expect(posts(calls)).toBe(0)
    })

    it('сценарий: перенос 429 → ручной вход → ключа нет → «Выход» → перезагрузка не входит', async () => {
      setLegacy()
      const calls = fakeBFF({
        GET: [ANON],
        POST: [{ status: 429, body: { error: 'too_many_attempts', retry_after_sec: 30 } }, { status: 200, body: ACTIVE }],
        DELETE: [{ status: 204 }],
      })
      await startSession()
      expect(localStorage.getItem('flib:tpk')).toBe(KEY) // 429 — ключ оставлен
      expect(await loginWithKey(KEY)).toEqual({ kind: 'ok' }) // ручной вход
      expect(localStorage.getItem('flib:tpk')).toBeNull()
      expect(await cabinetLogout()).toBe(true)
      expect(localStorage.getItem('flib:tpk')).toBeNull()
      expect(localStorage.getItem('flib:access')).toBeNull()
      // «Перезагрузка»: модуль заново, сервер говорит «нет сессии».
      __resetSessionForTests()
      const before = posts(calls)
      await startSession()
      expect(getSession().authenticated).toBe(false)
      expect(posts(calls)).toBe(before)
    })
  })

  describe('выход', () => {
    it('deleteSession (обёртка старого окна) старые ключи НЕ трогает и шлёт X-Flib-Request', async () => {
      setLegacy()
      const calls = fakeBFF({ DELETE: [{ status: 204 }] })
      expect(await deleteSession()).toBe(true)
      expect((calls[0].init.headers as Record<string, string>)['X-Flib-Request']).toBe('1')
      expect(localStorage.getItem('flib:tpk')).toBe(KEY)
    })

    it('deleteSession: 404 (нет SESSION_KEYS) — тоже успех, 403/сеть — нет', async () => {
      fakeBFF({ DELETE: [{ status: 404 }] })
      expect(await deleteSession()).toBe(true)
      fakeBFF({ DELETE: [{ status: 403, body: { error: 'csrf' } }] })
      expect(await deleteSession()).toBe(false)
      fakeBFF({ DELETE: ['network'] })
      expect(await deleteSession()).toBe(false)
    })

    it('cabinetLogout обнуляет снимок и стирает ключи', async () => {
      setLegacy()
      // Второй GET — перечитывание после 204 (F-1): cookie уже нет.
      fakeBFF({ GET: [{ status: 200, body: ACTIVE }, { status: 200, body: { authenticated: false, cabinet: true } }], DELETE: [{ status: 204 }] })
      await refreshSession()
      expect(await cabinetLogout()).toBe(true)
      expect(getSession()).toMatchObject({ authenticated: false, reason: 'self_logout', cabinet: true })
      expect(localStorage.getItem('flib:tpk')).toBeNull()
    })

    it('cabinetLogout при сбое DELETE: ключи стёрты, снимок перечитан, false', async () => {
      setLegacy()
      fakeBFF({ GET: [{ status: 200, body: ACTIVE }], DELETE: ['network'] })
      await refreshSession()
      expect(await cabinetLogout()).toBe(false)
      expect(localStorage.getItem('flib:tpk')).toBeNull()
      expect(getSession().authenticated).toBe(true)
    })

    it('clearLegacyKeys стирает три ключа и не трогает чужие', () => {
      setLegacy()
      localStorage.setItem('flib:tpk-migrate', '{}')
      localStorage.setItem('flib:route', '{}')
      clearLegacyKeys()
      expect(localStorage.getItem('flib:tpk')).toBeNull()
      expect(localStorage.getItem('flib:access')).toBeNull()
      expect(localStorage.getItem('flib:tpk-migrate')).toBeNull()
      expect(localStorage.getItem('flib:route')).toBe('{}')
    })
  })

  describe('вкладки', () => {
    it('logout из другой вкладки обнуляет снимок', async () => {
      fakeBFF({ GET: [{ status: 200, body: ACTIVE }] })
      await startSession()
      expect(getSession().authenticated).toBe(true)
      const other = new BroadcastChannel('flib-session')
      other.postMessage({ type: 'logout' })
      await vi.waitFor(() => expect(getSession()).toMatchObject({ authenticated: false, reason: 'logout' }))
      other.close()
    })

    it('login из другой вкладки перечитывает снимок', async () => {
      const calls = fakeBFF({ GET: [{ status: 200, body: { authenticated: false, cabinet: true } }, { status: 200, body: ACTIVE }] })
      await startSession()
      const other = new BroadcastChannel('flib-session')
      other.postMessage({ type: 'login' })
      await vi.waitFor(() => expect(getSession().authenticated).toBe(true))
      expect(calls.filter(c => c.method === 'GET').length).toBe(2)
      other.close()
    })

    it('возврат на вкладку после 5 мин в фоне перечитывает снимок, раньше — нет', async () => {
      const calls = fakeBFF({ GET: [{ status: 200, body: ACTIVE }] })
      await startSession()
      const now = vi.spyOn(Date, 'now')
      const vis = vi.spyOn(document, 'visibilityState', 'get')
      const flip = (state: 'hidden' | 'visible', t: number) => {
        now.mockReturnValue(t); vis.mockReturnValue(state); document.dispatchEvent(new Event('visibilitychange'))
      }
      flip('hidden', 1_000_000)
      flip('visible', 1_000_000 + 4 * 60_000)
      expect(calls.filter(c => c.method === 'GET').length).toBe(1)
      flip('hidden', 2_000_000)
      flip('visible', 2_000_000 + 6 * 60_000)
      await vi.waitFor(() => expect(calls.filter(c => c.method === 'GET').length).toBe(2))
      now.mockRestore(); vis.mockRestore()
    })
  })
})
