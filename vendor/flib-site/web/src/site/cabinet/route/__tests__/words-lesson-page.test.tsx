// words-lesson-page.test.tsx — страница урока слов (план B10f, «Приёмка», web;
// спека 2026-11-17 §4.13, §7 случаи 45–53, §13 утверждение 8).
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
import { readWatched, writeWatched } from '../../../../player/route-events/route-watched'
import { addLessonHeard } from '../words-lesson'
import { FakeRouteBFF, json, st, del, und, kept, lesson, pid, vid, ROUTE, TODAY, LocationProbe } from './route-page-fakes'
import fixtures from '../../../../player/route-events/__fixtures__/site-events.json'
import type { RouteState } from '../route-api'
import { markClipListened, __resetClipListenedForTests } from '../../../../player/route-events/clip-listened'

const LP = 'words::aaaa'
let bff: FakeRouteBFF
beforeEach(() => {
  __resetSessionForTests(); __resetRouteStateForTests(); __resetRouteOutboxForTests(); __resetDaysLoaderForTests()
  localStorage.clear(); __resetClipListenedForTests(); for (const n of [1, 2, 3]) markClipListened(pid(n))
  h.adapters = []
  bff = new FakeRouteBFF()
  vi.stubGlobal('fetch', vi.fn((u: string, i?: RequestInit) => bff.fetch(u, i)))
  __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_abcd', routeAllowed: true, demo: false })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); __resetRouteOutboxForTests(); __resetDaysLoaderForTests() })

const wait = (ms: number) => act(async () => { await new Promise(r => setTimeout(r, ms)) })
const yt = (ref: string, s = 1000, e = 3000) => ({ video_id: ref, start_ms: s, end_ms: e, text_en: `Line ${ref}`, text_ru: `Строка ${ref}` })
const exCalls = () => bff.of('/api/me/route/examples').map(c => new URL(c.url, 'https://flib.club').searchParams.get('word'))
const lessonEvents = () => bff.events().filter(e => e.type === 'clip_played' && e.puzzle_id === LP)
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
          <Route path="/player" element={<div data-testid="player" />} />
        </Routes>
        <LocationProbe />
      </div>
    </MemoryRouter>,
  )
}
async function open(s: RouteState, url?: string) {
  bff.state = s
  const r = mount(url)
  await screen.findByTestId('lesson-meta')
  return r
}
async function watchExample(word: string) {
  fireEvent.click(within(screen.getByTestId(`word-${word}`)).getByRole('button', { name: /Пример|Смотреть снова/ }))
  await waitFor(() => expect(h.adapters.length).toBeGreaterThan(0))
  const a = h.adapters[h.adapters.length - 1].a
  act(() => { a._setTime(2.8) })
  await wait(260)
}
async function flush() { await act(async () => { await getRouteOutbox().flush({ timeoutMs: 3000 }) }) }

