// extra-video-focus.test.tsx — цель фокуса новой строки сбрасывается при смене snapshot_date.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useExtraVideo } from '../use-extra-video'
import { routeApi } from '../route-api'
import { st, del, xrow, TODAY } from './route-page-fakes'
import { __setSessionForTests, __resetSessionForTests } from '../../../session'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(`${TODAY}T12:00:00`))
  __resetSessionForTests()
  __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_abcd', routeAllowed: true, demo: false })
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); __resetSessionForTests() })

describe('useExtraVideo: focusPid', () => {
  it('держится, пока строку не нарисовали (потребителя нет), и сбрасывается при смене snapshot_date', async () => {
    const row = xrow(5)
    const s1 = st([del(1)], { extras: [], extra_available: true, extra_active: null })
    const s2 = { ...s1, extras: [row] }
    vi.spyOn(routeApi, 'extra').mockResolvedValue({ ok: true, status: 202, data: { job_id: 'j1' } } as never)
    vi.spyOn(routeApi, 'extraJob').mockResolvedValue({ ok: true, status: 200, data: { outcome: 'clip' } } as never)
    const reload = vi.fn(async () => ({ result: { ok: false, cls: 'other' } }) as never)
    const deps = { sleep: async () => { await new Promise(r => setTimeout(r, 0)) }, now: () => Date.now() }
    const r = renderHook(p => useExtraVideo({ state: p, demo: false, dayBusy: false, reload, deps }), { initialProps: s1 })
    act(() => { r.result.current.start() })
    r.rerender(s2)
    await waitFor(() => expect(r.result.current.focusPid).toBe(row.puzzle_id))
    r.rerender({ ...s2, snapshot_date: '2026-11-19', revision: 9 })
    await waitFor(() => expect(r.result.current.focusPid).toBeNull())
  })
})
