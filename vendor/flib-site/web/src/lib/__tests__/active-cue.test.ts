// active-cue.test.ts
import { describe, it, expect } from 'vitest'
import { findActiveCueIndex } from '../active-cue'

describe('findActiveCueIndex', () => {
  it('overlap: latest-started cue wins', () => {
    const cues = [{ start: 0, end: 2 }, { start: 1.5, end: 3 }]
    expect(findActiveCueIndex(cues, 1.7)).toBe(1)
  })

  it('end is exclusive', () => {
    const cues = [{ start: 0, end: 2 }, { start: 1.5, end: 3 }]
    // t=2: cue0 [0,2) no longer active (2 < 2 is false); cue1 [1.5,3) still active
    expect(findActiveCueIndex(cues, 2)).toBe(1)
  })

  it('gap between cues returns -1', () => {
    const cues = [{ start: 0, end: 1 }, { start: 2, end: 3 }]
    expect(findActiveCueIndex(cues, 1.5)).toBe(-1)
  })
})
