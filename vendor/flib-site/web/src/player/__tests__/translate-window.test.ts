// translate-window.test.ts — чистая логика выбора окна/цели перевода.
import { describe, it, expect } from 'vitest'
import {
  selectionIndices, windowForIndices, menuTargetIndices, isPluralLabel,
  matchTranslatedCues, TRANSLATE_WINDOW_MAX_MS,
} from '../translate-window'

const cues = [
  { start: 1, end: 3 },   // 0
  { start: 3, end: 5 },   // 1
  { start: 5, end: 8 },   // 2
  { start: 8, end: 10 },  // 3
]

describe('selectionIndices — looping-gated (Fable HIGH-1)', () => {
  it('looping + non-degenerate range → cues intersecting the range', () => {
    expect(selectionIndices(cues, { looping: true, rangeStart: 3, rangeEnd: 8 }, 0)).toEqual([1, 2])
  })
  it('NOT looping → falls back to active cue, IGNORING a stale range', () => {
    // stale range would cover [1..2], but looping=false → use activeIndex only
    expect(selectionIndices(cues, { looping: false, rangeStart: 1, rangeEnd: 8 }, 3)).toEqual([3])
  })
  it('not looping + activeIndex -1 → empty (button disabled)', () => {
    expect(selectionIndices(cues, { looping: false, rangeStart: 0, rangeEnd: 0 }, -1)).toEqual([])
  })
  it('looping but degenerate range (end<=start) → active cue fallback', () => {
    expect(selectionIndices(cues, { looping: true, rangeStart: 5, rangeEnd: 5 }, 2)).toEqual([2])
  })
})

describe('windowForIndices — ms window + 2min cap (Fable HIGH-2)', () => {
  it('single cue → its ms window', () => {
    expect(windowForIndices(cues, [0])).toEqual({ fromMs: 1000, toMs: 3000, includedIdx: [0], truncatedCount: 0 })
  })
  it('several cues → min-start..max-end, all included', () => {
    expect(windowForIndices(cues, [1, 2])).toEqual({ fromMs: 3000, toMs: 8000, includedIdx: [1, 2], truncatedCount: 0 })
  })
  it('empty idx → null', () => {
    expect(windowForIndices(cues, [])).toBeNull()
  })
  it('caps window to 2min and truncates tail cues OUTSIDE the cap (count >= 0)', () => {
    const long = [
      { start: 0, end: 10 },    // 0  in
      { start: 100, end: 110 }, // 1  in
      { start: 130, end: 140 }, // 2  OUT (start 130s = 130000ms > cap 120000)
    ]
    const w = windowForIndices(long, [0, 1, 2])!
    expect(w.fromMs).toBe(0)
    expect(w.toMs).toBe(TRANSLATE_WINDOW_MAX_MS) // 120000
    expect(w.includedIdx).toEqual([0, 1]) // cue 2 falls outside the capped window
    expect(w.truncatedCount).toBe(1)
  })
  it('truncatedCount is never negative (only counts SELECTED idx, not neighbours)', () => {
    // select non-adjacent 0 and 2; cue 1 lies inside [minStart,maxEnd] but is NOT selected
    const w = windowForIndices(cues, [0, 2])!
    expect(w.includedIdx).toEqual([0, 2]) // cue 1 not counted (not selected)
    expect(w.truncatedCount).toBe(0)
  })
  it('degenerate sub-ms cue rounding to zero-length → null', () => {
    expect(windowForIndices([{ start: 1.0001, end: 1.0002 }], [0])).toBeNull()
  })
  it('single cue longer than 2min → capped, truncatedCount 0 (tail untranslated, doc LOW-c)', () => {
    const w = windowForIndices([{ start: 0, end: 200 }], [0])!
    expect(w.toMs).toBe(TRANSLATE_WINDOW_MAX_MS)
    expect(w.includedIdx).toEqual([0])
    expect(w.truncatedCount).toBe(0)
  })
})

describe('menuTargetIndices', () => {
  it('multiple selected AND k in selection → the whole selection (plural)', () => {
    expect(menuTargetIndices([1, 2, 3], 2)).toEqual([1, 2, 3])
  })
  it('k NOT in selection → just k (singular)', () => {
    expect(menuTargetIndices([1, 2, 3], 5)).toEqual([5])
  })
  it('single or empty selection → just k', () => {
    expect(menuTargetIndices([2], 2)).toEqual([2])
    expect(menuTargetIndices([], 4)).toEqual([4])
  })
  it('k<0 (no active cue on the plate) → empty', () => {
    expect(menuTargetIndices([1, 2], -1)).toEqual([])
  })
})

describe('isPluralLabel', () => {
  it('n>1 plural', () => {
    expect(isPluralLabel(2)).toBe(true)
    expect(isPluralLabel(1)).toBe(false)
    expect(isPluralLabel(0)).toBe(false)
  })
})

describe('matchTranslatedCues — overlap match (Fable grounding-M2)', () => {
  const display = [
    { start: 1, end: 3 },
    { start: 3, end: 5 },
    { start: 5, end: 8 },
  ]
  it('one-to-one by max overlap', () => {
    const resp = [
      { start: 1, end: 3, ru: 'один' },
      { start: 3, end: 5, ru: 'два' },
    ]
    expect(matchTranslatedCues(display, resp)).toEqual({ 0: 'один', 1: 'два' })
  })
  it('one response cue overlapping two display cues → each display picks best-overlap resp', () => {
    // resp spans 1..5 (sentence expand); display 0 (1-3) and 1 (3-5) both overlap it
    const resp = [{ start: 1, end: 5, ru: 'фраза целиком' }]
    expect(matchTranslatedCues(display, resp)).toEqual({ 0: 'фраза целиком', 1: 'фраза целиком' })
  })
  it('response cue beyond the window (sentence-expanded past end) still matches by overlap', () => {
    const resp = [{ start: 7, end: 12, ru: 'хвост' }] // overlaps display[2] (5-8) on 7..8
    expect(matchTranslatedCues(display, resp)).toEqual({ 2: 'хвост' })
  })
  it('no overlap → empty', () => {
    expect(matchTranslatedCues(display, [{ start: 20, end: 25, ru: 'далеко' }])).toEqual({})
  })
  it('empty ru is not written', () => {
    expect(matchTranslatedCues(display, [{ start: 1, end: 3, ru: '' }])).toEqual({})
  })
})
