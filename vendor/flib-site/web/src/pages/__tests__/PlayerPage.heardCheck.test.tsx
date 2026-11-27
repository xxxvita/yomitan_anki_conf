// PlayerPage.heardCheck.test.tsx — «Тест после ролика» на карточке конца ролика.
// (шапка harness — из PlayerPage.routeEndCard.test.tsx)
//
// «← К маршруту», нет «Шаг N из M», карточка конца ролика (три варианта по
// состоянию, уже полученному для гейта rp), «Посмотреть заново» без перезагрузки,
// VideoVoteBar при rp и rc со строкой причин и заменой, гость — как раньше.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, act, waitFor, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

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
import { HEARD_SENT_KEY, noteHeardCheckSent, resetHeardCheckMemory } from '../../site/cabinet/route/heard-check/heard-check-memory'
import { __resetHeardCheckFlowForTests } from '../../site/cabinet/route/heard-check/heard-check-flow'
import { abandonHeardCheck } from '../../site/cabinet/route/heard-check/heard-check-store'
import { markClipListened, __resetClipListenedForTests } from '../../player/route-events/clip-listened'

const V = 'abc123XYZ_1'
const RP = `youtube::${V}`
const ROUTE = '11111111-1111-4111-8111-111111111111'
const row = (pid: string, v: string, over: Record<string, unknown> = {}) => ({ puzzle_id: pid, kind: 'youtube', video_id: v, title: 'T ' + v, delivered: true, played: false, queued_played: false, new_words: 0, words: [], ...over })
const mkState = (over: Record<string, unknown> = {}) => ({
  started: true, route_id: ROUTE, revision: 4, snapshot_date: '2026-11-18', started_at: null, goal_label: 'g',
  params: { daily_listening_budget_min: 20, daily_new_words: 15 },
  day: { date: '2026-11-18', clips: [row(RP, V), { delivered: false, new_words: 0 }] },
  next_clip: { title: 'Next clip title' }, current_puzzle_id: RP, replace_available: true, stop_reason: null, active_exchange: null,
  heard_check_questions: [{ id: `hc:2026-11-18:${RP}`, kind: 'heard_check', puzzle_id: RP, words: ['alpha', 'beta', 'gamma'] }],
  ...over,
})

function marker(on: boolean) {
  document.head.querySelectorAll('meta[name="flib-route"]').forEach(m => m.remove())
  if (!on) return
  const m = document.createElement('meta'); m.setAttribute('name', 'flib-route'); m.setAttribute('content', '1'); document.head.appendChild(m)
}

function Loc() { const l = useLocation(); return <div data-testid="location">{l.pathname + l.search}</div> }

let stateNow: unknown
let afterCommit: unknown = null
let calls: Array<{ url: string; method: string; body: any; at: number }> = []
let seq = 0
const json = (st: number, b: unknown) => Promise.resolve(new Response(JSON.stringify(b), { status: st, headers: { 'Content-Type': 'application/json' } }))

beforeEach(() => {
  __resetSessionForTests(); __resetRouteStateForTests(); __resetRouteOutboxForTests()
  localStorage.clear(); resetHeardCheckMemory(); __resetClipListenedForTests(); markClipListened(RP); __resetHeardCheckFlowForTests(); abandonHeardCheck(); localStorage.setItem('flib:subMode', 'l2')
  h.cues = [{ start: 0, end: 2, text_en: 'Hello brave world', text_ru: 'Привет' }]
  h.adapter = null
  stateNow = mkState(); afterCommit = null; calls = []; seq = 0
  vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit = {}) => {
    const u = String(url)
    const method = (init.method ?? 'GET').toUpperCase()
    const body = typeof init.body === 'string' ? (() => { try { return JSON.parse(init.body as string) } catch { return init.body } })() : null
    calls.push({ url: u, method, body, at: ++seq })
    if (u.startsWith('/api/me/route/state')) return json(200, stateNow)
    if (u === '/api/me/route/events') return json(200, { accepted: body.events.length, duplicates: 0, rejected: [], evicted_external: 0 })
    if (u === '/api/me/route/exchange') return json(202, { job_id: '33333333-3333-4333-8333-333333333333', base_revision: 4 })
    if (u.startsWith('/api/me/route/jobs/')) { if (afterCommit) { stateNow = afterCommit; afterCommit = null } return json(200, { status: 'done', committed: true, committed_revision: 5, cancel_reason: null, error_code: null }) }
    if (u.startsWith('/api/feedback/video')) return Promise.resolve(new Response(null, { status: 204 }))
    if (u.startsWith('/api/me/route/')) return json(404, { error: 'not_found' })
    return Promise.reject(new Error('no net'))
  }))
})
afterEach(() => { marker(false); vi.unstubAllGlobals(); __resetRouteOutboxForTests(); __resetSessionForTests() })

