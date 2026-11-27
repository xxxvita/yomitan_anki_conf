// words-lesson.ts — чистая часть урока слов на сайте (спека 2026-11-17 §4.13,
// §6.2, §7 случаи 45–53; план B10f): состояния слова, доля урока, кэш примеров
// `flib:examples-cache`, просмотренные слова `flib:route-lesson` и очередь
// запросов примеров.
//
// Состояние слова (§4.13 п.4) — одно из четырёх:
//   • «ищем»        — запрос не отправлен или в полёте (и пауза после 429);
//   • «есть пример» — первый элемент ответа, который ещё не отказал во встраивании;
//   • «без примера» — окончательно: items:[], первый 403 примеров страницы, все
//                     элементы не встроились (`why` — какой текст показать);
//   • «не загрузился» — временно: 503/502/сеть/таймаут (один автоповтор по
//                     Retry-After ≤ 30 с), а также 502 gateway_refused / незнакомый
//                     код и 403 csrf — БЕЗ автоповтора.
// Доля (п.6) = (слова «есть пример», чей пример просмотрен) / M, M = слова «есть
// пример» + «ищем» + «не загрузился»; «без примера» в M не входят. M = 0 → 1:
// тогда все слова окончательно без примера (Р25). Временный сбой держит M — урок
// сам не засчитывается.
import type { ApiResult } from './route-api'
import { EXAMPLES_CACHE_KEY, ROUTE_LESSON_KEY, safeLocalStorage } from './route-storage'

export interface ExampleItem { video_id: string; start_ms: number; end_ms: number; text_en: string; text_ru?: string }
export interface ExamplesAnswer { items: ExampleItem[]; empty_reason: string | null }

export type WordState =
  | { k: 'searching' }
  | { k: 'example'; items: ExampleItem[]; idx: number }
  | { k: 'none'; why: 'empty' | 'forbidden' | 'unembeddable' }
  | { k: 'failed'; auto: boolean }

export const EXAMPLES_CACHE_MAX = 500
export const EXAMPLES_CACHE_TTL_MS = 7 * 24 * 3600 * 1000
export const LESSON_MAX = 20
export const EXAMPLES_PARALLEL = 2
export const AUTO_RETRY_MAX_SEC = 30
// Пауза очереди на любой 429 — Retry-After + 1 с (нет заголовка — 61 с): лишняя
// секунда — ловушка перевзвода окна ограничителя шлюза (R-L1).
export function pauseAfter429Ms(retryAfterSec: number | null): number {
  return ((retryAfterSec && retryAfterSec > 0 ? retryAfterSec : 60) + 1) * 1000
}

export function autoRetryMs(retryAfterSec: number | null): number {
  const s = retryAfterSec && retryAfterSec > 0 ? retryAfterSec : 5
  return Math.min(s, AUTO_RETRY_MAX_SEC) * 1000
}

export function round3(x: number): number { return Math.round(x * 1000) / 1000 }

function validItem(x: unknown): x is ExampleItem {
  const i = x as ExampleItem
  return !!i && typeof i.video_id === 'string' && /^[A-Za-z0-9_-]{11}$/.test(i.video_id)
    && Number.isInteger(i.start_ms) && Number.isInteger(i.end_ms) && i.start_ms >= 0 && i.start_ms < i.end_ms
    && typeof i.text_en === 'string' && i.text_en.trim() !== ''
}

export function normalizeAnswer(raw: unknown): ExamplesAnswer {
  const r = raw as { items?: unknown; empty_reason?: unknown } | null
  const items = Array.isArray(r?.items)
    ? r!.items.filter(validItem).map(i => ({
      video_id: i.video_id, start_ms: i.start_ms, end_ms: i.end_ms, text_en: i.text_en,
      ...(typeof i.text_ru === 'string' && i.text_ru.trim() ? { text_ru: i.text_ru } : {}),
    }))
    : []
  return { items, empty_reason: typeof r?.empty_reason === 'string' ? r.empty_reason : null }
}

export function answerToState(a: ExamplesAnswer): WordState {
  return a.items.length > 0 ? { k: 'example', items: a.items, idx: 0 } : { k: 'none', why: 'empty' }
}

// lessonFraction — доля урока (п.6). heard — слова, чей пример просмотрен.
export function lessonFraction(words: readonly string[], states: ReadonlyMap<string, WordState>, heard: ReadonlySet<string>): { k: number; m: number; frac: number } {
  let k = 0
  let m = 0
  for (const w of words) {
    const s = states.get(w)
    if (!s || s.k === 'none') continue
    m++
    if (s.k === 'example' && heard.has(w)) k++
  }
  return { k, m, frac: m === 0 ? (words.length > 0 ? 1 : 0) : k / m }
}

