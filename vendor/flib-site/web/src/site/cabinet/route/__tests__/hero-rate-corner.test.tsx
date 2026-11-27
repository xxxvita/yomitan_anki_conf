// hero-rate-corner.test.tsx — «Нравится» / «Не нравится» героя стоят в правом
// нижнем углу обложки (решение владельца 2026-11-25), а не в .hero-actions.
// Кнопки не внутри обложки-ссылки (aria-hidden, tabindex=-1): вложенных
// интерактивных нет, и в дереве доступности они остаются.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { __resetSessionForTests, __setSessionForTests } from '../../../session'
import { __resetRouteStateForTests } from '../use-route-state'
import { __resetRouteOutboxForTests } from '../outbox'
import { FakeRouteBFF, renderRoutePage, st, del, und, lesson, other, TODAY } from './route-page-fakes'
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

const hero = () => screen.getByTestId('day-hero')
async function show(s: RouteState) { bff.state = s; renderRoutePage(bff); await screen.findByTestId('day-hero') }

function expectInCorner() {
  const corner = hero().querySelector('.poster-rate') as HTMLElement
  expect(corner).toBeTruthy()
  expect(corner.parentElement!.className).toBe('poster-wrap')
  for (const name of ['Нравится', 'Не нравится']) {
    const b = within(hero()).getByRole('button', { name })
    expect(corner.contains(b)).toBe(true)
    expect(b.closest('a')).toBeNull()
    expect(b.closest('.hero-actions')).toBeNull()
    expect(b.closest('[aria-hidden="true"]')).toBeNull()
  }
}

describe('оценка в углу обложки героя', () => {
  it('ролик YouTube: кнопки в .poster-rate рядом с обложкой-ссылкой, не внутри неё и не в .hero-actions', async () => {
    await show(st([del(1), und()]))
    expectInCorner()
    const wrap = hero().querySelector('.poster-wrap')!
    expect(wrap.querySelector('a.poster')).toBeTruthy()
    expect(wrap.querySelector('a.poster button')).toBeNull()
  })

  it('урок слов: кнопки в углу статичной обложки', async () => {
    await show(st([del(1, { played: true }), lesson('aaaa'), und()]))
    expect(hero().querySelector('.poster-wrap .poster.static')).toBeTruthy()
    expectInCorner()
  })

  it('ролик `other`: кнопки в углу статичной обложки', async () => {
    await show(st([other(1), und()]))
    expect(hero().querySelector('.poster-wrap .poster.static')).toBeTruthy()
    expectInCorner()
  })

  it('клик оценивает и не уводит к плееру', async () => {
    await show(st([del(1), und()]))
    fireEvent.click(within(hero()).getByRole('button', { name: 'Нравится' }))
    await waitFor(() => expect(within(hero()).getByRole('button', { name: 'Нравится' }).getAttribute('aria-pressed')).toBe('true'))
    expect(screen.getByTestId('location').textContent).toBe('/app/route')
    expect(screen.queryByTestId('elsewhere')).toBeNull()
  })

  it('причины дизлайка открываются в теле героя', async () => {
    await show(st([del(1), und()]))
    fireEvent.click(within(hero()).getByRole('button', { name: 'Не нравится' }))
    await waitFor(() => expect(hero().querySelector('.hero-body .row-panel')).toBeTruthy())
  })

  it('«Начать день»: обложка прежняя, без обёртки и без оценки', async () => {
    bff.state = st([und(), und()], { current_puzzle_id: null }); renderRoutePage(bff)
    await screen.findByText('Начать день')
    expect(hero().querySelector('.poster-wrap')).toBeNull()
    expect(hero().querySelector('.poster.static')).toBeTruthy()
    expect(within(hero()).queryByRole('button', { name: 'Нравится' })).toBeNull()
  })
})

describe('CSS угла обложки', () => {
  const css = readFileSync(join(process.cwd(), 'src/site/cabinet/route/route.css'), 'utf-8')
  const rule = (sel: string) => {
    const m = css.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}'))
    return m ? m[1] : ''
  }
  it('обёртка — ребёнок сетки с рамкой и 16:10; обложка заполняет её', () => {
    expect(rule('.cab .poster-wrap')).toMatch(/position:\s*relative/)
    expect(rule('.cab .poster-wrap')).toMatch(/aspect-ratio:\s*16\/10/)
    expect(rule('.cab .poster-wrap')).toMatch(/border-right/)
    expect(rule('.cab .poster-wrap > .poster')).toMatch(/position:\s*absolute;\s*inset:\s*0/)
  })
  it('угол: right/bottom 12px, gap 8px, поверх ссылки', () => {
    const r = rule('.cab .poster-rate')
    expect(r).toMatch(/position:\s*absolute/)
    expect(r).toMatch(/right:\s*12px/); expect(r).toMatch(/bottom:\s*12px/)
    expect(r).toMatch(/display:\s*flex/); expect(r).toMatch(/gap:\s*8px/); expect(r).toMatch(/z-index:\s*\d+/)
  })
  it('читаемость: тёмная подложка, .on с плотной подложкой, focus-visible', () => {
    expect(rule('.cab .poster-rate .btn')).toContain('rgba(15,13,10,.72)')
    expect(rule('.cab .poster-rate .btn.on')).toMatch(/background:\s*rgba\(15,13,10,/)
    expect(rule('.cab .poster-rate .btn.on')).toMatch(/border-color:\s*var\(--accent\)/)
    expect(rule('.cab .poster-rate .btn:focus-visible')).toMatch(/outline/)
  })
  it('рамки обёртки снимаются там же, где у обложки (760px и контейнер rcol)', () => {
    expect((css.match(/\.cab \.poster, \.cab \.poster-wrap \{ border-right: 0/g) ?? []).length).toBe(2)
  })
  it('пустые .hero-actions не оставляют зазора', () => {
    expect(rule('.cab .hero-actions:empty')).toMatch(/display:\s*none/)
  })
})
