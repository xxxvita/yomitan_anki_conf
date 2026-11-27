// WorkspacePanel.seek-route.test.tsx
// S3-5 — маршрут ВСЕХ user-сиков через runtime.seek (observedSeek, carry
// T4/F3 forward-escape). Проверяем два независимых пути внутри WorkspacePanel:
// (1) onCueClick (ctrl+click retarget / inside-click / outside-click),
// (2) onSeek (переданный в WorkspacePanelThemed — ±5s кнопки нижнего бара).
// Оба должны звать переданный `seek` prop, а НЕ adapter.seek напрямую, когда он
// передан; без него (caller ещё не поднял runtime) — байт-в-байт fallback на
// adapter.seek (транспарентность, доказана существующими *.cueclick/*.rubber
// тестами, которые не передают `seek` и по-прежнему видят adapter._seekCount++).
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { WorkspacePanel } from '../WorkspacePanel'
import { makeFakeAdapter } from '../../../adapter/__tests__/fake'

function makeWsStub(overrides: Record<string, unknown> = {}) {
  return {
    rangeStart: 10, rangeEnd: 30, looping: false, pauseAtEnd: 0, viewStart: 0, viewEnd: 60,
    setABLoop() {}, toggleABLoop() {}, onUserSeek() {}, setPauseAtEnd() {}, stopLoop() {},
    setView: vi.fn(), zoom: vi.fn(), fitToRange: vi.fn(), setRange: vi.fn(), _boundaryTickForTest() {},
    countdownValue: null,
    ...overrides,
  } as any
}

describe('WorkspacePanel — S3-5 seek prop routing', () => {
  it('Ctrl+click cue-retarget calls seek(cue.start) via the seek prop, NOT adapter.seek', () => {
    const rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 600, height: 60, right: 600, bottom: 60, x: 0, y: 0,
      toJSON() { return {} },
    } as DOMRect)
    try {
      const adapter = makeFakeAdapter({ duration: 100, t: 0 })
      const adapterSeek = vi.spyOn(adapter, 'seek')
      const seek = vi.fn()
      const ws = makeWsStub()
      const cues = [{ start: 15, end: 20, text_en: 'hi', text_ru: 'привет' }]

      const { container } = render(
        <WorkspacePanel ws={ws} cues={cues} adapter={adapter} seek={seek} activeIndex={-1} waveform={null}
          variant="refined" currentTime={0} playing={false} muted={false} />
      )
      const cueEl = container.querySelector('[data-cue]') as HTMLElement
      fireEvent.click(cueEl, { clientX: 170, clientY: 10, bubbles: true, ctrlKey: true })

      expect(ws.setRange).toHaveBeenCalledWith(15, 20)
      expect(seek).toHaveBeenCalledWith(15)
      expect(adapterSeek).not.toHaveBeenCalled()
    } finally {
      rectSpy.mockRestore()
    }
  })

  it('outside-click (retarget branch) calls seek(cue.start) via the seek prop, NOT adapter.seek', () => {
    const rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 600, height: 60, right: 600, bottom: 60, x: 0, y: 0,
      toJSON() { return {} },
    } as DOMRect)
    try {
      const adapter = makeFakeAdapter({ duration: 100, t: 0 })
      const adapterSeek = vi.spyOn(adapter, 'seek')
      const seek = vi.fn()
      // rangeStart/rangeEnd deliberately do NOT cover the cue → click lands in
      // the `else` (outside) branch: setRange + seek(cue.start).
      const ws = makeWsStub({ rangeStart: 0, rangeEnd: 0 })
      const cues = [{ start: 15, end: 20, text_en: 'hi', text_ru: 'привет' }]

      const { container } = render(
        <WorkspacePanel ws={ws} cues={cues} adapter={adapter} seek={seek} activeIndex={-1} waveform={null}
          variant="refined" currentTime={0} playing={false} muted={false} />
      )
      const cueEl = container.querySelector('[data-cue]') as HTMLElement
      fireEvent.click(cueEl, { clientX: 170, clientY: 10, bubbles: true })

      expect(ws.setRange).toHaveBeenCalledWith(15, 20)
      expect(seek).toHaveBeenCalledWith(15)
      expect(adapterSeek).not.toHaveBeenCalled()
    } finally {
      rectSpy.mockRestore()
    }
  })

  it('bottom-bar +5s button calls seek(currentTime+5) via the seek prop, NOT adapter.seek', () => {
    const adapter = makeFakeAdapter({ duration: 100, t: 10 })
    const adapterSeek = vi.spyOn(adapter, 'seek')
    const seek = vi.fn()
    const ws = makeWsStub()

    const { getByTitle } = render(
      <WorkspacePanel ws={ws} cues={[]} adapter={adapter} seek={seek} activeIndex={-1} waveform={null}
        variant="refined" currentTime={10} playing={false} muted={false} />
    )
    fireEvent.click(getByTitle('+5 с'))

    expect(seek).toHaveBeenCalledWith(15)
    expect(adapterSeek).not.toHaveBeenCalled()
  })

  it('bottom-bar -5s button calls seek(currentTime-5) via the seek prop, NOT adapter.seek', () => {
    const adapter = makeFakeAdapter({ duration: 100, t: 10 })
    const adapterSeek = vi.spyOn(adapter, 'seek')
    const seek = vi.fn()
    const ws = makeWsStub()

    const { getByTitle } = render(
      <WorkspacePanel ws={ws} cues={[]} adapter={adapter} seek={seek} activeIndex={-1} waveform={null}
        variant="refined" currentTime={10} playing={false} muted={false} />
    )
    fireEvent.click(getByTitle('−5 с'))

    expect(seek).toHaveBeenCalledWith(5)
    expect(adapterSeek).not.toHaveBeenCalled()
  })

  it('transparency: without a seek prop, cue-click still falls back to adapter.seek (byte-identical to pre-S3-5)', () => {
    const rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 600, height: 60, right: 600, bottom: 60, x: 0, y: 0,
      toJSON() { return {} },
    } as DOMRect)
    try {
      const adapter = makeFakeAdapter({ duration: 100, t: 0 })
      const adapterSeek = vi.spyOn(adapter, 'seek')
      const ws = makeWsStub()
      const cues = [{ start: 15, end: 20, text_en: 'hi', text_ru: 'привет' }]

      const { container } = render(
        <WorkspacePanel ws={ws} cues={cues} adapter={adapter} activeIndex={-1} waveform={null}
          variant="refined" currentTime={0} playing={false} muted={false} />
      )
      const cueEl = container.querySelector('[data-cue]') as HTMLElement
      fireEvent.click(cueEl, { clientX: 170, clientY: 10, bubbles: true, ctrlKey: true })

      expect(adapterSeek).toHaveBeenCalledWith(15)
    } finally {
      rectSpy.mockRestore()
    }
  })
})
