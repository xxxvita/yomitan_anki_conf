// PlayerPage.routeEndCard.test.tsx — плеер в маршруте (план B9, приёмка):
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
import { markClipListened, __resetClipListenedForTests } from '../../player/route-events/clip-listened'
import { __resetRouteOutboxForTests, getRouteOutbox } from '../../site/cabinet/route/outbox'

const V = 'abc123XYZ_1'
const RP = `youtube::${V}`
const V2 = 'zzz999YYY_2'
const ROUTE = '11111111-1111-4111-8111-111111111111'
const row = (pid: string, v: string, over: Record<string, unknown> = {}) => ({ puzzle_id: pid, kind: 'youtube', video_id: v, title: 'T ' + v, delivered: true, played: false, queued_played: false, new_words: 0, words: [], ...over })
const mkState = (over: Record<string, unknown> = {}) => ({
  started: true, route_id: ROUTE, revision: 4, snapshot_date: '2026-11-18', started_at: null, goal_label: 'g',
  params: { daily_listening_budget_min: 20, daily_new_words: 15 },
  day: { date: '2026-11-18', clips: [row(RP, V), { delivered: false, new_words: 0 }] },
  next_clip: { title: 'Next clip title' }, current_puzzle_id: RP, replace_available: true, stop_reason: null, active_exchange: null,
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
  __resetSessionForTests(); __resetRouteStateForTests(); __resetRouteOutboxForTests(); __resetClipListenedForTests()
  localStorage.clear(); localStorage.setItem('flib:subMode', 'l2')
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
const rated = () => calls.filter(c => c.url === '/api/me/route/events').flatMap(c => c.body.events).filter((e: any) => e.type === 'clip_rated')

describe('маршрутный режим плеера (rp подтверждён)', () => {
  it('«← К маршруту» вместо «Мой маршрут»; «Шаг N из M» нет даже с route_step', async () => {
    routeOn()
    localStorage.setItem('flib:route', JSON.stringify({ v: 1, goalLabel: 'g', steps: [{ id: 's1', kind: 'video', videoId: V, title: 'x', source: 'y', durationSec: 10, newLemmas: 1, words: [], status: 'current' }] }))
    mount(`v=${V}&rp=${encodeURIComponent(RP)}&route_step=s1`)
    await waitFor(() => expect(screen.getByTestId('back-to-route-link').getAttribute('href')).toBe('/app/route'))
    expect(screen.queryByTestId('my-route-link')).toBeNull()
    expect(document.body.textContent).not.toMatch(/Шаг\s*\d+\s*из/)
    expect(screen.queryByRole('region', { name: 'Шаг маршрута' })).toBeNull()
  })

  it('конец ролика, next_clip с названием — «Дальше в маршруте» + название; «Следующий ролик →» → /app/route?next=<rp>', async () => {
    routeOn()
    mount(`v=${V}&rp=${encodeURIComponent(RP)}`)
    await waitFor(() => expect(calls.some(c => c.url.startsWith('/api/me/route/state'))).toBe(true))
    await ended()
    const card = await screen.findByTestId('route-end-card')
    expect(within(card).getByText('Дальше в маршруте')).toBeTruthy()
    expect(within(card).getByText('Next clip title')).toBeTruthy()
    expect(within(card).getByRole('link', { name: 'К маршруту' }).getAttribute('href')).toBe('/app/route')
    act(() => { markClipListened(RP) })
    fireEvent.click(within(card).getByRole('button', { name: /Следующий ролик/ }))
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe(`/app/route?next=${encodeURIComponent(RP)}`))
  })

  it('«Следующий ролик →»: не прослушан — не подсвечен, но кликабелен; прослушан (флаг сменился при открытой карточке) — подсвечен', async () => {
    routeOn()
    mount(`v=${V}&rp=${encodeURIComponent(RP)}`)
    await waitFor(() => expect(calls.some(c => c.url.startsWith('/api/me/route/state'))).toBe(true))
    await ended()
    const card = await screen.findByTestId('route-end-card')
    const btn = within(card).getByRole('button', { name: /Следующий ролик/ })
    expect(btn.className).not.toMatch(/primary/)
    expect(btn.getAttribute('title')).toBe('Перейти к следующему ролику, не дослушав этот')
    expect((btn as HTMLButtonElement).disabled).toBe(false)
    act(() => { markClipListened(RP) })
    const lit = within(card).getByRole('button', { name: /Следующий ролик/ })
    expect(lit.className).toMatch(/primary/)
    expect(lit.getAttribute('title')).toBe('Ролик прослушан — перейти к следующему ролику')
    fireEvent.click(lit)
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe(`/app/route?next=${encodeURIComponent(RP)}`))
  })

  it('не прослушан: предупреждение, «Всё равно перейти» переходит', async () => {
    routeOn()
    mount(`v=${V}&rp=${encodeURIComponent(RP)}`)
    await waitFor(() => expect(calls.some(c => c.url.startsWith('/api/me/route/state'))).toBe(true))
    await ended()
    const card = await screen.findByTestId('route-end-card')
    fireEvent.click(within(card).getByRole('button', { name: /Следующий ролик/ }))
    // непрослушан: сначала предупреждение, перехода нет; «Всё равно» — переход без теста (skip_hc)
    fireEvent.click(await screen.findByTestId('nw-proceed'))
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe(`/app/route?next=${encodeURIComponent(RP)}&skip_hc=1`))
  })

  it('«Посмотреть заново» в варианте next: seek 0 + play, карточка скрыта, без навигации', async () => {
    routeOn()
    mount(`v=${V}&rp=${encodeURIComponent(RP)}`)
    await waitFor(() => expect(calls.some(c => c.url.startsWith('/api/me/route/state'))).toBe(true))
    await ended()
    const card = await screen.findByTestId('route-end-card')
    const seeks: string[] = []
    h.adapter._spy = (m: string) => seeks.push(m)
    fireEvent.click(within(card).getByRole('button', { name: 'Посмотреть заново' }))
    expect(seeks).toContain('seek:0')
    expect(seeks).toContain('play')
    await waitFor(() => expect(screen.queryByTestId('route-end-card')).toBeNull())
    expect(screen.getByTestId('location').textContent).toBe(`/player?v=${V}&rp=${encodeURIComponent(RP)}`)
  })

  it('«Посмотреть заново» есть и в варианте done', async () => {
    routeOn()
    stateNow = mkState({ next_clip: null, day: { date: '2026-11-18', clips: [row(RP, V)] } })
    mount(`v=${V}&rp=${encodeURIComponent(RP)}`)
    await waitFor(() => expect(calls.some(c => c.url.startsWith('/api/me/route/state'))).toBe(true))
    await ended()
    const card = await screen.findByTestId('route-end-card')
    expect(within(card).getByRole('button', { name: 'Посмотреть заново' })).toBeTruthy()
  })

  it('next_clip без названия — «Следующий ролик» вместо названия', async () => {
    routeOn()
    stateNow = mkState({ next_clip: {} })
    mount(`v=${V}&rp=${encodeURIComponent(RP)}`)
    await waitFor(() => expect(calls.some(c => c.url.startsWith('/api/me/route/state'))).toBe(true))
    await ended()
    const card = await screen.findByTestId('route-end-card')
    expect(within(card).getByRole('heading').textContent).toBe('Следующий ролик')
  })

  it('next_clip = null — «На сегодня всё — до завтра» + «← К маршруту»', async () => {
    routeOn()
    stateNow = mkState({ next_clip: null, day: { date: '2026-11-18', clips: [row(RP, V)] } })
    mount(`v=${V}&rp=${encodeURIComponent(RP)}`)
    await waitFor(() => expect(calls.some(c => c.url.startsWith('/api/me/route/state'))).toBe(true))
    await ended()
    const card = await screen.findByTestId('route-end-card')
    expect(within(card).getByRole('heading').textContent).toBe('На сегодня всё — до завтра')
    expect(within(card).getByRole('link', { name: '← К маршруту' })).toBeTruthy()
    expect(within(card).queryByRole('button', { name: /Следующий ролик/ })).toBeNull()
  })

  it('rp не подтвердился (не текущий, крайний случай 23) — вариант back=route', async () => {
    routeOn()
    stateNow = mkState({ current_puzzle_id: 'youtube::other000001' })
    mount(`v=${V}&rp=${encodeURIComponent(RP)}`)
    await waitFor(() => expect(calls.some(c => c.url.startsWith('/api/me/route/state'))).toBe(true))
    await ended()
    const card = await screen.findByTestId('route-end-card')
    expect(within(card).getByRole('button', { name: 'Посмотреть заново' })).toBeTruthy()
    expect(within(card).getByRole('link', { name: '← К маршруту' })).toBeTruthy()
    expect(document.body.textContent).not.toContain('Next clip title')
  })
})

