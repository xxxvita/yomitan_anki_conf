import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import { useHotkeys } from '../useHotkeys'
import { makeFakeAdapter } from '../../../adapter/__tests__/fake'
import type { PlayerAdapter } from '../../../adapter/PlayerAdapter'
import type { WorkspaceApi } from '../useWorkspace'
import type { Cue } from '../useSubtitles'

afterEach(() => cleanup())

function makeWs(overrides: Partial<WorkspaceApi> = {}): WorkspaceApi {
  return {
    rangeStart: 0, rangeEnd: 0, looping: false, pauseAtEnd: 0, countdownValue: null,
    viewStart: 0, viewEnd: 60,
    setABLoop: vi.fn(), toggleABLoop: vi.fn(), onPlayCommand: vi.fn(), onUserSeek: vi.fn(), setPauseAtEnd: vi.fn(),
    stopLoop: vi.fn(), setView: vi.fn(), zoom: vi.fn(), fitToRange: vi.fn(), setRange: vi.fn(),
    _boundaryTickForTest: vi.fn(),
    countdownThenPlay: vi.fn(), resumeFromBoundary: vi.fn(), restoreWorkspace: vi.fn(),
    deactivateWorkspace: vi.fn(), getWorkspaceSnapshot: vi.fn(),
    ...overrides,
  }
}

const cues: Cue[] = [
  { start: 0, end: 5, text_en: 'a', text_ru: 'а' },
  { start: 10, end: 15, text_en: 'b', text_ru: 'б' },
  { start: 100, end: 105, text_en: 'c', text_ru: 'в' },
]

function Harness({ adapter, ws, cues, activeIndex, onApplyMute, onToggleTimeline }: {
  adapter: PlayerAdapter | null; ws: WorkspaceApi; cues: Cue[]; activeIndex: number
  onApplyMute?: (t1: number, t2: number, cueIndex: number) => void
  onToggleTimeline?: () => void
}) {
  useHotkeys({ adapter, ws, cues, activeIndex, onApplyMute, onToggleTimeline })
  return <input data-testid="text-input" />
}

