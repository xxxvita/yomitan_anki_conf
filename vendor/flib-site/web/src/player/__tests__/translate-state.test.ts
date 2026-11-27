// translate-state.test.ts — единая модель доступности перевода (Fable H2).
import { describe, it, expect } from 'vitest'
import {
  initialTranslateState, translateReducer, isTranslateDisabled, type TranslateState,
} from '../translate-state'

const S0 = initialTranslateState

describe('translateReducer', () => {
  it('request sets inFlight', () => {
    expect(translateReducer(S0, { type: 'request' }).inFlight).toBe(true)
  })
  it('EVERY terminal event clears inFlight (Fable HIGH-1)', () => {
    const inFlight: TranslateState = { ...S0, inFlight: true }
    for (const ev of [
      { type: 'ok' }, { type: 'empty' }, { type: 'error' },
      { type: 'busy', retryAfterSec: 10, nowMs: 1000 },
      { type: 'not_in_corpus', videoId: 'v1' },
      { type: 'forbidden' },
    ] as const) {
      expect(translateReducer(inFlight, ev).inFlight).toBe(false)
    }
  })
  it('busy sets disabledUntilMs = now + sec*1000', () => {
    const s = translateReducer(S0, { type: 'busy', retryAfterSec: 30, nowMs: 1_000 })
    expect(s.disabledUntilMs).toBe(31_000)
  })
  it('busy uses max — never shortens a longer active disable', () => {
    const s1 = translateReducer(S0, { type: 'busy', retryAfterSec: 60, nowMs: 1_000 }) // until 61_000
    const s2 = translateReducer(s1, { type: 'busy', retryAfterSec: 5, nowMs: 2_000 })  // would be 7_000
    expect(s2.disabledUntilMs).toBe(61_000)
  })
  it('not_in_corpus adds videoId to a COPIED set (purity, Fable LOW-g)', () => {
    const s = translateReducer(S0, { type: 'not_in_corpus', videoId: 'vX' })
    expect(s.notInCorpus.has('vX')).toBe(true)
    expect(S0.notInCorpus.has('vX')).toBe(false) // original untouched
    expect(s.notInCorpus).not.toBe(S0.notInCorpus)
  })
  it('forbidden latches', () => {
    expect(translateReducer(S0, { type: 'forbidden' }).forbidden).toBe(true)
  })
})

describe('isTranslateDisabled', () => {
  it('inFlight disables', () => {
    expect(isTranslateDisabled({ ...S0, inFlight: true }, 'v', 0)).toBe(true)
  })
  it('disabled until disabledUntilMs, re-enables after (site-wide, videoId-agnostic)', () => {
    const s: TranslateState = { ...S0, disabledUntilMs: 5_000 }
    expect(isTranslateDisabled(s, 'vA', 4_999)).toBe(true)
    expect(isTranslateDisabled(s, 'vB', 4_999)).toBe(true)  // SAME disable for a different video (per-key site-wide)
    expect(isTranslateDisabled(s, 'vA', 5_000)).toBe(false) // re-enabled at the boundary
  })
  it('not_in_corpus is PER-VIDEO', () => {
    const s: TranslateState = { ...S0, notInCorpus: new Set(['vA']) }
    expect(isTranslateDisabled(s, 'vA', 0)).toBe(true)
    expect(isTranslateDisabled(s, 'vB', 0)).toBe(false) // other video unaffected
  })
  it('forbidden disables regardless of video/time', () => {
    expect(isTranslateDisabled({ ...S0, forbidden: true }, 'anything', 999999)).toBe(true)
  })
})
