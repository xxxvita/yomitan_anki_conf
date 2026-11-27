// fix-b12-lesson-autostart.test.tsx — живой прогон B12, L12 (ревью 3b): браузер,
// который не даёт программно запустить ролик примера (политика автозапуска:
// мобильный Chrome, iOS, `--autoplay-policy=user-gesture-required`), держит
// iframe в состоянии «не начат», и через 15 с адаптер шлёт
// `unplayable {reason:'botwall-suspect'}`. Раньше урок считал это «пример не
// открывается», брал следующий элемент, а когда так кончались все слова —
// M = 0, доля 1, «Урок пройден» и clip_played урока без единого просмотра
// (воспроизведено в headless Chromium с user-gesture-required: «Просмотрено 0
// из 0 примеров», DONE за 78 с). Теперь «не начат» — не «не встраивается»:
// пример ждёт нажатия на видео (подсказка), слово остаётся в M. Настоящий отказ
// встраивания (коды 100/101/150, событие `error`) по-прежнему берёт следующий
// элемент.
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
import { LESSON_TAP_HINT } from '../LessonExamplePlayer'
import { __resetSessionForTests, __setSessionForTests } from '../../../session'
import { __resetRouteStateForTests } from '../use-route-state'
import { __resetRouteOutboxForTests, getRouteOutbox } from '../outbox'
import { __resetDaysLoaderForTests } from '../route-days'
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
function examples(map: Record<string, Array<ReturnType<typeof yt>>>) {
  bff.examplesReply = w => json(200, map[w] ? { items: map[w], empty_reason: null } : { items: [], empty_reason: 'not_in_corpus' })
}
function lessonState(words: string[]): RouteState {
  return st([del(1, { played: true }), lesson('aaaa', { words, new_words: words.length }), und()])
}
async function open(words: string[]) {
  bff.state = lessonState(words)
  render(
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
  await screen.findByTestId('lesson-meta')
  await waitFor(() => expect(screen.getByTestId(`word-${words[words.length - 1]}`).getAttribute('data-state')).toBe('example'))
}
async function flush() { await act(async () => { await getRouteOutbox().flush({ timeoutMs: 3000 }) }) }
const meta = () => screen.getByTestId('lesson-meta').textContent

describe('L12: автозапуск примера заблокирован браузером', () => {
  it('«не начат» (botwall-suspect) — слово остаётся в M, следующий элемент НЕ берётся, видна подсказка нажать на видео', async () => {
    examples({ alpha: [yt('abcDEF12345'), yt('abcDEF12399')], beta: [yt('abcDEF12346')] })
    await open(['alpha', 'beta'])
    fireEvent.click(within(screen.getByTestId('word-alpha')).getByRole('button', { name: /Пример/ }))
    await waitFor(() => expect(h.adapters.length).toBe(1))
    const a = h.adapters[0].a
    act(() => { a._emit('unplayable', { reason: 'botwall-suspect' }) })
    await wait(80)
    expect(h.adapters.map(x => x.id)).toEqual(['abcDEF12345'])
    expect(screen.getByTestId('word-alpha').getAttribute('data-state')).toBe('example')
    expect(screen.getByTestId('word-alpha').textContent).not.toContain('Этот пример не открывается')
    expect(meta()).toBe('Просмотрено 0 из 2 примеров')
    expect(within(screen.getByTestId('word-alpha')).getByText(LESSON_TAP_HINT)).toBeTruthy()
  })

  it('после нажатия на видео пример проигрывается и засчитывается, подсказка исчезает', async () => {
    examples({ alpha: [yt('abcDEF12345')] })
    await open(['alpha'])
    fireEvent.click(within(screen.getByTestId('word-alpha')).getByRole('button', { name: /Пример/ }))
    await waitFor(() => expect(h.adapters.length).toBe(1))
    const a = h.adapters[0].a
    act(() => { a._emit('unplayable', { reason: 'botwall-suspect' }) })
    await wait(30)
    act(() => { a._emit('state', 'playing') })
    await wait(30)
    expect(screen.queryByText(LESSON_TAP_HINT)).toBeNull()
    act(() => { a._setTime(2.8) })
    await screen.findByTestId('lesson-done')
    expect(meta()).toBe('Просмотрено 1 из 1 примеров')
  })

  it('все примеры «не начаты» — урок НЕ пройден и clip_played урока не уходит (раньше: 0 из 0, DONE, доля 1)', async () => {
    examples({ alpha: [yt('abcDEF12345')], beta: [yt('abcDEF12346')] })
    await open(['alpha', 'beta'])
    fireEvent.click(screen.getByRole('button', { name: 'Смотреть все подряд' }))
    await waitFor(() => expect(h.adapters.length).toBe(1))
    act(() => { h.adapters[0].a._emit('unplayable', { reason: 'botwall-suspect' }) })
    await wait(80)
    // Пользователь переходит к другому слову сам — и там автозапуск заблокирован.
    fireEvent.click(within(screen.getByTestId('word-beta')).getByRole('button', { name: /Пример/ }))
    await waitFor(() => expect(h.adapters.length).toBe(2))
    act(() => { h.adapters[1].a._emit('unplayable', { reason: 'botwall-suspect' }) })
    await wait(80)
    expect(screen.queryByTestId('lesson-done')).toBeNull()
    expect(meta()).toBe('Просмотрено 0 из 2 примеров')
    await flush()
    expect(lessonEvents()).toHaveLength(0)
  })

  it('контроль: настоящий отказ встраивания (error 150) по-прежнему берёт следующий элемент', async () => {
    examples({ alpha: [yt('abcDEF12345'), yt('abcDEF12399')] })
    await open(['alpha'])
    fireEvent.click(within(screen.getByTestId('word-alpha')).getByRole('button', { name: /Пример/ }))
    await waitFor(() => expect(h.adapters.length).toBe(1))
    act(() => { h.adapters[0].a._emit('error', 150); h.adapters[0].a._emit('unplayable', { reason: 'embed-error', code: 150 }) })
    await waitFor(() => expect(h.adapters.map(x => x.id)).toContain('abcDEF12399'))
  })
})
