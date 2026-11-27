// DayView.locks.test.tsx — ревью партии 2, L13: страница маршрута пишет
// `flib:route-watched` (сторож удаления и шаг замены) только под блокировкой
// очереди `flib-route-outbox`, той же, под которой его пишет плеер.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'

const h = vi.hoisted(() => ({ held: false, prune: [] as boolean[], remove: [] as boolean[] }))
vi.mock('../../../../player/route-events/route-watched', async orig => {
  const m = await orig<typeof import('../../../../player/route-events/route-watched')>()
  return {
    ...m,
    pruneWatched: (...a: Parameters<typeof m.pruneWatched>) => { h.prune.push(h.held); return m.pruneWatched(...a) },
    removeWatched: (...a: Parameters<typeof m.removeWatched>) => { h.remove.push(h.held); return m.removeWatched(...a) },
  }
})

import { __resetSessionForTests, __setSessionForTests } from '../../../session'
import { __resetRouteStateForTests } from '../use-route-state'
import { __resetRouteOutboxForTests } from '../outbox'
import { writeWatched } from '../../../../player/route-events/route-watched'
import { FakeRouteBFF, renderRoutePage, st, del, und, ROUTE, TODAY, pid } from './route-page-fakes'

let bff: FakeRouteBFF
beforeEach(() => {
  h.prune = []; h.remove = []; h.held = false
  let tail: Promise<unknown> = Promise.resolve()
  vi.stubGlobal('navigator', Object.assign(Object.create(navigator), {
    locks: {
      request: (_n: string, fn: () => Promise<unknown>) => {
        const run = tail.then(async () => { h.held = true; try { return await fn() } finally { h.held = false } })
        tail = run.catch(() => undefined)
        return run
      },
    },
  }))
  __resetSessionForTests(); __resetRouteStateForTests(); __resetRouteOutboxForTests()
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(`${TODAY}T12:00:00`))
  bff = new FakeRouteBFF()
  vi.stubGlobal('fetch', vi.fn((u: string, i?: RequestInit) => bff.fetch(u, i)))
  __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_abcd', routeAllowed: true })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); __resetRouteOutboxForTests() })

describe('L13: flib:route-watched — под блокировкой очереди', () => {
  it('сторож удаления по ответу состояния — под блокировкой', async () => {
    writeWatched(ROUTE, TODAY, pid(1), 0.9, {})
    bff.state = st([del(1), und()])
    renderRoutePage(bff)
    await screen.findByTestId('day-hero')
    await waitFor(() => expect(h.prune.length).toBeGreaterThan(0))
    expect(h.prune.every(Boolean)).toBe(true)
  })

  it('шаг замены удаляет запись под блокировкой', async () => {
    writeWatched(ROUTE, TODAY, pid(1), 0.9, {})
    bff.state = st([del(1, { queued_played: true }), und()])
    renderRoutePage(bff)
    await screen.findByTestId('day-hero')
    fireEvent.click(within(screen.getByTestId('day-hero')).getByRole('button', { name: 'Заменить' }))
    fireEvent.click(within(screen.getByRole('group', { name: 'Подтверждение замены' })).getByRole('button', { name: 'Заменить' }))
    await waitFor(() => expect(h.remove.length).toBe(1))
    expect(h.remove).toEqual([true])
  })
})
