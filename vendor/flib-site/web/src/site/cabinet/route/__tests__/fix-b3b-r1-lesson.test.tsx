// fix-b3b-r1-lesson.test.tsx — ревью батча 3b, правки первого круга (страница
// урока слов). Порт проб `review-b3b/probes/zz-b3b-lesson.test.tsx` и
// `zz-b3b-logout.test.tsx`:
//   H1 — урок, чья строка ушла из плана, пока страница открыта, не шлёт ничего и
//        не пишет `flib:route-watched` (§4.13 п.1 «событий нет»); уход, pagehide и
//        НЕУДАЧНОЕ чтение состояния по-прежнему шлют;
//   L1/L2 — неудачное перечитывание не сносит открытый урок; ответ, пришедший
//        после ухода со страницы, кладётся в кэш (кроме «Выхода»);
//   L3 — пример, чьё окно длиннее ролика, засчитывается по концу ролика;
//   L4 — 200 без массива `items` — «не загрузился», не кэшируется;
//   L10 — стражи: «просмотрен» только с end_ms − 250 мс, страница пишет
//        `flib:route-lesson`, «Следующий ролик →» только у текущего урока.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, fireEvent, screen, waitFor, within, act } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const h = vi.hoisted(() => ({ adapters: [] as Array<{ id: string; a: any }> }))
vi.mock('../../../../adapter/IFrameAdapter', () => ({
  createIFrameAdapter: async (_el: string, videoId: string) => {
    const { makeFakeAdapter } = await import('../../../../adapter/__tests__/fake')
    const a = makeFakeAdapter({ duration: 120, t: 0 })
    h.adapters.push({ id: videoId, a })
    return a
  },
}))

import { WordsLessonPage, CabinetLessonGate } from '../WordsLessonPage'
import { RoutePageCabinet } from '../RoutePageCabinet'
import { CabinetLayout } from '../../CabinetLayout'
import { __resetSessionForTests, __setSessionForTests } from '../../../session'
import { __resetRouteStateForTests } from '../use-route-state'
import { __resetRouteOutboxForTests, getRouteOutbox } from '../outbox'
import { __resetDaysLoaderForTests } from '../route-days'
import { readWatched } from '../../../../player/route-events/route-watched'
import { readLessonHeard } from '../words-lesson'
import { setCabinetMarker } from '../../../__tests__/cabinet-marker'
import { FakeRouteBFF, json, st, del, und, lesson, ROUTE, TODAY, LocationProbe, setRouteMarker } from './route-page-fakes'
import type { RouteState } from '../route-api'

const LP = 'words::aaaa'
let bff: FakeRouteBFF
beforeEach(() => {
  __resetSessionForTests(); __resetRouteStateForTests(); __resetRouteOutboxForTests(); __resetDaysLoaderForTests()
  localStorage.clear()
  h.adapters = []
  bff = new FakeRouteBFF()
  vi.stubGlobal('fetch', vi.fn((u: string, i?: RequestInit) => bff.fetch(u, i)))
  __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_abcd', routeAllowed: true, demo: false })
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); setCabinetMarker(false); setRouteMarker(false); __resetRouteOutboxForTests(); __resetDaysLoaderForTests() })

