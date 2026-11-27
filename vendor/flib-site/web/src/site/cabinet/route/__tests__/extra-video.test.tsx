// extra-video.test.tsx — кнопка «Дополнительное видео» и строки на странице
// маршрута (спека extra-video §2, §6, §9, §10): каждая строка таблицы §6, один
// POST на двойной клик, подхват чужого задания, опрос и его пределы, сброс
// маршрута во время подбора, счётчики дня без изменений.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { fireEvent, screen, waitFor, act, within, render } from '@testing-library/react'
import { StrictMode } from 'react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { RoutePageCabinet } from '../RoutePageCabinet'
import { __resetSessionForTests, __setSessionForTests } from '../../../session'
import { __resetRouteStateForTests } from '../use-route-state'
import { __resetRouteOutboxForTests, getRouteOutbox } from '../outbox'
import { __resetDaysLoaderForTests } from '../route-days'
import { __resetVideoTitlesForTests } from '../use-video-titles'
import type { RouteState } from '../route-api'
import { FakeRouteBFF, json, renderRoutePage, st, del, und, xrow, pid, vid, ROUTE, ROUTE2, TODAY, EXTRA_JOB } from './route-page-fakes'
import { played } from './outbox-fakes'

let bff: FakeRouteBFF
beforeEach(() => {
  __resetSessionForTests(); __resetRouteStateForTests(); __resetRouteOutboxForTests(); __resetDaysLoaderForTests(); __resetVideoTitlesForTests()
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(`${TODAY}T12:00:00`))
  bff = new FakeRouteBFF()
  vi.stubGlobal('fetch', vi.fn((u: string, i?: RequestInit) => bff.fetch(u, i)))
  __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_abcd', routeAllowed: true, demo: false })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); __resetRouteOutboxForTests(); __resetDaysLoaderForTests() })

const BASE_MS = new Date(`${TODAY}T12:00:00`).getTime()
// clock — своё время и пауза опроса: каждая пауза двигает время на свой срок.
function clock() {
  let t = 0
  return { now: () => BASE_MS + t, sleep: async (ms: number) => { t += ms; await new Promise(r => setTimeout(r, 0)) } }
}
// gate — паузы не кончаются, пока их не отпустят; записывает сроки.
function gate() {
  const waits: Array<{ ms: number; release: () => void }> = []
  let t = 0
  return {
    waits, now: () => BASE_MS + t, advance: (ms: number) => { t += ms },
    sleep: (ms: number) => new Promise<void>(res => { waits.push({ ms, release: () => res() }) }),
  }
}

const base = (over: Partial<RouteState> = {}) => st([del(1)], { extras: [], extra_available: true, extra_active: null, ...over })
const withRow = (n: number, over: Partial<RouteState> = {}) => base({ revision: 6, extras: [xrow(n)], ...over })
const addBtn = () => screen.getByRole('button', { name: /^(Дополнительное видео|Подбираем…)$/ })
const noAddBtn = () => expect(screen.queryByRole('button', { name: /^(Дополнительное видео|Подбираем…)$/ })).toBeNull()
const note = () => screen.queryByTestId('extra-note')?.textContent ?? ''
const click = (el: Element) => act(async () => { fireEvent.click(el) })
const wait = (ms: number) => act(async () => { await new Promise(r => setTimeout(r, ms)) })
const posts = () => bff.of('/api/me/route/extra', 'POST')
const GENERIC = 'Не получилось подобрать видео. Попробуйте ещё раз'

async function ready(over: Partial<RouteState> = {}, deps?: Parameters<typeof renderRoutePage>[1]) {
  bff.state = base(over)
  const r = renderRoutePage(bff, deps)
  await screen.findByTestId('day-hero')
  return r
}

describe('видимость', () => {
  it('день, extras, ключ не демо — кнопка готова, под ней пусто; в запросе for_date', async () => {
    await ready()
    expect(addBtn().textContent).toBe('Дополнительное видео')
    expect((addBtn() as HTMLButtonElement).disabled).toBe(false)
    expect(addBtn().getAttribute('type')).toBe('button')
    expect(note()).toBe('')
    expect(posts()).toHaveLength(0)
  })

  it('старый шлюз (extras нет): ни кнопки, ни строк, запросов нет', async () => {
    bff.state = st([del(1)])
    renderRoutePage(bff)
    await screen.findByTestId('day-hero')
    noAddBtn()
    expect(screen.queryByTestId('extra-row')).toBeNull()
    expect(screen.queryByTestId('extra-note')).toBeNull()
    expect(bff.calls.filter(c => c.url.includes('/extra'))).toHaveLength(0)
  })

  it('демо: кнопки нет и запросов нет', async () => {
    __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_abcd', routeAllowed: true, demo: true })
    await ready()
    noAddBtn()
    expect(bff.calls.filter(c => c.url.includes('/extra'))).toHaveLength(0)
  })

  it('новый учебный день: строки есть, кнопки нет', async () => {
    bff.state = base({ snapshot_date: '2026-11-17', extras: [xrow(1)] })
    renderRoutePage(bff)
    await screen.findByTestId('extra-row')
    noAddBtn()
  })

  it('выбран прошлый день: ни кнопки, ни строк', async () => {
    bff.daysReply = from => json(200, { days: from.startsWith('2026-10') ? [{ date: '2026-10-20', clips: [{ puzzle_id: pid(5), kind: 'youtube', video_id: vid(5), title: 'Past', source: 'YouTube', duration_sec: 300 }] }] : [] })
    bff.state = base({ started_at: '2026-10-01T10:00:00Z', extras: [xrow(1)] })
    renderRoutePage(bff)
    await screen.findByTestId('route-calendar')
    expect(screen.getByTestId('extra-row')).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Предыдущий месяц' })) })
    await waitFor(() => expect(screen.getByTestId('cal-2026-10-20').getAttribute('data-kind')).toBe('past'))
    fireEvent.click(screen.getByTestId('cal-2026-10-20'))
    await screen.findByTestId('past-day')
    noAddBtn()
    expect(screen.queryByTestId('extra-row')).toBeNull()
  })

  it('экран «маршрут кончился»: ни кнопки, ни строк', async () => {
    bff.state = st(null, { stop_reason: 'goal', extras: [xrow(1)], extra_available: true, extra_active: null })
    renderRoutePage(bff)
    await screen.findByText(/маршрут/i)
    noAddBtn()
    expect(screen.queryByTestId('extra-row')).toBeNull()
  })

  it('карточка «На сегодня всё» и кнопка вместе', async () => {
    bff.state = st([del(1, { played: true })], { extras: [], extra_available: true, extra_active: null })
    renderRoutePage(bff)
    await screen.findByTestId('day-done')
    expect(addBtn()).toBeTruthy()
  })
})

describe('таблица §6', () => {
  it('готова → подбор → ролик пришёл: POST с for_date, строка добавлена, фокус на «Смотреть», заметки нет', async () => {
    bff.state = n => json(200, n <= 1 ? base() : withRow(5))
    renderRoutePage(bff, { deps: clock() })
    await screen.findByTestId('day-hero')
    await click(addBtn())
    expect(posts()).toHaveLength(1)
    expect(posts()[0].body).toEqual({ for_date: TODAY })
    const row = await screen.findByTestId('extra-row')
    const link = within(row).getByRole('link', { name: /^Смотреть: Extra \d+$/ })
    expect(link.getAttribute('href')).toBe('/player?v=xtr00000005&back=route&rx=youtube%3A%3Axtr00000005')
    await waitFor(() => expect(document.activeElement).toBe(link))
    expect(addBtn().textContent).toBe('Дополнительное видео')
    expect((addBtn() as HTMLButtonElement).disabled).toBe(false)
    expect(note()).toBe('')
  })

  it('подбор: «Подбираем…», неактивна, aria-busy; дольше 60 с — заметка', async () => {
    const g = gate()
    await ready({}, { deps: g })
    bff.extraJobReply = () => json(200, { status: 'running', outcome: null })
    await click(addBtn())
    expect(addBtn().textContent).toBe('Подбираем…')
    expect(addBtn().getAttribute('aria-disabled')).toBe('true')
    expect(addBtn().getAttribute('aria-busy')).toBe('true')
    expect(note()).toBe('')
    for (let i = 0; i < 29; i++) { await waitFor(() => expect(g.waits.length).toBe(i + 1)); g.advance(g.waits[i].ms); await act(async () => { g.waits[i].release() }) }
    await waitFor(() => expect(g.waits.length).toBe(30))
    expect(note()).toBe('')
    g.advance(g.waits[29].ms + 1000)
    await act(async () => { g.waits[29].release() })
    await waitFor(() => expect(note()).toBe('Подбор идёт дольше обычного'))
  })

  it('ролика нет (none): кнопка готова, заметка', async () => {
    bff.extraJobReply = () => json(200, { status: 'done', outcome: 'none' })
    await ready({}, { deps: clock() })
    await click(addBtn())
    await waitFor(() => expect(note()).toBe('Сейчас подходящего видео нет. Попробуйте позже'))
    expect((addBtn() as HTMLButtonElement).disabled).toBe(false)
  })

  it('failed — общий текст', async () => {
    bff.extraJobReply = () => json(200, { status: 'done', outcome: 'failed' })
    await ready({}, { deps: clock() })
    await click(addBtn())
    await waitFor(() => expect(note()).toBe(GENERIC))
  })

  it('подбор дал ролик, а новой строки нет — общий текст, кнопка активна', async () => {
    await ready({ extras: [xrow(5)] }, { deps: clock() })
    await click(addBtn())
    await waitFor(() => expect(note()).toBe(GENERIC))
    expect((addBtn() as HTMLButtonElement).disabled).toBe(false)
    expect(document.activeElement).not.toBe(screen.getByTestId('extra-row').querySelector('a'))
  })

  it('строка с тем же id, что была до подбора, новой не считается — общий текст', async () => {
    bff.state = n => json(200, n <= 1 ? base({ extras: [xrow(5, { played: true })] }) : base({ revision: 6, extras: [xrow(5, { played: false })] }))
    renderRoutePage(bff, { deps: clock() })
    await screen.findByTestId('day-hero')
    await click(addBtn())
    await waitFor(() => expect(note()).toBe(GENERIC))
  })

  it('следующий клик очищает заметку', async () => {
    let calls = 0
    const c = clock()
    const deps = { now: c.now, sleep: (ms: number) => (++calls === 1 ? c.sleep(ms) : new Promise<void>(() => {})) }
    bff.extraJobReply = () => json(200, { status: 'done', outcome: 'none' })
    await ready({}, { deps })
    await click(addBtn())
    await waitFor(() => expect(note()).toBe('Сейчас подходящего видео нет. Попробуйте позже'))
    await click(addBtn())
    expect(note()).toBe('')
    expect(addBtn().textContent).toBe('Подбираем…')
  })

  it('заметка очищается, когда сменился snapshot_date (перечитанное состояние)', async () => {
    bff.extraReply = () => json(409, { error: 'more_busy' })
    const g = gate()
    await ready({}, { deps: g })
    await click(addBtn())
    await waitFor(() => expect(note()).toBe('Подбор уже идёт в программе. Попробуйте через минуту'))
    bff.state = base({ snapshot_date: '2026-11-19', revision: 7 })
    vi.setSystemTime(new Date('2026-11-19T12:00:00')); g.advance(24 * 3600_000)
    await vis()
    await waitFor(() => expect(bff.stateGets).toBeGreaterThan(1))
    await waitFor(() => expect(note()).toBe(''))
  })

  it('заметка очищается, когда в extras того же маршрута появилась новая строка (другая вкладка)', async () => {
    bff.extraReply = () => json(409, { error: 'more_busy' })
    await ready({}, { deps: gate() })
    await click(addBtn())
    await waitFor(() => expect(note()).toBe('Подбор уже идёт в программе. Попробуйте через минуту'))
    bff.state = withRow(5)
    await vis()
    await screen.findByTestId('extra-row')
    expect(note()).toBe('')
  })

  it('10 за день: неактивна, текст; держится, пока не сменился день', async () => {
    const g = gate()
    bff.extraReply = () => json(409, { error: 'more_day_limit' })
    await ready({}, { deps: g })
    await click(addBtn())
    await waitFor(() => expect(note()).toBe('На сегодня это все дополнительные видео'))
    expect((addBtn() as HTMLButtonElement).disabled).toBe(true)
    // Учебный день сменился, состояние перечитано уже новым днём: прежний предел не действует.
    const NEXT = '2026-11-19'
    vi.setSystemTime(new Date(`${NEXT}T12:00:00`)); g.advance(24 * 3600_000)
    bff.state = base({ snapshot_date: NEXT })
    await vis()
    await waitFor(() => expect(bff.stateGets).toBeGreaterThan(1))
    await waitFor(() => expect((addBtn() as HTMLButtonElement).disabled).toBe(false))
    expect(note()).toBe('')
  })

  it('«Дополнительное видео» неактивна, если подбор недоступен (extra_available не true)', async () => {
    await ready({ extra_available: false })
    expect((addBtn() as HTMLButtonElement).disabled).toBe(true)
    expect(note()).toBe('Подбор видео сейчас недоступен')
    await click(addBtn())
    expect(posts()).toHaveLength(0)
  })

  it('идёт обмен дня (active_exchange): нет кнопки (экран подбора), поиск не стартует', async () => {
    bff.state = base({ active_exchange: { job_id: 'j', status: 'processing', created_at: new Date().toISOString() } })
    renderRoutePage(bff)
    await waitFor(() => expect(screen.queryByTestId('day-hero')).toBeNull())
    noAddBtn()
    expect(posts()).toHaveLength(0)
  })

  it('429 любого кода: «через N мин» по Retry-After, неактивна, потом возвращается сама', async () => {
    const g = gate()
    bff.extraReply = () => json(429, { error: 'whatever' }, { 'Retry-After': '90' })
    await ready({}, { deps: g })
    await click(addBtn())
    await waitFor(() => expect(note()).toBe('Слишком часто. Попробуйте через 2 мин'))
    expect((addBtn() as HTMLButtonElement).disabled).toBe(true)
    await waitFor(() => expect(g.waits.length).toBe(1))
    expect(g.waits[0].ms).toBe(60_000)
    g.advance(90_000)
    await act(async () => { g.waits[0].release() })
    await waitFor(() => expect((addBtn() as HTMLButtonElement).disabled).toBe(false))
    expect(note()).toBe('')
  })

  it('429 без Retry-After: не меньше 1 мин', async () => {
    bff.extraReply = () => json(429, {})
    await ready({}, { deps: gate() })
    await click(addBtn())
    await waitFor(() => expect(note()).toBe('Слишком часто. Попробуйте через 1 мин'))
  })

  it('409 more_busy: заметка про программу, кнопка активна', async () => {
    bff.extraReply = () => json(409, { error: 'more_busy' })
    await ready({}, { deps: clock() })
    await click(addBtn())
    await waitFor(() => expect(note()).toBe('Подбор уже идёт в программе. Попробуйте через минуту'))
    expect((addBtn() as HTMLButtonElement).disabled).toBe(false)
  })

  it('503 more_unavailable: перечитывает состояние, «Подбор видео сейчас недоступен»', async () => {
    bff.extraReply = () => json(503, { error: 'more_unavailable' })
    await ready({}, { deps: clock() })
    const g0 = bff.stateGets
    await click(addBtn())
    await waitFor(() => expect(note()).toBe('Подбор видео сейчас недоступен'))
    expect(bff.stateGets).toBeGreaterThan(g0)
  })

  it('401: перечитывает сессию', async () => {
    bff.extraReply = () => json(401, { error: 'no_session' })
    await ready({}, { deps: clock() })
    const s0 = bff.of('/api/session').length
    await click(addBtn())
    await waitFor(() => expect(bff.of('/api/session').length).toBeGreaterThan(s0))
  })

  it('403: перечитывает состояние', async () => {
    bff.extraReply = () => json(403, { error: 'key_expired' })
    await ready({}, { deps: clock() })
    const g0 = bff.stateGets
    await click(addBtn())
    await waitFor(() => expect(bff.stateGets).toBeGreaterThan(g0))
  })

  it.each(['no_day', 'route_not_started'])('409 %s: перечитывает состояние и общий текст', async code => {
    bff.extraReply = () => json(409, { error: code })
    await ready({}, { deps: clock() })
    const g0 = bff.stateGets
    await click(addBtn())
    await waitFor(() => expect(note()).toBe(GENERIC))
    expect(bff.stateGets).toBeGreaterThan(g0)
  })

  it.each([[500, { error: 'x' }], [502, { error: 'bad_gateway_thing' }], [0, null]])('ответ %s — общий текст, кнопка активна', async (status, body) => {
    bff.extraReply = () => { if (status === 0) throw new TypeError('net'); return json(status, body) }
    await ready({}, { deps: clock() })
    await click(addBtn())
    await waitFor(() => expect(note()).toBe(GENERIC))
    expect((addBtn() as HTMLButtonElement).disabled).toBe(false)
  })

  it('«Следующий ролик» доступен во время подбора', async () => {
    bff.state = st([del(1, { played: true }), und()], { extras: [], extra_available: true, extra_active: null })
    bff.extraJobReply = () => json(200, { status: 'running', outcome: null })
    renderRoutePage(bff, { deps: gate() })
    await screen.findByTestId('day-hero')
    await click(addBtn())
    expect(addBtn().textContent).toBe('Подбираем…')
    const next = screen.getAllByRole('button', { name: 'Следующий ролик' })
    expect(next.some(b => !(b as HTMLButtonElement).disabled)).toBe(true)
  })
})

describe('двойной клик и подхват', () => {
  it('два клика в одном такте — один POST', async () => {
    await ready({}, { deps: gate() })
    const b = addBtn()
    await act(async () => { fireEvent.click(b); fireEvent.click(b) })
    expect(posts()).toHaveLength(1)
  })

  it('перезагрузка во время подбора: extra_active подхватывается, POST нет', async () => {
    const live = { job_id: EXTRA_JOB, status: 'processing', created_at: new Date(Date.now() - 60_000).toISOString() }
    bff.state = n => json(200, n <= 1 ? base({ extra_active: live }) : withRow(5))
    renderRoutePage(bff, { deps: clock() })
    await screen.findByTestId('extra-row')
    expect(posts()).toHaveLength(0)
    expect(bff.extraJobGets).toBeGreaterThanOrEqual(1)
  })

  it('подхваченный подбор идёт с «Подбираем…»; тот же id повторно не опрашивается', async () => {
    const live = { job_id: EXTRA_JOB, status: 'processing', created_at: new Date(Date.now() - 60_000).toISOString() }
    bff.state = base({ extra_active: live })
    bff.extraJobReply = () => json(200, { status: 'done', outcome: 'none' })
    renderRoutePage(bff, { deps: clock() })
    await waitFor(() => expect(note()).toBe('Сейчас подходящего видео нет. Попробуйте позже'))
    await wait(60)
    expect(bff.extraJobGets).toBe(1)
  })

  it('extra_active нет — опроса нет', async () => {
    await ready({ extra_active: null })
    await wait(60)
    expect(bff.extraJobGets).toBe(0)
  })

  it('зависший extra_active (старше 10 мин) не подхватывается', async () => {
    const stuck = { job_id: EXTRA_JOB, status: 'processing', created_at: new Date(Date.now() - 20 * 60_000).toISOString() }
    bff.state = base({ extra_active: stuck })
    renderRoutePage(bff, { deps: clock() })
    await screen.findByTestId('day-hero')
    await wait(60)
    expect(bff.extraJobGets).toBe(0)
  })

  it('демо не подхватывает', async () => {
    __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_abcd', routeAllowed: true, demo: true })
    const live = { job_id: EXTRA_JOB, status: 'processing', created_at: new Date(Date.now() - 60_000).toISOString() }
    bff.state = base({ extra_active: live })
    renderRoutePage(bff, { deps: clock() })
    await screen.findByTestId('day-hero')
    await wait(60)
    expect(bff.extraJobGets).toBe(0)
  })
})

describe('опрос', () => {
  it('ошибки 429, 503 и сети не останавливают опрос', async () => {
    const seq = [() => json(429, {}), () => json(503, { error: 'x' }), () => { throw new TypeError('net') }, () => json(200, { status: 'running', outcome: null })]
    bff.extraJobReply = n => (n <= seq.length ? seq[n - 1]() : json(200, { status: 'done', outcome: 'clip' }))
    bff.state = n => json(200, n <= 1 ? base() : withRow(5))
    renderRoutePage(bff, { deps: clock() })
    await screen.findByTestId('day-hero')
    await click(addBtn())
    await screen.findByTestId('extra-row')
    expect(bff.extraJobGets).toBe(5)
  })

  it('404 задания и отказ шлюза — общий текст, опрос остановлен', async () => {
    bff.extraJobReply = () => json(404, { error: 'job_not_found' })
    await ready({}, { deps: clock() })
    await click(addBtn())
    await waitFor(() => expect(note()).toBe(GENERIC))
    await wait(40)
    expect(bff.extraJobGets).toBe(1)
  })

  it('отказ 502 с кодом шлюза — общий текст, опрос остановлен', async () => {
    bff.extraJobReply = () => json(502, { error: 'refused_by_gateway' })
    await ready({}, { deps: clock() })
    await click(addBtn())
    await waitFor(() => expect(note()).toBe(GENERIC))
    await wait(40)
    expect(bff.extraJobGets).toBe(1)
  })

  it('401 при опросе перечитывает сессию и опрос идёт дальше', async () => {
    bff.extraJobReply = n => (n === 1 ? json(401, {}) : json(200, { status: 'done', outcome: 'none' }))
    await ready({}, { deps: clock() })
    const s0 = bff.of('/api/session').length
    await click(addBtn())
    await waitFor(() => expect(note()).toBe('Сейчас подходящего видео нет. Попробуйте позже'))
    expect(bff.of('/api/session').length).toBeGreaterThan(s0)
  })

  it('403 при опросе перечитывает состояние', async () => {
    bff.extraJobReply = () => json(403, { error: 'key_expired' })
    await ready({}, { deps: clock() })
    await click(addBtn())
    const g0 = bff.stateGets
    await waitFor(() => expect(bff.stateGets).toBeGreaterThan(g0))
  })

  it('10 минут — предел опроса', async () => {
    bff.extraJobReply = () => json(200, { status: 'running', outcome: null })
    await ready({}, { deps: clock() })
    await click(addBtn())
    await waitFor(() => expect(note()).toBe(GENERIC), { timeout: 4000 })
    expect(bff.extraJobGets).toBeLessThanOrEqual(301)
    expect(bff.extraJobGets).toBeGreaterThan(250)
    expect((addBtn() as HTMLButtonElement).disabled).toBe(false)
  })

  it('сброс маршрута во время подбора (новый route_id): кнопка готова, заметки нет, опрос остановлен', async () => {
    const g = gate()
    bff.state = n => json(200, n <= 1 ? base() : base({ route_id: ROUTE2, revision: 9, extras: [] }))
    renderRoutePage(bff, { deps: g })
    await screen.findByTestId('day-hero')
    await click(addBtn())
    expect(addBtn().textContent).toBe('Подбираем…')
    await getRouteOutbox().enqueueDurable(ROUTE, played(2, { puzzle_id: pid(1), learning_day: TODAY }))
    await act(async () => { await getRouteOutbox().flush({ timeoutMs: 3000 }) })
    await waitFor(() => expect(addBtn().textContent).toBe('Дополнительное видео'))
    expect(note()).toBe('')
    await act(async () => { g.waits.forEach(w => w.release()) })
    await wait(30)
    expect(bff.extraJobGets).toBe(0)
  })

  it('размонтирование останавливает опрос', async () => {
    const g = gate()
    const r = await ready({}, { deps: g })
    await click(addBtn())
    await waitFor(() => expect(g.waits.length).toBe(1))
    r.unmount()
    await act(async () => { g.waits.forEach(w => w.release()) })
    await wait(30)
    expect(bff.extraJobGets).toBe(0)
  })

  it('подбор переживает обмен дня: экран подбора, затем день с новой строкой, один POST', async () => {
    const g = gate()
    let phase: 'day' | 'building' | 'after' = 'day'
    bff.state = () => json(200, phase === 'day' ? base() : phase === 'building' ? base({ active_exchange: { job_id: 'j', status: 'processing', created_at: new Date().toISOString() } }) : withRow(5))
    renderRoutePage(bff, { deps: g })
    await screen.findByTestId('day-hero')
    await click(addBtn())
    phase = 'building'
    await getRouteOutbox().enqueueDurable(ROUTE, played(2, { puzzle_id: pid(1), learning_day: TODAY }))
    await act(async () => { await getRouteOutbox().flush({ timeoutMs: 3000 }) })
    await waitFor(() => expect(screen.queryByTestId('day-hero')).toBeNull())
    phase = 'after'
    await act(async () => { g.waits.forEach(w => w.release()) })
    await screen.findByTestId('extra-row')
    expect(posts()).toHaveLength(1)
  })
})

describe('строки', () => {
  it('название из ответа, метка +, минуты, «Смотреть»', async () => {
    await ready({ extras: [xrow(1, { series_title: 'Series', source: 'Channel', duration_sec: 270 })] })
    const row = screen.getByTestId('extra-row')
    expect(within(row).getByText('+').getAttribute('aria-hidden')).toBe('true')
    expect(within(row).getByText('Extra 1')).toBeTruthy()
    expect(row.textContent).toContain('Series · Channel · 5 мин')
    expect(within(row).getByRole('link', { name: /^Смотреть: Extra \d+$/ })).toBeTruthy()
    expect(within(row).queryByRole('button')).toBeNull()
  })

  it('играная — «Пересмотреть»; порядок как в extras', async () => {
    await ready({ extras: [xrow(1, { played: true }), xrow(2)] })
    const rows = screen.getAllByTestId('extra-row')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByRole('link', { name: /^Пересмотреть: Extra \d+$/ }).getAttribute('href')).toContain('rx=youtube%3A%3Axtr00000001')
    expect(within(rows[1]).getByRole('link', { name: /^Смотреть: Extra \d+$/ })).toBeTruthy()
  })

  it('«other»: «Ролик» без названия, без кнопки, текст про Flibooster', async () => {
    await ready({ extras: [{ puzzle_id: 'film::7', kind: 'other', played: false }] })
    const row = screen.getByTestId('extra-row')
    expect(within(row).getByText('Ролик')).toBeTruthy()
    expect(within(row).queryByRole('link')).toBeNull()
    expect(row.textContent).toContain('Этот ролик открывается в программе Flibooster')
  })

  it('«other» с названием показывает название', async () => {
    await ready({ extras: [{ puzzle_id: 'film::7', kind: 'other', title: 'Some Film', played: false }] })
    expect(within(screen.getByTestId('extra-row')).getByText('Some Film')).toBeTruthy()
  })

  it('без названия: video-titles; пока грузится — «Загружаем название…»; нет — «Ролик YouTube»', async () => {
    bff.videoTitlesReply = ids => json(200, { titles: { [ids[0]]: 'Fetched' }, pending: [] })
    await ready({ extras: [xrow(7, { title: undefined })] })
    await screen.findByText('Fetched')
  })

  it('«Загружаем название…» пока ответа нет', async () => {
    bff.videoTitlesReply = () => new Promise<Response>(() => {})
    await ready({ extras: [xrow(7, { title: undefined })] })
    await screen.findByText('Загружаем название…')
  })

  it('названия нет — «Ролик YouTube»; titles спрашиваются только про YouTube без названия', async () => {
    await ready({ extras: [xrow(7, { title: undefined }), xrow(8), { puzzle_id: 'film::7', kind: 'other', played: false }] })
    await screen.findByText('Ролик YouTube')
    expect(bff.videoTitlesCalls).toBe(1)
  })

  it('демо: video-titles не спрашиваются', async () => {
    __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_abcd', routeAllowed: true, demo: true })
    await ready({ extras: [xrow(7, { title: undefined })] })
    await wait(30)
    expect(bff.videoTitlesCalls).toBe(0)
  })
})

