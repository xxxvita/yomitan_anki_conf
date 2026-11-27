// LoginPage.test.tsx — /login: выбор окна по режиму сервера (спека кабинета
// §3.6, §3.7) и прежнее поведение старого окна при выключенном кабинете.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, fireEvent, screen, waitFor, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { LoginPage, safeNext } from '../LoginPage'
import { saveAccess } from '../access'
import { __resetSessionForTests, startSession } from '../session'
import { setCabinetMarker } from './cabinet-marker'

function Where() {
  const l = useLocation()
  return <div data-testid="where">{l.pathname + l.search}</div>
}

function renderAt(path = '/login') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}

function stubSession(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })))
}

const ACTIVE = { authenticated: true, state: 'active', cabinet: true, key_prefix: 'tpk_aaaa', demo: false, key_expires_at: null, shadowing: false, route_allowed: true }

describe('LoginPage — нет метки, кабинет выключен (как origin/main)', () => {
  beforeEach(() => { localStorage.clear(); __resetSessionForTests() })
  afterEach(() => { vi.unstubAllGlobals(); __resetSessionForTests() })

  it.each([
    ['404 (нет SESSION_KEYS)', 404, { error: 'not_found' }],
    ['cabinet:false', 200, { authenticated: false, cabinet: false }],
    ['cabinet:false и живая cookie', 200, { ...ACTIVE, cabinet: false }],
    ['сбой проверки', 502, { error: 'x' }],
  ])('%s — прежнее окно «Войти по ключу»', async (_n, status, body) => {
    stubSession(status, body)
    renderAt()
    expect(await screen.findByRole('heading', { name: 'Войти по ключу' })).toBeTruthy()
  })

  it('закрытие без входа возвращает на главную', async () => {
    stubSession(404, {})
    renderAt()
    await screen.findByRole('heading', { name: 'Войти по ключу' })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByTestId('where').textContent).toBe('/')
  })

  it('закрытие после входа без маршрута ведёт к сборке маршрута', async () => {
    stubSession(404, {})
    saveAccess({ keyPrefix: 'tpk_test', shadowing: true, checkedAt: '2026-11-08T00:00:00Z' })
    renderAt()
    await screen.findByRole('heading', { name: 'Войти по ключу' })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByTestId('where').textContent).toBe('/try')
  })

  it('закрытие после входа с сохранённым маршрутом ведёт к маршруту', async () => {
    stubSession(404, {})
    saveAccess({ keyPrefix: 'tpk_test', shadowing: true, checkedAt: '2026-11-08T00:00:00Z' })
    localStorage.setItem('flib:route', '{}')
    renderAt()
    await screen.findByRole('heading', { name: 'Войти по ключу' })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByTestId('where').textContent).toBe('/route')
  })
})

describe('LoginPage — кабинет включён (метка в index.html)', () => {
  beforeEach(() => { localStorage.clear(); __resetSessionForTests(); setCabinetMarker(true) })
  afterEach(() => { vi.unstubAllGlobals(); __resetSessionForTests(); setCabinetMarker(false) })

  it('без сессии — новое окно «Вход»', async () => {
    stubSession(200, { authenticated: false, cabinet: true })
    renderAt()
    expect(await screen.findByRole('heading', { name: 'Вход' })).toBeTruthy()
    expect(screen.queryByText('Войти по ключу')).toBeNull()
  })

  it.each([
    ['/login', '/app'],
    ['/login?next=/app/profile', '/app/profile'],
    ['/login?next=/apple', '/app'],
    ['/login?next=//evil.example', '/app'],
  ])('живая сессия: %s → %s', async (from, to) => {
    stubSession(200, ACTIVE)
    renderAt(from)
    expect((await screen.findByTestId('where')).textContent).toBe(to)
  })

  it.each(['expired', 'unknown'])('сессия state:%s тоже уводит в кабинет (там плашка)', async (state) => {
    stubSession(200, { ...ACTIVE, state })
    renderAt()
    expect((await screen.findByTestId('where')).textContent).toBe('/app')
  })

  it('reason=logout — «Вы вышли из кабинета»', async () => {
    stubSession(200, { authenticated: false, cabinet: true })
    renderAt('/login?reason=logout')
    expect(await screen.findByText('Вы вышли из кабинета')).toBeTruthy()
  })

  it.each(['revoked', 'invalid'])('reason=%s — текст об отозванном/заменённом ключе', async (reason) => {
    stubSession(200, { authenticated: false, cabinet: true })
    renderAt('/login?reason=' + reason)
    expect(await screen.findByText(/Этот ключ больше не действует/)).toBeTruthy()
  })

  it('старого окна нет ни в каком состоянии: cabinet:false при метке — «Страница устарела — обновите её»', async () => {
    stubSession(200, { authenticated: false, cabinet: false })
    renderAt()
    expect(await screen.findByText('Страница устарела — обновите её')).toBeTruthy()
    expect(screen.queryByText('Войти по ключу')).toBeNull()
  })

  it('идёт перенос старого ключа — форма видна сразу (R1-M1), после переноса — в кабинет', async () => {
    localStorage.setItem('flib:tpk', 'tpk_' + 'd'.repeat(32))
    let release!: (r: Response) => void
    vi.stubGlobal('fetch', vi.fn((_u: string, init: RequestInit = {}) => (init.method === 'POST'
      ? new Promise<Response>(r => { release = r })
      : Promise.resolve(new Response(JSON.stringify({ authenticated: false, cabinet: true }), { status: 200 })))))
    void startSession()
    renderAt()
    expect(screen.getByRole('heading', { name: 'Вход' })).toBeTruthy()
    await waitFor(() => expect(release).toBeTypeOf('function'))
    await act(async () => { release(new Response(JSON.stringify({ key_prefix: 'tpk_dddd', demo: false, key_expires_at: null, shadowing: true, route_allowed: true }), { status: 200 })) })
    expect((await screen.findByTestId('where')).textContent).toBe('/app')
  })

  it('вход с ?next= уводит на next (P08)', async () => {
    let authed = false
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit = {}) => {
      if (init.method === 'POST') { authed = true; return new Response(JSON.stringify({ key_prefix: 'tpk_bbbb', demo: false, key_expires_at: null, shadowing: true, route_allowed: true }), { status: 200 }) }
      return new Response(JSON.stringify(authed ? { ...ACTIVE } : { authenticated: false, cabinet: true }), { status: 200 })
    }))
    renderAt('/login?next=/app/profile')
    fireEvent.change(await screen.findByPlaceholderText('tpk_…'), { target: { value: 'tpk_' + 'b'.repeat(32) } })
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }))
    expect((await screen.findByTestId('where')).textContent).toBe('/app/profile')
  })
})

describe('safeNext', () => {
  it.each([
    [null, '/app'], ['/app', '/app'], ['/app/route', '/app/route'], ['/apple', '/app'],
    ['/app\\x', '/app'], ['/app/\u0001', '/app'], ['https://x/app', '/app'], ['/app/' + 'a'.repeat(600), '/app'],
  ])('%s → %s', (inp, out) => {
    expect(safeNext(inp)).toBe(out)
  })
})
