// fix-round1-day.test.tsx — ревью партии 3а, правки первого круга (экран дня):
// C1 устаревшая строка подтверждения «Заменить» после перечитывания; M1 отчёт в
// записи выгрузки другой страницы; M2 401 при чтении состояния; L1 замена
// встретила чужой обмен / stale_revision; L2 заменённый ролик не возвращается
// строкой kept_local; L3 Retry-After у старта и сброса; L4 двойной клик по
// «Нравится»; L5 day:null + stop_reason; L7 замена сразу неактивна; L8 стражи.
// Порт проб ревьюера `review-b3a/probes/zz-b3a-day.test.tsx`, `zz-b3a-xtab.test.tsx`,
// `zz-b3a-quick.test.tsx`.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { fireEvent, screen, waitFor, within, act } from '@testing-library/react'
import { __resetSessionForTests, __setSessionForTests } from '../../../session'
import { __resetRouteStateForTests } from '../use-route-state'
import { __resetRouteOutboxForTests, getRouteOutbox } from '../outbox'
import { writeWatched, readWatched } from '../../../../player/route-events/route-watched'
import { saveRating, RATINGS_MAX } from '../route-ratings'
import { MemStorage } from './outbox-fakes'
import { FakeRouteBFF, json, renderRoutePage, st, del, und, kept, pid, ROUTE, TODAY, fullText } from './route-page-fakes'
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
const rated = () => bff.events().filter(e => e.type === 'clip_rated')
const wait = (ms: number) => act(async () => { await new Promise(r => setTimeout(r, ms)) })
async function show(s: RouteState, url?: string) { bff.state = s; renderRoutePage(bff, { url }); await screen.findByTestId('day-hero').catch(() => screen.findByTestId('day-done')) }
async function reread() { await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await new Promise(r => setTimeout(r, 60)) }) }

describe('C1: строка «Заменить», открытая до перечитывания', () => {
  it('строка стала kept — подтверждение закрыто, обмена нет', async () => {
    await show(st([del(1, { played: true }), del(2), und()]))
    fireEvent.click(within(row(1)).getByRole('button', { name: 'Заменить' }))
    expect(within(row(1)).getByTestId('replace-confirm')).toBeTruthy()
    bff.state = st([kept(1), del(3), und()], { revision: 6 })
    await reread()
    await waitFor(() => expect(row(1).getAttribute('data-kind')).toBe('kept'))
    expect(screen.queryByTestId('replace-confirm')).toBeNull()
    await wait(100)
    expect(exchanges()).toEqual([])
  })

  it('строка стала kept_local — подтверждение закрыто, обмена нет, запись flib:route-watched цела', async () => {
    writeWatched(ROUTE, TODAY, pid(1), 0.9, { video_id: 'vid00000001', title: 'Title 1', duration_sec: 300 })
    await show(st([del(1, { queued_played: true }), del(2), und()]))
    fireEvent.click(within(row(1)).getByRole('button', { name: 'Заменить' }))
    expect(screen.getByTestId('replace-confirm')).toBeTruthy()
    bff.state = st([del(3), und()], { revision: 6 })
    await reread()
    await waitFor(() => expect(row(1).getAttribute('data-kind')).toBe('kept_local'))
    expect(screen.queryByTestId('replace-confirm')).toBeNull()
    await wait(100)
    expect(exchanges()).toEqual([])
    expect(readWatched()?.items[pid(1)]?.share).toBe(0.9)
  })

  it('строка причин на строке, потерявшей право замены, — закрыта', async () => {
    await show(st([del(1, { played: true }), del(2), und()]))
    fireEvent.click(within(row(1)).getByRole('button', { name: 'Не нравится' }))
    expect(screen.getByTestId('dislike-reasons')).toBeTruthy()
    bff.state = st([kept(1), del(3), und()], { revision: 6 })
    await reread()
    await waitFor(() => expect(row(1).getAttribute('data-kind')).toBe('kept'))
    expect(screen.queryByTestId('dislike-reasons')).toBeNull()
  })

  it('контроль: перечитывание без перемен у строки — подтверждение остаётся и работает', async () => {
    await show(st([del(1, { played: true }), del(2), und()]))
    fireEvent.click(within(row(1)).getByRole('button', { name: 'Заменить' }))
    bff.state = st([del(1, { played: true }), del(2), und()], { revision: 5 })
    await reread()
    const c = within(row(1)).getByTestId('replace-confirm')
    fireEvent.click(within(c).getByRole('button', { name: 'Заменить' }))
    await waitFor(() => expect(exchanges().length).toBe(1))
  })
})

