// fix-b3b-r2-day.test.tsx — ревью батча 3b, второй круг (календарь): R1-L1
// отказы чтения месяца по классу и только пока календарь на экране; R1-L4 месяц
// выбранного прошлого дня перечитывается после смены ревизии. Порт проб
// `review-b3b-r1/probes/zz-r1-day.test.tsx` (P2, P4).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { fireEvent, screen, waitFor, act } from '@testing-library/react'
import { __resetSessionForTests, __setSessionForTests } from '../../../session'
import { __resetRouteStateForTests, broadcastRouteRevision } from '../use-route-state'
import { __resetRouteOutboxForTests } from '../outbox'
import { __resetDaysLoaderForTests } from '../route-days'
import { FakeRouteBFF, json, renderRoutePage, st, del, und, pid, vid, TODAY } from './route-page-fakes'
import type { DaysEntry } from '../calendar-model'

let bff: FakeRouteBFF
beforeEach(() => {
  __resetSessionForTests(); __resetRouteStateForTests(); __resetRouteOutboxForTests(); __resetDaysLoaderForTests()
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(`${TODAY}T12:00:00`))
  bff = new FakeRouteBFF()
  vi.stubGlobal('fetch', vi.fn((u: string, i?: RequestInit) => bff.fetch(u, i)))
  __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_abcd', routeAllowed: true, demo: false })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); __resetRouteOutboxForTests(); __resetDaysLoaderForTests() })

const wait = (ms: number) => act(async () => { await new Promise(r => setTimeout(r, ms)) })
const cal = (date: string) => screen.getByTestId(`cal-${date}`)
const daysCalls = () => bff.of('/api/me/route/days').map(c => new URL(c.url, 'https://flib.club').searchParams.get('from'))
const ytd = (n: number) => ({ puzzle_id: pid(n), kind: 'youtube', video_id: vid(n), title: `Past ${n}`, source: 'YouTube', duration_sec: 300 })

describe('R1-L1: отказы чтения месяца', () => {
  it('502 gateway_refused — без повтора, текст отказа шлюза, ячейки в виде ошибки', async () => {
    bff.daysReply = () => json(502, { error: 'gateway_refused' })
    bff.state = st([del(1, { played: true }), und()])
    renderRoutePage(bff)
    await screen.findByTestId('cal-error')
    expect(screen.getByTestId('cal-error').textContent).toContain('Маршрут временно недоступен, мы уже знаем о проблеме')
    expect(cal('2026-11-12').getAttribute('data-kind')).toBe('error')
    await wait(2500)
    expect(daysCalls()).toHaveLength(1)
  })

  it('401 — без повтора, сессия перечитывается (P2)', async () => {
    bff.daysReply = () => json(401, { error: 'no_session' })
    bff.state = st([del(1, { played: true }), und()])
    renderRoutePage(bff)
    await waitFor(() => expect(daysCalls()).toHaveLength(1))
    await waitFor(() => expect(bff.of('/api/session').length).toBeGreaterThan(0))
    await wait(2500)
    expect(daysCalls()).toHaveLength(1)
  })

  it('503 и страница ушла — повторов больше нет (P2)', async () => {
    bff.daysReply = () => json(503, { error: 'gateway_unavailable' }, { 'Retry-After': '1' })
    bff.state = st([del(1, { played: true }), und()])
    const r = renderRoutePage(bff)
    await screen.findByTestId('cal-error')
    r.unmount()
    await wait(2500)
    expect(daysCalls()).toHaveLength(1)
  })
})

describe('R1-L4: выбранный день в другом месяце, чем показан', () => {
  it('после смены ревизии месяц выбранного дня перечитывается; дня больше нет — выбор снят (P4)', async () => {
    let oct: DaysEntry[] = [{ date: '2026-10-20', clips: [ytd(5)] }]
    bff.daysReply = from => json(200, { days: from.startsWith('2026-10') ? oct : [] })
    const s = st([del(1, { played: true }), del(2), und()], { started_at: '2026-10-01T10:00:00Z' })
    bff.state = s
    renderRoutePage(bff)
    await screen.findByTestId('route-calendar')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Предыдущий месяц' })) })
    await waitFor(() => expect(cal('2026-10-20').getAttribute('data-kind')).toBe('past'))
    fireEvent.click(cal('2026-10-20'))
    await screen.findByTestId('past-day')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Следующий месяц' })) })
    await wait(50)
    oct = []
    const before = daysCalls().length
    bff.state = { ...s, revision: 6 }
    await act(async () => { broadcastRouteRevision(6); await new Promise(r => setTimeout(r, 100)) })
    await wait(300)
    expect(daysCalls().slice(before)).toContain('2026-10-01')
    await screen.findByTestId('day-hero')
    expect(screen.queryByTestId('past-day')).toBeNull()
  })
})
