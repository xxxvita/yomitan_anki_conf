// SubtitleL1Overlay.test.tsx — L1 (Russian) plate, independent of L2
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { SubtitleL1Overlay } from '../SubtitleL1Overlay'
import type { Cue } from '../../hooks/useSubtitles'

const cues: Cue[] = [
  { start: 0, end: 2, text_en: 'Hello', text_ru: 'Привет' },
]

describe('SubtitleL1Overlay', () => {
  it('mode=l2l1, activeIndex=0 renders text_ru', () => {
    const { container } = render(<SubtitleL1Overlay cues={cues} activeIndex={0} mode="l2l1" />)
    expect(container.textContent).toContain('Привет')
  })

  it('mode=l2 does not render (L1 only shows alongside L2 in l2l1 mode)', () => {
    const { container } = render(<SubtitleL1Overlay cues={cues} activeIndex={0} mode="l2" />)
    expect(container.firstChild).toBeNull()
  })

  it('mode=hidden renders nothing', () => {
    const { container } = render(<SubtitleL1Overlay cues={cues} activeIndex={0} mode="hidden" />)
    expect(container.firstChild).toBeNull()
  })

  // [ID:P-subtitle-translate-capsule] капсула раскрывает RU в l2 БЕЗ смены режима.
  it('mode=l2, строка в revealedByIndex → RU ВИДЕН (капсульное раскрытие)', () => {
    const ru = { 0: 'Привет-он-деманд' }
    const { container } = render(
      <SubtitleL1Overlay cues={[{ start: 0, end: 2, text_en: 'Hello', text_ru: '' }]}
        activeIndex={0} mode="l2" ruByIndex={ru} revealedByIndex={new Set([0])} />,
    )
    expect(container.textContent).toContain('Привет-он-деманд')
  })

  it('mode=l2, ruByIndex ЕСТЬ но revealedByIndex ПУСТ → скрыто (пилюльный перевод не всплывает в l2)', () => {
    const { container } = render(
      <SubtitleL1Overlay cues={[{ start: 0, end: 2, text_en: 'Hello', text_ru: '' }]}
        activeIndex={0} mode="l2" ruByIndex={{ 0: 'диапазонный' }} revealedByIndex={new Set()} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('mode=hidden + revealed → всё равно скрыто', () => {
    const { container } = render(
      <SubtitleL1Overlay cues={cues} activeIndex={0} mode="hidden"
        ruByIndex={{ 0: 'x' }} revealedByIndex={new Set([0])} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('activeIndex=-1 renders nothing', () => {
    const { container } = render(<SubtitleL1Overlay cues={cues} activeIndex={-1} mode="l2l1" />)
    expect(container.firstChild).toBeNull()
  })
})
