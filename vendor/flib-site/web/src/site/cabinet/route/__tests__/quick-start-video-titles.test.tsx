// quick-start-video-titles.test.tsx — названия роликов в «Моих целях»: карточка
// ролика и строки панели сбора показывают название, а не id.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, fireEvent, screen, within } from '@testing-library/react'

import { __resetSessionForTests, __setSessionForTests } from '../../../session'
import { __resetRouteStateForTests } from '../use-route-state'
import { __resetRouteOutboxForTests } from '../outbox'
import { __resetVideoTitlesForTests } from '../use-video-titles'
import { FakeRouteBFF, GOAL_ID, goalView, json, renderRoutePage, st, fullText } from './route-page-fakes'

const A = 'dQw4w9WgXcQ'
const B = 'aaaaaaaaaaa'
const url = (id: string) => `https://youtu.be/${id}`
const DRAFT_KEY = 'flib:goal-harvest:v1:tpk_abcd'
const LOADING = 'Загружаем название…'

let bff: FakeRouteBFF
beforeEach(() => {
  __resetSessionForTests(); __resetRouteStateForTests(); __resetRouteOutboxForTests(); __resetVideoTitlesForTests()
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
const calls = () => bff.of('/api/me/route/video-titles', 'GET').length
const askedIds = () => bff.calls.filter(c => c.url.startsWith('/api/me/route/video-titles')).map(c => new URL(c.url, 'https://x').searchParams.get('ids')!.split(','))
const bar = () => document.querySelector('.st-bar') as HTMLElement
const goBtn = () => within(bar()).getByRole('button') as HTMLButtonElement
const addLinks = (text: string) => {
  fireEvent.change(screen.getByLabelText('Ссылка на ролик YouTube'), { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: 'Добавить ролик' }))
}
const cards = () => Array.from(document.querySelectorAll('details.own2 .yt-card')) as HTMLElement[]
const titled = (ids: string[]) => json(200, { titles: Object.fromEntries(ids.map(i => [i, `Title ${i}`])), pending: [] })

describe('названия роликов — карточка', () => {
  it('показывает название вместо id; × и title-атрибут несут то же название', async () => {
    bff.videoTitlesReply = ids => titled(ids)
    await open()
    addLinks(url(A))
    const t = await screen.findByText(`Title ${A}`)
    expect(t.getAttribute('title')).toBe(`Title ${A}`)
    expect(screen.getByRole('button', { name: `Убрать цель Title ${A}` })).toBeTruthy()
    expect(askedIds()).toEqual([[A]])
  })

  it('пока грузится: «Загружаем название…», а aria-label × хранит id', async () => {
    let release!: (r: Response) => void
    bff.videoTitlesReply = () => new Promise<Response>(res => { release = res })
    await open()
    addLinks(url(A))
    expect(cards()[0].textContent).toContain(LOADING)
    expect(screen.getByRole('button', { name: `Убрать цель YouTube: ${A}` })).toBeTruthy()
    await act(async () => { release(titled([A])) })
    expect(await screen.findByText(`Title ${A}`)).toBeTruthy()
    expect(screen.queryByText(LOADING)).toBeNull()
  })

  it('окончательный промах: прежний «YouTube: id», без повторов', async () => {
    await open()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    addLinks(url(A))
    await flush()
    expect(cards()[0].textContent).toContain(`YouTube: ${A}`)
    expect(cards()[0].textContent).not.toContain(LOADING)
    await tick(60_000)
    expect(calls()).toBe(1)
  })

  it('pending: повторы через 5 с, 15 с и 65 с, затем отказ (id остаётся)', async () => {
    bff.videoTitlesReply = () => json(200, { titles: {}, pending: [A] })
    await open()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    addLinks(url(A))
    await flush()
    expect(calls()).toBe(1)
    expect(cards()[0].textContent).toContain(LOADING)
    expect(cards()[0].querySelector('.yt-t')?.getAttribute('title')).toBeNull()
    await tick(4_900)
    expect(calls()).toBe(1)
    await tick(200)
    expect(calls()).toBe(2)
    await tick(14_700)
    expect(calls()).toBe(2)
    expect(cards()[0].textContent).toContain(LOADING)
    await tick(400)
    expect(calls()).toBe(3)
    // 15-секундный повтор не удался: «Загружаем…» гаснет, показывается id.
    expect(cards()[0].textContent).toContain(`YouTube: ${A}`)
    await tick(64_500)
    expect(calls()).toBe(3)
    await tick(1_000)
    expect(calls()).toBe(4)
    await tick(300_000)
    expect(calls()).toBe(4)
    expect(cards()[0].textContent).toContain(`YouTube: ${A}`)
  })

  it('pending, затем название на повторе', async () => {
    bff.videoTitlesReply = (ids, n) => (n === 1 ? json(200, { titles: {}, pending: ids }) : titled(ids))
    await open()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    addLinks(url(A))
    await flush()
    await tick(5_000)
    expect(cards()[0].textContent).toContain(`Title ${A}`)
    await tick(60_000)
    expect(calls()).toBe(2)
  })

  it('сбой транспорта и 500 — как pending, ошибка не показывается', async () => {
    bff.videoTitlesReply = (ids, n) => (n === 1 ? json(500, { error: 'x' }) : n === 2 ? Promise.reject(new TypeError('net')) as unknown as Response : titled(ids))
    await open()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    addLinks(url(A))
    await flush()
    await tick(5_000)
    await tick(15_000)
    expect(calls()).toBe(3)
    expect(cards()[0].textContent).toContain(`Title ${A}`)
    expect(Array.from(document.querySelectorAll('[role="alert"]')).map(e => e.textContent).join('')).toBe('')
  })

  it('второй ролик спрашивает только новый id', async () => {
    bff.videoTitlesReply = ids => titled(ids)
    await open()
    addLinks(url(A))
    await screen.findByText(`Title ${A}`)
    addLinks(url(B))
    await screen.findByText(`Title ${B}`)
    expect(askedIds()).toEqual([[A], [B]])
  })

  it('восстановление черновика запрашивает названия', async () => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ client_request_id: '55555555-5555-4555-8555-555555555555', video_ids: [A, B], request_id: GOAL_ID }))
    bff.videoTitlesReply = ids => titled(ids)
    await open()
    expect(await screen.findByText(`Title ${A}`)).toBeTruthy()
    expect(askedIds()).toEqual([[A, B]])
  })

  it('демо с сохранённой в браузере цели-роликом: запросов названий нет', async () => {
    localStorage.setItem('flib:pointA', JSON.stringify({ kind: 'cefr', level: 'B1', goalsV2: [{ type: 'youtube', videoId: A, url: url(A) }] }))
    __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_abcd', routeAllowed: true, demo: true })
    bff.videoTitlesReply = ids => titled(ids)
    await open()
    expect(calls()).toBe(0)
  })

  it('401 на названиях: страница не трогается (нет перечитывания состояния и сессии)', async () => {
    bff.videoTitlesReply = () => json(401, { error: 'no_session' })
    await open()
    const stateBefore = bff.stateGets
    const sessionBefore = bff.calls.filter(c => c.url === '/api/session').length
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    addLinks(url(A))
    await flush()
    await tick(100_000)
    expect(calls()).toBe(4)
    expect(bff.stateGets).toBe(stateBefore)
    expect(bff.calls.filter(c => c.url === '/api/session').length).toBe(sessionBefore)
    expect(cards()[0].textContent).toContain(`YouTube: ${A}`)
  })

  it('убрать и добавить ролик, пока название в pending: один повтор, без дублей', async () => {
    bff.videoTitlesReply = (ids, n) => (n === 1 ? json(200, { titles: {}, pending: ids }) : titled(ids))
    await open()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    addLinks(url(A))
    await flush()
    fireEvent.click(screen.getByRole('button', { name: `Убрать цель YouTube: ${A}` }))
    addLinks(url(A))
    await flush()
    await tick(5_000)
    expect(calls()).toBe(2)
    expect(cards()[0].textContent).toContain(`Title ${A}`)
    await tick(100_000)
    expect(calls()).toBe(2)
  })

  it('ключ сменился на месте: название прежнего ключа с карточки уходит, новый спрашивает сам', async () => {
    bff.videoTitlesReply = (ids, n) => (n === 1 ? titled(ids) : json(200, { titles: {}, pending: [] }))
    await open()
    addLinks(url(A))
    await screen.findByText(`Title ${A}`)
    act(() => {
      __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_zzzz', routeAllowed: true, demo: false }, true)
    })
    expect(await screen.findByText(`YouTube: ${A}`)).toBeTruthy()
    expect(screen.queryByText(`Title ${A}`)).toBeNull()
    expect(calls()).toBe(2)
  })

  it('демо: запросов названий нет', async () => {
    __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_abcd', routeAllowed: true, demo: true })
    await open()
    expect(calls()).toBe(0)
  })

  it('ролик убран, пока название грузится: без падения, поздний ответ игнорируется', async () => {
    let release!: (r: Response) => void
    bff.videoTitlesReply = () => new Promise<Response>(res => { release = res })
    await open()
    addLinks(url(A))
    fireEvent.click(screen.getByRole('button', { name: `Убрать цель YouTube: ${A}` }))
    expect(cards()).toHaveLength(0)
    await act(async () => { release(titled([A])) })
    expect(screen.queryByText(`Title ${A}`)).toBeNull()
  })
})

