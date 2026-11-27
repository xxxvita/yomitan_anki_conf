// home-today.test.tsx — «Сегодня в маршруте» на Главной (план B10e, «Приёмка»):
// оба режима (метка маршрута есть / нет) и все состояния; день с «пройден без
// зачёта» и досмотренным последним роликом — «На сегодня всё — до завтра.»;
// название невыданного не появляется никогда; `next=` = current_puzzle_id;
// пятисекундный заход оставляет «Продолжить маршрут» на плеере; Р24 — сегмент
// «просмотрен» для kept_local 3-го ролика только при записи этого устройства.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { CabinetLayout } from '../../CabinetLayout'
import { CabinetHome } from '../../CabinetHome'
import { __resetSessionForTests } from '../../../session'
import { __resetRouteStateForTests } from '../use-route-state'
import { __resetRouteOutboxForTests, getRouteOutbox } from '../outbox'
import { writeWatched } from '../../../../player/route-events/route-watched'
import { setCabinetMarker } from '../../../__tests__/cabinet-marker'
import { homeSummary } from '../home-model'
import { buildDayModel } from '../day-model'
import { FakeRouteBFF, json, st, del, und, kept, lesson, other, pid, vid, ROUTE, TODAY, setRouteMarker } from './route-page-fakes'
import type { RouteState } from '../route-api'

let bff: FakeRouteBFF
beforeEach(() => {
  __resetSessionForTests(); __resetRouteStateForTests(); __resetRouteOutboxForTests()
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(`${TODAY}T12:00:00`))
  bff = new FakeRouteBFF()
  vi.stubGlobal('fetch', vi.fn((u: string, i?: RequestInit) => bff.fetch(u, i)))
  setCabinetMarker(true); setRouteMarker(true)
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); setCabinetMarker(false); setRouteMarker(false); __resetRouteOutboxForTests(); __resetSessionForTests() })

function renderHome() {
  return render(
    <MemoryRouter initialEntries={['/app']}>
      <Routes><Route path="/app" element={<CabinetLayout />}><Route index element={<CabinetHome />} /></Route></Routes>
    </MemoryRouter>,
  )
}
async function home(s: RouteState) {
  bff.state = s
  renderHome()
  const card = await screen.findByTestId('home-today')
  await waitFor(() => expect(card.querySelector('.count, a.btn')).toBeTruthy())
  await waitFor(() => expect(bff.stateGets).toBeGreaterThan(0))
  await waitFor(() => expect(card.querySelector('[aria-busy]')).toBeNull())
  return card
}
const link = (card: HTMLElement) => card.querySelector('a.btn') as HTMLAnchorElement
const segs = (card: HTMLElement) => Array.from(card.querySelectorAll('[data-testid="home-segs"] i')).map(i => i.className)

describe('B10e: режимы', () => {
  it('метки маршрута нет — заготовка этапа 0, ни одного запроса маршрута', async () => {
    setRouteMarker(false)
    renderHome()
    await screen.findByText('Перейти к маршруту')
    expect(screen.getByText('Скоро', { selector: '.today-card .tag' })).toBeTruthy()
    expect(bff.calls.filter(c => c.url.startsWith('/api/me/route')).length).toBe(0)
  })

  it('нет права маршрута у ключа — заготовка, запроса нет', async () => {
    bff.sessionReply = () => json(200, { authenticated: true, cabinet: true, state: 'active', key_prefix: 'tpk_abcd', demo: false, route_allowed: false })
    renderHome()
    await screen.findByText('Перейти к маршруту')
    expect(bff.stateGets).toBe(0)
  })

  it('маршрут не начат — «Открыть маршрут»', async () => {
    const card = await home(st(null, { started: false, route_id: null, revision: 0, started_at: null }))
    expect(link(card).textContent).toBe('Открыть маршрут')
    expect(link(card).getAttribute('href')).toBe('/app/route')
  })
})

