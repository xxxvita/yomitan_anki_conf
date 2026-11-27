// WorkspacePanel.mute.test.tsx
// A5: Verify that the AUD track label reflects the muted prop reactively.
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { WorkspacePanel } from '../WorkspacePanel'
import { makeFakeAdapter } from '../../../adapter/__tests__/fake'

function makeWs() {
  return {
    rangeStart: 0, rangeEnd: 0, looping: false, pauseAtEnd: 0, viewStart: 0, viewEnd: 60,
    setABLoop() {}, toggleABLoop() {}, onUserSeek() {}, setPauseAtEnd() {}, stopLoop() {},
    setView() {}, zoom() {}, fitToRange() {}, setRange() {}, _boundaryTickForTest() {}, countdownValue: null,
  } as any
}

describe('WorkspacePanel — muted prop (A5)', () => {
  it('AUD label reflects the muted prop reactively', () => {
    const a = makeFakeAdapter({ duration: 100 })
    const base = { ws: makeWs(), cues: [], adapter: a, activeIndex: -1, waveform: null,
      variant: 'refined' as const, currentTime: 0, playing: false }
    const { getByTestId, rerender } = render(<WorkspacePanel {...base} muted={false} />)
    expect(getByTestId('aud-track-toggle').getAttribute('title')).toContain('включён')
    rerender(<WorkspacePanel {...base} muted={true} />)
    expect(getByTestId('aud-track-toggle').getAttribute('title')).toContain('выключен')
  })
})
