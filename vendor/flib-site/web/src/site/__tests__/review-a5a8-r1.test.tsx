// review-a5a8-r1.test.tsx — находки повторного ревью A5–A8 (раунд 1,
// site-A5-A8-review.md «Round 1 re-review»), перенесённые из PoC: каждый
// падал на 045c58c.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { ModulesPage } from '../ModulesPage'
import { LoginPage } from '../LoginPage'
import { CabinetLayout } from '../cabinet/CabinetLayout'
import { CabinetHome } from '../cabinet/CabinetHome'
import { __resetSessionForTests, cabinetLogout, getSession, refreshSession, startSession } from '../session'
import { hasShadowingAccess } from '../../player/shadow-access'
import { setCabinetMarker } from './cabinet-marker'

const KEY = 'tpk_' + 'a'.repeat(32)
const ACTIVE = { authenticated: true, state: 'active', cabinet: true, key_prefix: 'tpk_aaaa', demo: false, key_expires_at: null, shadowing: true, route_allowed: true }
const ANON_ON = { authenticated: false, cabinet: true }
const MOD = { store: 'on', modules: [{ id: 'priv', name: 'Модуль priv', publisher: 'flib', access: 'key', accessible: true, description: 'd',
  versions: [{ version: '1.0.0', platform: 'any', size: 1, icon: null, cover: null }] }] }

function resp(body: unknown, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }
function Where() {
  const l = useLocation()
  return <div data-testid="where">{l.pathname + l.search}</div>
}
function loginRoutes(path = '/login') {
  return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/login" element={<LoginPage />} /><Route path="*" element={<Where />} /></Routes></MemoryRouter>)
}
function appRoutes(path = '/app') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/app" element={<CabinetLayout />}><Route index element={<CabinetHome />} /></Route>
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}
function stubReload() {
  const reload = vi.fn()
  Object.defineProperty(window, 'location', { value: { ...window.location, reload, assign: vi.fn() }, configurable: true })
  return reload
}

