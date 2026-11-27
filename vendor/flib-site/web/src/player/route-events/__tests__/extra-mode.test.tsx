// extra-mode.test.tsx — режим плеера `extra` (спека extra-video §9, §10): выбор режима
// по `rx`, единственная точка выхода событий (`commit`) и их метка `origin:"more"`.
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { resolveRouteMode, checkRouteMode, initialRouteMode, useRouteMode, type RouteModeDeps, type RouteModeView } from '../route-mode'
import { useRouteEvents, type RouteEventsArgs, type RouteEventsDeps } from '../useRouteEvents'
import type { DayClipDelivered, DayClipKept, ExtraRow, RouteState } from '../../../site/cabinet/route/route-api'
import { __resetClipListenedForTests, isClipListened, __resetExtraListenedForTests, isExtraListened } from '../clip-listened'
import { useRouteProgress } from '../progress'
import { readWatched } from '../route-watched'
import { __resetSessionForTests, __setSessionForTests } from '../../../site/session'
import { HEARD_FRAC_KEY } from '../../../site/cabinet/route/heard-check/heard-check-memory'

const V = 'extraVid_01'
const PID = `youtube::${V}`
const ROUTE = '11111111-1111-4111-8111-111111111111'

const exRow = (pid = PID, over: Partial<ExtraRow> = {}): ExtraRow => ({ puzzle_id: pid, kind: 'youtube', video_id: pid.slice(9), title: 'Extra', source: 'youtube', duration_sec: 90, played: false, ...over })
const dayRow = (pid: string, over: Partial<DayClipDelivered> = {}): DayClipDelivered => ({
  puzzle_id: pid, kind: 'youtube', video_id: pid.slice(9), title: 'Day', delivered: true, played: false, queued_played: false, new_words: 0, words: [], ...over,
})
function st(over: Partial<RouteState> = {}): RouteState {
  return {
    started: true, route_id: ROUTE, revision: 3, snapshot_date: '2026-11-18', started_at: null, goal_label: '',
    params: { daily_listening_budget_min: 20, daily_new_words: 15 }, day: { date: '2026-11-18', clips: [dayRow('youtube::dayVideo001')] },
    next_clip: null, current_puzzle_id: 'youtube::dayVideo001', replace_available: true, stop_reason: null, active_exchange: null,
    extras: [exRow()], extra_available: true, ...over,
  }
}

describe('resolveRouteMode с rx', () => {
  it('выданный и не в плане — extra с его строкой', () => {
    const s = st()
    expect(resolveRouteMode(s, V, null, null, PID)).toEqual({ kind: 'extra', puzzleId: PID, state: s, row: s.extras![0] })
  })
  it('нет в extras — off', () => { expect(resolveRouteMode(st({ extras: [exRow('youtube::other000001')] }), V, null, null, PID).kind).toBe('off') })
  it('extras не пришли (старый BFF) — off', () => { expect(resolveRouteMode(st({ extras: undefined }), V, null, null, PID).kind).toBe('off') })
  it('есть в плане дня (выдан) — off', () => {
    expect(resolveRouteMode(st({ day: { date: '2026-11-18', clips: [dayRow(PID)] } }), V, null, null, PID).kind).toBe('off')
  })
  it('есть среди оставленных kept — off', () => {
    const kept = { ...dayRow(PID), kept: true } as unknown as DayClipKept
    expect(resolveRouteMode(st({ day: { date: '2026-11-18', clips: [kept] } }), V, null, null, PID).kind).toBe('off')
  })
  it('rx другого ролика — off', () => { expect(resolveRouteMode(st(), 'someoneElse1', null, null, PID).kind).toBe('off') })
  it('собственный rp решает сам, rx не смотрится — и когда rp даёт off', () => {
    const s = st({ current_puzzle_id: PID, day: { date: '2026-11-18', clips: [dayRow(PID)] } })
    expect(resolveRouteMode(s, V, PID, null, PID).kind).toBe('confirmed')
    expect(resolveRouteMode(st({ current_puzzle_id: 'youtube::dayVideo001' }), V, PID, null, PID).kind).toBe('off')
  })
})

