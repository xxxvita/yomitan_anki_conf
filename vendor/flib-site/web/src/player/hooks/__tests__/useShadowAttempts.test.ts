// useShadowAttempts.test.ts — T3 3b: попытки шадоуинга на videoId, персист localStorage
// (flib:shadow:<videoId>), канон useMuteRegions. persisted = snapshot at mount/videoId
// change; live = added this session; forPanel = merge (mergeShadowAttemptsForPanel).
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useShadowAttempts } from '../useShadowAttempts'
import type { ShadowAttemptStored } from '../../workspace/shadow-attempts'
import type { WordMark } from '../../workspace/word-matcher'

const KEY = (videoId: string) => `flib:shadow:${videoId}`

function mkAttempt(overrides: Partial<ShadowAttemptStored> = {}): ShadowAttemptStored {
  return {
    id: 'a1', cue_index: 0, text: 'hello', marks: [], match_pct: 75,
    audio_start_sec: 1, audio_end_sec: 2, created_at: '2026-07-05T00:00:00.000Z',
    ...overrides,
  }
}

beforeEach(() => { localStorage.clear() })

describe('useShadowAttempts', () => {
  it('add() puts the attempt into forPanel under its cue_index', () => {
    const { result } = renderHook(() => useShadowAttempts('vid1'))
    act(() => { result.current.add(mkAttempt({ cue_index: 4, match_pct: 60 })) })
    expect(result.current.forPanel['4'].attempts).toHaveLength(1)
    expect(result.current.forPanel['4'].attempts[0].match_pct).toBe(60)
    expect(result.current.live).toHaveLength(1)
  })

  it('reload (new renderHook, same videoId): persisted has it, live empty, forPanel shows it ONCE', () => {
    const first = renderHook(() => useShadowAttempts('vid1'))
    act(() => { first.result.current.add(mkAttempt({ cue_index: 1, match_pct: 55, id: 'x1' })) })
    first.unmount()

    const second = renderHook(() => useShadowAttempts('vid1'))
    expect(second.result.current.live).toHaveLength(0)
    expect(second.result.current.persistedByCue['1'].attempts).toHaveLength(1)
    expect(second.result.current.forPanel['1'].attempts).toHaveLength(1) // not doubled
  })

  it('remove() takes the attempt out of live and localStorage', () => {
    const { result } = renderHook(() => useShadowAttempts('vid1'))
    act(() => { result.current.add(mkAttempt({ id: 'rm1', cue_index: 0 })) })
    expect(result.current.live).toHaveLength(1)
    act(() => { result.current.remove('rm1') })
    expect(result.current.live).toHaveLength(0)
    const raw = JSON.parse(localStorage.getItem(KEY('vid1')) ?? '[]') as ShadowAttemptStored[]
    expect(raw.find(a => a.id === 'rm1')).toBeUndefined()
  })

  it('localStorage quota throw does not crash add() — state remains source of truth', () => {
    const original = localStorage.setItem.bind(localStorage)
    const spy = (key: string, value: string) => {
      if (key === KEY('vid1')) throw new DOMException('quota', 'QuotaExceededError')
      original(key, value)
    }
    localStorage.setItem = spy as typeof localStorage.setItem
    try {
      const { result } = renderHook(() => useShadowAttempts('vid1'))
      act(() => { result.current.add(mkAttempt({ cue_index: 2 })) })
      expect(result.current.live).toHaveLength(1)
      expect(result.current.forPanel['2'].attempts).toHaveLength(1)
    } finally {
      localStorage.setItem = original
    }
  })

  it('swapping videoId re-reads persisted scoped to the new id and resets live', () => {
    const a = renderHook(() => useShadowAttempts('vid1'))
    act(() => { a.result.current.add(mkAttempt({ cue_index: 0, id: 'p1' })) })

    const b = renderHook(({ videoId }: { videoId: string }) => useShadowAttempts(videoId), {
      initialProps: { videoId: 'vid1' },
    })
    expect(b.result.current.persistedByCue['0'].attempts).toHaveLength(1)
    act(() => { b.rerender({ videoId: 'vid2' }) })
    expect(b.result.current.persistedByCue).toEqual({})
    expect(b.result.current.live).toHaveLength(0)
  })

  it('fable-audit MED-2: WordMark[] persists verbatim into the localStorage wire — all 4 kinds + expected are never downgraded', () => {
    const marks: WordMark[] = [
      { w: 'hello', kind: 'ok' },
      { w: 'wurld', kind: 'wrong', expected: 'world' },
      { w: 'there', kind: 'missing' },
      { w: 'yeah', kind: 'extra' },
    ]
    const { result } = renderHook(() => useShadowAttempts('vid1'))
    act(() => { result.current.add(mkAttempt({ id: 'm1', cue_index: 0, marks })) })

    const raw = JSON.parse(localStorage.getItem(KEY('vid1')) ?? '[]') as ShadowAttemptStored[]
    const stored = raw.find(a => a.id === 'm1')
    expect(stored?.marks).toEqual(marks)
    expect(stored?.marks.map(m => m.kind)).toEqual(['ok', 'wrong', 'missing', 'extra'])
    expect(stored?.marks.find(m => m.kind === 'wrong')?.expected).toBe('world')
  })

  // ТЗ №5 п.2 — per-run сброс: clearAll() чистит live + persisted + localStorage.
  it('clearAll() wipes live, persisted (снимок прошлых ранов) AND the localStorage bucket', () => {
    // Засеять «вечную» историю прошлой сессии в localStorage ДО mount.
    localStorage.setItem(KEY('vid1'), JSON.stringify([
      mkAttempt({ id: 'old1', cue_index: 0 }), mkAttempt({ id: 'old2', cue_index: 0 }),
    ]))
    const { result } = renderHook(() => useShadowAttempts('vid1'))
    // persisted снимок увидел 2 прошлых попытки; добавим 1 живую в этой сессии.
    expect(result.current.persistedByCue['0'].attempts).toHaveLength(2)
    act(() => { result.current.add(mkAttempt({ id: 'live1', cue_index: 0 })) })
    expect(result.current.forPanel['0'].attempts).toHaveLength(3)

    act(() => { result.current.clearAll() })

    expect(result.current.live).toHaveLength(0)
    expect(result.current.persistedByCue).toEqual({})
    expect(result.current.forPanel).toEqual({})
    expect(localStorage.getItem(KEY('vid1'))).toBeNull() // бакет стёрт
  })

  it('clearAll() идемпотентен — повторный вызов на пустом бакете безопасен (StrictMode double-invoke)', () => {
    const { result } = renderHook(() => useShadowAttempts('vid1'))
    act(() => { result.current.clearAll() })
    act(() => { result.current.clearAll() })
    expect(result.current.forPanel).toEqual({})
    expect(localStorage.getItem(KEY('vid1'))).toBeNull()
  })

  it('malformed localStorage JSON is tolerated (returns empty, does not throw)', () => {
    localStorage.setItem(KEY('vid1'), '{not json')
    const { result } = renderHook(() => useShadowAttempts('vid1'))
    expect(result.current.persistedByCue).toEqual({})
    expect(result.current.forPanel).toEqual({})
  })
})
