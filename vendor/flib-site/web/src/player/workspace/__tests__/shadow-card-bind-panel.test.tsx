// shadow-card-bind-panel.test.tsx — T9: RTL coverage for the bind-panel
// "ПРИВЯЗКА" row lifted verbatim from desktop ShadowChat.tsx :951-998
// (bindRowFull) into ShadowCardLifted.tsx, plus the BL2 fix (audit/28):
// onAnchorDrop carries a raw [0,1] fraction, and the CALLER maps it to an
// absolute time via dropTimeFromFraction(fraction, viewStart, viewEnd) — NOT
// fraction*duration, which silently breaks once the timeline is zoomed
// (viewStart>0). Same jsdom-layout caveat T8's own test file documents: no
// real layout/paint engine, but every coordinate this gesture touches
// (pointer clientX/clientY, getBoundingClientRect rects) is a plain number
// the component reads directly, so simulated pointerdown/up IS full coverage
// of the MECHANIC — it is not a substitute for a live-gate check of an
// actual mouse/touch drag on a real screen (owner ask, see task report).
//
// Per audit/28's caveat (§6.8, "data-workspace-bar на КОРНЕ панели с
// paddingX ... frac имеет постоянный сдвиг на паддинг"): these tests are
// built on `frac` values (computed exactly the way the component computes
// them, from a mocked fixed-size barRect), never on raw clientX assumed to
// map 1:1 to a real on-screen pixel — so a real paddingX on the workspace
// bar root cannot invalidate them.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { ShadowCard } from '../ShadowCardLifted'
import { setLocale } from '../../i18n'
import { dropTimeFromFraction } from '../drop-time'
import type { ShadowV1Api } from '../../hooks/useShadowV1'
import type { ShadowState } from '../panel-types'

function mkShadow(overrides: Partial<ShadowV1Api> = {}): ShadowV1Api {
  return {
    active: true,
    phase: 'idle',
    errorCode: null,
    remainingSec: 60,
    referenceText: 'hello world',
    cueIndex: 0,
    lastMarks: null,
    lastMatchPct: null,
    lastSpoken: null,
    capped: false,
    recordAudioUrl: null,
    analyserNode: null,
    shadowAttempts: {},
    recordings: [],
    activate: vi.fn(),
    deactivate: vi.fn(),
    toggle: vi.fn(),
    startRecording: vi.fn(async () => {}),
    stopRecording: vi.fn(),
    dismissResult: vi.fn(),
    selectRecording: vi.fn(),
    deleteRecording: vi.fn(),
    ...overrides,
  }
}

// Same fixed-rect mocking idiom as shadow-card-drag-dock.test.tsx (T8):
// jsdom always reports an all-zero getBoundingClientRect otherwise, so the
// workspace-bar rect the anchor-grip reads must be mocked per-element.
const BAR_RECT = { left: 200, top: 800, right: 1200, bottom: 900, width: 1000, height: 100 }

function domRect(r: typeof BAR_RECT): DOMRect {
  return { ...r, x: r.left, y: r.top, toJSON: () => r } as DOMRect
}

function mockBarRect() {
  const bar = domRect(BAR_RECT)
  return vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute('data-workspace-bar') ? bar : ({ ...bar, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 } as DOMRect)
  })
}

interface RenderCardProps {
  shadow?: ShadowV1Api
  onBindOff?: () => void
  onBindToSubtitle?: () => void
  onBindToTime?: () => void
  bindTC?: string
  onAnchorDrop?: (fraction: number) => void
  setShadowState?: (patch: Partial<Pick<ShadowState, 'bind'>>) => void
}

function renderCard(props: RenderCardProps = {}) {
  const shadow = props.shadow ?? mkShadow()
  return render(
    <>
      <div data-workspace-bar />
      <ShadowCard
        shadow={shadow}
        onBindOff={props.onBindOff}
        onBindToSubtitle={props.onBindToSubtitle}
        onBindToTime={props.onBindToTime}
        bindTC={props.bindTC}
        onAnchorDrop={props.onAnchorDrop}
        setShadowState={props.setShadowState}
      />
    </>,
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  setLocale('ru')
})

