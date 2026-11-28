// shadow-attempts.test.ts — T3 3a: чистый порт shadowAttemptsForPanel (index.tsx:2528-2546).
// Десктоп мержит всё shadow.attempts в бакет String(activeCueIndex); веб-порт мержит
// каждую live-попытку в её СОБСТВЕННЫЙ cue_index (супермножество-корректное обобщение).
import { describe, expect, it } from 'vitest'
import { mergeShadowAttemptsForPanel, type ShadowAttemptStored } from '../shadow-attempts'

function mkAttempt(overrides: Partial<ShadowAttemptStored> = {}): ShadowAttemptStored {
  return {
    id: 'a1',
    cue_index: 0,
    text: 'hello world',
    marks: [],
    match_pct: 100,
    audio_start_sec: 1,
    audio_end_sec: 2,
    created_at: '2026-07-05T00:00:00.000Z',
    ...overrides,
  }
}

describe('mergeShadowAttemptsForPanel', () => {
  it('empty live returns persisted unchanged', () => {
    const persisted = { '0': { attempts: [{ match_pct: 50 }] } }
    expect(mergeShadowAttemptsForPanel(persisted, [])).toBe(persisted)
  })

  it('empty live + undefined persisted returns {}', () => {
    expect(mergeShadowAttemptsForPanel(undefined, [])).toEqual({})
  })

  it('one live attempt lands in a new bucket (ТЗ №3 п.3: carries text)', () => {
    const result = mergeShadowAttemptsForPanel({}, [mkAttempt({ cue_index: 3, match_pct: 80 })])
    expect(result).toEqual({ '3': { attempts: [{ match_pct: 80, audio_start_sec: 1, audio_end_sec: 2, text: 'hello world' }] } })
  })

  it('one live attempt appends into an existing bucket (does not overwrite)', () => {
    const persisted = { '2': { attempts: [{ match_pct: 40, audio_start_sec: 0, audio_end_sec: 1 }] } }
    const result = mergeShadowAttemptsForPanel(persisted, [mkAttempt({ cue_index: 2, match_pct: 90, text: 'said it' })])
    expect(result['2'].attempts).toHaveLength(2)
    expect(result['2'].attempts[0]).toEqual({ match_pct: 40, audio_start_sec: 0, audio_end_sec: 1 })
    expect(result['2'].attempts[1]).toEqual({ match_pct: 90, audio_start_sec: 1, audio_end_sec: 2, text: 'said it' })
  })

  it('cue_index=-1 is skipped (no active cue at record time)', () => {
    const result = mergeShadowAttemptsForPanel({}, [mkAttempt({ cue_index: -1 })])
    expect(result).toEqual({})
  })

  it('multiple live attempts land in different buckets', () => {
    const result = mergeShadowAttemptsForPanel({}, [
      mkAttempt({ id: 'a1', cue_index: 0, match_pct: 10 }),
      mkAttempt({ id: 'a2', cue_index: 1, match_pct: 20 }),
    ])
    expect(Object.keys(result).sort()).toEqual(['0', '1'])
    expect(result['0'].attempts[0].match_pct).toBe(10)
    expect(result['1'].attempts[0].match_pct).toBe(20)
  })

  it('does not mutate the persisted input object', () => {
    const persisted = { '0': { attempts: [{ match_pct: 1 }] } }
    const before = JSON.stringify(persisted)
    mergeShadowAttemptsForPanel(persisted, [mkAttempt({ cue_index: 0 })])
    expect(JSON.stringify(persisted)).toBe(before)
  })
})