describe('счётчики дня и принятые отчёты', () => {
  const meta = () => screen.getByTestId('route-meta').textContent
  it('route-meta и day-done не зависят от extras', async () => {
    bff.state = st([del(1, { played: true })], { extras: [], extra_available: true, extra_active: null })
    const r = renderRoutePage(bff)
    await screen.findByTestId('day-done')
    const a = { meta: meta(), done: screen.getByTestId('day-done').textContent, rows: screen.queryAllByTestId(/^row-/).length }
    r.unmount()
    bff.state = st([del(1, { played: true })], { extras: [xrow(1), xrow(2, { played: true })], extra_available: true, extra_active: null })
    renderRoutePage(bff)
    await screen.findByTestId('day-done')
    expect({ meta: meta(), done: screen.getByTestId('day-done').textContent, rows: screen.queryAllByTestId(/^row-/).length }).toEqual(a)
  })

  it('принятый origin-отчёт: состояние перечитано, строка «Пересмотреть», строк дня и kept_local не прибавилось', async () => {
    const x = xrow(5)
    bff.state = n => json(200, base({ revision: 5 + n, extras: [{ ...x, played: n > 1 }] }))
    renderRoutePage(bff)
    await screen.findByTestId('extra-row')
    const rows0 = screen.queryAllByTestId(/^row-/).length
    const meta0 = meta()
    expect(within(screen.getByTestId('extra-row')).getByRole('link', { name: /^Смотреть: Extra \d+$/ })).toBeTruthy()
    await getRouteOutbox().enqueueDurable(ROUTE, played(2, { puzzle_id: x.puzzle_id, origin: 'more', learning_day: TODAY }))
    await act(async () => { await getRouteOutbox().flush({ timeoutMs: 3000 }) })
    await waitFor(() => expect(within(screen.getByTestId('extra-row')).getByRole('link', { name: /^Пересмотреть: Extra \d+$/ })).toBeTruthy())
    expect(screen.queryAllByTestId(/^row-/).length).toBe(rows0)
    expect(screen.queryAllByTestId(/^row-/).some(r => r.getAttribute('data-kind') === 'kept_local')).toBe(false)
    expect(meta()).toBe(meta0)
  })
})