describe('checkRouteMode / initialRouteMode с rx', () => {
  const sent = { watchedSeq: 0, pendingClipPlayed: new Set<string>() }
  const mk = (reads: Array<{ ok: boolean; status: number; data?: RouteState }>, over: Partial<RouteModeDeps> = {}): RouteModeDeps & { n: () => number } => {
    let i = 0
    return {
      marked: () => true, session: async () => true, now: () => 0, sleep: async () => {},
      read: async () => { const r = reads[Math.min(i++, reads.length - 1)]; return { result: r as never, sent } },
      n: () => i, ...over,
    }
  }
  it('без метки маршрута — off, без сессии — off, без запроса', async () => {
    const d1 = mk([{ ok: true, status: 200, data: st() }], { marked: () => false })
    expect((await checkRouteMode(V, null, null, d1, PID)).kind).toBe('off'); expect(d1.n()).toBe(0)
    const d2 = mk([{ ok: true, status: 200, data: st() }], { session: async () => false })
    expect((await checkRouteMode(V, null, null, d2, PID)).kind).toBe('off'); expect(d2.n()).toBe(0)
  })
  it('429, затем ok — extra', async () => {
    const d = mk([{ ok: false, status: 429 }, { ok: true, status: 200, data: st() }])
    expect((await checkRouteMode(V, null, null, d, PID)).kind).toBe('extra'); expect(d.n()).toBe(2)
  })
  it('initialRouteMode: pending с extra только для rx без rp', () => {
    expect(initialRouteMode(V, null, true, PID)).toEqual({ kind: 'pending', puzzleId: PID, extra: true })
    expect(initialRouteMode(V, PID, true, PID)).toEqual({ kind: 'pending', puzzleId: PID })
    expect(initialRouteMode(V, null, false, PID).kind).toBe('off')
    expect(initialRouteMode('someoneElse1', null, true, PID).kind).toBe('off')
  })
})

