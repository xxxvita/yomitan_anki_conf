// review-a5a8.test.tsx — находки адверсариального ревью A5–A8 (site-A5-A8-review.md),
// перенесённые из PoC в настоящие тесты: каждый падал на dcc4c7e.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { ModulesPage } from '../ModulesPage'
import { LoginPage } from '../LoginPage'
import { CabinetLayout } from '../cabinet/CabinetLayout'
import { CabinetHome } from '../cabinet/CabinetHome'
import {
  __resetSessionForTests, startSession, getSession, cabinetLogout, refreshSession, loginWithKey, migrateLegacyKey,
} from '../session'
import { hasShadowingAccess } from '../../player/shadow-access'
import { LoginModal } from '../LoginModal'
import { untilLong } from '../cabinet/key-dates'
import { setCabinetMarker } from './cabinet-marker'

const KEY = 'tpk_' + 'a'.repeat(32)
const ACTIVE = { authenticated: true, state: 'active', cabinet: true, key_prefix: 'tpk_aaaa', demo: false, key_expires_at: null, shadowing: true, route_allowed: true }
const LOGIN_OK = { key_prefix: 'tpk_aaaa', demo: false, key_expires_at: null, shadowing: true, route_allowed: true }

function resp(body: unknown, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
function Where() {
  const l = useLocation()
  return <div data-testid="where">{l.pathname + l.search}</div>
}
function loginRoutes(path = '/login') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/login" element={<LoginPage />} /><Route path="*" element={<Where />} /></Routes>
    </MemoryRouter>,
  )
}

