// RoutePage.redirect.test.tsx — старый путь /route (план B11; спека §4.9, Р17):
// залогиненный при включённых кабинете и маршруте уходит на /app/route; гость и
// любой посетитель при выключенных флагах видят старую страницу как раньше.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { RoutePage } from '../RoutePage'
import { __resetSessionForTests, __setSessionForTests } from '../session'
import { setCabinetMarker } from './cabinet-marker'

function setRouteMarker(on: boolean) {
  document.head.querySelectorAll('meta[name="flib-route"]').forEach(m => m.remove())
  if (!on) return
  const m = document.createElement('meta'); m.setAttribute('name', 'flib-route'); m.setAttribute('content', '1'); document.head.appendChild(m)
}
function Where() { const l = useLocation(); return <div data-testid="where">{l.pathname}</div> }
function renderAt() {
  return render(
    <MemoryRouter initialEntries={['/route']}>
      <Routes>
        <Route path="/route" element={<><RoutePage /><Where /></>} />
        <Route path="/app/route" element={<div data-testid="cabinet-route" />} />
      </Routes>
    </MemoryRouter>,
  )
}
const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ authenticated: false, cabinet: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

beforeEach(() => { localStorage.clear(); __resetSessionForTests(); vi.stubGlobal('fetch', fetchSpy); fetchSpy.mockClear() })
afterEach(() => { setCabinetMarker(false); setRouteMarker(false); vi.unstubAllGlobals(); __resetSessionForTests() })

const guestPage = async () => {
  expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe('Маршрута пока нет')
  expect(screen.getByTestId('where').textContent).toBe('/route')
}

describe('B11: /route', () => {
  it('залогиненный, кабинет и маршрут включены — /app/route', async () => {
    setCabinetMarker(true); setRouteMarker(true)
    __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_abcd', routeAllowed: true })
    renderAt()
    expect(await screen.findByTestId('cabinet-route')).toBeTruthy()
  })

  it('гость при включённых флагах — старая страница', async () => {
    setCabinetMarker(true); setRouteMarker(true)
    __setSessionForTests({ cabinet: true, authenticated: false })
    renderAt()
    await guestPage()
    expect(screen.queryByTestId('cabinet-route')).toBeNull()
  })

  it('залогиненный, маршрут кабинета выключен (нет метки flib-route) — старая страница, сессия не читается', async () => {
    setCabinetMarker(true)
    renderAt()
    await guestPage()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('флаги выключены — старая страница без чтения сессии (как origin/main)', async () => {
    renderAt()
    await guestPage()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('сессия ещё не прочитана — ни старой страницы, ни перехода; затем переход', async () => {
    setCabinetMarker(true); setRouteMarker(true)
    let release: (r: Response) => void = () => {}
    fetchSpy.mockImplementationOnce(() => new Promise<Response>(r => { release = r }))
    renderAt()
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
    expect(screen.getByTestId('where').textContent).toBe('/route')
    // L6: не пустой экран — спиннер загрузки страницы
    expect(screen.getByTestId('route-session-loading').getAttribute('aria-busy')).toBe('true')
    release(new Response(JSON.stringify({ authenticated: true, cabinet: true, state: 'active', key_prefix: 'tpk_abcd', route_allowed: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    expect(await screen.findByTestId('cabinet-route')).toBeTruthy()
  })
})

describe('L6: чтение сессии зависло', () => {
  it('спиннер, а по сроку чтения сессии — старая страница (не пусто)', async () => {
    setCabinetMarker(true); setRouteMarker(true)
    vi.useFakeTimers()
    fetchSpy.mockImplementation((...a: unknown[]) => new Promise<Response>((_res, rej) => {
      const init = a[1] as RequestInit | undefined
      init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))
    }))
    renderAt()
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(screen.getByTestId('route-session-loading')).toBeTruthy()
    await act(async () => { await vi.advanceTimersByTimeAsync(23000) })
    expect(screen.queryByRole('heading', { level: 1 })?.textContent).toBe('Маршрута пока нет')
    vi.useRealTimers()
  })
})
