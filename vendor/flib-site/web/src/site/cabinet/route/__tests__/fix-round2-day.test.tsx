// fix-round2-day.test.tsx — ревью партии 3а, второй круг (экран дня):
// R1-C1 «Повторить» не повторяет замену вслепую; R1-H1 пометка `replaced` только
// после НАШЕЙ закоммиченной замены; дополнения правила H1 (seq записи после
// отправки запроса; перечитывание и до первого ответа); тексты; стражи R1-L4.
// Порт проб `review-b3a-r1/probes/zz-r1-day.test.tsx`, `zz-r1-repeat.test.tsx`,
// `zz-r1-tomb.test.tsx`.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { fireEvent, screen, waitFor, within, act } from '@testing-library/react'
import { __resetSessionForTests, __setSessionForTests } from '../../../session'
import { __resetRouteStateForTests } from '../use-route-state'
import { __resetRouteOutboxForTests, getRouteOutbox } from '../outbox'
import { writeWatched, readWatched, removeWatched, WATCHED_MAX_REPLACED } from '../../../../player/route-events/route-watched'
import { buildDayModel, heroButtons } from '../day-model'
import { MemStorage } from './outbox-fakes'
import { FakeRouteBFF, json, renderRoutePage, st, del, und, kept, pid, ROUTE, TODAY } from './route-page-fakes'
import type { RouteState } from '../route-api'

let bff: FakeRouteBFF
beforeEach(() => {
  __resetSessionForTests(); __resetRouteStateForTests(); __resetRouteOutboxForTests()
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(`${TODAY}T12:00:00`))
  bff = new FakeRouteBFF()
  vi.stubGlobal('fetch', vi.fn((u: string, i?: RequestInit) => bff.fetch(u, i)))
  __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_abcd', routeAllowed: true, demo: false })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); __resetRouteOutboxForTests() })

const row = (i: number) => screen.getByTestId(`row-${i}`)
const hero = () => screen.getByTestId('day-hero')
const exchanges = () => bff.of('/api/me/route/exchange', 'POST').map(c => c.body as Record<string, unknown>)
const wait = (ms: number) => act(async () => { await new Promise(r => setTimeout(r, ms)) })
async function show(s: RouteState) { bff.state = s; renderRoutePage(bff); await screen.findByTestId('day-hero').catch(() => screen.findByTestId('day-done')) }
async function reread() { await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await new Promise(r => setTimeout(r, 60)) }) }
const failedJob = () => json(200, { status: 'failed', committed: false, committed_revision: null, cancel_reason: null, error_code: 'provider_error' })
const noClipJob = () => json(200, { status: 'done', committed: false, committed_revision: null, cancel_reason: null, error_code: 'daemon_error' })

async function replaceRow1() {
  fireEvent.click(within(row(1)).getByRole('button', { name: 'Заменить' }))
  fireEvent.click(within(screen.getByTestId('replace-confirm')).getByRole('button', { name: 'Заменить' }))
}
async function dislikeRow1() {
  fireEvent.click(within(row(1)).getByRole('button', { name: 'Не нравится' }))
  const p = screen.getByTestId('dislike-reasons')
  fireEvent.click(within(p).getByLabelText('Не интересно'))
  fireEvent.click(within(p).getByRole('button', { name: 'Отправить' }))
}

