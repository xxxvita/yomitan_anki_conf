// review-guards.test.ts — стражи по ревью партии 2 (M4): числа бана сверены с
// независимыми значениями, проба сторожа снимается ДО запроса, seq отметок не
// начинается заново с новой датой плана, rp/rc сверяются с видео внутри
// resolveRouteMode, потолки повторов чтения состояния и проверки режима.
import { describe, it, expect, beforeEach } from 'vitest'
import { SITE_LINE_CREDIT_CAP, SITE_LINE_CREDIT_PER_MIN, MAX_HEARD_PER_REPORT, MAX_PROGRESS_HEARD_STEP } from '../line-credit'
import { __resetRouteStateForTests, fetchRouteState, BUSY_RETRIES } from '../use-route-state'
import type { ApiDeps, RouteState } from '../route-api'
import { readWatched, writeWatched } from '../../../../player/route-events/route-watched'
import { checkRouteMode, resolveRouteMode, type RouteModeDeps } from '../../../../player/route-events/route-mode'

const json = (st: number, b: unknown, h: Record<string, string> = {}) => new Response(JSON.stringify(b), { status: st, headers: { 'Content-Type': 'application/json', ...h } })

describe('числа бана (ведро реплик шлюза 3000 / 100 в минуту, сайту — половина)', () => {
  it('литералы', () => {
    expect(SITE_LINE_CREDIT_CAP).toBe(1500)
    expect(SITE_LINE_CREDIT_PER_MIN).toBe(50)
    expect(MAX_HEARD_PER_REPORT).toBe(1200)
    expect(MAX_PROGRESS_HEARD_STEP).toBe(300)
    expect(BUSY_RETRIES).toBe(5)
  })
})

describe('проба сторожа flib:route-watched (R3-M3, R4-C1)', () => {
  beforeEach(() => __resetRouteStateForTests())
  it('снимается в момент ОТПРАВКИ: запись, сделанная пока запрос в полёте, в пробу не попадает', async () => {
    let seq = 3
    const deps: ApiDeps = { fetch: async () => { seq = 99; return json(200, { started: false }) } }
    const out = await fetchRouteState({ api: deps, probe: () => ({ watchedSeq: seq, pendingClipPlayed: new Set([`s${seq}`]) }) })
    expect(out.sent.watchedSeq).toBe(3)
    expect([...out.sent.pendingClipPlayed]).toEqual(['s3'])
  })
  it('повторы 429 busy ограничены: после пяти — ответ busy', async () => {
    let n = 0
    const deps: ApiDeps = { fetch: async () => { n++; return json(429, { error: 'busy' }, { 'Retry-After': '1' }) } }
    const out = await fetchRouteState({ api: deps, probe: () => ({ watchedSeq: 0, pendingClipPlayed: new Set() }), sleep: async () => {} })
    expect(n).toBe(6)
    expect(out.result.ok).toBe(false)
  })
})

describe('flib:route-watched: seq при новой дате плана', () => {
  beforeEach(() => localStorage.clear())
  it('новый объект продолжает счёт seq, а не начинает с единицы', () => {
    const R = '11111111-1111-4111-8111-111111111111'
    for (let i = 0; i < 5; i++) writeWatched(R, '2026-11-18', `youtube::${i}`, 0.7, {})
    writeWatched(R, '2026-11-19', 'youtube::new', 0.7, {})
    const o = readWatched()!
    expect(o.seq).toBe(6)
    expect(o.items['youtube::new'].seq).toBe(6)
  })
})

describe('маршрутный режим: rp / rc сверяются с видео', () => {
  const st = (cur: string): RouteState => ({
    started: true, route_id: 'r', revision: 1, snapshot_date: '2026-11-18', started_at: null, goal_label: '',
    params: { daily_listening_budget_min: 20, daily_new_words: 15 },
    day: { date: '2026-11-18', clips: [{ puzzle_id: cur, kind: 'youtube', delivered: true, played: false, queued_played: false, new_words: 0, words: [] }] },
    next_clip: null, current_puzzle_id: cur, replace_available: true, stop_reason: null, active_exchange: null,
  })
  it('rp другого видео — не маршрутный, даже если он текущий', () => {
    expect(resolveRouteMode(st('youtube::otherVideo1'), 'abc123XYZ_1', 'youtube::otherVideo1', null).kind).toBe('off')
    expect(resolveRouteMode(st('youtube::abc123XYZ_1'), 'abc123XYZ_1', 'youtube::abc123XYZ_1', null).kind).toBe('confirmed')
  })
  it('rc другого видео — кнопок нет', () => {
    expect(resolveRouteMode(st('youtube::otherVideo1'), 'abc123XYZ_1', null, 'youtube::otherVideo1').kind).toBe('off')
  })
  it('проверка режима — не дольше 15 с в сумме', async () => {
    let t = 0
    const slept: number[] = []
    const d: RouteModeDeps = {
      marked: () => true, session: async () => true, now: () => t,
      sleep: async ms => { slept.push(ms); t += ms },
      read: async () => ({ result: { ok: false, status: 503, code: 'route_unavailable', retryAfterSec: 6, cls: 'temporary', body: null }, sent: { watchedSeq: 0, pendingClipPlayed: new Set() } }),
    }
    expect((await checkRouteMode('abc123XYZ_1', 'youtube::abc123XYZ_1', null, d)).kind).toBe('off')
    expect(slept).toEqual([6000, 6000])
  })
})
