// route-mode-hook.test.tsx — потолок проверки маршрутного режима в хуке (§4.7):
// ответ, не пришедший за 15 с, — гостевой режим (страж мутанта R9 ревью).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useRouteMode, type RouteModeDeps } from '../route-mode'
import { __resetSessionForTests, __setSessionForTests } from '../../../site/session'

afterEach(() => vi.useRealTimers())

describe('useRouteMode — «Выход» (ревью партии 2, C1)', () => {
  it('сессия кончилась — режим off: плеер больше не маршрутный', async () => {
    __resetSessionForTests()
    __setSessionForTests({ cabinet: true, authenticated: true, state: 'active' })
    const st = { started: true, route_id: 'r', revision: 1, snapshot_date: '2026-11-18', started_at: null, goal_label: '', params: { daily_listening_budget_min: 20, daily_new_words: 15 },
      day: { date: '2026-11-18', clips: [{ puzzle_id: 'youtube::abc123XYZ_1', kind: 'youtube', delivered: true as const, played: false, queued_played: false, new_words: 0, words: [] }] },
      next_clip: null, current_puzzle_id: 'youtube::abc123XYZ_1', replace_available: true, stop_reason: null, active_exchange: null }
    const deps: RouteModeDeps = {
      marked: () => true, session: async () => true, now: () => Date.now(), sleep: async () => {},
      read: async () => ({ result: { ok: true, status: 200, data: st }, sent: { watchedSeq: 0, pendingClipPlayed: new Set() } }),
    }
    const { result } = renderHook(() => useRouteMode('abc123XYZ_1', 'youtube::abc123XYZ_1', null, deps))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(result.current.kind).toBe('confirmed')
    act(() => { __setSessionForTests({ cabinet: true, authenticated: false, reason: 'logout' }) })
    expect(result.current.kind).toBe('off')
    __resetSessionForTests()
  })
})

describe('useRouteMode — новый вход (повторное ревью, R-M1)', () => {
  const st = { started: true, route_id: 'r', revision: 1, snapshot_date: '2026-11-18', started_at: null, goal_label: '', params: { daily_listening_budget_min: 20, daily_new_words: 15 },
    day: { date: '2026-11-18', clips: [{ puzzle_id: 'youtube::abc123XYZ_1', kind: 'youtube', delivered: true as const, played: false, queued_played: false, new_words: 0, words: [] }] },
    next_clip: null, current_puzzle_id: 'youtube::abc123XYZ_1', replace_available: true, stop_reason: null, active_exchange: null }

  it('первый ответ снимка после загрузки (загрузка → вошёл) проверку не повторяет: один GET состояния', async () => {
    __resetSessionForTests() // снимок ещё «loading»
    let reads = 0
    const deps: RouteModeDeps = {
      marked: () => true, session: async () => true, now: () => Date.now(), sleep: async () => {},
      read: async () => { reads++; return { result: { ok: true, status: 200, data: st }, sent: { watchedSeq: 0, pendingClipPlayed: new Set() } } },
    }
    const { result } = renderHook(() => useRouteMode('abc123XYZ_1', 'youtube::abc123XYZ_1', null, deps))
    act(() => { __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_one0' }) })
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
    expect(result.current.kind).toBe('confirmed')
    expect(reads).toBe(1)
    // контроль: вход другим ключом — проверка заново
    act(() => { __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_two0' }) })
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
    expect(reads).toBe(2)
    __resetSessionForTests()
  })
})

describe('useRouteMode — потолок 15 с', () => {
  it('состояние не ответило — через 15 с режим off, до этого pending', async () => {
    vi.useFakeTimers()
    const deps: RouteModeDeps = {
      marked: () => true, session: async () => true, now: () => Date.now(), sleep: () => new Promise(() => {}),
      read: () => new Promise(() => {}),
    }
    const { result } = renderHook(() => useRouteMode('abc123XYZ_1', 'youtube::abc123XYZ_1', null, deps))
    expect(result.current.kind).toBe('pending')
    await act(async () => { await vi.advanceTimersByTimeAsync(14_900) })
    expect(result.current.kind).toBe('pending')
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    expect(result.current.kind).toBe('off')
  })
})
