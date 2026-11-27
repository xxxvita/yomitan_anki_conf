// carry-batch3b-day.test.tsx — переносы ревью партии 3а (второй круг, LOW) на
// экран дня: R2-L1/R2-L2 «Повторить» `next` не пропускает неоткрытый ролик;
// R2-L7 стражи (W11 отсчёт rate_limited на ожидании обмена, W12 кнопка остаётся
// при «Не удалось проверить маршрут», W14 «Повторить» своего быстрого старта),
// W8 пометка `replaced` — под блокировкой очереди.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { fireEvent, screen, waitFor, within, act } from '@testing-library/react'
import { __resetSessionForTests, __setSessionForTests } from '../../../session'
import { __resetRouteStateForTests } from '../use-route-state'
import { __resetRouteOutboxForTests } from '../outbox'
import { markReplaced } from '../replace-flow'
import { readWatched } from '../../../../player/route-events/route-watched'
import { FakeRouteBFF, json, renderRoutePage, st, del, und, ROUTE, TODAY, vid } from './route-page-fakes'
import type { RouteState } from '../route-api'
import { markClipListened, __resetClipListenedForTests } from '../../../../player/route-events/clip-listened'

let bff: FakeRouteBFF
beforeEach(() => {
  __resetSessionForTests(); __resetRouteStateForTests(); __resetRouteOutboxForTests()
  localStorage.clear(); __resetClipListenedForTests(); for (const n of [1, 2, 3]) markClipListened(`youtube::${vid(n)}`)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(`${TODAY}T12:00:00`))
  bff = new FakeRouteBFF()
  vi.stubGlobal('fetch', vi.fn((u: string, i?: RequestInit) => bff.fetch(u, i)))
  __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_abcd', routeAllowed: true, demo: false })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); __resetRouteOutboxForTests() })

const hero = () => screen.getByTestId('day-hero')
const exchanges = () => bff.of('/api/me/route/exchange', 'POST').map(c => c.body as Record<string, unknown>)
const wait = (ms: number) => act(async () => { await new Promise(r => setTimeout(r, ms)) })
const failedJob = () => json(200, { status: 'failed', committed: false, committed_revision: null, cancel_reason: null, error_code: 'provider_error' })
const notStarted = (): RouteState => st(null, { started: false, route_id: null, revision: 0, started_at: null })

async function failedNext() {
  bff.state = st([del(1, { played: true }), del(2, { played: true }), und()])
  bff.jobReply = failedJob
  renderRoutePage(bff)
  fireEvent.click(within(await screen.findByTestId('day-hero')).getByRole('button', { name: 'Следующий ролик' }))
  await screen.findByRole('button', { name: 'Повторить' })
  expect(exchanges()).toHaveLength(1)
}

async function failedQuickStart(after: RouteState) {
  let n = 0
  bff.state = () => { n++; return json(200, n === 1 ? notStarted() : after) }
  bff.jobReply = failedJob
  renderRoutePage(bff)
  fireEvent.click(await screen.findByRole('button', { name: 'Friends' }))
  fireEvent.click(screen.getByRole('button', { name: 'Начать маршрут' }))
  await screen.findByText('Не удалось подобрать ролик', {}, { timeout: 4000 })
}

describe('R2-L2: «Повторить» своего неудачного «Следующего ролика»', () => {
  it('другая вкладка уже выдала следующий ролик — `next` не уходит, на экране свежий день', async () => {
    await failedNext()
    bff.state = st([del(1, { played: true }), del(2, { played: true }), del(3)], { revision: 6 })
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    await waitFor(() => expect(hero().querySelector('h2')?.textContent).toBe('Title 3'))
    await wait(100)
    expect(exchanges()).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Повторить' })).toBeNull()
    expect(screen.queryByText('Не удалось подобрать ролик')).toBeNull()
  })

  it('контроль: текущий тот же — `next` уходит со свежей ревизией', async () => {
    await failedNext()
    bff.state = st([del(1, { played: true }), del(2, { played: true }), und()], { revision: 7 })
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    await waitFor(() => expect(exchanges()).toHaveLength(2))
    expect(exchanges()[1]).toMatchObject({ want: 'next', expected_revision: 7 })
  })
})

describe('R2-L1 / W14: «Повторить» быстрого старта', () => {
  it('быстрый старт присоединился к чужому обмену, у маршрута уже есть текущий ролик — `next` не уходит', async () => {
    await failedQuickStart(st([del(1), und()], { revision: 3 }))
    fireEvent.click(await screen.findByRole('button', { name: 'Повторить' }))
    await wait(150)
    expect(exchanges()).toHaveLength(0)
    expect(within(hero()).getByRole('link', { name: 'Смотреть' })).toBeTruthy()
  })

  it('свой быстрый старт: выданных роликов нет — «Повторить» предложена и шлёт `next`', async () => {
    await failedQuickStart(st([und(), und()], { revision: 3, current_puzzle_id: null }))
    fireEvent.click(await screen.findByRole('button', { name: 'Повторить' }))
    await waitFor(() => expect(exchanges()).toHaveLength(1))
    expect(exchanges()[0]).toMatchObject({ want: 'next', expected_revision: 3 })
  })
})

describe('R2-L7 стражи', () => {
  it('W12: «Повторить» — свежее чтение не удалось — сообщение «Не удалось проверить маршрут…» с кнопкой «Повторить»', async () => {
    await failedNext()
    let n = 0
    bff.state = () => { n++; return n === 1 ? json(503, { error: 'gateway_unavailable' }, { 'Retry-After': '1' }) : json(200, st([del(1, { played: true }), del(2, { played: true }), und()])) }
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    await screen.findByText('Не удалось проверить маршрут. Попробуйте ещё раз', {}, { timeout: 4000 })
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeTruthy()
    expect(exchanges()).toHaveLength(1)
  })

  it('W11: 429 rate_limited на создании обмена — отсчёт «Повторим через N с», не «продолжим в»', async () => {
    bff.state = st([del(1, { played: true }), und()])
    bff.exchangeReply = () => json(429, { error: 'rate_limited', retry_after_sec: 30 }, { 'Retry-After': '30' })
    renderRoutePage(bff)
    fireEvent.click(within(await screen.findByTestId('day-hero')).getByRole('button', { name: 'Следующий ролик' }))
    await screen.findByText(/^Маршрут временно недоступен\. Повторим через \d+ с$/)
    expect(screen.queryByText(/продолжим в/)).toBeNull()
  })

  it('W8: пометка `replaced` пишется под блокировкой очереди', async () => {
    let releaseHeld: () => void = () => {}
    const held = new Promise<void>(r => { releaseHeld = r })
    let tail: Promise<unknown> = held
    vi.stubGlobal('navigator', Object.assign(Object.create(navigator), {
      locks: { request: (_n: string, fn: () => Promise<unknown>) => { const run = tail.then(() => fn()); tail = run.catch(() => undefined); return run } },
    }))
    __resetRouteOutboxForTests()
    const p = markReplaced('youtube::vid00000001', { routeId: ROUTE, day: TODAY })
    await wait(30)
    expect(readWatched()?.replaced ?? []).not.toContain('youtube::vid00000001')
    releaseHeld()
    await p
    expect(readWatched()?.replaced ?? []).toContain('youtube::vid00000001')
  })
})