const wait = (ms: number) => act(async () => { await new Promise(r => setTimeout(r, ms)) })
const yt = (ref: string, s = 1000, e = 3000) => ({ video_id: ref, start_ms: s, end_ms: e, text_en: `Line ${ref}`, text_ru: `Строка ${ref}` })
const exCalls = () => bff.of('/api/me/route/examples').map(c => new URL(c.url, 'https://flib.club').searchParams.get('word'))
const lessonEvents = () => bff.events().filter(e => e.type === 'clip_played' && e.puzzle_id === LP)
const eventPosts = () => bff.of('/api/me/route/events', 'POST').map(c => c.body as { route_id: string; events: Array<Record<string, unknown>> })
const keys = () => Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)!)
function examples(map: Record<string, Array<ReturnType<typeof yt>>>) {
  bff.examplesReply = w => json(200, map[w] ? { items: map[w], empty_reason: null } : { items: [], empty_reason: 'not_in_corpus' })
}
function lessonState(words = ['alpha', 'beta', 'gamma'], over: Partial<RouteState> = {}, extra: Parameters<typeof lesson>[1] = {}) {
  return st([del(1, { played: true }), lesson('aaaa', { words, new_words: words.length, ...extra }), und()], over)
}
function mount(url = `/app/route/words?rw=${encodeURIComponent(LP)}`) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <div className="cab">
        <Routes>
          <Route path="/app/route/words" element={<WordsLessonPage />} />
          <Route path="/app/route" element={<RoutePageCabinet />} />
        </Routes>
        <LocationProbe />
      </div>
    </MemoryRouter>,
  )
}
async function open(s: RouteState) {
  bff.state = s
  const r = mount()
  await screen.findByTestId('lesson-meta')
  return r
}
async function watchExample(word: string, t = 2.8) {
  fireEvent.click(within(screen.getByTestId(`word-${word}`)).getByRole('button', { name: /Пример|Смотреть снова/ }))
  await waitFor(() => expect(h.adapters.length).toBeGreaterThan(0))
  const a = h.adapters[h.adapters.length - 1].a
  act(() => { a._setTime(t) })
  await wait(260)
  return a
}
async function flush() { await act(async () => { await getRouteOutbox().flush({ timeoutMs: 3000 }) }) }
const reread = () => act(async () => { document.dispatchEvent(new Event('visibilitychange')); await new Promise(r => setTimeout(r, 80)) })

const FIVE = ['a1', 'a2', 'a3', 'a4', 'a5']
async function openFive(watch: string[]) {
  examples(Object.fromEntries(FIVE.map((w, i) => [w, [yt(`vidvidvid0${i}`)]])))
  await open(lessonState(FIVE))
  await waitFor(() => expect(screen.getByTestId('word-a5').getAttribute('data-state')).toBe('example'))
  for (const w of watch) await watchExample(w)
  expect(lessonEvents()).toHaveLength(0)
}