function mount(q: string) {
  return render(
    <MemoryRouter initialEntries={[`/player?${q}`]}>
      <Routes>
        <Route path="/player" element={<PlayerPage />} />
        <Route path="*" element={<div data-testid="elsewhere" />} />
      </Routes>
      <Loc />
    </MemoryRouter>,
  )
}
const pause = (ms: number) => act(async () => { await new Promise(r => setTimeout(r, ms)) })
async function ended() {
  await waitFor(() => expect(h.adapter).toBeTruthy())
  await pause(30)
  act(() => { h.adapter._setTime(119.8); h.adapter._emit('state', 'ended') })
  await pause(300)
}
const routeOn = () => { marker(true); __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_abcd', routeAllowed: true }) }


const answered = () => calls.filter(c => c.url === '/api/me/route/events').flatMap(c => c.body.events.map((e: any) => ({ e, at: c.at }))).filter(x => x.e.type === 'question_answered')
const click = (name: RegExp) => fireEvent.click(within(screen.getByTestId('route-end-card')).getByRole('button', { name }))

describe('тест после ролика на карточке конца', () => {
  it('«Следующий ролик» → тест ДО перехода; пауза; «Готово» → событие выгружено раньше навигации', async () => {
    routeOn()
    mount(`v=${V}&rp=${encodeURIComponent(RP)}`)
    await waitFor(() => expect(calls.some(c => c.url.startsWith('/api/me/route/state'))).toBe(true))
    await ended()
    await screen.findByTestId('route-end-card')
    const spy = vi.fn(); h.adapter._spy = spy
    click(/Следующий ролик/)
    const dlg = await screen.findByRole('dialog')
    expect(within(dlg).getByText('Тест после ролика')).toBeTruthy()
    expect(spy).toHaveBeenCalledWith('pause')
    // пока тест открыт — ни навигации, ни событий
    expect(screen.getByTestId('location').textContent).toMatch(/^\/player/)
    expect(answered()).toHaveLength(0)
    fireEvent.click(within(dlg).getAllByTestId('hc-word')[0])
    fireEvent.click(within(dlg).getByTestId('hc-done'))
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe(`/app/route?next=${encodeURIComponent(RP)}`))
    const a = answered()
    expect(a).toHaveLength(1)
    expect(a[0].e).toMatchObject({ puzzle_id: RP, question_id: `hc:2026-11-18:${RP}`, answer_outcome: 'answered', shown: ['alpha', 'beta', 'gamma'], marked: ['alpha'] })
    expect(JSON.parse(localStorage.getItem(HEARD_SENT_KEY)!)).toEqual([`${ROUTE}|hc:2026-11-18:${RP}`])
  })

  it('Esc → declined, затем переход', async () => {
    routeOn()
    mount(`v=${V}&rp=${encodeURIComponent(RP)}`)
    await waitFor(() => expect(calls.some(c => c.url.startsWith('/api/me/route/state'))).toBe(true))
    await ended()
    await screen.findByTestId('route-end-card')
    click(/Следующий ролик/)
    await screen.findByRole('dialog')
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })) })
    await waitFor(() => expect(screen.getByTestId('location').textContent).toContain('/app/route?next='))
    const a = answered()
    expect(a).toHaveLength(1)
    expect(a[0].e.answer_outcome).toBe('declined')
    expect('marked' in a[0].e).toBe(false)
  })

  it('уход со страницы при открытом тесте — ничего не отправлено', async () => {
    routeOn()
    const r = mount(`v=${V}&rp=${encodeURIComponent(RP)}`)
    await waitFor(() => expect(calls.some(c => c.url.startsWith('/api/me/route/state'))).toBe(true))
    await ended()
    await screen.findByTestId('route-end-card')
    click(/Следующий ролик/)
    await screen.findByRole('dialog')
    r.unmount()
    await pause(50)
    expect(answered()).toHaveLength(0)
    expect(localStorage.getItem(HEARD_SENT_KEY)).toBeNull()
    expect(calls.some(c => c.url.startsWith('/api/me/route/exchange'))).toBe(false)
  })

  it('вопрос уже отправлялся — теста нет, кнопка как раньше', async () => {
    routeOn()
    noteHeardCheckSent(`hc:2026-11-18:${RP}`, ROUTE)
    mount(`v=${V}&rp=${encodeURIComponent(RP)}`)
    await waitFor(() => expect(calls.some(c => c.url.startsWith('/api/me/route/state'))).toBe(true))
    await ended()
    await screen.findByTestId('route-end-card')
    click(/Следующий ролик/)
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe(`/app/route?next=${encodeURIComponent(RP)}`))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(answered()).toHaveLength(0)
  })

  it('нет вопроса по активному ролику — теста нет', async () => {
    routeOn()
    stateNow = mkState({ heard_check_questions: [] })
    mount(`v=${V}&rp=${encodeURIComponent(RP)}`)
    await waitFor(() => expect(calls.some(c => c.url.startsWith('/api/me/route/state'))).toBe(true))
    await ended()
    await screen.findByTestId('route-end-card')
    click(/Следующий ролик/)
    await waitFor(() => expect(screen.getByTestId('location').textContent).toContain('/app/route?next='))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('двойной клик по «Следующий ролик» — один тест, одно событие (E5)', async () => {
    routeOn()
    mount(`v=${V}&rp=${encodeURIComponent(RP)}`)
    await waitFor(() => expect(calls.some(c => c.url.startsWith('/api/me/route/state'))).toBe(true))
    await ended()
    await screen.findByTestId('route-end-card')
    click(/Следующий ролик/)
    click(/Следующий ролик/)
    await screen.findByRole('dialog')
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    fireEvent.click(screen.getByTestId('hc-done'))
    await waitFor(() => expect(screen.getByTestId('location').textContent).toContain('/app/route?next='))
    expect(answered()).toHaveLength(1)
  })
})