describe('back=route (прошлый день, выданный ролик не текущий)', () => {
  it('[Посмотреть заново] [← К маршруту]; «Посмотреть заново» перематывает в начало без перезагрузки', async () => {
    routeOn()
    mount(`v=${V}&back=route`)
    await ended()
    const card = await screen.findByTestId('route-end-card')
    const seeks: string[] = []
    h.adapter._spy = (m: string) => seeks.push(m)
    fireEvent.click(within(card).getByRole('button', { name: 'Посмотреть заново' }))
    expect(seeks).toContain('seek:0')
    expect(seeks).toContain('play')
    await waitFor(() => expect(screen.queryByTestId('route-end-card')).toBeNull())
    expect(screen.getByTestId('location').textContent).toBe(`/player?v=${V}&back=route`)
  })

  it('пауза в окне 0,75 с у конца (без события ended) — тоже карточка', async () => {
    routeOn()
    mount(`v=${V}&back=route`)
    await waitFor(() => expect(h.adapter).toBeTruthy())
    await pause(30)
    act(() => { h.adapter._setTime(119.5) })
    await pause(400)
    expect(await screen.findByTestId('route-end-card')).toBeTruthy()
  })

  it('без сессии «← К маршруту» ведёт на /login?next=/app/route', async () => {
    marker(true)
    __setSessionForTests({ cabinet: true, authenticated: false })
    mount(`v=${V}&back=route`)
    await waitFor(() => expect(screen.getByTestId('back-to-route-link').getAttribute('href')).toBe('/login?next=/app/route'))
  })
})