describe('M1: отчёт заменяемого ролика в записи выгрузки другой страницы', () => {
  const cp = (p: string, id: string) => ({ route_id: ROUTE, frac: 0.9, event: { event_id: id, type: 'clip_played', puzzle_id: p, played_frac: 0.9, subs_report: '', learning_day: TODAY, client_ts: new Date().toISOString() } })
  const sentCp = () => bff.of('/api/me/route/events', 'POST').flatMap(c => (c.body as { events: Array<Record<string, unknown>> }).events).filter(e => e.type === 'clip_played').map(e => e.puzzle_id)

  it('запись закрытой вкладки — отчёт заменяемого не уходит никогда; отчёт другого ролика уходит', async () => {
    localStorage.setItem('flib:route-outbox-unload:pOTHERTAB', JSON.stringify({ v: 1, items: [cp(pid(1), 'web:cp-u-1'), cp(pid(2), 'web:cp-u-2')] }))
    await show(st([del(1), del(2), und()]))
    bff.afterCommit = st([del(3), und()], { revision: 6 })
    fireEvent.click(within(row(1)).getByRole('button', { name: 'Заменить' }))
    fireEvent.click(within(screen.getByTestId('replace-confirm')).getByRole('button', { name: 'Заменить' }))
    await waitFor(() => expect(exchanges().length).toBe(1))
    await act(async () => { await getRouteOutbox().flush({ timeoutMs: 3000 }) })
    expect(sentCp()).not.toContain(pid(1))
    expect(sentCp()).toContain(pid(2))
  })
})

describe('M2: 401 при чтении состояния — перечитать сессию, не «мы уже знаем»', () => {
  for (const code of ['key_revoked', 'session_invalid']) {
    it(`401 ${code}`, async () => {
      bff.state = () => json(401, { error: code })
      bff.sessionReply = () => json(200, { authenticated: false, cabinet: true, reason: 'revoked' })
      renderRoutePage(bff)
      await waitFor(() => expect(bff.of('/api/session').length).toBeGreaterThan(0))
      expect(screen.queryByText(fullText(/мы уже знаем о проблеме/))).toBeNull()
    })
  }
})

describe('M2: 401 у быстрого старта — перечитать сессию', () => {
  it('quick-start → 401 key_revoked: GET /api/session; повторного POST нет', async () => {
    bff.state = st(null, { started: false, route_id: null, revision: 0, started_at: null })
    bff.quickStartReply = () => json(401, { error: 'key_revoked' })
    bff.sessionReply = () => json(200, { authenticated: false, cabinet: true, reason: 'revoked' })
    renderRoutePage(bff)
    fireEvent.click(await screen.findByRole('button', { name: 'Friends' }))
    const before = bff.of('/api/session').length
    fireEvent.click(screen.getByRole('button', { name: 'Начать маршрут' }))
    await waitFor(() => expect(bff.of('/api/session').length).toBeGreaterThan(before))
    expect(bff.of('/api/me/route/quick-start', 'POST').length).toBe(1)
  })
})

describe('L1: замена встретила чужой обмен', () => {
  it('409 exchange_in_progress: чужой обмен закоммитился — «День подобран заново» нет, вспышки нет, есть сообщение', async () => {
    await show(st([del(1, { played: true }), del(2), und()]))
    bff.exchangeReply = () => json(409, { error: 'exchange_in_progress', job_id: '44444444-4444-4444-8444-444444444444', revision: 5 })
    bff.afterCommit = st([del(1, { played: true }), del(2, { played: true }), del(3)], { revision: 6 })
    fireEvent.click(within(row(1)).getByRole('button', { name: 'Заменить' }))
    fireEvent.click(within(screen.getByTestId('replace-confirm')).getByRole('button', { name: 'Заменить' }))
    await screen.findByText('День изменился, пока шла замена, — замена не выполнена. Проверьте список и повторите, если нужно')
    expect(document.body.textContent).not.toContain('День подобран заново')
    expect(hero().classList.contains('fresh')).toBe(false)
  })

  it('409 stale_revision: перечитать и сообщить, без повтора', async () => {
    await show(st([del(1, { played: true }), del(2), und()]))
    bff.exchangeReply = () => json(409, { error: 'stale_revision', revision: 9 })
    fireEvent.click(within(row(1)).getByRole('button', { name: 'Заменить' }))
    fireEvent.click(within(screen.getByTestId('replace-confirm')).getByRole('button', { name: 'Заменить' }))
    await screen.findByText('День изменился, пока шла замена, — замена не выполнена. Проверьте список и повторите, если нужно')
    await wait(200)
    expect(exchanges().length).toBe(1)
  })
})