// --- ревью: поиск не умирает, фокус и заметки ---
const vis = () => act(async () => { document.dispatchEvent(new Event('visibilitychange')); await new Promise(r => setTimeout(r, 20)) })
const releaseAll = (g: ReturnType<typeof gate>) => act(async () => { g.waits.splice(0).forEach(w => w.release()); await new Promise(r => setTimeout(r, 20)) })
const NEW_JOB = '66666666-6666-4666-8666-666666666666'

describe('C1: пустое состояние — «не знаем», подбор живёт', () => {
  it('чтение состояния упало во время подбора, потом вернулось: опрос идёт, итог показан, кнопка не мёртвая', async () => {
    const g = gate(); let bad = false
    bff.state = () => (bad ? json(503, { error: 'route_timeout' }, { 'Retry-After': '1' }) : json(200, base()))
    bff.extraJobReply = () => json(200, { status: 'done', outcome: 'none' })
    renderRoutePage(bff, { deps: g }); await screen.findByTestId('day-hero')
    await click(addBtn())
    bad = true; await vis()
    await releaseAll(g)
    bad = false
    await waitFor(() => expect(bff.extraJobGets).toBe(1))
    await screen.findByTestId('day-hero', {}, { timeout: 3000 })
    await waitFor(() => expect(note()).toBe('Сейчас подходящего видео нет. Попробуйте позже'))
    expect(addBtn().getAttribute('aria-busy')).toBeNull()
    expect((addBtn() as HTMLButtonElement).disabled).toBe(false)
  })
  it('маршрут пропал (route_id null), затем вернулся тот же: подбор отменён, кнопка готова', async () => {
    const g = gate(); let mode = 0
    bff.state = () => json(200, mode === 1 ? st(null, { started: false, route_id: null }) : base())
    renderRoutePage(bff, { deps: g }); await screen.findByTestId('day-hero')
    await click(addBtn()); mode = 1; await vis(); await releaseAll(g)
    mode = 0; await vis()
    await screen.findByTestId('day-hero')
    await waitFor(() => expect(addBtn().textContent).toBe('Дополнительное видео'))
    expect(note()).toBe('')
    expect(bff.extraJobGets).toBe(0)
  })
})

