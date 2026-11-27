// PlayerPage.routeFixRound1.test.tsx — ревью партии 3а, правки первого круга
// (плеер): H1 возврат «← К маршруту» после частичного просмотра (Web Locks есть),
// C1 замена из плеера по свежему состоянию, L1 конфликты обмена, L6 карточка
// конца не закрывает оценку, L8 стражи R7 (локальный сброс отчёта) и R58
// (выгрузка перед «Следующий ролик →»). Порт проб `review-b3a/probes/zz-b3a-spa`
// и `zz-b3a-player`.
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
import { RoutePageCabinet } from '../../site/cabinet/route/RoutePageCabinet'
import { __resetSessionForTests, __setSessionForTests } from '../../site/session'
import { __resetRouteStateForTests } from '../../site/cabinet/route/use-route-state'
import { __resetRouteOutboxForTests, getRouteOutbox } from '../../site/cabinet/route/outbox'
import { __resetRouteRuntimeForTests, startRouteRuntime } from '../../site/cabinet/route/route-lifecycle'
import { markClipListened, __resetClipListenedForTests } from '../../player/route-events/clip-listened'

const V = 'abc123XYZ_1'
const RP = `youtube::${V}`
const V2 = 'zzz999YYY_2'
const RP2 = `youtube::${V2}`
const ROUTE = '11111111-1111-4111-8111-111111111111'
function marker(on: boolean) {
  document.head.querySelectorAll('meta[name="flib-route"]').forEach(m => m.remove())
  if (!on) return
  const m = document.createElement('meta'); m.setAttribute('name', 'flib-route'); m.setAttribute('content', '1'); document.head.appendChild(m)
}
function Loc() { const l = useLocation(); return <div data-testid="location">{l.pathname + l.search}</div> }
const later = (ms: number, st: number, b: unknown, hd: Record<string, string> = {}) => new Promise<Response>(res => setTimeout(() => res(new Response(JSON.stringify(b), { status: st, headers: { 'Content-Type': 'application/json', ...hd } })), ms))
const pause = (ms: number) => act(async () => { await new Promise(r => setTimeout(r, ms)) })

let today = ''
let queued = new Set<string>()
let calls: Array<{ url: string; method: string; body: any; at: number }> = []
let seq = 0
let stateOverride: ((n: number) => unknown) | null = null
let exchangeReply: () => Promise<Response>
let afterCommit: unknown = null
let stateGets = 0
const row = (pid: string, v: string, over: Record<string, unknown> = {}) => ({ puzzle_id: pid, kind: 'youtube', video_id: v, title: 'T ' + v, delivered: true, played: false, queued_played: queued.has(pid), new_words: 0, words: [], duration_sec: 120, ...over })
const baseState = (over: Record<string, unknown> = {}) => ({
  started: true, route_id: ROUTE, revision: 4, snapshot_date: today, started_at: null, goal_label: 'g',
  params: { daily_listening_budget_min: 20, daily_new_words: 15 },
  day: { date: today, clips: [row(RP, V), { delivered: false, new_words: 0, duration_sec: 100 }] },
  next_clip: {}, current_puzzle_id: RP, replace_available: true, stop_reason: null, active_exchange: null, ...over,
})

function withLocks() {
  let tail: Promise<unknown> = Promise.resolve()
  vi.stubGlobal('navigator', Object.assign(Object.create(navigator), {
    locks: {
      request: (_n: string, fn: () => Promise<unknown>) => {
        const run = tail.then(() => fn())
        tail = run.catch(() => undefined)
        return run
      },
    },
  }))
}