// nextUnheard — следующее слово с примером, чей пример не просмотрен (после `after`).
export function nextUnheard(words: readonly string[], states: ReadonlyMap<string, WordState>, heard: ReadonlySet<string>, after?: string): string | null {
  const from = after === undefined ? 0 : words.indexOf(after) + 1
  for (let i = from; i < words.length; i++) {
    const w = words[i]
    if (states.get(w)?.k === 'example' && !heard.has(w)) return w
  }
  return null
}

// --- flib:examples-cache ---------------------------------------------------------------

interface CacheObj { v: 1; items: Record<string, { at: number; items: ExampleItem[]; empty_reason: string | null }> }

function readCache(storage: Storage | null): CacheObj {
  try {
    const raw = storage?.getItem(EXAMPLES_CACHE_KEY)
    const v = raw ? JSON.parse(raw) as CacheObj : null
    if (v && v.v === 1 && v.items && typeof v.items === 'object') return v
  } catch { /* битый — с нуля */ }
  return { v: 1, items: {} }
}

export function readExampleCache(word: string, now: number, storage: Storage | null = safeLocalStorage()): ExamplesAnswer | null {
  const e = readCache(storage).items[word]
  if (!e || typeof e.at !== 'number' || now - e.at > EXAMPLES_CACHE_TTL_MS || now < e.at - 60_000) return null
  return normalizeAnswer(e)
}

export function writeExampleCache(word: string, a: ExamplesAnswer, now: number, storage: Storage | null = safeLocalStorage()): void {
  if (!storage) return
  const o = readCache(storage)
  o.items[word] = { at: now, items: a.items, empty_reason: a.empty_reason }
  const ws = Object.keys(o.items)
  if (ws.length > EXAMPLES_CACHE_MAX) {
    ws.sort((x, y) => o.items[x].at - o.items[y].at)
    for (const w of ws.slice(0, ws.length - EXAMPLES_CACHE_MAX)) delete o.items[w]
  }
  try { storage.setItem(EXAMPLES_CACHE_KEY, JSON.stringify(o)) } catch { /* квота — без кэша */ }
}

// --- flib:route-lesson -----------------------------------------------------------------

// Запись урока: `heard` — просмотренные слова; `sent` — наибольшая доля, которую
// урок уже поставил в очередь в эту дату плана (финальное ревью PR-B, L8): отметка
// `flib:route-watched` урока, не засчитанного демоном, снимается сторожем
// pruneWatched, и без этой памяти каждое повторное открытие слало бы ту же долю
// заново. Повтор доли НИЖЕ порога зачёта (0.6) уходит, только если она строго
// больше `sent`; долю от порога и выше `sent` не гасит (ревью PR-C, N1).
interface LessonItem { heard: string[]; sent?: number }
interface LessonObj { v: 1; route_id: string; day: string; items: Record<string, LessonItem> }

function readLesson(storage: Storage | null): LessonObj | null {
  try {
    const raw = storage?.getItem(ROUTE_LESSON_KEY)
    const v = raw ? JSON.parse(raw) as LessonObj : null
    if (v && v.v === 1 && typeof v.route_id === 'string' && typeof v.day === 'string' && v.items && typeof v.items === 'object') return v
  } catch { /* битый */ }
  return null
}

// lessonObjFor — объект для записи в эту эпоху и дату плана: тот же — он; другая
// эпоха или более поздняя дата — с нуля; более ранняя дата той же эпохи — null,
// запись не делается (страница со вчерашней датой не сбрасывает сегодняшний урок,
// финальное ревью PR-B, L4).
function lessonObjFor(prev: LessonObj | null, routeId: string, day: string): LessonObj | null {
  if (prev && prev.route_id === routeId && prev.day > day) return null
  return prev && prev.route_id === routeId && prev.day === day ? prev : { v: 1, route_id: routeId, day, items: {} }
}

function saveLesson(storage: Storage, o: LessonObj): void {
  const ids = Object.keys(o.items)
  for (const id of ids.slice(0, Math.max(0, ids.length - LESSON_MAX))) delete o.items[id]
  try { storage.setItem(ROUTE_LESSON_KEY, JSON.stringify(o)) } catch { /* квота */ }
}

// readLessonHeard — просмотренные слова урока этой эпохи и даты плана (иначе пусто).
export function readLessonHeard(routeId: string, day: string, puzzleId: string, storage: Storage | null = safeLocalStorage()): string[] {
  const o = readLesson(storage)
  if (!o || o.route_id !== routeId || o.day !== day) return []
  const h = o.items[puzzleId]?.heard
  return Array.isArray(h) ? h.filter(w => typeof w === 'string') : []
}