describe('ревью A5–A8', () => {
  beforeEach(() => { localStorage.clear(); __resetSessionForTests(); setCabinetMarker(false); window.scrollTo = vi.fn() as unknown as typeof window.scrollTo })
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); __resetSessionForTests(); setCabinetMarker(false) })

  // C-1: после переноса страница модулей не держит сырой ключ и не шлёт его.
  it('C-1: после переноса ни одно тело запроса /modules не несёт ключ', async () => {
    setCabinetMarker(true)
    localStorage.setItem('flib:tpk', KEY)
    const calls: { url: string; method: string; body: string; at: number }[] = []
    let authed = false
    let migratedAt = Infinity
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET'
      calls.push({ url, method, body: String(init.body ?? ''), at: calls.length })
      if (url === '/api/session' && method === 'GET') return resp(authed ? ACTIVE : { authenticated: false, cabinet: true })
      if (url === '/api/session' && method === 'POST') { authed = true; migratedAt = calls.length; return resp(LOGIN_OK) }
      if (url.startsWith('/api/modules/download')) return resp({ url: 'https://r2.example/pkg.zip' })
      return resp({ store: 'on', modules: [{ id: 'priv', name: 'Модуль priv', publisher: 'flib', access: 'key', accessible: true, description: 'd',
        versions: [{ version: '1.0.0', platform: 'any', size: 1, icon: null, cover: null }] }] })
    }))
    const assign = vi.fn()
    Object.defineProperty(window, 'location', { value: { ...window.location, assign }, configurable: true })

    const started = startSession()
    render(<MemoryRouter initialEntries={['/modules']}><ModulesPage /></MemoryRouter>)
    await act(async () => { await started })
    await screen.findByText('Модуль priv')
    expect(getSession()).toMatchObject({ authenticated: true, state: 'active' })
    // Страница перешла на путь сессии: каталог перечитан POST {}.
    await waitFor(() => expect(calls.some(c => c.at >= migratedAt && c.url === '/api/modules' && c.body === '{}')).toBe(true), { timeout: 4000 })
    fireEvent.click(screen.getByRole('button', { name: /Скачать/ }))
    await waitFor(() => expect(calls.some(c => c.url.startsWith('/api/modules/download'))).toBe(true))
    const after = calls.filter(c => c.at >= migratedAt && c.url.startsWith('/api/modules'))
    expect(after.length).toBeGreaterThan(0)
    for (const c of after) expect(c.body).not.toContain(KEY)
    expect(after.find(c => c.url.startsWith('/api/modules/download'))!.body).toBe('{}')
  })

  // C-2a: кабинет включён (метка), сбой GET /api/session → старое окно НЕ появляется,
  // проверка повторяется, flib:tpk не пишется.
  it('C-2a: метка есть, первый GET /api/session упал — повтор, затем новое окно; старого окна нет', async () => {
    vi.useFakeTimers()
    setCabinetMarker(true)
    let n = 0
    const f = vi.fn(async (url: string, init: RequestInit = {}) => {
      if (url === '/api/session' && (init.method ?? 'GET') === 'GET') {
        n++
        if (n === 1) throw new TypeError('blip')
        return resp({ authenticated: false, cabinet: true })
      }
      return resp({ valid: true, shadowing: true, key_prefix: 'tpk_aaaa' })
    })
    vi.stubGlobal('fetch', f)
    void startSession()
    loginRoutes()
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })
    expect(screen.queryByRole('heading', { name: 'Войти по ключу' })).toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(1100) })
    expect(n).toBe(2)
    expect(screen.getByRole('heading', { name: 'Вход' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Войти по ключу' })).toBeNull()
    expect(localStorage.getItem('flib:tpk')).toBeNull()
  })

  it('C-2a: метка есть, сервер молчит — на /login форма, старого окна нет никогда, ключ не пишется', async () => {
    vi.useFakeTimers()
    setCabinetMarker(true)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('down') }))
    void startSession()
    loginRoutes()
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(screen.getByRole('heading', { name: 'Вход' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Войти по ключу' })).toBeNull()
    expect(localStorage.getItem('flib:tpk')).toBeNull()
  })

  // C-2b: «Выход» успешен только на 204.
  it('C-2b: DELETE ответил 404 — «Выход» не удался, снимок не тронут', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit = {}) => (init.method === 'DELETE' ? resp({ error: 'not_found' }, 404) : resp(ACTIVE))))
    await refreshSession()
    localStorage.setItem('flib:tpk', KEY)
    expect(await cabinetLogout()).toBe(false)
    expect(getSession().authenticated).toBe(true)
    expect(localStorage.getItem('flib:tpk')).toBeNull()
  })

  // M-1: заменённый ключ (reason:"invalid") — текст §3.3 на /login.
  it('M-1: reason invalid → «Этот ключ больше не действует…»', async () => {
    setCabinetMarker(true)
    vi.stubGlobal('fetch', vi.fn(async () => resp({ authenticated: false, reason: 'invalid', cabinet: true })))
    render(
      <MemoryRouter initialEntries={['/app']}>
        <Routes>
          <Route path="/app" element={<CabinetLayout />}><Route index element={<CabinetHome />} /></Route>
          <Route path="/login" element={<LoginPage />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByRole('heading', { name: 'Вход' })).toBeTruthy()
    expect(screen.getByText(/Этот ключ больше не действует/)).toBeTruthy()
  })

  // L-4: ответ переноса после ручного входа не возвращает flib:tpk-migrate.
  it('L-4: поздний ответ переноса после ручного входа не пишет flib:tpk-migrate', async () => {
    localStorage.setItem('flib:tpk', KEY)
    let releaseMigration!: (r: Response) => void
    let n = 0
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit = {}) => {
      if ((init.method ?? 'GET') === 'GET') return Promise.resolve(resp({ authenticated: false, cabinet: true }))
      n++
      if (n === 1) return new Promise<Response>(r => { releaseMigration = r })
      return Promise.resolve(resp({ ...LOGIN_OK, key_prefix: 'tpk_bbbb' }))
    }))
    await refreshSession()
    const mig = migrateLegacyKey(new Date(2026, 10, 18))
    await Promise.resolve()
    expect(await loginWithKey('tpk_' + 'b'.repeat(32))).toEqual({ kind: 'ok' })
    releaseMigration(resp({ error: 'invalid_key' }, 401))
    await mig
    expect(localStorage.getItem('flib:tpk-migrate')).toBeNull()
  })

  // H-1: после сбоя перечитывания модуль сам повторяет — Shadowing возвращается.
  it('H-1: шлюз вернулся — пилюля Shadowing открывается без перезагрузки', async () => {
    vi.useFakeTimers()
    let down = false
    const f = vi.fn(async () => { if (down) throw new TypeError('offline'); return resp(ACTIVE) })
    vi.stubGlobal('fetch', f)
    await startSession()
    expect(hasShadowingAccess()).toBe(true)
    down = true
    await refreshSession()
    expect(hasShadowingAccess()).toBe(false)
    down = false
    await vi.advanceTimersByTimeAsync(2100)
    expect(hasShadowingAccess()).toBe(true)
  })

  it('H-1: state:"unknown" от BFF — повтор с паузой, до ответа active', async () => {
    vi.useFakeTimers()
    const f = vi.fn()
      .mockImplementationOnce(async () => resp({ ...ACTIVE, state: 'unknown' }))
      .mockImplementationOnce(async () => resp({ ...ACTIVE, state: 'unknown' }))
      .mockImplementation(async () => resp(ACTIVE))
    vi.stubGlobal('fetch', f)
    await refreshSession()
    expect(hasShadowingAccess()).toBe(false)
    await vi.advanceTimersByTimeAsync(2100)
    expect(f).toHaveBeenCalledTimes(2)
    expect(hasShadowingAccess()).toBe(false)
    await vi.advanceTimersByTimeAsync(5100)
    expect(f).toHaveBeenCalledTimes(3)
    expect(hasShadowingAccess()).toBe(true)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(f).toHaveBeenCalledTimes(3) // здоровый снимок — повторов нет
  })

  it('H-1: в плохом состоянии фокус окна перечитывает снимок сразу', async () => {
    let down = true
    const f = vi.fn(async () => { if (down) throw new TypeError('offline'); return resp(ACTIVE) })
    vi.stubGlobal('fetch', f)
    await startSession()
    expect(getSession().status).toBe('error')
    down = false
    window.dispatchEvent(new Event('focus'))
    await waitFor(() => expect(hasShadowingAccess()).toBe(true))
  })

  // C-3: метки нет (флаг выключен) — старое окно сразу, без ожидания снимка.
  it('C-3: метки нет, /api/session завис — старое окно на первом же рендере', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
    void startSession()
    loginRoutes()
    expect(screen.getByRole('heading', { name: 'Войти по ключу' })).toBeTruthy()
  })

  it('C-3: метки нет, /api/session завис — анонимный каталог запрашивается сразу', async () => {
    const f = vi.fn((url: string) => url === '/api/session' ? new Promise<Response>(() => {}) : Promise.resolve(resp({ store: 'on', modules: [] })))
    vi.stubGlobal('fetch', f)
    void startSession()
    render(<MemoryRouter initialEntries={['/modules']}><ModulesPage /></MemoryRouter>)
    await waitFor(() => expect(f.mock.calls.some(([u]) => u === '/api/modules')).toBe(true))
  })

  it('C-3: метки нет — фоновый запрос сессии обрывается через ~3 с', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_u: string, init: RequestInit = {}) => new Promise<Response>((_res, rej) => {
      init.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))
    })))
    void refreshSession()
    await vi.advanceTimersByTimeAsync(2900)
    expect(getSession().status).toBe('loading')
    await vi.advanceTimersByTimeAsync(200)
    expect(getSession().status).toBe('error')
  })

  it('C-3: метки нет — /app пуст сразу, без ожидания снимка', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
    const { container } = render(
      <MemoryRouter initialEntries={['/app']}>
        <Routes><Route path="/app" element={<CabinetLayout />}><Route index element={<CabinetHome />} /></Route></Routes>
      </MemoryRouter>,
    )
    expect(container.innerHTML).toBe('')
  })

  // --- M-2 и L-14: поведение, которое держит утверждения, закреплено тестом ---

  it('LM3, L-6: старое окно после DELETE перечитывает снимок — гейт идёт по новому ключу; другие вкладки узнают', async () => {
    let cookie = true
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      const m = init.method ?? 'GET'
      if (url === '/api/session' && m === 'DELETE') { cookie = false; return resp(null, 204) }
      if (url === '/api/session') return resp(cookie ? { ...ACTIVE, cabinet: false } : { authenticated: false, cabinet: false })
      return resp({ valid: true, shadowing: false, key_prefix: 'tpk_bbbb' }) // /api/access: новый ключ без Shadowing
    }))
    await startSession()
    expect(hasShadowingAccess()).toBe(true) // активная cookie старого ключа
    const other = new BroadcastChannel('flib-session')
    const got: unknown[] = []
    other.onmessage = ev => got.push(ev.data)
    render(<LoginModal onClose={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('tpk_…'), { target: { value: 'tpk_' + 'b'.repeat(32) } })
    fireEvent.click(screen.getByText('Проверить'))
    await waitFor(() => expect(getSession().authenticated).toBe(false))
    expect(hasShadowingAccess()).toBe(false)
    await waitFor(() => expect(got).toContainEqual({ type: 'logout' }))
    other.close()
  })

  it('S09: вход шлёт login в канал', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit = {}) => (init.method === 'POST' ? resp(LOGIN_OK) : resp({ authenticated: false, cabinet: true }))))
    await startSession()
    const other = new BroadcastChannel('flib-session')
    const got: unknown[] = []
    other.onmessage = ev => got.push(ev.data)
    expect(await loginWithKey(KEY)).toEqual({ kind: 'ok' })
    await waitFor(() => expect(got).toEqual([{ type: 'login' }]))
    other.close()
  })

  it('S10: «Выход» шлёт logout в канал', async () => {
    let out = false // после DELETE 204 сервер отвечает «не вошёл» (перечитывание F-1)
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit = {}) => {
      if (init.method === 'DELETE') { out = true; return resp(null, 204) }
      return resp(out ? { authenticated: false, cabinet: true } : ACTIVE)
    }))
    await startSession()
    const other = new BroadcastChannel('flib-session')
    const got: unknown[] = []
    other.onmessage = ev => got.push(ev.data)
    expect(await cabinetLogout()).toBe(true)
    await waitFor(() => expect(got).toEqual([{ type: 'logout' }]))
    other.close()
  })

  it('L-2: 200 без тела BFF входом не считается, старые ключи целы', async () => {
    localStorage.setItem('flib:tpk', KEY)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>proxy</html>', { status: 200 })))
    expect(await loginWithKey(KEY)).toEqual({ kind: 'unavailable' })
    expect(localStorage.getItem('flib:tpk')).toBe(KEY)
    expect(getSession().authenticated).toBe(false)
  })

  it('L-3: ответ GET, начатого до входа, не перетирает снимок входа', async () => {
    let releaseGet!: (r: Response) => void
    let gets = 0
    vi.stubGlobal('fetch', vi.fn((_u: string, init: RequestInit = {}) => {
      if (init.method === 'POST') return Promise.resolve(resp(LOGIN_OK))
      gets++
      // Первый GET висит до входа; выброшенный ответ сразу сменяется новым
      // чтением (R1-C1), оно отвечает уже «вошёл».
      return gets === 1 ? new Promise<Response>(r => { releaseGet = r }) : Promise.resolve(resp(ACTIVE))
    }))
    const pending = refreshSession()
    expect(await loginWithKey(KEY)).toEqual({ kind: 'ok' })
    releaseGet(resp({ authenticated: false, cabinet: true }))
    await pending
    expect(getSession()).toMatchObject({ authenticated: true, state: 'active' })
  })

  it('S35: нет поля demo — ключ считается демо', async () => {
    const { demo: _d, ...noDemo } = ACTIVE
    vi.stubGlobal('fetch', vi.fn(async () => resp(noDemo)))
    expect((await refreshSession()).demo).toBe(true)
  })

  it('K02: срок в другом году показывается с годом', () => {
    const now = new Date(2026, 10, 18)
    expect(untilLong(new Date(2027, 0, 5, 12).toISOString(), now)).toBe('5 января 2027')
    expect(untilLong(new Date(2026, 10, 24, 12).toISOString(), now)).toBe('24 ноября')
  })

  it('H01: у истёкшего демо-ключа на Главной нет «Демо до …»', async () => {
    setCabinetMarker(true)
    vi.stubGlobal('fetch', vi.fn(async () => resp({ authenticated: true, state: 'expired', cabinet: true, key_prefix: 'tpk_aaaa', demo: true })))
    render(
      <MemoryRouter initialEntries={['/app']}>
        <Routes><Route path="/app" element={<CabinetLayout />}><Route index element={<CabinetHome />} /></Route></Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByText('Продлите свой демо-ключ — маршрут сохранится.')).toBeTruthy()
    expect(screen.queryByText(/Демо до/)).toBeNull()
  })
})
