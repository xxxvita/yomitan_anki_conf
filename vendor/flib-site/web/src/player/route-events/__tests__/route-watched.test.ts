// route-watched.test.ts — `flib:route-watched` (спека §4.2 п.2, §6.2, R2-L1,
// R3-M3, R4-C1, Р24; план B8c): запись поднимает seq, share — максимум, другая
// эпоха или дата плана отбрасывается, ≤ 200; сторож удаления — только запись,
// бывшая при отправке и не переписанная до ответа, без clip_played в очереди,
// и только при выданной строке плана с played:false без queued_played.
import { describe, it, expect, beforeEach } from 'vitest'
import { pruneWatched, readWatched, removeWatched, watchedFor, writeWatched, WATCHED_MAX_ITEMS } from '../route-watched'
import { readWatchedSeq } from '../../../site/cabinet/route/route-storage'
import type { DayClip, RouteState } from '../../../site/cabinet/route/route-api'

const R = '11111111-1111-4111-8111-111111111111'
const D = '2026-11-18'
const A = 'youtube::AAAAAAAAAAA'
const B = 'youtube::BBBBBBBBBBB'

function state(clips: DayClip[], over: Partial<RouteState> = {}): RouteState {
  return {
    started: true, route_id: R, revision: 1, snapshot_date: D, started_at: null, goal_label: '',
    params: { daily_listening_budget_min: 20, daily_new_words: 15 }, day: { date: D, clips }, next_clip: null,
    current_puzzle_id: null, replace_available: true, stop_reason: null, active_exchange: null, ...over,
  }
}
const row = (pid: string, played = false, queued = false): DayClip => ({ puzzle_id: pid, kind: 'youtube', delivered: true, played, queued_played: queued, new_words: 0, words: [] })

beforeEach(() => localStorage.clear())

describe('запись', () => {
  it('каждая запись поднимает seq объекта и записи; share — максимум', () => {
    writeWatched(R, D, A, 0.7, { title: 'A' })
    writeWatched(R, D, A, 0.3, { title: 'A' })
    const o = readWatched()!
    expect(o.seq).toBe(2)
    expect(o.items[A]).toEqual({ share: 0.7, seq: 2, meta: { title: 'A' } })
    expect(readWatchedSeq()).toBe(2)
  })
  it('другая эпоха или другая дата плана — содержимое отбрасывается', () => {
    writeWatched(R, D, A, 0.7, {})
    writeWatched(R, '2026-11-19', B, 0.9, {})
    expect(Object.keys(readWatched()!.items)).toEqual([B])
    expect(watchedFor(R, D)).toEqual({})
    writeWatched('22222222-2222-4222-8222-222222222222', '2026-11-19', A, 0.9, {})
    expect(watchedFor(R, '2026-11-19')).toEqual({})
  })
  it('не больше 200 записей, вытесняются старшие по seq', () => {
    for (let i = 0; i < WATCHED_MAX_ITEMS + 5; i++) writeWatched(R, D, `youtube::${i}`, 0.5, {})
    const o = readWatched()!
    expect(Object.keys(o.items).length).toBe(WATCHED_MAX_ITEMS)
    expect(o.items['youtube::0']).toBeUndefined()
    expect(o.items[`youtube::${WATCHED_MAX_ITEMS + 4}`]).toBeTruthy()
  })
  it('removeWatched — запись заменяемого ролика', () => {
    writeWatched(R, D, A, 0.7, {}); writeWatched(R, D, B, 0.7, {})
    removeWatched(A)
    expect(Object.keys(readWatched()!.items)).toEqual([B])
  })
})

describe('сторож удаления (R2-L1, R3-M3, R4-C1)', () => {
  it('удаляет: запись была до отправки, отчёта в очереди не было, строка played:false без queued_played', () => {
    writeWatched(R, D, A, 0.8, {})
    const sent = { watchedSeq: readWatchedSeq(), pendingClipPlayed: new Set<string>() }
    expect(pruneWatched(state([row(A)]), sent)).toEqual([A])
    expect(readWatched()!.items[A]).toBeUndefined()
  })
  it('R4-C1: запись создана после отправки — не удаляется', () => {
    const sent = { watchedSeq: readWatchedSeq(), pendingClipPlayed: new Set<string>() }
    writeWatched(R, D, A, 0.8, {})
    expect(pruneWatched(state([row(A)]), sent)).toEqual([])
  })
  it('R4-C1: запись переписана новым отчётом, пока запрос в полёте — не удаляется', () => {
    writeWatched(R, D, A, 0.8, {})
    const sent = { watchedSeq: readWatchedSeq(), pendingClipPlayed: new Set<string>() }
    writeWatched(R, D, A, 0.4, {})
    expect(pruneWatched(state([row(A)]), sent)).toEqual([])
  })
  it('R3-M3: clip_played ролика был в очереди на момент отправки — не удаляется', () => {
    writeWatched(R, D, A, 0.8, {})
    const sent = { watchedSeq: readWatchedSeq(), pendingClipPlayed: new Set<string>([A]) }
    expect(pruneWatched(state([row(A)]), sent)).toEqual([])
  })
  it('played или queued_played — не удаляется', () => {
    writeWatched(R, D, A, 0.8, {}); writeWatched(R, D, B, 0.8, {})
    const sent = { watchedSeq: readWatchedSeq(), pendingClipPlayed: new Set<string>() }
    expect(pruneWatched(state([row(A, true), row(B, false, true)]), sent)).toEqual([])
  })
  it('ролика нет в плане (kept_local) и строки kept — не удаляются', () => {
    writeWatched(R, D, A, 0.8, {}); writeWatched(R, D, B, 0.8, {})
    const sent = { watchedSeq: readWatchedSeq(), pendingClipPlayed: new Set<string>() }
    const kept: DayClip = { puzzle_id: B, kind: 'youtube', delivered: true, played: true, kept: true }
    expect(pruneWatched(state([kept]), sent)).toEqual([])
    expect(Object.keys(readWatched()!.items).sort()).toEqual([A, B])
  })
  it('ответ другой эпохи или даты плана объект не трогает', () => {
    writeWatched(R, D, A, 0.8, {})
    const sent = { watchedSeq: readWatchedSeq(), pendingClipPlayed: new Set<string>() }
    expect(pruneWatched(state([row(A)], { route_id: '22222222-2222-4222-8222-222222222222' }), sent)).toEqual([])
    expect(pruneWatched({ ...state([row(A)]), day: { date: '2026-11-19', clips: [row(A)] } }, sent)).toEqual([])
  })
})
