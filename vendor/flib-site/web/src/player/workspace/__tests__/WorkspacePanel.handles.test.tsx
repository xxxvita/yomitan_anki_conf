// WorkspacePanel.handles.test.tsx
// W1b seam test: A/B handles must be culled from the DOM when the range
// bound they mark falls outside the current view — not just visually
// pinned to the bar edge. Before the fix, startPct/endPct were pre-clamped
// to [-5,105] BEFORE the cull-gate check (`> -10 && < 110`), so the gate
// was always true and an out-of-view handle rendered stuck at -5%/105%
// (visibly sticking out past the bar). The fix compares the RAW (unclamped)
// pct against [0,100] so an out-of-view bound is genuinely absent from the DOM.
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { WorkspacePanel } from '../WorkspacePanel'
import { makeFakeAdapter } from '../../../adapter/__tests__/fake'

function makeWs(overrides: Partial<{ rangeStart: number; rangeEnd: number; viewStart: number; viewEnd: number }>) {
  return {
    rangeStart: 0, rangeEnd: 0, looping: false, pauseAtEnd: 0, viewStart: 0, viewEnd: 60,
    setABLoop() {}, toggleABLoop() {}, onUserSeek() {}, setPauseAtEnd() {}, stopLoop() {},
    setView() {}, zoom() {}, fitToRange() {}, setRange() {}, _boundaryTickForTest() {}, countdownValue: null,
    ...overrides,
  } as any
}

describe('WorkspacePanel — A/B handle cull outside view (W1b)', () => {
  it('omits both handles from the DOM when the range is entirely outside the current view', () => {
    const adapter = makeFakeAdapter({ duration: 200, t: 0 })
    const ws = makeWs({ rangeStart: 150, rangeEnd: 160, viewStart: 0, viewEnd: 60 })
    const { container } = render(
      <WorkspacePanel ws={ws} cues={[]} adapter={adapter} activeIndex={-1} waveform={null}
        variant="refined" currentTime={0} playing={false} muted={false} />
    )
    expect(container.querySelector('[data-handle="left"]')).toBeNull()
    expect(container.querySelector('[data-handle="right"]')).toBeNull()
  })

  it('renders both handles when the range is inside the current view', () => {
    const adapter = makeFakeAdapter({ duration: 200, t: 0 })
    const ws = makeWs({ rangeStart: 150, rangeEnd: 160, viewStart: 140, viewEnd: 170 })
    const { container } = render(
      <WorkspacePanel ws={ws} cues={[]} adapter={adapter} activeIndex={-1} waveform={null}
        variant="refined" currentTime={0} playing={false} muted={false} />
    )
    expect(container.querySelector('[data-handle="left"]')).not.toBeNull()
    expect(container.querySelector('[data-handle="right"]')).not.toBeNull()
  })
})
