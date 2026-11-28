// PlayerPage.playerV2.test.tsx — плеер v2 (дизайн владельца 2026-11-19 §4):
// в режиме маршрута название, метки и «Нравится / Не нравится» стоят ПОД видео
// (не поверх — верхняя строка их не закрывает); гостевой плеер оценку держит
// поверх видео, как раньше; кнопка ☰ верхней строки открывает меню-выезжающую
// панель (на телефоне меню скрыто, CSS — left-rail-phone-css.test.ts).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, act, waitFor, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const h = vi.hoisted(() => ({ cues: [] as { start: number; end: number; text_en: string; text_ru: string }[], adapter: null as any }))
vi.mock('../../player/hooks/useSubtitles', () => ({
  useSubtitles: () => ({ cues: h.cues, activeIndex: 0, status: 'ok', retrying: false, source: 'daemon_align' }),
}))
vi.mock('../../adapter/IFrameAdapter', () => ({
  createIFrameAdapter: async () => {
    const { makeFakeAdapter } = await import('../../adapter/__tests__/fake')
    h.adapter = makeFakeAdapter({ duration: 120, t: 0 })
    return h.adapter
  },
}))

import { PlayerPage } from '../PlayerPage'
import { __resetSessionForTests, __setSessionForTests } from '../../site/session'
import { __resetRouteStateForTests } from '../../site/cabinet/route/use-route-state'
import { __resetRouteOutboxForTests } from '../../site/cabinet/route/outbox'

const V = 'abc123XYZ_1'
const RP = `youtube::${V}`
const ROUTE = '11111111-1111-4111-8111-111111111111'
function marker(name: string, on: boolean) {
  document.head.querySelectorAll(`meta[name="${name}"]`).forEach(m => m.remove())
  if (!on) return
  const m = document.createElement('meta'); m.setAttribute('name', name); m.setAttribute('content', '1'); document.head.appendChild(m)
}
const json = (st: number, b: unknown) => Promise.resolve(new Response(JSON.stringify(b), { status: st, headers: { 'Content-Type': 'application/json' } }))
let today = ''
const state = () => ({
  started: true, route_id: ROUTE, revision: 4, snapshot_date: today, started_at: null, goal_label: 'g',
  params: { daily_listening_budget_min: 20, daily_new_words: 15 },
  day: { date: today, clips: [{ puzzle_id: RP, kind: 'youtube', video_id: V, title: 'How to order coffee', series_title: 'Daily English', source: 'YouTube', delivered: true, played: false, queued_played: false, new_words: 0, words: [], duration_sec: 125 }, { delivered: false, new_words: 0, duration_sec: 100 }] },
  next_clip: {}, current_puzzle_id: RP, replace_available: true, stop_reason: null, active_exchange: null,
})

beforeEach(() => {
  __resetSessionForTests(); __resetRouteStateForTests(); __resetRouteOutboxForTests()
  localStorage.clear(); localStorage.setItem('flib:subMode', 'l2')
  h.cues = [{ start: 0, end: 2, text_en: 'Hello brave world', text_ru: 'Привет' }]
  h.adapter = null
  const d = new Date(); today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    const u = String(url)
    if (u.startsWith('/api/me/route/state')) return json(200, state())
    if (u.startsWith('/api/me/route/progress')) return json(404, { error: 'not_found' })
    if (u.startsWith('/api/me/route/')) return json(200, {})
    if (u.startsWith('/api/feedback/video')) return Promise.resolve(new Response(null, { status: 204 }))
    return Promise.reject(new Error('no net'))
  }))
})
afterEach(() => { marker('flib-route', false); marker('flib-cabinet', false); vi.unstubAllGlobals(); __resetRouteOutboxForTests(); __resetSessionForTests() })

