// fix-prc-lesson.test.tsx — PR-C (до включения флага маршрута), урок слов:
//   M1  — пример, чей плеер так и не запустился («Нажмите ▶…»), можно пропустить
//         кнопкой «Следующий пример» (только нажатием, никогда сам);
//   L5  — «Выход» на странице урока не теряет неотправленную долю: она ставится в
//         очередь до выгрузки перед выходом;
//   L8  — доля, которую демон не засчитал, при повторном открытии не уходит снова
//         (память «отправленной доли» на дату плана переживает удаление отметки);
//   L10 — пара охран «урок sameSession / очередь closed»: охрана урока сама по себе
//         (после «Выхода» урок не зовёт очередь вовсе).
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
import { LESSON_TAP_HINT, LESSON_SKIP_TEXT } from '../LessonExamplePlayer'
import { __resetSessionForTests, __setSessionForTests } from '../../../session'
import { __resetRouteStateForTests } from '../use-route-state'
import { __resetRouteOutboxForTests, getRouteOutbox } from '../outbox'
import { __resetDaysLoaderForTests } from '../route-days'
import { ROUTE_WATCHED_KEY } from '../route-storage'
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
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); __resetRouteOutboxForTests(); __resetDaysLoaderForTests() })

const wait = (ms: number) => act(async () => { await new Promise(r => setTimeout(r, ms)) })
const yt = (ref: string, s = 1000, e = 3000) => ({ video_id: ref, start_ms: s, end_ms: e, text_en: `Line ${ref}`, text_ru: `Строка ${ref}` })
const lessonEvents = () => bff.events().filter(e => e.type === 'clip_played' && e.puzzle_id === LP)
function examples(map: Record<string, Array<ReturnType<typeof yt>>>) {
  bff.examplesReply = w => json(200, map[w] ? { items: map[w], empty_reason: null } : { items: [], empty_reason: 'not_in_corpus' })
}
function lessonState(words: string[]): RouteState {
  return st([del(1, { played: true }), lesson('aaaa', { words, new_words: words.length }), und()])
}
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
async function open(words: string[]) {
  bff.state = lessonState(words)
  const r = mount()
  await screen.findByTestId('lesson-meta')
  await waitFor(() => expect(screen.getByTestId(`word-${words[words.length - 1]}`).getAttribute('data-state')).toBe('example'))
  return r
}
async function flush() { await act(async () => { await getRouteOutbox().flush({ timeoutMs: 3000 }) }) }
const meta = () => screen.getByTestId('lesson-meta').textContent
const lastAdapter = () => h.adapters[h.adapters.length - 1].a
async function startExample(word: string) {
  const n = h.adapters.length
  fireEvent.click(within(screen.getByTestId(`word-${word}`)).getByRole('button', { name: /Пример|Смотреть снова/ }))
  await waitFor(() => expect(h.adapters.length).toBe(n + 1))
}
async function watchExample(word: string) {
  await startExample(word)
  act(() => { lastAdapter()._setTime(2.8) })
  await wait(260)
}
function blockStart() { act(() => { lastAdapter()._emit('unplayable', { reason: 'botwall-suspect' }) }) }
const skipButton = (word: string) => within(screen.getByTestId(`word-${word}`)).queryByRole('button', { name: LESSON_SKIP_TEXT })

