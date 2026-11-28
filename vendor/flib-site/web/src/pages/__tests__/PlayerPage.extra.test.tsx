// PlayerPage.extra.test.tsx — плеер в режиме `extra` (дополнительное видео,
// спека extra-video §9, §10): `?rx=<puzzle_id>` при метке маршрута и строке в `extras`.
// Гейт первого прохода как у дневного ролика; снимает его только собственная отметка
// `flib:route-extra-listened` на пару `route_id|puzzle_id` (§9), а не `route-listened` и не `played`;
// оценки нет; название под видео; карточка конца без «Следующий ролик»; прогресс не читается.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, waitFor, act, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

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
import { __forgetSubsWarningsForTests } from '../../player/route-events/subs-gate'
import { __resetClipListenedForTests, __resetExtraListenedForTests, markExtraListened } from '../../player/route-events/clip-listened'
import { __resetRouteOutboxForTests, getRouteOutbox } from '../../site/cabinet/route/outbox'

const V = 'extraVid_01'
const RX = `youtube::${V}`
const DAY = 'youtube::dayVideo001'
const ROUTE = '11111111-1111-4111-8111-111111111111'
const OTHER_ROUTE = '22222222-2222-4222-8222-222222222222'

function setRouteMarker(on: boolean): void {
  document.head.querySelectorAll('meta[name="flib-route"]').forEach(m => m.remove())
  if (!on) return
  const m = document.createElement('meta')
  m.setAttribute('name', 'flib-route'); m.setAttribute('content', '1')
  document.head.appendChild(m)
}

function state(played = false) {
  return {
    started: true, route_id: ROUTE, revision: 4, snapshot_date: '2026-11-18', started_at: null,
    goal_label: 'g', params: { daily_listening_budget_min: 20, daily_new_words: 15 },
    day: { date: '2026-11-18', clips: [{ puzzle_id: DAY, kind: 'youtube', video_id: 'dayVideo001', delivered: true, played: false, queued_played: false, new_words: 1, words: [] }] },
    next_clip: { title: 'Next clip title' }, current_puzzle_id: DAY, replace_available: false, stop_reason: null, active_exchange: null,
    extras: [{ puzzle_id: RX, kind: 'youtube', video_id: V, title: 'Extra title', series_title: 'Extra series', source: 'Extra source', duration_sec: 600, played }],
    extra_available: true,
  }
}

let calls: string[] = []
let posted: any[] = []
let routeState: () => Promise<Response>
const json = (b: unknown) => Promise.resolve(new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } }))

function mount(q: string) {
  return render(<MemoryRouter initialEntries={[`/player?${q}`]}><PlayerPage /></MemoryRouter>)
}
const pause = (ms: number) => act(async () => { await new Promise(r => setTimeout(r, ms)) })
const routeOn = () => { setRouteMarker(true); __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_abcd', routeAllowed: true }) }
const q = () => `v=${V}&back=route&rx=${encodeURIComponent(RX)}`

beforeEach(() => {
  __resetSessionForTests(); __resetRouteStateForTests(); __forgetSubsWarningsForTests(); __resetClipListenedForTests(); __resetExtraListenedForTests(); __resetRouteOutboxForTests()
  localStorage.clear()
  localStorage.setItem('flib:subMode', 'l2l1')
  h.cues = [{ start: 0, end: 2, text_en: 'Hello brave world', text_ru: 'Привет смелый мир' }]
  h.adapter = null
  calls = []
  posted = []
  routeState = () => json(state())
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    const u = String(url)
    calls.push(u)
    if (u === '/api/me/route/events') { try { posted.push(...JSON.parse(String(init?.body)).events) } catch { /* не JSON */ } }
    if (u.startsWith('/api/me/route/state')) return routeState()
    if (u === '/api/me/route/events') return json({ accepted: 0, duplicates: 0, rejected: [], evicted_external: 0 })
    return Promise.reject(new Error('no net'))
  }))
})
afterEach(() => { setRouteMarker(false); vi.unstubAllGlobals(); __resetRouteOutboxForTests(); __resetSessionForTests() })

