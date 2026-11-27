// PlayerPage.subsGate.test.tsx — гейт субтитров первого прохода в плеере (спека
// кабинета §4.7, план B8b): маршрутный ролик — субтитры скрыты, режим
// flib:subMode не перезаписан, включение — через предупреждение, после согласия
// — размытие по словам; русского текста нет ни в одном месте, до и после
// согласия; пока проверка режима не ответила — гейт включён; гостевой ролик и
// выключенный маршрут — плеер прежний.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const h = vi.hoisted(() => ({ cues: [] as { start: number; end: number; text_en: string; text_ru: string }[], activeIndex: 0 }))
vi.mock('../../player/hooks/useSubtitles', () => ({
  useSubtitles: () => ({ cues: h.cues, activeIndex: h.activeIndex, status: 'ok', retrying: false, source: null }),
}))

import { PlayerPage } from '../PlayerPage'
import { __resetSessionForTests, __setSessionForTests } from '../../site/session'
import { __resetRouteStateForTests } from '../../site/cabinet/route/use-route-state'
import { __forgetSubsWarningsForTests } from '../../player/route-events/subs-gate'
import { __resetClipListenedForTests } from '../../player/route-events/clip-listened'

const V = 'abc123XYZ_1'
const RP = `youtube::${V}`

function setRouteMarker(on: boolean): void {
  document.head.querySelectorAll('meta[name="flib-route"]').forEach(m => m.remove())
  if (!on) return
  const m = document.createElement('meta')
  m.setAttribute('name', 'flib-route'); m.setAttribute('content', '1')
  document.head.appendChild(m)
}

function state(played = false) {
  return {
    started: true, route_id: '11111111-1111-4111-8111-111111111111', revision: 4, snapshot_date: '2026-11-18', started_at: null,
    goal_label: 'g', params: { daily_listening_budget_min: 20, daily_new_words: 15 },
    day: { date: '2026-11-18', clips: [{ puzzle_id: RP, kind: 'youtube', video_id: V, delivered: true, played, queued_played: true, new_words: 1, words: ['hello'] }] },
    next_clip: null, current_puzzle_id: RP, replace_available: false, stop_reason: null, active_exchange: null,
  }
}

function stubFetch(routeState: () => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    if (String(url).startsWith('/api/me/route/state')) return routeState()
    return Promise.reject(new Error('no net'))
  }))
}
const json = (b: unknown) => Promise.resolve(new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } }))

function mount(q: string) {
  return render(<MemoryRouter initialEntries={[`/player?${q}`]}><PlayerPage /></MemoryRouter>)
}

beforeEach(() => {
  __resetSessionForTests(); __resetRouteStateForTests(); __forgetSubsWarningsForTests(); __resetClipListenedForTests()
  localStorage.clear()
  localStorage.setItem('flib:subMode', 'l2l1')
  h.cues = [{ start: 0, end: 2, text_en: 'Hello brave world', text_ru: 'Привет смелый мир' }]
  h.activeIndex = 0
})
afterEach(() => { setRouteMarker(false); vi.unstubAllGlobals() })

