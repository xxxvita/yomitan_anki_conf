// quick-start-goals.test.tsx — «Мои цели» на экране старта (спека 2026-11-23 §6, §11):
// ссылки пользователя → сбор слов шлюзом → старт с goal.source_request_id.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, fireEvent, screen, within } from '@testing-library/react'

import { __resetSessionForTests, __setSessionForTests } from '../../../session'
import { __resetRouteStateForTests } from '../use-route-state'
import { __resetRouteOutboxForTests } from '../outbox'
import { FakeRouteBFF, GOAL_ID, goalView, json, renderRoutePage, st, fullText } from './route-page-fakes'

const A = 'dQw4w9WgXcQ'
const B = 'aaaaaaaaaaa'
const C = 'bbbbbbbbbbb'
const url = (id: string) => `https://youtu.be/${id}`
const DRAFT_KEY = 'flib:goal-harvest:v1:tpk_abcd'

let bff: FakeRouteBFF
beforeEach(() => {
  __resetSessionForTests(); __resetRouteStateForTests(); __resetRouteOutboxForTests()
  localStorage.clear()
  bff = new FakeRouteBFF()
  bff.state = st(null, { started: false, route_id: null, revision: 0, started_at: null })
  vi.stubGlobal('fetch', vi.fn((u: string, i?: RequestInit) => bff.fetch(u, i)))
  __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_abcd', routeAllowed: true, demo: false })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); __resetRouteOutboxForTests() })

async function open() {
  renderRoutePage(bff)
  await screen.findByText(fullText('Давайте установим Ваш реальный уровень'))
}
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0) })
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
const posts = () => bff.of('/api/me/route/goals', 'POST')
const qs = () => bff.of('/api/me/route/quick-start', 'POST')
const bar = () => document.querySelector('.st-bar') as HTMLElement
const goBtn = () => within(bar()).getByRole('button') as HTMLButtonElement
const addLinks = (text: string) => {
  fireEvent.change(screen.getByLabelText('Ссылка на ролик YouTube'), { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: 'Добавить ролик' }))
}
const cards = () => document.querySelectorAll('details.own2 .yt-card')