describe('C2: ответ опроса без тела', () => {
  it('200 не-JSON и 200 null — следующий тик, без падения', async () => {
    bff.extraJobReply = n => (n === 1 ? new Response('<html>', { status: 200 }) : n === 2 ? json(200, null) : json(200, { status: 'done', outcome: 'none' }))
    await ready({}, { deps: clock() }); await click(addBtn())
    await waitFor(() => expect(note()).toBe('Сейчас подходящего видео нет. Попробуйте позже'))
    expect(bff.extraJobGets).toBe(3)
  })
  it('неизвестный outcome — следующий тик', async () => {
    bff.extraJobReply = n => json(200, { status: 'x', outcome: n === 1 ? 'weird' : 'none' })
    await ready({}, { deps: clock() }); await click(addBtn())
    await waitFor(() => expect(note()).toBe('Сейчас подходящего видео нет. Попробуйте позже'))
  })
  it('POST 202 с телом null — общий текст, кнопка не мёртвая', async () => {
    bff.extraReply = () => json(202, null)
    await ready({}, { deps: clock() }); await click(addBtn())
    await waitFor(() => expect(note()).toBe(GENERIC))
    expect(addBtn().getAttribute('aria-busy')).toBeNull()
  })
})

describe('C3: перечитывание после clip', () => {
  it('вернулся другой маршрут с extras: ни фокуса, ни заметки старого подбора', async () => {
    const foc: string[] = []
    const orig = HTMLElement.prototype.focus
    HTMLElement.prototype.focus = function (this: HTMLElement, ...a: []) { foc.push(this.outerHTML.slice(0, 80)); return orig.apply(this, a) }
    try {
      bff.state = n => json(200, n <= 1 ? base() : base({ route_id: ROUTE2, revision: 9, extras: [xrow(7)] }))
      renderRoutePage(bff, { deps: clock() }); await screen.findByTestId('day-hero')
      await click(addBtn()); await wait(100)
      expect(foc.filter(f => f.includes('extra'))).toEqual([])
      expect(note()).toBe('')
      expect(addBtn().getAttribute('aria-busy')).toBeNull()
    } finally { HTMLElement.prototype.focus = orig }
  })
})

