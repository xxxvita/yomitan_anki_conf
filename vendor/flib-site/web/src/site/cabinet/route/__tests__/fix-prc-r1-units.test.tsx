// fix-prc-r1-units.test.tsx — ревью PR-C, правки LOW (модульный уровень):
//   N3a — «своя ревизия» вкладки действует только под тем же вошедшим ключом:
//         после смены ключа сообщение с тем же номером чужое и сбрасывает запрос;
//   N3b — замена из плеера читает состояние свежим запросом (и проверку права, и
//         чтения машины обмена), не присоединяясь к запросу в полёте;
//   N6  — afterMark (запись `sent` урока) выполняется под блокировкой очереди, не раньше.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { __resetRouteStateForTests, broadcastRouteRevision, fetchRouteState, useRouteState } from '../use-route-state'
import { __resetSessionForTests, __setSessionForTests } from '../../../session'
import { __resetRouteOutboxForTests, RouteOutbox, type OutboxDeps } from '../outbox'
import { enqueueClipPlayed } from '../../../../player/route-events/route-watched'
import { usePlayerRouteVote } from '../../../../player/route-events/player-route'
import type { RouteModeView } from '../../../../player/route-events/route-mode'
import type { RouteState } from '../route-api'
import { MemStorage, SharedLock, ROUTE_A, ev } from './outbox-fakes'

