// session-logout-f3.test.tsx — финальное diff-ревью PR-A, F-3: ответ на
// первый DELETE /api/session потерян (сеть, 52x по дороге назад, срок 10 с), а
// BFF выход обработал и положил надгробие. Cookie в браузере осталась;
// перечитывание отвечает logged_out — и раньше окно говорило «Вы вышли из
// кабинета», хотя через 10 минут (срок надгробия) сессия снова жива.
//
// Правило (решение координатора): «вышел» — только после удачного
// перечитывания, не показавшего cookie (ready, не вошёл, reason не logged_out
// и не unreadable). Всё прочее — «Не удалось выйти. Попробуйте ещё раз».
// Плюс: вкладка, чьё свежее чтение ответило logged_out, один раз шлёт DELETE —
// стереть оставшуюся cookie.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { CabinetLayout } from '../cabinet/CabinetLayout'
import { CabinetHome } from '../cabinet/CabinetHome'
import { LoginPage } from '../LoginPage'
import {
  __resetSessionForTests, __setSessionForTests, cabinetLogout, getSession, loginWithKey, refreshSession, startSession, subscribeSession,
} from '../session'
import { setCabinetMarker } from './cabinet-marker'

const KEY = 'tpk_' + 'a'.repeat(32)
const ACTIVE = {
  authenticated: true, state: 'active', cabinet: true, key_prefix: 'tpk_aaaa', demo: false,
  key_expires_at: null, shadowing: true, route_allowed: true,
}
const LOGIN_OK = { key_prefix: 'tpk_aaaa', demo: false, key_expires_at: null, shadowing: true, route_allowed: true }

function resp(status: number, body?: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body ?? {}), { status, headers: { 'Content-Type': 'application/json' } })
}

// Как обработает DELETE «сеть» между браузером и BFF:
//   ok   — BFF обработал, 204 с Set-Cookie дошёл: cookie стёрта;
//   lost — BFF обработал (надгробие), ответ потерян: fetch падает, cookie осталась;
//   hang — BFF обработал (надгробие), ответ не приходит, пока клиент не оборвёт.
type Del = 'ok' | 'lost' | 'hang'

interface Jar { cookie: 'live' | 'tomb' | 'none'; calls: string[]; deleteHeaders: Record<string, string>[] }

// tombBFF — фальшивый BFF с надгробием и «банкой» cookie браузера. GET: нет
// cookie — {authenticated:false}; cookie с надгробием — logged_out; живая —
// «вошёл». dels — исходы DELETE по порядку (последний повторяется).
function tombBFF(dels: Del[]): Jar {
  const jar: Jar = { cookie: 'live', calls: [], deleteHeaders: [] }
  vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET'
    if (url !== '/api/session') return Promise.resolve(resp(404, {}))
    jar.calls.push(method)
    if (method === 'DELETE') {
      jar.deleteHeaders.push({ ...(init.headers as Record<string, string>) })
      const d = dels.length > 1 ? dels.shift()! : dels[0]
      if (jar.cookie === 'live') jar.cookie = 'tomb' // BFF обработал: надгробие sid
      if (d === 'ok') { jar.cookie = 'none'; return Promise.resolve(resp(204)) }
      if (d === 'lost') return Promise.reject(new TypeError('Failed to fetch'))
      return new Promise<Response>((_res, rej) => {
        init.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))
      })
    }
    if (method === 'POST') { jar.cookie = 'live'; return Promise.resolve(resp(200, LOGIN_OK)) }
    if (jar.cookie === 'none') return Promise.resolve(resp(200, { authenticated: false, cabinet: true }))
    if (jar.cookie === 'tomb') return Promise.resolve(resp(200, { authenticated: false, cabinet: true, reason: 'logged_out' }))
    return Promise.resolve(resp(200, ACTIVE))
  }))
  return jar
}