describe('I2: фокус', () => {
  it('фокус в окне aria-modal не уводится на новую строку', async () => {
    const g = gate()
    bff.state = n => json(200, n <= 1 ? base() : withRow(5))
    const r = renderRoutePage(bff, { deps: g }); await screen.findByTestId('day-hero')
    await click(addBtn())
    const d = document.createElement('div'); d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.innerHTML = '<input id="x">'
    r.container.appendChild(d)
    const input = d.querySelector('input')!; input.focus()
    await releaseAll(g)
    await screen.findByTestId('extra-row')
    expect(document.activeElement).toBe(input)
  })
  it('фокус на другом элементе страницы (не окно) тоже остаётся', async () => {
    const g = gate()
    bff.state = n => json(200, n <= 1 ? base() : withRow(5))
    renderRoutePage(bff, { deps: g }); await screen.findByTestId('day-hero')
    await click(addBtn())
    const hero = within(screen.getByTestId('day-hero')).getByRole('link', { name: 'Смотреть' }) as HTMLElement
    hero.focus()
    await releaseAll(g)
    await screen.findByTestId('extra-row')
    expect(document.activeElement).toBe(hero)
  })
  it('клавиатура: во время подбора кнопка остаётся в фокусе (aria-disabled, не disabled)', async () => {
    const g = gate()
    await ready({}, { deps: g })
    addBtn().focus(); await click(addBtn())
    expect((addBtn() as HTMLButtonElement).disabled).toBe(false)
    expect(document.activeElement).toBe(addBtn())
    await click(addBtn())
    expect(posts()).toHaveLength(1)
  })
  it('подхваченный подбор не двигает фокус', async () => {
    const live = { job_id: EXTRA_JOB, status: 'processing', created_at: new Date(Date.now() - 60_000).toISOString() }
    bff.state = n => json(200, n <= 1 ? base({ extra_active: live }) : withRow(5))
    renderRoutePage(bff, { deps: clock() })
    await screen.findByTestId('extra-row')
    await wait(30)
    expect(document.activeElement).not.toBe(within(screen.getByTestId('extra-row')).getByRole('link'))
  })
})