// addLessonHeard — слово урока просмотрено. Другая эпоха или более поздняя дата
// плана — объект с нуля; ≤ LESSON_MAX уроков, первыми вытесняются старшие по
// порядку записи.
export function addLessonHeard(routeId: string, day: string, puzzleId: string, word: string, storage: Storage | null = safeLocalStorage()): void {
  if (!storage || !routeId || !day) return
  const o = lessonObjFor(readLesson(storage), routeId, day)
  if (!o) return
  const prevItem = o.items[puzzleId]
  const cur = Array.isArray(prevItem?.heard) ? prevItem.heard : []
  if (cur.includes(word)) return
  delete o.items[puzzleId]
  o.items[puzzleId] = { ...prevItem, heard: [...cur, word] }
  saveLesson(storage, o)
}

// readLessonSent — доля, уже поставленная уроком в очередь в эту дату плана (0 — нет).
export function readLessonSent(routeId: string, day: string, puzzleId: string, storage: Storage | null = safeLocalStorage()): number {
  const o = readLesson(storage)
  if (!o || o.route_id !== routeId || o.day !== day) return 0
  const v = o.items[puzzleId]?.sent
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0
}

// noteLessonSent — урок поставил долю в очередь (вызывается под блокировкой очереди
// после записи события, как и отметка `flib:route-watched`). Хранится максимум.
export function noteLessonSent(routeId: string, day: string, puzzleId: string, share: number, storage: Storage | null = safeLocalStorage()): void {
  if (!storage || !routeId || !day || !(share > 0)) return
  const o = lessonObjFor(readLesson(storage), routeId, day)
  if (!o) return
  const prevItem = o.items[puzzleId]
  const heard = Array.isArray(prevItem?.heard) ? prevItem.heard : []
  if (typeof prevItem?.sent === 'number' && prevItem.sent >= share) return
  o.items[puzzleId] = { heard, sent: share }
  saveLesson(storage, o)
}

// --- очередь запросов примеров -----------------------------------------------------------

export interface ExampleQueueDeps {
  fetchExamples: (word: string) => Promise<ApiResult<unknown>>
  now: () => number
  setTimer: (fn: () => void, ms: number) => unknown
  clearTimer: (h: unknown) => void
  readCache: (word: string) => ExamplesAnswer | null
  writeCache: (word: string, a: ExamplesAnswer) => void
  onAuth?: () => void
}

// ExampleQueue — загрузка примеров по словам сверху вниз, не больше двух запросов
// одновременно (столько держит BFF на sid). Сначала кэш. Любой 429 (лимит шлюза
// или `busy` BFF) ставит на паузу ВСЮ очередь (незапрошенные слова и слово с 429)
// на Retry-After + 1 с; слова остаются «ищем», загрузка продолжается сама. Первый
// 403 примеров — больше ни одного запроса, слова без загруженного примера — «без
// примера» (кэш по-прежнему показывается).
export class ExampleQueue {
  states = new Map<string, WordState>()
  forbidden = false
  pausedUntil = 0
  private pending: string[] = []
  private inflight = new Set<string>()
  private autoUsed = new Set<string>()
  private timers = new Set<unknown>()
  private stopped = false
  private pauseToken = 0
  private listeners = new Set<() => void>()

