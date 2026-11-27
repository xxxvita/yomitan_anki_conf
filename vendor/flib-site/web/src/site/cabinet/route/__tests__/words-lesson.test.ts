// words-lesson.test.ts — чистая часть урока слов (спека 2026-11-17 §4.13
// пп.3–6, §6.2, §7 случаи 45–47а, 52; план B10f).
import { describe, it, expect } from 'vitest'
import {
  ExampleQueue, addLessonHeard, answerToState, autoRetryMs, lessonFraction, nextUnheard, pauseAfter429Ms,
  readExampleCache, readLessonHeard, writeExampleCache, EXAMPLES_CACHE_MAX, LESSON_MAX,
  type ExamplesAnswer, type WordState,
} from '../words-lesson'
import type { ApiResult } from '../route-api'
import { MemStorage } from './outbox-fakes'

const item = (v = 'abcDEF12345', s = 1000, e = 2000) => ({ video_id: v, start_ms: s, end_ms: e, text_en: 'Hi.' })
const ex = (n = 1): WordState => ({ k: 'example', items: Array.from({ length: n }, (_, i) => item(`abcDEF1234${i}`)), idx: 0 })

describe('доля урока (§4.13 п.6)', () => {
  it('M — «есть пример» + «ищем» + «не загрузился»; «без примера» вне M', () => {
    const words = ['a', 'b', 'c', 'd', 'e']
    const st = new Map<string, WordState>([['a', ex()], ['b', ex()], ['c', { k: 'searching' }], ['d', { k: 'failed', auto: false }], ['e', { k: 'none', why: 'empty' }]])
    expect(lessonFraction(words, st, new Set(['a', 'b']))).toEqual({ k: 2, m: 4, frac: 0.5 })
  })
  it('все окончательно без примера — доля 1 (Р25); «не загрузился» держит долю ниже 1 (§7 47)', () => {
    const none = new Map<string, WordState>([['a', { k: 'none', why: 'empty' }], ['b', { k: 'none', why: 'forbidden' }]])
    expect(lessonFraction(['a', 'b'], none, new Set()).frac).toBe(1)
    const one503 = new Map<string, WordState>([['a', ex()], ['b', { k: 'failed', auto: true }]])
    expect(lessonFraction(['a', 'b'], one503, new Set(['a'])).frac).toBe(0.5)
  })
  it('просмотренное слово, чей пример сейчас не загружен, в числитель не идёт', () => {
    const st = new Map<string, WordState>([['a', { k: 'searching' }]])
    expect(lessonFraction(['a'], st, new Set(['a'])).frac).toBe(0)
  })
  it('nextUnheard — первое непросмотренное слово с примером после данного', () => {
    const st = new Map<string, WordState>([['a', ex()], ['b', { k: 'none', why: 'empty' }], ['c', ex()], ['d', ex()]])
    expect(nextUnheard(['a', 'b', 'c', 'd'], st, new Set(['c']))).toBe('a')
    expect(nextUnheard(['a', 'b', 'c', 'd'], st, new Set(['c']), 'a')).toBe('d')
    expect(nextUnheard(['a', 'b', 'c', 'd'], st, new Set(['a', 'c', 'd']))).toBeNull()
  })
  it('паузы: 429 — Retry-After + 1 с, без заголовка 61 с; автоповтор ≤ 30 с', () => {
    expect(pauseAfter429Ms(40)).toBe(41000)
    expect(pauseAfter429Ms(null)).toBe(61000)
    expect(autoRetryMs(5)).toBe(5000)
    expect(autoRetryMs(120)).toBe(30000)
    expect(autoRetryMs(null)).toBe(5000)
  })
  it('answerToState: пусто — «без примера»', () => {
    expect(answerToState({ items: [], empty_reason: 'not_in_corpus' })).toEqual({ k: 'none', why: 'empty' })
  })
})

