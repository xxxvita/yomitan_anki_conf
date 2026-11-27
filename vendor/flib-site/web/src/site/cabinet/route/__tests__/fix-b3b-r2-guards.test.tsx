// fix-b3b-r2-guards.test.tsx — ревью батча 3b, второй круг: два пробела в тестах
// у работающих сторожей (порт проб `review-b3b-r2/probes/zz-r2-lesson.test.tsx`):
//   R2-L1 — правило seq у onArrive useRouteState: ответ СТАРШЕГО чтения, пришедший
//           после начала более нового, не перевзводит ключ живости урока
//           (пробы N1a, N1c; мутант «onArrive до проверки seq» обязан умирать);
//   R2-L2 — `ended` с позицией РОВНО на начале окна не засчитывает пример (проба
//           E3; мутант `>= start` обязан умирать). У настоящего адаптера часы
//           после resyncHard показывают start до первого опроса, поэтому
//           фальшивый адаптер здесь стартует с startSeconds, а не с 0.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, fireEvent, screen, waitFor, within, act } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const h = vi.hoisted(() => ({ adapters: [] as Array<{ id: string; a: any }> }))
vi.mock('../../../../adapter/IFrameAdapter', () => ({
  createIFrameAdapter: async (_el: string, videoId: string, opts: { startSeconds?: number }) => {
    const { makeFakeAdapter } = await import('../../../../adapter/__tests__/fake')
    const a = makeFakeAdapter({ duration: 120, t: opts?.startSeconds ?? 0 })
    h.adapters.push({ id: videoId, a })
    return a
  },
}))

import { WordsLessonPage } from '../WordsLessonPage'
import { RoutePageCabinet } from '../RoutePageCabinet'
import { __resetSessionForTests, __setSessionForTests } from '../../../session'
import { __resetRouteStateForTests, invalidateRouteStateRead } from '../use-route-state'
import { __resetRouteOutboxForTests } from '../outbox'
import { __resetDaysLoaderForTests } from '../route-days'
import { readWatched } from '../../../../player/route-events/route-watched'
import { FakeRouteBFF, json, st, del, und, lesson, LocationProbe } from './route-page-fakes'
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
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); __resetRouteOutboxForTests(); __resetDaysLoaderForTests() })

const wait = (ms: number) => act(async () => { await new Promise(r => setTimeout(r, ms)) })
const yt = (ref: string, s = 1000, e = 3000) => ({ video_id: ref, start_ms: s, end_ms: e, text_en: `Line ${ref}` })
const lessonEvents = () => bff.events().filter(e => e.type === 'clip_played' && e.puzzle_id === LP)
const keys = () => Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)!)
// stored — очередь событий и запасные ключи выгрузки (длина/key(i): Object.keys в jsdom ненадёжен).
const stored = () => JSON.stringify(keys().filter(k => k.startsWith('flib:route-outbox')).map(k => localStorage.getItem(k)))
const FIVE = ['a1', 'a2', 'a3', 'a4', 'a5']
const lessonState = (over: Partial<RouteState> = {}) => st([del(1, { played: true }), lesson('aaaa', { words: FIVE, new_words: 5 }), und()], over)
const REBUILT = () => st([del(7), und(), und()], { revision: 6 })
function mount() {
  return render(
    <MemoryRouter initialEntries={[`/app/route/words?rw=${encodeURIComponent(LP)}`]}>
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
async function startExample(word: string) {
  const before = h.adapters.length
  fireEvent.click(within(screen.getByTestId(`word-${word}`)).getByRole('button', { name: /Пример|Смотреть снова/ }))
  await waitFor(() => expect(h.adapters.length).toBeGreaterThan(before))
  return h.adapters[h.adapters.length - 1].a
}
async function openFive(watch: string[]) {
  bff.examplesReply = w => json(200, { items: [yt(`vidvidvid0${FIVE.indexOf(w)}`)], empty_reason: null })
  bff.state = lessonState()
  mount()
  await screen.findByTestId('lesson-meta')
  await waitFor(() => expect(screen.getByTestId('word-a5').getAttribute('data-state')).toBe('example'))
  for (const w of watch) {
    const a = await startExample(w)
    act(() => { a._setTime(2.8) })
    await wait(260)
  }
  expect(lessonEvents()).toHaveLength(0)
}
// Каждое чтение состояния получает свой промис; release(i, s) отвечает i-му чтению.
function holdStates() {
  const rel: Array<(r: Response) => void> = []
  bff.state = () => new Promise<Response>(r => { rel.push(r) })
  return { count: () => rel.length, release: (i: number, s: RouteState) => rel[i](json(200, s)) }
}
const vis = () => act(() => { document.dispatchEvent(new Event('visibilitychange')) })

describe('R2-L1: правило seq у onArrive', () => {
  it('N1a: старшее чтение («строки нет») приходит ПОСЛЕ показанного нового («строка жива») — отброшено, урок жив и шлёт при уходе', async () => {
    await openFive(['a1', 'a2', 'a3'])
    const hs = holdStates()
    vis() // чтение #0
    await wait(20)
    invalidateRouteStateRead() // следующее чтение не присоединяется к #0
    vis() // чтение #1
    await wait(20)
    expect(hs.count()).toBe(2)
    await act(async () => { hs.release(1, lessonState({ revision: 7 })); await new Promise(r => setTimeout(r, 40)) })
    await act(async () => { hs.release(0, REBUILT()); await new Promise(r => setTimeout(r, 40)) })
    expect(screen.queryByTestId('lesson-meta')).not.toBeNull()
    act(() => { window.dispatchEvent(new Event('pagehide')) })
    expect(stored().includes(LP)).toBe(true)
  })

  it('N1c: оба ответа в ОДНОЙ пачке, старший последним — учтён только новый («строки нет»): ничего не пишется', async () => {
    await openFive(['a1', 'a2', 'a3'])
    const hs = holdStates()
    vis()
    await wait(20)
    invalidateRouteStateRead()
    vis()
    await wait(20)
    await act(async () => {
      hs.release(1, REBUILT())
      await new Promise(r => setTimeout(r, 30))
      hs.release(0, lessonState({ revision: 5 }))
      await new Promise(r => setTimeout(r, 30))
      window.dispatchEvent(new Event('pagehide'))
    })
    expect(stored().includes(LP)).toBe(false)
    expect(readWatched()?.items[LP]).toBeUndefined()
  })
})

describe('R2-L2: ended ровно на начале окна', () => {
  it('E3: «ended» при позиции, всё ещё равной началу окна (опроса не было), — пример не засчитан', async () => {
    bff.examplesReply = w => (w === 'alpha'
      ? json(200, { items: [yt('abcDEF12345', 100000, 125000)], empty_reason: null })
      : json(200, { items: [yt('abcDEF12346')], empty_reason: null }))
    bff.state = st([del(1, { played: true }), lesson('aaaa', { words: ['alpha', 'beta'], new_words: 2 }), und()])
    mount()
    await screen.findByTestId('lesson-meta')
    await waitFor(() => expect(screen.getByTestId('word-beta').getAttribute('data-state')).toBe('example'))
    const a = await startExample('alpha')
    expect(a.currentTime()).toBe(100)
    act(() => { a._emit('state', 'ended') })
    await wait(80)
    expect(screen.getByTestId('word-alpha').textContent).not.toContain('✓ просмотрен')
    expect(screen.getByTestId('lesson-meta').textContent).toBe('Просмотрено 0 из 1 примеров')
  })
})
