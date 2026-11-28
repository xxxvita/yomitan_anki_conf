// progress.test.tsx — прогресс ролика (спека §4.8, план B8d): GET до первого PUT,
// восстановление счёта и предложение позиции; PUT не чаще раза в 20 с (петля
// пауз Shadowing — не больше 3 PUT в минуту); целые поля; state ролика в 2000
// реплик ≤ 96 КиБ; неудачный GET → отчёт partial; heard_total не взрывает ведро
// реплик шлюза (M3).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { fnv1a, heardFromState, progressState, trackKeyOf, useRouteProgress, STATE_MAX_BYTES, type ProgressArgs, type ProgressDeps } from '../progress'
import { завестиСчётчик, ключСнимка, type Реплика, type Счётчик } from '../subtitle-counter'
import { buildClipPlayed } from '../clip-played'
import { envelope } from '../mapper'
import type { RouteModeView } from '../route-mode'
import type { RouteState, RouteProgress, ApiResult } from '../../../site/cabinet/route/route-api'
import { MAX_PROGRESS_HEARD_STEP } from '../../../site/cabinet/route/line-credit'

const PID = 'youtube::abc123XYZ_1'
const CUES = Array.from({ length: 10 }, (_, i) => ({ start: i * 2, end: i * 2 + 2, text_en: `line ${i} words`, text_ru: '' }))
const ST = { started: true, route_id: 'r', revision: 1, snapshot_date: '2026-11-18', day: { date: '2026-11-18', clips: [] } } as unknown as RouteState
const MODE: RouteModeView = { kind: 'confirmed', puzzleId: PID, state: ST, row: null }

function counterHeard(n: number, total = CUES.length): Счётчик {
  const r: Реплика[] = Array.from({ length: total }, (_, i) => ({ start: i, end: i + 1, text: `w${i}` }))
  const c = завестиСчётчик({ puzzleID: PID, ключ: ключСнимка(r), реплики: r })
  return { ...c, услышано: r.map((_, i) => (i < n ? 1 : 0)), возвраты: r.map((_, i) => (i < n ? (i % 3 === 0 ? 2 : 1) : 0)) }
}

interface Fake extends ProgressDeps { puts: Array<{ t: number; body: { track_key: string; position_ms: number; heard_total: number; state: unknown } }>; keepalives: Array<{ heard_total: number; position_ms: number }>; reserves: number[]; getCalls: number; credit: number; putFails: boolean }
function fake(get: ApiResult<RouteProgress> | Promise<ApiResult<RouteProgress>>): Fake {
  const f: Fake = {
    puts: [], keepalives: [], reserves: [], getCalls: 0, credit: 1500, putFails: false,
    get: async () => { f.getCalls++; return get },
    put: async (_pid, body) => {
      f.puts.push({ t: Date.now(), body })
      return f.putFails ? { ok: false, status: 503, code: 'gateway_unavailable', retryAfterSec: null, cls: 'temporary', body: null } : { ok: true, status: 200, data: { ok: true } }
    },
    putKeepalive: (_pid, body) => { f.keepalives.push({ heard_total: body.heard_total, position_ms: body.position_ms }) },
    reserve: async n => { f.reserves.push(n); const g = Math.min(n, f.credit); f.credit -= g; return g },
    now: () => Date.now(),
  }
  return f
}
const notFound: ApiResult<RouteProgress> = { ok: false, status: 404, code: 'not_found', retryAfterSec: null, cls: 'other', body: null }
const failed: ApiResult<RouteProgress> = { ok: false, status: 502, code: null, retryAfterSec: null, cls: 'temporary', body: null }

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

function args(d: Fake, over: Partial<ProgressArgs> = {}): ProgressArgs {
  return { routeMode: MODE, cues: CUES, counter: () => counterHeard(4), currentTime: 1.234, paused: false, deps: d, ...over }
}