describe('H1: строка урока ушла из плана, пока страница открыта — событий нет', () => {
  it('3 из 5, день пересобран в другой вкладке: ни события, ни записи, ни строки kept_local урока (L1a)', async () => {
    await openFive(['a1', 'a2', 'a3'])
    bff.state = st([del(7), und(), und()], { revision: 6 })
    await reread()
    await screen.findByTestId('lesson-gone')
    await flush()
    expect(lessonEvents()).toHaveLength(0)
    expect(readWatched()?.items[LP]).toBeUndefined()
    expect(localStorage.getItem('flib:route-outbox') ?? '').not.toContain(LP)
    fireEvent.click(screen.getByRole('link', { name: '← К маршруту' }))
    await screen.findByTestId('day-hero')
    const kinds = Array.from(document.querySelectorAll('[data-testid^="row-"]')).map(r => r.getAttribute('data-kind'))
    expect(kinds).not.toContain('kept_local')
    expect(screen.getByTestId('route-meta').textContent).toContain('0 из 3')
  })

  it('2 из 5 (доля 0,4), день пересобран: события нет (L1c)', async () => {
    await openFive(['a1', 'a2'])
    bff.state = st([del(7), und(), und()], { revision: 6 })
    await reread()
    await screen.findByTestId('lesson-gone')
    await flush()
    expect(lessonEvents()).toHaveLength(0)
  })

  it('маршрут сброшен в другом месте: ничего не уходит со старым route_id (L1d)', async () => {
    await openFive(['a1', 'a2', 'a3'])
    bff.state = st(null, { started: false, route_id: null, revision: 6, started_at: null })
    await reread()
    await screen.findByTestId('lesson-gone')
    await flush()
    expect(eventPosts().filter(p => p.route_id === ROUTE)).toHaveLength(0)
    expect(readWatched()?.items[LP]).toBeUndefined()
  })

  it('день сменился (новая дата плана, тот же id урока): событие за вчерашнюю строку не уходит', async () => {
    await openFive(['a1', 'a2', 'a3'])
    const next = lessonState(FIVE, { revision: 6, snapshot_date: '2026-11-19' })
    next.day!.date = '2026-11-19'
    bff.state = next
    await reread()
    await screen.findByTestId('lesson-meta')
    await flush()
    expect(lessonEvents()).toHaveLength(0)
  })

  it('контроль: уход «← К маршруту» на 3 из 5 — событие 0,6', async () => {
    await openFive(['a1', 'a2', 'a3'])
    bff.state = lessonState(FIVE, {}, { queued_played: true })
    fireEvent.click(screen.getAllByRole('link', { name: '← К маршруту' })[0])
    await screen.findByTestId('day-hero')
    await flush()
    expect(lessonEvents().map(e => e.played_frac)).toEqual([0.6])
  })

  it('контроль: pagehide на 3 из 5 — событие в очереди, отметка записана', async () => {
    await openFive(['a1', 'a2', 'a3'])
    act(() => { window.dispatchEvent(new Event('pagehide')) })
    const all = JSON.stringify(keys().map(k => localStorage.getItem(k)))
    expect(all).toContain(LP)
    expect(readWatched()?.items[LP]?.share).toBe(0.6)
  })

  it('контроль + L1: неудачное перечитывание (503) — урок остаётся открытым, при уходе событие уходит', async () => {
    await openFive(['a1', 'a2', 'a3'])
    const good = lessonState(FIVE)
    let fail = true
    bff.state = () => (fail ? json(503, { error: 'gateway_unavailable' }, { 'Retry-After': '1' }) : json(200, good))
    await reread()
    expect(screen.getByTestId('lesson-meta').textContent).toBe('Просмотрено 3 из 5 примеров')
    fail = false
    await wait(1300)
    expect(screen.getByTestId('lesson-meta').textContent).toBe('Просмотрено 3 из 5 примеров')
    expect(exCalls()).toHaveLength(5)
    fireEvent.click(screen.getAllByRole('link', { name: '← К маршруту' })[0])
    await screen.findByTestId('day-hero')
    await flush()
    expect(lessonEvents().map(e => e.played_frac)).toEqual([0.6])
  })
})

describe('L1/L2: ответ, пришедший после ухода со страницы', () => {
  function mountApp() {
    setCabinetMarker(true); setRouteMarker(true)
    return render(
      <MemoryRouter initialEntries={[`/app/route/words?rw=${encodeURIComponent(LP)}`]}>
        <Routes>
          <Route path="/app" element={<CabinetLayout />}><Route path="route/words" element={<CabinetLessonGate />} /></Route>
          <Route path="/login" element={<div data-testid="login" />} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>,
    )
  }
  async function run(how: 'logout' | 'leave') {
    let release: (r: Response) => void = () => {}
    bff.examplesReply = w => (w === 'alpha' ? new Promise<Response>(r => { release = r }) : json(200, { items: [yt('abcDEF12345')], empty_reason: null }))
    bff.state = lessonState(['alpha', 'beta'])
    const r = mountApp()
    await screen.findByTestId('lesson-meta')
    await waitFor(() => expect(screen.getByTestId('word-beta').getAttribute('data-state')).toBe('example'))
    if (how === 'logout') {
      act(() => {
        getRouteOutbox().eraseAfterLogout()
        __setSessionForTests({ cabinet: true, authenticated: false, state: null, reason: 'logout' })
      })
      await screen.findByTestId('login')
      expect(localStorage.getItem('flib:examples-cache')).toBeNull()
    } else {
      r.unmount()
    }
    await act(async () => { release(json(200, { items: [yt('abcDEF12399')], empty_reason: null })); await new Promise(r2 => setTimeout(r2, 80)) })
    return localStorage.getItem('flib:examples-cache')
  }

  it('после «Выхода» поздний ответ кэш не воскрешает и ничего не пишет (W45, L2b)', async () => {
    expect(await run('logout')).toBeNull()
    expect(keys()).toEqual([])
  })

  it('после обычного ухода поздний ответ — в кэше, и повторное открытие не тратит квоту (L2)', async () => {
    expect(await run('leave') ?? '').toContain('alpha')
    const n = exCalls().length
    __resetRouteStateForTests()
    setCabinetMarker(false); setRouteMarker(false)
    await open(lessonState(['alpha', 'beta']))
    await waitFor(() => expect(screen.getByTestId('word-alpha').getAttribute('data-state')).toBe('example'))
    expect(exCalls().length).toBe(n)
  })
})

