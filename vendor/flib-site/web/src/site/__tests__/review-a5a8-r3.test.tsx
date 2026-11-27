// review-a5a8-r3.test.tsx — тесты, которых просило ревью A5–A8 раунда 3
// (site-A5-A8-review.md, «Round 3 diff read», R3-M1): выжившие мутанты T05, T06
// (упавшее ПЕРЕчитывание стирает flib:tpk — утверждение 3 на пути повтора) и T21
// (по событию storage показанный ключ отпускается только со следующим каталогом,
// а не сразу). Первые два перенесены из PoC ревьюера (poc_r3.test.tsx).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ModulesPage } from '../ModulesPage'
import { __resetSessionForTests, getSession, refreshSession } from '../session'
import { setCabinetMarker } from './cabinet-marker'

const KEY = 'tpk_' + 'a'.repeat(32)
const ACTIVE = { authenticated: true, state: 'active', cabinet: true, key_prefix: 'tpk_aaaa', demo: false, key_expires_at: null, shadowing: true, route_allowed: true }
const ANON_ON = { authenticated: false, cabinet: true }
const MOD = { store: 'on', modules: [{ id: 'priv', name: 'Модуль priv', publisher: 'flib', access: 'key', accessible: true, description: 'd',
  versions: [{ version: '1.0.0', platform: 'any', size: 1, icon: null, cover: null }] }] }

function resp(body: unknown, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('ревью A5–A8, раунд 3 (R3-M1)', () => {
  beforeEach(() => { localStorage.clear(); __resetSessionForTests(); setCabinetMarker(false); window.scrollTo = vi.fn() as unknown as typeof window.scrollTo })
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); __resetSessionForTests(); setCabinetMarker(false) })

  // T05. Утверждение 3: повторяемое упавшее чтение над «не вошёл» ничего не стирает
  // и ничего не шлёт, кроме GET.
  it('утверждение 3: перечитывания над «не вошёл» падают 10 минут — старые ключи целы, только GET', async () => {
    vi.useFakeTimers()
    setCabinetMarker(true)
    localStorage.setItem('flib:tpk', KEY)
    localStorage.setItem('flib:access', '{"shadowing":true,"keyPrefix":"x","checkedAt":"y"}')
    localStorage.setItem('flib:tpk-migrate', JSON.stringify({ fails: 2, last_day: '2099-01-01' }))
    const methods: string[] = []
    let gets = 0
    const at: number[] = []
    const t0 = Date.now()
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit = {}) => {
      methods.push(init.method ?? 'GET')
      gets++
      if (gets === 1) return resp(ANON_ON)
      at.push(Math.round((Date.now() - t0) / 1000))
      throw new TypeError('down')
    }))
    await refreshSession()
    void refreshSession() // перечитывание упало
    await vi.advanceTimersByTimeAsync(600_000)
    expect(getSession()).toMatchObject({ status: 'ready', authenticated: false })
    expect(getSession().failures).toBeGreaterThan(0)
    expect(localStorage.getItem('flib:tpk')).toBe(KEY)
    expect(localStorage.getItem('flib:access')).not.toBeNull()
    expect(localStorage.getItem('flib:tpk-migrate')).not.toBeNull()
    expect(new Set(methods)).toEqual(new Set(['GET']))
    expect(at.slice(0, 6)).toEqual([0, 1, 3, 7, 22, 52]) // лестница 1, 2, 4, 15, 30 с
    expect(gets).toBeLessThanOrEqual(27) // дальше не чаще раза в 30 с
  })

  // T06. То же над активной сессией: вкладка, загруженная до деплоя, могла
  // записать flib:tpk — сбой чтения его не стирает.
  it('утверждение 3: перечитывания над активной сессией падают — flib:tpk цел, снимок unknown', async () => {
    vi.useFakeTimers()
    let gets = 0
    vi.stubGlobal('fetch', vi.fn(async () => { gets++; if (gets === 1) return resp({ ...ACTIVE, cabinet: false }); throw new TypeError('down') }))
    await refreshSession()
    localStorage.setItem('flib:tpk', KEY)
    void refreshSession()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(gets).toBeGreaterThan(2)
    expect(getSession()).toMatchObject({ authenticated: true, state: 'unknown' })
    expect(localStorage.getItem('flib:tpk')).toBe(KEY)
  })

  // T21. Утверждение 1, половина «сразу»: flib:tpk стёрли в другой вкладке —
  // показанный ключ отпускается в момент события storage, ещё до того, как придёт
  // следующий каталог. Каталог намеренно не отвечает: «Скачать» в этом окне не
  // несёт старый ключ (аноним — переход на GET без тела).
  it('storage: показанный ключ отпущен сразу — «Скачать» до нового каталога не несёт ключ', async () => {
    localStorage.setItem('flib:tpk', KEY)
    const assign = vi.fn()
    Object.defineProperty(window, 'location', { value: { ...window.location, assign }, configurable: true })
    const calls: { url: string; m: string; body: string }[] = []
    let holdCatalog = false
    vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit = {}) => {
      const m = init.method ?? 'GET'
      calls.push({ url, m, body: String(init.body ?? '') })
      if (url === '/api/session') return Promise.resolve(resp({ authenticated: false, cabinet: false }))
      if (url.startsWith('/api/modules/download')) return Promise.resolve(resp({ url: 'https://r2.example/pkg.zip' }))
      if (holdCatalog) return new Promise<Response>(() => {}) // следующий каталог не приходит
      return Promise.resolve(resp(MOD))
    }))
    render(<MemoryRouter initialEntries={['/modules']}><ModulesPage /></MemoryRouter>)
    await screen.findByText('Модуль priv')
    expect(calls.some(c => c.body.includes(KEY))).toBe(true) // список открыт старым ключом
    holdCatalog = true
    const mark = calls.length
    localStorage.removeItem('flib:tpk')
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: 'flib:tpk', oldValue: KEY, newValue: null })) })
    // Новый (анонимный) каталог запрошен и висит; карточки ещё на экране.
    await waitFor(() => expect(calls.slice(mark).some(c => c.url.startsWith('/api/modules') && !c.url.startsWith('/api/modules/download'))).toBe(true))
    fireEvent.click(screen.getByRole('button', { name: /Скачать/ }))
    await waitFor(() => expect(assign).toHaveBeenCalled())
    expect(assign.mock.calls[0][0]).toMatch(/^\/api\/modules\/download\?/)
    for (const c of calls.slice(mark)) expect(c.body).not.toContain(KEY)
    expect(calls.slice(mark).some(c => c.url.startsWith('/api/modules/download'))).toBe(false)
  })
})