describe('R1-C1: «Повторить» после неудачной замены', () => {
  it('«Заменить» → задание failed → день пересобран (ролик стал kept) → «Повторить»: обмена нет, «Замена сейчас недоступна»', async () => {
    await show(st([del(1, { played: true }), del(2), und()]))
    bff.jobReply = failedJob
    await replaceRow1()
    await screen.findByRole('button', { name: 'Повторить' })
    bff.state = st([kept(1), del(3), und()], { revision: 6 })
    await reread()
    await waitFor(() => expect(row(1).getAttribute('data-kind')).toBe('kept'))
    const n = exchanges().length
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    await screen.findByText('Замена сейчас недоступна')
    await wait(100)
    expect(exchanges().length).toBe(n)
  })

  it('«Повторить» проверяет СВЕЖЕЕ состояние, а не чтение, ушедшее до пересборки дня', async () => {
    await show(st([del(1, { played: true }), del(2), und()]))
    bff.jobReply = failedJob
    await replaceRow1()
    await screen.findByRole('button', { name: 'Повторить' })
    // перечитывание уходит и висит; ответ его посчитан до пересборки (ролик ещё в плане)
    let release: () => void = () => {}
    const oldState = st([del(1, { played: true }), del(2), und()], { revision: 5 })
    bff.state = () => new Promise<Response>(r => { release = () => r(json(200, oldState)) })
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await new Promise(r => setTimeout(r, 20)) })
    // день пересобран: свежие ответы — ролик 1 уже kept
    const held = release
    bff.state = st([kept(1), del(3), und()], { revision: 6 })
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    await act(async () => { held(); await new Promise(r => setTimeout(r, 100)) })
    await screen.findByText('Замена сейчас недоступна')
    await wait(100)
    expect(exchanges().length).toBe(1)
  })

  it('то же по пути «Не нравится» (с replace_reason)', async () => {
    await show(st([del(1, { played: true }), del(2), und()]))
    bff.jobReply = failedJob
    await dislikeRow1()
    await screen.findByRole('button', { name: 'Повторить' })
    expect(exchanges()[0]).toMatchObject({ want: 'replace', replace_reason: 'content' })
    bff.state = st([kept(1), del(3), und()], { revision: 6 })
    await reread()
    await waitFor(() => expect(row(1).getAttribute('data-kind')).toBe('kept'))
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    await screen.findByText('Замена сейчас недоступна')
    await wait(100)
    expect(exchanges().length).toBe(1)
  })

  it('контроль: день не менялся — «Повторить» шлёт ту же замену (тот же ролик и причина) со свежей ревизией', async () => {
    await show(st([del(1, { played: true }), del(2), und()]))
    bff.jobReply = failedJob
    await dislikeRow1()
    await screen.findByRole('button', { name: 'Повторить' })
    bff.state = st([del(1, { played: true }), del(2), und()], { revision: 7 })
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    await waitFor(() => expect(exchanges().length).toBe(2))
    expect(exchanges()[1]).toMatchObject({ want: 'replace', replace_puzzle_id: pid(1), replace_reason: 'content', expected_revision: 7 })
  })

  it('наша замена закоммичена, позже опрошенный ЧУЖОЙ обмен упал — «Повторить» не предлагается, нашу замену не повторить', async () => {
    await show(st([del(1, { played: true }), del(2), und()]))
    bff.afterCommit = st([del(1, { played: true }), del(3), und()], { revision: 6 })
    fireEvent.click(within(hero()).getByRole('button', { name: 'Заменить' }))
    fireEvent.click(within(screen.getByTestId('replace-confirm')).getByRole('button', { name: 'Заменить' }))
    await waitFor(() => expect(hero().querySelector('h2')?.textContent).toBe('Title 3'))
    bff.jobReply = failedJob
    bff.state = st([del(1, { played: true }), del(3), und()], { revision: 6, active_exchange: { job_id: '55555555-5555-4555-8555-555555555555', status: 'processing', created_at: new Date().toISOString() } })
    await reread()
    bff.state = st([del(1, { played: true }), del(3), und()], { revision: 6 })
    await screen.findByText('Не удалось подобрать ролик', {}, { timeout: 4000 })
    expect(screen.queryByRole('button', { name: 'Повторить' })).toBeNull()
    expect(exchanges().length).toBe(1)
  })
})

describe('R1-H1: пометка `replaced` — только после нашей закоммиченной замены', () => {
  async function tryReplaceLast(kind: 'no_clip' | 'stale' | 'failed' | 'foreign') {
    await show(st([del(1, { played: true }), del(2)]))
    if (kind === 'no_clip') bff.jobReply = noClipJob
    if (kind === 'failed') bff.jobReply = failedJob
    if (kind === 'stale') bff.exchangeReply = () => json(409, { error: 'stale_revision', revision: 5 })
    if (kind === 'foreign') {
      bff.exchangeReply = () => json(409, { error: 'exchange_in_progress', job_id: '44444444-4444-4444-8444-444444444444', revision: 5 })
      bff.afterCommit = st([del(1, { played: true }), del(2)], { revision: 6 })
    }
    fireEvent.click(within(hero()).getByRole('button', { name: 'Заменить' }))
    fireEvent.click(within(screen.getByTestId('replace-confirm')).getByRole('button', { name: 'Заменить' }))
    await waitFor(() => expect(exchanges().length).toBe(1))
    await wait(300)
    // ролик всё ещё текущий; человек досматривает его до 90 %: плеер пишет отметку, отчёт у шлюза
    writeWatched(ROUTE, TODAY, pid(2), 0.9, { video_id: 'vid00000002', title: 'Title 2', duration_sec: 300 })
    bff.state = st([del(1, { played: true }), del(2, { queued_played: true })], { revision: kind === 'foreign' ? 6 : 5 })
    await reread()
    await wait(100)
  }
  for (const kind of ['no_clip', 'stale', 'failed', 'foreign'] as const) {
    it(`${kind}: отметка ролика пишется, день завершается, пометки нет`, async () => {
      await tryReplaceLast(kind)
      expect(readWatched()?.items[pid(2)]?.share).toBe(0.9)
      expect(readWatched()?.replaced ?? []).not.toContain(pid(2))
      expect(screen.getByTestId('day-done')).toBeTruthy()
    })
  }

  it('замена закоммичена — пометка есть: поздняя отметка другой вкладки строки kept_local не даёт', async () => {
    await show(st([del(1), del(2), und()]))
    bff.afterCommit = st([del(3), und()], { revision: 6 })
    await replaceRow1()
    await waitFor(() => expect(row(1).getAttribute('data-kind')).toBe('current'))
    await waitFor(() => expect(readWatched()?.replaced ?? []).toContain(pid(1)))
    writeWatched(ROUTE, TODAY, pid(1), 0.9, { video_id: 'vid00000001', title: 'Title 1', duration_sec: 300 })
    await reread()
    expect(screen.getAllByTestId(/^row-\d+$/).map(r => r.getAttribute('data-kind'))).not.toContain('kept_local')
  })
})