describe('M1: пример, который так и не запустился, можно пропустить нажатием', () => {
  it('рядом с подсказкой — кнопка «Следующий пример»; нажатие берёт следующий элемент ответа', async () => {
    examples({ alpha: [yt('abcDEF12345'), yt('abcDEF12399')], beta: [yt('abcDEF12346')] })
    await open(['alpha', 'beta'])
    await startExample('alpha')
    expect(skipButton('alpha')).toBeNull()        // до «не начат» кнопки нет
    blockStart()
    await wait(30)
    expect(within(screen.getByTestId('word-alpha')).getByText(LESSON_TAP_HINT)).toBeTruthy()
    fireEvent.click(skipButton('alpha')!)
    await waitFor(() => expect(h.adapters.map(x => x.id)).toEqual(['abcDEF12345', 'abcDEF12399']))
    expect(screen.getByTestId('word-alpha').getAttribute('data-state')).toBe('example')
    expect(screen.queryByText(LESSON_TAP_HINT)).toBeNull()
    expect(meta()).toBe('Просмотрено 0 из 2 примеров')
  })

  it('элементы кончились нажатиями — «Этот пример не открывается», слово вне M, урок засчитывается', async () => {
    examples({ alpha: [yt('abcDEF12345'), yt('abcDEF12399')], beta: [yt('abcDEF12346')] })
    await open(['alpha', 'beta'])
    await watchExample('beta')
    expect(meta()).toBe('Просмотрено 1 из 2 примеров')
    await startExample('alpha')
    blockStart(); await wait(30)
    fireEvent.click(skipButton('alpha')!)
    await waitFor(() => expect(h.adapters.length).toBe(3))
    blockStart(); await wait(30)
    fireEvent.click(skipButton('alpha')!)
    await waitFor(() => expect(screen.getByTestId('word-alpha').getAttribute('data-state')).toBe('none'))
    expect(screen.getByTestId('word-alpha').textContent).toContain('Этот пример не открывается')
    expect(meta()).toBe('Просмотрено 1 из 1 примеров')
    await screen.findByTestId('lesson-done')
    await flush()
    expect(lessonEvents().map(e => e.played_frac)).toEqual([1])
  })

  it('без нажатия ничего не меняется: тот же пример, подсказка и кнопка на месте, событий нет', async () => {
    examples({ alpha: [yt('abcDEF12345'), yt('abcDEF12399')] })
    await open(['alpha'])
    await startExample('alpha')
    blockStart()
    await wait(400)
    expect(h.adapters.map(x => x.id)).toEqual(['abcDEF12345'])
    expect(skipButton('alpha')).not.toBeNull()
    expect(screen.getByTestId('word-alpha').getAttribute('data-state')).toBe('example')
    expect(meta()).toBe('Просмотрено 0 из 1 примеров')
    await flush()
    expect(lessonEvents()).toHaveLength(0)
  })

  it('кнопка исчезает, как только ролик пошёл (нажатие на видео сработало)', async () => {
    examples({ alpha: [yt('abcDEF12345')] })
    await open(['alpha'])
    await startExample('alpha')
    blockStart(); await wait(30)
    expect(skipButton('alpha')).not.toBeNull()
    act(() => { lastAdapter()._emit('state', 'playing') })
    await wait(30)
    expect(skipButton('alpha')).toBeNull()
  })

  it('режим «Смотреть все подряд»: пропуск единственного элемента идёт к следующему слову', async () => {
    examples({ alpha: [yt('abcDEF12345')], beta: [yt('abcDEF12346')] })
    await open(['alpha', 'beta'])
    fireEvent.click(screen.getByRole('button', { name: 'Смотреть все подряд' }))
    await waitFor(() => expect(h.adapters.length).toBe(1))
    blockStart(); await wait(30)
    fireEvent.click(skipButton('alpha')!)
    await waitFor(() => expect(h.adapters.map(x => x.id)).toEqual(['abcDEF12345', 'abcDEF12346']))
    expect(screen.getByTestId('word-alpha').getAttribute('data-state')).toBe('none')
  })

  it('контроль: настоящий отказ встраивания по-прежнему берёт следующий элемент сам', async () => {
    examples({ alpha: [yt('abcDEF12345'), yt('abcDEF12399')] })
    await open(['alpha'])
    await startExample('alpha')
    act(() => { lastAdapter()._emit('error', 150) })
    await waitFor(() => expect(h.adapters.map(x => x.id)).toEqual(['abcDEF12345', 'abcDEF12399']))
  })
})

describe('L5: «Выход» на странице урока', () => {
  it('выгрузка перед «Выходом» уносит выросшую долю (3 из 4 = 0.75)', async () => {
    examples({ a1: [yt('abcDEF12301')], a2: [yt('abcDEF12302')], a3: [yt('abcDEF12303')], a4: [yt('abcDEF12304')] })
    await open(['a1', 'a2', 'a3', 'a4'])
    await watchExample('a1'); await watchExample('a2'); await watchExample('a3')
    expect(meta()).toBe('Просмотрено 3 из 4 примеров')
    expect(lessonEvents()).toHaveLength(0)
    await act(async () => { await getRouteOutbox().logoutFlush() })
    expect(lessonEvents().map(e => e.played_frac)).toEqual([0.75])
  })

  it('доля не выросла против отправленной — выгрузка перед «Выходом» её не повторяет', async () => {
    examples({ a1: [yt('abcDEF12301')], a2: [yt('abcDEF12302')] })
    await open(['a1', 'a2'])
    await watchExample('a1')
    await act(async () => { await getRouteOutbox().logoutFlush() })
    await act(async () => { await getRouteOutbox().logoutFlush() })
    expect(lessonEvents().map(e => e.played_frac)).toEqual([0.5])
  })

  it('урок, ушедший со страницы, в выгрузку перед «Выходом» не попадает (подписка снята)', async () => {
    examples({ a1: [yt('abcDEF12301')], a2: [yt('abcDEF12302')] })
    const r = await open(['a1', 'a2'])
    await watchExample('a1')
    r.unmount()
    await flush()
    const n = lessonEvents().length
    await act(async () => { await getRouteOutbox().logoutFlush() })
    expect(lessonEvents()).toHaveLength(n)
  })
})

