// ShadowHoldOverlay.test.tsx — T3 (hold-render): RTL coverage for item 6
// (hold-state visible during hold; a filtered-out/null verdictOutcome —
// i.e. what useShadowRuntime produces for a stale-by-exerciseId event,
// see hold-render.test.ts + useShadowRuntime.hold-seam.test.ts's carry
// T-ANS/F3 case — renders no verdict slot).
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ShadowHoldOverlay } from '../ShadowHoldOverlay'
import { setLocale } from '../../i18n'
import type { AnswerOutcomeEvent } from '../../workspace/answer-source'

afterEach(() => { setLocale('ru') })

describe('ShadowHoldOverlay — T3 render', () => {
  it('holding=true renders the hold-state banner (RU copy)', () => {
    render(<ShadowHoldOverlay holding={true} evalVisible={false} />)
    expect(screen.getByTestId('shadow-hold-state')).toBeTruthy()
    expect(screen.getByText('Стоп — повторите фразу, чтобы продолжить')).toBeTruthy()
  })

  it('holding=false renders no hold-state banner', () => {
    render(<ShadowHoldOverlay holding={false} evalVisible={false} />)
    expect(screen.queryByTestId('shadow-hold-state')).toBeNull()
  })

  it('takes the language via useLocale (EN copy on setLocale("en"))', () => {
    setLocale('en')
    render(<ShadowHoldOverlay holding={true} evalVisible={false} />)
    expect(screen.getByText('Paused — say the line again to continue')).toBeTruthy()
  })

  it('evalVisible=true shows the (lifted, T-A) AwaitingEvaluationOverlay Analyzing state', () => {
    render(<ShadowHoldOverlay holding={false} evalVisible={true} />)
    expect(screen.getByText('Анализ ответа…')).toBeTruthy()
  })

  it('evalVisible=false shows no AwaitingEvaluationOverlay', () => {
    render(<ShadowHoldOverlay holding={false} evalVisible={false} />)
    expect(screen.queryByText('Анализ ответа…')).toBeNull()
  })

  it('a matching (non-stale) verdictOutcome renders the T7 placeholder slot', () => {
    const outcome: AnswerOutcomeEvent = { exerciseId: 'ex1', outcome: { status: 'final', text: 'hi' } }
    render(<ShadowHoldOverlay holding={false} evalVisible={false} verdictOutcome={outcome} />)
    expect(screen.getByTestId('shadow-verdict-slot').textContent).toBe('final')
  })

  it('verdictOutcome=null (stale event filtered upstream — carry T-ANS/F3) renders no verdict slot', () => {
    render(<ShadowHoldOverlay holding={false} evalVisible={false} verdictOutcome={null} />)
    expect(screen.queryByTestId('shadow-verdict-slot')).toBeNull()
  })

  // ТЗ №3 п.6 — regression: the verdict slot MUST be absolutely positioned
  // (overlaying the video), not an in-flow block that collapses to the stage's
  // top-left corner (the "Нет ответа" upper-left bug, Screenshot 155441).
  it('the verdict slot is absolutely positioned over the video (not in normal flow)', () => {
    const outcome: AnswerOutcomeEvent = { exerciseId: 'ex1', outcome: { status: 'no-response', reason: 'no-audio' } }
    render(<ShadowHoldOverlay holding={false} evalVisible={false} verdictOutcome={outcome} verdictTargetSnapshot="hi" />)
    const slot = screen.getByTestId('shadow-verdict-slot') as HTMLElement
    expect(slot.style.position).toBe('absolute')
    expect(slot.style.left).toBe('50%')
    expect(slot.style.transform).toContain('translateX(-50%)')
  })
})