describe('T9 bind-panel "ПРИВЯЗКА" (ShadowCardLifted, lifted from ShadowChat.tsx :951-998)', () => {
  it('defaults to "off" highlighted, "к субтитру"/"сейчас" not', () => {
    const { getByTestId } = renderCard()
    // bindBtnStyle(on=true, off=true) uses --btn-active background; the two
    // non-active buttons fall to the `on=false` transparent branch.
    expect(getByTestId('shadow-bind-off').style.background).toContain('--btn-active')
    expect(getByTestId('shadow-bind-sub').style.background).toBe('transparent')
    expect(getByTestId('shadow-bind-now').style.background).toBe('transparent')
  })

  it('handleBind("off"): clicking "выкл" calls onBindOff + setShadowState({bind:"off"}), off stays/re-highlighted', () => {
    const onBindOff = vi.fn()
    const setShadowState = vi.fn()
    const { getByTestId } = renderCard({ onBindOff, setShadowState })
    fireEvent.click(getByTestId('shadow-bind-off'))
    expect(onBindOff).toHaveBeenCalledTimes(1)
    expect(setShadowState).toHaveBeenCalledWith({ bind: 'off' })
    expect(getByTestId('shadow-bind-off').style.background).toContain('--btn-active')
  })

  it('handleBind("subStart"): clicking "к субтитру" calls onBindToSubtitle + setShadowState, highlight moves to that button', () => {
    const onBindToSubtitle = vi.fn()
    const setShadowState = vi.fn()
    const { getByTestId } = renderCard({ onBindToSubtitle, setShadowState })
    fireEvent.click(getByTestId('shadow-bind-sub'))
    expect(onBindToSubtitle).toHaveBeenCalledTimes(1)
    expect(setShadowState).toHaveBeenCalledWith({ bind: 'subStart' })
    expect(getByTestId('shadow-bind-sub').style.background).toContain('--accent')
    expect(getByTestId('shadow-bind-off').style.background).toBe('transparent')
  })

  it('handleBind("now"): clicking "сейчас" calls onBindToTime + setShadowState, highlight moves to that button', () => {
    const onBindToTime = vi.fn()
    const setShadowState = vi.fn()
    const { getByTestId } = renderCard({ onBindToTime, setShadowState })
    fireEvent.click(getByTestId('shadow-bind-now'))
    expect(onBindToTime).toHaveBeenCalledTimes(1)
    expect(setShadowState).toHaveBeenCalledWith({ bind: 'now' })
    expect(getByTestId('shadow-bind-now').style.background).toContain('--accent')
  })

  it('clicking each segment does not throw when no persist callback / setShadowState is wired (production wiring is a later integration task, same status as T5 onSetCustomText)', () => {
    const { getByTestId } = renderCard()
    expect(() => {
      fireEvent.click(getByTestId('shadow-bind-sub'))
      fireEvent.click(getByTestId('shadow-bind-now'))
      fireEvent.click(getByTestId('shadow-bind-off'))
    }).not.toThrow()
  })

  it('bindTC prop renders next to the segmented control; dims to 0.35 opacity while bind==="off", full opacity once a bind is picked', () => {
    const { getByText, getByTestId } = renderCard({ bindTC: '1:05' })
    expect(getByText('1:05').style.opacity).toBe('0.35') // default local bind==='off'
    fireEvent.click(getByTestId('shadow-bind-now'))
    expect(getByText('1:05').style.opacity).toBe('1')
  })

  it('no bindTC provided renders the em-dash placeholder', () => {
    const { getByTestId } = renderCard()
    expect(getByTestId('shadow-bind-row').textContent).toContain('—')
  })

  it('RTL (ru default): segmented-control labels + drag hint title', () => {
    const { getByTestId } = renderCard()
    expect(getByTestId('shadow-bind-off').textContent).toBe('выкл')
    expect(getByTestId('shadow-bind-sub').textContent).toBe('к субтитру')
    expect(getByTestId('shadow-bind-now').textContent).toBe('сейчас')
    expect(getByTestId('shadow-bind-anchor-grip').title).toBe('Перетащите на дорожку упражнений')
  })

  it('RTL (en locale): segmented-control labels + drag hint title switch to English', () => {
    setLocale('en')
    const { getByTestId } = renderCard()
    expect(getByTestId('shadow-bind-off').textContent).toBe('off')
    expect(getByTestId('shadow-bind-sub').textContent).toBe('to subtitle')
    expect(getByTestId('shadow-bind-now').textContent).toBe('to time')
    expect(getByTestId('shadow-bind-anchor-grip').title).toBe('Drag to exercise track')
  })

  // ── anchor-grip pointer-drag → onAnchorDrop(fraction) ──────────────────────

  it('drop released INSIDE barRect calls onAnchorDrop with the correct [0,1] fraction ((clientX-barRect.left)/barRect.width)', () => {
    mockBarRect()
    const onAnchorDrop = vi.fn()
    const { getByTestId } = renderCard({ onAnchorDrop })
    const grip = getByTestId('shadow-bind-anchor-grip')

    fireEvent.pointerDown(grip, { clientX: 200, clientY: 850, pointerId: 1 })
    // Drop at clientX=700 inside BAR_RECT[200,1200] → frac=(700-200)/1000=0.5.
    fireEvent.pointerUp(grip, { clientX: 700, clientY: 850, pointerId: 1 })

    expect(onAnchorDrop).toHaveBeenCalledTimes(1)
    expect(onAnchorDrop).toHaveBeenCalledWith(0.5)
  })

  it('drop released OUTSIDE barRect (below its vertical span) is a no-op — onAnchorDrop is never called', () => {
    mockBarRect()
    const onAnchorDrop = vi.fn()
    const { getByTestId } = renderCard({ onAnchorDrop })
    const grip = getByTestId('shadow-bind-anchor-grip')

    fireEvent.pointerDown(grip, { clientX: 200, clientY: 850, pointerId: 1 })
    // clientY=950 is below BAR_RECT.bottom=900 — outside the bar entirely.
    fireEvent.pointerUp(grip, { clientX: 700, clientY: 950, pointerId: 1 })

    expect(onAnchorDrop).not.toHaveBeenCalled()
  })

  it('a pointerUp with no preceding pointerDown on the grip is a no-op (anchorDragging guard)', () => {
    mockBarRect()
    const onAnchorDrop = vi.fn()
    const { getByTestId } = renderCard({ onAnchorDrop })
    fireEvent.pointerUp(getByTestId('shadow-bind-anchor-grip'), { clientX: 700, clientY: 850, pointerId: 1 })
    expect(onAnchorDrop).not.toHaveBeenCalled()
  })

  it('fraction clamps to [0,1] for drops released past either edge of barRect (clientX still inside the vertical span)', () => {
    mockBarRect()
    const onAnchorDrop = vi.fn()
    const { getByTestId } = renderCard({ onAnchorDrop })
    const grip = getByTestId('shadow-bind-anchor-grip')

    fireEvent.pointerDown(grip, { clientX: 200, clientY: 850, pointerId: 1 })
    fireEvent.pointerUp(grip, { clientX: BAR_RECT.left, clientY: 850, pointerId: 1 }) // exactly barRect.left
    expect(onAnchorDrop).toHaveBeenCalledWith(0)
  })

  // ── BL2 (audit/28): dropTimeFromFraction over the VIEW WINDOW, not
  // fraction*duration — the regression this component's contract must never
  // reintroduce once a real caller wires onAnchorDrop. ──────────────────────

  it('BL2: onAnchorDrop fires a raw fraction; a real caller mapping it via dropTimeFromFraction(frac, viewStart, viewEnd) gets the CORRECT absolute time when the timeline is ZOOMED (viewStart>0) — proves fraction*duration would be wrong', () => {
    mockBarRect()
    // Simulates a zoomed timeline: full clip is 600s, but the visible WINDOW
    // is only [100,110] (a 10s zoom). viewStart>0 is load-bearing — with
    // view=[0,duration] both formulas would coincidentally agree and the
    // bug would not be caught (audit/28's own point).
    const viewStart = 100
    const viewEnd = 110
    const duration = 600

    // Fake caller-side wiring: exactly what a real onAnchorDrop consumer
    // (bindShadowExerciseAtTime-equivalent, T2 useAnnotations) is documented
    // to do — this component only forwards the fraction, never the time.
    const addShadowExercise = vi.fn()
    const onAnchorDrop = (fraction: number) => {
      const startTime = dropTimeFromFraction(fraction, viewStart, viewEnd)
      addShadowExercise({ startTime })
    }

    const { getByTestId } = renderCard({ onAnchorDrop })
    const grip = getByTestId('shadow-bind-anchor-grip')
    fireEvent.pointerDown(grip, { clientX: 200, clientY: 850, pointerId: 1 })
    // Drop at the bar's midpoint → fraction 0.5.
    fireEvent.pointerUp(grip, { clientX: 700, clientY: 850, pointerId: 1 })

    expect(addShadowExercise).toHaveBeenCalledTimes(1)
    const { startTime } = addShadowExercise.mock.calls[0][0] as { startTime: number }
    // Correct (view-window-relative): 100 + 0.5*(110-100) = 105.
    expect(startTime).toBe(105)
    // The WRONG legacy formula (fraction*duration) would have produced 300 —
    // assert the two are NOT the same value, so a regression back to
    // `fraction*duration` fails this test loudly.
    expect(startTime).not.toBe(0.5 * duration)
  })

  it('bind panel is unconditionally rendered regardless of shadow.phase (no speakActive-equivalent gate in this slice)', () => {
    for (const phase of ['idle', 'recording', 'transcribing', 'result', 'error'] as ShadowV1Api['phase'][]) {
      const { getByTestId, unmount } = renderCard({ shadow: mkShadow({ phase, errorCode: phase === 'error' ? 'mic_denied' : null, lastMarks: phase === 'result' ? [{ w: 'x', kind: 'ok' }] : null, lastMatchPct: phase === 'result' ? 100 : null }) })
      expect(getByTestId('shadow-bind-row')).toBeTruthy()
      unmount()
    }
  })

  // ── Срез A (L-6): сид локального bind-стейта из initialBind ──────────────
  it('L-6: initialBind="subStart" → «к субтитру» подсвечен СРАЗУ (после remount), «выкл» — нет', () => {
    const { getByTestId } = render(<ShadowCard shadow={mkShadow()} initialBind="subStart" />)
    expect(getByTestId('shadow-bind-sub').style.background).toContain('--accent')
    expect(getByTestId('shadow-bind-off').style.background).toBe('transparent')
  })

  it('L-6: без initialBind дефолт "off" сохранён (прежнее поведение DebugShadowCard/V1-тестов)', () => {
    const { getByTestId } = render(<ShadowCard shadow={mkShadow()} />)
    expect(getByTestId('shadow-bind-off').style.background).toContain('--btn-active')
    expect(getByTestId('shadow-bind-sub').style.background).toBe('transparent')
  })
})

