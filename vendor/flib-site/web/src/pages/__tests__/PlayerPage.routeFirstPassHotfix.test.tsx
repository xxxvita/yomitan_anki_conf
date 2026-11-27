// PlayerPage.routeFirstPassHotfix.test.tsx — живая проверка на проде 2026-11-19
// (маршрут кабинета включён), первый проход ролика маршрута (спека §4.7):
//   D1 — предупреждение «На первом просмотре субтитры мешают учиться слушать»
//        оставалось поверх карточки конца ролика;
//   D2 — дорожка SUB таймлайна печатала английский текст реплик открыто, пока
//        субтитры скрыты/размыты гейтом (§4.7 п.1–2, п.4: текст не виден до
//        согласия и открывается только нажатием по слову);
//   D3 — «[Music]» размывалось как слово и рождало subtitles_shown {music}.
// Гость, выключенный маршрут и просмотренный ролик — плеер прежний.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, act, waitFor, screen } from '@testing-library/react'
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
import { __resetRouteOutboxForTests, getRouteOutbox } from '../../site/cabinet/route/outbox'
import { __forgetSubsWarningsForTests, isSubsWarningAcked } from '../../player/route-events/subs-gate'
import { __resetClipListenedForTests } from '../../player/route-events/clip-listened'

const V = 'abc123XYZ_1'
const RP = `youtube::${V}`
const ROUTE = '11111111-1111-4111-8111-111111111111'
const mkState = (played = false) => ({
  started: true, route_id: ROUTE, revision: 4, snapshot_date: '2026-11-18', started_at: null, goal_label: 'g',
  params: { daily_listening_budget_min: 20, daily_new_words: 15 },
  day: { date: '2026-11-18', clips: [{ puzzle_id: RP, kind: 'youtube', video_id: V, title: 'T', delivered: true, played, queued_played: false, new_words: 0, words: [] }, { delivered: false, new_words: 0 }] },
  next_clip: { title: 'Next clip title' }, current_puzzle_id: RP, replace_available: true, stop_reason: null, active_exchange: null,
})

function marker(on: boolean) {
  document.head.querySelectorAll('meta[name="flib-route"]').forEach(m => m.remove())
  if (!on) return
  const m = document.createElement('meta'); m.setAttribute('name', 'flib-route'); m.setAttribute('content', '1'); document.head.appendChild(m)
}

let played = false
let sent: Array<{ events: Array<Record<string, any>> }> = []
const json = (st: number, b: unknown) => Promise.resolve(new Response(JSON.stringify(b), { status: st, headers: { 'Content-Type': 'application/json' } }))

beforeEach(() => {
  __resetSessionForTests(); __resetRouteStateForTests(); __resetRouteOutboxForTests(); __forgetSubsWarningsForTests(); __resetClipListenedForTests()
  localStorage.clear(); localStorage.setItem('flib:subMode', 'l2')
  // Длинная реплика: блок на таймлайне шире 3 % окна — текст в нём печатается.
  h.cues = [{ start: 0, end: 60, text_en: '[Music] Teresa go home', text_ru: 'Тереза иди домой' }]
  h.adapter = null
  played = false
  sent = []
  vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit = {}) => {
    const u = String(url)
    const body = typeof init.body === 'string' ? (() => { try { return JSON.parse(init.body as string) } catch { return init.body } })() : null
    if (u.startsWith('/api/me/route/state')) return json(200, mkState(played))
    if (u === '/api/me/route/events') { sent.push(body); return json(200, { accepted: body.events.length, duplicates: 0, rejected: [], evicted_external: 0 }) }
    if (u.startsWith('/api/me/route/')) return json(404, { error: 'not_found' })
    return Promise.reject(new Error('no net'))
  }))
})
afterEach(() => { marker(false); vi.unstubAllGlobals(); __resetRouteOutboxForTests(); __resetSessionForTests() })