  constructor(private words: readonly string[], private deps: ExampleQueueDeps) {
    for (const w of words) {
      const c = deps.readCache(w)
      if (c) this.states.set(w, answerToState(c))
      else { this.states.set(w, { k: 'searching' }); this.pending.push(w) }
    }
  }

  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn) } }
  private emit(): void { for (const fn of this.listeners) { try { fn() } catch { /* no-op */ } } }

  // start — запуск; после dispose (двойной монтаж StrictMode в разработке) —
  // продолжение: недоставленные слова снова в очереди, пауза 429 — со своим таймером.
  start(): void {
    this.stopped = false
    for (const w of this.words) {
      if (this.states.get(w)?.k === 'searching' && !this.inflight.has(w) && !this.pending.includes(w)) this.pending.push(w)
    }
    const left = this.pausedUntil - this.deps.now()
    if (left > 0) {
      const token = ++this.pauseToken
      this.timer(() => { if (token === this.pauseToken) this.pausedUntil = 0; this.pump() }, left)
    }
    this.pump()
  }

  // dispose — страница ушла: таймеры сняты, новых запросов нет.
  dispose(): void {
    this.stopped = true
    for (const t of this.timers) this.deps.clearTimer(t)
    this.timers.clear()
  }

  inFlight(): number { return this.inflight.size }

  private timer(fn: () => void, ms: number): void {
    const h = this.deps.setTimer(() => { this.timers.delete(h); fn() }, Math.max(0, ms))
    this.timers.add(h)
  }

  private pump(): void {
    if (this.stopped || this.forbidden) return
    const now = this.deps.now()
    if (now < this.pausedUntil) return
    while (this.inflight.size < EXAMPLES_PARALLEL && this.pending.length > 0) {
      const w = this.pending.shift()!
      if (this.inflight.has(w)) continue
      void this.request(w)
    }
  }

  private async request(w: string): Promise<void> {
    this.inflight.add(w)
    this.states.set(w, { k: 'searching' })
    let r: ApiResult<unknown>
    try { r = await this.deps.fetchExamples(w) } catch { r = { ok: false, status: 0, code: null, retryAfterSec: null, cls: 'temporary', body: null } }
    this.inflight.delete(w)
    // 200 без массива items — ответ битый: «не загрузился» по правилам временного
    // сбоя, не кэшируется и урок не засчитывает (ревью 3b, L4).
    if (r.ok && !Array.isArray((r.data as { items?: unknown } | null)?.items)) {
      r = { ok: false, status: 502, code: null, retryAfterSec: null, cls: 'temporary', body: null }
    }
    // Ответ после dispose (страница ушла или двойной монтаж): удачный — в кэш и в
    // состояние, чтобы повторное открытие не тратило квоту ключа снова (ревью 3b,
    // L2; после «Выхода» запись в кэш отсекает writeCache страницы); прочие —
    // слово обратно в очередь, его продолжит start().
    if (this.stopped) {
      if (r.ok) {
        const a = normalizeAnswer(r.data)
        this.deps.writeCache(w, a)
        this.states.set(w, answerToState(a))
      } else {
        this.pending.unshift(w)
      }
      return
    }
    if (r.ok) {
      const a = normalizeAnswer(r.data)
      this.deps.writeCache(w, a)
      this.states.set(w, answerToState(a))
    } else if (this.forbidden) {
      this.states.set(w, { k: 'none', why: 'forbidden' })
    } else if (r.status === 429) {
      this.pending.unshift(w)
      this.states.set(w, { k: 'searching' })
      const until = this.deps.now() + pauseAfter429Ms(r.retryAfterSec)
      if (until > this.pausedUntil) {
        // Пауза снимается ТАЙМЕРОМ самой поздней паузы, а не сравнением часов:
        // таймер браузера может сработать на миллисекунду раньше Date.now(), и
        // очередь иначе встала бы навсегда.
        this.pausedUntil = until
        const token = ++this.pauseToken
        this.timer(() => { if (token === this.pauseToken) this.pausedUntil = 0; this.pump() }, until - this.deps.now())
      }
    } else if (r.status === 403 && (r.code === 'examples_forbidden' || r.code === 'examples_quota_exhausted')) {
      this.forbidden = true
      this.pending = []
      for (const word of this.words) {
        const s = this.states.get(word)
        if (!this.inflight.has(word) && (s?.k === 'searching' || s?.k === 'failed')) this.states.set(word, { k: 'none', why: 'forbidden' })
      }
    } else if (r.status === 400) {
      this.states.set(w, { k: 'none', why: 'empty' })
    } else if (r.cls === 'temporary' && !this.autoUsed.has(w)) {
      this.autoUsed.add(w)
      this.states.set(w, { k: 'failed', auto: true })
      this.timer(() => {
        if (this.forbidden || this.states.get(w)?.k !== 'failed') return
        this.pending.unshift(w)
        this.pump()
      }, autoRetryMs(r.retryAfterSec))
    } else {
      if (r.status === 401) this.deps.onAuth?.()
      this.states.set(w, { k: 'failed', auto: false })
    }
    this.emit()
    this.pump()
  }

  // retry — [Повторить] у слова «не загрузился». После первого 403 — ничего.
  retry(w: string): void {
    if (this.forbidden || this.stopped || this.states.get(w)?.k !== 'failed' || this.inflight.has(w)) return
    this.states.set(w, { k: 'searching' })
    this.pending = [w, ...this.pending.filter(x => x !== w)]
    this.emit()
    this.pump()
  }

  // unembeddable — ролик примера не встроился: следующий элемент ответа или
  // окончательно «без примера» (слово выходит из знаменателя).
  unembeddable(w: string): void {
    const s = this.states.get(w)
    if (s?.k !== 'example') return
    this.states.set(w, s.idx + 1 < s.items.length ? { k: 'example', items: s.items, idx: s.idx + 1 } : { k: 'none', why: 'unembeddable' })
    this.emit()
  }
}
