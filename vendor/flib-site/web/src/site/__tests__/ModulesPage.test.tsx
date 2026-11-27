import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ModulesPage } from '../ModulesPage'
import { __resetSessionForTests, refreshSession } from '../session'

const SHA = 'a'.repeat(64)
function ver(version: string, platform: string, extra: Record<string, unknown> = {}) {
  return { version, platform, size: 2048, icon: null, cover: null, ...extra }
}
function mod(id: string, accessible: boolean, versions: unknown[]) {
  return { id, name: `Модуль ${id}`, publisher: 'flib', access: 'public', accessible, description: `desc ${id}`, versions }
}
function respond(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}
// Для фейковых таймеров: Response.json() ждёт реального ввода-вывода.
function fake(body: unknown, status = 200) {
  return Promise.resolve({ status, ok: status < 400, headers: new Headers(), json: async () => body } as unknown as Response)
}
function renderPage() {
  return render(<MemoryRouter initialEntries={['/modules']}><ModulesPage /></MemoryRouter>)
}

describe('ModulesPage', () => {
  beforeEach(() => { window.localStorage.clear(); window.scrollTo = vi.fn() })
  afterEach(() => { vi.unstubAllGlobals() })

  it('показывает замок при accessible:false и не даёт скачать', async () => {
    vi.stubGlobal('fetch', vi.fn(() => respond({ store: 'on', modules: [mod('locked', false, [ver('1.0.0', 'any')])] })))
    renderPage()
    await screen.findByText('Модуль locked')
    expect(screen.getByText(/Нужен доступ/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Скачать/ })).toBeNull()
  })

  it('не предлагает yanked-версии', async () => {
    vi.stubGlobal('fetch', vi.fn(() => respond({
      store: 'on',
      modules: [mod('ok', true, [ver('2.0.0', 'any', { yanked: true }), ver('1.0.0', 'any')])],
    })))
    renderPage()
    await screen.findByText('Модуль ok')
    expect(screen.getByText(/версия 1\.0\.0/)).toBeTruthy()
    expect(screen.queryByText(/2\.0\.0/)).toBeNull()
  })

  it('404 каталога показывает «магазин выключен»', async () => {
    vi.stubGlobal('fetch', vi.fn(() => respond({ error: 'x' }, 404)))
    renderPage()
    expect(await screen.findByText(/Магазин модулей выключен/)).toBeTruthy()
  })

  it('store:off от BFF тоже «магазин выключен»', async () => {
    vi.stubGlobal('fetch', vi.fn(() => respond({ store: 'off', modules: [] })))
    renderPage()
    expect(await screen.findByText(/Магазин модулей выключен/)).toBeTruthy()
  })

  it('с сохранённым ключом идёт POST с ключом в теле, а не в URL', async () => {
    const key = 'tpk_' + '1'.repeat(32)
    window.localStorage.setItem('flib:tpk', key)
    const f = vi.fn(() => respond({ store: 'on', modules: [] }))
    vi.stubGlobal('fetch', f)
    renderPage()
    await waitFor(() => expect(f).toHaveBeenCalled())
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/modules')
    expect(init.method).toBe('POST')
    expect(String(init.body)).toContain(key)
    expect(SHA.length).toBe(64)
  })

  // Двойное чтение (спека кабинета 2026-11-17 §3.6, A6).
  describe('сессия кабинета', () => {
    const ACTIVE = { authenticated: true, state: 'active', cabinet: true, key_prefix: 'tpk_cccc', demo: false, key_expires_at: null, shadowing: true, route_allowed: true }
    beforeEach(() => { __resetSessionForTests() })
    afterEach(() => { __resetSessionForTests() })

    function bff(session: unknown, sessionStatus = 200) {
      const f = vi.fn((url: string) => url === '/api/session'
        ? respond(session, sessionStatus)
        : respond({ store: 'on', modules: [mod('priv', true, [ver('1.0.0', 'any', { icon: { url: '/api/modules/icon?x=1', sha256: SHA, mime: 'image/png' } })])] }))
      vi.stubGlobal('fetch', f)
      return f
    }
    const catalogCalls = (f: ReturnType<typeof bff>) =>
      (f.mock.calls as unknown as [string, RequestInit | undefined][]).filter(([u]) => u === '/api/modules')

    it('активная сессия без flib:tpk — POST {} с X-Flib-Request, ключа в теле нет', async () => {
      const f = bff(ACTIVE)
      await refreshSession()
      renderPage()
      await screen.findByText('Модуль priv')
      const [, init] = catalogCalls(f)[0]
      expect(init?.method).toBe('POST')
      expect(init?.body).toBe('{}')
      expect((init?.headers as Record<string, string>)['X-Flib-Request']).toBe('1')
      // Иконка тоже идёт путём сессии.
      await waitFor(() => expect(f.mock.calls.some(([u]) => String(u).startsWith('/api/modules/icon'))).toBe(true))
      const icon = (f.mock.calls as unknown as [string, RequestInit][]).find(([u]) => u.startsWith('/api/modules/icon'))!
      expect(icon[1].body).toBe('{}')
    })

    it('снимка ещё нет — страница не ждёт: сразу анонимный GET, затем переход на путь сессии', async () => {
      const f = bff(ACTIVE)
      renderPage()
      await screen.findByText('Модуль priv')
      expect(catalogCalls(f)[0][1]?.method ?? 'GET').toBe('GET')
      expect(f.mock.calls.some(([u]) => u === '/api/session')).toBe(false) // страница снимок не запрашивает
      await act(async () => { await refreshSession() })
      await waitFor(() => expect(catalogCalls(f).some(([, i]) => i?.method === 'POST' && i?.body === '{}')).toBe(true))
    })

    it('ключ старого окна: первый запрос — ключ в теле без заголовка CSRF; сессия стала активной (cabinet:true) — ключ отпущен', async () => {
      const key = 'tpk_' + '3'.repeat(32)
      localStorage.setItem('flib:tpk', key)
      const f = bff(ACTIVE) // кабинет включён: активная сессия идёт первой
      renderPage()
      await screen.findByText('Модуль priv')
      const [, first] = catalogCalls(f)[0]
      expect(String(first?.body)).toContain(key)
      expect((first?.headers as Record<string, string>)['X-Flib-Request']).toBeUndefined()
      await act(async () => { await refreshSession() })
      await waitFor(() => expect(catalogCalls(f).length).toBeGreaterThan(1))
      for (const [, i] of catalogCalls(f).slice(1)) expect(String(i?.body ?? '')).not.toContain(key)
    })

    it('ключ отпускается сразу: скачивание до прихода нового каталога идёт путём сессии (C1b)', async () => {
      const key = 'tpk_' + '4'.repeat(32)
      localStorage.setItem('flib:tpk', key)
      const bodies: { url: string; body: string }[] = []
      vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit = {}) => {
        bodies.push({ url, body: String(init.body ?? '') })
        if (url === '/api/session') return respond(ACTIVE)
        if (url.startsWith('/api/modules/download')) return respond({ url: 'https://r2.example/x.zip' })
        if (init.body === '{}') return new Promise<Response>(() => {}) // каталог по сессии ещё в пути
        return respond({ store: 'on', modules: [mod('priv', true, [ver('1.0.0', 'any')])] })
      }))
      const assign = vi.fn()
      Object.defineProperty(window, 'location', { value: { ...window.location, assign }, configurable: true })
      renderPage()
      await screen.findByText('Модуль priv')
      await act(async () => { await refreshSession() })
      fireEvent.click(screen.getByRole('button', { name: /Скачать/ }))
      await waitFor(() => expect(bodies.some(b => b.url.startsWith('/api/modules/download'))).toBe(true))
      expect(bodies.find(b => b.url.startsWith('/api/modules/download'))!.body).toBe('{}')
    })

    it('путь сессии получил 401 — снимок перечитан, список анонимный, на сессию не возвращаемся (MP3)', async () => {
      let sessionGets = 0
      const f = vi.fn((url: string, init: RequestInit = {}) => {
        if (url === '/api/session') { sessionGets++; return respond(ACTIVE) }
        if ((init.method ?? 'GET') === 'POST') return respond({ error: 'invalid_key' }, 401)
        return respond({ store: 'on', modules: [mod('pub', true, [ver('1.0.0', 'any')])] })
      })
      vi.stubGlobal('fetch', f)
      await refreshSession()
      renderPage()
      await screen.findByText('Модуль pub')
      await waitFor(() => expect(sessionGets).toBe(2))
      await new Promise(r => setTimeout(r, 50))
      expect(catalogCalls(f as unknown as ReturnType<typeof bff>).filter(([, i]) => i?.method === 'POST').length).toBe(1)
    })

    it.each([
      ['expired', { ...ACTIVE, state: 'expired' }, 200],
      ['unknown', { ...ACTIVE, state: 'unknown' }, 200],
      ['нет сессии', { authenticated: false, cabinet: true }, 200],
      ['404 (нет SESSION_KEYS)', { error: 'not_found' }, 404],
    ])('%s — анонимный GET', async (_n, session, status) => {
      const f = bff(session, status)
      await refreshSession()
      renderPage()
      await screen.findByText('Модуль priv')
      const [, init] = catalogCalls(f)[0]
      expect(init?.method ?? 'GET').toBe('GET')
    })
  })

  describe('429 на каталог с ключом', () => {
    const key = 'tpk_' + '2'.repeat(32)
    beforeEach(() => { window.localStorage.setItem('flib:tpk', key); vi.useFakeTimers() })
    afterEach(() => { vi.useRealTimers() })

    it('сначала анонимный список, затем один повтор с ключом заменяет его', async () => {
      const f = vi.fn()
        .mockImplementationOnce(() => fake({ error: 'rate_limited' }, 429))
        .mockImplementationOnce(() => fake({ store: 'on', modules: [mod('pub', true, [ver('1.0.0', 'any')])] }))
        .mockImplementationOnce(() => fake({ store: 'on', modules: [mod('pub', true, [ver('1.0.0', 'any')]), mod('priv', true, [ver('1.0.0', 'any')])] }))
      vi.stubGlobal('fetch', f)
      renderPage()
      await act(async () => { await vi.advanceTimersByTimeAsync(500) })
      expect(screen.getByText('Модуль pub')).toBeTruthy()
      expect(screen.queryByText('Модуль priv')).toBeNull()
      expect(screen.queryByText(/недоступен/)).toBeNull()
      await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
      expect(screen.getByText('Модуль priv')).toBeTruthy()
      expect(f).toHaveBeenCalledTimes(3)
    })

    it('второй 429 оставляет анонимный список без ошибки и без третьего повтора', async () => {
      const f = vi.fn()
        .mockImplementationOnce(() => fake({ error: 'rate_limited' }, 429))
        .mockImplementationOnce(() => fake({ store: 'on', modules: [mod('pub', true, [ver('1.0.0', 'any')])] }))
        .mockImplementation(() => fake({ error: 'rate_limited' }, 429))
      vi.stubGlobal('fetch', f)
      renderPage()
      await act(async () => { await vi.advanceTimersByTimeAsync(10) })
      await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
      expect(screen.getByText('Модуль pub')).toBeTruthy()
      expect(screen.queryByText(/недоступен/)).toBeNull()
      expect(f).toHaveBeenCalledTimes(3)
    })
  })
})