beforeEach(() => {
  __resetSessionForTests(); __resetRouteStateForTests(); __resetRouteOutboxForTests(); __resetRouteRuntimeForTests()
  localStorage.clear(); localStorage.setItem('flib:subMode', 'l2'); __resetClipListenedForTests(); markClipListened(RP); markClipListened(RP2)
  h.cues = [{ start: 0, end: 2, text_en: 'Hello brave world', text_ru: 'Привет' }]
  h.adapter = null; queued = new Set(); calls = []; seq = 0; stateOverride = null; afterCommit = null; stateGets = 0
  const d = new Date(); today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  exchangeReply = () => later(5, 202, { job_id: '33333333-3333-4333-8333-333333333333', base_revision: 4 })
  vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit = {}) => {
    const u = String(url)
    const method = (init.method ?? 'GET').toUpperCase()
    const body = typeof init.body === 'string' ? (() => { try { return JSON.parse(init.body as string) } catch { return init.body } })() : null
    calls.push({ url: u, method, body, at: ++seq })
    if (u.startsWith('/api/me/route/state')) {
      stateGets++
      // queued_played решается в момент ПРИХОДА запроса состояния (как у шлюза)
      const s = stateOverride ? stateOverride(stateGets) : (afterCommitApplied ? afterCommitApplied : baseState())
      return later(40, 200, s)
    }
    if (u === '/api/me/route/events') {
      for (const e of body.events) if (e.type === 'clip_played') queued.add(e.puzzle_id)
      return later(40, 200, { accepted: body.events.length, duplicates: 0, rejected: [], evicted_external: 0 })
    }
    if (u === '/api/me/route/exchange') return exchangeReply()
    if (u.startsWith('/api/me/route/jobs/')) { if (afterCommit) { afterCommitApplied = afterCommit; afterCommit = null } return later(5, 200, { status: 'done', committed: true, committed_revision: 5, cancel_reason: null, error_code: null }) }
    if (u.startsWith('/api/me/route/progress')) return later(5, method === 'GET' ? 404 : 200, method === 'GET' ? { error: 'not_found' } : { ok: true })
    if (u.startsWith('/api/feedback/video')) return Promise.resolve(new Response(null, { status: 204 }))
    if (u.startsWith('/api/me/route/')) return later(5, 404, { error: 'not_found' })
    return Promise.reject(new Error('no net'))
  }))
})
let afterCommitApplied: unknown = null
afterEach(() => { marker(false); vi.unstubAllGlobals(); __resetRouteOutboxForTests(); __resetSessionForTests(); __resetRouteRuntimeForTests(); afterCommitApplied = null })