describe('PlayerPage — режим extra', () => {
  it('гейт: субтитры скрыты и в pending, и в extra; «Всё равно показать» — размытие, русского нет', async () => {
    routeOn()
    let release: (r: Response) => void = () => {}
    routeState = () => new Promise<Response>(res => { release = res })
    const { container, getByTestId, queryByTestId } = mount(q())
    await pause(20)
    expect(queryByTestId('subtitle-overlay')).toBeNull() // pending
    expect(container.textContent).not.toContain('Привет')
    await act(async () => { release(new Response(JSON.stringify(state()), { status: 200, headers: { 'Content-Type': 'application/json' } })); await new Promise(r => setTimeout(r, 30)) })
    expect(queryByTestId('subtitle-overlay')).toBeNull() // extra
    expect(localStorage.getItem('flib:subMode')).toBe('l2l1')
    fireEvent.click(getByTestId('sub-mode-enru'))
    expect(getByTestId('subs-first-pass-warning')).toBeTruthy()
    fireEvent.click(getByTestId('subs-warning-show'))
    await waitFor(() => expect(queryByTestId('subtitle-overlay')).toBeTruthy())
    expect(container.querySelectorAll('.sub-word--blur').length).toBe(3)
    expect(container.textContent).not.toContain('Привет')
    expect(queryByTestId('subtitle-l1-overlay')).toBeNull()
    // список реплик, поиск, ПКМ-меню перевода, капсула, пилюля, панель таймлайна — без русского
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

  it('отметка flib:route-listened того же ролика гейт НЕ снимает — ни в extra, ни пока pending(extra)', async () => {
    routeOn()
    localStorage.setItem('flib:route-listened', JSON.stringify([RX]))
    routeState = () => new Promise<Response>(() => {})
    const a = mount(q())
    await pause(50)
    expect(a.queryByTestId('subtitle-overlay')).toBeNull() // pending(extra)
    expect(a.container.textContent).not.toContain('Привет')
    a.unmount()
    routeState = () => json(state())
    const b = mount(q())
    await b.findByTestId('route-clip-info')
    await pause(50)
    expect(b.queryByTestId('subtitle-overlay')).toBeNull() // extra
    expect(b.container.textContent).not.toContain('Привет')
  })

  it('row.played:true гейт НЕ снимает (played в режиме extra всегда false)', async () => {
    routeOn()
    routeState = () => json(state(true))
    const { queryByTestId, container } = mount(q())
    await screen.findByTestId('route-clip-info')
    await pause(50)
    expect(queryByTestId('subtitle-overlay')).toBeNull()
    expect(container.textContent).not.toContain('Привет')
  })

  it('своя отметка flib:route-extra-listened снимает гейт: после повторного открытия', async () => {
    routeOn()
    localStorage.setItem('flib:route-extra-listened', JSON.stringify([`${ROUTE}|${RX}`]))
    const { queryByTestId, container } = mount(q())
    await waitFor(() => expect(queryByTestId('subtitle-overlay')).toBeTruthy())
    expect(container.querySelectorAll('.sub-word--blur').length).toBe(0)
    expect(container.textContent).toContain('Привет')
  })

  it('своя отметка снимает гейт и вживую, в открытой сессии', async () => {
    routeOn()
    const { queryByTestId } = mount(q())
    await screen.findByTestId('route-clip-info')
    await pause(30)
    expect(queryByTestId('subtitle-overlay')).toBeNull()
    act(() => { markExtraListened(ROUTE, RX) })
    await waitFor(() => expect(queryByTestId('subtitle-overlay')).toBeTruthy())
  })

  it('отметка ДРУГОГО маршрута гейт не снимает; старый формат (голый puzzle_id) — тоже', async () => {
    routeOn()
    localStorage.setItem('flib:route-extra-listened', JSON.stringify([RX, `${OTHER_ROUTE}|${RX}`]))
    const { queryByTestId, container } = mount(q())
    await screen.findByTestId('route-clip-info')
    await pause(60)
    expect(queryByTestId('subtitle-overlay')).toBeNull()
    expect(container.textContent).not.toContain('Привет')
  })

  const sentEvents = async () => { await act(async () => { await getRouteOutbox().flush({ timeoutMs: 3000 }) }); return posted }
  const watchToEnd = async () => {
    await waitFor(() => expect(h.adapter).toBeTruthy())
    await pause(60)
    act(() => { h.adapter._setTime(119.8); h.adapter._emit('state', 'ended') })
    await pause(400)
  }

  it('пересмотр полностью прослушанного: субтитры открыты, ни одного события не уходит', async () => {
    routeOn()
    localStorage.setItem('flib:route-extra-listened', JSON.stringify([`${ROUTE}|${RX}`]))
    routeState = () => json(state(true))
    const { queryByTestId, unmount } = mount(q())
    await waitFor(() => expect(queryByTestId('subtitle-overlay')).toBeTruthy())
    await watchToEnd()
    unmount()
    expect(await sentEvents()).toEqual([])
  })

  it('отметка другого маршрута: гейт включён, отчёт с origin уходит', async () => {
    routeOn()
    localStorage.setItem('flib:route-extra-listened', JSON.stringify([`${OTHER_ROUTE}|${RX}`]))
    const { queryByTestId, unmount } = mount(q())
    await screen.findByTestId('route-clip-info')
    expect(queryByTestId('subtitle-overlay')).toBeNull()
    await watchToEnd()
    unmount()
    const ev = await sentEvents()
    expect(ev.filter(e => e.type === 'clip_played').length).toBe(1)
    for (const e of ev) expect(e.origin).toBe('more')
  })

  it('пересмотр после частичного просмотра (отметки нет): гейт включён, отчёт уходит', async () => {
    routeOn()
    const { queryByTestId, unmount } = mount(q())
    await screen.findByTestId('route-clip-info')
    expect(queryByTestId('subtitle-overlay')).toBeNull()
    await waitFor(() => expect(h.adapter).toBeTruthy())
    await pause(60)
    act(() => { h.adapter._setTime(30) })
    await pause(300)
    unmount()
    const ev = await sentEvents()
    expect(ev.filter(e => e.type === 'clip_played').length).toBe(1)
    for (const e of ev) expect(e.origin).toBe('more')
  })

  it('дневной ролик (rp) не читает отметку extra', async () => {
    routeOn()
    markExtraListened(ROUTE, DAY)
    const { queryByTestId, container } = mount(`v=dayVideo001&rp=${encodeURIComponent(DAY)}`)
    await pause(50)
    expect(queryByTestId('subtitle-overlay')).toBeNull()
    expect(container.textContent).not.toContain('Привет')
  })

  it('оценки нет: ни под видео, ни при неподтверждённом rx; в полноэкранном/боковом виде — тоже', async () => {
    routeOn()
    routeState = () => new Promise<Response>(() => {})
    const a = mount(q())
    await pause(20)
    expect(a.queryByTestId('video-vote-bar')).toBeNull() // pending
    a.unmount()
    routeState = () => json(state())
    const b = mount(q())
    await waitFor(() => expect(b.queryByTestId('route-clip-info')).toBeTruthy())
    expect(b.queryByTestId('video-vote-bar')).toBeNull() // inline
    b.unmount()
    const mm = (s: string) => ({ matches: /coarse/.test(s) && (/landscape/.test(s) || !/orientation/.test(s)), media: s, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })
    vi.stubGlobal('matchMedia', vi.fn(mm))
    const c = mount(q())
    await pause(60)
    expect(c.queryByTestId('route-clip-info')).toBeNull()
    expect(c.queryByTestId('video-vote-bar')).toBeNull() // поверх видео
    c.unmount()
    vi.unstubAllGlobals()
    vi.stubGlobal('fetch', vi.fn((u: string) => (String(u).startsWith('/api/me/route/state') ? json(state()) : Promise.reject(new Error('no net')))))
    const d = mount(q())
    await d.findByTestId('route-clip-info')
    await waitFor(() => expect(h.adapter).toBeTruthy())
    fireEvent.click(await d.findByTestId('cb-fs-btn'))
    await waitFor(() => expect(d.getByTestId('fs-root').className).toContain('fs-pseudo'))
    expect(d.queryByTestId('route-clip-info')).toBeNull()
    expect(d.queryByTestId('video-vote-bar')).toBeNull() // полноэкранный режим
    d.unmount()
  })

  it('rp сильнее rx: ролик в плане дня при ?rp=&rx= — обычный дневной режим, оценка на месте', async () => {
    routeOn()
    routeState = () => {
      const st = state()
      st.day.clips = [{ ...st.day.clips[0], puzzle_id: RX, video_id: V }] as never
      st.current_puzzle_id = RX
      return json(st)
    }
    const { findByTestId, queryByTestId } = mount(`${q()}&rp=${encodeURIComponent(RX)}`)
    await findByTestId('route-clip-info')
    await waitFor(() => expect(queryByTestId('video-vote-bar')).toBeTruthy())
  })

  it('под видео — название и метки строки extras', async () => {
    routeOn()
    mount(q())
    const info = await screen.findByTestId('route-clip-info')
    expect(within(info).getByText('Extra title')).toBeTruthy()
    expect(within(info).getByText('Extra source')).toBeTruthy()
    expect(within(info).getByText('Extra series')).toBeTruthy()
    expect(within(info).getByText('10 мин')).toBeTruthy()
  })

  it('конец ролика: «Посмотреть заново» и «К маршруту», без «Следующий ролик»', async () => {
    routeOn()
    mount(q())
    await waitFor(() => expect(calls.some(c => c.startsWith('/api/me/route/state'))).toBe(true))
    await waitFor(() => expect(h.adapter).toBeTruthy())
    await pause(60)
    act(() => { h.adapter._setTime(119.8); h.adapter._emit('state', 'ended') })
    await pause(300)
    const card = await screen.findByTestId('route-end-card')
    expect(within(card).getByRole('button', { name: 'Посмотреть заново' })).toBeTruthy()
    expect(within(card).getByRole('link', { name: /К маршруту/ })).toBeTruthy()
    expect(within(card).queryByRole('button', { name: /Следующий ролик/ })).toBeNull()
    expect(card.textContent).not.toContain('Next clip title')
    expect(screen.queryByTestId('route-resume')).toBeNull()
  })

  it('запросов прогресса нет вовсе', async () => {
    routeOn()
    mount(q())
    await screen.findByTestId('route-clip-info')
    await pause(100)
    expect(calls.some(c => c.includes('/api/me/route/progress'))).toBe(false)
  })
})
