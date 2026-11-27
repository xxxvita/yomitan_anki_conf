// hero-panel-scroll.test.tsx — панель героя (причины «Не нравится» / подтверждение
// замены) при ОТКРЫТИИ по действию прокручивается в видимую область (на телефоне она
// иначе под фиксированной нижней панелью разделов). Один раз на открытие; не при
// перерисовке; не у строк дня.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { __resetSessionForTests, __setSessionForTests } from '../../../session'
import { __resetRouteStateForTests } from '../use-route-state'
import { __resetRouteOutboxForTests } from '../outbox'
import { FakeRouteBFF, renderRoutePage, st, del, und, TODAY } from './route-page-fakes'

let bff: FakeRouteBFF
let spy: ReturnType<typeof vi.fn>
beforeEach(() => {
  __resetSessionForTests(); __resetRouteStateForTests(); __resetRouteOutboxForTests()
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(`${TODAY}T12:00:00`))
  bff = new FakeRouteBFF()
  vi.stubGlobal('fetch', vi.fn((u: string, i?: RequestInit) => bff.fetch(u, i)))
  spy = vi.fn()
  ;(Element.prototype as unknown as { scrollIntoView: unknown }).scrollIntoView = spy
  __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_abcd', routeAllowed: true, demo: false })
})
afterEach(() => {
  vi.useRealTimers(); vi.unstubAllGlobals(); __resetRouteOutboxForTests()
  delete (Element.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView
})

const hero = () => screen.getByTestId('day-hero')
async function show() { bff.state = st([del(1, { played: true }), del(2), und()]); renderRoutePage(bff); await screen.findByTestId('day-hero') }

describe('прокрутка панели героя', () => {
  it('открытие причин — один вызов scrollIntoView({block:nearest})', async () => {
    await show()
    expect(spy).not.toHaveBeenCalled()
    fireEvent.click(within(hero()).getByRole('button', { name: 'Не нравится' }))
    await waitFor(() => expect(hero().querySelector('.row-panel')).toBeTruthy())
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][0]).toMatchObject({ block: 'nearest' })
  })

  it('перерисовка с уже открытой панелью (выбор причины) не прокручивает', async () => {
    await show()
    fireEvent.click(within(hero()).getByRole('button', { name: 'Не нравится' }))
    await waitFor(() => expect(hero().querySelector('.row-panel')).toBeTruthy())
    expect(spy).toHaveBeenCalledTimes(1)
    fireEvent.click(hero().querySelector('.row-panel input[type="radio"]')!)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('подтверждение «Заменить» в герое — тоже один вызов', async () => {
    await show()
    fireEvent.click(within(hero()).getByRole('button', { name: 'Заменить' }))
    await waitFor(() => expect(hero().querySelector('.row-panel')).toBeTruthy())
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('строки дня — без прокрутки', async () => {
    await show()
    const rowEl = screen.getByTestId('row-1')
    fireEvent.click(within(rowEl).getByRole('button', { name: 'Не нравится' }))
    await waitFor(() => expect(rowEl.querySelector('.row-panel') || document.querySelector('.row-panel')).toBeTruthy())
    expect(spy).not.toHaveBeenCalled()
  })

  it('без scrollIntoView (jsdom) — не падает', async () => {
    delete (Element.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView
    await show()
    fireEvent.click(within(hero()).getByRole('button', { name: 'Не нравится' }))
    await waitFor(() => expect(hero().querySelector('.row-panel')).toBeTruthy())
  })
})

describe('CSS запаса под нижнюю панель', () => {
  it('.row-panel: scroll-margin-bottom, на ≤760px — 68px + safe area', () => {
    const css = readFileSync(join(process.cwd(), 'src/site/cabinet/route/route.css'), 'utf-8')
    expect(css).toMatch(/\.cab \.row-panel \{ scroll-margin-bottom: 16px; \}/)
    expect(css).toMatch(/@media \(max-width: 760px\) \{\s*\.cab \.row-panel \{ scroll-margin-bottom: calc\(68px \+ env\(safe-area-inset-bottom, 0px\) \+ 16px\); \}/)
  })
})
