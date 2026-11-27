// player-route.test.tsx — плеер в маршруте (план B9): стражи по выжившим
// мутантам — дедуп «Нравится» на обоих рубежах (хук и VideoVoteBar), галка
// «Заменить ролик» у rc-ролика, просмотренного до замены (kept), — нет.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, screen, renderHook, act } from '@testing-library/react'
import { usePlayerRouteVote } from '../player-route'
import { VideoVoteBar, type RouteVote } from '../../components/VideoVoteBar'
import { saveRating } from '../../../site/cabinet/route/route-ratings'
import type { RouteModeView } from '../route-mode'
import type { RouteState } from '../../../site/cabinet/route/route-api'

const ROUTE = '11111111-1111-4111-8111-111111111111'
const P = 'youtube::aaaaaaaaaaa'
const state = (over: Partial<RouteState> = {}): RouteState => ({
  started: true, route_id: ROUTE, revision: 1, snapshot_date: '2026-11-18', started_at: null, goal_label: '',
  params: { daily_listening_budget_min: 20, daily_new_words: 15 },
  day: { date: '2026-11-18', clips: [{ puzzle_id: P, kind: 'youtube', video_id: 'aaaaaaaaaaa', delivered: true, played: true, queued_played: false, new_words: 0, words: [] }] },
  next_clip: null, current_puzzle_id: P, replace_available: true, stop_reason: null, active_exchange: null, ...over,
})

beforeEach(() => { localStorage.clear(); vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 }))) })

describe('usePlayerRouteVote', () => {
  it('«Нравится» уже выбрана — clip_rated не ставится; не выбрана — ставится', () => {
    const st = state()
    const mode: RouteModeView = { kind: 'confirmed', puzzleId: P, state: st, row: st.day!.clips[0] as never }
    const events = { rate: vi.fn(() => true), dropReport: vi.fn() }
    saveRating(ROUTE, P, 'like')
    const { result } = renderHook(() => usePlayerRouteVote(mode, events, () => {}))
    act(() => { result.current!.onLike() })
    expect(events.rate).not.toHaveBeenCalled()
    localStorage.clear()
    act(() => { result.current!.onLike() })
    expect(events.rate).toHaveBeenCalledWith('like')
  })

  it('«Не нравится» без галки — оценка записана в flib:route-ratings (подсветка переживёт перезагрузку)', () => {
    const st = state()
    const mode: RouteModeView = { kind: 'confirmed', puzzleId: P, state: st, row: st.day!.clips[0] as never }
    const events = { rate: vi.fn(() => true), dropReport: vi.fn() }
    const { result } = renderHook(() => usePlayerRouteVote(mode, events, () => {}))
    act(() => { result.current!.onDislike('content', false) })
    expect(events.rate).toHaveBeenCalledWith('dislike', 'content')
    expect(JSON.parse(localStorage.getItem('flib:route-ratings')!).items[P]).toBe('dislike')
    expect(events.dropReport).not.toHaveBeenCalled()
  })

  it('rc-ролик, просмотренный до замены (kept): галки «Заменить ролик» нет; выданный в плане — есть', () => {
    const keptRow = { puzzle_id: P, kind: 'youtube', video_id: 'aaaaaaaaaaa', delivered: true as const, played: true as const, kept: true as const }
    const st = state({ day: { date: '2026-11-18', clips: [keptRow] } })
    const events = { rate: vi.fn(() => true), dropReport: vi.fn() }
    const kept = renderHook(() => usePlayerRouteVote({ kind: 'rc', puzzleId: P, state: st, row: keptRow }, events, () => {}))
    expect(kept.result.current!.canReplace).toBe(false)
    const st2 = state()
    const plan = renderHook(() => usePlayerRouteVote({ kind: 'rc', puzzleId: P, state: st2, row: st2.day!.clips[0] as never }, events, () => {}))
    expect(plan.result.current!.canReplace).toBe(true)
  })
})

describe('VideoVoteBar в маршруте', () => {
  const vote = (over: Partial<RouteVote> = {}): RouteVote => ({ rating: null, canReplace: true, busy: false, onLike: vi.fn(), onDislike: vi.fn(), ...over })
  it('выбранная «Нравится» — onLike не зовётся; невыбранная — зовётся', () => {
    const v = vote({ rating: 'like' })
    const { unmount } = render(<VideoVoteBar videoId="aaaaaaaaaaa" route={v} />)
    fireEvent.click(screen.getByRole('button', { name: 'Понравилось' }))
    expect(v.onLike).not.toHaveBeenCalled()
    unmount()
    const v2 = vote()
    render(<VideoVoteBar videoId="aaaaaaaaaaa" route={v2} />)
    fireEvent.click(screen.getByRole('button', { name: 'Понравилось' }))
    expect(v2.onLike).toHaveBeenCalledTimes(1)
  })
  it('выбранная «Не нравится» не открывает строку причин', () => {
    render(<VideoVoteBar videoId="aaaaaaaaaaa" route={vote({ rating: 'dislike' })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Не понравилось' }))
    expect(screen.queryByRole('group', { name: 'Что не так с роликом?' })).toBeNull()
  })
})
