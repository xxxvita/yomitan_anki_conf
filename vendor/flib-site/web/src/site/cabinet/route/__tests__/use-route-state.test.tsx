// use-route-state.test.tsx — хук состояния страницы (§4.3, §4.6 п.7, план B7):
// временный сбой перечитывается сам по Retry-After (нет — 5 с), `502
// gateway_refused` — никогда; сообщение канала `flib-route` перечитывает.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { __resetRouteStateForTests, useRouteState } from '../use-route-state'

function resp(status: number, body: unknown): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
const probe = () => ({ watchedSeq: 0, pendingClipPlayed: new Set<string>() })

beforeEach(() => { __resetRouteStateForTests(); vi.useFakeTimers() })
afterEach(() => vi.useRealTimers())

describe('useRouteState', () => {
  it('502 без JSON-кода — повтор через 5 с', async () => {
    let n = 0
    const fetch = vi.fn(async () => (++n === 1 ? resp(502, '<html>') : resp(200, { started: false, revision: 0 })))
    const { result } = renderHook(() => useRouteState({ api: { fetch }, probe }))
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(result.current.retryAt).not.toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(result.current.read?.result.ok).toBe(true)
  })

  it('502 gateway_refused — ни одного повтора за 60 с', async () => {
    const fetch = vi.fn(async () => resp(502, { error: 'gateway_refused' }))
    const { result } = renderHook(() => useRouteState({ api: { fetch }, probe }))
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(result.current.retryAt).toBeNull()
  })
})