describe('useHotkeys', () => {
  it('Space routes to ws.onPlayCommand (single Play-into-loop entry point)', () => {
    const a = makeFakeAdapter({ t: 0 })
    const ws = makeWs()
    render(<Harness adapter={a} ws={ws} cues={cues} activeIndex={0} />)
    fireEvent.keyDown(document, { key: ' ' })
    expect(ws.onPlayCommand).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(document, { key: ' ' })
    expect(ws.onPlayCommand).toHaveBeenCalledTimes(2) // каждый Space = один вызов
  })

  it('ArrowLeft seeks -5s (clamped at 0), desktop canon: loop survives arrow-seek', () => {
    const a = makeFakeAdapter({ t: 3 })
    const seek = vi.spyOn(a, 'seek')
    const ws = makeWs()
    render(<Harness adapter={a} ws={ws} cues={cues} activeIndex={0} />)
    fireEvent.keyDown(document, { key: 'ArrowLeft' })
    expect(seek).toHaveBeenCalledWith(0)
    expect(ws.onUserSeek).not.toHaveBeenCalled()
  })

  it('ArrowRight seeks +5s, desktop canon: loop survives arrow-seek', () => {
    const a = makeFakeAdapter({ t: 3 })
    const seek = vi.spyOn(a, 'seek')
    const ws = makeWs()
    render(<Harness adapter={a} ws={ws} cues={cues} activeIndex={0} />)
    fireEvent.keyDown(document, { key: 'ArrowRight' })
    expect(seek).toHaveBeenCalledWith(8)
    expect(ws.onUserSeek).not.toHaveBeenCalled()
  })

  it('Ctrl+ArrowRight goes to next cue, shifting the view when the cue is outside it (desktop canon: loop survives)', () => {
    const a = makeFakeAdapter({ t: 12, duration: 200 })
    const seek = vi.spyOn(a, 'seek')
    const ws = makeWs({ viewStart: 0, viewEnd: 60 })
    render(<Harness adapter={a} ws={ws} cues={cues} activeIndex={1} />)
    fireEvent.keyDown(document, { key: 'ArrowRight', ctrlKey: true })
    // next cue (index 2): start=100 end=105, outside current view [0,60] → setView called
    expect(ws.setView).toHaveBeenCalled()
    expect(seek).toHaveBeenCalledWith(100)
    expect(ws.onUserSeek).not.toHaveBeenCalled()
  })

  it('Ctrl+ArrowLeft goes to previous cue (desktop canon: loop survives)', () => {
    const a = makeFakeAdapter({ t: 50, duration: 200 })
    const seek = vi.spyOn(a, 'seek')
    const ws = makeWs({ viewStart: 0, viewEnd: 60 })
    render(<Harness adapter={a} ws={ws} cues={cues} activeIndex={1} />)
    fireEvent.keyDown(document, { key: 'ArrowLeft', ctrlKey: true })
    // previous cue (index 0): start=0 end=5, inside current view → no setView needed
    expect(seek).toHaveBeenCalledWith(0)
    expect(ws.onUserSeek).not.toHaveBeenCalled()
  })

  it('"b" toggles the AB loop for the active cue', () => {
    const a = makeFakeAdapter({ t: 0 })
    const ws = makeWs()
    render(<Harness adapter={a} ws={ws} cues={cues} activeIndex={1} />)
    fireEvent.keyDown(document, { key: 'b', code: 'KeyB' })
    expect(ws.toggleABLoop).toHaveBeenCalledWith(1)
  })

  it('"m" with a valid [A,B] range applies the mute region for that range', () => {
    const a = makeFakeAdapter({ t: 0 })
    const ws = makeWs({ rangeStart: 10, rangeEnd: 20 })
    const onApplyMute = vi.fn()
    render(<Harness adapter={a} ws={ws} cues={cues} activeIndex={2} onApplyMute={onApplyMute} />)
    fireEvent.keyDown(document, { key: 'm', code: 'KeyM' })
    expect(onApplyMute).toHaveBeenCalledWith(10, 20, 2)
  })

  it('"m" with no valid [A,B] range (rangeEnd <= rangeStart) does nothing', () => {
    const a = makeFakeAdapter({ t: 0 })
    const ws = makeWs({ rangeStart: 5, rangeEnd: 5 })
    const onApplyMute = vi.fn()
    render(<Harness adapter={a} ws={ws} cues={cues} activeIndex={0} onApplyMute={onApplyMute} />)
    fireEvent.keyDown(document, { key: 'm', code: 'KeyM' })
    expect(onApplyMute).not.toHaveBeenCalled()
  })

  it('Ctrl+M does nothing (reserved, not the plain M hotkey)', () => {
    const a = makeFakeAdapter({ t: 0 })
    const ws = makeWs({ rangeStart: 10, rangeEnd: 20 })
    const onApplyMute = vi.fn()
    render(<Harness adapter={a} ws={ws} cues={cues} activeIndex={0} onApplyMute={onApplyMute} />)
    fireEvent.keyDown(document, { key: 'm', code: 'KeyM', ctrlKey: true })
    expect(onApplyMute).not.toHaveBeenCalled()
  })

  it('Z toggles the timeline panel via onToggleTimeline', () => {
    const a = makeFakeAdapter({ t: 0 })
    const ws = makeWs()
    const onToggleTimeline = vi.fn()
    render(<Harness adapter={a} ws={ws} cues={cues} activeIndex={0} onToggleTimeline={onToggleTimeline} />)
    fireEvent.keyDown(document, { key: 'z', code: 'KeyZ' })
    expect(onToggleTimeline).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(document, { key: 'z', code: 'KeyZ' })
    expect(onToggleTimeline).toHaveBeenCalledTimes(2)
  })

  it('Ctrl+Z does not toggle the timeline (reserved)', () => {
    const a = makeFakeAdapter({ t: 0 })
    const ws = makeWs()
    const onToggleTimeline = vi.fn()
    render(<Harness adapter={a} ws={ws} cues={cues} activeIndex={0} onToggleTimeline={onToggleTimeline} />)
    fireEvent.keyDown(document, { key: 'z', code: 'KeyZ', ctrlKey: true })
    expect(onToggleTimeline).not.toHaveBeenCalled()
  })

  it('ignores all keydowns while an input is focused', () => {
    const a = makeFakeAdapter({ t: 0 })
    const play = vi.spyOn(a, 'play')
    const ws = makeWs()
    const { getByTestId } = render(<Harness adapter={a} ws={ws} cues={cues} activeIndex={0} />)
    getByTestId('text-input').focus()
    fireEvent.keyDown(document, { key: ' ' })
    expect(play).not.toHaveBeenCalled()
    expect(ws.onPlayCommand).not.toHaveBeenCalled() // isTypingTarget гасит Space до делегации
    expect(ws.toggleABLoop).not.toHaveBeenCalled()
  })

  it('is a no-op when adapter is null (no throw)', () => {
    const ws = makeWs()
    render(<Harness adapter={null} ws={ws} cues={cues} activeIndex={0} />)
    expect(() => fireEvent.keyDown(document, { key: ' ' })).not.toThrow()
    expect(ws.onPlayCommand).not.toHaveBeenCalled() // `if (!adapter) return` в useHotkeys до Space-ветки
    expect(ws.toggleABLoop).not.toHaveBeenCalled()
  })

  it('removes the keydown listener on unmount (no leak)', () => {
    const a = makeFakeAdapter({ t: 0 })
    const play = vi.spyOn(a, 'play')
    const ws = makeWs()
    const { unmount } = render(<Harness adapter={a} ws={ws} cues={cues} activeIndex={0} />)
    unmount()
    fireEvent.keyDown(document, { key: ' ' })
    expect(play).not.toHaveBeenCalled()
    expect(ws.onPlayCommand).not.toHaveBeenCalled() // слушатель снят → делегации нет
  })

  it('Russian keyboard layout: я (Cyrillic) with code=KeyZ toggles timeline (e.code not e.key)', () => {
    const a = makeFakeAdapter({ t: 0 })
    const ws = makeWs()
    const onToggleTimeline = vi.fn()
    render(<Harness adapter={a} ws={ws} cues={cues} activeIndex={0} onToggleTimeline={onToggleTimeline} />)
    // e.key='я' (Cyrillic in RU layout) but e.code='KeyZ' — should trigger
    fireEvent.keyDown(document, { key: 'я', code: 'KeyZ' })
    expect(onToggleTimeline).toHaveBeenCalledTimes(1)
  })

  it('F toggles fullscreen via onToggleFullscreen', () => {
    const a = makeFakeAdapter({ t: 0 })
    const ws = makeWs()
    const onToggleFullscreen = vi.fn()
    const TestHarnessWithFS = () => {
      useHotkeys({ adapter: a, ws, cues, activeIndex: 0, onToggleFullscreen })
      return <input data-testid="text-input" />
    }
    render(<TestHarnessWithFS />)
    fireEvent.keyDown(document, { key: 'f', code: 'KeyF' })
    expect(onToggleFullscreen).toHaveBeenCalledTimes(1)
  })

  it('Ctrl+F does not toggle fullscreen (reserved for browser find)', () => {
    const a = makeFakeAdapter({ t: 0 })
    const ws = makeWs()
    const onToggleFullscreen = vi.fn()
    const TestHarnessWithFS = () => {
      useHotkeys({ adapter: a, ws, cues, activeIndex: 0, onToggleFullscreen })
      return <input data-testid="text-input" />
    }
    render(<TestHarnessWithFS />)
    fireEvent.keyDown(document, { key: 'f', code: 'KeyF', ctrlKey: true })
    expect(onToggleFullscreen).not.toHaveBeenCalled()
  })

  it('Meta+F does not toggle fullscreen (reserved for browser)', () => {
    const a = makeFakeAdapter({ t: 0 })
    const ws = makeWs()
    const onToggleFullscreen = vi.fn()
    const TestHarnessWithFS = () => {
      useHotkeys({ adapter: a, ws, cues, activeIndex: 0, onToggleFullscreen })
      return <input data-testid="text-input" />
    }
    render(<TestHarnessWithFS />)
    fireEvent.keyDown(document, { key: 'f', code: 'KeyF', metaKey: true })
    expect(onToggleFullscreen).not.toHaveBeenCalled()
  })

  it('Alt+F does not toggle fullscreen (reserved for Windows browser/OS menu)', () => {
    const a = makeFakeAdapter({ t: 0 })
    const ws = makeWs()
    const onToggleFullscreen = vi.fn()
    const TestHarnessWithFS = () => {
      useHotkeys({ adapter: a, ws, cues, activeIndex: 0, onToggleFullscreen })
      return <input data-testid="text-input" />
    }
    render(<TestHarnessWithFS />)
    fireEvent.keyDown(document, { key: 'f', code: 'KeyF', altKey: true })
    expect(onToggleFullscreen).not.toHaveBeenCalled()
  })

  // ── T4 — S: делегирование в useShadowRuntime.handleShadowKey ──────────────
  const renderWithShadow = (onShadowKey: () => void, adapter = makeFakeAdapter({ t: 0 })) => {
    const ws = makeWs()
    const H = () => {
      useHotkeys({ adapter, ws, cues, activeIndex: 0, onShadowKey })
      return <input data-testid="text-input" />
    }
    render(<H />)
    return ws
  }

  it('S (plain) вызывает onShadowKey ровно один раз', () => {
    const onShadowKey = vi.fn()
    renderWithShadow(onShadowKey)
    fireEvent.keyDown(document, { key: 's', code: 'KeyS' })
    expect(onShadowKey).toHaveBeenCalledTimes(1)
  })

  it('S в поле ввода (isTypingTarget) НЕ вызывает onShadowKey', () => {
    const onShadowKey = vi.fn()
    renderWithShadow(onShadowKey)
    const input = document.querySelector('[data-testid="text-input"]') as HTMLInputElement
    input.focus()
    fireEvent.keyDown(input, { key: 's', code: 'KeyS' })
    expect(onShadowKey).not.toHaveBeenCalled()
  })

  it.each([
    ['Ctrl+S (браузерное Сохранить)', { ctrlKey: true }],
    ['Meta+S', { metaKey: true }],
    ['Alt+S', { altKey: true }],
    ['Shift+S', { shiftKey: true }],
  ])('%s НЕ вызывает onShadowKey', (_label, mods) => {
    const onShadowKey = vi.fn()
    renderWithShadow(onShadowKey)
    fireEvent.keyDown(document, { key: 's', code: 'KeyS', ...mods })
    expect(onShadowKey).not.toHaveBeenCalled()
  })

  it('регресс: S без onShadowKey не роняет и не мешает другим клавишам', () => {
    const a = makeFakeAdapter({ t: 3 })
    const seek = vi.spyOn(a, 'seek')
    const ws = makeWs()
    render(<Harness adapter={a} ws={ws} cues={cues} activeIndex={0} />)
    fireEvent.keyDown(document, { key: 's', code: 'KeyS' }) // no onShadowKey wired → тихий no-op
    fireEvent.keyDown(document, { key: ' ' })
    expect(ws.onPlayCommand).toHaveBeenCalledTimes(1) // Space жив
    fireEvent.keyDown(document, { key: 'ArrowRight' })
    expect(seek).toHaveBeenCalledWith(8) // стрелки живы
  })

  // ── Срез A (п.7): клавиша R = onShadowToggle (тот же toggle, что пилюля) ──
  it('R (plain) вызывает onShadowToggle ровно один раз; S его НЕ вызывает (разные колбэки)', () => {
    const onShadowToggle = vi.fn()
    const onShadowKey = vi.fn()
    const ws = makeWs()
    const H = () => { useHotkeys({ adapter: makeFakeAdapter({ t: 0 }), ws, cues, activeIndex: 0, onShadowKey, onShadowToggle }); return null }
    render(<H />)
    fireEvent.keyDown(document, { key: 'r', code: 'KeyR' })
    expect(onShadowToggle).toHaveBeenCalledTimes(1)
    expect(onShadowKey).not.toHaveBeenCalled()
    fireEvent.keyDown(document, { key: 's', code: 'KeyS' })
    expect(onShadowKey).toHaveBeenCalledTimes(1)
    expect(onShadowToggle).toHaveBeenCalledTimes(1) // S не тронул toggle
  })

  it('R в поле ввода / с модификаторами (Ctrl/Meta+R = reload) НЕ вызывает onShadowToggle', () => {
    const onShadowToggle = vi.fn()
    const H = () => { useHotkeys({ adapter: makeFakeAdapter({ t: 0 }), ws: makeWs(), cues, activeIndex: 0, onShadowToggle }); return <input data-testid="ti" /> }
    render(<H />)
    for (const mods of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }]) {
      fireEvent.keyDown(document, { key: 'r', code: 'KeyR', ...mods })
    }
    expect(onShadowToggle).not.toHaveBeenCalled()
    const input = document.querySelector('[data-testid="ti"]') as HTMLInputElement
    input.focus()
    fireEvent.keyDown(input, { key: 'r', code: 'KeyR' })
    expect(onShadowToggle).not.toHaveBeenCalled()
  })

  // ── S3-5 — маршрут через `seek` prop (runtime.seek/observedSeek) ──────────
  describe('S3-5: seek prop routes user-seeks off adapter.seek', () => {
    function HarnessWithSeek({ adapter, ws, cues, activeIndex, seek }: {
      adapter: PlayerAdapter; ws: WorkspaceApi; cues: Cue[]; activeIndex: number; seek: (t: number) => void
    }) {
      useHotkeys({ adapter, ws, cues, activeIndex, seek })
      return <input data-testid="text-input" />
    }

    it('ArrowLeft calls seek(t), NOT adapter.seek directly', () => {
      const a = makeFakeAdapter({ t: 3 })
      const adapterSeek = vi.spyOn(a, 'seek')
      const seek = vi.fn()
      const ws = makeWs()
      render(<HarnessWithSeek adapter={a} ws={ws} cues={cues} activeIndex={0} seek={seek} />)
      fireEvent.keyDown(document, { key: 'ArrowLeft' })
      expect(seek).toHaveBeenCalledWith(0)
      expect(adapterSeek).not.toHaveBeenCalled()
    })

    it('ArrowRight calls seek(t), NOT adapter.seek directly', () => {
      const a = makeFakeAdapter({ t: 3 })
      const adapterSeek = vi.spyOn(a, 'seek')
      const seek = vi.fn()
      const ws = makeWs()
      render(<HarnessWithSeek adapter={a} ws={ws} cues={cues} activeIndex={0} seek={seek} />)
      fireEvent.keyDown(document, { key: 'ArrowRight' })
      expect(seek).toHaveBeenCalledWith(8)
      expect(adapterSeek).not.toHaveBeenCalled()
    })

    it('Ctrl+ArrowRight (goToCue) calls seek(cue.start), NOT adapter.seek directly', () => {
      const a = makeFakeAdapter({ t: 12, duration: 200 })
      const adapterSeek = vi.spyOn(a, 'seek')
      const seek = vi.fn()
      const ws = makeWs({ viewStart: 0, viewEnd: 60 })
      render(<HarnessWithSeek adapter={a} ws={ws} cues={cues} activeIndex={1} seek={seek} />)
      fireEvent.keyDown(document, { key: 'ArrowRight', ctrlKey: true })
      expect(seek).toHaveBeenCalledWith(100)
      expect(adapterSeek).not.toHaveBeenCalled()
    })

    it('Ctrl+ArrowLeft (goToCue) calls seek(cue.start), NOT adapter.seek directly', () => {
      const a = makeFakeAdapter({ t: 50, duration: 200 })
      const adapterSeek = vi.spyOn(a, 'seek')
      const seek = vi.fn()
      const ws = makeWs({ viewStart: 0, viewEnd: 60 })
      render(<HarnessWithSeek adapter={a} ws={ws} cues={cues} activeIndex={1} seek={seek} />)
      fireEvent.keyDown(document, { key: 'ArrowLeft', ctrlKey: true })
      expect(seek).toHaveBeenCalledWith(0)
      expect(adapterSeek).not.toHaveBeenCalled()
    })

    it('transparency: without a seek prop, arrow keys still fall back to adapter.seek (byte-identical to pre-S3-5)', () => {
      const a = makeFakeAdapter({ t: 3 })
      const adapterSeek = vi.spyOn(a, 'seek')
      const ws = makeWs()
      render(<Harness adapter={a} ws={ws} cues={cues} activeIndex={0} />)
      fireEvent.keyDown(document, { key: 'ArrowRight' })
      expect(adapterSeek).toHaveBeenCalledWith(8)
    })
  })
})