describe('непрослушанный ролик: предупреждение вместо теста', () => {
  beforeEach(() => { localStorage.removeItem('flib:route-listened'); __resetClipListenedForTests() })

  it('предупреждение: пауза, текст дословно; «Вернуться» — остаёмся, ничего не отправлено', async () => {
    routeOn()
    mount(`v=${V}&rp=${encodeURIComponent(RP)}`)
    await waitFor(() => expect(calls.some(c => c.url.startsWith('/api/me/route/state'))).toBe(true))
    await ended()
    await screen.findByTestId('route-end-card')
    const spy = vi.fn(); h.adapter._spy = spy
    click(/Следующий ролик/)
    const dlg = await screen.findByTestId('next-warning')
    expect(within(dlg).getByText('Вы прослушали не весь ролик.')).toBeTruthy()
    expect(spy).toHaveBeenCalledWith('pause')
    expect(screen.queryByTestId('heard-check')).toBeNull()
    fireEvent.click(within(dlg).getByTestId('nw-back'))
    await pause(100)
    expect(screen.queryByTestId('next-warning')).toBeNull()
    expect(screen.getByTestId('location').textContent).toMatch(/^\/player/)
    expect(answered()).toHaveLength(0)
    // повторное нажатие снова спрашивает (не залипло)
    click(/Следующий ролик/)
    await screen.findByTestId('next-warning')
  })

  it('«Всё равно перейти» — переход с skip_hc=1, теста нет, question_answered нет', async () => {
    routeOn()
    mount(`v=${V}&rp=${encodeURIComponent(RP)}`)
    await waitFor(() => expect(calls.some(c => c.url.startsWith('/api/me/route/state'))).toBe(true))
    await ended()
    await screen.findByTestId('route-end-card')
    click(/Следующий ролик/); click(/Следующий ролик/)
    await screen.findByTestId('next-warning')
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    fireEvent.click(screen.getByTestId('nw-proceed'))
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe(`/app/route?next=${encodeURIComponent(RP)}&skip_hc=1`))
    expect(screen.queryByTestId('heard-check')).toBeNull()
    expect(answered()).toHaveLength(0)
  })

  it('Esc = «Вернуться»', async () => {
    routeOn()
    mount(`v=${V}&rp=${encodeURIComponent(RP)}`)
    await waitFor(() => expect(calls.some(c => c.url.startsWith('/api/me/route/state'))).toBe(true))
    await ended()
    await screen.findByTestId('route-end-card')
    click(/Следующий ролик/)
    await screen.findByTestId('next-warning')
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })) })
    await pause(100)
    expect(screen.queryByTestId('next-warning')).toBeNull()
    expect(screen.getByTestId('location').textContent).toMatch(/^\/player/)
  })
})
