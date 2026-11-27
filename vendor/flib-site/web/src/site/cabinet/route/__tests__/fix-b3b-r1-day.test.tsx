// fix-b3b-r1-day.test.tsx — ревью батча 3b, правки первого круга (экран дня):
// L5 отказ чтения месяца повторяется сам и показывается временным сбоем; L7
// «Повторить» `next` сверяет и дату плана; L8 прошлый день не мигает на смену
// ревизии; стражи W29 (эпоха дней — с ревизией) и W60 (сброс шлёт в канал).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { fireEvent, screen, waitFor, within, act } from '@testing-library/react'
import { __resetSessionForTests, __setSessionForTests } from '../../../session'
import { __resetRouteStateForTests } from '../use-route-state'
import { __resetRouteOutboxForTests } from '../outbox'
import { __resetDaysLoaderForTests } from '../route-days'
import { FakeRouteBFF, json, renderRoutePage, st, del, und, lesson, pid, vid, TODAY } from './route-page-fakes'

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
const daysCalls = () => bff.of('/api/me/route/days')
const yt = (n: number) => ({ puzzle_id: pid(n), kind: 'youtube', video_id: vid(n), title: `Past ${n}`, source: 'YouTube', duration_sec: 300 })
const reread = () => act(async () => { document.dispatchEvent(new Event('visibilitychange')); await new Promise(r => setTimeout(r, 80)) })

describe('L5: отказ чтения месяца', () => {
  it('503 — повтор сам по Retry-After, пока не прочитан — «Маршрут временно недоступен…», затем ячейки обычные', async () => {
    let n = 0
    bff.daysReply = () => (++n === 1 ? json(503, { error: 'gateway_unavailable' }, { 'Retry-After': '1' }) : json(200, { days: [{ date: '2026-11-12', clips: [yt(1)] }] }))
    bff.state = st([del(1, { played: true }), del(2), und()])
    renderRoutePage(bff)
    await screen.findByTestId('cal-error')
    expect(screen.getByTestId('cal-error').textContent).toMatch(/^Маршрут временно недоступен\. Повторим через \d+ с$/)
    expect(cal('2026-11-12').getAttribute('data-kind')).toBe('error')
    await waitFor(() => expect(cal('2026-11-12').getAttribute('data-kind')).toBe('past'), { timeout: 3000 })
    expect(n).toBe(2)
    expect(screen.queryByTestId('cal-error')).toBeNull()
    expect(bff.daysMaxInflight).toBe(1)
  })
})

describe('L8: прошлый день и смена ревизии', () => {
  it('ревизия сменилась, месяц перечитывается — прошлый день остаётся на экране; день пропал из строк — выбор снят', async () => {
    let release: (r: Response) => void = () => {}
    let n = 0
    bff.daysReply = () => { n++; return n === 2 ? new Promise<Response>(r => { release = r }) : json(200, { days: n === 1 ? [{ date: '2026-11-12', clips: [yt(1)] }] : [] }) }
    bff.state = st([del(1, { played: true }), del(2), und()])
    renderRoutePage(bff)
    await waitFor(() => expect(cal('2026-11-12').tagName).toBe('BUTTON'))
    fireEvent.click(cal('2026-11-12'))
    await screen.findByTestId('past-day')
    bff.state = st([del(1, { played: true }), del(2), und()], { revision: 6 })
    await reread()
    await waitFor(() => expect(n).toBe(2))
    expect(screen.getByTestId('past-day')).toBeTruthy()
    expect(screen.queryByTestId('day-hero')).toBeNull()
    await act(async () => { release(json(200, { days: [] })); await new Promise(r => setTimeout(r, 30)) })
    await screen.findByTestId('day-hero')
    expect(screen.queryByTestId('past-day')).toBeNull()
    // выбор снят: следующая ревизия, вернувшая этот день, прошлый день сама не открывает
    bff.daysReply = () => json(200, { days: [{ date: '2026-11-12', clips: [yt(1)] }] })
    bff.state = st([del(1, { played: true }), del(2), und()], { revision: 7 })
    await reread()
    await waitFor(() => expect(cal('2026-11-12').tagName).toBe('BUTTON'))
    await wait(50)
    expect(screen.queryByTestId('past-day')).toBeNull()
    expect(screen.getByTestId('day-hero')).toBeTruthy()
  })

  it('W29: смена ревизии перечитывает месяц (эпоха дней — с ревизией)', async () => {
    bff.daysReply = () => json(200, { days: [] })
    bff.state = st([del(1, { played: true }), del(2), und()])
    renderRoutePage(bff)
    await waitFor(() => expect(daysCalls()).toHaveLength(1))
    bff.state = st([del(1, { played: true }), del(2), und()], { revision: 6 })
    await reread()
    await waitFor(() => expect(daysCalls()).toHaveLength(2))
    await reread()
    await wait(50)
    expect(daysCalls()).toHaveLength(2)
  })
})

describe('L7: «Повторить» `next` сверяет дату плана', () => {
  it('обмен нового дня потерял ответ; новый план начинается с того же урока (тот же id) — `next` не уходит', async () => {
    const y = st([del(1, { played: true }), lesson('same', { played: true })], { snapshot_date: '2026-11-17' })
    y.day!.date = '2026-11-17'
    bff.state = y
    bff.jobReply = () => json(200, { status: 'failed', committed: false, committed_revision: null, cancel_reason: null, error_code: 'provider_error' })
    renderRoutePage(bff)
    fireEvent.click(await screen.findByRole('button', { name: 'Получить ролики на сегодня' }))
    await screen.findByRole('button', { name: 'Повторить' })
    const fresh = st([lesson('same'), und()], { revision: 7 })
    bff.state = fresh
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    await waitFor(() => expect(within(screen.getByTestId('day-hero')).getByRole('link', { name: 'Пройти урок' })).toBeTruthy())
    await wait(100)
    expect(bff.of('/api/me/route/exchange', 'POST')).toHaveLength(1)
  })
})

describe('W60: сброс шлёт ревизию в канал flib-route', () => {
  it('после «Да, сбросить» — postMessage({revision})', async () => {
    const posted: unknown[] = []
    class BC {
      onmessage: ((e: MessageEvent) => void) | null = null
      constructor(public name: string) {}
      postMessage(m: unknown) { if (this.name === 'flib-route') posted.push(m) }
      close() {}
    }
    vi.stubGlobal('BroadcastChannel', BC)
    bff.state = st([del(1, { played: true }), del(2), und()])
    renderRoutePage(bff)
    await screen.findByTestId('day-hero')
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить маршрут' }))
    bff.state = st(null, { started: false, route_id: null, revision: 9, started_at: null })
    fireEvent.click(within(screen.getByTestId('reset-confirm')).getByRole('button', { name: 'Да, сбросить' }))
    await waitFor(() => expect(posted).toContainEqual({ revision: 9 }))
  })
})
