// review-a5a8-r2.test.tsx — находки ревью A5–A8 раунда 2 (site-A5-A8-review.md
// «Round 2 re-review», R2-C1 и смежное), перенесённые из PoC: N-7 и N-8 падали
// на 1b6eda8.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ModulesPage } from '../ModulesPage'
import { __resetSessionForTests, startSession, getSession, refreshSession } from '../session'
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
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// Изменение flib:tpk в ДРУГОЙ вкладке: браузер шлёт событие storage во все
// остальные вкладки того же источника (в jsdom его надо послать вручную).
function storageFromOtherTab(key: string, newValue: string | null) {
  window.dispatchEvent(new StorageEvent('storage', { key, newValue }))
}

describe('ревью A5–A8, раунд 2', () => {
  beforeEach(() => { localStorage.clear(); __resetSessionForTests(); setCabinetMarker(false); window.scrollTo = vi.fn() as unknown as typeof window.scrollTo })
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); __resetSessionForTests(); setCabinetMarker(false) })

  // (a) Нет BroadcastChannel (Safari 14.0–15.3): о входе в другой вкладке
  // страница узнаёт по событию storage для flib:tpk и отпускает ключ.
  it('N-7: нет BroadcastChannel, вход в другой вкладке — /modules отпускает ключ по событию storage', async () => {
    const realBC = globalThis.BroadcastChannel
    // @ts-expect-error — имитация браузера без BroadcastChannel
    delete globalThis.BroadcastChannel
    try {
      setCabinetMarker(true)
      localStorage.setItem('flib:tpk', KEY)
      const bodies: { url: string; body: string }[] = []
      let loggedInElsewhere = false
      vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
        const m = init.method ?? 'GET'
        if (url === '/api/session' && m === 'GET') return resp(loggedInElsewhere ? ACTIVE : ANON_ON)
        if (url === '/api/session' && m === 'POST') return resp({ error: 'too_many_attempts', retry_after_sec: 1 }, 429)
        bodies.push({ url, body: String(init.body ?? '') })
        if (url.startsWith('/api/modules/download')) return resp({ url: 'https://r2.example/pkg.zip' })
        return resp(MOD)
      }))
      Object.defineProperty(window, 'location', { value: { ...window.location, assign: vi.fn() }, configurable: true })
      const started = startSession()
      render(<MemoryRouter initialEntries={['/modules']}><ModulesPage /></MemoryRouter>)
      await act(async () => { await started })
      await screen.findByText('Модуль priv')
      // «Вкладка A» вошла тем же ключом: cookie стоит, общий localStorage очищен.
      loggedInElsewhere = true
      const mark = bodies.length
      localStorage.removeItem('flib:tpk'); localStorage.removeItem('flib:access')
      act(() => { storageFromOtherTab('flib:tpk', null) })
      await waitFor(() => expect(getSession()).toMatchObject({ authenticated: true, state: 'active' }))
      await act(async () => { await sleep(1300) }) // интервал ключевой ручки
      fireEvent.click(screen.getByRole('button', { name: /Скачать/ }))
      await waitFor(() => expect(bodies.some(b => b.url.startsWith('/api/modules/download'))).toBe(true))
      for (const b of bodies.slice(mark)) expect(b.body).not.toContain(KEY)
      expect(bodies.find(b => b.url.startsWith('/api/modules/download'))!.body).toBe('{}')
    } finally {
      globalThis.BroadcastChannel = realBC
    }
  })

  it('storage: flib:tpk сменился в другой вкладке — страница берёт новый ключ, старый не шлёт', async () => {
    const B = 'tpk_' + 'b'.repeat(32)
    localStorage.setItem('flib:tpk', KEY)
    const bodies: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      if (url === '/api/session') return resp({ authenticated: false, cabinet: false })
      bodies.push(String(init.body ?? 'GET'))
      return resp(MOD)
    }))
    render(<MemoryRouter initialEntries={['/modules']}><ModulesPage /></MemoryRouter>)
    await screen.findByText('Модуль priv')
    localStorage.setItem('flib:tpk', B)
    act(() => { storageFromOtherTab('flib:tpk', B) })
    await waitFor(() => expect(bodies.some(b => b.includes(B))).toBe(true), { timeout: 4000 })
    expect(bodies[bodies.length - 1]).not.toContain(KEY)
  })

  // (b) Чтение, запущенное сообщением login, упало: снимок «ready, не вошёл,
  // failures>0» — тоже плохое состояние, его повторяют по той же лестнице.
  it('N-8: чтение после login упало — повтор; /modules отпускает ключ, Shadowing открыт', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    setCabinetMarker(true)
    localStorage.setItem('flib:tpk', KEY)
    localStorage.setItem('flib:access', JSON.stringify({ shadowing: true, keyPrefix: 'tpk_aaaa', checkedAt: 'x' }))
    const bodies: { url: string; body: string }[] = []
    let sessionGets = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      const m = init.method ?? 'GET'
      if (url === '/api/session' && m === 'GET') {
        sessionGets++
        if (sessionGets === 1) return resp(ANON_ON)
        if (sessionGets === 2) throw new TypeError('blip')
        return resp(ACTIVE)
      }
      if (url === '/api/session' && m === 'POST') return resp({ error: 'too_many_attempts', retry_after_sec: 1 }, 429)
      bodies.push({ url, body: String(init.body ?? '') })
      if (url.startsWith('/api/modules/download')) return resp({ url: 'https://r2.example/pkg.zip' })
      return resp(MOD)
    }))
    Object.defineProperty(window, 'location', { value: { ...window.location, assign: vi.fn() }, configurable: true })
    const started = startSession()
    render(<MemoryRouter initialEntries={['/modules']}><ModulesPage /></MemoryRouter>)
    await act(async () => { await started })
    await screen.findByText('Модуль priv')
    localStorage.removeItem('flib:tpk'); localStorage.removeItem('flib:access')
    const other = new BroadcastChannel('flib-session')
    other.postMessage({ type: 'login' })
    await waitFor(() => expect(sessionGets).toBe(2))
    expect(getSession()).toMatchObject({ status: 'ready', authenticated: false, failures: 1 })
    await act(async () => { await vi.advanceTimersByTimeAsync(1100) }) // первый повтор — через 1 с
    expect(sessionGets).toBe(3)
    expect(getSession()).toMatchObject({ authenticated: true, state: 'active', failures: 0 })
    expect(hasShadowingAccess()).toBe(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    const mark = bodies.length
    fireEvent.click(screen.getByRole('button', { name: /Скачать/ }))
    await waitFor(() => expect(bodies.some(b => b.url.startsWith('/api/modules/download'))).toBe(true))
    expect(bodies.slice(mark).find(b => b.url.startsWith('/api/modules/download'))!.body).toBe('{}')
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60 * 1000) })
    expect(sessionGets).toBe(3) // здоровый снимок — повторов больше нет
    other.close()
  })

  it('сбой чтения над снимком «не вошёл» повторяется по лестнице 1, 2, 4 с', async () => {
    vi.useFakeTimers()
    let n = 0
    const f = vi.fn(async () => { n++; if (n === 1) return resp(ANON_ON); throw new TypeError('down') })
    vi.stubGlobal('fetch', f)
    await refreshSession()
    await refreshSession() // сбой
    expect(f).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1100)
    expect(f).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(2100)
    expect(f).toHaveBeenCalledTimes(4)
    await vi.advanceTimersByTimeAsync(4100)
    expect(f).toHaveBeenCalledTimes(5)
  })

  // Q53: откат (cabinet:false), cookie есть, flib:tpk нет — снимок пришёл после
  // монтирования, страница переходит на путь cookie.
  it('Q53: откат, cookie без flib:tpk, снимок после монтирования — переход на путь cookie', async () => {
    const bodies: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      if (url === '/api/session') return resp({ ...ACTIVE, cabinet: false })
      bodies.push(String(init.body ?? 'GET'))
      return resp(MOD)
    }))
    render(<MemoryRouter initialEntries={['/modules']}><ModulesPage /></MemoryRouter>)
    await screen.findByText('Модуль priv')
    expect(bodies[0]).toBe('GET')
    await act(async () => { await refreshSession() })
    await waitFor(() => expect(bodies).toContain('{}'))
  })

  // Гигиена тестов: чтение, ещё летящее в момент сброса, не запускает новый GET.
  it('__resetSessionForTests: летящее чтение после сброса не начинает новое', async () => {
    let release!: (r: Response) => void
    const f = vi.fn(() => new Promise<Response>(r => { release = r }))
    vi.stubGlobal('fetch', f)
    const pending = refreshSession()
    __resetSessionForTests()
    release(resp(ACTIVE))
    await pending
    await sleep(20)
    expect(f).toHaveBeenCalledTimes(1)
    expect(getSession().status).toBe('loading')
  })
})