function mount(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes><Route path="/player" element={<PlayerPage />} /></Routes>
    </MemoryRouter>,
  )
}
const routeOn = () => { marker('flib-route', true); marker('flib-cabinet', true); __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_abcd', routeAllowed: true }) }

describe('плеер v2: режим маршрута — название и оценка под видео', () => {
  it('блок под видео: название, метки, «Нравится / Не нравится» — вне слоя поверх видео', async () => {
    routeOn()
    mount(`/player?v=${V}&rp=${encodeURIComponent(RP)}`)
    const info = await screen.findByTestId('route-clip-info')
    await waitFor(() => expect(info.querySelector('h2')?.textContent).toBe('How to order coffee'))
    expect(info.querySelector('.tags')?.textContent).toBe('YouTubeDaily English2 мин')
    expect(info.closest('.overlay')).toBeNull()
    const vote = within(info).getByTestId('video-vote-bar')
    expect(vote.className).toContain('vvb-inline')
    expect(within(vote).getByRole('button', { name: 'Понравилось' })).toBeTruthy()
    expect(within(vote).getByRole('button', { name: 'Не понравилось' })).toBeTruthy()
    // Оценка одна: поверх видео её больше нет.
    expect(screen.getAllByTestId('video-vote-bar')).toHaveLength(1)
    // «Шаг N из M» в режиме маршрута по-прежнему нет.
    expect(document.body.textContent ?? '').not.toMatch(/Шаг\s*\d+\s*из/)
  })

  // Ревью v2a M-1: внутри .fs-root блок становился вторым участником колонки — панель
  // управления (оверлей у низа .fs-root на телефоне) ложилась на название, а не на
  // видео. Блок — после .fs-root.
  // Ревью v2a R1-M1: на компьютере блок — сразу под видео (как в макете), внутри .fs-root
  // перед панелью таймлайна; на сенсорном экране (M-1) — после .fs-root.
  it('компьютер: блок сразу под видео — внутри .fs-root, перед панелью таймлайна', async () => {
    routeOn()
    mount(`/player?v=${V}&rp=${encodeURIComponent(RP)}`)
    const info = await screen.findByTestId('route-clip-info')
    const fs = screen.getByTestId('fs-root')
    expect(fs.contains(info)).toBe(true)
    const stage = fs.querySelector('.player-stage') as HTMLElement
    expect(stage.compareDocumentPosition(info) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const ws = fs.querySelector('[data-testid=workspace-panel], .workspace-lift, .timeline-reopen') as HTMLElement | null
    if (ws) expect(info.compareDocumentPosition(ws) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('сенсорный экран, портрет: блок после контейнера видео (.fs-root), не внутри', async () => {
    const mm = (q: string) => ({ matches: /coarse/.test(q) && !/landscape/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })
    vi.stubGlobal('matchMedia', vi.fn(mm))
    routeOn()
    mount(`/player?v=${V}&rp=${encodeURIComponent(RP)}`)
    const info = await screen.findByTestId('route-clip-info')
    const fs = screen.getByTestId('fs-root')
    expect(fs.contains(info)).toBe(false)
    expect(fs.compareDocumentPosition(info) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  // Ревью v2a H-3: в полноэкранном режиме оценка и «Не нравится → заменить» доступны —
  // поверх видео, как было до v2a.
  it('полноэкранный режим (псевдо, iOS) — оценка поверх видео, блока под видео нет', async () => {
    routeOn()
    mount(`/player?v=${V}&rp=${encodeURIComponent(RP)}`)
    await screen.findByTestId('route-clip-info')
    await waitFor(() => expect(h.adapter).toBeTruthy())
    fireEvent.click(await screen.findByTestId('cb-fs-btn'))
    await waitFor(() => expect(screen.getByTestId('fs-root').className).toContain('fs-pseudo'))
    expect(screen.queryByTestId('route-clip-info')).toBeNull()
    const vote = screen.getByTestId('video-vote-bar')
    expect(vote.className).not.toContain('vvb-inline')
    expect(screen.getByTestId('fs-root').contains(vote)).toBe(true)
    expect(within(vote).getByRole('button', { name: 'Не понравилось' })).toBeTruthy()
    // Выход — блок под видео возвращается.
    fireEvent.click(screen.getByTestId('cb-fs-btn'))
    await screen.findByTestId('route-clip-info')
  })

  // Ревью v2a M-1: телефон боком — блок под видео отнимал треть высоты видео; там
  // оценка поверх видео.
  it('сенсорный экран в альбомной ориентации — оценка поверх видео, блока нет', async () => {
    const mm = (q: string) => ({ matches: /coarse/.test(q) && (/landscape/.test(q) || !/orientation/.test(q)), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })
    vi.stubGlobal('matchMedia', vi.fn(mm))
    routeOn()
    mount(`/player?v=${V}&rp=${encodeURIComponent(RP)}`)
    const vote = await screen.findByTestId('video-vote-bar')
    expect(screen.queryByTestId('route-clip-info')).toBeNull()
    expect(vote.className).not.toContain('vvb-inline')
  })
})

describe('плеер v2: узкая верхняя строка', () => {
  // Ревью v2a M-3: с ☰ на 360 px «Масштаб видео» уезжал за край. Подпись ссылки
  // маршрута на узком экране прячется (CSS), имя ссылки — в aria-label.
  it('ссылки «Мой маршрут» / «К маршруту» — подпись в .vtb-label, имя в aria-label', async () => {
    mount(`/player?v=${V}`)
    const my = await screen.findByTestId('my-route-link')
    expect(my.getAttribute('aria-label')).toBe('Мой маршрут')
    expect(my.querySelector('.vtb-label')?.textContent).toBe('Мой маршрут')
  })
  it('в маршруте — «← К маршруту»: стрелка остаётся, подпись в .vtb-label', async () => {
    routeOn()
    mount(`/player?v=${V}&rp=${encodeURIComponent(RP)}`)
    const back = await screen.findByTestId('back-to-route-link')
    expect(back.getAttribute('aria-label')).toBe('К маршруту')
    expect(back.querySelector('.vtb-label')?.textContent?.trim()).toBe('К маршруту')
    expect(back.textContent).toBe('← К маршруту')
  })
})

describe('плеер v2: гостевой режим', () => {
  it('без маршрута — блока под видео нет, оценка поверх видео, как раньше', async () => {
    mount(`/player?v=${V}`)
    const vote = await screen.findByTestId('video-vote-bar')
    expect(screen.queryByTestId('route-clip-info')).toBeNull()
    expect(vote.className).not.toContain('vvb-inline')
  })
})

describe('плеер v2: ☰ открывает меню на телефоне', () => {
  it('☰ в верхней строке — меню с классом open и затемнение; затемнение закрывает', async () => {
    mount(`/player?v=${V}`)
    const burger = await screen.findByTestId('rail-burger')
    expect(screen.getByTestId('video-topbar').contains(burger)).toBe(true)
    expect(burger.getAttribute('aria-label')).toBe('Меню')
    expect(screen.getByTestId('left-rail').className).not.toContain('open')
    fireEvent.click(burger)
    expect(screen.getByTestId('left-rail').className).toContain('open')
    await act(async () => { fireEvent.click(document.querySelector('.pl-scrim') as HTMLElement) })
    expect(screen.getByTestId('left-rail').className).not.toContain('open')
  })
})