describe('I3: срок и перечитывание', () => {
  it('устройство спало дольше 10 мин, ролик готов: итог — строка, не общий текст', async () => {
    const g = gate(); let row = false
    bff.state = () => json(200, row ? withRow(5) : base())
    renderRoutePage(bff, { deps: g }); await screen.findByTestId('day-hero')
    await click(addBtn()); await waitFor(() => expect(g.waits.length).toBe(1))
    row = true; g.advance(11 * 60_000); await vis()
    bff.extraJobReply = () => json(200, { status: 'done', outcome: 'clip' })
    await releaseAll(g)
    await screen.findByTestId('extra-row')
    expect(note()).toBe('')
  })
  it('перечитать после clip не вышло: строка приходит собственным повтором страницы — итог строка, фокус на ней', async () => {
    const g = gate()
    bff.state = n => (n <= 1 ? json(200, base()) : n === 2 ? json(503, { error: 'route_timeout' }, { 'Retry-After': '1' }) : json(200, withRow(5)))
    renderRoutePage(bff, { deps: g }); await screen.findByTestId('day-hero')
    await click(addBtn()); await releaseAll(g)
    await wait(1300); await releaseAll(g)
    const row = await screen.findByTestId('extra-row', {}, { timeout: 4000 })
    await releaseAll(g)
    expect(note()).toBe('')
    await waitFor(() => expect(document.activeElement).toBe(within(row).getByRole('link')))
    expect(addBtn().getAttribute('aria-busy')).toBeNull()
  })
  it('после неудачного перечитывания состояние страницы без строки — общий текст', async () => {
    const g = gate()
    bff.state = n => (n <= 1 ? json(200, base()) : n === 2 ? json(503, { error: 'route_timeout' }, { 'Retry-After': '1' }) : json(200, base({ revision: 5 + n })))
    renderRoutePage(bff, { deps: g }); await screen.findByTestId('day-hero')
    await click(addBtn()); await releaseAll(g)
    await wait(1300); await releaseAll(g)
    await waitFor(() => expect(note()).toBe(GENERIC), { timeout: 4000 })
  })
})

describe('S1: перечитывание после clip не долбит шлюз', () => {
  it.each([
    ['503 Retry-After 60', 503, { error: 'route_unavailable' }, '60'],
    ['429 retry_after 60', 429, { error: 'rate_limited', retry_after_sec: 60 }, '60'],
    ['401', 401, { error: 'no_session' }, ''],
    ['403', 403, { error: 'key_expired' }, ''],
    ['502 refused', 502, { error: 'gateway_refused' }, ''],
  ] as Array<[string, number, unknown, string]>)('%s: не больше двух чтений состояния за минуту', async (_n, status, body, ra) => {
    const g = gate()
    bff.state = n => (n <= 1 ? json(200, base()) : json(status, body, ra ? { 'Retry-After': ra } : {}))
    renderRoutePage(bff, { deps: g }); await screen.findByTestId('day-hero')
    const g0 = bff.stateGets
    await click(addBtn())
    for (let i = 0; i < 32; i++) await act(async () => { g.advance(2000); g.waits.splice(0).forEach(w => w.release()); await new Promise(r => setTimeout(r, 5)) })
    expect(bff.stateGets - g0).toBeLessThanOrEqual(2)
  })
  it('401, 403 и отказ шлюза заканчивают подбор сразу, а не через минуту', async () => {
    const g = gate()
    bff.state = n => (n <= 1 ? json(200, base()) : json(502, { error: 'gateway_refused' }))
    renderRoutePage(bff, { deps: g }); await screen.findByTestId('day-hero')
    await click(addBtn()); await releaseAll(g)
    await waitFor(() => expect(g.waits.length).toBe(0))
    await wait(30)
    expect(g.waits.length).toBe(0)
  })
})