function renderCabinet() {
  return render(
    <MemoryRouter initialEntries={['/app']}>
      <Routes>
        <Route path="/app" element={<CabinetLayout />}><Route index element={<CabinetHome />} /></Route>
        <Route path="/login" element={<LoginPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

const FAILED = 'Не удалось выйти. Попробуйте ещё раз'
const LOGGED_OUT_NOTICE = 'Вы вышли из кабинета'

describe('F-3: ответ на первый DELETE потерян', () => {
  beforeEach(() => { localStorage.clear(); __resetSessionForTests(); setCabinetMarker(true); window.scrollTo = vi.fn() as unknown as typeof window.scrollTo })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); __resetSessionForTests(); setCabinetMarker(false) })

  describe('окно кабинета (настоящие CabinetLayout и LoginPage)', () => {
    it('ответ потерян (сеть), повтор DELETE дошёл — cookie стёрта, вход без «Вы вышли»', async () => {
      const jar = tombBFF(['lost', 'ok'])
      renderCabinet()
      fireEvent.click(await screen.findByRole('button', { name: 'Выход' }))
      expect(await screen.findByRole('heading', { name: 'Вход' })).toBeTruthy()
      expect(jar.cookie).toBe('none')
      expect(screen.queryByText(LOGGED_OUT_NOTICE)).toBeNull()
      expect(jar.calls).toEqual(['GET', 'DELETE', 'GET', 'DELETE', 'GET'])
    })

    it('ответ потерян (сеть) и повторы тоже — «Не удалось выйти», не «Вы вышли»', async () => {
      const jar = tombBFF(['lost'])
      renderCabinet()
      fireEvent.click(await screen.findByRole('button', { name: 'Выход' }))
      expect(await screen.findByText(FAILED)).toBeTruthy()
      expect(screen.queryByText(LOGGED_OUT_NOTICE)).toBeNull()
      expect(screen.queryByRole('heading', { name: 'Вход' })).toBeNull()
      expect(jar.cookie).toBe('tomb')
      expect(getSession().reason).not.toBe('self_logout')
    })

    it('ответ не пришёл за 10 с, повтор DELETE дошёл — cookie стёрта, вход без «Вы вышли»', async () => {
      vi.useFakeTimers()
      const jar = tombBFF(['hang', 'ok'])
      renderCabinet()
      await act(async () => { await vi.advanceTimersByTimeAsync(0) })
      fireEvent.click(screen.getByRole('button', { name: 'Выход' }))
      await act(async () => { await vi.advanceTimersByTimeAsync(10_500) })
      expect(screen.getByRole('heading', { name: 'Вход' })).toBeTruthy()
      expect(jar.cookie).toBe('none')
      expect(screen.queryByText(LOGGED_OUT_NOTICE)).toBeNull()
    })

    it('ответы не приходят вовсе — через срок «Не удалось выйти», не «Вы вышли»', async () => {
      vi.useFakeTimers()
      const jar = tombBFF(['hang'])
      renderCabinet()
      await act(async () => { await vi.advanceTimersByTimeAsync(0) })
      fireEvent.click(screen.getByRole('button', { name: 'Выход' }))
      await act(async () => { await vi.advanceTimersByTimeAsync(10_500) })
      expect(screen.queryByText(LOGGED_OUT_NOTICE)).toBeNull()
      expect(screen.queryByRole('heading', { name: 'Вход' })).toBeNull()
      await act(async () => { await vi.advanceTimersByTimeAsync(10_500) })
      expect(screen.getByText(FAILED)).toBeTruthy()
      expect(screen.queryByText(LOGGED_OUT_NOTICE)).toBeNull()
      expect(jar.cookie).toBe('tomb')
    })
  })

  describe('cabinetLogout', () => {
    it('ответ потерян, перечитывание — logged_out: DELETE повторяется, «вышел» после чистого чтения', async () => {
      __setSessionForTests({ cabinet: true, authenticated: true, state: 'active' })
      const jar = tombBFF(['lost', 'ok'])
      expect(await cabinetLogout()).toBe(true)
      expect(jar.calls).toEqual(['DELETE', 'GET', 'DELETE', 'GET'])
      expect(jar.cookie).toBe('none')
      expect(getSession()).toMatchObject({ authenticated: false, reason: 'self_logout' })
    })

    it('ответ потерян, все повторы тоже — false, снимок не трогается', async () => {
      __setSessionForTests({ cabinet: true, authenticated: true, state: 'active' })
      const jar = tombBFF(['lost'])
      const seen: boolean[] = []
      const off = subscribeSession(() => { seen.push(getSession().authenticated) })
      expect(await cabinetLogout()).toBe(false)
      off()
      expect(jar.calls).toEqual(['DELETE', 'GET', 'DELETE'])
      expect(getSession()).toMatchObject({ authenticated: true, state: 'active' })
      // Снимок ни разу не становился «не вошёл» (logout/self_logout): охрана
      // кабинета не уводит на /login.
      expect(seen.includes(false)).toBe(false)
    })
  })

  it('выход не удался, сервер отвечает «вошёл» с другими данными — снимок берётся из ответа', async () => {
    // До выхода снимок устарел (шлюз был недоступен: state unknown, старый срок).
    __setSessionForTests({ cabinet: true, authenticated: true, state: 'unknown', keyPrefix: 'tpk_old0', keyExpiresAt: '2026-01-01T00:00:00Z' })
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit = {}) => {
      if ((init.method ?? 'GET') === 'DELETE') throw new TypeError('offline')
      return resp(200, { ...ACTIVE, key_expires_at: '2026-12-24T00:00:00Z' })
    }))
    expect(await cabinetLogout()).toBe(false)
    expect(getSession()).toMatchObject({
      authenticated: true, state: 'active', keyPrefix: 'tpk_aaaa', keyExpiresAt: '2026-12-24T00:00:00Z', routeAllowed: true, failures: 0,
    })
  })

  describe('перечитывание не удалось', () => {
    for (const fail of ['network', '502', '404'] as const) {
      it(`DELETE 204, перечитывания падают (${fail}) — false, «вышел» не говорим`, async () => {
        __setSessionForTests({ cabinet: true, authenticated: true, state: 'active' })
        const calls: string[] = []
        vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit = {}) => {
          const method = init.method ?? 'GET'
          calls.push(method)
          if (method === 'DELETE') return resp(204)
          if (fail === 'network') throw new TypeError('offline')
          return resp(fail === '502' ? 502 : 404, {})
        }))
        expect(await cabinetLogout()).toBe(false)
        expect(getSession().reason).not.toBe('self_logout')
        expect(getSession()).toMatchObject({ authenticated: true, state: 'active' })
        expect(calls.filter(m => m === 'DELETE').length).toBeLessThanOrEqual(3)
        expect(calls.filter(m => m === 'GET').length).toBeLessThanOrEqual(3)
      })
    }

    it('DELETE 204, первое перечитывание упало, второе чистое — «вышел»', async () => {
      __setSessionForTests({ cabinet: true, authenticated: true, state: 'active' })
      let reads = 0
      vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit = {}) => {
        if ((init.method ?? 'GET') === 'DELETE') return resp(204)
        if (++reads === 1) throw new TypeError('offline')
        return resp(200, { authenticated: false, cabinet: true })
      }))
      expect(await cabinetLogout()).toBe(true)
      expect(getSession()).toMatchObject({ authenticated: false, reason: 'self_logout' })
    })
  })

  describe('перечитывание ответило unreadable (cookie предъявлена, сервер её не стёр)', () => {
    it('всё время unreadable — false, «вышел» не говорим', async () => {
      __setSessionForTests({ cabinet: true, authenticated: true, state: 'active' })
      const calls: string[] = []
      vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit = {}) => {
        const method = init.method ?? 'GET'
        calls.push(method)
        if (method === 'DELETE') return resp(204)
        return resp(200, { authenticated: false, cabinet: true, reason: 'unreadable' })
      }))
      expect(await cabinetLogout()).toBe(false)
      expect(calls).toEqual(['DELETE', 'GET', 'DELETE', 'GET', 'DELETE', 'GET'])
      expect(getSession().reason).not.toBe('self_logout')
      expect(getSession().authenticated).toBe(true)
    })

    it('unreadable, повтор DELETE стёр cookie — «вышел»', async () => {
      __setSessionForTests({ cabinet: true, authenticated: true, state: 'active' })
      const calls: string[] = []
      let out = false
      vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit = {}) => {
        const method = init.method ?? 'GET'
        calls.push(method)
        if (method === 'DELETE') { if (calls.filter(m => m === 'DELETE').length > 1) out = true; return resp(204) }
        return resp(200, out ? { authenticated: false, cabinet: true } : { authenticated: false, cabinet: true, reason: 'unreadable' })
      }))
      expect(await cabinetLogout()).toBe(true)
      expect(calls).toEqual(['DELETE', 'GET', 'DELETE', 'GET'])
      expect(getSession()).toMatchObject({ authenticated: false, reason: 'self_logout' })
    })
  })
})