describe('H1, дополнение 1: запись отметки создана после отправки запроса состояния', () => {
  it('модель: seq записи больше запомненного — отчёт «не обработан» даже без очереди', () => {
    const s = st([del(1), und()])
    const m = buildDayModel(s, { watched: { [pid(1)]: { share: 0.7, seq: 5 } }, pendingClipPlayed: new Set(), sentWatchedSeq: 4 })
    expect(heroButtons(m)).toEqual({ primary: 'next', secondary: 'watch_again' })
    const old = buildDayModel(s, { watched: { [pid(1)]: { share: 0.7, seq: 4 } }, pendingClipPlayed: new Set(), sentWatchedSeq: 4 })
    expect(heroButtons(old)).toEqual({ primary: 'watch', secondary: null })
  })

  it('страница: запрос ушёл, другая вкладка поставила отметку и отправила отчёт, ответ без queued_played — ролик «просмотрен»', async () => {
    let release: (r: Response) => void = () => {}
    bff.state = () => new Promise<Response>(res => { release = res })
    renderRoutePage(bff)
    await waitFor(() => expect(bff.stateGets).toBe(1))
    writeWatched(ROUTE, TODAY, pid(1), 0.7, {})
    await act(async () => { release(json(200, st([del(1), und()]))); await new Promise(r => setTimeout(r, 60)) })
    await screen.findByTestId('day-hero')
    expect(within(hero()).getByRole('button', { name: 'Следующий ролик' })).toBeTruthy()
    // R2-L5: условие (4) держит и саму запись — сторож удаления её не тронул
    await act(async () => { await getRouteOutbox().locked(() => undefined) })
    expect(readWatched()?.items[pid(1)]?.share).toBe(0.7)
  })
})

describe('H1, дополнение 2: перечитывание после принятого отчёта и до первого ответа', () => {
  it('первый ответ ещё не пришёл, пачка с отчётом принята — уходит свой запрос состояния', async () => {
    let n = 0
    bff.state = () => { n++; return n === 1 ? new Promise<Response>(() => {}) : json(200, st([del(1, { queued_played: true }), und()])) }
    renderRoutePage(bff)
    await waitFor(() => expect(n).toBe(1))
    await getRouteOutbox().enqueueDurable(ROUTE, { event_id: 'web:h1b', type: 'clip_played', puzzle_id: pid(1), played_frac: 0.9, learning_day: TODAY, client_ts: new Date().toISOString() }, { frac: 0.9 })
    await act(async () => { await getRouteOutbox().flush({ timeoutMs: 3000 }) })
    await waitFor(() => expect(n).toBeGreaterThanOrEqual(2))
    await screen.findByTestId('day-hero')
  })
})

describe('тексты и стражи (R1-L3, R1-L4)', () => {
  it('быстрый старт 429 rate_limited — отсчёт «Повторим через N с», а не «продолжим в HH:MM»', async () => {
    bff.state = st(null, { started: false, route_id: null, revision: 0, started_at: null })
    bff.quickStartReply = () => json(429, { error: 'rate_limited' }, { 'Retry-After': '30' })
    renderRoutePage(bff)
    fireEvent.click(await screen.findByRole('button', { name: 'Friends' }))
    fireEvent.click(screen.getByRole('button', { name: 'Начать маршрут' }))
    await screen.findByText(/^Маршрут временно недоступен\. Повторим через \d+ с$/)
    expect(screen.queryByText(/продолжим в/)).toBeNull()
  })

  it('401 на сброс — перечитать сессию', async () => {
    bff.state = st(null)
    renderRoutePage(bff)
    const orig = bff.fetch
    bff.fetch = async (u: string, i: RequestInit = {}) => (u === '/api/me/route' && (i.method ?? '') === 'DELETE') ? json(401, { error: 'key_revoked' }) : orig(u, i)
    const before = bff.of('/api/session').length
    fireEvent.click(await screen.findByRole('button', { name: 'Сбросить и выбрать другую цель' }))
    await waitFor(() => expect(bff.of('/api/session').length).toBeGreaterThan(before))
  })

  it('пометок `replaced` не больше 50, старшие вытесняются', () => {
    const s = new MemStorage()
    for (let i = 0; i <= WATCHED_MAX_REPLACED; i++) removeWatched(`youtube::r${i}`, s, { routeId: ROUTE, day: TODAY })
    const r = readWatched(s)!.replaced!
    expect(r.length).toBe(WATCHED_MAX_REPLACED)
    expect(r).not.toContain('youtube::r0')
    expect(r).toContain(`youtube::r${WATCHED_MAX_REPLACED}`)
  })
})