function mount(q: string) {
  return render(
    <MemoryRouter initialEntries={[`/player?${q}`]}>
      <Routes><Route path="/player" element={<PlayerPage />} /></Routes>
    </MemoryRouter>,
  )
}
const pause = (ms: number) => act(async () => { await new Promise(r => setTimeout(r, ms)) })
const routeOn = () => { marker(true); __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_abcd', routeAllowed: true }) }
const timeline = () => document.querySelector('[data-timeline-clip]') as HTMLElement | null
async function ready() {
  await waitFor(() => expect(h.adapter).toBeTruthy())
  await pause(60)
}
const toEnd = async () => { act(() => { h.adapter._setTime(119.8); h.adapter._emit('state', 'ended') }); await pause(300) }
const leaveEnd = async () => { act(() => { h.adapter._setTime(10); h.adapter._emit('state', 'playing') }); await pause(400) }

describe('D1 — предупреждение первого прохода не остаётся поверх карточки конца ролика', () => {
  it('карточка конца ролика убирает предупреждение; «Смотреть снова» его не возвращает', async () => {
    routeOn()
    mount(`v=${V}&rp=${encodeURIComponent(RP)}`)
    await ready()
    fireEvent.click(screen.getByTestId('sub-mode-en'))
    expect(screen.getByTestId('subs-first-pass-warning')).toBeTruthy()
    act(() => { h.adapter._setTime(119.8); h.adapter._emit('state', 'ended') })
    await pause(300)
    await screen.findByTestId('route-end-card')
    expect(screen.queryByTestId('subs-first-pass-warning')).toBeNull()
  })

  // Ревью M-2: заголовок выше обещает больше, чем проверял тест.
  it('закрытие карточкой — как «Хорошо»: согласия нет, событий нет, режим не сохранён; после выхода из конца не возвращается — и так КАЖДЫЙ раз', async () => {
    routeOn()
    mount(`v=${V}&rp=${encodeURIComponent(RP)}`)
    await ready()
    for (let round = 0; round < 2; round++) {
      fireEvent.click(screen.getByTestId('sub-mode-en'))
      expect(screen.getByTestId('subs-first-pass-warning')).toBeTruthy()
      await toEnd()
      await screen.findByTestId('route-end-card')
      expect(screen.queryByTestId('subs-first-pass-warning')).toBeNull()
      expect(isSubsWarningAcked(RP)).toBe(false)
      await leaveEnd()
      expect(screen.queryByTestId('route-end-card')).toBeNull()
      expect(screen.queryByTestId('subs-first-pass-warning')).toBeNull()
      expect(screen.queryByTestId('subtitle-overlay')).toBeNull()
      expect(isSubsWarningAcked(RP)).toBe(false)
    }
    await act(async () => { await getRouteOutbox().flush({ timeoutMs: 3000 }) })
    expect(sent.flatMap(b => b.events).map(e => e.type)).not.toContain('subtitles_shown')
    expect(localStorage.getItem('flib:subMode')).toBe('l2')
  })

  // Ревью L-1: нажатие на режим, пока на экране карточка конца, не всплывает
  // предупреждением позже, когда человек уходит из конца ролика.
  it('нажатие на режим во время карточки конца не всплывает предупреждением после выхода из конца', async () => {
    routeOn()
    mount(`v=${V}&rp=${encodeURIComponent(RP)}`)
    await ready()
    await toEnd()
    await screen.findByTestId('route-end-card')
    fireEvent.click(screen.getByTestId('sub-mode-en'))
    expect(screen.queryByTestId('subs-first-pass-warning')).toBeNull()
    await leaveEnd()
    expect(screen.queryByTestId('route-end-card')).toBeNull()
    expect(screen.queryByTestId('subs-first-pass-warning')).toBeNull()
  })
})

// Прод 2026-11-19 (ревью M-1): на первом проходе панель «Субтитры» (⚙) печатала
// весь английский текст, синхронно с видео, а поиск — найденные строки.
describe('M-1 — панель «Субтитры» не раскрывает текст на первом проходе', () => {
  const panel = () => screen.getByTestId('cue-list')
  const search = () => screen.getByTestId('search-input') as HTMLInputElement

  it('маршрут, первый проход: строки — только время, поиск выключен', async () => {
    routeOn()
    mount(`v=${V}&rp=${encodeURIComponent(RP)}`)
    await ready()
    expect(panel().textContent).not.toContain('Teresa')
    expect(panel().textContent).toContain('0:00')
    expect(search().disabled).toBe(true)
    // и после согласия (размытая плашка) — тоже
    fireEvent.click(screen.getByTestId('sub-mode-en'))
    fireEvent.click(screen.getByTestId('subs-warning-show'))
    await waitFor(() => expect(screen.queryByTestId('subtitle-overlay')).toBeTruthy())
    expect(panel().textContent).not.toContain('Teresa')
    expect(search().disabled).toBe(true)
  })

  it('ролик уже засчитан (played) и гость — панель и поиск как раньше', async () => {
    routeOn(); played = true
    const first = mount(`v=${V}&rp=${encodeURIComponent(RP)}`)
    await ready()
    await waitFor(() => expect(panel().textContent).toContain('Teresa'))
    expect(search().disabled).toBe(false)
    first.unmount(); h.adapter = null
    marker(false)
    mount(`v=${V}`)
    await ready()
    expect(panel().textContent).toContain('Teresa')
    expect(search().disabled).toBe(false)
  })
})

describe('D2 — дорожка SUB таймлайна не раскрывает текст на первом проходе', () => {
  it('маршрут, первый проход: метки реплик есть, текста нет — до и после согласия', async () => {
    routeOn()
    mount(`v=${V}&rp=${encodeURIComponent(RP)}`)
    await ready()
    const tl = timeline()
    expect(tl).toBeTruthy()
    expect(tl!.querySelectorAll('[data-cue]').length).toBe(1)
    expect(tl!.textContent).not.toContain('Teresa')
    fireEvent.click(screen.getByTestId('sub-mode-en'))
    fireEvent.click(screen.getByTestId('subs-warning-show'))
    await waitFor(() => expect(screen.queryByTestId('subtitle-overlay')).toBeTruthy())
    expect(timeline()!.querySelectorAll('[data-cue]').length).toBe(1)
    expect(timeline()!.textContent).not.toContain('Teresa')
  })

  it('ролик уже засчитан (played) — таймлайн печатает текст, как раньше', async () => {
    routeOn(); played = true
    mount(`v=${V}&rp=${encodeURIComponent(RP)}`)
    await ready()
    await waitFor(() => expect(timeline()!.textContent).toContain('Teresa'))
  })

  it('гость (без rp) и выключенный маршрут — таймлайн печатает текст, как раньше', async () => {
    for (const on of [true, false]) {
      marker(on)
      const q = on ? `v=${V}` : `v=${V}&rp=${encodeURIComponent(RP)}`
      const { unmount } = mount(q)
      await ready()
      expect(timeline()!.textContent).toContain('Teresa')
      unmount(); h.adapter = null
    }
  })
})

describe('D3 — звуковая метка «[Music]» на первом проходе не слово', () => {
  it('не размыта, нажатие не рождает subtitles_shown; ПКМ по строке сообщает только слова речи', async () => {
    routeOn()
    const { container } = mount(`v=${V}&rp=${encodeURIComponent(RP)}`)
    await ready()
    fireEvent.click(screen.getByTestId('sub-mode-en'))
    fireEvent.click(screen.getByTestId('subs-warning-show'))
    await waitFor(() => expect(screen.queryByTestId('subtitle-overlay')).toBeTruthy())
    const plate = screen.getByTestId('subtitle-overlay')
    const music = Array.from(plate.querySelectorAll('.sub-word')).find(e => e.textContent?.includes('[Music]')) as HTMLElement
    expect(music).toBeTruthy()
    expect(music.classList.contains('sub-word--blur')).toBe(false)
    fireEvent.click(music)
    expect(container.querySelectorAll('.sub-word--blur').length).toBe(3)
    fireEvent.contextMenu(plate)
    await act(async () => { await getRouteOutbox().flush({ timeoutMs: 3000 }) })
    const shown = sent.flatMap(b => b.events).filter(e => e.type === 'subtitles_shown').map(e => e.lemmas as string[])
    expect(shown.flat()).not.toContain('music')
    expect(shown.flat()).toEqual(expect.arrayContaining(['teresa', 'go', 'home']))
  })
})
