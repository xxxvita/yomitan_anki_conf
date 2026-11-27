// nav-v2.test.tsx — навигация кабинета v2 (дизайн 2026-11-19, «Навигация v2»;
// решения владельца 2026-11-19): активный пункт с aria-current, счётчик дня
// «k из M» у «Маршрута» (меню и нижняя панель) из ОБЩЕГО чтения состояния — без
// своего запроса; «Доступно: более 6 000 материалов» на странице Маршрута (одно
// и то же для демо и полного ключа); плашка «Ключ закончится через N дней» за 7
// дней до конца; демо — «Демо до … · Продлите ключ — маршрут сохранится».
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { CabinetLayout } from '../CabinetLayout'
import { CabinetSoon } from '../CabinetSoon'
import { __resetSessionForTests } from '../../session'
import { setCabinetMarker } from '../../__tests__/cabinet-marker'
import { __resetRouteStateForTests, __setLastRouteReadForTests, type StateRead } from '../route/use-route-state'
import { st, del, und, setRouteMarker } from '../route/__tests__/route-page-fakes'
import type { RouteState } from '../route/route-api'

const NOW = new Date('2026-11-19T12:00:00')
const daysFromNow = (d: number) => new Date(NOW.getTime() + d * 86_400_000).toISOString()
const ACTIVE = { authenticated: true, state: 'active', cabinet: true, key_prefix: 'tpk_aaaa', demo: false, key_expires_at: daysFromNow(30), shadowing: true, route_allowed: true }
const okRead = (state: RouteState): StateRead => ({ result: { ok: true, status: 200, data: state }, sent: { watchedSeq: 0, pendingClipPlayed: new Set() } })

