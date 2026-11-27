// fix-prc-r1.test.tsx — ревью PR-C, правки LOW:
//   N1 — `sent` записи урока гасит только доли НИЖЕ порога зачёта 0.6: доля ≥ 0.6,
//        чью отметку снял сторож (демон обработал и не засчитал — например, день
//        пересобран до применения), при повторном открытии уходит снова (порт пробы
//        RL8b ревьюера); доля ниже порога — нет (L8, контроль);
//   N3 — сброс на странице маршрута перечитывает свежим запросом, не присоединяясь
//        к запросу, ушедшему до сброса;
//   N6 — `sent` пишется ПОД блокировкой очереди: пока блокировку держит другая
//        вкладка (navigator.locks), записи `sent` нет.
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

import { WordsLessonPage } from '../WordsLessonPage'
import { RoutePageCabinet } from '../RoutePageCabinet'
import { __resetSessionForTests, __setSessionForTests } from '../../../session'
import { __resetRouteStateForTests } from '../use-route-state'
import { __resetRouteOutboxForTests, getRouteOutbox } from '../outbox'
import { __resetDaysLoaderForTests } from '../route-days'
import { ROUTE_LESSON_KEY, ROUTE_WATCHED_KEY } from '../route-storage'
import { FakeRouteBFF, json, st, del, und, lesson, LocationProbe, renderRoutePage } from './route-page-fakes'
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
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); __resetRouteOutboxForTests(); __resetDaysLoaderForTests() })