describe('useRouteMode с rx', () => {
  afterEach(() => { vi.useRealTimers(); __resetSessionForTests() })
  const sent = { watchedSeq: 0, pendingClipPlayed: new Set<string>() }
  it('потолок 15 с: pending(extra) → off', async () => {
    vi.useFakeTimers()
    const deps: RouteModeDeps = { marked: () => true, session: async () => true, now: () => Date.now(), sleep: () => new Promise(() => {}), read: () => new Promise(() => {}) }
    const { result } = renderHook(() => useRouteMode(V, null, null, deps, PID))
    expect(result.current).toEqual({ kind: 'pending', puzzleId: PID, extra: true })
    await act(async () => { await vi.advanceTimersByTimeAsync(14_900) })
    expect(result.current.kind).toBe('pending')
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    expect(result.current.kind).toBe('off')
  })
  it('выход — off, вход другим ключом — проверка заново', async () => {
    __resetSessionForTests()
    __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_one0' })
    let reads = 0
    const deps: RouteModeDeps = { marked: () => true, session: async () => true, now: () => Date.now(), sleep: async () => {}, read: async () => { reads++; return { result: { ok: true, status: 200, data: st() }, sent } } }
    const { result } = renderHook(() => useRouteMode(V, null, null, deps, PID))
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
    expect(result.current.kind).toBe('extra')
    act(() => { __setSessionForTests({ cabinet: true, authenticated: false, reason: 'logout' }) })
    expect(result.current.kind).toBe('off')
    act(() => { __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_two0' }) })
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
    expect(reads).toBe(2)
    expect(result.current.kind).toBe('extra')
  })
})

// ── события ─────────────────────────────────────────────────────────────────
class FakeBox {
  items: Array<{ route_id: string; event: Record<string, unknown>; frac?: number; durable: boolean }> = []
  order: string[] = []
  enqueue(routeId: string, ev: Record<string, unknown>) { this.items.push({ route_id: routeId, event: ev, durable: false }); this.order.push(`q:${ev.type}`) }
  async enqueueDurable(routeId: string, ev: Record<string, unknown>, o: { frac?: number; afterWrite?: () => void } = {}) {
    this.items.push({ route_id: routeId, event: ev, frac: o.frac, durable: true }); this.order.push(`q:${ev.type}`)
    if (o.afterWrite) { o.afterWrite(); this.order.push('watched') }
  }
  onPagehide() { this.order.push('pagehide') }
  types() { return this.items.map(i => i.event.type) }
}
let box: FakeBox
const deps = (): RouteEventsDeps => ({ outbox: box as never, storage: localStorage, now: () => new Date('2026-11-18T10:00:00Z') })
const extraMode = (s = st(), pid = PID): RouteModeView => ({ kind: 'extra', puzzleId: pid, state: s, row: s.extras!.find(e => e.puzzle_id === pid)! })
const CUES = [
  { start: 0, end: 4, text_en: 'Hello brave new world', text_ru: '' },
  { start: 4, end: 8, text_en: 'Second line here', text_ru: '' },
  { start: 8, end: 12, text_en: 'Third line now', text_ru: '' },
]
const NF = { kind: 'not_found' as const, heardMax: 0 }
function args(over: Partial<RouteEventsArgs> = {}): RouteEventsArgs {
  return { videoId: V, routeMode: extraMode(), cues: CUES, subsStatus: 'ok', subsSource: 'daemon_align', currentTime: 0, duration: 12, rate: 1, seeking: () => false,
    progress: NF, progressSettled: true, deps: deps(), ...over }
}
function play(r: { rerender: (a: RouteEventsArgs) => void }, base: RouteEventsArgs, from: number, to: number) {
  for (let t = from; t <= to + 1e-9; t += 0.25) r.rerender({ ...base, currentTime: Math.round(t * 1000) / 1000 })
}
beforeEach(() => { box = new FakeBox(); localStorage.clear(); __resetClipListenedForTests(); __resetExtraListenedForTests() })

describe('события extra: метка origin и фильтр commit', () => {
  it('hint, subtitles_shown, line_translated уходят с origin:"more", перемотка — нет', () => {
    const r = renderHook(p => useRouteEvents(p), { initialProps: args() })
    r.rerender(args({ currentTime: 6 }))
    r.result.current.onWordClick('hello'); r.result.current.onWordsRevealed(0, ['brave']); r.result.current.onLineTranslated(1)
    r.result.current.onSeek(10, 2)
    r.unmount()
    expect(box.types().sort()).toEqual(['clip_played', 'hint_requested', 'line_translated', 'subtitles_shown'])
    for (const i of box.items) expect(i.event.origin).toBe('more')
    expect(box.types()).not.toContain('clip_replayed')
  })
  it('копирование выделенного ничего не шлёт', () => {
    const r = renderHook(p => useRouteEvents(p), { initialProps: args() })
    const el = document.createElement('div'); el.setAttribute('data-testid', 'subtitle-overlay'); el.textContent = 'hello brave'; document.body.appendChild(el)
    const sel = window.getSelection()!; const range = document.createRange(); range.selectNodeContents(el); sel.removeAllRanges(); sel.addRange(range)
    document.dispatchEvent(new Event('copy'))
    el.remove()
    expect(box.items).toEqual([])
    r.unmount()
  })
  it('rate("like") в extra — false и ничего не шлёт', () => {
    const r = renderHook(p => useRouteEvents(p), { initialProps: args() })
    expect(r.result.current.rate('like')).toBe(false)
    r.unmount()
    expect(box.types()).not.toContain('clip_rated')
  })
  it('rate("like") при pending(extra), затем подтверждение — ничего не шлёт', () => {
    const pend: RouteModeView = { kind: 'pending', puzzleId: PID, extra: true }
    const r = renderHook(p => useRouteEvents(p), { initialProps: args({ routeMode: pend }) })
    expect(r.result.current.rate('like')).toBe(false)
    r.rerender(args({ routeMode: extraMode() }))
    r.unmount()
    expect(box.types()).not.toContain('clip_rated')
  })
  it('pending(extra): события копятся, после подтверждения уходят с origin; не подтвердился — ничего', () => {
    const pend: RouteModeView = { kind: 'pending', puzzleId: PID, extra: true }
    const r = renderHook(p => useRouteEvents(p), { initialProps: args({ routeMode: pend }) })
    r.result.current.onWordClick('hello'); r.result.current.onSeek(10, 2)
    const el = document.createElement('div'); el.setAttribute('data-testid', 'subtitle-overlay'); el.textContent = 'second line'; document.body.appendChild(el)
    const sel = window.getSelection()!; const range = document.createRange(); range.selectNodeContents(el); sel.removeAllRanges(); sel.addRange(range)
    document.dispatchEvent(new Event('copy'))
    el.remove()
    expect(box.items).toEqual([])
    r.rerender(args({ routeMode: extraMode() }))
    expect(box.types()).toEqual(['hint_requested'])
    expect(box.items[0].event.origin).toBe('more')
    box = new FakeBox()
    const r2 = renderHook(p => useRouteEvents(p), { initialProps: args({ routeMode: pend }) })
    r2.result.current.onWordClick('world')
    r2.rerender(args({ routeMode: { kind: 'off' } }))
    r2.unmount()
    expect(box.items).toEqual([])
  })
  it('pending(extra): копия и перемотка, сделанные до подтверждения, не уходят (фильтр commit)', () => {
    const pend: RouteModeView = { kind: 'pending', puzzleId: PID, extra: true }
    const r = renderHook(p => useRouteEvents(p), { initialProps: args({ routeMode: pend }) })
    r.rerender(args({ routeMode: pend, currentTime: 6 }))
    r.result.current.onSeek(6, 1)
    r.rerender(args({ routeMode: extraMode(), currentTime: 6 }))
    r.unmount()
    expect(box.types()).toEqual(['clip_played'])
  })
  it('clip_played один раз, через enqueueDurable без записи flib:route-watched, с origin и frac', () => {
    const base = args()
    const r = renderHook(p => useRouteEvents(p), { initialProps: base })
    play(r, base, 0, 11.5)
    r.unmount()
    expect(box.types()).toEqual(['clip_played'])
    expect(box.items[0].durable).toBe(true)
    expect(box.items[0].frac).toBeGreaterThan(0.9)
    expect(box.items[0].event.origin).toBe('more')
    expect(box.items[0].event.learning_day).toBe('2026-11-18')
    expect(box.order).toEqual(['q:clip_played'])
    expect(readWatched(localStorage)).toBeNull()
  })
  it('полное прослушивание на свежем открытии — subs_report full', () => {
    const base = args()
    const r = renderHook(p => useRouteEvents(p), { initialProps: base })
    play(r, base, 0, 11.5)
    r.unmount()
    expect(box.items[0].event.subs_report).toBe('full')
  })
  it('отчёт, ужатый свыше 240 КиБ, — partial и всё равно с origin', () => {
    const big = [0, 1, 2].map(i => ({ start: i * 4, end: i * 4 + 4, text_en: Array.from({ length: 12000 }, (_, k) => `w${i}x${k}`).join(' '), text_ru: '' }))
    const base = args({ cues: big })
    const r = renderHook(p => useRouteEvents(p), { initialProps: base })
    play(r, base, 0, 11.5)
    r.unmount()
    expect(box.types()).toEqual(['clip_played'])
    expect(box.items[0].event.subs_report).toBe('partial')
    expect(box.items[0].event.origin).toBe('more')
  })
  it('подсматривания идут в очереди раньше отчёта', () => {
    const base = args()
    const r = renderHook(p => useRouteEvents(p), { initialProps: base })
    play(r, base, 0, 5)
    r.result.current.onWordClick('hello')
    r.unmount()
    expect(box.types()).toEqual(['hint_requested', 'clip_played'])
  })
  it('память «просмотрен/прослушан/доля теста» не трогается', () => {
    const base = args()
    const r = renderHook(p => useRouteEvents(p), { initialProps: base })
    play(r, base, 0, 11.5)
    r.unmount()
    expect(isClipListened(PID)).toBe(false)
    // своя отметка extra — ставится (по тому же правилу «прослушан»), дневная — нет
    expect(isExtraListened(ROUTE, PID)).toBe(true)
    expect(localStorage.getItem('flib:route-extra-listened')).toBe(JSON.stringify([`${ROUTE}|${PID}`]))
    expect(localStorage.getItem('flib:route-watched')).toBeNull()
    expect(localStorage.getItem('flib:route-listened')).toBeNull()
    expect(localStorage.getItem(HEARD_FRAC_KEY)).toBeNull()
  })
  it('extra_available:false в состоянии не отнимает origin', () => {
    const s = st({ extra_available: false })
    const base = args({ routeMode: extraMode(s) })
    const r = renderHook(p => useRouteEvents(p), { initialProps: base })
    r.result.current.onWordClick('hello')
    play(r, base, 0, 11.5)
    r.unmount()
    expect(box.items.length).toBe(2)
    for (const i of box.items) expect(i.event.origin).toBe('more')
  })
  it('дневной ролик (rp) — без origin', () => {
    const s = st({ day: { date: '2026-11-18', clips: [dayRow('youtube::dayVideo001')] } })
    const mode: RouteModeView = { kind: 'confirmed', puzzleId: 'youtube::dayVideo001', state: s, row: s.day!.clips[0] as DayClipDelivered }
    const base = args({ routeMode: mode, videoId: 'dayVideo001' })
    const r = renderHook(p => useRouteEvents(p), { initialProps: base })
    r.result.current.onWordClick('hello')
    play(r, base, 0, 11.5)
    r.unmount()
    expect(box.types().sort()).toEqual(['clip_played', 'hint_requested'])
    for (const i of box.items) expect(i.event.origin).toBeUndefined()
  })
  it('смена ролика на месте: отчёт A (extra) с origin, отчёт B (дневной) без', () => {
    const s = st({ day: { date: '2026-11-18', clips: [dayRow('youtube::dayVideo001')] } })
    const B: RouteModeView = { kind: 'confirmed', puzzleId: 'youtube::dayVideo001', state: s, row: s.day!.clips[0] as DayClipDelivered }
    const baseA = args({ routeMode: extraMode(s) })
    const r = renderHook(p => useRouteEvents(p), { initialProps: baseA })
    r.rerender({ ...baseA, currentTime: 5 })
    const baseB = { ...baseA, videoId: 'dayVideo001', routeMode: B }
    r.rerender({ ...baseB, currentTime: 5 })
    r.rerender({ ...baseB, currentTime: 0, duration: 60 })
    r.rerender({ ...baseB, currentTime: 0.5, duration: 60 })
    r.rerender({ ...baseB, currentTime: 20, duration: 60 })
    r.unmount()
    const played = box.items.filter(i => i.event.type === 'clip_played')
    expect(played.map(i => [i.event.puzzle_id, i.event.origin])).toEqual([[PID, 'more'], ['youtube::dayVideo001', undefined]])
  })
  it('pagehide отправляет отчёт extra с origin', () => {
    const base = args()
    const r = renderHook(p => useRouteEvents(p), { initialProps: base })
    r.rerender({ ...base, currentTime: 5 })
    window.dispatchEvent(new Event('pagehide'))
    expect(box.types()).toEqual(['clip_played'])
    expect(box.items[0].event.origin).toBe('more')
    expect(box.order.indexOf('q:clip_played')).toBeLessThan(box.order.indexOf('pagehide'))
    r.unmount()
  })
})

describe('события extra: способ постановки', () => {
  it('через enqueueDurable идёт только clip_played, прочие роды — через enqueue', () => {
    const base = args()
    const r = renderHook(p => useRouteEvents(p), { initialProps: base })
    r.result.current.onWordClick('hello'); r.result.current.onWordsRevealed(0, ['brave']); r.result.current.onLineTranslated(1)
    play(r, base, 0, 11.5)
    r.unmount()
    for (const i of box.items) expect(i.durable).toBe(i.event.type === 'clip_played')
    expect(box.items.filter(i => i.durable).length).toBe(1)
    expect(box.items.length).toBe(4)
  })
})

// ── смена ролика/режима на месте: отчёт закрытого открытия строится по ЕГО режиму ──
describe('прогресс при смене на месте (настоящий useRouteProgress)', () => {
  const FAILED = { ok: false as const, status: 500 }
  const OTHER = { ok: true as const, data: { track_key: 'zzz', position_ms: 0, heard_max: 9, state: null } }
  const stA = (over: Partial<RouteState> = {}) => st({ extras: [], ...over })
  const dayA: RouteModeView = { kind: 'confirmed', puzzleId: 'youtube::A', state: stA(), row: null }
  const exA: RouteModeView = { kind: 'extra', puzzleId: 'youtube::A', state: stA(), row: exRow('youtube::A') }
  const pendB: RouteModeView = { kind: 'pending', puzzleId: 'youtube::B' }
  const pendBx: RouteModeView = { kind: 'pending', puzzleId: 'youtube::B', extra: true }
  const off: RouteModeView = { kind: 'off' }

  async function run(A: RouteModeView, B: RouteModeView, getRes: unknown) {
    const pdeps = { get: async () => getRes, put: async () => ({ ok: true }), putKeepalive: () => {}, reserve: async () => 0, now: () => 0 } as never
    // выражения progress/progressSettled — как в PlayerPage: прогресс по режиму не выбирается
    const h = renderHook((p: { routeMode: RouteModeView; videoId: string; currentTime: number }) => {
      const prog = useRouteProgress({ routeMode: p.routeMode, cues: CUES, counter: () => null, currentTime: p.currentTime, paused: false, deps: pdeps })
      return useRouteEvents({ videoId: p.videoId, routeMode: p.routeMode, cues: CUES, subsStatus: 'ok', subsSource: 'x', currentTime: p.currentTime, duration: 12, rate: 1, seeking: () => false,
        progress: prog.info, progressSettled: p.routeMode.kind === 'confirmed' ? prog.settled : false, restoreHeard: prog.restoreHeard, deps: deps() })
    }, { initialProps: { routeMode: A, videoId: 'A', currentTime: 0 } })
    await act(async () => { await new Promise(r => setTimeout(r, 5)) })
    for (let t = 0.25; t <= 11; t += 0.25) h.rerender({ routeMode: A, videoId: 'A', currentTime: t })
    h.rerender({ routeMode: B, videoId: 'B', currentTime: 11 })
    h.unmount()
    return box.items.filter(i => i.event.type === 'clip_played').map(i => ({ pid: i.event.puzzle_id, rep: i.event.subs_report, origin: i.event.origin, frac: i.event.played_frac }))
  }

  it('день A (GET прогресса не удался) → extra B: A остаётся partial без origin', async () => {
    const out = await run(dayA, pendBx, FAILED)
    expect(out.length).toBe(1)
    expect(out[0]).toMatchObject({ pid: 'youtube::A', rep: 'partial', origin: undefined })
    expect(out[0].frac).toBeGreaterThan(0)
  })
  it('день A (другая дорожка, heard_max 9) → extra B: A partial', async () => {
    const out = await run(dayA, pendBx, OTHER)
    expect(out[0]).toMatchObject({ pid: 'youtube::A', rep: 'partial', origin: undefined })
  })
  it('день A → день B: A partial (как раньше)', async () => {
    expect((await run(dayA, pendB, FAILED))[0]).toMatchObject({ rep: 'partial', origin: undefined })
  })
  it('extra A → день B: A — первое открытие, full с origin и без played_frac', async () => {
    const out = await run(exA, pendB, FAILED)
    expect(out.length).toBe(1)
    expect(out[0]).toMatchObject({ pid: 'youtube::A', rep: 'full', origin: 'more', frac: undefined })
  })
  it('extra A → off: A full с origin', async () => {
    expect((await run(exA, off, FAILED))[0]).toMatchObject({ rep: 'full', origin: 'more' })
  })
  it('extra A → extra B: A full с origin', async () => {
    expect((await run(exA, pendBx, OTHER))[0]).toMatchObject({ rep: 'full', origin: 'more' })
  })
})

describe('смена флага extra у того же ролика — две разные сессии', () => {
  const P = PID
  const s2 = st()
  const day: RouteModeView = { kind: 'confirmed', puzzleId: P, state: s2, row: dayRow(P) }
  const pend: RouteModeView = { kind: 'pending', puzzleId: P }
  const pendx: RouteModeView = { kind: 'pending', puzzleId: P, extra: true }
  const mk = (m: RouteModeView) => args({ routeMode: m })
  const sum = () => box.items.map(i => [i.event.type, i.event.origin])

  const reps = () => box.items.filter(i => i.event.type === 'clip_played').map(i => [i.event.origin, i.event.subs_report])
  it('extra → rp на месте: отчёт extra с origin, отчёт дневного — без; счётчик нового открытия жив', () => {
    const r = renderHook(p => useRouteEvents(p), { initialProps: mk(extraMode()) })
    for (let t = 0.25; t <= 6; t += 0.25) r.rerender({ ...mk(extraMode()), currentTime: t })
    r.result.current.onWordClick('hello')
    r.rerender({ ...mk(pend), currentTime: 6 })
    r.rerender({ ...mk(day), currentTime: 6 })
    expect(r.result.current.counter()).not.toBeNull()
    for (let t = 6.25; t <= 11; t += 0.25) r.rerender({ ...mk(day), currentTime: t })
    r.unmount()
    expect(sum()).toEqual([['hint_requested', 'more'], ['clip_played', 'more'], ['clip_played', undefined]])
    expect(reps()).toEqual([['more', 'full'], [undefined, 'full']])
  })
  it('pending(extra) → rp на месте: счётчик нового открытия жив, отчёт full', () => {
    const r = renderHook(p => useRouteEvents(p), { initialProps: mk(pendx) })
    for (let t = 0.25; t <= 6; t += 0.25) r.rerender({ ...mk(pendx), currentTime: t })
    r.rerender({ ...mk(pend), currentTime: 6 })
    r.rerender({ ...mk(day), currentTime: 6 })
    expect(r.result.current.counter()).not.toBeNull()
    for (let t = 6.25; t <= 11; t += 0.25) r.rerender({ ...mk(day), currentTime: t })
    r.unmount()
    expect(reps()).toEqual([[undefined, 'full']])
  })
  it('день → rx на месте: отчёт дня без origin, затем extra с origin; счётчик жив', () => {
    const r = renderHook(p => useRouteEvents(p), { initialProps: mk(day) })
    for (let t = 0.25; t <= 6; t += 0.25) r.rerender({ ...mk(day), currentTime: t })
    r.rerender({ ...mk(pendx), currentTime: 6 })
    r.rerender({ ...mk(extraMode()), currentTime: 6 })
    expect(r.result.current.counter()).not.toBeNull()
    for (let t = 6.25; t <= 11; t += 0.25) r.rerender({ ...mk(extraMode()), currentTime: t })
    r.unmount()
    expect(sum()).toEqual([['clip_played', undefined], ['clip_played', 'more']])
    expect(reps()).toEqual([[undefined, 'full'], ['more', 'full']])
  })
  it('pending(extra) → extra того же ролика — одна сессия: один отчёт, held-событие уходит', () => {
    const r = renderHook(p => useRouteEvents(p), { initialProps: mk(pendx) })
    r.result.current.onWordClick('hello')
    r.rerender(mk(extraMode()))
    for (let t = 0.25; t <= 11.5; t += 0.25) r.rerender({ ...mk(extraMode()), currentTime: t })
    r.unmount()
    expect(sum()).toEqual([['hint_requested', 'more'], ['clip_played', 'more']])
    expect(box.items[1].event.subs_report).toBe('full')
  })
})

describe('пересмотр полностью прослушанного extra (§9, ребро 23)', () => {
  const OTHER = '22222222-2222-4222-8222-222222222222'
  const playedMode = (): RouteModeView => extraMode(st({ extras: [exRow(PID, { played: true })] }))
  it('отметка этого маршрута и ролика уже стояла и строка played — ни одного события (подсматривания, отчёт, pagehide, размонтирование)', () => {
    localStorage.setItem('flib:route-extra-listened', JSON.stringify([`${ROUTE}|${PID}`]))
    __resetExtraListenedForTests()
    const base = args({ routeMode: playedMode() })
    const r = renderHook(p => useRouteEvents(p), { initialProps: base })
    r.result.current.onWordClick('hello'); r.result.current.onWordsRevealed(0, ['brave']); r.result.current.onLineTranslated(1)
    play(r, base, 0, 6)
    window.dispatchEvent(new Event('pagehide'))
    play(r, base, 6, 11.5)
    r.unmount()
    expect(box.items).toEqual([])
    expect(box.order).not.toContain('pagehide')
  })
  it('тихая сессия: копившиеся до подтверждения события тоже не уходят', () => {
    localStorage.setItem('flib:route-extra-listened', JSON.stringify([`${ROUTE}|${PID}`]))
    __resetExtraListenedForTests()
    const pend: RouteModeView = { kind: 'pending', puzzleId: PID, extra: true }
    const r = renderHook(p => useRouteEvents(p), { initialProps: args({ routeMode: pend }) })
    r.result.current.onWordClick('hello')
    r.rerender(args({ routeMode: playedMode() }))
    r.unmount()
    expect(box.items).toEqual([])
  })
  it('N2: отметка стояла, но строка не played (первый отчёт потерян) — один полный отчёт с origin', () => {
    localStorage.setItem('flib:route-extra-listened', JSON.stringify([`${ROUTE}|${PID}`]))
    __resetExtraListenedForTests()
    const base = args()
    const r = renderHook(p => useRouteEvents(p), { initialProps: base })
    play(r, base, 0, 11.5)
    r.unmount()
    expect(box.types()).toEqual(['clip_played'])
    expect(box.items[0].event.origin).toBe('more')
    expect(box.items[0].event.subs_report).toBe('full')
  })
  it('N1: прямая смена маршрута в открытом плеере — тишина не переносится', () => {
    const OTHER_R = '33333333-3333-4333-8333-333333333333'
    localStorage.setItem('flib:route-extra-listened', JSON.stringify([`${ROUTE}|${PID}`]))
    __resetExtraListenedForTests()
    const base = args({ routeMode: playedMode() })
    const r = renderHook(p => useRouteEvents(p), { initialProps: base })
    r.result.current.onWordClick('hello')
    expect(box.items).toEqual([])
    r.rerender({ ...base, routeMode: extraMode(st({ route_id: OTHER_R, extras: [exRow(PID, { played: true })] })) })
    r.result.current.onWordClick('brave')
    r.unmount()
    expect(box.types()).toEqual(['hint_requested'])
    expect(box.items[0].route_id).toBe(OTHER_R)
    expect(box.items[0].event.origin).toBe('more')
  })
  it('отметка другого маршрута — сессия не тихая, события с origin', () => {
    localStorage.setItem('flib:route-extra-listened', JSON.stringify([`${OTHER}|${PID}`]))
    __resetExtraListenedForTests()
    const base = args()
    const r = renderHook(p => useRouteEvents(p), { initialProps: base })
    r.result.current.onWordClick('hello')
    play(r, base, 0, 5)
    r.unmount()
    expect(box.types()).toEqual(['hint_requested', 'clip_played'])
    for (const i of box.items) expect(i.event.origin).toBe('more')
  })
  it('старый формат (голый puzzle_id) игнорируется', () => {
    localStorage.setItem('flib:route-extra-listened', JSON.stringify([PID]))
    __resetExtraListenedForTests()
    expect(isExtraListened(ROUTE, PID)).toBe(false)
    const base = args()
    const r = renderHook(p => useRouteEvents(p), { initialProps: base })
    play(r, base, 0, 5)
    r.unmount()
    expect(box.types()).toEqual(['clip_played'])
  })
  it('прежний частичный просмотр (отметки нет) — события с origin', () => {
    const base = args()
    const r = renderHook(p => useRouteEvents(p), { initialProps: base })
    play(r, base, 0, 5)
    r.unmount()
    expect(box.items.length).toBe(1)
    expect(box.items[0].event.origin).toBe('more')
    expect(isExtraListened(ROUTE, PID)).toBe(false)
  })
  it('первый полный просмотр: отметка появляется вживую, отчёт один, с origin и full', () => {
    const base = args()
    const r = renderHook(p => useRouteEvents(p), { initialProps: base })
    play(r, base, 0, 11.5)
    expect(isExtraListened(ROUTE, PID)).toBe(true)
    r.unmount()
    expect(box.types()).toEqual(['clip_played'])
    expect(box.items[0].event.origin).toBe('more')
    expect(box.items[0].event.subs_report).toBe('full')
  })
  it('обновление состояния после появления отметки не делает сессию тихой', () => {
    const base = args({ duration: 60 })
    const r = renderHook(p => useRouteEvents(p), { initialProps: base })
    play(r, base, 0, 12) // все реплики услышаны: отметка ставится вживую, ролик ещё идёт
    expect(isExtraListened(ROUTE, PID)).toBe(true)
    r.rerender({ ...base, currentTime: 12, routeMode: extraMode(st({ revision: 9, extras: [exRow(PID, { played: true })] })) })
    r.unmount()
    expect(box.types()).toEqual(['clip_played'])
  })
})