let fetchMock: ReturnType<typeof vi.fn>
function bff(session: unknown) {
  fetchMock = vi.fn(async () => new Response(JSON.stringify(session), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', fetchMock)
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/app" element={<CabinetLayout />}>
          <Route index element={<CabinetSoon title="Главная" />} />
          <Route path="route" element={<CabinetSoon title="Маршрут" />} />
          <Route path="knowledge" element={<CabinetSoon title="Мои знания" />} />
          <Route path="profile" element={<CabinetSoon title="Профиль" />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

const side = () => screen.findByRole('navigation', { name: 'Кабинет' })
const tabs = () => screen.getByRole('navigation', { name: 'Кабинет — разделы' })
const topbar = () => document.querySelector('.topbar') as HTMLElement

describe('навигация v2', () => {
  beforeEach(() => {
    localStorage.clear(); __resetSessionForTests(); __resetRouteStateForTests(); setCabinetMarker(true); setRouteMarker(true)
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW)
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); __resetSessionForTests(); __resetRouteStateForTests(); setCabinetMarker(false); setRouteMarker(false) })

  it('активный пункт — class on и aria-current="page"; остальные без aria-current', async () => {
    bff(ACTIVE)
    renderAt('/app/route')
    const nav = await side()
    const route = within(nav).getByRole('link', { name: 'Маршрут' })
    expect(route.className).toBe('on')
    expect(route.getAttribute('aria-current')).toBe('page')
    expect(within(nav).getByRole('link', { name: 'Главная' }).getAttribute('aria-current')).toBeNull()
    expect(within(tabs()).getByRole('link', { name: 'Маршрут' }).getAttribute('aria-current')).toBe('page')
  })

  it('«Мои знания» — с меткой «Бета» (макет, навигация v2); у других пунктов метки нет', async () => {
    bff(ACTIVE)
    renderAt('/app')
    const nav = await side()
    const link = within(nav).getByRole('link', { name: /Мои знания/ })
    expect(link.querySelector('.nav-beta')?.textContent).toBe('Бета')
    expect(document.querySelectorAll('.nav-beta')).toHaveLength(1)
    expect(within(nav).getByRole('link', { name: 'Главная' }).querySelector('.nav-beta')).toBeNull()
  })

  it('«Мои знания» за воротами «Скоро» (нет метки маршрута) — без метки «Бета»', async () => {
    setRouteMarker(false)
    bff(ACTIVE)
    renderAt('/app')
    const nav = await side()
    expect(within(nav).getByRole('link', { name: /Мои знания/ }).querySelector('.nav-beta')).toBeNull()
    expect(document.querySelectorAll('.nav-beta')).toHaveLength(0)
  })

  describe('счётчик дня маршрута', () => {
    it('нет чтения состояния — счётчика нет', async () => {
      bff(ACTIVE)
      renderAt('/app')
      await side()
      expect(document.querySelector('.nav-cnt')).toBeNull()
      expect(document.querySelector('.tab-cnt')).toBeNull()
    })

    it('день из трёх, один просмотрен — «1 из 3» у «Маршрута» и «1/3» в нижней панели; запросов маршрута нет', async () => {
      bff(ACTIVE)
      renderAt('/app')
      const nav = await side()
      act(() => { __setLastRouteReadForTests(okRead(st([del(1, { played: true }), del(2), und()]))) })
      const link = within(nav).getAllByRole('link')[1]
      expect(link.querySelector('.nav-cnt')?.textContent).toBe('1 из 3')
      expect(within(tabs()).getAllByRole('link')[1].querySelector('.tab-cnt')?.textContent).toBe('1/3')
      expect(fetchMock.mock.calls.filter(c => String(c[0]).includes('/api/me/route')).length).toBe(0)
    })

    it('чтение под другим ключом — не показывается', async () => {
      bff(ACTIVE)
      renderAt('/app')
      await side()
      act(() => { __setLastRouteReadForTests(okRead(st([del(1), und()])), 'in:tpk_zzzz') })
      expect(document.querySelector('.nav-cnt')).toBeNull()
    })

    it('маршрут не начат или дня нет — счётчика нет', async () => {
      bff(ACTIVE)
      renderAt('/app')
      await side()
      act(() => { __setLastRouteReadForTests(okRead(st(null))) })
      expect(document.querySelector('.nav-cnt')).toBeNull()
    })

    it('флаг маршрута выключен — счётчика нет', async () => {
      setRouteMarker(false)
      bff(ACTIVE)
      renderAt('/app')
      await side()
      act(() => { __setLastRouteReadForTests(okRead(st([del(1), und()]))) })
      expect(document.querySelector('.nav-cnt')).toBeNull()
    })
  })

  describe('«Доступно» в верхней строке', () => {
    it.each([false, true])('на странице Маршрута (демо=%s) — «Доступно: более 6 000 материалов»', async demo => {
      bff({ ...ACTIVE, demo })
      renderAt('/app/route')
      await side()
      const avail = topbar().querySelector('.avail') as HTMLElement
      expect(avail.textContent).toBe('Доступно: более 6 000 материалов')
      expect(avail.querySelector('b')?.textContent).toBe('более 6 000 материалов')
    })

    it('маршрут начат — «Доступно более 3 200 000 материалов для рекомендаций»; не начат — прежний текст', async () => {
      bff(ACTIVE)
      renderAt('/app/route')
      await side()
      expect(topbar().querySelector('.avail')?.textContent).toBe('Доступно: более 6 000 материалов')
      act(() => { __setLastRouteReadForTests(okRead(st([del(1), und()]))) })
      expect(topbar().querySelector('.avail')?.textContent).toBe('Доступно более 3 200 000 материалов для рекомендаций')
    })

    it('на других страницах и при выключенном флаге маршрута — нет', async () => {
      bff(ACTIVE)
      const { unmount } = renderAt('/app')
      await side()
      expect(topbar().querySelector('.avail')).toBeNull()
      unmount()
      setRouteMarker(false)
      renderAt('/app/route')
      await side()
      expect(topbar().querySelector('.avail')).toBeNull()
    })
  })

  describe('срок ключа', () => {
    it('полный ключ, до конца больше 7 дней — «Ключ активен до …», «Продлить» вторичная', async () => {
      bff({ ...ACTIVE, key_expires_at: daysFromNow(8) })
      renderAt('/app')
      expect((await screen.findByText(/Ключ активен до/)).textContent).toMatch(/^Ключ активен до \d+ [а-я]+$/)
      expect(topbar().querySelector('.keyline.soon')).toBeNull()
      expect(within(topbar()).getByRole('link', { name: 'Продлить' }).className).not.toContain('primary')
    })

    it('полный ключ, 5 дней — плашка «Ключ закончится через 5 дней, дата» с точкой, «Продлить» основная', async () => {
      bff({ ...ACTIVE, key_expires_at: daysFromNow(4.5) })
      renderAt('/app')
      await side()
      const line = topbar().querySelector('.keyline.soon') as HTMLElement
      expect(line.textContent).toMatch(/^Ключ закончится через 5 дней, \d+ [а-я]+$/)
      expect(line.querySelector('b')?.textContent).toBe('5 дней')
      expect(line.querySelector('.dot')).toBeTruthy()
      // Дата — отдельным элементом: на телефоне она скрыта (иначе три строки в 360 px).
      expect(line.querySelector('.soon-date')?.textContent).toMatch(/^, \d+ [а-я]+$/)
      expect(within(topbar()).getByRole('link', { name: 'Продлить' }).className).toContain('primary')
    })

    it('1 день — «через 1 день»; 3 дня — «через 3 дня»', async () => {
      bff({ ...ACTIVE, key_expires_at: daysFromNow(0.5) })
      const { unmount } = renderAt('/app')
      await side()
      expect(topbar().querySelector('.keyline.soon b')?.textContent).toBe('1 день')
      unmount()
      __resetSessionForTests()
      bff({ ...ACTIVE, key_expires_at: daysFromNow(3) })
      renderAt('/app')
      await side()
      expect(topbar().querySelector('.keyline.soon b')?.textContent).toBe('3 дня')
    })

    it('демо — «Демо до дата · Продлите ключ — маршрут сохранится», без плашки срока, «Продлить» основная', async () => {
      bff({ ...ACTIVE, demo: true, key_expires_at: daysFromNow(3) })
      renderAt('/app')
      await side()
      const line = topbar().querySelector('.keyline.demo') as HTMLElement
      expect(line.textContent).toMatch(/^Демо до \d+ [а-я]+· Продлите ключ — маршрут сохранится$/)
      expect(line.querySelector('.demo-note')?.textContent).toBe('· Продлите ключ — маршрут сохранится')
      expect(topbar().querySelector('.keyline.soon')).toBeNull()
      expect(within(topbar()).getByRole('link', { name: 'Продлить' }).className).toContain('primary')
    })
  })
})