describe('F-3, правило 2: вкладка со свежим logged_out стирает оставшуюся cookie', () => {
  beforeEach(() => { localStorage.clear(); __resetSessionForTests(); setCabinetMarker(true) })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); __resetSessionForTests(); setCabinetMarker(false) })

  it('чтение ответило logged_out — один DELETE с заголовком CSRF, снимок «вы вышли»', async () => {
    const jar = tombBFF(['ok'])
    jar.cookie = 'tomb' // надгробие от выхода, ответ на который потерян
    expect(await refreshSession()).toMatchObject({ authenticated: false, reason: 'logout' })
    await waitFor(() => expect(jar.calls).toEqual(['GET', 'DELETE']))
    expect(jar.deleteHeaders[0]).toMatchObject({ 'X-Flib-Request': '1' })
    expect(jar.cookie).toBe('none')
    expect(getSession()).toMatchObject({ authenticated: false, reason: 'logout' })
  })

  it('не больше одного DELETE до следующего входа: повторные logged_out не шлют новых', async () => {
    const jar = tombBFF(['lost']) // DELETE не доходит — cookie остаётся
    jar.cookie = 'tomb'
    await refreshSession()
    await refreshSession()
    await refreshSession()
    await new Promise(r => setTimeout(r, 0))
    expect(jar.calls.filter(m => m === 'DELETE')).toHaveLength(1)
    expect(jar.calls.filter(m => m === 'GET')).toHaveLength(3)
  })

  it('после входа в этой вкладке — снова можно один раз', async () => {
    const jar = tombBFF(['lost'])
    jar.cookie = 'tomb'
    await refreshSession()
    await new Promise(r => setTimeout(r, 0))
    expect(await loginWithKey(KEY)).toEqual({ kind: 'ok' })
    jar.cookie = 'tomb' // эту сессию тоже «вышли» с потерянным ответом
    await refreshSession()
    await refreshSession()
    await new Promise(r => setTimeout(r, 0))
    expect(jar.calls.filter(m => m === 'DELETE')).toHaveLength(2)
  })

  it('чтение, начатое до входа в этой вкладке, ответило logged_out — DELETE не шлётся', async () => {
    const calls: string[] = []
    let releaseOld: (r: Response) => void = () => {}
    let gets = 0
    vi.stubGlobal('fetch', vi.fn((_u: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET'
      calls.push(method)
      if (method === 'POST') return Promise.resolve(resp(200, LOGIN_OK))
      if (method === 'DELETE') return Promise.resolve(resp(204))
      if (++gets === 1) return new Promise<Response>(res => { releaseOld = res })
      return Promise.resolve(resp(200, ACTIVE))
    }))
    const old = refreshSession() // старая cookie, ответ ещё в пути
    expect(await loginWithKey(KEY)).toEqual({ kind: 'ok' })
    releaseOld(resp(200, { authenticated: false, cabinet: true, reason: 'logged_out' }))
    await old
    await new Promise(r => setTimeout(r, 0))
    expect(calls).not.toContain('DELETE') // новую cookie не стираем
    expect(getSession()).toMatchObject({ authenticated: true, state: 'active' })
  })

  for (const reason of ['unreadable', 'invalid', 'revoked', 'session_expired', undefined] as const) {
    it(`чтение ответило ${reason ?? 'без reason'} — уборки нет (cookie по unreadable не стирается, утверждение 3)`, async () => {
      const calls: string[] = []
      vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit = {}) => {
        calls.push(init.method ?? 'GET')
        return resp(200, { authenticated: false, cabinet: true, ...(reason ? { reason } : {}) })
      }))
      await refreshSession()
      await new Promise(r => setTimeout(r, 0))
      expect(calls).toEqual(['GET'])
    })
  }

  it('вход в другой вкладке (сообщение login) — снова можно один раз', async () => {
    const jar = tombBFF(['lost'])
    jar.cookie = 'tomb'
    await startSession()
    await new Promise(r => setTimeout(r, 0))
    expect(jar.calls.filter(m => m === 'DELETE')).toHaveLength(1)
    const other = new BroadcastChannel('flib-session')
    other.postMessage({ type: 'login' }) // новая cookie; её тоже «вышли» с потерянным ответом
    await waitFor(() => expect(jar.calls.filter(m => m === 'GET')).toHaveLength(2))
    other.close()
    await waitFor(() => expect(jar.calls.filter(m => m === 'DELETE')).toHaveLength(2))
  })

  it('сообщение logout из другой вкладки (не ответ сервера) DELETE не шлёт', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit = {}) => {
      calls.push(init.method ?? 'GET')
      return resp(200, ACTIVE)
    }))
    await startSession()
    const other = new BroadcastChannel('flib-session')
    other.postMessage({ type: 'logout' })
    await waitFor(() => expect(getSession().reason).toBe('logout'))
    other.close()
    await new Promise(r => setTimeout(r, 0))
    expect(calls).not.toContain('DELETE')
  })

  it('вход ждёт DELETE-уборку, начатую раньше: POST уходит после ответа на DELETE', async () => {
    const calls: string[] = []
    let releaseDel: () => void = () => {}
    vi.stubGlobal('fetch', vi.fn((_u: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET'
      calls.push(method)
      if (method === 'DELETE') return new Promise<Response>(res => { releaseDel = () => res(resp(204)) })
      if (method === 'POST') return Promise.resolve(resp(200, LOGIN_OK))
      return Promise.resolve(resp(200, { authenticated: false, cabinet: true, reason: 'logged_out' }))
    }))
    await refreshSession()
    await new Promise(r => setTimeout(r, 0))
    expect(calls).toEqual(['GET', 'DELETE'])
    const login = loginWithKey(KEY)
    await new Promise(r => setTimeout(r, 0))
    expect(calls).toEqual(['GET', 'DELETE']) // POST ждёт, иначе ответ DELETE мог бы стереть новую cookie
    releaseDel()
    expect(await login).toEqual({ kind: 'ok' })
    expect(calls).toEqual(['GET', 'DELETE', 'POST'])
  })

  it('перечитывания внутри «Выхода» уборку не запускают: DELETE только от самого выхода', async () => {
    __setSessionForTests({ cabinet: true, authenticated: true, state: 'active' })
    const jar = tombBFF(['lost', 'ok'])
    expect(await cabinetLogout()).toBe(true)
    await new Promise(r => setTimeout(r, 0))
    expect(jar.calls).toEqual(['DELETE', 'GET', 'DELETE', 'GET'])
  })
})