describe('названия роликов — панель сбора', () => {
  it('строка «в обработке» показывает название; название шлюза главнее', async () => {
    bff.videoTitlesReply = ids => titled(ids)
    await open()
    addLinks(`${url(A)} ${url(B)}`)
    await screen.findByText(`Title ${B}`)
    fireEvent.click(goBtn())
    const rows = async () => Array.from(await screen.findAllByRole('listitem')).filter(li => li.classList.contains('gh-v'))
    const list = await rows()
    const rowB = list.find(li => li.textContent?.includes(`Title ${B}`)) as HTMLElement
    expect(rowB.textContent).toContain('в обработке')
    expect(rowB.querySelector('.gh-vt')?.getAttribute('title')).toBe(`Title ${B}`)
    const rowA = list.find(li => li.textContent?.includes('Never Gonna')) as HTMLElement
    expect(rowA).toBeTruthy()
    expect(rowA.textContent).not.toContain(`Title ${A}`)
  })

  it('пока название грузится: «Загружаем название…» в строке; промах — id', async () => {
    let release!: (r: Response) => void
    bff.videoTitlesReply = () => new Promise<Response>(res => { release = res })
    await open()
    addLinks(`${url(A)} ${url(B)}`)
    fireEvent.click(goBtn())
    await screen.findByText(/Собираем слова из Ваших роликов/)
    expect(document.querySelector('.gh')?.textContent).not.toContain(B) // id не мелькает, пока название грузится
    expect(document.querySelector('.gh')?.textContent).toContain(LOADING)
    await act(async () => { release(json(200, { titles: {}, pending: [] })) })
    expect(document.querySelector('.gh')?.textContent).toContain(B)
    expect(document.querySelector('.gh')?.textContent).not.toContain(LOADING)
  })

  it('что уходит на сервер, не меняется: тело создания сбора и быстрого старта без названий', async () => {
    bff.videoTitlesReply = ids => titled(ids)
    await open()
    addLinks(`${url(A)} ${url(B)}`)
    await screen.findByText(`Title ${B}`)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    fireEvent.click(goBtn())
    await flush()
    const post = bff.of('/api/me/route/goals', 'POST')[0].body as Record<string, unknown>
    expect(Object.keys(post).sort()).toEqual(['client_request_id', 'video_urls'])
    bff.goalGetReply = () => json(200, goalView('partial', 1))
    await tick(10_000)
    fireEvent.click(goBtn())
    await flush()
    const qs = bff.of('/api/me/route/quick-start', 'POST')
    expect(qs).toHaveLength(1)
    expect(JSON.stringify(qs[0].body)).not.toContain('Title ')
    expect(JSON.stringify(qs[0].body)).not.toContain('Загружаем')
  })
})
