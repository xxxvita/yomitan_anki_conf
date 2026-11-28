// WorkspacePanel.shadowattempts.test.tsx — T5 review test-gap #2: proves the
// `shadowAttempts` forward from WorkspacePanel → WorkspacePanelThemed is real
// wiring, not just a typed-but-dead prop. Prior coverage only asserted the
// prop passes tsc (structural typing) — no test rendered the panel with an
// actual attempts entry and checked what it does in the DOM.
//
// What the panel REALLY does with shadowAttempts (WorkspacePanelThemed.tsx:318,
// "НЕ трогать" file — read, not edited): `hasUserResponses` is computed from
// shadowAttempts entries (`Object.values(shadowAttempts).some(e => e.attempts
// .length > 0)`) and OR'd with `hasRecordings` into `youTrackVisible`, which
// gates the "YOU" TrackLabel (testid `you-track-toggle`, WorkspacePanelThemed.tsx
// ~2238-2250). So with `recordings=[]` (no waveform content) but a populated
// `shadowAttempts`, the YOU label must still appear — that appearance is
// observable ONLY if WorkspacePanel actually forwards the prop through.
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { WorkspacePanel } from '../WorkspacePanel'
import { makeFakeAdapter } from '../../../adapter/__tests__/fake'
import type { PanelAttempts } from '../shadow-attempts'

function makeWs() {
  return {
    rangeStart: 0, rangeEnd: 0, looping: false, pauseAtEnd: 0, viewStart: 0, viewEnd: 60,
    setABLoop() {}, toggleABLoop() {}, onUserSeek() {}, setPauseAtEnd() {}, stopLoop() {},
    setView() {}, zoom() {}, fitToRange() {}, setRange() {}, _boundaryTickForTest() {}, countdownValue: null,
  } as any
}

describe('WorkspacePanel — shadowAttempts forwarding (T5 review test-gap #2)', () => {
  it('a populated shadowAttempts entry (no recordings) makes the YOU track label appear', () => {
    const adapter = makeFakeAdapter({ duration: 100, t: 0 })
    const shadowAttempts: PanelAttempts = { '0': { attempts: [{ match_pct: 80, audio_start_sec: 0, audio_end_sec: 2 }] } }

    const { queryByTestId } = render(
      <WorkspacePanel
        ws={makeWs()} cues={[]} adapter={adapter} activeIndex={-1} waveform={null}
        variant="refined" currentTime={0} playing={false} muted={false}
        shadowAttempts={shadowAttempts}
        recordings={[]}
      />
    )

    // hasUserResponses only flips true if `shadowAttempts` actually reaches
    // WorkspacePanelThemed — `recordings=[]` deliberately rules out the other
    // (hasRecordings) path to youTrackVisible, so this is a clean assertion of
    // the shadowAttempts wire specifically.
    expect(queryByTestId('you-track-toggle')).toBeTruthy()
  })

  it('an empty shadowAttempts object and no recordings — YOU track label absent (baseline)', () => {
    const adapter = makeFakeAdapter({ duration: 100, t: 0 })

    const { queryByTestId } = render(
      <WorkspacePanel
        ws={makeWs()} cues={[]} adapter={adapter} activeIndex={-1} waveform={null}
        variant="refined" currentTime={0} playing={false} muted={false}
        shadowAttempts={{}}
        recordings={[]}
      />
    )

    expect(queryByTestId('you-track-toggle')).toBeNull()
  })
})