describe('flib:examples-cache и flib:route-lesson (§6.2)', () => {
  it('кэш — 7 дней; старше не читается', () => {
    const s = new MemStorage()
    const a: ExamplesAnswer = { items: [item()], empty_reason: null }
    writeExampleCache('w', a, 1000, s)
    expect(readExampleCache('w', 1000 + 6 * 86400_000, s)?.items).toHaveLength(1)
    expect(readExampleCache('w', 1000 + 8 * 86400_000, s)).toBeNull()
  })
  it('кэш ≤ 500 слов, вытесняются старшие по at', () => {
    const s = new MemStorage()
    for (let i = 0; i <= EXAMPLES_CACHE_MAX; i++) writeExampleCache(`w${i}`, { items: [], empty_reason: 'not_in_corpus' }, 1000 + i, s)
    expect(readExampleCache('w0', 2000, s)).toBeNull()
    expect(readExampleCache(`w${EXAMPLES_CACHE_MAX}`, 2000, s)).not.toBeNull()
  })
  it('просмотренные слова — по эпохе и дате плана; другая дата — с нуля; ≤ 20 уроков', () => {
    const s = new MemStorage()
    addLessonHeard('r1', '2026-11-18', 'words::a', 'alpha', s)
    addLessonHeard('r1', '2026-11-18', 'words::a', 'alpha', s)
    addLessonHeard('r1', '2026-11-18', 'words::a', 'beta', s)
    expect(readLessonHeard('r1', '2026-11-18', 'words::a', s)).toEqual(['alpha', 'beta'])
    expect(readLessonHeard('r1', '2026-11-19', 'words::a', s)).toEqual([])
    expect(readLessonHeard('r2', '2026-11-18', 'words::a', s)).toEqual([])
    addLessonHeard('r1', '2026-11-19', 'words::a', 'gamma', s)
    expect(readLessonHeard('r1', '2026-11-18', 'words::a', s)).toEqual([])
    for (let i = 0; i <= LESSON_MAX; i++) addLessonHeard('r1', '2026-11-19', `words::l${i}`, 'x', s)
    expect(readLessonHeard('r1', '2026-11-19', 'words::a', s)).toEqual([])
    expect(readLessonHeard('r1', '2026-11-19', `words::l${LESSON_MAX}`, s)).toEqual(['x'])
  })
})

// --- очередь на виртуальных часах -------------------------------------------------------

type R = ApiResult<unknown>
const okAns = (items = [item()]): R => ({ ok: true, status: 200, data: { items, empty_reason: items.length ? null : 'not_in_corpus' } })
const err = (status: number, code: string | null, ra: number | null, cls: 'temporary' | 'refused' | 'rate' | 'other'): R =>
  ({ ok: false, status, code, retryAfterSec: ra, cls, body: code ? { error: code } : null })

function clock(early = 0) {
  let now = 0
  let id = 0
  const timers = new Map<number, { at: number; fn: () => void }>()
  return {
    now: () => now,
    setTimer: (fn: () => void, ms: number) => { const h = ++id; timers.set(h, { at: now + ms, fn }); return h },
    clearTimer: (h: unknown) => { timers.delete(h as number) },
    async advance(ms: number) {
      const end = now + ms
      for (;;) {
        await flushMicro()
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        now = due[1].at - early
        timers.delete(due[0])
        due[1].fn()
      }
      now = end
      await flushMicro()
    },
  }
}
async function flushMicro() { for (let i = 0; i < 20; i++) await Promise.resolve() }

function queue(words: string[], reply: (w: string, n: number) => R | Promise<R>, o: { cache?: Map<string, ExamplesAnswer>; early?: number } = {}) {
  const c = clock(o.early ?? 0)
  const calls: Array<{ word: string; at: number }> = []
  let inflight = 0
  let maxInflight = 0
  let n = 0
  const cache = o.cache ?? new Map<string, ExamplesAnswer>()
  const q = new ExampleQueue(words, {
    fetchExamples: async w => {
      calls.push({ word: w, at: c.now() }); inflight++; maxInflight = Math.max(maxInflight, inflight)
      try { return await reply(w, ++n) } finally { inflight-- }
    },
    now: c.now, setTimer: c.setTimer, clearTimer: c.clearTimer,
    readCache: w => cache.get(w) ?? null, writeCache: (w, a) => { cache.set(w, a) },
  })
  return { q, c, calls, cache, max: () => maxInflight }
}

