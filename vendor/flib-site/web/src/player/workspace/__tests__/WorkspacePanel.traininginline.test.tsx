// WorkspacePanel.traininginline.test.tsx — ТЗ №3 п.4: the trainingInlinePanel
// slot renders in the bar (between transport and pills) when supplied, and is
// absent otherwise. The player passes it ONLY while shadowing is active, so a
// dormant (non-shadowing) user's bar has no settings row (this test proves the
// slot plumbing WorkspacePanel → WorkspacePanelThemed, the active-gating itself
// is a PlayerPage concern exercised in the integration suite).
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

const base = () => ({
  ws: makeWs(), cues: [], adapter: makeFakeAdapter({ duration: 100 }), activeIndex: -1,
  waveform: null, variant: 'refined' as const, currentTime: 0, playing: false, muted: false,
  shadowActive: true,
})

describe('ТЗ №3 п.4 — trainingInlinePanel bar slot', () => {
  it('renders the slot content when supplied', () => {
    const { getByTestId } = render(
      <WorkspacePanel {...base()} trainingInlinePanel={<div data-testid="my-settings">SETTINGS</div>} />,
    )
    const slot = getByTestId('training-inline-panel')
    expect(slot).toBeTruthy()
    expect(slot.querySelector('[data-testid="my-settings"]')).toBeTruthy()
  })

  it('omits the slot entirely when not supplied (dormant bar unchanged)', () => {
    const { queryByTestId } = render(<WorkspacePanel {...base()} />)
    expect(queryByTestId('training-inline-panel')).toBeNull()
  })
})
