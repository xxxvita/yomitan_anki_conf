// fix-b3b-r2-lesson.test.tsx — ревью батча 3b, второй круг (урок слов). Порт
// проб `review-b3b-r1/probes/zz-r1-lesson.test.tsx` и `zz-r1-leave.test.tsx`:
//   R1-N1 — pagehide между приходом «убивающего» чтения и его отрисовкой: ничего
//           (RA2), контроль RA2c;
//   R1-L2 — `ended` без проигрывания в окне не засчитывает пример;
//   R1-L3 — поздний ответ после «Выхода» и нового входа в кэш не пишется;
//   R1-L5 — стражи: уход, пока чтения ещё падают, шлёт (LEAVE1); ушедший урок
//           после неудачного чтения не возвращается (L1y); дата плана в ключе
//           (H-date); `ended` после отказа не засчитывает (L3b).
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
import { setCabinetMarker } from '../../../__tests__/cabinet-marker'
import { FakeRouteBFF, json, st, del, und, lesson, LocationProbe, setRouteMarker } from './route-page-fakes'
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
const lessonEvents = () => bff.events().filter(e => e.type === 'clip_played' && e.puzzle_id === LP)
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
const REBUILT = () => st([del(7), und(), und()], { revision: 6 })
// stored — очередь событий и запасные ключи выгрузки (НЕ flib:route-lesson: там id урока законно).
const stored = () => JSON.stringify(keys().filter(k => k.startsWith('flib:route-outbox')).map(k => localStorage.getItem(k)))
function holdState(): { release: (s: RouteState) => void } {
  let rel: (r: Response) => void = () => {}
  bff.state = () => new Promise<Response>(r => { rel = r })
  return { release: s => rel(json(200, s)) }
}
async function startExample(word: string) {
  const before = h.adapters.length
  fireEvent.click(within(screen.getByTestId(`word-${word}`)).getByRole('button', { name: /Пример|Смотреть снова/ }))
  await waitFor(() => expect(h.adapters.length).toBeGreaterThan(before))
  return h.adapters[h.adapters.length - 1].a
}

describe('R1-N1: pagehide между приходом убивающего чтения и его отрисовкой', () => {
  it('RA2: чтение дошло до setRead, pagehide до отрисовки — ни события, ни записи', async () => {
    await openFive(['a1', 'a2', 'a3'])
    const held = holdState()
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    await wait(20)
    await act(async () => {
      held.release(REBUILT())
      await new Promise(r => setTimeout(r, 40))
      window.dispatchEvent(new Event('pagehide'))
    })
    await flush()
    expect(stored().includes(LP)).toBe(false)
    expect(readWatched()?.items[LP]).toBeUndefined()
    expect(lessonEvents()).toHaveLength(0)
  })

  it('RA2c: pagehide после отрисовки убивающего чтения — ничего', async () => {
    await openFive(['a1', 'a2', 'a3'])
    bff.state = REBUILT()
    await reread()
    await screen.findByTestId('lesson-gone')
    act(() => { window.dispatchEvent(new Event('pagehide')) })
    await wait(50)
    expect(stored().includes(LP)).toBe(false)
    expect(readWatched()?.items[LP]).toBeUndefined()
  })

  it('контроль: чтение с живой строкой дошло до setRead, pagehide до отрисовки — событие уходит', async () => {
    await openFive(['a1', 'a2', 'a3'])
    const held = holdState()
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    await wait(20)
    await act(async () => {
      held.release(lessonState(FIVE, { revision: 6 }))
      await new Promise(r => setTimeout(r, 40))
      window.dispatchEvent(new Event('pagehide'))
    })
    expect(stored()).toContain(LP)
    expect(readWatched()?.items[LP]?.share).toBe(0.6)
  })
})

describe('R1-L5: стражи', () => {
  it('LEAVE1: уход, пока чтения ещё падают, — событие 0,6', async () => {
    await openFive(['a1', 'a2', 'a3'])
    bff.state = () => json(503, { error: 'gateway_unavailable' }, { 'Retry-After': '30' })
    await reread()
    expect(screen.getByTestId('lesson-meta').textContent).toBe('Просмотрено 3 из 5 примеров')
    fireEvent.click(screen.getAllByRole('link', { name: '← К маршруту' })[0])
    await wait(150)
    await flush()
    expect(lessonEvents().map(e => e.played_frac)).toEqual([0.6])
  })

  it('L1y: чтение без строки, затем неудачное — урок не возвращается', async () => {
    await openFive(['a1', 'a2', 'a3'])
    bff.state = REBUILT()
    await reread()
    await screen.findByTestId('lesson-gone')
    bff.state = () => json(503, { error: 'gateway_unavailable' }, { 'Retry-After': '30' })
    await reread()
    expect(screen.queryByTestId('lesson-meta')).toBeNull()
  })

  it('H-date: новая дата плана с тем же id урока — новое открытие с нуля', async () => {
    await openFive(['a1', 'a2', 'a3'])
    const next = lessonState(FIVE, { revision: 6, snapshot_date: '2026-11-19' })
    next.day!.date = '2026-11-19'
    bff.state = next
    await reread()
    await waitFor(() => expect(screen.getByTestId('lesson-meta').textContent).toBe('Просмотрено 0 из 5 примеров'))
    await flush()
    expect(lessonEvents()).toHaveLength(0)
  })

  it('L3b: unplayable, затем ended — не засчитан, следующий элемент; error, затем ended — «Этот пример не открывается»', async () => {
    examples({ alpha: [yt('abcDEF12345'), yt('abcDEF12399')], beta: [yt('abcDEF12346')] })
    await open(lessonState(['alpha', 'beta']))
    await waitFor(() => expect(screen.getByTestId('word-beta').getAttribute('data-state')).toBe('example'))
    const a = await startExample('alpha')
    act(() => { a._emit('unplayable', { reason: 'embed-error', code: 150 }); a._emit('state', 'ended') })
    await waitFor(() => expect(h.adapters.map(x => x.id)).toContain('abcDEF12399'))
    expect(screen.getByTestId('lesson-meta').textContent).toBe('Просмотрено 0 из 2 примеров')
    const b = h.adapters[h.adapters.length - 1].a
    act(() => { b._emit('error', 2); b._emit('state', 'ended') })
    await waitFor(() => expect(screen.getByTestId('word-alpha').textContent).toContain('Этот пример не открывается'))
    expect(screen.getByTestId('word-alpha').textContent).not.toContain('✓ просмотрен')
  })
})