describe('ExampleQueue', () => {
  it('сверху вниз, не больше двух одновременно', async () => {
    const h = queue(['a', 'b', 'c', 'd'], () => new Promise<R>(r => setTimeout(() => r(okAns()), 1)))
    h.q.start()
    await new Promise(r => setTimeout(r, 30))
    expect(h.calls.map(x => x.word)).toEqual(['a', 'b', 'c', 'd'])
    expect(h.max()).toBe(2)
    expect([...h.q.states.values()].every(s => s.k === 'example')).toBe(true)
  })

  it('кэш — без запроса', async () => {
    const h = queue(['a', 'b'], () => okAns(), { cache: new Map([['a', { items: [item()], empty_reason: null }]]) })
    expect(h.q.states.get('a')?.k).toBe('example')
    h.q.start()
    await flushMicro()
    expect(h.calls.map(x => x.word)).toEqual(['b'])
  })

  it('урок из 35 слов при лимите 30/мин (окно 60 с, Retry-After = остаток): все окончательны без кликов, 35 успехов, пауза ≥ Retry-After + 1 с, ни одного «не загрузился» (§7 47а)', async () => {
    const words = Array.from({ length: 35 }, (_, i) => `w${i}`)
    let windowStart = -1
    let count = 0
    let lastRA = 0
    const h = queue(words, () => {
      const now = h.c.now()
      if (windowStart < 0 || now >= windowStart + 60_000) { windowStart = now; count = 0 }
      count++
      if (count > 30) {
        lastRA = Math.max(1, Math.floor((windowStart + 60_000 - now) / 1000))
        return err(429, 'rate_limited', lastRA, 'rate')
      }
      return okAns()
    })
    const failedSeen = new Set<string>()
    h.q.subscribe(() => { for (const [w, s] of h.q.states) if (s.k === 'failed') failedSeen.add(w) })
    h.q.start()
    await h.c.advance(10_000)
    const firstMinute = h.calls.length
    expect([...h.q.states.values()].filter(s => s.k === 'example')).toHaveLength(30)
    expect(h.q.states.get('w30')?.k).toBe('searching')
    await h.c.advance(120_000)
    expect([...h.q.states.values()].every(s => s.k === 'example')).toBe(true)
    const succ = h.calls.length - (firstMinute - 30)
    expect(succ).toBe(35)
    const refused = h.calls.filter((_, i) => i >= 30 && i < firstMinute)
    const resumed = h.calls[firstMinute]
    expect(resumed.at - refused[refused.length - 1].at).toBeGreaterThanOrEqual((lastRA + 1) * 1000)
    expect(failedSeen.size).toBe(0)
    expect(h.max()).toBeLessThanOrEqual(2)
  })

  it('таймер паузы сработал на миллисекунду раньше часов — очередь всё равно продолжается', async () => {
    const h = queue(['a', 'b'], (_w, n) => (n === 1 ? err(429, 'rate_limited', 1, 'rate') : okAns()), { early: 1 })
    h.q.start()
    await h.c.advance(5000)
    expect([...h.q.states.values()].every(s => s.k === 'example')).toBe(true)
  })

  it('429 busy BFF — та же пауза всей очереди', async () => {
    const h = queue(['a', 'b', 'c'], (_w, n) => (n === 1 ? err(429, 'busy', 1, 'rate') : okAns()))
    h.q.start()
    await h.c.advance(100)
    expect(h.q.states.get('a')?.k).toBe('searching')
    const before = h.calls.length
    await h.c.advance(1500)
    expect(h.calls.length).toBe(before)
    await h.c.advance(600)
    expect([...h.q.states.values()].every(s => s.k === 'example')).toBe(true)
  })

  it('первый 403 — ни одного следующего запроса, слова без примера — «без примера»; кэш показывается (§7 46)', async () => {
    const h = queue(['a', 'b', 'c', 'd'], w => (w === 'a' ? okAns() : err(403, 'examples_quota_exhausted', null, 'other')),
      { cache: new Map([['d', { items: [item()], empty_reason: null }]]) })
    h.q.start()
    await h.c.advance(100)
    const n = h.calls.length
    expect(h.q.forbidden).toBe(true)
    expect(h.q.states.get('a')?.k).toBe('example')
    expect(h.q.states.get('c')).toEqual({ k: 'none', why: 'forbidden' })
    expect(h.q.states.get('d')?.k).toBe('example')
    h.q.retry('c')
    await h.c.advance(60_000)
    expect(h.calls.length).toBe(n)
    expect(lessonFraction(['a', 'b', 'c', 'd'], h.q.states, new Set(['a', 'd'])).frac).toBe(1)
  })

  it('503 — «не загрузился», один автоповтор по Retry-After, затем [Повторить]', async () => {
    const h = queue(['a'], () => err(503, 'daemon_unavailable', 5, 'temporary'))
    h.q.start()
    await h.c.advance(100)
    expect(h.q.states.get('a')).toEqual({ k: 'failed', auto: true })
    await h.c.advance(5000)
    expect(h.calls).toHaveLength(2)
    expect(h.q.states.get('a')).toEqual({ k: 'failed', auto: false })
    await h.c.advance(60_000)
    expect(h.calls).toHaveLength(2)
    h.q.retry('a')
    await h.c.advance(10)
    expect(h.calls).toHaveLength(3)
  })

  it('403 csrf и 502 gateway_refused — «не загрузился» без автоповтора; очередь идёт дальше', async () => {
    const h = queue(['a', 'b', 'c'], w => (w === 'a' ? err(403, 'csrf', null, 'other') : w === 'b' ? err(502, 'gateway_refused', null, 'refused') : okAns()))
    h.q.start()
    await h.c.advance(60_000)
    expect(h.q.states.get('a')).toEqual({ k: 'failed', auto: false })
    expect(h.q.states.get('b')).toEqual({ k: 'failed', auto: false })
    expect(h.q.states.get('c')?.k).toBe('example')
    expect(h.calls).toHaveLength(3)
  })

  it('невстраиваемый первый элемент — второй; кончились — «без примера», слово вне знаменателя (§7 52)', async () => {
    const h = queue(['a'], () => okAns([item('aaaaaaaaaa1'), item('bbbbbbbbbb2')]))
    h.q.start()
    await h.c.advance(10)
    h.q.unembeddable('a')
    expect(h.q.states.get('a')).toMatchObject({ k: 'example', idx: 1 })
    h.q.unembeddable('a')
    expect(h.q.states.get('a')).toEqual({ k: 'none', why: 'unembeddable' })
    expect(lessonFraction(['a'], h.q.states, new Set()).frac).toBe(1)
  })

  it('dispose и снова start (двойной монтаж StrictMode) — загрузка продолжается', async () => {
    const h = queue(['a', 'b', 'c'], () => okAns())
    h.q.start()
    h.q.dispose()
    await h.c.advance(10)
    h.q.start()
    await h.c.advance(10)
    expect([...h.q.states.values()].every(s => s.k === 'example')).toBe(true)
  })

  it('L2: ответ, пришедший после dispose, — в кэше и в состоянии; start после этого не спрашивает снова', async () => {
    const h = queue(['a', 'b', 'c'], () => new Promise<R>(r => setTimeout(() => r(okAns()), 5)))
    h.q.start()
    await flushMicro()
    h.q.dispose()
    await new Promise(r => setTimeout(r, 20))
    expect(h.cache.has('a')).toBe(true)
    expect(h.cache.has('b')).toBe(true)
    h.q.start()
    await new Promise(r => setTimeout(r, 30))
    expect(h.calls.map(x => x.word)).toEqual(['a', 'b', 'c'])
  })

  it('L4: 200 без массива items — «не загрузился» (один автоповтор), в кэш не идёт', async () => {
    const h = queue(['a'], (_w, n) => (n === 1 ? { ok: true, status: 200, data: '<html>' } : okAns()))
    h.q.start()
    await h.c.advance(10)
    expect(h.q.states.get('a')).toEqual({ k: 'failed', auto: true })
    expect(h.cache.has('a')).toBe(false)
    await h.c.advance(5000)
    expect(h.q.states.get('a')?.k).toBe('example')
  })

  it('W55: 400 — окончательно «без примера»', async () => {
    const h = queue(['a'], () => err(400, 'bad_word', null, 'other'))
    h.q.start()
    await h.c.advance(10)
    expect(h.q.states.get('a')).toEqual({ k: 'none', why: 'empty' })
  })

  it('dispose — таймеры сняты, после ухода запросов нет', async () => {
    const h = queue(['a', 'b', 'c'], (_w, n) => (n === 1 ? err(429, 'rate_limited', 5, 'rate') : okAns()))
    h.q.start()
    await h.c.advance(100)
    expect(h.calls).toHaveLength(2)
    h.q.dispose()
    await h.c.advance(60_000)
    expect(h.calls).toHaveLength(2)
    expect(h.q.states.get('c')?.k).toBe('searching')
  })
})