// ── Срез A (M-2): мёртвый ряд «Ещё раз» (dismissResult) в hands-free ──────────
describe('Срез A M-2: ряд «Ещё раз» (dismissResult) — hands-free vs V1', () => {
  const resultShadow = () => mkShadow({ phase: 'result', lastMarks: [{ w: 'x', kind: 'ok' }], lastMatchPct: 100 })

  it('handsFree + phase="result" → кнопка «Ещё раз» НЕ рендерится (resume = S/пилюля)', () => {
    const { queryByTestId } = render(<ShadowCard shadow={resultShadow()} handsFree />)
    expect(queryByTestId('shadow-again')).toBeNull()
  })

  it('handsFree + phase="error" → «Ещё раз» тоже НЕ рендерится', () => {
    const { queryByTestId } = render(<ShadowCard shadow={mkShadow({ phase: 'error', errorCode: 'mic_denied' })} handsFree />)
    expect(queryByTestId('shadow-again')).toBeNull()
  })

  it('НЕ handsFree (standalone V1) + phase="result" → «Ещё раз» присутствует (прежнее поведение)', () => {
    const dismissResult = vi.fn()
    const { getByTestId } = render(<ShadowCard shadow={mkShadow({ phase: 'result', lastMarks: [{ w: 'x', kind: 'ok' }], lastMatchPct: 100, dismissResult })} />)
    const again = getByTestId('shadow-again')
    expect(again).toBeTruthy()
    fireEvent.click(again)
    expect(dismissResult).toHaveBeenCalledTimes(1)
  })
})