describe('«Мои цели» — демо', () => {
  it('демо видит текст платной версии со ссылкой на /buy, поля ссылок нет и в /goals ничего не уходит', async () => {
    __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_abcd', routeAllowed: true, demo: true })
    await open()
    const det = document.querySelector('details.own2') as HTMLElement
    expect(det.textContent).toContain('Свои ролики как цель — в платной версии')
    expect(det.querySelector('a[href="/buy"]')).toBeTruthy()
    expect(screen.queryByLabelText('Ссылка на ролик YouTube')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Добавить ролик' })).toBeNull()
    // Текст остаётся.
    expect(screen.getByLabelText('Слова, которые хотите, чтобы постепенно добавлялись в ролики')).toBeTruthy()
    expect(bff.calls.filter(c => c.url.startsWith('/api/me/route/goals'))).toHaveLength(0)
  })
})

describe('«Мои цели» — ссылки', () => {
  it('платный: несколько ссылок через пробел — уникальные ролики, дубли и мусор отброшены; не больше 50', async () => {
    await open()
    addLinks(`${url(A)} ${url(B)}\n${url(A)} not-a-link`)
    expect(cards()).toHaveLength(2)
    const many = Array.from({ length: 55 }, (_, i) => url(String(i).padStart(11, 'x'))).join(' ')
    addLinks(many)
    expect(cards()).toHaveLength(50)
    expect(document.querySelector('details.own2')?.textContent).toContain('не больше 50')
  })
})

describe('«Мои цели» — поток сбора', () => {
  it('старт создаёт сбор один раз, опрашивает, затем стартует с source_request_id; ролики остаются в puzzle_ids', async () => {
    await open()
    addLinks(`${url(A)} ${url(B)}`)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    fireEvent.click(goBtn())
    await flush()
    expect(posts()).toHaveLength(1)
    const pb = posts()[0].body as { video_urls: string[]; client_request_id: string }
    expect(pb.video_urls.sort()).toEqual([`https://www.youtube.com/watch?v=${B}`, `https://www.youtube.com/watch?v=${A}`].sort())
    expect(pb.client_request_id).toMatch(/^[0-9a-f-]{36}$/)
    expect(screen.getByText(/Собираем слова из Ваших роликов/)).toBeTruthy()
    expect(goBtn().disabled).toBe(true)
    expect(qs()).toHaveLength(0)

    bff.goalGetReply = () => json(200, goalView('partial', 1))
    await tick(10_000)
    expect(bff.goalGets).toBe(1)
    expect(goBtn().textContent).toBe('Начать маршрут (слова из 1 роликов)')
    expect(goBtn().disabled).toBe(false)
    await tick(60_000)
    expect(bff.goalGets).toBe(1) // терминальный статус — опрос остановлен

    fireEvent.click(goBtn())
    await flush()
    expect(qs()).toHaveLength(1)
    const goal = (qs()[0].body as { goal: { source_request_id?: string; puzzle_ids?: string[] } }).goal
    expect(goal.source_request_id).toBe(GOAL_ID)
    expect(goal.puzzle_ids).toEqual(expect.arrayContaining([`youtube::${A}`, `youtube::${B}`]))
    expect(posts()).toHaveLength(1)
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull()
  })

  it('опрос: 12 раз по 10 с, затем раз в 30 с', async () => {
    await open()
    addLinks(url(A))
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    fireEvent.click(goBtn())
    await flush()
    await tick(120_000)
    expect(bff.goalGets).toBe(12)
    await tick(29_000)
    expect(bff.goalGets).toBe(12)
    await tick(1_000)
    expect(bff.goalGets).toBe(13)
  })

  it('ready без готовых роликов — «Ни из одного ролика…», старт с источником недоступен', async () => {
    await open()
    addLinks(`${url(A)} ${url(B)}`)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    fireEvent.click(goBtn())
    await flush()
    bff.goalGetReply = () => json(200, goalView('ready', 0, { videos: [{ video_id: A, status: 'skipped_not_english' }, { video_id: B, status: 'too_long' }] }))
    await tick(10_000)
    expect(screen.getByText('Ни из одного ролика не удалось взять слова')).toBeTruthy()
    expect(screen.getByText('нет английских субтитров')).toBeTruthy()
    expect(screen.getByText('длиннее часа')).toBeTruthy()
    expect(goBtn().disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Начать без сбора слов' })).toBeTruthy()
  })

  it('перезагрузка во время ожидания: черновик с request_id → панель и опрос, второго POST нет', async () => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ client_request_id: '55555555-5555-4555-8555-555555555555', video_ids: [A, B], request_id: GOAL_ID }))
    bff.goalGetReply = () => json(200, goalView('harvesting', 0))
    await open()
    expect(screen.getByText(/Собираем слова из Ваших роликов/)).toBeTruthy()
    expect(bff.goalGets).toBeGreaterThanOrEqual(1)
    expect(bff.of('/api/me/route/goals/' + GOAL_ID).length).toBeGreaterThanOrEqual(1)
    expect(posts()).toHaveLength(0)
    expect(cards()).toHaveLength(2)
  })

  it('worker_offline: текст, «Повторить» шлёт тот же client_request_id', async () => {
    bff.goalCreateReply = (_b, n) => n === 1 ? json(503, { error: 'worker_offline' }, { 'Retry-After': '30' }) : json(202, goalView('queued', 0))
    await open()
    addLinks(url(A))
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    fireEvent.click(goBtn())
    await flush()
    expect(screen.getByText('Сервис сбора временно недоступен. Попробуйте через минуту.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    await flush()
    expect(posts()).toHaveLength(2)
    expect((posts()[1].body as { client_request_id: string }).client_request_id).toBe((posts()[0].body as { client_request_id: string }).client_request_id)
    expect(screen.getByText(/Собираем слова из Ваших роликов/)).toBeTruthy()
  })

  it('daily_limit: «Сегодня запросы закончились (5 в сутки). Новые — после …»', async () => {
    const resets = new Date(Date.now() + 3 * 3600_000).toISOString()
    bff.goalCreateReply = () => json(429, { error: 'daily_limit', resets_at: resets })
    await open()
    addLinks(url(A))
    fireEvent.click(goBtn())
    expect(await screen.findByText(/Сегодня запросы закончились \(5 в сутки\)\. Новые — после \d{2}[:.]\d{2}/)).toBeTruthy()
  })

  it('смена набора ссылок после запроса — новый client_request_id', async () => {
    await open()
    addLinks(url(A))
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    fireEvent.click(goBtn())
    await flush()
    addLinks(url(C))
    expect(screen.queryByText(/Собираем слова из Ваших роликов/)).toBeNull()
    fireEvent.click(goBtn())
    await flush()
    expect(posts()).toHaveLength(2)
    expect((posts()[1].body as { client_request_id: string }).client_request_id).not.toBe((posts()[0].body as { client_request_id: string }).client_request_id)
  })

  it('«Начать без сбора слов» стартует без source_request_id и стирает черновик', async () => {
    await open()
    addLinks(url(A))
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    fireEvent.click(goBtn())
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Начать без сбора слов' }))
    await flush()
    expect(qs()).toHaveLength(1)
    const goal = (qs()[0].body as { goal: { source_request_id?: string; puzzle_ids?: string[] } }).goal
    expect(goal.source_request_id).toBeUndefined()
    expect(goal.puzzle_ids).toContain(`youtube::${A}`)
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull() // черновик стирается после ЛЮБОГО успешного старта
  })

  it('ключ стал демо посреди сбора: опрос прекращается, текст платной версии', async () => {
    await open()
    addLinks(url(A))
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    fireEvent.click(goBtn())
    await flush()
    bff.goalGetReply = () => json(403, { error: 'plan_not_allowed' })
    await tick(10_000)
    expect(bff.goalGets).toBe(1)
    expect(screen.getByText('Свои ролики как цель — в платной версии')).toBeTruthy()
    await tick(120_000)
    expect(bff.goalGets).toBe(1)
  })

  it('ссылки очищены, пока создание в полёте: поздний ответ не воскрешает черновик и панель', async () => {
    let release: (r: Response) => void = () => {}
    bff.goalCreateReply = () => new Promise<Response>(res => { release = res })
    await open()
    addLinks(url(A))
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    fireEvent.click(goBtn())
    await flush()
    fireEvent.click(within(document.querySelector('details.own2 .yt-card') as HTMLElement).getByRole('button', { name: /Убрать/ }))
    await flush()
    await act(async () => { release(json(202, goalView('queued', 0))); await vi.advanceTimersByTimeAsync(0) })
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull()
    expect(screen.queryByText(/Собираем слова из Ваших роликов/)).toBeNull()
  })

  it('409 goal_empty при старте с источником: «Ни из одного ролика…», старт с источником выключен, «Начать без сбора слов» видна и работает', async () => {
    bff.quickStartReply = body => (body.goal as { source_request_id?: string }).source_request_id
      ? json(409, { error: 'goal_empty' })
      : json(202, { job_id: '33333333-3333-4333-8333-333333333333', revision: 1 })
    await open()
    addLinks(url(A))
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    fireEvent.click(goBtn())
    await flush()
    bff.goalGetReply = () => json(200, goalView('ready', 1))
    await tick(10_000)
    fireEvent.click(goBtn())
    await flush()
    expect(qs()).toHaveLength(1)
    expect(screen.getAllByText('Ни из одного ролика не удалось взять слова').length).toBeGreaterThan(0)
    expect(goBtn().disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Начать без сбора слов' }))
    await flush()
    expect(qs()).toHaveLength(2)
    expect((qs()[1].body as { goal: { source_request_id?: string } }).goal.source_request_id).toBeUndefined()
  })

  it('опрос: 401 key_expired — опрос прекращается, платный текст НЕ показывается, разбор страницы', async () => {
    await open()
    addLinks(url(A))
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    fireEvent.click(goBtn())
    await flush()
    bff.goalGetReply = () => json(401, { error: 'key_expired' })
    await tick(10_000)
    expect(bff.goalGets).toBe(1)
    await tick(120_000)
    expect(bff.goalGets).toBe(1)
    expect(screen.queryByText('Свои ролики как цель — в платной версии')).toBeNull()
  })
})