describe('B10e: состояния дня', () => {
  it('текущий не открыт — «Дальше» + его название, «Продолжить маршрут» на его плеер с rp; сегменты', async () => {
    const card = await home(st([del(1, { played: true }), del(2), und({ duration_sec: 99 })], { next_clip: { title: 'SECRET NEXT' } }))
    expect(screen.getByText('Сегодня в маршруте · 18 ноября')).toBeTruthy()
    expect(card.querySelector('.count')!.textContent).toBe('3 ролика, 1 из 3')
    expect(segs(card)).toEqual(['done', 'cur', ''])
    expect(card.querySelector('.up-next')!.textContent).toBe('ДальшеTitle 2')
    expect(link(card).textContent).toBe('Продолжить маршрут')
    expect(link(card).getAttribute('href')).toBe(`/player?v=${vid(2)}&rp=${encodeURIComponent(pid(2))}`)
    expect(card.textContent).not.toContain('SECRET NEXT')
  })

  it('пятисекундный заход на текущий ролик — «Продолжить маршрут» остаётся на его плеере', async () => {
    const card = await home(st([del(1, { played: true }), del(2, { queued_played: true }), und()]))
    expect(link(card).getAttribute('href')).toBe(`/player?v=${vid(2)}&rp=${encodeURIComponent(pid(2))}`)
  })

  it('текущий «просмотрен», есть невыданные — «Дальше: следующий ролик» без названия, next = current_puzzle_id', async () => {
    const card = await home(st([del(1, { played: true }), del(2, { played: true }), und()], { next_clip: { title: 'SECRET NEXT' } }))
    expect(card.querySelector('.up-next')!.textContent).toBe('Дальше: следующий ролик')
    expect(link(card).getAttribute('href')).toBe(`/app/route?next=${encodeURIComponent(pid(2))}`)
    expect(card.textContent).not.toContain('SECRET NEXT')
  })

  it('день с «пройден без зачёта» и досмотренным последним роликом — «На сегодня всё — до завтра.» + «Открыть маршрут»', async () => {
    const card = await home(st([del(1), del(2, { played: true })]))
    expect(card.querySelector('.up-next')!.textContent).toBe('На сегодня всё — до завтра.')
    expect(link(card).textContent).toBe('Открыть маршрут')
    expect(card.querySelector('.count')!.textContent).toBe('2 ролика, 1 из 2')
  })

  it('текущий — не просмотренный урок слов — «Дальше: урок слов», ведёт на страницу урока', async () => {
    const card = await home(st([del(1, { played: true }), lesson('aaaa'), und()]))
    expect(card.querySelector('.up-next')!.textContent).toBe('Дальше: урок слов')
    expect(link(card).getAttribute('href')).toBe('/app/route/words?rw=words%3A%3Aaaaa')
  })

  it('новый учебный день (day.date раньше сегодня) — «Получить ролики на сегодня» → /app/route', async () => {
    const s = st([del(1, { played: true }), und()], { snapshot_date: '2026-11-17' })
    s.day!.date = '2026-11-17'
    const card = await home(s)
    expect(link(card).textContent).toBe('Получить ролики на сегодня')
    expect(link(card).getAttribute('href')).toBe('/app/route')
  })

  it('план без выданных — «Начать день» → /app/route', async () => {
    const card = await home(st([und(), und()], { current_puzzle_id: null }))
    expect(link(card).textContent).toBe('Начать день')
    expect(link(card).getAttribute('href')).toBe('/app/route')
  })

  it('текущий `other` (не открывается на сайте), невыданные есть — «Дальше: следующий ролик»', async () => {
    const card = await home(st([other(1), und()]))
    expect(card.querySelector('.up-next')!.textContent).toBe('Дальше: следующий ролик')
  })
})

describe('B10e: Р24 и правило «до выдачи»', () => {
  it('kept_local 3-го ролика (запись этого устройства) — сегмент «просмотрен»; без записи — нет', async () => {
    const s = st([kept(1), del(2, { played: true }), del(4), und()])
    writeWatched(ROUTE, TODAY, pid(3), 0.9, { video_id: vid(3), title: 'Local 3', duration_sec: 300 })
    const card = await home(s)
    expect(segs(card)).toEqual(['done', 'done', 'done', 'cur', ''])
    const without = homeSummary(s, buildDayModel(s, { watched: {}, pendingClipPlayed: getRouteOutbox().pendingClipPlayed() }), TODAY)
    expect(without.segs).toEqual(['done', 'done', 'cur', ''])
  })

  it('название невыданного не появляется ни в одном состоянии', () => {
    const states = [
      st([del(1), und()]), st([del(1, { played: true }), und()]), st([del(1, { played: true })]), st([und()], { current_puzzle_id: null }),
      st([lesson('a'), und()]), st([lesson('a', { played: true }), und()]),
    ]
    for (const s of states) {
      const sum = homeSummary(s, buildDayModel(s, { watched: {}, pendingClipPlayed: new Set() }), TODAY)
      expect(JSON.stringify(sum)).not.toMatch(/UNDLV|Title [3-9]/)
    }
  })
})
