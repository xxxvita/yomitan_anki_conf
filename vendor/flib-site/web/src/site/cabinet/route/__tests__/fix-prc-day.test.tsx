// fix-prc-day.test.tsx — PR-C, L6 на странице маршрута: перечитывание после
// коммита СВОЕГО обмена не присоединяется к запросу состояния, ушедшему до коммита
// (возврат на вкладку во время опроса задания), — иначе вкладка показала бы день до
// коммита до следующего повода.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { fireEvent, screen, waitFor, within, act } from '@testing-library/react'
import { __resetSessionForTests, __setSessionForTests } from '../../../session'
import { __resetRouteStateForTests } from '../use-route-state'
import { __resetRouteOutboxForTests } from '../outbox'
import { FakeRouteBFF, json, renderRoutePage, st, del, und, pid, TODAY } from './route-page-fakes'
import { markClipListened, __resetClipListenedForTests } from '../../../../player/route-events/clip-listened'

let bff: FakeRouteBFF
beforeEach(() => {
  __resetSessionForTests(); __resetRouteStateForTests(); __resetRouteOutboxForTests()
  localStorage.clear(); __resetClipListenedForTests(); for (const n of [1, 2, 3]) markClipListened(pid(n))
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(`${TODAY}T12:00:00`))
  bff = new FakeRouteBFF()
  vi.stubGlobal('fetch', vi.fn((u: string, i?: RequestInit) => bff.fetch(u, i)))
  __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_abcd', routeAllowed: true, demo: false })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); __resetRouteOutboxForTests() })

describe('L6: перечитывание после коммита своего обмена', () => {
  it('запрос состояния, ушедший во время опроса, висит; после коммита — свой запрос и переход к новому ролику', async () => {
    const before = st([del(1, { played: true }), del(2, { played: true }), und()])
    const after = st([del(1, { played: true }), del(2, { played: true }), del(3), und()], { revision: 6 })
    let committed = false
    let holdNext = false
    let releaseStale: (() => void) | null = null
    bff.state = () => {
      if (holdNext) {
        holdNext = false
        return new Promise<Response>(r => { releaseStale = () => r(json(200, before)) })
      }
      return json(200, committed ? after : before)
    }
    let releaseJob: (() => void) | null = null
    bff.jobReply = () => new Promise<Response>(r => {
      releaseJob = () => { committed = true; r(json(200, { status: 'done', committed: true, committed_revision: 6, cancel_reason: null, error_code: null })) }
    })
    renderRoutePage(bff)
    await screen.findByTestId('day-hero')
    fireEvent.click(within(screen.getByTestId('day-hero')).getByRole('button', { name: 'Следующий ролик' }))
    await waitFor(() => expect(releaseJob).not.toBeNull())
    // возврат на вкладку во время опроса: чтение уходит ДО коммита и висит
    const n = bff.stateGets
    holdNext = true
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await new Promise(r => setTimeout(r, 20)) })
    await waitFor(() => expect(bff.stateGets).toBe(n + 1))
    await act(async () => { releaseJob!(); await new Promise(r => setTimeout(r, 20)) })
    await waitFor(() => expect(bff.stateGets).toBeGreaterThanOrEqual(n + 2))
    await waitFor(() => expect(screen.getByTestId('location').textContent).toContain(`rp=${encodeURIComponent(pid(3))}`))
    await act(async () => { releaseStale!(); await new Promise(r => setTimeout(r, 20)) })
  })
})