describe('L2: ролик, заменённый с этого браузера, не возвращается строкой kept_local', () => {
  it('другая вкладка ставит отметку заменённого ролика позже — строки нет', async () => {
    await show(st([del(1), del(2), und()]))
    bff.afterCommit = st([del(3), und()], { revision: 6 })
    fireEvent.click(within(row(1)).getByRole('button', { name: 'Заменить' }))
    fireEvent.click(within(screen.getByTestId('replace-confirm')).getByRole('button', { name: 'Заменить' }))
    await waitFor(() => expect(row(1).getAttribute('data-kind')).toBe('current'))
    writeWatched(ROUTE, TODAY, pid(1), 0.9, { video_id: 'vid00000001', title: 'Title 1', duration_sec: 300 })
    // контроль: отметка другого ролика той же даты пишется
    writeWatched(ROUTE, TODAY, pid(9), 0.9, { video_id: 'vid00000009', title: 'Title 9', duration_sec: 300 })
    await reread()
    const kinds = screen.getAllByTestId(/^row-\d+$/).map(r => `${r.getAttribute('data-kind')}:${r.querySelector('.t')?.textContent}`)
    expect(kinds).not.toContain('kept_local:Title 1')
    expect(kinds).toContain('kept_local:Title 9')
  })
})

describe('L3: Retry-After у старта и сброса', () => {
  const notStarted = () => st(null, { started: false, route_id: null, revision: 0, started_at: null })

  it('быстрый старт 429 + Retry-After 30: «Начать маршрут» неактивна, пока идёт отсчёт; route_banned — «продолжим в HH:MM»', async () => {
    bff.state = notStarted()
    bff.quickStartReply = () => json(429, { error: 'route_banned' }, { 'Retry-After': '30' })
    renderRoutePage(bff)
    fireEvent.click(await screen.findByRole('button', { name: 'Friends' }))
    fireEvent.click(screen.getByRole('button', { name: 'Начать маршрут' }))
    await screen.findByText(/^Слишком много действий с маршрутом, продолжим в \d\d:\d\d$/)
    // Старт v2 (дизайн 2026-11-19 §3b): на ошибке кнопка — «Попробовать снова».
    const b = screen.getByRole('button', { name: 'Попробовать снова' }) as HTMLButtonElement
    expect(b.disabled).toBe(true)
    fireEvent.click(b)
    await wait(50)
    expect(bff.of('/api/me/route/quick-start', 'POST').length).toBe(1)
  })

  it('L8 R20: временный сбой быстрого старта — после Retry-After только перечитывание, повторного POST нет', async () => {
    bff.state = notStarted()
    bff.quickStartReply = () => json(503, { error: 'gateway_unavailable' }, { 'Retry-After': '1' })
    renderRoutePage(bff)
    fireEvent.click(await screen.findByRole('button', { name: 'Friends' }))
    fireEvent.click(screen.getByRole('button', { name: 'Начать маршрут' }))
    await screen.findByText(/Маршрут временно недоступен\. Повторим через/)
    const gets = bff.stateGets
    await wait(1400)
    expect(bff.stateGets).toBeGreaterThan(gets)
    expect(bff.of('/api/me/route/quick-start', 'POST').length).toBe(1)
  })

  it('сброс на 503: сообщение и кнопка неактивна до конца Retry-After', async () => {
    bff.state = st(null)
    renderRoutePage(bff)
    const orig = bff.fetch
    bff.fetch = async (u: string, i: RequestInit = {}) => (u === '/api/me/route' && (i.method ?? '') === 'DELETE') ? json(503, { error: 'gateway_unavailable' }, { 'Retry-After': '30' }) : orig(u, i)
    const b = await screen.findByRole('button', { name: 'Сбросить и выбрать другую цель' })
    fireEvent.click(b)
    await screen.findByText('Не удалось сбросить маршрут. Попробуйте позже')
    expect((screen.getByRole('button', { name: 'Сбросить и выбрать другую цель' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('L4: двойной клик по «Нравится» — одно событие', () => {
  it('два клика в одном такте', async () => {
    await show(st([del(1), und()]))
    const b = within(hero()).getByRole('button', { name: 'Нравится' })
    fireEvent.click(b)
    fireEvent.click(b)
    await act(async () => { await getRouteOutbox().flush({ timeoutMs: 3000 }) })
    expect(rated().length).toBe(1)
  })
})

describe('L5: day:null + stop_reason — «маршрут кончился»', () => {
  it('exhausted без дня — «Материал для этой цели закончился», а не «Не удалось подобрать»', async () => {
    bff.state = st(null, { stop_reason: 'exhausted' })
    renderRoutePage(bff)
    await screen.findByText('Материал для этой цели закончился')
    expect(screen.queryByText('Не удалось подобрать ролики.')).toBeNull()
  })
})

describe('L7: «Отправить» с галкой — замена сразу неактивна', () => {
  it('сразу после нажатия кнопки оценки и замены неактивны (до постановки clip_rated)', async () => {
    await show(st([del(1), del(2), und()]))
    fireEvent.click(within(hero()).getByRole('button', { name: 'Не нравится' }))
    const panel = screen.getByTestId('dislike-reasons')
    fireEvent.click(within(panel).getByLabelText('Не интересно'))
    fireEvent.click(within(panel).getByRole('button', { name: 'Отправить' }))
    expect((within(row(1)).getByRole('button', { name: 'Заменить' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('L8: стражи', () => {
  it('R19: два клика «Начать день» в одном такте — один обмен', async () => {
    await show(st([und(), und()], { current_puzzle_id: null }))
    const b = within(hero()).getByRole('button', { name: 'Начать день' })
    fireEvent.click(b)
    fireEvent.click(b)
    await waitFor(() => expect(exchanges().length).toBe(1))
    await wait(200)
    expect(exchanges().length).toBe(1)
  })

  it('R39: 429 rate_limited при чтении состояния — отсчёт и перечитывание', async () => {
    let n = 0
    bff.state = () => (++n === 1 ? json(429, { error: 'rate_limited' }, { 'Retry-After': '1' }) : json(200, st([del(1)])))
    renderRoutePage(bff)
    await screen.findByText('Маршрут временно недоступен. Повторим через 1 с')
    await screen.findByTestId('day-hero', {}, { timeout: 3000 })
  })

  it('R45: flib:route-ratings держит не больше 500 записей, старшие вытесняются', () => {
    const s = new MemStorage()
    for (let i = 0; i < RATINGS_MAX + 1; i++) saveRating(ROUTE, `youtube::r${i}`, 'like', s)
    const items = JSON.parse(s.getItem('flib:route-ratings')!).items
    expect(Object.keys(items).length).toBe(RATINGS_MAX)
    expect(items['youtube::r0']).toBeUndefined()
    expect(items[`youtube::r${RATINGS_MAX}`]).toBe('like')
  })
})

describe('H1 на экране дня: правило показа и свежее перечитывание', () => {
  const cpItem = (p: string) => ({ route_id: ROUTE, frac: 0.7, event: { event_id: `web:cp-${p}`, type: 'clip_played', puzzle_id: p, played_frac: 0.7, learning_day: TODAY, client_ts: new Date().toISOString() } })

  it('отчёт отправила ДРУГАЯ вкладка (события «принято» здесь нет): состояние, запрошенное при отчёте в очереди, показывает ролик «открытым» и после ухода отчёта', async () => {
    writeWatched(ROUTE, TODAY, pid(1), 0.7, {})
    localStorage.setItem('flib:route-outbox', JSON.stringify({ v: 2, items: [cpItem(pid(1))] }))
    await show(st([del(1), und()]))
    expect(within(hero()).getByRole('button', { name: 'Следующий ролик' })).toBeTruthy()
    // другая вкладка выгрузила отчёт: в очереди пусто, состояние на экране прежнее
    localStorage.setItem('flib:route-outbox', JSON.stringify({ v: 2, items: [] }))
    // перерисовка всей страницы ПОСЛЕ ухода отчёта (открыть и закрыть строку причин
    // — это перерисовывает и страницу, и модель дня)
    fireEvent.click(within(hero()).getByRole('button', { name: 'Не нравится' }))
    fireEvent.click(within(screen.getByTestId('dislike-reasons')).getByRole('button', { name: 'Отмена' }))
    await wait(30)
    expect(within(hero()).getByRole('button', { name: 'Следующий ролик' })).toBeTruthy()
    expect(screen.getByTestId('route-meta').textContent).toContain('1 из 2')
  })

  it('чтение состояния в полёте ушло ДО отчёта: после приёма отчёта страница делает СВОЙ запрос, а не ждёт старый', async () => {
    let posted = false
    let release: (() => void) | null = null
    bff.state = (n: number) => {
      const s = st([del(1, { queued_played: posted }), und()])
      if (n === 2) return new Promise<Response>(r => { release = () => r(json(200, s)) })
      return json(200, s)
    }
    const orig = bff.eventsReply
    bff.eventsReply = b => { posted = true; return orig(b) }
    writeWatched(ROUTE, TODAY, pid(1), 0.7, {})
    renderRoutePage(bff)
    await screen.findByTestId('day-hero')
    // перечитывание (возврат на вкладку) уходит и висит; отчёт поставлен ПОСЛЕ его отправки
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await new Promise(r => setTimeout(r, 20)) })
    await waitFor(() => expect(bff.stateGets).toBe(2))
    await getRouteOutbox().enqueueDurable(ROUTE, cpItem(pid(1)).event, { frac: 0.7 })
    await act(async () => { await getRouteOutbox().flush({ timeoutMs: 3000 }) })
    await waitFor(() => expect(bff.stateGets).toBeGreaterThanOrEqual(3))
    await act(async () => { release!(); await new Promise(r => setTimeout(r, 60)) })
    await waitFor(() => expect(within(hero()).getByRole('button', { name: 'Следующий ролик' })).toBeTruthy())
  })
})
