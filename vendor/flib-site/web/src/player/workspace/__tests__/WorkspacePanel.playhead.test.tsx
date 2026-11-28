// WorkspacePanel.playhead.test.tsx
// Seam test: proves the rAF playhead writer overrides `--php` from
// adapter.currentTime() (getTime), NOT from the (deliberately stale)
// `currentTime` prop. Plan-review S-CRIT2/O-M2: the prop and adapter time
// MUST differ, and `playing` MUST be true — otherwise the layoutEffect seed
// alone would produce the same value (prop) and the test would pass even if
// the rAF wiring were deleted (false-green), or the rAF would never start
// (playing=false → early-return at WorkspacePanelThemed.tsx:650) and the
// seeded 0% would survive by coincidence.
import { describe, it, expect } from 'vitest'
import { render, act } from '@testing-library/react'
import { WorkspacePanel } from '../WorkspacePanel'
import { makeFakeAdapter } from '../../../adapter/__tests__/fake'

describe('WorkspacePanel — playhead rAF writer (seam)', () => {
  it('rAF overwrites --php from adapter.currentTime (not the stale prop) while playing', async () => {
    const adapter = makeFakeAdapter({ duration: 100, t: 30 }) // adapter time = 30
    const ws = {
      rangeStart: 0, rangeEnd: 0, looping: false, pauseAtEnd: 0, viewStart: 0, viewEnd: 60,
      setABLoop() {}, toggleABLoop() {}, onUserSeek() {}, setPauseAtEnd() {}, stopLoop() {},
      setView() {}, zoom() {}, fitToRange() {}, setRange() {}, _boundaryTickForTest() {}, countdownValue: null,
    } as any

    const { container } = render(
      // prop currentTime=0 (stale), playing=true → the layoutEffect seed writes
      // 0%, but the rAF loop must immediately overwrite it from adapter time.
      <WorkspacePanel ws={ws} cues={[]} adapter={adapter} activeIndex={-1} waveform={null}
        variant="refined" currentTime={0} playing={true} muted={false} />
    )

    await act(async () => {
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(null))))
    })

    const host = container.querySelector('[data-workspace-bar]') as HTMLElement
    expect(host).toBeTruthy()
    // 30s adapter time / 60s view = 50% — NOT 0% (which is what the stale
    // `currentTime` prop alone would have seeded).
    expect(host.style.getPropertyValue('--php')).toBe('50%')
  })
})
