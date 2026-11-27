// quick-start-catalog.test.tsx — полный каталог (внутри шага «Цель») и подробная карточка на
// экране старта (план S6, спека §7.5–§7.6; встраивание — S7a). Плитка «Все фильмы и сериалы»
// разворачивает каталог на месте (без диалога), «Подробнее» — карточку; выбор из них попадает ровно туда же, куда выбор с полок (goal.titles, ≤ 10);
// открытая карточка пишется в «Недавние»; при SHOW_CATALOG=true и catalog:false — ни
// панели, ни «Подробнее», ни мёртвых кнопок.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'

const build = vi.hoisted(() => ({ show: true }))
vi.mock('../start-model', async importOriginal => {
  const m = await importOriginal<typeof import('../start-model')>()
  return { ...m, get SHOW_CATALOG() { return build.show } }
})

import { __resetSessionForTests, __setSessionForTests } from '../../../session'
import { __resetRouteStateForTests } from '../use-route-state'
import { __resetRouteOutboxForTests } from '../outbox'
import { FakeRouteBFF, json, renderRoutePage, st, TODAY, fullText } from './route-page-fakes'

const card = (slug: string, over: Record<string, unknown> = {}) => ({ slug, type: 'series', title_en: slug, goal_ok: true, ...over })
const FRIENDS = card('friends-light', { title_en: 'Friends', title_ru: 'Друзья', year: 1994 })
const MONK = card('monk', { title_en: 'Monk', year: 2002 })
const SNAP = 'aaaaaaaaaaaaaaaa'
const detailBody = (slug: string) => ({
  snapshot: SNAP, tempo_median_wpm: 169, pace: { slow_below: 160, fast_from: 178 },
  item: { ...card(slug, { title_en: slug === 'monk' ? 'Monk' : 'Friends', title_ru: slug === 'monk' ? undefined : 'Друзья' }),
    groups: [{ group: 1, forms: 100, more: 95, share: 0.9, top: [{ word: 'know', count: 10 }] }], tempo: { wpm: 170, source: 'p50' } },
})