describe('B10f: запросы примеров', () => {
  it('запрос примеров несёт X-Flib-Request: 1 (сам fetch, R-C1), ключ в браузере не нужен', async () => {
    examples({})
    await open(lessonState(['alpha']))
    await waitFor(() => expect(exCalls()).toEqual(['alpha']))
    const f = (globalThis.fetch as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls.find(c => String(c[0]).startsWith('/api/me/route/examples'))!
    expect((f[1].headers as Record<string, string>)['X-Flib-Request']).toBe('1')
    expect(f[1].method).toBe('GET')
    expect(f[1].credentials).toBe('same-origin')
  })

  it('403 csrf у слова — «не загрузился» без автоповтора, очередь идёт дальше', async () => {
    bff.examplesReply = w => (w === 'alpha' ? json(403, { error: 'csrf' }) : json(200, { items: [yt('abcDEF12345')], empty_reason: null }))
    await open(lessonState(['alpha', 'beta']))
    await waitFor(() => expect(screen.getByTestId('word-alpha').getAttribute('data-state')).toBe('failed'))
    expect(screen.getByTestId('word-alpha').textContent).toContain('Не удалось загрузить пример')
    await waitFor(() => expect(screen.getByTestId('word-beta').getAttribute('data-state')).toBe('example'))
    await wait(1500)
    expect(exCalls().filter(w => w === 'alpha')).toHaveLength(1)
  })

  it('урок из 35 слов без кэша при лимите (окно, Retry-After = остаток): все окончательны без кликов, пауза ≥ Retry-After + 1 с, ни одного «не загрузился»', async () => {
    const words = Array.from({ length: 35 }, (_, i) => `w${i}`)
    let ok = 0
    let refusedAt = 0
    let firstAfter = 0
    const openAt = { t: 0 }
    bff.examplesReply = () => {
      const now = Date.now()
      if (ok >= 30 && (openAt.t === 0 || now < openAt.t)) {
        if (openAt.t === 0) openAt.t = now + 1000
        refusedAt = now
        return json(429, { error: 'rate_limited', retry_after_sec: 1 }, { 'Retry-After': '1' })
      }
      if (ok === 30 && !firstAfter) firstAfter = now
      ok++
      return json(200, { items: [], empty_reason: 'not_in_corpus' })
    }
    await open(lessonState(words))
    const failed = new Set<string>()
    for (let i = 0; i < 40 && ok < 35; i++) {
      await wait(150)
      for (const w of words) if (screen.getByTestId(`word-${w}`).getAttribute('data-state') === 'failed') failed.add(w)
    }
    await waitFor(() => expect(ok).toBe(35), { timeout: 5000 })
    await wait(50)
    expect(words.every(w => screen.getByTestId(`word-${w}`).getAttribute('data-state') === 'none')).toBe(true)
    expect(failed.size).toBe(0)
    expect(firstAfter - refusedAt).toBeGreaterThanOrEqual(2000 - 20)
    expect(bff.of('/api/me/route/examples').length).toBeGreaterThanOrEqual(36)
  }, 15000)
})

describe('B10f: гейт rw', () => {
  it('не текущий выданный урок плана проходит', async () => {
    examples({})
    await open(st([lesson('aaaa'), del(2), und()]))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Урок слов · 3 слова')
  })
  for (const [name, s, url] of [
    ['kept', st([kept(1, { puzzle_id: LP, kind: 'words', words: ['a'] }), del(2), und()]), undefined],
    ['устаревший rw (день пересобран)', st([del(1), und()]), undefined],
    ['прошлый день (строки нет в плане)', st([del(5), und()]), `/app/route/words?rw=${encodeURIComponent('words::past')}`],
    ['не урок', st([del(1), und()]), `/app/route/words?rw=${encodeURIComponent(pid(1))}`],
    ['невыданный', st([del(1), und()]), `/app/route/words?rw=${encodeURIComponent('words::undl')}`],
  ] as Array<[string, RouteState, string | undefined]>) {
    it(`${name} — «Этот урок больше недоступен — день изменился.», запросов примеров и событий нет`, async () => {
      bff.state = s
      mount(url)
      await screen.findByTestId('lesson-gone')
      expect(screen.getByTestId('lesson-gone').textContent).toContain('Этот урок больше недоступен — день изменился.')
      expect(screen.getByRole('link', { name: '← К маршруту' }).getAttribute('href')).toBe('/app/route')
      await wait(50)
      expect(exCalls()).toHaveLength(0)
      expect(localStorage.getItem('flib:route-outbox')).toBeNull()
    })
  }
  it('kept_local (запись этого устройства, строки в плане нет) — недоступен', async () => {
    writeWatched(ROUTE, TODAY, LP, 0.9, { words: ['a'] })
    bff.state = st([del(1), und()])
    mount()
    await screen.findByTestId('lesson-gone')
  })
  it('пустые слова — «В уроке нет слов», события нет', async () => {
    bff.state = lessonState([])
    mount()
    await screen.findByTestId('lesson-empty')
    expect(screen.getByTestId('lesson-empty').textContent).toContain('В уроке нет слов')
  })
})

describe('B10f: доля и событие (§4.13 пп.6–7, §7 45–49)', () => {
  it('все слова без примера — clip_played played_frac:1 сразу; «Урок пройден»; у события нет subs_*/lemmas', async () => {
    examples({})
    await open(lessonState())
    await screen.findByTestId('lesson-done')
    expect(screen.getByTestId('lesson-done').textContent).toContain('Урок пройден')
    await flush()
    const evs = lessonEvents()
    expect(evs).toHaveLength(1)
    expect(evs[0].played_frac).toBe(1)
    const fx = (fixtures as { cases: Array<{ name: string; event: Record<string, unknown> }> }).cases.find(c => c.name === 'clip_played/words_lesson')!.event
    expect(Object.keys(evs[0]).sort()).toEqual(Object.keys(fx).sort())
    for (const k of ['subs_report', 'subs_heard', 'subs_unheard', 'subs_source', 'lemmas']) expect(k in evs[0]).toBe(false)
    expect(String(evs[0].event_id)).toMatch(/^web:[0-9a-f-]{36}$/)
    expect(readWatched()?.items[LP]).toMatchObject({ share: 1, meta: { words: ['alpha', 'beta', 'gamma'] } })
  })

  it('первый 403 — ни одного следующего запроса, строка над списком, кэш показывается (§7 46)', async () => {
    localStorage.setItem('flib:examples-cache', JSON.stringify({ v: 1, items: { gamma: { at: Date.now(), items: [yt('cachedVID01')], empty_reason: null } } }))
    bff.examplesReply = () => json(403, { error: 'examples_quota_exhausted' })
    await open(lessonState(['alpha', 'beta', 'gamma', 'delta']))
    await screen.findByText('Примеры для этого ключа недоступны — урок засчитается по списку слов.')
    await wait(200)
    const n = exCalls().length
    expect(n).toBeLessThanOrEqual(2)
    expect(screen.getByTestId('word-gamma').getAttribute('data-state')).toBe('example')
    expect(screen.getByTestId('word-gamma').textContent).toContain('Line cachedVID01')
    expect(screen.getByTestId('word-delta').getAttribute('data-state')).toBe('none')
    await wait(500)
    expect(exCalls().length).toBe(n)
  })

  it('503 у одного слова держит долю ниже 1, урок сам не засчитывается (§7 47)', async () => {
    bff.examplesReply = w => (w === 'beta' ? json(503, { error: 'daemon_unavailable' }, { 'Retry-After': '1' }) : json(200, { items: [], empty_reason: 'not_in_corpus' }))
    await open(lessonState(['alpha', 'beta']))
    await waitFor(() => expect(screen.getByTestId('word-beta').getAttribute('data-state')).toBe('failed'))
    await wait(1300)
    expect(exCalls().filter(w => w === 'beta')).toHaveLength(2)
    expect(screen.queryByTestId('lesson-done')).toBeNull()
    expect(screen.getByTestId('lesson-meta').textContent).toBe('Просмотрено 0 из 1 примеров')
    await flush()
    expect(lessonEvents()).toHaveLength(0)
  })

  it('3 из 5 и уход — одно событие 0,6, запись 0,6, строка дня «просмотрена» (§7 48)', async () => {
    const words = ['a1', 'a2', 'a3', 'a4', 'a5']
    examples(Object.fromEntries(words.map((w, i) => [w, [yt(`vidvidvid0${i}`)]])))
    const s = lessonState(words)
    const { unmount } = await open(s)
    await waitFor(() => expect(screen.getByTestId('word-a5').getAttribute('data-state')).toBe('example'))
    for (const w of ['a1', 'a2', 'a3']) await watchExample(w)
    expect(screen.getByTestId('lesson-meta').textContent).toBe('Просмотрено 3 из 5 примеров')
    // шлюз принял отчёт, демон его ещё не обработал — queued_played
    bff.state = lessonState(words, {}, { queued_played: true })
    fireEvent.click(screen.getAllByRole('link', { name: '← К маршруту' })[0])
    await screen.findByTestId('day-hero')
    await flush()
    const evs = lessonEvents()
    expect(evs).toHaveLength(1)
    expect(evs[0].played_frac).toBe(0.6)
    expect(readWatched()?.items[LP]?.share).toBe(0.6)
    const row = screen.getByTestId('row-2')
    expect(row.getAttribute('data-kind')).toBe('current')
    expect(within(row).getByRole('link', { name: 'Повторить урок' })).toBeTruthy()
    unmount()
  })

  it('урок пройден раньше (запись 1) — повторный проход ноль новых событий (§7 49)', async () => {
    writeWatched(ROUTE, TODAY, LP, 1, { words: ['alpha'] })
    examples({})
    const { unmount } = await open(lessonState(['alpha']))
    await screen.findByTestId('lesson-done')
    unmount()
    await flush()
    expect(lessonEvents()).toHaveLength(0)
    expect(localStorage.getItem('flib:route-outbox') ?? '').not.toContain(LP)
  })

  it('доля 0 — уход без события', async () => {
    examples({ alpha: [yt('abcDEF12345')] })
    const { unmount } = await open(lessonState(['alpha']))
    await waitFor(() => expect(screen.getByTestId('word-alpha').getAttribute('data-state')).toBe('example'))
    unmount()
    await flush()
    expect(lessonEvents()).toHaveLength(0)
  })

  it('pagehide с выросшей долей — событие в очереди и запись отметки синхронно', async () => {
    examples({ alpha: [yt('abcDEF12345')], beta: [yt('abcDEF12346')] })
    await open(lessonState(['alpha', 'beta']))
    await waitFor(() => expect(screen.getByTestId('word-beta').getAttribute('data-state')).toBe('example'))
    await watchExample('alpha')
    act(() => { window.dispatchEvent(new Event('pagehide')) })
    const buffered = JSON.stringify([localStorage.getItem('flib:route-outbox'), ...Array.from({ length: localStorage.length }, (_, i) => localStorage.getItem(localStorage.key(i)!))])
    expect(buffered).toContain(LP)
    expect(readWatched()?.items[LP]?.share).toBe(0.5)
  })
})

describe('B10f: встраивание, кэш, перезагрузка (§7 52, Р26)', () => {
  it('невстраиваемый первый элемент — играет второй; кончились — «Этот пример не открывается»', async () => {
    examples({ alpha: [yt('first000001'), yt('second00002')] })
    await open(lessonState(['alpha']))
    await waitFor(() => expect(screen.getByTestId('word-alpha').getAttribute('data-state')).toBe('example'))
    fireEvent.click(within(screen.getByTestId('word-alpha')).getByRole('button', { name: '▶ Пример' }))
    await waitFor(() => expect(h.adapters.map(x => x.id)).toEqual(['first000001']))
    act(() => { h.adapters[0].a._emit('unplayable', { reason: 'embed-error', code: 150 }) })
    await waitFor(() => expect(h.adapters.map(x => x.id)).toEqual(['first000001', 'second00002']))
    expect(screen.getByTestId('word-alpha').textContent).toContain('Line second00002')
    act(() => { h.adapters[1].a._emit('error', 101) })
    await waitFor(() => expect(screen.getByTestId('word-alpha').textContent).toContain('Этот пример не открывается'))
  })

  it('«Смотреть все подряд» — первый непросмотренный, по концу — следующий непросмотренный, до конца списка', async () => {
    examples({ a1: [yt('vidvidvid01')], a2: [yt('vidvidvid02')], a3: [yt('vidvidvid03')] })
    addLessonHeard(ROUTE, TODAY, LP, 'a2')
    await open(lessonState(['a1', 'a2', 'a3']))
    await waitFor(() => expect(screen.getByTestId('word-a3').getAttribute('data-state')).toBe('example'))
    fireEvent.click(screen.getByRole('button', { name: 'Смотреть все подряд' }))
    await waitFor(() => expect(h.adapters.map(x => x.id)).toEqual(['vidvidvid01']))
    act(() => { h.adapters[0].a._setTime(2.8) })
    await waitFor(() => expect(h.adapters.map(x => x.id)).toEqual(['vidvidvid01', 'vidvidvid03']), { timeout: 2000 })
    act(() => { h.adapters[1].a._setTime(2.8) })
    await screen.findByTestId('lesson-done')
    expect(screen.getByTestId('lesson-meta').textContent).toBe('Просмотрено 3 из 3 примеров')
    await wait(300)
    expect(h.adapters).toHaveLength(2)
    expect(screen.queryByTestId('lesson-player')).toBeNull()
  })

  it('второй урок того же набора слов — ноль обращений (кэш); урок с новыми словами — по обращению на слово', async () => {
    examples({})
    const r1 = await open(lessonState(['alpha', 'beta']))
    await screen.findByTestId('lesson-done')
    r1.unmount()
    __resetRouteStateForTests()
    expect(exCalls()).toHaveLength(2)
    const r2 = await open(lessonState(['alpha', 'beta'], { revision: 6 }))
    await screen.findByTestId('lesson-done')
    expect(exCalls()).toHaveLength(2)
    r2.unmount()
    __resetRouteStateForTests()
    await open(lessonState(['alpha', 'gamma', 'delta'], { revision: 7 }))
    await screen.findByTestId('lesson-done')
    expect(exCalls()).toEqual(['alpha', 'beta', 'gamma', 'delta'])
  })

  it('перезагрузка посреди урока — просмотренные слова на месте; другая дата плана — с нуля', async () => {
    examples({ alpha: [yt('abcDEF12345')], beta: [yt('abcDEF12346')] })
    addLessonHeard(ROUTE, TODAY, LP, 'alpha')
    const r = await open(lessonState(['alpha', 'beta']))
    await waitFor(() => expect(screen.getByTestId('lesson-meta').textContent).toBe('Просмотрено 1 из 2 примеров'))
    expect(screen.getByTestId('word-alpha').textContent).toContain('✓ просмотрен')
    r.unmount()
    __resetRouteStateForTests()
    const other = lessonState(['alpha', 'beta'], { snapshot_date: '2026-11-19' })
    other.day!.date = '2026-11-19'
    await open(other)
    await waitFor(() => expect(screen.getByTestId('word-beta').getAttribute('data-state')).toBe('example'))
    expect(screen.getByTestId('lesson-meta').textContent).toBe('Просмотрено 0 из 2 примеров')
  })
})

describe('B10f: «Следующий ролик →» со страницы урока (§7 48а, W-M2)', () => {
  it('обмен выдал YouTube-ролик — плеер с rp', async () => {
    examples({})
    bff.afterCommit = st([del(1, { played: true }), lesson('aaaa', { words: ['alpha'], played: true }), del(3)], { revision: 6 })
    await open(st([del(1, { played: true }), lesson('aaaa', { words: ['alpha'] }), und()]))
    const btn = await screen.findByRole('button', { name: 'Следующий ролик →' })
    fireEvent.click(btn)
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe(`/player?v=${vid(3)}&rp=${encodeURIComponent(pid(3))}`), { timeout: 5000 })
    expect(bff.of('/api/me/route/exchange', 'POST')[0].body).toMatchObject({ want: 'next' })
  })

  it('законченный урок слов → «Следующий ролик →»: без предупреждения (отметка «прослушан» бывает только у YouTube)', async () => {
    examples({})
    bff.afterCommit = st([del(1, { played: true }), lesson('aaaa', { words: ['alpha'], played: true }), del(3)], { revision: 6 })
    await open(st([del(1, { played: true }), lesson('aaaa', { words: ['alpha'] }), und()]))
    fireEvent.click(await screen.findByRole('button', { name: 'Следующий ролик →' }))
    await waitFor(() => expect(bff.of('/api/me/route/exchange', 'POST')).toHaveLength(1), { timeout: 5000 })
    expect(screen.queryByTestId('next-warning')).toBeNull()
  })

  it('обмен выдал урок слов — экран дня, страница урока сама не открылась', async () => {
    examples({})
    bff.afterCommit = st([del(1, { played: true }), lesson('aaaa', { words: ['alpha'], played: true }), lesson('bbbb', { words: ['x'] })], { revision: 6 })
    await open(st([del(1, { played: true }), lesson('aaaa', { words: ['alpha'] }), und()]))
    fireEvent.click(await screen.findByRole('button', { name: 'Следующий ролик →' }))
    await waitFor(() => expect(bff.of('/api/me/route/exchange', 'POST')).toHaveLength(1))
    await waitFor(() => expect(screen.getByTestId('day-hero').querySelector('h2')?.textContent).toBe('Урок слов · 1 слово'), { timeout: 5000 })
    await wait(300)
    expect(screen.getByTestId('location').textContent).toBe('/app/route')
    expect(within(screen.getByTestId('day-hero')).getByRole('link', { name: 'Пройти урок' })).toBeTruthy()
  })

  it('урок не текущий или невыданных нет — вместо «Следующий ролик →» «← К маршруту»', async () => {
    examples({})
    await open(st([lesson('aaaa', { words: ['alpha'] }), del(2)]))
    await screen.findByTestId('lesson-done')
    expect(within(screen.getByTestId('lesson-done')).queryByRole('button', { name: 'Следующий ролик →' })).toBeNull()
    expect(within(screen.getByTestId('lesson-done')).getByRole('link', { name: '← К маршруту' })).toBeTruthy()
  })
})