describe('ревью A5–A8, раунд 1', () => {
  beforeEach(() => { localStorage.clear(); __resetSessionForTests(); setCabinetMarker(false); window.scrollTo = vi.fn() as unknown as typeof window.scrollTo })
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); __resetSessionForTests(); setCabinetMarker(false) })

  // R1-C1. Две вкладки: login из другой вкладки приходит, пока первый GET медленный
  // (150–400 мс). Ответ того GET выбрасывается — значит, обязано начаться новое
  // чтение; иначе снимок навсегда «loading», и /modules держит сырой ключ.
  it.each([150, 400])('R1-C1: login в другой вкладке во время медленного первого GET (%i мс) — новое чтение, ключ отпущен', async (slow) => {
    setCabinetMarker(true)
    localStorage.setItem('flib:tpk', KEY)
    let sessionGets = 0
    let authed = false
    const bodies: { url: string; body: string }[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      if (url === '/api/session') {
        sessionGets++
        const answer = authed ? ACTIVE : ANON_ON
        if (sessionGets === 1) await sleep(slow)
        return resp(sessionGets === 1 ? ANON_ON : answer)
      }
      bodies.push({ url, body: String(init.body ?? '') })
      if (url.startsWith('/api/modules/download')) return resp({ url: 'https://r2.example/pkg.zip' })
      return resp(MOD)
    }))
    stubReload()
    const started = startSession()
    render(<MemoryRouter initialEntries={['/modules']}><ModulesPage /></MemoryRouter>)
    await screen.findByText('Модуль priv')
    // «Вкладка A»: перенос удался — общий localStorage очищен, в канал ушёл login.
    authed = true
    localStorage.removeItem('flib:tpk'); localStorage.removeItem('flib:access')
    const other = new BroadcastChannel('flib-session')
    other.postMessage({ type: 'login' })
    await act(async () => { await started })
    await waitFor(() => expect(getSession()).toMatchObject({ status: 'ready', authenticated: true, state: 'active' }), { timeout: 3000 })
    expect(sessionGets).toBeGreaterThanOrEqual(2)
    expect(hasShadowingAccess()).toBe(true)
    await act(async () => { await sleep(1200) }) // интервал ключевой ручки
    fireEvent.click(screen.getByRole('button', { name: /Скачать/ }))
    await waitFor(() => expect(bodies.some(b => b.url.startsWith('/api/modules/download'))).toBe(true))
    expect(bodies.find(b => b.url.startsWith('/api/modules/download'))!.body).toBe('{}')
    other.close()
  })

  it('R1-C1: снимок не застревает в loading — ответ выброшен, чтение повторено', async () => {
    setCabinetMarker(true)
    const releases: ((r: Response) => void)[] = []
    const f = vi.fn(() => new Promise<Response>(r => { releases.push(r) }))
    vi.stubGlobal('fetch', f)
    const started = startSession()
    await waitFor(() => expect(f).toHaveBeenCalledTimes(1))
    const other = new BroadcastChannel('flib-session')
    other.postMessage({ type: 'login' })
    await sleep(100)
    releases[0](resp(ANON_ON))
    await waitFor(() => expect(f).toHaveBeenCalledTimes(2))
    releases[1](resp(ACTIVE))
    await act(async () => { await started })
    await waitFor(() => expect(getSession()).toMatchObject({ status: 'ready', authenticated: true }))
    other.close()
  })

  // R1-L1. logout из другой вкладки во время первого GET: на странице с меткой —
  // не «Сервер сейчас не отвечает» и не «Страница устарела».
  it('R1-L1: logout в другой вкладке во время первого GET — /login показывает форму, без ложных плашек', async () => {
    setCabinetMarker(true)
    let release!: (r: Response) => void
    let n = 0
    vi.stubGlobal('fetch', vi.fn(() => { n++; return n === 1 ? new Promise<Response>(r => { release = r }) : Promise.resolve(resp(ANON_ON)) }))
    const started = startSession()
    loginRoutes()
    const other = new BroadcastChannel('flib-session')
    other.postMessage({ type: 'logout' })
    await waitFor(() => expect(getSession().reason).toBe('logout'))
    expect(getSession().cabinet).toBe(true)
    await act(async () => { release(resp(ANON_ON)); await started })
    await sleep(100)
    expect(screen.getByRole('heading', { name: 'Вход' })).toBeTruthy()
    expect(screen.queryByText(/Сервер сейчас не отвечает/)).toBeNull()
    expect(screen.queryByText(/Страница устарела/)).toBeNull()
    other.close()
  })

  // R1-M1. Страница с меткой: /login показывает форму СРАЗУ, снимка не ждёт.
  it('R1-M1: метка есть, GET /api/session висит — форма входа на первом же рендере', () => {
    setCabinetMarker(true)
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
    void startSession()
    loginRoutes()
    expect(screen.getByRole('heading', { name: 'Вход' })).toBeTruthy()
    expect(screen.getByPlaceholderText('tpk_…')).toBeTruthy()
  })

  it('R1-M1: метка есть, проверка сессии падает — форма остаётся, плашки «не отвечает» на /login нет', async () => {
    vi.useFakeTimers()
    setCabinetMarker(true)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('down') }))
    void startSession()
    loginRoutes()
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(screen.getByRole('heading', { name: 'Вход' })).toBeTruthy()
    expect(screen.queryByText(/Сервер сейчас не отвечает/)).toBeNull()
  })

  it('R1-M1: фоновый снимок нашёл живую сессию — /login уводит в кабинет', async () => {
    setCabinetMarker(true)
    vi.stubGlobal('fetch', vi.fn(async () => resp(ACTIVE)))
    loginRoutes('/login?next=/app/profile')
    expect(screen.getByRole('heading', { name: 'Вход' })).toBeTruthy()
    expect((await screen.findByTestId('where')).textContent).toBe('/app/profile')
  })

  // R1-L2: страница без метки (вкладка открыта до включения флага), а сервер уже
  // говорит cabinet:true — окно сменяется новым, старое не пишет сырой ключ.
  it('R1-L2: метки нет, снимок cabinet:true — старое окно сменяется новой формой', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resp(ANON_ON)))
    loginRoutes()
    expect(screen.getByRole('heading', { name: 'Войти по ключу' })).toBeTruthy()
    expect(await screen.findByRole('heading', { name: 'Вход' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Войти по ключу' })).toBeNull()
  })

  // Устаревшая страница с меткой: сервер говорит «кабинет выключен».
  it.each<[string, number, unknown]>([
    ['cabinet:false', 200, { authenticated: false, cabinet: false }],
    ['404', 404, { error: 'not_found' }],
  ])('устаревшая страница (%s) на /login: «Страница устарела — обновите её», кнопка перезагружает', async (_n, status, body) => {
    setCabinetMarker(true)
    const reload = stubReload()
    vi.stubGlobal('fetch', vi.fn(async () => resp(body, status)))
    loginRoutes()
    expect(await screen.findByText('Страница устарела — обновите её')).toBeTruthy()
    expect(screen.queryByText(/Сервер сейчас не отвечает/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Обновить' }))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('устаревшая страница на /app: «Страница устарела — обновите её», кнопка перезагружает', async () => {
    setCabinetMarker(true)
    const reload = stubReload()
    vi.stubGlobal('fetch', vi.fn(async () => resp({ authenticated: false, cabinet: false })))
    appRoutes()
    expect(await screen.findByText('Страница устарела — обновите её')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Обновить' }))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  // R1-L4 / решение координатора: при cabinet:false сначала ключ старого окна
  // (спека §3.6), при cabinet:true — активная сессия.
  it('модули, откат (cabinet:false): активная cookie и flib:tpk — каталог по flib:tpk, и на сессию не переключаемся', async () => {
    const B = 'tpk_' + 'b'.repeat(32)
    localStorage.setItem('flib:tpk', B)
    const bodies: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      if (url === '/api/session') return resp({ ...ACTIVE, cabinet: false })
      bodies.push(String(init.body ?? 'GET'))
      return resp({ store: 'on', modules: [] })
    }))
    await refreshSession()
    render(<MemoryRouter initialEntries={['/modules']}><ModulesPage /></MemoryRouter>)
    await waitFor(() => expect(bodies.length).toBeGreaterThan(0))
    await sleep(100)
    expect(bodies).toEqual([JSON.stringify({ key: B })])
  })

  it('модули, кабинет включён: активная сессия и flib:tpk при монтировании — сразу путь сессии (M52)', async () => {
    const bodies: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      if (url === '/api/session') return resp(ACTIVE)
      bodies.push(String(init.body ?? 'GET'))
      return resp({ store: 'on', modules: [] })
    }))
    await refreshSession()
    localStorage.setItem('flib:tpk', KEY) // записан после снимка (вкладка до деплоя)
    render(<MemoryRouter initialEntries={['/modules']}><ModulesPage /></MemoryRouter>)
    await waitFor(() => expect(bodies.length).toBeGreaterThan(0))
    expect(bodies[0]).toBe('{}')
  })

  // R10b, утверждение 3: сессия expired/unknown старые ключи НЕ стирает.
  it.each(['expired', 'unknown'])('R10b: сессия state:%s при cabinet:true не стирает flib:tpk', async (state) => {
    localStorage.setItem('flib:tpk', KEY)
    localStorage.setItem('flib:access', '{}')
    vi.stubGlobal('fetch', vi.fn(async () => resp({ ...ACTIVE, state })))
    await refreshSession()
    expect(localStorage.getItem('flib:tpk')).toBe(KEY)
    expect(localStorage.getItem('flib:access')).toBe('{}')
  })

  // R27: GET, начатый до «Выхода», не возвращает кабинет на экран.
  it('R27: ответ GET, начатого до «Выхода», не делает снимок снова вошедшим', async () => {
    let releaseFirst!: (r: Response) => void
    let gets = 0
    let deleted = false
    vi.stubGlobal('fetch', vi.fn((_u: string, init: RequestInit = {}) => {
      if (init.method === 'DELETE') { deleted = true; return Promise.resolve(resp(null, 204)) }
      gets++
      if (gets === 1) return Promise.resolve(resp(ACTIVE))
      if (gets === 2) return new Promise<Response>(r => { releaseFirst = r })
      return Promise.resolve(resp(deleted ? ANON_ON : ACTIVE))
    }))
    await refreshSession()
    const pending = refreshSession()
    expect(await cabinetLogout()).toBe(true)
    releaseFirst(resp(ACTIVE)) // ответ «до выхода»
    await pending
    await sleep(50)
    expect(getSession().authenticated).toBe(false)
  })

  // R21: возврат на вкладку в плохом состоянии перечитывает сразу.
  it('R21: возврат на вкладку в плохом состоянии перечитывает снимок сразу', async () => {
    let down = true
    vi.stubGlobal('fetch', vi.fn(async () => { if (down) throw new TypeError('offline'); return resp(ACTIVE) }))
    await startSession()
    expect(getSession().status).toBe('error')
    down = false
    const vis = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    await waitFor(() => expect(hasShadowingAccess()).toBe(true), { timeout: 500 })
    vis.mockRestore()
  })

  // R02: с меткой срок чтения 25 с (дольше подтверждающей пробы BFF, ~21,5 с).
  it('R02: с меткой чтение длиной 22 с не обрывается, а на 25 с — обрывается', async () => {
    vi.useFakeTimers()
    setCabinetMarker(true)
    let n = 0
    vi.stubGlobal('fetch', vi.fn((_u: string, init: RequestInit = {}) => new Promise<Response>((res, rej) => {
      n++
      init.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))
      if (n === 1) setTimeout(() => res(resp(ACTIVE)), 22_000)
    })))
    void refreshSession()
    await vi.advanceTimersByTimeAsync(22_100)
    expect(getSession()).toMatchObject({ status: 'ready', authenticated: true })
    __resetSessionForTests()
    void refreshSession()
    await vi.advanceTimersByTimeAsync(24_900)
    expect(getSession().status).toBe('loading')
    await vi.advanceTimersByTimeAsync(200)
    expect(getSession().status).toBe('error')
  })
})