describe('PlayerPage — гейт субтитров первого прохода', () => {
  it('маршрутный ролик: скрыто, flib:subMode не стал hidden; «Хорошо» — скрыто; «Всё равно показать» — размытые слова, без русского', async () => {
    setRouteMarker(true)
    __setSessionForTests({ cabinet: true, authenticated: true, state: 'active' })
    stubFetch(() => json(state()))
    const { container, getByTestId, queryByTestId } = mount(`v=${V}&rp=${encodeURIComponent(RP)}`)
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    expect(queryByTestId('subtitle-overlay')).toBeNull()
    expect(localStorage.getItem('flib:subMode')).toBe('l2l1')
    expect(container.textContent).not.toContain('Привет')

    fireEvent.click(getByTestId('sub-mode-enru'))
    expect(getByTestId('subs-first-pass-warning')).toBeTruthy()
    fireEvent.click(getByTestId('subs-warning-keep'))
    expect(queryByTestId('subs-first-pass-warning')).toBeNull()
    expect(queryByTestId('subtitle-overlay')).toBeNull()

    fireEvent.click(getByTestId('sub-mode-enru'))
    fireEvent.click(getByTestId('subs-warning-show'))
    await waitFor(() => expect(queryByTestId('subtitle-overlay')).toBeTruthy())
    expect(container.querySelectorAll('.sub-word--blur').length).toBe(3)
    expect(localStorage.getItem('flib:subMode')).toBe('l2l1')
    expect(container.textContent).not.toContain('Привет')
    expect(queryByTestId('subtitle-l1-overlay')).toBeNull()
    // первое нажатие на размытое слово не открывает окно примеров
    fireEvent.click(container.querySelectorAll('.sub-word')[0])
    expect(queryByTestId('word-popup')).toBeNull()
    expect(container.querySelector('.word-popup')).toBeNull()
    // список реплик, поиск, капсула, ПКМ-меню, пилюля «Перевести» — без русского и без перевода
    fireEvent.click(getByTestId('gear-btn'))
    expect(container.textContent).not.toContain('Привет')
    expect(container.querySelector('button[aria-label="Перевести эту строку"]')).toBeNull()
    fireEvent.change(getByTestId('search-input'), { target: { value: 'Привет' } })
    expect(queryByTestId('search-results')).toBeNull()
    fireEvent.contextMenu(getByTestId('subtitle-overlay'))
    expect(document.querySelector('[data-testid="translate-menu"]')).toBeNull()
    const pill = queryByTestId('translate-pill') as HTMLButtonElement | null
    if (pill) expect(pill.disabled).toBe(true)
    expect(document.body.textContent).not.toContain('Привет')
  })

  it('кнопки режима в выдвижной панели тоже идут через предупреждение', async () => {
    setRouteMarker(true)
    __setSessionForTests({ cabinet: true, authenticated: true, state: 'active' })
    stubFetch(() => json(state()))
    const { getByTestId, queryByTestId } = mount(`v=${V}&rp=${encodeURIComponent(RP)}`)
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    fireEvent.click(getByTestId('gear-btn'))
    fireEvent.click(getByTestId('sd-mode-l2'))
    expect(getByTestId('subs-first-pass-warning')).toBeTruthy()
    expect(queryByTestId('subtitle-overlay')).toBeNull()
  })

  it('отметка «прослушан» (flib:route-listened) снимает гейт', async () => {
    setRouteMarker(true)
    __setSessionForTests({ cabinet: true, authenticated: true, state: 'active' })
    localStorage.setItem('flib:route-listened', JSON.stringify([RP]))
    stubFetch(() => json(state()))
    const { queryByTestId, container } = mount(`v=${V}&rp=${encodeURIComponent(RP)}`)
    await waitFor(() => expect(queryByTestId('subtitle-overlay')).toBeTruthy())
    expect(container.querySelectorAll('.sub-word--blur').length).toBe(0)
  })

  it('пока проверка режима не ответила — гейт включён', async () => {
    setRouteMarker(true)
    __setSessionForTests({ cabinet: true, authenticated: true, state: 'active' })
    stubFetch(() => new Promise<Response>(() => {}))
    const { queryByTestId, container } = mount(`v=${V}&rp=${encodeURIComponent(RP)}`)
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    expect(queryByTestId('subtitle-overlay')).toBeNull()
    expect(container.textContent).not.toContain('Привет')
  })

  it('ролик уже засчитан (played) — плеер как обычно', async () => {
    setRouteMarker(true)
    __setSessionForTests({ cabinet: true, authenticated: true, state: 'active' })
    stubFetch(() => json(state(true)))
    const { queryByTestId, container } = mount(`v=${V}&rp=${encodeURIComponent(RP)}`)
    await waitFor(() => expect(queryByTestId('subtitle-overlay')).toBeTruthy())
    expect(container.querySelectorAll('.sub-word--blur').length).toBe(0)
    expect(container.textContent).toContain('Привет')
  })

  it('гость и выключенный маршрут — плеер прежний, запросов маршрута нет', async () => {
    for (const marker of [true, false]) {
      setRouteMarker(marker)
      const calls: string[] = []
      vi.stubGlobal('fetch', vi.fn((url: string) => { calls.push(String(url)); return Promise.reject(new Error('no net')) }))
      const q = marker ? `v=${V}` : `v=${V}&rp=${encodeURIComponent(RP)}`
      const { queryByTestId, container, unmount } = mount(q)
      await act(async () => { await new Promise(r => setTimeout(r, 20)) })
      expect(queryByTestId('subtitle-overlay')).toBeTruthy()
      expect(container.querySelectorAll('.sub-word--blur').length).toBe(0)
      expect(container.textContent).toContain('Привет')
      expect(calls.some(c => c.includes('/api/me/route/'))).toBe(false)
      unmount()
    }
  })
})
