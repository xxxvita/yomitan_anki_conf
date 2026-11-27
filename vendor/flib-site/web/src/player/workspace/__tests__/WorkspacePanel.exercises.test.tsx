// WorkspacePanel.exercises.test.tsx — S3-4 seam test: proves WorkspacePanel
// actually forwards shadowExercises/onExercise* to WorkspacePanelThemed (T6
// built the exercise lane in Themed, but WorkspacePanel never carried the
// props to it until this task — see WorkspacePanelThemed.bodymove.test.tsx's
// header comment, which rendered Themed DIRECTLY for exactly this reason).
//
// DORMANT-safety (S3-2 lesson, brief §3): an ordinary, non-shadowing user has
// `runtime.annotations.shadowExercises === []` (no exercises exist until
// S3-6/S3-7 create them). Test 1 proves an empty/absent array produces BYTE-
// IDENTICAL DOM to not passing the prop at all — no lane wrapper, no reserved
// space, no visual regression for that user.
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { WorkspacePanel } from '../WorkspacePanel'
import { makeFakeAdapter } from '../../../adapter/__tests__/fake'
import type { ShadowExerciseAnnotation } from '../panel-types'

function makeWs() {
  return {
    rangeStart: 0, rangeEnd: 0, looping: false, pauseAtEnd: 0, viewStart: 0, viewEnd: 60,
    setABLoop() {}, toggleABLoop() {}, onUserSeek() {}, setPauseAtEnd() {}, stopLoop() {},
    setView() {}, zoom() {}, fitToRange() {}, setRange() {}, _boundaryTickForTest() {}, countdownValue: null,
  } as any
}

function makeExercise(overrides: Partial<ShadowExerciseAnnotation> = {}): ShadowExerciseAnnotation {
  return {
    id: 'ex1',
    startTime: 0,
    endTime: 2,
    anchorMode: 'time-range',
    settings: {
      loopMode: false,
      advanceEnabled: false,
      advanceThreshold: 80,
      mode: 'subtitle',
      saveAudio: false,
      engines: { asr: 'x', check: 'y', ocr: 'z' },
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('WorkspacePanel — shadowExercises/onExercise* forwarding (S3-4)', () => {
  it('DORMANT: empty shadowExercises renders no exercise block AND is byte-identical to not passing the prop at all', () => {
    const adapter = makeFakeAdapter({ duration: 100, t: 0 })

    const withoutProp = render(
      <WorkspacePanel ws={makeWs()} cues={[]} adapter={adapter} activeIndex={-1} waveform={null}
        variant="refined" currentTime={0} playing={false} muted={false} />
    )
    expect(withoutProp.container.querySelector('[data-shadow-exercise]')).toBeNull()
    const htmlWithoutProp = withoutProp.container.innerHTML
    withoutProp.unmount()

    const withEmptyArray = render(
      <WorkspacePanel ws={makeWs()} cues={[]} adapter={adapter} activeIndex={-1} waveform={null}
        variant="refined" currentTime={0} playing={false} muted={false}
        shadowExercises={[]} />
    )
    expect(withEmptyArray.container.querySelector('[data-shadow-exercise]')).toBeNull()
    expect(withEmptyArray.container.innerHTML).toBe(htmlWithoutProp)
  })

  it('non-empty shadowExercises renders the exercise block on the timeline', () => {
    const adapter = makeFakeAdapter({ duration: 100, t: 0 })
    const { container } = render(
      <WorkspacePanel ws={makeWs()} cues={[]} adapter={adapter} activeIndex={-1} waveform={null}
        variant="refined" currentTime={0} playing={false} muted={false}
        shadowExercises={[makeExercise()]} />
    )
    expect(container.querySelector('[data-shadow-exercise]')).toBeTruthy()
  })

  it('onExerciseUpdate: dragging the exercise body (T6 body-move) reaches the prop WorkspacePanel forwards', () => {
    const rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 1000, height: 60, right: 1000, bottom: 60, x: 0, y: 0,
      toJSON() { return {} },
    } as DOMRect)
    const onExerciseUpdate = vi.fn()
    const adapter = makeFakeAdapter({ duration: 100, t: 0 })

    try {
      const ws = makeWs()
      ws.viewStart = 0; ws.viewEnd = 20
      const { container } = render(
        <WorkspacePanel ws={ws} cues={[]} adapter={adapter} activeIndex={-1} waveform={null}
          variant="refined" currentTime={0} playing={false} muted={false}
          shadowExercises={[makeExercise()]}
          onExerciseUpdate={onExerciseUpdate} />
      )
      const body = container.querySelector('[data-shadow-exercise]') as HTMLElement
      expect(body).toBeTruthy()

      // view [0,20] over a 1000px bar → 50px/sec; dx=150px → dt=3s, gap (no
      // cue at midpoint 4) → stays a free time-range move.
      fireEvent.mouseDown(body, { button: 0, clientX: 0, clientY: 0 })
      fireEvent.mouseMove(window, { clientX: 150, clientY: 0 })
      fireEvent.mouseUp(window)

      expect(onExerciseUpdate).toHaveBeenCalledWith(
        'ex1',
        { startTime: 3, endTime: 5, anchorMode: 'time-range', subIndex: undefined, positionsCustomized: true },
        { resolveConflicts: true },
      )
    } finally {
      rectSpy.mockRestore()
    }
  })

  it('onExerciseDelete: right-click + confirm reaches the prop WorkspacePanel forwards', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const onExerciseDelete = vi.fn()
    const adapter = makeFakeAdapter({ duration: 100, t: 0 })

    try {
      const { container } = render(
        <WorkspacePanel ws={makeWs()} cues={[]} adapter={adapter} activeIndex={-1} waveform={null}
          variant="refined" currentTime={0} playing={false} muted={false}
          shadowExercises={[makeExercise()]}
          onExerciseDelete={onExerciseDelete} />
      )
      const body = container.querySelector('[data-shadow-exercise]') as HTMLElement
      fireEvent.contextMenu(body)

      expect(confirmSpy).toHaveBeenCalled()
      expect(onExerciseDelete).toHaveBeenCalledWith('ex1')
    } finally {
      confirmSpy.mockRestore()
    }
  })

  it('onExerciseClick: a plain click (no movement) reaches the prop WorkspacePanel forwards', () => {
    const rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 1000, height: 60, right: 1000, bottom: 60, x: 0, y: 0,
      toJSON() { return {} },
    } as DOMRect)
    const onExerciseClick = vi.fn()
    const adapter = makeFakeAdapter({ duration: 100, t: 0 })

    try {
      const { container } = render(
        <WorkspacePanel ws={makeWs()} cues={[]} adapter={adapter} activeIndex={-1} waveform={null}
          variant="refined" currentTime={0} playing={false} muted={false}
          shadowExercises={[makeExercise()]}
          onExerciseClick={onExerciseClick} />
      )
      const body = container.querySelector('[data-shadow-exercise]') as HTMLElement

      fireEvent.mouseDown(body, { button: 0, clientX: 100, clientY: 0 })
      fireEvent.mouseMove(window, { clientX: 102, clientY: 0 }) // 2px < 4px threshold
      fireEvent.mouseUp(window)
      fireEvent.click(body)

      expect(onExerciseClick).toHaveBeenCalledWith('ex1')
    } finally {
      rectSpy.mockRestore()
    }
  })
})
