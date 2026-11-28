// progress-retry-after.test.tsx — PR-C, L9: `PUT progress`, получивший 429, не
// повторяется раньше Retry-After — ни по своему шагу 20 с, ни на паузе, ни при уходе
// (размонтирование и pagehide), в том числе под `route_banned`.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useRouteProgress, type ProgressArgs, type ProgressDeps } from '../progress'
import type { RouteModeView } from '../route-mode'
import type { RouteState, RouteProgress, ApiResult } from '../../../site/cabinet/route/route-api'
import { завестиСчётчик, ключСнимка, type Реплика, type Счётчик } from '../subtitle-counter'

const PID = 'youtube::abc123XYZ_1'
const CUES = Array.from({ length: 10 }, (_, i) => ({ start: i * 2, end: i * 2 + 2, text_en: `line ${i} words`, text_ru: '' }))
const ST = { started: true, route_id: 'r', revision: 1, snapshot_date: '2026-11-18', day: { date: '2026-11-18', clips: [] } } as unknown as RouteState
const MODE: RouteModeView = { kind: 'confirmed', puzzleId: PID, state: ST, row: null }
const notFound: ApiResult<RouteProgress> = { ok: false, status: 404, code: 'not_found', retryAfterSec: null, cls: 'other', body: null }

function counter(): Счётчик {
  const r: Реплика[] = Array.from({ length: 10 }, (_, i) => ({ start: i, end: i + 1, text: `w${i}` }))
  const c = завестиСчётчик({ puzzleID: PID, ключ: ключСнимка(r), реплики: r })
  return { ...c, услышано: r.map((_, i) => (i < 3 ? 1 : 0)), возвраты: r.map(() => 0) }
}

interface Fake extends ProgressDeps { puts: number[]; keepalives: number[]; reply: () => ApiResult<{ ok: boolean }> }
function fake(): Fake {
  const f: Fake = {
    puts: [], keepalives: [],
    reply: () => ({ ok: true, status: 200, data: { ok: true } }),
    get: async () => notFound,
    put: async () => { f.puts.push(Date.now()); return f.reply() },
    putKeepalive: () => { f.keepalives.push(Date.now()) },
    reserve: async n => n,
    now: () => Date.now(),
  }
  return f
}
const r429 = (sec: number | null, code = 'rate_limited'): ApiResult<{ ok: boolean }> =>
  ({ ok: false, status: 429, code, retryAfterSec: sec, cls: 'rate', body: null })

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

function args(d: Fake, over: Partial<ProgressArgs> = {}): ProgressArgs {
  return { routeMode: MODE, cues: CUES, counter, currentTime: 1, paused: false, deps: d, ...over }
}

async function play(h: { rerender: (p: ProgressArgs) => void }, d: Fake, fromSec: number, seconds: number, over: Partial<ProgressArgs> = {}) {
  for (let t = 0; t < seconds; t++) {
    h.rerender(args(d, { currentTime: fromSec + t, ...over }))
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
  }
}

describe('L9: PUT progress и Retry-After', () => {
  it('429 Retry-After: 90 — следующий PUT не раньше чем через 90 с (а не через 20)', async () => {
    const d = fake()
    const h = renderHook(p => useRouteProgress(p), { initialProps: args(d) })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    d.reply = () => r429(90)
    await play(h, d, 10, 25)
    expect(d.puts).toHaveLength(1)
    const t429 = d.puts[0]
    d.reply = () => ({ ok: true, status: 200, data: { ok: true } })
    await play(h, d, 40, 100)
    expect(d.puts.length).toBeGreaterThanOrEqual(2)
    expect(d.puts[1] - t429).toBeGreaterThanOrEqual(90_000)
    h.unmount()
  })

  it('route_banned, Retry-After: 30 — PUT паузы ждёт его, а не шага 20 с', async () => {
    const d = fake()
    const h = renderHook(p => useRouteProgress(p), { initialProps: args(d) })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    d.reply = () => r429(30, 'route_banned')
    await play(h, d, 10, 10)
    expect(d.puts).toHaveLength(1)
    const t429 = d.puts[0]
    d.reply = () => ({ ok: true, status: 200, data: { ok: true } })
    h.rerender(args(d, { paused: true, currentTime: 20 }))
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    expect(d.puts).toHaveLength(1)                 // шаг 20 с прошёл, Retry-After — нет
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000) })
    expect(d.puts).toHaveLength(2)
    expect(d.puts[1] - t429).toBeGreaterThanOrEqual(30_000)
    h.unmount()
  })

  it('уход до истечения Retry-After — ни PUT, ни keepalive', async () => {
    const d = fake()
    const h = renderHook(p => useRouteProgress(p), { initialProps: args(d) })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    d.reply = () => r429(120)
    await play(h, d, 10, 21)
    expect(d.puts).toHaveLength(1)
    window.dispatchEvent(new Event('pagehide'))
    expect(d.keepalives).toHaveLength(0)
    h.unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(d.puts).toHaveLength(1)
  })

  it('уход до истечения Retry-After — и после его истечения PUT не появляется (никаких таймеров после размонтирования)', async () => {
    const d = fake()
    const h = renderHook(p => useRouteProgress(p), { initialProps: args(d) })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    d.reply = () => r429(60)
    await play(h, d, 10, 5)
    expect(d.puts).toHaveLength(1)
    d.reply = () => ({ ok: true, status: 200, data: { ok: true } })
    h.unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000) })
    expect(d.puts).toHaveLength(1)
  })

  it('пока действует Retry-After, PUT ждёт таймером на его срок — без опроса в цикле', async () => {
    const d = fake()
    let nowCalls = 0
    d.now = () => { nowCalls++; return Date.now() }
    const h = renderHook(p => useRouteProgress(p), { initialProps: args(d) })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    d.reply = () => r429(60)
    await play(h, d, 10, 6)
    expect(d.puts).toHaveLength(1)
    d.reply = () => ({ ok: true, status: 200, data: { ok: true } })
    h.rerender(args(d, { paused: true, currentTime: 16 }))   // пауза: PUT ставится, но ждёт Retry-After
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    nowCalls = 0
    await act(async () => { await vi.advanceTimersByTimeAsync(40_000) })
    expect(nowCalls).toBeLessThan(20)
    expect(d.puts).toHaveLength(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(d.puts).toHaveLength(2)
    h.unmount()
  })

  it('контроль: уход после истечения Retry-After — PUT и keepalive на месте', async () => {
    const d = fake()
    const h = renderHook(p => useRouteProgress(p), { initialProps: args(d) })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    d.reply = () => r429(30)
    await play(h, d, 10, 21)
    expect(d.puts).toHaveLength(1)
    h.rerender(args(d, { paused: true, currentTime: 31 }))
    d.reply = () => ({ ok: true, status: 200, data: { ok: true } })
    await act(async () => { await vi.advanceTimersByTimeAsync(31_000) })
    const n = d.puts.length
    window.dispatchEvent(new Event('pagehide'))
    expect(d.keepalives).toHaveLength(1)
    h.unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(d.puts.length).toBe(n + 1)
  })
})
