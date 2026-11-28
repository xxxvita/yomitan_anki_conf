// WorkspacePanel.cueclick.test.tsx
// T3 seam: Ctrl+click on an inner cue re-targets the A-B range onto that cue,
// even when the click lands INSIDE the currently active [A,B] range (where a
// plain click would only seek, per the existing `inside` branch in
// WorkspacePanel's onCueClick wrapper). WEB-SEAM: web adds a 4th `ctrlKey`
// param to the onCueClick chain (types.ts / WorkspacePanelThemed.tsx) not
// present in the desktop cue-click contract, wired to this owner request.
//
// jsdom-fragility note (matches WorkspacePanel.rubber.test.tsx): xToTime()
// reads barRef.current.getBoundingClientRect(), which is 0-width by default
// in jsdom — stub a real, non-zero rect so clicks land at predictable times.
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { WorkspacePanel } from '../WorkspacePanel'
import { makeFakeAdapter } from '../../../adapter/__tests__/fake'

describe('WorkspacePanel — Ctrl+click re-targets A-B onto the clicked cue (seam)', () => {
  it('Ctrl+click inside the active [A,B] range calls setRange(cue) + seek(cue.start), not just seek', () => {
    const rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 600, height: 60, right: 600, bottom: 60, x: 0, y: 0,
      toJSON() { return {} },
    } as DOMRect)

    const setRange = vi.fn()
    // Range spans the cue [15,20] — [10,30] — so a plain (non-ctrl) click at
    // clickTime=17 would land in the `inside` branch (seek only, no setRange).
    const ws = {
      rangeStart: 10, rangeEnd: 30, looping: false, pauseAtEnd: 0, viewStart: 0, viewEnd: 60,
      setABLoop() {}, toggleABLoop() {}, onUserSeek() {}, setPauseAtEnd() {}, stopLoop() {},
      setView: vi.fn(), zoom: vi.fn(), fitToRange: vi.fn(), setRange, _boundaryTickForTest() {}, countdownValue: null,
    } as any
    const adapter = makeFakeAdapter({ duration: 100, t: 0 })
    const cues = [{ start: 15, end: 20, text_en: 'hi', text_ru: 'привет' }]

    try {
      const { container } = render(
        <WorkspacePanel ws={ws} cues={cues} adapter={adapter} activeIndex={-1} waveform={null}
          variant="refined" currentTime={0} playing={false} muted={false} />
      )
      const cueEl = container.querySelector('[data-cue]') as HTMLElement
      expect(cueEl).toBeTruthy()

      const seekCountBefore = adapter._seekCount

      // clientX=170 → xToTime(170) = 17s (rect width=600, view [0,60]) — inside both
      // the cue [15,20] and the active range [10,30].
      fireEvent.click(cueEl, { clientX: 170, clientY: 10, bubbles: true, ctrlKey: true })

      expect(setRange).toHaveBeenCalledTimes(1)
      expect(setRange).toHaveBeenCalledWith(15, 20)
      expect(adapter._seekCount).toBe(seekCountBefore + 1)
    } finally {
      rectSpy.mockRestore()
    }
  })

  it('guard: without Ctrl, an inside-click only seeks and does NOT call setRange', () => {
    const rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 600, height: 60, right: 600, bottom: 60, x: 0, y: 0,
      toJSON() { return {} },
    } as DOMRect)

    const setRange = vi.fn()
    const ws = {
      rangeStart: 10, rangeEnd: 30, looping: false, pauseAtEnd: 0, viewStart: 0, viewEnd: 60,
      setABLoop() {}, toggleABLoop() {}, onUserSeek() {}, setPauseAtEnd() {}, stopLoop() {},
      setView: vi.fn(), zoom: vi.fn(), fitToRange: vi.fn(), setRange, _boundaryTickForTest() {}, countdownValue: null,
    } as any
    const adapter = makeFakeAdapter({ duration: 100, t: 0 })
    const cues = [{ start: 15, end: 20, text_en: 'hi', text_ru: 'привет' }]

    try {
      const { container } = render(
        <WorkspacePanel ws={ws} cues={cues} adapter={adapter} activeIndex={-1} waveform={null}
          variant="refined" currentTime={0} playing={false} muted={false} />
      )
      const cueEl = container.querySelector('[data-cue]') as HTMLElement
      const seekCountBefore = adapter._seekCount

      fireEvent.click(cueEl, { clientX: 170, clientY: 10, bubbles: true })

      expect(setRange).not.toHaveBeenCalled()
      expect(adapter._seekCount).toBe(seekCountBefore + 1)
    } finally {
      rectSpy.mockRestore()
    }
  })
})
