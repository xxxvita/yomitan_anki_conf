// WorkspacePanel.rubber.test.tsx
// Seam test (T2a): a rubber-band commit must call ONLY ws.setRange — never
// adapter.seek or ws.fitToRange. WEB-SEAM: desktop
// (WorkspacePanelThemed.tsx:859-861) does onSetRange + onSeek(minStart) +
// onFitToRange on commit; web drops the seek+fit per owner decision #1
// («ничего лишнего») — a selection sets [A,B] only, never moves the camera
// or the playhead. Asserting the ABSENCE of seek/fit is the load-bearing
// part of this test: a regression re-adding them would otherwise pass a
// test that only checks setRange was called.
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { WorkspacePanel } from '../WorkspacePanel'
import { makeFakeAdapter } from '../../../adapter/__tests__/fake'

describe('WorkspacePanel — rubber-band commit (seam)', () => {
  it('commits ws.setRange only; does not seek or fitToRange', () => {
    // jsdom-fragility note: xToTime() reads
    // `barRef.current.getBoundingClientRect()` (WorkspacePanelThemed.tsx:598),
    // which is 0-width by default in jsdom, so the t1/t2 overlap check
    // against cues would never fire. Stub a real, non-zero rect.
    const rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 600, height: 60, right: 600, bottom: 60, x: 0, y: 0,
      toJSON() { return {} },
    } as DOMRect)

    const setRange = vi.fn()
    const fitToRange = vi.fn()
    const ws = {
      rangeStart: 0, rangeEnd: 0, looping: false, pauseAtEnd: 0, viewStart: 0, viewEnd: 60,
      setABLoop() {}, toggleABLoop() {}, onUserSeek() {}, setPauseAtEnd() {}, stopLoop() {},
      setView: vi.fn(), zoom: vi.fn(), fitToRange, setRange, _boundaryTickForTest() {}, countdownValue: null,
    } as any
    const adapter = makeFakeAdapter({ duration: 100, t: 0 })
    // Overlaps the [10s, 30s] drag window (see xToTime math below).
    const cues = [{ start: 15, end: 20, text_en: 'hi', text_ru: 'привет' }]

    try {
      const { container } = render(
        <WorkspacePanel ws={ws} cues={cues} adapter={adapter} activeIndex={-1} waveform={null}
          variant="refined" currentTime={0} playing={false} muted={false} />
      )
      const bar = container.querySelector('[data-workspace-bar]') as HTMLElement
      expect(bar).toBeTruthy()

      const seekCountBefore = adapter._seekCount

      // rect width=600, viewStart=0, viewEnd=60 → xToTime(100)=10s, xToTime(300)=30s.
      fireEvent.pointerDown(bar, { clientX: 100, clientY: 10, bubbles: true, button: 0 })
      fireEvent.pointerMove(bar, { clientX: 300, clientY: 10, bubbles: true })
      fireEvent.pointerUp(bar, { clientX: 300, clientY: 10, bubbles: true, button: 0 })

      expect(setRange).toHaveBeenCalledTimes(1)
      expect(setRange).toHaveBeenCalledWith(15, 20)
      expect(fitToRange).not.toHaveBeenCalled()
      expect(adapter._seekCount).toBe(seekCountBefore)
    } finally {
      rectSpy.mockRestore()
    }
  })
})