describe('S3: часы переведены назад во время лимита', () => {
  it('срок, оказавшийся дальше самого Retry-After, считается вышедшим', async () => {
    let t = 0
    bff.state = base(); bff.extraReply = () => json(429, { error: 'more_limit', retry_after_sec: 60 })
    renderRoutePage(bff, { deps: { now: () => BASE_MS + t, sleep: () => new Promise<void>(() => {}) } })
    await screen.findByTestId('day-hero'); await click(addBtn())
    expect((addBtn() as HTMLButtonElement).disabled).toBe(true)
    t = -3 * 3600_000
    await vis()
    expect((addBtn() as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('I4: 401 и 403', () => {
  it('постоянный 401 при опросе: сессия перечитана один раз, итог — общий текст', async () => {
    bff.extraJobReply = () => json(401, {})
    await ready({}, { deps: clock() })
    const s0 = bff.of('/api/session').length
    await click(addBtn())
    await waitFor(() => expect(note()).toBe(GENERIC))
    expect(bff.of('/api/session').length - s0).toBe(1)
    expect(bff.extraJobGets).toBe(2)
  })
  it('403 при опросе — перечитывание и общий текст', async () => {
    bff.extraJobReply = () => json(403, { error: 'key_expired' })
    await ready({}, { deps: clock() })
    const g0 = bff.stateGets
    await click(addBtn())
    await waitFor(() => expect(note()).toBe(GENERIC))
    expect(bff.stateGets).toBeGreaterThan(g0)
  })
  it('401 и 403 на POST — общий текст', async () => {
    bff.extraReply = () => json(401, {})
    await ready({}, { deps: clock() }); await click(addBtn())
    await waitFor(() => expect(note()).toBe(GENERIC))
    bff.extraReply = () => json(403, {})
    await click(addBtn())
    await waitFor(() => expect(note()).toBe(GENERIC))
  })
})

describe('I1 и мелочи', () => {
  it('кнопка неактивна во время замены ролика', async () => {
    bff.state = st([del(1, { played: true }), del(2)], { extras: [], extra_available: true, extra_active: null })
    bff.jobReply = () => new Promise<Response>(() => {})
    renderRoutePage(bff, { deps: gate() })
    const row1 = await screen.findByTestId('row-1')
    await click(within(row1).getByRole('button', { name: 'Заменить' }))
    await click(within(screen.getByTestId('replace-confirm')).getByRole('button', { name: 'Заменить' }))
    await waitFor(() => expect((addBtn() as HTMLButtonElement).disabled).toBe(true))
  })
  it('подхват нового подбора очищает старую заметку', async () => {
    const g = gate(); let n2 = false
    bff.state = () => json(200, n2 ? base({ extra_active: { job_id: NEW_JOB, status: 'waiting', created_at: new Date().toISOString() } }) : base())
    bff.extraReply = () => json(409, { error: 'more_busy' })
    renderRoutePage(bff, { deps: g }); await screen.findByTestId('day-hero')
    await click(addBtn()); await waitFor(() => expect(note()).toBe('Подбор уже идёт в программе. Попробуйте через минуту'))
    n2 = true; await vis()
    await waitFor(() => expect(addBtn().getAttribute('aria-busy')).toBe('true'))
    expect(note()).toBe('')
  })
  it('смена учебного дня на открытой странице: клик не шлёт POST, состояние перечитывается', async () => {
    await ready()
    vi.setSystemTime(new Date('2026-11-19T05:00:00'))
    const g0 = bff.stateGets
    await click(addBtn()); await wait(30)
    expect(posts()).toHaveLength(0)
    expect(bff.stateGets).toBeGreaterThan(g0)
  })
  it('Retry-After сверяется с часами при возврате на вкладку (устройство спало)', async () => {
    const g = gate()
    bff.extraReply = () => json(429, {}, { 'Retry-After': '60' })
    await ready({}, { deps: g })
    await click(addBtn())
    await waitFor(() => expect(note()).toBe('Слишком часто. Попробуйте через 1 мин'))
    g.advance(61_000); await vis()
    expect((addBtn() as HTMLButtonElement).disabled).toBe(false)
    expect(note()).toBe('')
  })
  it('огромный Retry-After не включает кнопку сразу, сон не больше минуты', async () => {
    const g = gate()
    bff.extraReply = () => json(429, { error: 'x' }, { 'Retry-After': '3000000' })
    await ready({}, { deps: g })
    await click(addBtn())
    await waitFor(() => expect(g.waits.length).toBe(1))
    expect(g.waits[0].ms).toBeLessThanOrEqual(60_000)
    expect((addBtn() as HTMLButtonElement).disabled).toBe(true)
  })
  it('роль status есть всегда, пока кнопка видна (без display: none)', async () => {
    await ready()
    expect(screen.getByTestId('extra-note').getAttribute('role')).toBe('status')
  })
})

describe('StrictMode', () => {
  const mount = (g: ReturnType<typeof gate>) => render(
    <StrictMode><MemoryRouter initialEntries={['/app/route']}><div className="cab"><Routes>
      <Route path="/app/route" element={<RoutePageCabinet testDeps={{ fetch: bff.fetch, sleep: g.sleep, now: g.now }} />} />
    </Routes></div></MemoryRouter></StrictMode>)
  it('двойной клик — один POST', async () => {
    const g = gate(); bff.state = base()
    mount(g); await screen.findByTestId('day-hero')
    await act(async () => { fireEvent.click(addBtn()); fireEvent.click(addBtn()) })
    await wait(30)
    expect(posts()).toHaveLength(1)
  })
  it('подхват — один опрос, кнопка занята', async () => {
    const g = gate()
    bff.state = base({ extra_active: { job_id: EXTRA_JOB, status: 'waiting', created_at: new Date().toISOString() } })
    mount(g); await screen.findByTestId('day-hero'); await wait(40)
    expect(g.waits.length).toBe(1)
    expect(addBtn().getAttribute('aria-busy')).toBe('true')
  })
})


// --- раунд 2 ---
describe('N1: перечитывание после clip ограничено', () => {
  it('R1: неудачное чтение, затем удачное без строки — общий текст, кнопка не занята и дальше не меняется', async () => {
    const c = clock()
    bff.state = n => (n === 2 ? json(503, { error: 'route_timeout' }, { 'Retry-After': '1' }) : json(200, base()))
    renderRoutePage(bff, { deps: c }); await screen.findByTestId('day-hero')
    await click(addBtn())
    await waitFor(() => expect(note()).toBe(GENERIC), { timeout: 3000 })
    expect(addBtn().getAttribute('aria-busy')).toBeNull()
    await c.sleep(20 * 60_000); await vis()
    expect(note()).toBe(GENERIC)
    expect(addBtn().getAttribute('aria-busy')).toBeNull()
  })
  it('R2: перечитывание после clip упало поздно, а более новое чтение уже принесло строку — итог строка', async () => {
    let fail: (r: Response) => void = () => {}
    let n2 = 0
    bff.state = n => { n2 = n; return n === 1 ? json(200, base()) : n === 2 ? new Promise<Response>(r => { fail = r }) : json(200, withRow(5)) }
    renderRoutePage(bff, { deps: clock() }); await screen.findByTestId('day-hero')
    await click(addBtn()); await waitFor(() => expect(n2).toBe(2))
    await getRouteOutbox().enqueueDurable(ROUTE, played(2, { puzzle_id: pid(1), learning_day: TODAY }))
    await act(async () => { await getRouteOutbox().flush({ timeoutMs: 3000 }) })
    await screen.findByTestId('extra-row')
    await act(async () => { fail(json(503, { error: 'route_timeout' }, { 'Retry-After': '1' })); await new Promise(r => setTimeout(r, 30)) })
    await wait(50)
    expect(note()).toBe('')
    expect(addBtn().getAttribute('aria-busy')).toBeNull()
  })
  it('чтение не удаётся дольше минуты — перечитывание прекращается', async () => {
    const g = gate()
    bff.state = n => (n <= 1 ? json(200, base()) : json(503, { error: 'route_timeout' }, { 'Retry-After': '1' }))
    renderRoutePage(bff, { deps: g }); await screen.findByTestId('day-hero')
    await click(addBtn()); await releaseAll(g)
    await waitFor(() => expect(g.waits.length).toBeGreaterThan(0))
    g.advance(61_000)
    await releaseAll(g); await wait(50); await releaseAll(g); await wait(50)
    expect(g.waits.length).toBe(0)
  })
  it('R5: чтение не удаётся, потом приходит другой маршрут — без заметки и фокуса, кнопка готова', async () => {
    const g = gate(); let m = 0
    bff.state = n => (n <= 1 ? json(200, base()) : m === 0 ? json(503, { error: 'route_timeout' }, { 'Retry-After': '1' }) : json(200, base({ route_id: ROUTE2, extras: [xrow(9)] })))
    renderRoutePage(bff, { deps: g }); await screen.findByTestId('day-hero')
    await click(addBtn()); await releaseAll(g)
    m = 1; await releaseAll(g); await wait(1300); await releaseAll(g)
    await screen.findByTestId('day-hero')
    await waitFor(() => expect(addBtn().getAttribute('aria-busy')).toBeNull())
    expect(note()).toBe('')
    expect(document.activeElement?.closest('.extra')).toBeNull()
  })
})

describe('N2: Retry-After всегда возвращает кнопку', () => {
  it('R3: таймер проснулся раньше срока — спит ещё и перерисовывает, кнопка возвращается', async () => {
    let t = 0; const waits: Array<() => void> = []
    bff.state = base(); bff.extraReply = () => json(429, { error: 'more_limit' }, { 'Retry-After': '60' })
    renderRoutePage(bff, { deps: { now: () => BASE_MS + t, sleep: ms => new Promise<void>(r => { waits.push(() => { t += ms - 10; r() }) }) } })
    await screen.findByTestId('day-hero'); await click(addBtn())
    expect((addBtn() as HTMLButtonElement).disabled).toBe(true)
    await act(async () => { waits.splice(0).forEach(f => f()) })
    expect((addBtn() as HTMLButtonElement).disabled).toBe(true)
    t += 100
    await act(async () => { waits.splice(0).forEach(f => f()) })
    await waitFor(() => expect((addBtn() as HTMLButtonElement).disabled).toBe(false))
  })
  it('сон не длиннее минуты, «через N мин» убывает', async () => {
    const g = gate()
    bff.extraReply = () => json(429, {}, { 'Retry-After': '150' })
    await ready({}, { deps: g })
    await click(addBtn())
    await waitFor(() => expect(note()).toBe('Слишком часто. Попробуйте через 3 мин'))
    await waitFor(() => expect(g.waits.length).toBe(1))
    expect(g.waits[0].ms).toBe(60_000)
    g.advance(61_000)
    await act(async () => { g.waits[0].release() })
    await waitFor(() => expect(note()).toBe('Слишком часто. Попробуйте через 2 мин'))
  })
})

describe('R4: срок опроса', () => {
  it('проснулись через 11 мин, первый опрос упал сетью — опрос продолжается, итог строка', async () => {
    const g = gate(); let row = false
    bff.state = () => json(200, row ? withRow(5) : base())
    bff.extraJobReply = n => { if (n === 1) throw new TypeError('net'); return json(200, { status: 'done', outcome: 'clip' }) }
    renderRoutePage(bff, { deps: g }); await screen.findByTestId('day-hero')
    await click(addBtn()); await waitFor(() => expect(g.waits.length).toBe(1))
    row = true; g.advance(11 * 60_000); await vis()
    await act(async () => { g.waits[0].release() })
    await waitFor(() => expect(g.waits.length).toBeGreaterThanOrEqual(2))
    await releaseAll(g)
    await screen.findByTestId('extra-row')
    expect(note()).toBe('')
  })
  it('после срока три неудачи подряд — общий текст', async () => {
    const g = gate()
    bff.extraJobReply = () => json(503, { error: 'x' })
    await ready({}, { deps: g })
    await click(addBtn()); await waitFor(() => expect(g.waits.length).toBe(1))
    g.advance(11 * 60_000)
    for (let i = 0; i < 3; i++) { await waitFor(() => expect(g.waits.length).toBeGreaterThan(0)); await releaseAll(g) }
    await waitFor(() => expect(note()).toBe(GENERIC))
    expect(bff.extraJobGets).toBe(3)
  })
})

describe('Q1: устаревший active_exchange при уведомлении', () => {
  it('обмен возобновлён и упал (commit_failed), состояние ещё несёт active_exchange: день с уведомлением, кнопка активна', async () => {
    bff.state = base({ active_exchange: { job_id: '33333333-3333-4333-8333-333333333333', status: 'processing', created_at: new Date().toISOString() } })
    bff.jobReply = () => json(200, { status: 'failed', committed: false, committed_revision: null, cancel_reason: null, error_code: 'commit_failed' })
    renderRoutePage(bff, { deps: clock() })
    await screen.findByTestId('day-hero', {}, { timeout: 3000 })
    expect((addBtn() as HTMLButtonElement).disabled).toBe(false)
    expect(addBtn().getAttribute('aria-disabled')).toBeNull()
  })
})