function mountSpa(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <div className="cab">
        <Routes>
          <Route path="/player" element={<PlayerPage />} />
          <Route path="/app/route" element={<RoutePageCabinet />} />
          <Route path="*" element={<div data-testid="elsewhere" />} />
        </Routes>
      </div>
      <Loc />
    </MemoryRouter>,
  )
}
const routeOn = () => { marker(true); __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_abcd', routeAllowed: true }) }
const heroButtons = () => {
  const el = screen.queryByTestId('day-hero') ?? screen.queryByTestId('day-done')
  return el ? Array.from(el.querySelectorAll('a.btn, button.btn')).map(b => (b.textContent || '').trim()).filter(Boolean) : []
}
const evs = () => calls.filter(c => c.url === '/api/me/route/events').flatMap(c => c.body.events.map((e: any) => ({ at: c.at, type: e.type, pid: e.puzzle_id })))
const openDislike = async () => {
  const bar = await screen.findByTestId('video-vote-bar')
  fireEvent.click(within(bar).getByRole('button', { name: 'Не понравилось' }))
  return bar
}

async function hop(seekTo: number[]) {
  routeOn()
  startRouteRuntime()
  mountSpa(`/player?v=${V}&rp=${encodeURIComponent(RP)}`)
  await waitFor(() => expect(h.adapter).toBeTruthy())
  await waitFor(() => expect(screen.getByTestId('back-to-route-link').getAttribute('href')).toBe('/app/route'))
  await pause(150)
  for (const t of seekTo) { act(() => { h.adapter._setTime(t) }); await pause(150) }
  fireEvent.click(screen.getByTestId('back-to-route-link'))
  await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/app/route'))
  await screen.findByTestId('day-hero')
}

describe('H1: возврат «← К маршруту» после частичного просмотра (Web Locks есть)', () => {
  beforeEach(() => { withLocks(); __resetRouteOutboxForTests() })

  it('67 %: через секунду — «1 из 2», главная «Следующий ролик», и так остаётся; состояние перечитано после приёма отчёта', async () => {
    await hop([10, 30, 60, 80])
    await pause(1200)
    expect(screen.getByTestId('route-meta').textContent).toContain('1 из 2')
    expect(heroButtons()[0]).toBe('Следующий ролик')
    expect(heroButtons()).toContain('Смотреть снова')
    // состояние перечитано после того, как пачка с отчётом принята
    const cpAt = calls.find(c => c.url === '/api/me/route/events' && c.body.events.some((e: any) => e.type === 'clip_played'))!.at
    expect(calls.some(c => c.url.startsWith('/api/me/route/state') && c.at > cpAt)).toBe(true)
    await pause(500)
    expect(heroButtons()[0]).toBe('Следующий ролик')
  }, 20000)

  it('8 % (OQ-B14): «Смотреть снова» + «Следующий ролик»', async () => {
    await hop([5, 10])
    await pause(1200)
    expect(heroButtons().slice(0, 2)).toEqual(['Смотреть снова', 'Следующий ролик'])
    expect(screen.getByTestId('route-meta').textContent).toContain('0 из 2')
  }, 20000)
})

describe('C1 в плеере: замена — по свежему состоянию', () => {
  it('ролик успел стать kept (день пересобран) — обмена нет, «Замена сейчас недоступна»', async () => {
    routeOn()
    const RC = RP2
    stateOverride = n => n === 1
      ? baseState({ day: { date: today, clips: [row(RC, V2, { played: true }), row(RP, V)] } })
      : baseState({ revision: 6, day: { date: today, clips: [{ puzzle_id: RC, kind: 'youtube', video_id: V2, title: 'T', delivered: true, played: true, kept: true }, row('youtube::newnewnew01', 'newnewnew01')] }, current_puzzle_id: 'youtube::newnewnew01' })
    mountSpa(`/player?v=${V2}&back=route&rc=${encodeURIComponent(RC)}`)
    await waitFor(() => expect(stateGets).toBeGreaterThan(0))
    await pause(100)
    const bar = await openDislike()
    fireEvent.click(within(bar).getByLabelText('Не интересно'))
    fireEvent.click(within(bar).getByRole('button', { name: 'Отправить' }))
    await waitFor(() => expect(document.querySelector('.vvb-route-status')?.textContent).toBe('Замена сейчас недоступна'), { timeout: 3000 })
    expect(calls.filter(c => c.url === '/api/me/route/exchange').length).toBe(0)
  })
})

describe('L1 в плеере: конфликты обмена', () => {
  it('409 stale_revision — сообщение, без перехода', async () => {
    routeOn()
    exchangeReply = () => later(5, 409, { error: 'stale_revision', revision: 9 })
    mountSpa(`/player?v=${V}&rp=${encodeURIComponent(RP)}`)
    await waitFor(() => expect(stateGets).toBeGreaterThan(0))
    await pause(100)
    const bar = await openDislike()
    fireEvent.click(within(bar).getByLabelText('Не интересно'))
    fireEvent.click(within(bar).getByRole('button', { name: 'Отправить' }))
    await waitFor(() => expect(document.querySelector('.vvb-route-status')?.textContent).toBe('День изменился, пока шла замена, — замена не выполнена'), { timeout: 3000 })
    expect(screen.getByTestId('location').textContent).toBe(`/player?v=${V}&rp=${encodeURIComponent(RP)}`)
  })

  it('409 exchange_in_progress (чужой «next») — не открывает следующий ролик как заменённый', async () => {
    routeOn()
    exchangeReply = () => later(5, 409, { error: 'exchange_in_progress', job_id: '44444444-4444-4444-8444-444444444444', revision: 4 })
    afterCommit = baseState({ revision: 5, current_puzzle_id: RP2, day: { date: today, clips: [row(RP, V), row(RP2, V2)] } })
    mountSpa(`/player?v=${V}&rp=${encodeURIComponent(RP)}`)
    await waitFor(() => expect(stateGets).toBeGreaterThan(0))
    await pause(100)
    const bar = await openDislike()
    fireEvent.click(within(bar).getByLabelText('Не интересно'))
    fireEvent.click(within(bar).getByRole('button', { name: 'Отправить' }))
    await waitFor(() => expect(document.querySelector('.vvb-route-status')?.textContent).toBe('День изменился, пока шла замена, — замена не выполнена'), { timeout: 6000 })
    expect(screen.getByTestId('location').textContent).toBe(`/player?v=${V}&rp=${encodeURIComponent(RP)}`)
  }, 10000)
})

describe('L8 R7: замена из плеера после конца ролика — отчёт уже в очереди', () => {
  it('clip_played заменённого ролика выброшен и не уходит никогда', async () => {
    routeOn()
    afterCommit = baseState({ revision: 5, current_puzzle_id: RP2, day: { date: today, clips: [row(RP2, V2)] }, next_clip: null })
    const { unmount } = mountSpa(`/player?v=${V}&rp=${encodeURIComponent(RP)}`)
    await waitFor(() => expect(stateGets).toBeGreaterThan(0))
    await waitFor(() => expect(h.adapter).toBeTruthy())
    await pause(50)
    for (const t of [10, 30, 60, 100]) { act(() => { h.adapter._setTime(t) }); await pause(200) }
    act(() => { h.adapter._setTime(119.8); h.adapter._emit('state', 'ended') })
    await pause(400)
    expect(localStorage.getItem('flib:route-outbox') ?? '').toContain('clip_played')
    const bar = await openDislike()
    fireEvent.click(within(bar).getByLabelText('Не интересно'))
    fireEvent.click(within(bar).getByRole('button', { name: 'Отправить' }))
    await waitFor(() => expect(screen.getByTestId('location').textContent).toContain(V2), { timeout: 5000 })
    unmount()
    await act(async () => { await getRouteOutbox().flush({ timeoutMs: 3000 }) })
    expect(evs().filter(e => e.type === 'clip_played' && e.pid === RP)).toEqual([])
  }, 20000)
})

describe('L8 R58: «Следующий ролик →» выгружает очередь до перехода', () => {
  it('отчёт ролика отправлен к моменту перехода на /app/route?next=', async () => {
    routeOn()
    stateOverride = () => baseState({ next_clip: { title: 'N' } })
    mountSpa(`/player?v=${V}&rp=${encodeURIComponent(RP)}`)
    await waitFor(() => expect(stateGets).toBeGreaterThan(0))
    await waitFor(() => expect(h.adapter).toBeTruthy())
    await pause(50)
    for (const t of [10, 60, 100]) { act(() => { h.adapter._setTime(t) }); await pause(200) }
    act(() => { h.adapter._setTime(119.8); h.adapter._emit('state', 'ended') })
    await pause(300)
    const card = await screen.findByTestId('route-end-card')
    let sentAtNav = -1
    fireEvent.click(within(card).getByRole('button', { name: /Следующий ролик/ }))
    await waitFor(() => {
      const loc = screen.getByTestId('location').textContent ?? ''
      if (loc.startsWith('/app/route') && sentAtNav < 0) sentAtNav = evs().filter(e => e.type === 'clip_played').length
      expect(loc.startsWith('/app/route')).toBe(true)
    })
    expect(sentAtNav).toBeGreaterThan(0)
  }, 15000)
})

describe('L6: карточка конца ролика не закрывает оценку', () => {
  it('при открытой карточке у VideoVoteBar класс поверх карточки', async () => {
    routeOn()
    mountSpa(`/player?v=${V}&rp=${encodeURIComponent(RP)}`)
    await waitFor(() => expect(stateGets).toBeGreaterThan(0))
    await waitFor(() => expect(h.adapter).toBeTruthy())
    await pause(50)
    expect(screen.getByTestId('video-vote-bar').classList.contains('vvb-raised')).toBe(false)
    act(() => { h.adapter._setTime(119.8); h.adapter._emit('state', 'ended') })
    await screen.findByTestId('route-end-card')
    expect(screen.getByTestId('video-vote-bar').classList.contains('vvb-raised')).toBe(true)
  })
})

describe('второй круг: замена из плеера — свежее состояние, отчёт, пометка', () => {
  async function openAndWatch() {
    routeOn()
    const r = mountSpa(`/player?v=${V}&rp=${encodeURIComponent(RP)}`)
    await waitFor(() => expect(stateGets).toBeGreaterThan(0))
    await waitFor(() => expect(h.adapter).toBeTruthy())
    await pause(60)
    for (const t of [10, 30, 60, 80]) { act(() => { h.adapter._setTime(t) }); await pause(150) }
    return r
  }
  async function dislikeWithTick() {
    const bar = await openDislike()
    fireEvent.click(within(bar).getByLabelText('Не интересно'))
    fireEvent.click(within(bar).getByRole('button', { name: 'Отправить' }))
  }
  const watched = () => JSON.parse(localStorage.getItem('flib:route-watched') ?? 'null')

  it('замена отказана (ролик стал kept) — отчёт этого открытия всё равно уходит', async () => {
    const { unmount } = await openAndWatch()
    stateOverride = () => baseState({ revision: 6, current_puzzle_id: RP2, day: { date: today, clips: [{ ...row(RP, V), played: true, kept: true }, row(RP2, V2)] } })
    await dislikeWithTick()
    await waitFor(() => expect(document.querySelector('.vvb-route-status')?.textContent).toBe('Замена сейчас недоступна'), { timeout: 3000 })
    unmount()
    await pause(100)
    await act(async () => { await getRouteOutbox().flush({ timeoutMs: 3000 }) })
    expect(evs().filter(e => e.type === 'clip_played' && e.pid === RP).length).toBe(1)
    expect(calls.filter(c => c.url === '/api/me/route/exchange').length).toBe(0)
  }, 20000)

  it('свежее чтение не удалось (503) — «Не удалось проверить маршрут. Попробуйте ещё раз», обмена нет', async () => {
    await openAndWatch()
    stateOverride = () => { throw new Error('unused') }
    const f = (globalThis.fetch as unknown as { getMockImplementation: () => (u: string, i?: RequestInit) => Promise<Response> }).getMockImplementation()
    vi.stubGlobal('fetch', vi.fn((u: string, i?: RequestInit) => String(u).startsWith('/api/me/route/state') ? later(5, 503, { error: 'gateway_unavailable' }, { 'Retry-After': '1' }) : f(u, i)))
    __resetRouteStateForTests()
    await dislikeWithTick()
    await waitFor(() => expect(document.querySelector('.vvb-route-status')?.textContent).toBe('Не удалось проверить маршрут. Попробуйте ещё раз'), { timeout: 3000 })
    expect(calls.filter(c => c.url === '/api/me/route/exchange').length).toBe(0)
  }, 20000)

  it('замена уходит со СВЕЖЕЙ ревизией; после коммита ролик помечен заменённым', async () => {
    await openAndWatch()
    stateOverride = () => (afterCommitApplied ? afterCommitApplied : baseState({ revision: 7 }))
    afterCommit = baseState({ revision: 8, current_puzzle_id: RP2, day: { date: today, clips: [row(RP2, V2)] } })
    await dislikeWithTick()
    await waitFor(() => expect(screen.getByTestId('location').textContent).toContain(V2), { timeout: 5000 })
    expect(calls.find(c => c.url === '/api/me/route/exchange')!.body).toMatchObject({ expected_revision: 7, replace_puzzle_id: RP })
    expect(watched()?.replaced ?? []).toContain(RP)
  }, 20000)

  it('замена не выполнена (409 stale_revision) — пометки нет', async () => {
    await openAndWatch()
    exchangeReply = () => later(5, 409, { error: 'stale_revision', revision: 9 })
    await dislikeWithTick()
    await waitFor(() => expect(document.querySelector('.vvb-route-status')?.textContent).toBe('День изменился, пока шла замена, — замена не выполнена'), { timeout: 3000 })
    expect(watched()?.replaced ?? []).not.toContain(RP)
  }, 20000)
})