let bff: FakeRouteBFF
beforeEach(() => {
  __resetSessionForTests(); __resetRouteStateForTests(); __resetRouteOutboxForTests()
  localStorage.clear()
  build.show = true
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(`${TODAY}T12:00:00`))
  bff = new FakeRouteBFF()
  bff.state = st(null, { started: false, route_id: null, revision: 0, started_at: null })
  bff.titles = [FRIENDS, MONK]
  bff.titlesReply = url => (/\/titles\/[a-z]/.test(url) ? json(200, detailBody(/titles\/([^?]+)/.exec(url)![1])) : null)
  vi.stubGlobal('fetch', vi.fn((u: string, i?: RequestInit) => bff.fetch(u, i)))
  __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_abcd', routeAllowed: true, demo: false, catalog: true })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); __resetRouteOutboxForTests() })

async function open() {
  renderRoutePage(bff)
  await screen.findByText(fullText('Давайте установим Ваш реальный уровень'))
  await screen.findByRole('button', { name: 'Друзья' })
}
const tile = () => document.querySelector('.gc-all') as HTMLElement
const count = () => document.querySelector('.st-cnt b')?.textContent
const qs = () => bff.of('/api/me/route/quick-start', 'POST')

describe('полный каталог внутри шага «Цель»', () => {
  const inline = () => document.querySelector('[data-testid="catalog-inline"]') as HTMLElement | null
  const cards = () => document.querySelectorAll('[data-testid="catalog-inline"] .gc-grid .gc:not(.sk)')

  it('плитка разворачивает каталог на месте: без диалога, полка и плитка скрыты; выбор виден в «Выбрано»; «Свернуть» сохраняет выбор', async () => {
    await open()
    expect(inline()).toBeNull()
    fireEvent.click(tile())
    await waitFor(() => expect(cards().length).toBe(2))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(tile()).toBeNull()
    expect(document.querySelector('.seg')).toBeNull()
    expect(document.querySelector('#st-goal')?.contains(inline())).toBe(true)
    fireEvent.click(within(inline()!.querySelector('[data-slug="monk"]') as HTMLElement).getByRole('button', { name: 'Monk' }))
    expect(count()).toBe('1')
    fireEvent.click(screen.getByRole('button', { name: 'Свернуть каталог' }))
    expect(inline()).toBeNull()
    expect(tile()).not.toBeNull()
    expect(count()).toBe('1')
  })

  it('«Подробнее» из каталога открывает карточку (единственный диалог) со снимком списка', async () => {
    await open()
    fireEvent.click(tile())
    await waitFor(() => expect(cards().length).toBe(2))
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(within(inline()!.querySelector('[data-slug="friends-light"]') as HTMLElement).getByRole('button', { name: 'Подробнее' }))
    const dlg = await screen.findByRole('dialog', { name: 'Друзья' })
    await within(dlg).findByText('Слова')
    fireEvent.click(within(dlg).getByRole('button', { name: 'Закрыть' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(inline()).not.toBeNull()
  })

  it('поиск и «Показать ещё» работают во встроенном виде', async () => {
    bff.titles = [FRIENDS, ...Array.from({ length: 34 }, (_, i) => card(`s${i}`, { title_en: `Show ${i}` }))]
    await open()
    fireEvent.click(tile())
    await waitFor(() => expect(cards().length).toBe(30))
    fireEvent.click(screen.getByRole('button', { name: 'Показать ещё' }))
    await waitFor(() => expect(cards().length).toBe(35))
    fireEvent.change(screen.getByPlaceholderText('Название на английском или русском'), { target: { value: 'Show 3' } })
    await waitFor(() => expect(bff.calls.some(c => c.url.includes('q=Show+3') || c.url.includes('q=Show%203'))).toBe(true), { timeout: 2000 })
  })

  it('выбор из каталога уходит в goal.titles ровно как с полки', async () => {
    bff.quickStartReply = () => json(202, { job_id: 'j1', revision: 1 })
    await open()
    fireEvent.click(tile())
    await waitFor(() => expect(cards().length).toBe(2))
    fireEvent.click(within(inline()!.querySelector('[data-slug="friends-light"]') as HTMLElement).getByRole('button', { name: 'Друзья' }))
    fireEvent.click(screen.getByRole('button', { name: 'Начать маршрут' }))
    await waitFor(() => expect(qs().length).toBe(1))
    const body = qs()[0].body as { goal: { titles?: string[]; puzzle_ids?: string[] } }
    expect(body.goal.titles).toEqual(['friends-light'])
    expect(body.goal.puzzle_ids ?? []).toEqual([])
  })
})

describe('подробная карточка', () => {
  it('«Подробнее» на полке открывает карточку со снимком полки и пишет тайтл в «Недавние»', async () => {
    await open()
    const friends = document.querySelector('.gc:not(.gc-all)') as HTMLElement
    fireEvent.click(within(friends).getByRole('button', { name: 'Подробнее' }))
    const dlg = await screen.findByRole('dialog', { name: 'Друзья' })
    await within(dlg).findByText('Слова')
    expect(bff.of('/api/me/catalog/titles/friends-light').map(c => c.url)).toEqual([`/api/me/catalog/titles/friends-light?snapshot=${SNAP}`])
    expect(JSON.parse(localStorage.getItem('flib:recent-titles') ?? '[]')).toEqual(['friends-light'])
    // «Недавние» теперь есть — переключатель полок показан
    fireEvent.click(within(dlg).getByRole('button', { name: 'Закрыть' }))
    expect(screen.queryByRole('dialog', { name: 'Друзья' })).toBeNull()
    expect(document.querySelector('.seg')).not.toBeNull()
  })

  it('выбор в карточке считается так же, как на полке; потолок 10 — прежний', async () => {
    await open()
    fireEvent.click(within(document.querySelector('.gc:not(.gc-all)') as HTMLElement).getByRole('button', { name: 'Подробнее' }))
    const dlg = await screen.findByRole('dialog', { name: 'Друзья' })
    await within(dlg).findByText('Слова')
    fireEvent.click(within(dlg).getByRole('button', { name: 'В цель маршрута' }))
    expect(within(dlg).getByRole('button', { name: 'В цели маршрута' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(within(dlg).getByRole('button', { name: 'Закрыть' }))
    expect(count()).toBe('1')
  })
})

describe('каталог выключен', () => {
  it('SHOW_CATALOG=true, но catalog:false: ни плитки, ни «Подробнее», ни каталога, /api/me/catalog не читается', async () => {
    __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_abcd', routeAllowed: true, demo: false, catalog: false })
    renderRoutePage(bff)
    await screen.findByText(fullText('Давайте установим Ваш реальный уровень'))
    expect(document.querySelector('.gc-all')).toBeNull()
    expect(document.querySelector('[data-testid="catalog-inline"]')).toBeNull()
    expect(screen.queryByText('Подробнее')).toBeNull()
    expect(document.querySelector('.gc-more')).toBeNull()
    expect(bff.calls.some(c => c.url.startsWith('/api/me/catalog'))).toBe(false)
  })

  it('SHOW_CATALOG=false при catalog:true — то же: каталога нет', async () => {
    build.show = false
    renderRoutePage(bff)
    await screen.findByText(fullText('Давайте установим Ваш реальный уровень'))
    expect(document.querySelector('.gc-all')).toBeNull()
    expect(screen.queryByText('Подробнее')).toBeNull()
    expect(bff.calls.some(c => c.url.startsWith('/api/me/catalog'))).toBe(false)
  })
})
