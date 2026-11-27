// SubtitleOverlay.test.tsx — L2 (English) plate
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { SubtitleOverlay } from '../components/SubtitleOverlay'
import type { Cue } from '../hooks/useSubtitles'

const cues: Cue[] = [
  { start: 0, end: 2, text_en: 'Hello', text_ru: 'Привет' },
]

describe('SubtitleOverlay (L2)', () => {
  it('mode=l2l1, activeIndex=0 renders text_en', () => {
    const { container } = render(<SubtitleOverlay cues={cues} activeIndex={0} mode="l2l1" />)
    expect(container.textContent).toContain('Hello')
  })

  it('mode=hidden renders nothing', () => {
    const { container } = render(<SubtitleOverlay cues={cues} activeIndex={0} mode="hidden" />)
    expect(container.firstChild).toBeNull()
  })

  it('activeIndex=-1 renders nothing', () => {
    const { container } = render(<SubtitleOverlay cues={cues} activeIndex={-1} mode="l2l1" />)
    expect(container.firstChild).toBeNull()
  })

  it('renders a data-word span with no onClick handler (Yomitan owns word interaction, not us)', () => {
    const { container } = render(<SubtitleOverlay cues={cues} activeIndex={0} mode="l2" />)
    const span = container.querySelector('[data-word]') as HTMLElement
    expect(span).not.toBeNull()
    expect(span.onclick).toBeNull()
    expect(span.onmouseenter).toBeNull()
  })

  // [ID:P-subtitle-translate-capsule]
  it('без onTranslateLine/showCapsule — разметка ПРЕЖНЯЯ (нет капсулы)', () => {
    const { queryByRole } = render(<SubtitleOverlay cues={cues} activeIndex={0} mode="l2" />)
    expect(queryByRole('button', { name: 'Перевести эту строку' })).toBeNull()
  })

  it('с onTranslateLine && showCapsule — капсула в плашке, клик зовёт onTranslateLine', () => {
    const onTranslateLine = vi.fn()
    const { getByRole } = render(
      <SubtitleOverlay cues={cues} activeIndex={0} mode="l2" onTranslateLine={onTranslateLine} showCapsule />,
    )
    fireEvent.click(getByRole('button', { name: 'Перевести эту строку' }))
    expect(onTranslateLine).toHaveBeenCalledTimes(1)
  })

  it('showCapsule=false → капсулы нет', () => {
    const onTranslateLine = vi.fn()
    const { queryByRole } = render(
      <SubtitleOverlay cues={cues} activeIndex={0} mode="l2" onTranslateLine={onTranslateLine} showCapsule={false} />,
    )
    expect(queryByRole('button', { name: 'Перевести эту строку' })).toBeNull()
  })

  it('клик капсулы НЕ пузырит в onPlateContextMenu/word-click плашки (stopPropagation)', () => {
    const onTranslateLine = vi.fn(); const onWordClick = vi.fn()
    const { getByRole } = render(
      <SubtitleOverlay cues={cues} activeIndex={0} mode="l2"
        onTranslateLine={onTranslateLine} showCapsule onWordClick={onWordClick} />,
    )
    fireEvent.mouseDown(getByRole('button', { name: 'Перевести эту строку' }))
    fireEvent.click(getByRole('button', { name: 'Перевести эту строку' }))
    expect(onTranslateLine).toHaveBeenCalledTimes(1)
    expect(onWordClick).not.toHaveBeenCalled()
  })
})