describe('L5: «Выход» между приходом убивающего чтения и его отрисовкой', () => {
  const W3 = ['a1', 'a2', 'a3']
  async function openWatched() {
    examples({ a1: [yt('abcDEF12301')], a2: [yt('abcDEF12302')], a3: [yt('abcDEF12303')] })
    await open(W3)
    await watchExample('a1'); await watchExample('a2')
    expect(lessonEvents()).toHaveLength(0)
  }
  function holdState(): { release: (s: RouteState) => void } {
    let rel: (r: Response) => void = () => {}
    bff.state = () => new Promise<Response>(r => { rel = r })
    return { release: s => rel(json(200, s)) }
  }
  async function logoutAfterArrival(next: RouteState) {
    const held = holdState()
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    await wait(20)
    let p: Promise<void> = Promise.resolve()
    await act(async () => {
      held.release(next)
      await new Promise(r => setTimeout(r, 40))
      p = getRouteOutbox().logoutFlush()
    })
    await act(async () => { await p })
    await flush()
  }

  it('строка урока ушла из плана (чтение пришло, не отрисовано) — выгрузка «Выхода» ничего не ставит', async () => {
    await openWatched()
    await logoutAfterArrival(st([del(7), und(), und()], { revision: 6 }))
    expect(lessonEvents()).toHaveLength(0)
  })

  it('контроль: строка жива — выгрузка «Выхода» уносит долю 0.667', async () => {
    await openWatched()
    await logoutAfterArrival({ ...lessonState(W3), revision: 6 })
    expect(lessonEvents().map(e => e.played_frac)).toEqual([0.667])
  })
})

describe('L8: доля, которую демон не засчитал, при повторном открытии не уходит снова', () => {
  async function leaveWithHalf() {
    examples({ a1: [yt('abcDEF12301')], a2: [yt('abcDEF12302')] })
    const r = await open(['a1', 'a2'])
    await watchExample('a1')
    r.unmount()
    await flush()
    expect(lessonEvents().map(e => e.played_frac)).toEqual([0.5])
    // Демон долю 0.5 не засчитал: сторож pruneWatched снял отметку урока.
    localStorage.removeItem(ROUTE_WATCHED_KEY)
    __resetRouteStateForTests()
  }

  it('повторное открытие и уход без нового просмотра — второго события нет', async () => {
    await leaveWithHalf()
    const r = await open(['a1', 'a2'])
    expect(meta()).toBe('Просмотрено 1 из 2 примеров')
    r.unmount()
    await flush()
    expect(lessonEvents().map(e => e.played_frac)).toEqual([0.5])
  })

  it('pagehide повторного открытия без нового просмотра тоже ничего не шлёт', async () => {
    await leaveWithHalf()
    await open(['a1', 'a2'])
    act(() => { window.dispatchEvent(new Event('pagehide')) })
    await flush()
    expect(lessonEvents().map(e => e.played_frac)).toEqual([0.5])
  })

  it('доля выросла при повторном открытии — уходит только она', async () => {
    await leaveWithHalf()
    await open(['a1', 'a2'])
    await watchExample('a2')
    await screen.findByTestId('lesson-done')
    await flush()
    expect(lessonEvents().map(e => e.played_frac)).toEqual([0.5, 1])
  })
})

describe('L10: охрана урока сама по себе (пара «урок sameSession / очередь closed»)', () => {
  it('после «Выхода» уход с урока не зовёт очередь вовсе (контроль: до «Выхода» зовёт)', async () => {
    examples({ a1: [yt('abcDEF12301')], a2: [yt('abcDEF12302')], a3: [yt('abcDEF12303')] })
    const box = getRouteOutbox()
    const spy = vi.spyOn(box, 'enqueueDurable')
    const r = await open(['a1', 'a2', 'a3'])
    await watchExample('a1')
    act(() => { window.dispatchEvent(new Event('pagehide')) })
    expect(spy).toHaveBeenCalledTimes(1)            // положительный контроль
    await watchExample('a2')                        // доля 0.667 > отправленной 0.333
    spy.mockClear()
    // «Выход» в этой вкладке: очередь закрыта, но страница ещё не размонтирована.
    act(() => { box.eraseAfterLogout() })
    act(() => { window.dispatchEvent(new Event('pagehide')) })
    r.unmount()
    await wait(30)
    expect(spy).not.toHaveBeenCalled()
  })
})
