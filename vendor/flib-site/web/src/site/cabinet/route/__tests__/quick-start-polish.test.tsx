// quick-start-polish.test.tsx — доводка встроенного каталога (ревью PR #104): чипы всех выбранных
// тайтлов под панелью (M1), фокус при раскрытии/сворачивании (M2), фильтры/поиск переживают
// сворачивание (L5).
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
import { FakeRouteBFF, renderRoutePage, st, TODAY, fullText } from './route-page-fakes'

const card = (slug: string, over: Record<string, unknown> = {}) => ({ slug, type: 'series', title_en: slug, goal_ok: true, ...over })
const FRIENDS = card('friends-light', { title_en: 'Friends', title_ru: 'Друзья', year: 1994 })
const MONK = card('monk', { title_en: 'Monk', year: 2002 })

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
const inline = () => document.querySelector('[data-testid="catalog-inline"]') as HTMLElement
const search = () => screen.getByPlaceholderText('Название на английском или русском') as HTMLInputElement
const cardsIn = () => document.querySelectorAll('[data-testid="catalog-inline"] .gc-grid .gc:not(.sk)')

describe('чипы выбранных в открытом каталоге (M1)', () => {
  it('все выбранные — одним рядом под панелью; нижнего .gc-extra нет; × снимает', async () => {
    await open()
    // выбор на полке, затем открыть каталог
    fireEvent.click(screen.getByRole('button', { name: 'Друзья' }))
    fireEvent.click(tile())
    await waitFor(() => expect(cardsIn().length).toBe(2))
    fireEvent.click(within(inline().querySelector('[data-slug="monk"]') as HTMLElement).getByRole('button', { name: 'Monk' }))
    const row = screen.getByTestId('catalog-chosen')
    expect(inline().contains(row)).toBe(true)
    expect(row.previousElementSibling?.classList.contains('ct-bar')).toBe(true)
    expect(within(row).getAllByRole('button').map(b => b.getAttribute('aria-label')).sort())
      .toEqual(['Убрать цель Друзья', 'Убрать цель Monk'].sort())
    expect(document.querySelector('.gc-extra')).toBeNull()
    fireEvent.click(within(row).getByRole('button', { name: 'Убрать цель Monk' }))
    expect(within(screen.getByTestId('catalog-chosen')).queryByRole('button', { name: 'Убрать цель Monk' })).toBeNull()
  })

  it('выбранный тайтл, отфильтрованный из вида, остаётся виден чипом', async () => {
    await open()
    fireEvent.click(tile())
    await waitFor(() => expect(cardsIn().length).toBe(2))
    fireEvent.click(within(inline().querySelector('[data-slug="monk"]') as HTMLElement).getByRole('button', { name: 'Monk' }))
    bff.titles = [FRIENDS]
    fireEvent.change(search(), { target: { value: 'fri' } })
    await waitFor(() => expect(cardsIn().length).toBe(1), { timeout: 2000 })
    expect(within(screen.getByTestId('catalog-chosen')).getByRole('button', { name: 'Убрать цель Monk' })).toBeTruthy()
  })
})

describe('фокус (M2) и сохранение вида (L5)', () => {
  const pointer = (fine: boolean) => vi.stubGlobal('matchMedia', (q: string) => ({ matches: fine && q === '(pointer: fine)', media: q }))

  it('сенсорный экран: раскрытие — фокус на заголовок каталога, не в поле (клавиатура не вылезает)', async () => {
    pointer(false)
    await open()
    fireEvent.click(tile())
    await waitFor(() => expect(cardsIn().length).toBe(2))
    expect(document.activeElement).toBe(inline().querySelector('.sh-h h3'))
    expect(document.activeElement).not.toBe(search())
  })

  it('поиск, набранный и свёрнутый быстрее 300 мс, при повторном открытии уходит в запрос (q=mon)', async () => {
    pointer(true)
    await open()
    fireEvent.click(tile())
    await waitFor(() => expect(cardsIn().length).toBe(2))
    fireEvent.change(search(), { target: { value: 'mon' } })
    fireEvent.click(screen.getByRole('button', { name: 'Свернуть каталог' }))
    await waitFor(() => expect(tile()).not.toBeNull())
    bff.calls.length = 0
    fireEvent.click(tile())
    await waitFor(() => expect(inline()).not.toBeNull())
    expect(search().value).toBe('mon')
    await waitFor(() => expect(bff.calls.some(c => /titles\?/.test(c.url) && c.url.includes('q=mon'))).toBe(true))
  })

  it('раскрытие — фокус в поле поиска (точный указатель); сворачивание — на плитку «Все»', async () => {
    pointer(true)
    await open()
    fireEvent.click(tile())
    await waitFor(() => expect(cardsIn().length).toBe(2))
    expect(document.activeElement).toBe(search())
    fireEvent.click(screen.getByRole('button', { name: 'Свернуть каталог' }))
    await waitFor(() => expect(document.activeElement).toBe(tile()))
  })

  it('поиск и сортировка сохраняются при сворачивании и повторном открытии', async () => {
    await open()
    fireEvent.click(tile())
    await waitFor(() => expect(cardsIn().length).toBe(2))
    fireEvent.change(search(), { target: { value: 'mon' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Сортировка' }), { target: { value: 'new' } })
    await waitFor(() => expect(bff.calls.some(c => c.url.includes('sort=new') && c.url.includes('q=mon'))).toBe(true), { timeout: 2000 })
    fireEvent.click(screen.getByRole('button', { name: 'Свернуть каталог' }))
    await waitFor(() => expect(tile()).not.toBeNull())
    fireEvent.click(tile())
    await waitFor(() => expect(inline()).not.toBeNull())
    expect(search().value).toBe('mon')
    expect((screen.getByRole('combobox', { name: 'Сортировка' }) as HTMLSelectElement).value).toBe('new')
  })
})
