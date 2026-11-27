// WorkspacePanel.wheel.test.tsx
// Seam test: proves the native non-passive wheel listener routes Ctrl+wheel
// to `ws.setView` (zoom), matching the desktop's own dispatch — the plan
// review confirmed `handleWheel` (WorkspacePanelThemed.tsx:914) always calls
// `onSetView`, never `onZoom`, for both the ctrl (zoom) and plain (pan)
// branches (WorkspacePanel.tsx wires `onZoom` separately for the — now
// hidden — Zoom +/- buttons only). Asserting `setView` (not `onZoom`) is the
// load-bearing part of this test: asserting the wrong callback would pass
// even if the wheel handler regressed to a no-op on the actually-used prop.
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { WorkspacePanel } from '../WorkspacePanel'
import { makeFakeAdapter } from '../../../adapter/__tests__/fake'

describe('WorkspacePanel — non-passive wheel (seam)', () => {
  it('ctrl+wheel zooms via ws.setView, not onZoom', () => {
    const setView = vi.fn()
    const ws = {
      rangeStart: 0, rangeEnd: 0, looping: false, pauseAtEnd: 0, viewStart: 0, viewEnd: 60,
      setABLoop() {}, toggleABLoop() {}, onUserSeek() {}, setPauseAtEnd() {}, stopLoop() {},
      setView, zoom: vi.fn(), fitToRange() {}, setRange() {}, _boundaryTickForTest() {}, countdownValue: null,
    } as any
    const adapter = makeFakeAdapter({ duration: 100, t: 0 })

    const { container } = render(
      <WorkspacePanel ws={ws} cues={[]} adapter={adapter} activeIndex={-1} waveform={null}
        variant="refined" currentTime={0} playing={false} muted={false} />
    )
    const host = container.querySelector('[data-workspace-bar]') as HTMLElement
    expect(host).toBeTruthy()

    host.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, ctrlKey: true, clientX: 100, bubbles: true, cancelable: true }))

    expect(setView).toHaveBeenCalled()
    expect(ws.zoom).not.toHaveBeenCalled()
  })

  it('plain wheel pans via ws.setView too (no ctrl → pan branch, same onSetView call site)', () => {
    const setView = vi.fn()
    const ws = {
      rangeStart: 0, rangeEnd: 0, looping: false, pauseAtEnd: 0, viewStart: 0, viewEnd: 60,
      setABLoop() {}, toggleABLoop() {}, onUserSeek() {}, setPauseAtEnd() {}, stopLoop() {},
      setView, zoom: vi.fn(), fitToRange() {}, setRange() {}, _boundaryTickForTest() {}, countdownValue: null,
    } as any
    const adapter = makeFakeAdapter({ duration: 100, t: 0 })

    const { container } = render(
      <WorkspacePanel ws={ws} cues={[]} adapter={adapter} activeIndex={-1} waveform={null}
        variant="refined" currentTime={0} playing={false} muted={false} />
    )
    const host = container.querySelector('[data-workspace-bar]') as HTMLElement

    host.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, ctrlKey: false, clientX: 100, bubbles: true, cancelable: true }))

    expect(setView).toHaveBeenCalled()
    expect(ws.zoom).not.toHaveBeenCalled()
  })
})