function resp(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
const probe = () => ({ watchedSeq: 0, pendingClipPlayed: new Set<string>() })
const active = (keyPrefix: string) => ({ cabinet: true, authenticated: true, state: 'active' as const, keyPrefix, routeAllowed: true, demo: false })

describe('N3a: своя ревизия — только под тем же ключом', () => {
  const chans: Array<{ name: string; onmessage: ((e: MessageEvent) => void) | null }> = []
  beforeEach(() => {
    __resetRouteStateForTests(); __resetSessionForTests()
    chans.length = 0
    class BC {
      onmessage: ((e: MessageEvent) => void) | null = null
      constructor(public name: string) { chans.push(this) }
      postMessage() {}
      close() {}
    }
    vi.stubGlobal('BroadcastChannel', BC)
  })
  afterEach(() => { vi.unstubAllGlobals(); __resetSessionForTests() })

  async function scenario(switchKey: boolean): Promise<number> {
    __setSessionForTests(active('tpk_aaaa'))
    broadcastRouteRevision(7)                     // ключ A объявил ревизию 7
    if (switchKey) __setSessionForTests(active('tpk_bbbb'))
    let n = 0
    const fetch = vi.fn(async () => {
      n++
      if (n === 2) return new Promise<Response>(() => {})
      return resp(200, { started: false, revision: 7 })
    })
    const { result } = renderHook(() => useRouteState({ api: { fetch }, probe }))
    await waitFor(() => expect(result.current.read?.result.ok).toBe(true))
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    act(() => { chans.find(c => c.name === 'flib-route' && c.onmessage)!.onmessage!({ data: { revision: 7 } } as MessageEvent) })
    await act(async () => { await new Promise(r => setTimeout(r, 30)) })
    return fetch.mock.calls.length
  }

  it('после смены ключа сообщение с номером, объявленным прежним ключом, — чужое: свой запрос', async () => {
    expect(await scenario(true)).toBe(3)
  })

  it('контроль: тот же ключ — своё сообщение запрос не сбрасывает', async () => {
    expect(await scenario(false)).toBe(2)
  })
})

describe('N3b: замена из плеера читает свежим запросом', () => {
  const ROUTE = '11111111-1111-4111-8111-111111111111'
  const P = 'youtube::aaaaaaaaaaa'
  const state = (): RouteState => ({
    started: true, route_id: ROUTE, revision: 1, snapshot_date: '2026-11-18', started_at: null, goal_label: '',
    params: { daily_listening_budget_min: 20, daily_new_words: 15 },
    day: { date: '2026-11-18', clips: [
      { puzzle_id: P, kind: 'youtube', video_id: 'aaaaaaaaaaa', delivered: true, played: false, queued_played: false, new_words: 0, words: [] },
      { delivered: false, duration_sec: 200, new_words: 0 },
    ] },
    next_clip: null, current_puzzle_id: P, replace_available: true, stop_reason: null, active_exchange: null, kept_today: [],
  } as unknown as RouteState)
  beforeEach(() => { localStorage.clear(); __resetRouteStateForTests(); __resetRouteOutboxForTests(); __resetSessionForTests() })
  afterEach(() => { vi.unstubAllGlobals(); __resetRouteOutboxForTests() })

  it('запрос состояния в полёте висит; «Заменить» проверяет право своим запросом и доходит до обмена', async () => {
    __setSessionForTests(active('tpk_aaaa'))
    let gets = 0
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (u: string, i: RequestInit = {}) => {
      const url = String(u)
      calls.push(`${(i.method ?? 'GET').toUpperCase()} ${url}`)
      if (url.startsWith('/api/me/route/state')) {
        gets++
        if (gets === 1) return new Promise<Response>(() => {})
        return resp(200, state())
      }
      if (url === '/api/me/route/exchange') return resp(202, { job_id: '33333333-3333-4333-8333-333333333333', base_revision: 1 })
      if (url.startsWith('/api/me/route/jobs/')) return new Promise<Response>(() => {})
      return resp(200, {})
    }))
    void fetchRouteState()                        // чтение, ушедшее раньше, висит
    await waitFor(() => expect(gets).toBe(1))
    const st = state()
    const mode: RouteModeView = { kind: 'confirmed', puzzleId: P, state: st, row: st.day!.clips[0] as never }
    const events = { rate: vi.fn(() => true), dropReport: vi.fn() }
    const { result } = renderHook(() => usePlayerRouteVote(mode, events, () => {}))
    act(() => { result.current!.onDislike('content', true) })
    await waitFor(() => expect(gets).toBe(2))
    await waitFor(() => expect(calls).toContain('POST /api/me/route/exchange'))
  })

  it('после коммита замены чтение машины — свой запрос, не тот, что ушёл во время опроса; переход к новому ролику', async () => {
    __setSessionForTests(active('tpk_aaaa'))
    const P2 = 'youtube::bbbbbbbbbbb'
    const after = (): RouteState => {
      const s = state()
      return { ...s, revision: 2, current_puzzle_id: P2, day: { date: '2026-11-18', clips: [
        { puzzle_id: P2, kind: 'youtube', video_id: 'bbbbbbbbbbb', delivered: true, played: false, queued_played: false, new_words: 0, words: [] },
      ] } } as unknown as RouteState
    }
    let gets = 0
    let committed = false
    let releaseJob: () => void = () => {}
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      const url = String(u)
      if (url.startsWith('/api/me/route/state')) {
        gets++
        if (gets === 2) return new Promise<Response>(() => {})   // ушёл во время опроса, висит
        return resp(200, committed ? after() : state())
      }
      if (url === '/api/me/route/exchange') return resp(202, { job_id: '33333333-3333-4333-8333-333333333333', base_revision: 1 })
      if (url.startsWith('/api/me/route/jobs/')) {
        return new Promise<Response>(r => { releaseJob = () => { committed = true; r(resp(200, { status: 'done', committed: true, committed_revision: 2, cancel_reason: null, error_code: null })) } })
      }
      return resp(200, {})
    }))
    const st = state()
    const mode: RouteModeView = { kind: 'confirmed', puzzleId: P, state: st, row: st.day!.clips[0] as never }
    const events = { rate: vi.fn(() => true), dropReport: vi.fn() }
    const nav = vi.fn()
    const { result } = renderHook(() => usePlayerRouteVote(mode, events, nav))
    act(() => { result.current!.onDislike('content', true) })
    await waitFor(() => expect(gets).toBe(1))
    await waitFor(() => expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.some(c => String(c[0]).startsWith('/api/me/route/jobs/'))).toBe(true), { timeout: 5000 })
    void fetchRouteState()
    await waitFor(() => expect(gets).toBe(2))
    await act(async () => { releaseJob(); await new Promise(r => setTimeout(r, 30)) })
    await waitFor(() => expect(nav).toHaveBeenCalledWith(expect.stringContaining('rp=' + encodeURIComponent(P2))))
    expect(gets).toBe(3)
  })
})

describe('N6: afterMark — под блокировкой очереди', () => {
  it('блокировка занята — afterMark не выполнен; отпущена — выполнен после записи события', async () => {
    let open: () => void = () => {}
    const lock = new SharedLock()
    void lock.request('x', () => new Promise<void>(r => { open = r }))
    const storage = new MemStorage()
    const deps: OutboxDeps = {
      storage, locks: lock, fetch: () => Promise.reject(new Error('no net')),
      now: () => Date.now(), setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: h => clearTimeout(h as ReturnType<typeof setTimeout>),
      newId: () => 'web:x',
    }
    const box = new RouteOutbox(deps)
    const seen: Array<string | null> = []
    const p = enqueueClipPlayed(box, {
      routeId: ROUTE_A, day: '2026-11-18', event: ev('clip_played', { played_frac: 0.5 }), share: 0.5, meta: {}, storage,
      afterMark: () => { seen.push(storage.getItem('flib:route-outbox')) },
    })
    await new Promise(r => setTimeout(r, 10))
    expect(seen).toEqual([])
    open()
    await p
    expect(seen).toHaveLength(1)
    expect(seen[0]).toContain('clip_played')       // событие уже в очереди
  })
})
