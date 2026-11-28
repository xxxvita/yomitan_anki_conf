import { describe, it, expect } from 'vitest'
import { formatTime } from '../vtt-format'
import { useUIStore } from '../ui-store'
import { toWorkspaceState, toPanelCues } from '../panel-map'

describe('lift shims', () => {
  it('formatTime renders mm:ss', () => {
    expect(formatTime(65)).toMatch(/1:05|01:05/)
  })
  it('useUIStore.getState cycles waveform modes', () => {
    const first = useUIStore.getState().waveformMode
    useUIStore.getState().cycleWaveformMode()
    expect(useUIStore.getState().waveformMode).not.toBe(first)
  })
})

describe('panel-map', () => {
  it('maps WorkspaceApi fields to WorkspaceState (active always true)', () => {
    const ws = { rangeStart: 1, rangeEnd: 4, looping: true, pauseAtEnd: 0.5, viewStart: 0, viewEnd: 60 } as any
    expect(toWorkspaceState(ws)).toEqual({
      active: true, rangeStart: 1, rangeEnd: 4, looping: true, pauseAtEnd: 0.5, viewStart: 0, viewEnd: 60,
    })
  })
  it('remaps web cue {start,end} to panel cue {startTime,endTime}', () => {
    expect(toPanelCues([{ start: 1, end: 2, text: 'hi' }])).toEqual([{ startTime: 1, endTime: 2, text: 'hi' }])
  })
})