describe('R1-L2: ended без проигрывания', () => {
  it('ended от проигрывателя, уже отказавшего посреди окна, не засчитывает', async () => {
    examples({ alpha: [yt('abcDEF12345'), yt('abcDEF12399')], beta: [yt('abcDEF12346')] })
    await open(lessonState(['alpha', 'beta']))
    await waitFor(() => expect(screen.getByTestId('word-beta').getAttribute('data-state')).toBe('example'))
    const a = await startExample('alpha')
    act(() => { a._setTime(1.8) })
    await wait(260)
    // Отказ посреди окна — ошибкой встраивания: «не начат» (botwall-suspect) с
    // B12/L12 отказом больше не считается (fix-b12-lesson-autostart.test.tsx).
    act(() => { a._emit('error', 2); a._emit('unplayable', { reason: 'embed-error', code: 2 }) })
    await waitFor(() => expect(h.adapters.map(x => x.id)).toContain('abcDEF12399'))
    act(() => { a._setTime(2.5); a._emit('state', 'ended') })
    await wait(80)
    expect(screen.getByTestId('lesson-meta').textContent).toBe('Просмотрено 0 из 2 примеров')
  })

  it('L3a: ended сразу, позиция не дошла до окна — пример не засчитан, берётся следующий элемент', async () => {
    examples({ alpha: [yt('abcDEF12345', 200000, 205000), yt('abcDEF12399')], beta: [yt('abcDEF12346')] })
    await open(lessonState(['alpha', 'beta']))
    await waitFor(() => expect(screen.getByTestId('word-beta').getAttribute('data-state')).toBe('example'))
    const a = await startExample('alpha')
    act(() => { a._emit('state', 'ended') })
    await waitFor(() => expect(h.adapters.map(x => x.id)).toContain('abcDEF12399'))
    expect(screen.getByTestId('lesson-meta').textContent).toBe('Просмотрено 0 из 2 примеров')
    expect(screen.getByTestId('word-alpha').textContent).not.toContain('✓ просмотрен')
  })

  it('контроль: окно шло, ролик кончился раньше конца окна — засчитан', async () => {
    examples({ alpha: [yt('abcDEF12345', 100000, 125000)] })
    await open(lessonState(['alpha']))
    await waitFor(() => expect(screen.getByTestId('word-alpha').getAttribute('data-state')).toBe('example'))
    const a = await startExample('alpha')
    act(() => { a._setTime(110) })
    await wait(260)
    act(() => { a._setTime(120); a._emit('state', 'ended') })
    await screen.findByTestId('lesson-done')
  })
})

describe('R1-L3: поздний ответ после «Выхода» и нового входа', () => {
  it('L2x: ответ старого урока, пришедший после нового входа, в кэш не пишется', async () => {
    setCabinetMarker(true); setRouteMarker(true)
    let release: (r: Response) => void = () => {}
    bff.examplesReply = w => (w === 'alpha' ? new Promise<Response>(r => { release = r }) : json(200, { items: [yt('abcDEF12345')], empty_reason: null }))
    bff.state = lessonState(['alpha', 'beta'])
    render(
      <MemoryRouter initialEntries={[`/app/route/words?rw=${encodeURIComponent(LP)}`]}>
        <Routes>
          <Route path="/app" element={<CabinetLayout />}><Route path="route/words" element={<CabinetLessonGate />} /></Route>
          <Route path="/login" element={<div data-testid="login" />} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>,
    )
    await screen.findByTestId('lesson-meta')
    await waitFor(() => expect(screen.getByTestId('word-beta').getAttribute('data-state')).toBe('example'))
    act(() => {
      getRouteOutbox().eraseAfterLogout()
      __setSessionForTests({ cabinet: true, authenticated: false, state: null, reason: 'logout' })
    })
    await screen.findByTestId('login')
    expect(keys()).toEqual([])
    act(() => { getRouteOutbox().resume() })
    await act(async () => { release(json(200, { items: [yt('abcDEF12399')], empty_reason: null })); await new Promise(r => setTimeout(r, 80)) })
    expect(localStorage.getItem('flib:examples-cache')).toBeNull()
    expect(keys()).toEqual([])
  })

  it('контроль: без «Выхода» поздний ответ после ухода — в кэше', async () => {
    let release: (r: Response) => void = () => {}
    bff.examplesReply = w => (w === 'alpha' ? new Promise<Response>(r => { release = r }) : json(200, { items: [yt('abcDEF12345')], empty_reason: null }))
    const r = await open(lessonState(['alpha', 'beta']))
    await waitFor(() => expect(screen.getByTestId('word-beta').getAttribute('data-state')).toBe('example'))
    r.unmount()
    await act(async () => { release(json(200, { items: [yt('abcDEF12399')], empty_reason: null })); await new Promise(r2 => setTimeout(r2, 80)) })
    expect(localStorage.getItem('flib:examples-cache') ?? '').toContain('alpha')
  })
})