describe('L3, L4 и стражи L10', () => {
  it('L3: окно примера длиннее ролика — по концу ролика (ended) пример просмотрен', async () => {
    examples({ alpha: [yt('abcDEF12345', 100000, 125000)] })
    await open(lessonState(['alpha']))
    await waitFor(() => expect(screen.getByTestId('word-alpha').getAttribute('data-state')).toBe('example'))
    fireEvent.click(within(screen.getByTestId('word-alpha')).getByRole('button', { name: /Пример/ }))
    await waitFor(() => expect(h.adapters.length).toBeGreaterThan(0))
    const a = h.adapters[h.adapters.length - 1].a
    act(() => { a._setTime(120); a._emit('state', 'ended') })
    await screen.findByTestId('lesson-done')
    expect(screen.getByTestId('lesson-meta').textContent).toBe('Просмотрено 1 из 1 примеров')
  })

  it('L4: 200 без массива items — «не загрузился», не в кэше, урок не засчитан', async () => {
    bff.examplesReply = () => new Response('<html>ok</html>', { status: 200, headers: { 'Content-Type': 'text/html' } })
    await open(lessonState(['alpha']))
    await waitFor(() => expect(screen.getByTestId('word-alpha').getAttribute('data-state')).toBe('failed'))
    expect(localStorage.getItem('flib:examples-cache') ?? '').not.toContain('alpha')
    expect(screen.queryByTestId('lesson-done')).toBeNull()
    await flush()
    expect(lessonEvents()).toHaveLength(0)
  })

  it('W44: позиция end_ms − 400 мс — ещё не просмотрен; end_ms − 240 мс — просмотрен', async () => {
    examples({ alpha: [yt('abcDEF12345', 1000, 3000)], beta: [yt('abcDEF12346')] })
    await open(lessonState(['alpha', 'beta']))
    await waitFor(() => expect(screen.getByTestId('word-beta').getAttribute('data-state')).toBe('example'))
    const a = await watchExample('alpha', 2.6)
    expect(screen.getByTestId('lesson-meta').textContent).toBe('Просмотрено 0 из 2 примеров')
    act(() => { a._setTime(2.76) })
    await wait(260)
    expect(screen.getByTestId('lesson-meta').textContent).toBe('Просмотрено 1 из 2 примеров')
  })

  it('W63: просмотренное слово страница записывает в flib:route-lesson', async () => {
    examples({ alpha: [yt('abcDEF12345')], beta: [yt('abcDEF12346')] })
    await open(lessonState(['alpha', 'beta']))
    await waitFor(() => expect(screen.getByTestId('word-beta').getAttribute('data-state')).toBe('example'))
    expect(readLessonHeard(ROUTE, TODAY, LP)).toEqual([])
    await watchExample('alpha')
    expect(readLessonHeard(ROUTE, TODAY, LP)).toEqual(['alpha'])
  })

  it('W59: урок пройден, но он не текущий (невыданные есть) — «← К маршруту», без «Следующий ролик →»', async () => {
    examples({})
    await open(st([lesson('aaaa', { words: ['alpha'] }), del(2), und()]))
    await screen.findByTestId('lesson-done')
    expect(within(screen.getByTestId('lesson-done')).queryByRole('button', { name: 'Следующий ролик →' })).toBeNull()
    expect(within(screen.getByTestId('lesson-done')).getByRole('link', { name: '← К маршруту' })).toBeTruthy()
  })
})