describe('гость', () => {
  it('без rp и back — «Мой маршрут», карточки конца ролика нет', async () => {
    marker(true)
    __setSessionForTests({ cabinet: true, authenticated: false })
    mount(`v=${V}`)
    await ended()
    expect(screen.getByTestId('my-route-link')).toBeTruthy()
    expect(screen.queryByTestId('route-end-card')).toBeNull()
  })

  it('флаг маршрута выключен: rp и back игнорируются — плеер как раньше', async () => {
    marker(false)
    __setSessionForTests({ cabinet: true, authenticated: true, state: 'active' })
    mount(`v=${V}&back=route&rp=${encodeURIComponent(RP)}`)
    await ended()
    expect(screen.getByTestId('my-route-link')).toBeTruthy()
    expect(screen.queryByTestId('back-to-route-link')).toBeNull()
    expect(screen.queryByTestId('route-end-card')).toBeNull()
  })
})

describe('VideoVoteBar маршрута', () => {
  const openDislike = async () => {
    const bar = await screen.findByTestId('video-vote-bar')
    fireEvent.click(within(bar).getByRole('button', { name: 'Не понравилось' }))
    return bar
  }

  it('при rp — строка причин приложения с галкой; гость — прежняя форма со шкалой', async () => {
    routeOn()
    const { unmount } = mount(`v=${V}&rp=${encodeURIComponent(RP)}`)
    await waitFor(() => expect(calls.some(c => c.url.startsWith('/api/me/route/state'))).toBe(true))
    await pause(50)
    const bar = await openDislike()
    expect(within(bar).getByRole('group', { name: 'Что не так с роликом?' })).toBeTruthy()
    expect((within(bar).getByLabelText('Заменить ролик') as HTMLInputElement).checked).toBe(true)
    unmount()
    marker(false)
    mount(`v=${V}`)
    const bar2 = await openDislike()
    expect(within(bar2).queryByRole('group', { name: 'Что не так с роликом?' })).toBeNull()
    expect(within(bar2).getByRole('radiogroup')).toBeTruthy()
  })

  it('при подтверждённом rc — кнопки маршрута; устаревший rc — прежняя форма', async () => {
    routeOn()
    const RC = `youtube::${V2}`
    stateNow = mkState({ day: { date: '2026-11-18', clips: [row(RC, V2, { played: true }), row(RP, V)] } })
    const { unmount } = mount(`v=${V2}&back=route&rc=${encodeURIComponent(RC)}`)
    await waitFor(() => expect(calls.some(c => c.url.startsWith('/api/me/route/state'))).toBe(true))
    await pause(50)
    const bar = await openDislike()
    expect(within(bar).getByRole('group', { name: 'Что не так с роликом?' })).toBeTruthy()
    unmount()
    __resetRouteStateForTests()
    stateNow = mkState()
    mount(`v=${V2}&back=route&rc=${encodeURIComponent(RC)}`)
    await waitFor(() => expect(calls.filter(c => c.url.startsWith('/api/me/route/state')).length).toBeGreaterThanOrEqual(2))
    await pause(50)
    const bar2 = await openDislike()
    expect(within(bar2).queryByRole('group', { name: 'Что не так с роликом?' })).toBeNull()
  })

  it('без replace_available — строка причин без галки, «Отправить» шлёт только clip_rated', async () => {
    routeOn()
    stateNow = mkState({ replace_available: false })
    mount(`v=${V}&rp=${encodeURIComponent(RP)}`)
    await waitFor(() => expect(calls.some(c => c.url.startsWith('/api/me/route/state'))).toBe(true))
    await pause(50)
    const bar = await openDislike()
    expect(within(bar).queryByLabelText('Заменить ролик')).toBeNull()
    fireEvent.click(within(bar).getByLabelText('Субтитры не попадают во время'))
    fireEvent.click(within(bar).getByRole('button', { name: 'Отправить' }))
    await act(async () => { await getRouteOutbox().flush({ timeoutMs: 3000 }) })
    expect(rated()).toMatchObject([{ puzzle_id: RP, rating: 'dislike', rate_reason: 'subs_misaligned', subs_source: 'server:daemon_align' }])
    expect(calls.filter(c => c.url === '/api/me/route/exchange').length).toBe(0)
  })

  it('с галкой — clip_rated раньше обмена с тем же replace_reason; затем открыт новый текущий ролик (rp)', async () => {
    routeOn()
    afterCommit = mkState({ revision: 5, current_puzzle_id: `youtube::${V2}`, day: { date: '2026-11-18', clips: [row(`youtube::${V2}`, V2), { delivered: false, new_words: 0 }] } })
    mount(`v=${V}&rp=${encodeURIComponent(RP)}`)
    await waitFor(() => expect(calls.some(c => c.url.startsWith('/api/me/route/state'))).toBe(true))
    await pause(50)
    const bar = await openDislike()
    fireEvent.click(within(bar).getByLabelText('Не интересно'))
    fireEvent.click(within(bar).getByRole('button', { name: 'Отправить' }))
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe(`/player?v=${V2}&rp=${encodeURIComponent(`youtube::${V2}`)}`), { timeout: 5000 })
    const ex = calls.find(c => c.url === '/api/me/route/exchange')!
    expect(ex.body).toMatchObject({ want: 'replace', replace_puzzle_id: RP, replace_reason: 'content' })
    const evc = calls.find(c => c.url === '/api/me/route/events' && c.body.events.some((e: any) => e.type === 'clip_rated'))!
    expect(evc.at).toBeLessThan(ex.at)
    // доля отвергнутого ролика не отправляется (как приложение)
    await pause(100)
    await act(async () => { await getRouteOutbox().flush({ timeoutMs: 3000 }) })
    const played = calls.filter(c => c.url === '/api/me/route/events').flatMap(c => c.body.events).filter((e: any) => e.type === 'clip_played' && e.puzzle_id === RP)
    expect(played).toEqual([])
  })

  it('замена после просмотра половины ролика: отчёт этого открытия (clip_played) не уходит; контроль — без замены уходит', async () => {
    routeOn()
    afterCommit = mkState({ revision: 5, current_puzzle_id: `youtube::${V2}`, day: { date: '2026-11-18', clips: [row(`youtube::${V2}`, V2)] } })
    const { unmount } = mount(`v=${V}&rp=${encodeURIComponent(RP)}`)
    await waitFor(() => expect(calls.some(c => c.url.startsWith('/api/me/route/state'))).toBe(true))
    await waitFor(() => expect(h.adapter).toBeTruthy())
    await pause(50)
    for (const t of [10, 30, 60]) { act(() => { h.adapter._setTime(t) }); await pause(300) }
    const bar = await openDislike()
    fireEvent.click(within(bar).getByLabelText('Не интересно'))
    fireEvent.click(within(bar).getByRole('button', { name: 'Отправить' }))
    await waitFor(() => expect(screen.getByTestId('location').textContent).toContain(V2), { timeout: 5000 })
    await pause(200)
    unmount()
    await act(async () => { await getRouteOutbox().flush({ timeoutMs: 3000 }) })
    const played = calls.filter(c => c.url === '/api/me/route/events').flatMap(c => c.body.events).filter((e: any) => e.type === 'clip_played' && e.puzzle_id === RP)
    expect(played).toEqual([])
  })

  it('контроль: то же открытие без замены — отчёт уходит при уходе со страницы', async () => {
    routeOn()
    const { unmount } = mount(`v=${V}&rp=${encodeURIComponent(RP)}`)
    await waitFor(() => expect(calls.some(c => c.url.startsWith('/api/me/route/state'))).toBe(true))
    await waitFor(() => expect(h.adapter).toBeTruthy())
    await pause(50)
    for (const t of [10, 30, 60]) { act(() => { h.adapter._setTime(t) }); await pause(300) }
    unmount()
    await pause(100)
    await act(async () => { await getRouteOutbox().flush({ timeoutMs: 3000 }) })
    const played = calls.filter(c => c.url === '/api/me/route/events').flatMap(c => c.body.events).filter((e: any) => e.type === 'clip_played' && e.puzzle_id === RP)
    expect(played.length).toBe(1)
  })

  it('новый текущий — урок слов → открыт /app/route, а не страница урока; ноль запросов примеров', async () => {
    routeOn()
    afterCommit = mkState({ revision: 5, current_puzzle_id: 'words::aaaa', day: { date: '2026-11-18', clips: [{ puzzle_id: 'words::aaaa', kind: 'words', delivered: true, played: false, queued_played: false, new_words: 2, words: ['a', 'b'] }] } })
    mount(`v=${V}&rp=${encodeURIComponent(RP)}`)
    await waitFor(() => expect(calls.some(c => c.url.startsWith('/api/me/route/state'))).toBe(true))
    await pause(50)
    const bar = await openDislike()
    fireEvent.click(within(bar).getByLabelText('Не интересно'))
    fireEvent.click(within(bar).getByRole('button', { name: 'Отправить' }))
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/app/route'), { timeout: 5000 })
    expect(calls.filter(c => c.url.includes('/examples')).length).toBe(0)
  })

  it('«Нравится» при rp: clip_rated один раз; повторный клик — ноль событий', async () => {
    routeOn()
    mount(`v=${V}&rp=${encodeURIComponent(RP)}`)
    await waitFor(() => expect(calls.some(c => c.url.startsWith('/api/me/route/state'))).toBe(true))
    await pause(50)
    const bar = await screen.findByTestId('video-vote-bar')
    fireEvent.click(within(bar).getByRole('button', { name: 'Понравилось' }))
    await pause(30)
    fireEvent.click(within(bar).getByRole('button', { name: 'Понравилось' }))
    await act(async () => { await getRouteOutbox().flush({ timeoutMs: 3000 }) })
    expect(rated().length).toBe(1)
    expect(within(bar).getByRole('button', { name: 'Понравилось' }).getAttribute('aria-pressed')).toBe('true')
  })
})