const wait = (ms: number) => act(async () => { await new Promise(r => setTimeout(r, ms)) })
const yt = (ref: string, s = 1000, e = 3000) => ({ video_id: ref, start_ms: s, end_ms: e, text_en: `Line ${ref}`, text_ru: `Строка ${ref}` })
const lessonEvents = () => bff.events().filter(e => e.type === 'clip_played' && e.puzzle_id === LP)
const lessonObj = () => JSON.parse(localStorage.getItem(ROUTE_LESSON_KEY) || '{"items":{}}')
function examples(map: Record<string, Array<ReturnType<typeof yt>>>) {
  bff.examplesReply = w => json(200, map[w] ? { items: map[w], empty_reason: null } : { items: [], empty_reason: 'not_in_corpus' })
}
function lessonState(words: string[]): RouteState {
  return st([del(1, { played: true }), lesson('aaaa', { words, new_words: words.length }), und()])
}
function mount(path = `/app/route/words?rw=${encodeURIComponent(LP)}`) {
  return render(
    <MemoryRouter initialEntries={[path]}>
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
async function open(words: string[]) {
  bff.state = lessonState(words)
  const r = mount()
  await screen.findByTestId('lesson-meta')
  await waitFor(() => expect(screen.getByTestId(`word-${words[words.length - 1]}`).getAttribute('data-state')).not.toBe('searching'))
  return r
}
async function flush() { await act(async () => { await getRouteOutbox().flush({ timeoutMs: 3000 }) }) }
async function watchExample(word: string) {
  const n = h.adapters.length
  fireEvent.click(within(screen.getByTestId(`word-${word}`)).getByRole('button', { name: /Пример|Смотреть снова/ }))
  await waitFor(() => expect(h.adapters.length).toBe(n + 1))
  act(() => { h.adapters[h.adapters.length - 1].a._setTime(2.8) })
  await wait(260)
}
// pruneByRoutePage — демон обработал событие и строку не засчитал (played:false,
// без queued_played): настоящая страница маршрута снимает отметку сторожем.
async function pruneByRoutePage() {
  __resetRouteStateForTests()
  const r = mount('/app/route')
  await waitFor(() => expect(JSON.parse(localStorage.getItem(ROUTE_WATCHED_KEY) || '{"items":{}}').items[LP]).toBeUndefined())
  r.unmount()
  __resetRouteStateForTests()
}

describe('N1: `sent` гасит только доли ниже порога зачёта', () => {
  it('доля 1, проигнорированная демоном, при повторном открытии уходит снова (проба RL8b)', async () => {
    examples({ a1: [yt('abcDEF12301')] })
    let r = await open(['a1'])
    await watchExample('a1')
    await screen.findByTestId('lesson-done')
    await flush()
    expect(lessonEvents().map(e => e.played_frac)).toEqual([1])
    expect(lessonObj().items[LP].sent).toBe(1)
    r.unmount()
    await pruneByRoutePage()
    r = await open(['a1'])
    await screen.findByTestId('lesson-done')
    await flush()
    r.unmount()
    await flush()
    expect(lessonEvents().map(e => e.played_frac)).toEqual([1, 1])
  })

  it('доля 0.6 (ровно порог) тоже уходит снова', async () => {
    examples({ a1: [yt('abcDEF12301')], a2: [yt('abcDEF12302')], a3: [yt('abcDEF12303')], a4: [yt('abcDEF12304')], a5: [yt('abcDEF12305')] })
    let r = await open(['a1', 'a2', 'a3', 'a4', 'a5'])
    await watchExample('a1'); await watchExample('a2'); await watchExample('a3')
    r.unmount()
    await flush()
    expect(lessonEvents().map(e => e.played_frac)).toEqual([0.6])
    await pruneByRoutePage()
    r = await open(['a1', 'a2', 'a3', 'a4', 'a5'])
    r.unmount()
    await flush()
    expect(lessonEvents().map(e => e.played_frac)).toEqual([0.6, 0.6])
  })

  it('контроль: доля ниже порога (0.5) при повторном открытии не уходит', async () => {
    examples({ a1: [yt('abcDEF12301')], a2: [yt('abcDEF12302')] })
    let r = await open(['a1', 'a2'])
    await watchExample('a1')
    r.unmount()
    await flush()
    await pruneByRoutePage()
    r = await open(['a1', 'a2'])
    r.unmount()
    await flush()
    expect(lessonEvents().map(e => e.played_frac)).toEqual([0.5])
  })

  it('контроль: пока отметка просмотра на месте, доля 1 при повторном открытии не уходит', async () => {
    examples({ a1: [yt('abcDEF12301')] })
    let r = await open(['a1'])
    await watchExample('a1')
    await screen.findByTestId('lesson-done')
    await flush()
    r.unmount()
    __resetRouteStateForTests()
    r = await open(['a1'])
    await screen.findByTestId('lesson-done')
    r.unmount()
    await flush()
    expect(lessonEvents().map(e => e.played_frac)).toEqual([1])
  })
})

describe('N6: `sent` пишется под блокировкой очереди', () => {
  it('пока блокировку держит другая вкладка, `sent` нет; после её отпускания — есть', async () => {
    let tail: Promise<unknown> = Promise.resolve()
    const locks = {
      request: (_name: string, fn: () => Promise<unknown>) => {
        const run = tail.then(() => fn())
        tail = run.catch(() => undefined)
        return run
      },
    }
    Object.defineProperty(navigator, 'locks', { value: locks, configurable: true })
    try {
      __resetRouteOutboxForTests()
      examples({ a1: [yt('abcDEF12301')], a2: [yt('abcDEF12302')] })
      const r = await open(['a1', 'a2'])
      await watchExample('a1')
      // другая вкладка взяла блокировку очереди
      let release: () => void = () => {}
      void locks.request('flib-route-outbox', () => new Promise<void>(res => { release = res }))
      r.unmount()                                      // уход: доля 0.5 ставится в очередь
      await wait(30)
      expect(lessonObj().items[LP]?.sent).toBeUndefined()
      release()
      await wait(30)
      expect(lessonObj().items[LP].sent).toBe(0.5)
    } finally {
      delete (navigator as unknown as { locks?: unknown }).locks
    }
  })
})

describe('N3: сброс перечитывает свежим запросом', () => {
  it('чтение, ушедшее до сброса, висит; после DELETE — свой запрос и рассылка новой ревизии', async () => {
    const posted: unknown[] = []
    class BC {
      onmessage: ((e: MessageEvent) => void) | null = null
      constructor(public name: string) {}
      postMessage(m: unknown) { if (this.name === 'flib-route') posted.push(m) }
      close() {}
    }
    vi.stubGlobal('BroadcastChannel', BC)
    const before = st([del(1, { played: true }), del(2), und()])
    const after = st(null, { started: false, route_id: null, revision: 9, started_at: null })
    let reset = false
    let hold = false
    let releaseStale: (() => void) | null = null
    bff.state = () => {
      if (hold) { hold = false; return new Promise<Response>(r => { releaseStale = () => r(json(200, before)) }) }
      return json(200, reset ? after : before)
    }
    bff.resetReply = () => { reset = true; return json(200, { removed: 1 }) }
    renderRoutePage(bff)
    await screen.findByTestId('day-hero')
    const n = bff.stateGets
    hold = true
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await new Promise(r => setTimeout(r, 20)) })
    await waitFor(() => expect(bff.stateGets).toBe(n + 1))
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить маршрут' }))
    fireEvent.click(within(screen.getByTestId('reset-confirm')).getByRole('button', { name: 'Да, сбросить' }))
    await waitFor(() => expect(posted).toContainEqual({ revision: 9 }))
    expect(bff.stateGets).toBe(n + 2)
    await act(async () => { releaseStale!(); await new Promise(r => setTimeout(r, 20)) })
  })
})