// T7c — real B1 notation, additive coverage. These all pass the NEW
// `verdictTargetSnapshot` prop; none of the T3-era tests above do, so this
// describe block cannot regress them (see the component's own back-compat
// branch doc).
describe('ShadowHoldOverlay — T7c real verdict notation (verdictTargetSnapshot)', () => {
  it('final outcome + snapshot renders the real B1 grid (word-diff against the snapshot, not against outcome.text alone)', () => {
    const outcome: AnswerOutcomeEvent = { exerciseId: 'ex1', outcome: { status: 'final', text: 'I love coffee' } }
    render(<ShadowHoldOverlay holding={false} evalVisible={false} verdictOutcome={outcome} verdictTargetSnapshot="I like coffee" />)
    const slot = screen.getByTestId('shadow-verdict-slot')
    expect(slot.querySelector('[data-testid="shadow-verdict-notation"]')).toBeTruthy()
    expect(slot.textContent).toContain('love') // spoken word shown
    expect(slot.textContent).toContain('like') // expected (ref) word shown
  })

  it('non-final (partial) outcome + snapshot renders freeze-glyphs grey partial, no word-diff', () => {
    const outcome: AnswerOutcomeEvent = { exerciseId: 'ex1', outcome: { status: 'non-final', partial: 'I lo' } }
    render(<ShadowHoldOverlay holding={false} evalVisible={false} verdictOutcome={outcome} verdictTargetSnapshot="I love coffee" />)
    const partial = screen.getByTestId('shadow-verdict-partial')
    expect(partial.textContent).toBe('I lo')
    expect(screen.queryByTestId('shadow-verdict-notation')).toBeNull()
  })

  it('no-response / error outcomes render a localized diagnosis line, not the raw status word', () => {
    const noResponse: AnswerOutcomeEvent = { exerciseId: 'ex1', outcome: { status: 'no-response', reason: 'no-audio' } }
    const { unmount } = render(<ShadowHoldOverlay holding={false} evalVisible={false} verdictOutcome={noResponse} verdictTargetSnapshot="I love coffee" />)
    expect(screen.getByTestId('shadow-verdict-slot').textContent).toBe('Мы Вас не услышали')
    unmount()

    const error: AnswerOutcomeEvent = { exerciseId: 'ex1', outcome: { status: 'error', reason: 'boom' } }
    render(<ShadowHoldOverlay holding={false} evalVisible={false} verdictOutcome={error} verdictTargetSnapshot="I love coffee" />)
    expect(screen.getByTestId('shadow-verdict-slot').textContent).toBe('Не удалось разобрать ответ')
  })

  it('freeze-glyphs: committed paints ONCE — a later re-render with a CHANGED snapshot for the SAME exerciseId does not recolor', () => {
    const outcome: AnswerOutcomeEvent = { exerciseId: 'ex1', outcome: { status: 'final', text: 'I love coffee' } }
    const { rerender, getByTestId } = render(
      <ShadowHoldOverlay holding={false} evalVisible={false} verdictOutcome={outcome} verdictTargetSnapshot="I love coffee" />,
    )
    const firstHtml = getByTestId('shadow-verdict-notation').innerHTML
    // Same exerciseId, but the "live" target supposedly changed underneath
    // (new subtitle/A-B/customText) — must NOT repaint against it.
    rerender(
      <ShadowHoldOverlay holding={false} evalVisible={false} verdictOutcome={outcome} verdictTargetSnapshot="totally different reference text" />,
    )
    expect(getByTestId('shadow-verdict-notation').innerHTML).toBe(firstHtml)
  })

  // T7-fix (5-timeout, MED CONFIRMED) — a `timeout` outcome without any
  // partial text (or a `final` outcome against an empty target snapshot)
  // must render an explicit "no answer" diagnosis, never an empty/blank
  // verdict slot (empty ShadowVerdictPartial / empty ShadowVerdictNotation
  // grid).
  it('timeout with NO partial renders the explicit "no answer" diagnosis, not an empty partial line', () => {
    const outcome: AnswerOutcomeEvent = { exerciseId: 'ex1', outcome: { status: 'timeout' } }
    render(<ShadowHoldOverlay holding={false} evalVisible={false} verdictOutcome={outcome} verdictTargetSnapshot="I love coffee" />)
    const slot = screen.getByTestId('shadow-verdict-slot')
    expect(slot.textContent).toBe('Нет ответа')
    expect(screen.queryByTestId('shadow-verdict-partial')).toBeNull()
  })

  it('timeout with an empty-string partial ALSO renders "no answer" (not a blank partial line)', () => {
    const outcome: AnswerOutcomeEvent = { exerciseId: 'ex1', outcome: { status: 'timeout', partial: '   ' } }
    render(<ShadowHoldOverlay holding={false} evalVisible={false} verdictOutcome={outcome} verdictTargetSnapshot="I love coffee" />)
    expect(screen.getByTestId('shadow-verdict-slot').textContent).toBe('Нет ответа')
    expect(screen.queryByTestId('shadow-verdict-partial')).toBeNull()
  })

  it('final outcome against an EMPTY target snapshot renders "no answer", not an empty grid', () => {
    const outcome: AnswerOutcomeEvent = { exerciseId: 'ex1', outcome: { status: 'final', text: 'I love coffee' } }
    render(<ShadowHoldOverlay holding={false} evalVisible={false} verdictOutcome={outcome} verdictTargetSnapshot="" />)
    const slot = screen.getByTestId('shadow-verdict-slot')
    expect(slot.textContent).toBe('Нет ответа')
    expect(screen.queryByTestId('shadow-verdict-notation')).toBeNull()
  })

  it('a NEW exerciseId (fresh attempt) DOES repaint against its own snapshot', () => {
    const outcome1: AnswerOutcomeEvent = { exerciseId: 'ex1', outcome: { status: 'final', text: 'I love coffee' } }
    const outcome2: AnswerOutcomeEvent = { exerciseId: 'ex2', outcome: { status: 'final', text: 'I want tea' } }
    const { rerender, getByTestId } = render(
      <ShadowHoldOverlay holding={false} evalVisible={false} verdictOutcome={outcome1} verdictTargetSnapshot="I love coffee" />,
    )
    expect(getByTestId('shadow-verdict-notation').textContent).toContain('coffee')
    rerender(
      <ShadowHoldOverlay holding={false} evalVisible={false} verdictOutcome={outcome2} verdictTargetSnapshot="I want tea" />,
    )
    expect(getByTestId('shadow-verdict-notation').textContent).toContain('tea')
  })
})