describe('GET до первого PUT и восстановление', () => {
  it('404 — not_found; PUT только после ответа GET', async () => {
    let release: (r: ApiResult<RouteProgress>) => void = () => {}
    const d = fake(new Promise(r => { release = r }))
    const h = renderHook(p => useRouteProgress(p), { initialProps: args(d) })
    for (let t = 0; t < 30; t++) { h.rerender(args(d, { currentTime: t })); await act(async () => { await vi.advanceTimersByTimeAsync(1000) }) }
    expect(d.puts.length).toBe(0)
    expect(h.result.current.settled).toBe(false)
    await act(async () => { release(notFound); await vi.advanceTimersByTimeAsync(0) })
    expect(h.result.current.info).toEqual({ kind: 'not_found', heardMax: 0 })
    h.rerender(args(d, { currentTime: 31 }))
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(d.puts.length).toBe(1)
  })

  it('200 той же дорожки — restored, счёт и позиция из ответа; другая дорожка — other', async () => {
    const same = fake({ ok: true, status: 200, data: { track_key: trackKeyOf(CUES), position_ms: 83000, heard_max: 3, state: { v: 1, heard: [0, 1, 2], replays: {} } } })
    const h = renderHook(p => useRouteProgress(p), { initialProps: args(same) })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(h.result.current.info).toEqual({ kind: 'restored', heardMax: 3 })
    expect(h.result.current.restoreHeard).toEqual([0, 1, 2])
    expect(h.result.current.resumeMs).toBe(83000)
    const other = fake({ ok: true, status: 200, data: { track_key: 'yt-en:deadbeef', position_ms: 0, heard_max: 9, state: { v: 1, heard: [0], replays: {} } } })
    const h2 = renderHook(p => useRouteProgress(p), { initialProps: args(other) })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(h2.result.current.info).toEqual({ kind: 'other', heardMax: 9 })
    expect(h2.result.current.restoreHeard).toBeNull()
  })

  it('неудачный GET → отчёт partial', async () => {
    const d = fake(failed)
    const h = renderHook(p => useRouteProgress(p), { initialProps: args(d) })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(h.result.current.info).toEqual({ kind: 'failed', heardMax: 0 })
    const r: Реплика[] = [{ start: 0, end: 1, text: 'hello world' }]
    const c = { ...завестиСчётчик({ puzzleID: PID, ключ: ключСнимка(r), реплики: r }), услышано: [1], возвраты: [1], минСтавка: [1] }
    const { event } = buildClipPlayed({ puzzleId: PID, counter: c, trackResolved: true, frac: 1, progress: h.result.current.info, subsSource: 'server' }, envelope('2026-11-18'))
    expect(event.subs_report).toBe('partial')
  })

  it('без маршрутного режима — ни GET, ни PUT', async () => {
    const d = fake(notFound)
    const h = renderHook(p => useRouteProgress(p), { initialProps: args(d, { routeMode: { kind: 'off' } }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    h.unmount()
    expect(d.getCalls).toBe(0)
    expect(d.puts.length).toBe(0)
  })
})

describe('PUT', () => {
  it('петля пауз Shadowing — не больше 3 PUT в минуту; поля целые; track_key', async () => {
    const d = fake(notFound)
    const h = renderHook(p => useRouteProgress(p), { initialProps: args(d) })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    const start = Date.now()
    let paused = false
    for (let i = 0; i < 45; i++) {
      paused = !paused
      h.rerender(args(d, { paused, currentTime: 10 + i * 0.37 }))
      await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    }
    // в любом окне 60 с (полуоткрытом) — не больше 3 PUT
    for (const p of d.puts) expect(d.puts.filter(q => q.t >= p.t && q.t < p.t + 60_000).length).toBeLessThanOrEqual(3)
    expect(d.puts.filter(q => q.t < start + 60_000).length).toBeLessThanOrEqual(3)
    expect(d.puts.length).toBeGreaterThanOrEqual(3)
    for (const p of d.puts) {
      expect(Number.isInteger(p.body.position_ms)).toBe(true)
      expect(Number.isInteger(p.body.heard_total)).toBe(true)
      expect(p.body.track_key).toMatch(/^yt-en:[0-9a-f]{8}$/)
    }
    for (let i = 1; i < d.puts.length; i++) expect(d.puts[i].t - d.puts[i - 1].t).toBeGreaterThanOrEqual(20_000)
  })

  it('при уходе — последний PUT', async () => {
    const d = fake(notFound)
    const h = renderHook(p => useRouteProgress(p), { initialProps: args(d) })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    h.unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(d.puts.length).toBe(1)
    expect(d.puts[0].body.state).toEqual({ v: 1, heard: [0, 1, 2, 3], replays: { 0: 2, 3: 2 } })
  })

  it('M3: новый ролик с 3001 услышанной репликой — heard_total не больше шага и выданного ведром', async () => {
    const d = fake(notFound)
    const h = renderHook(p => useRouteProgress(p), { initialProps: args(d, { counter: () => counterHeard(3001, 3500) }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    for (let i = 0; i < 4; i++) { h.rerender(args(d, { counter: () => counterHeard(3001, 3500), currentTime: 100 + i })); await act(async () => { await vi.advanceTimersByTimeAsync(20_001) }) }
    expect(d.puts.length).toBeGreaterThan(0)
    let prev = 0
    for (const p of d.puts) {
      expect(p.body.heard_total - prev).toBeLessThanOrEqual(MAX_PROGRESS_HEARD_STEP)
      prev = p.body.heard_total
    }
    expect(d.puts[0].body.heard_total).toBeLessThanOrEqual(MAX_PROGRESS_HEARD_STEP)
    d.credit = 0
    h.rerender(args(d, { counter: () => counterHeard(3001, 3500), currentTime: 500 }))
    await act(async () => { await vi.advanceTimersByTimeAsync(20_001) })
    const last = d.puts[d.puts.length - 1]
    expect(last.body.heard_total).toBe(prev)
  })
})

describe('выгрузка и уход (ревью партии 2: C2 п.6, L5b)', () => {
  it('pagehide — PUT keepalive сразу, heard_total = известная отметка, ведро не трогается', async () => {
    const d = fake({ ok: true, status: 200, data: { track_key: 'yt-en:other000', position_ms: 0, heard_max: 2, state: { v: 1, heard: [] } } })
    const h = renderHook(p => useRouteProgress(p), { initialProps: args(d, { counter: () => counterHeard(7), currentTime: 33.3337 }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    const reservesBefore = d.reserves.length
    window.dispatchEvent(new Event('pagehide'))
    expect(d.keepalives).toEqual([{ heard_total: 2, position_ms: 33334 }])
    expect(d.reserves.length).toBe(reservesBefore)
    h.unmount()
  })

  it('уход до ответа GET — ни PUT, ни keepalive (сохранённое состояние не затирается)', async () => {
    const d = fake(new Promise<ApiResult<RouteProgress>>(() => {}))
    const h = renderHook(p => useRouteProgress(p), { initialProps: args(d) })
    window.dispatchEvent(new Event('pagehide'))
    h.rerender(args(d, { paused: true }))
    h.unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(d.puts.length).toBe(0)
    expect(d.keepalives.length).toBe(0)
  })
})

describe('отметка и ведро (M4: числа сверены с независимыми значениями)', () => {
  it('GET другой дорожки: отметка = её heard_max, просим ведро только о приросте сверх неё', async () => {
    const d = fake({ ok: true, status: 200, data: { track_key: 'yt-en:other000', position_ms: 0, heard_max: 5, state: { v: 1, heard: [] } } })
    const h = renderHook(p => useRouteProgress(p), { initialProps: args(d, { counter: () => counterHeard(8) }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    h.rerender(args(d, { counter: () => counterHeard(8), currentTime: 5 }))
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(d.reserves[0]).toBe(3)
    expect(d.puts[0].body.heard_total).toBe(8)
  })

  it('неудачный PUT не поднимает отметку', async () => {
    const d = fake(notFound)
    d.putFails = true
    const h = renderHook(p => useRouteProgress(p), { initialProps: args(d, { counter: () => counterHeard(4) }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    h.rerender(args(d, { counter: () => counterHeard(4), currentTime: 2 }))
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    d.putFails = false
    await act(async () => { await vi.advanceTimersByTimeAsync(20_001) })
    h.rerender(args(d, { counter: () => counterHeard(4), currentTime: 30 }))
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(d.reserves).toEqual([4, 4])
  })

  it('шаг heard_total — 300 реплик, state — 96 КиБ (литералы, не константы модуля)', async () => {
    const d = fake(notFound)
    const h = renderHook(p => useRouteProgress(p), { initialProps: args(d, { counter: () => counterHeard(3001, 3500) }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    h.rerender(args(d, { counter: () => counterHeard(3001, 3500), currentTime: 9 }))
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(d.puts[0].body.heard_total).toBe(300)
    expect(STATE_MAX_BYTES).toBe(98304)
  })

  it('пауза до ответа GET PUT не ставит; ключ дорожки — yt-en: + FNV-1a текстов через \\n', async () => {
    let release: (r: ApiResult<RouteProgress>) => void = () => {}
    const d = fake(new Promise(r => { release = r }))
    const h = renderHook(p => useRouteProgress(p), { initialProps: args(d, { paused: true }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(d.puts.length).toBe(0)
    release(notFound)
    expect(trackKeyOf([{ text_en: 'a' }])).toBe('yt-en:e40c292c')
    expect(trackKeyOf([{ text_en: 'a' }, { text_en: 'b' }])).toBe('yt-en:' + fnv1a('a\nb'))
    h.unmount()
  })
})

describe('чистые части', () => {
  it('state ролика в 2000 реплик ≤ 96 КиБ', () => {
    const st = progressState(counterHeard(2000, 2000))
    expect(new TextEncoder().encode(JSON.stringify(st)).length).toBeLessThanOrEqual(STATE_MAX_BYTES)
    expect(st.heard.length).toBe(2000)
  })
  it('state, не помещающийся в 96 КиБ, урезается', () => {
    const st = progressState(counterHeard(40000, 40000))
    expect(new TextEncoder().encode(JSON.stringify(st)).length).toBeLessThanOrEqual(STATE_MAX_BYTES)
  })
  it('fnv1a и разбор state', () => {
    expect(fnv1a('')).toBe('811c9dc5')
    expect(fnv1a('a')).toBe('e40c292c')
    expect(heardFromState({ v: 1, heard: [0, 2, -1, 1.5, 'x'] })).toEqual([0, 2])
    expect(heardFromState({ v: 2, heard: [1] })).toEqual([])
  })
})
