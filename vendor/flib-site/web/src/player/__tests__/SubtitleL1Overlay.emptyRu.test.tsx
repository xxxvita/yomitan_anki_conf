import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { SubtitleL1Overlay } from '../components/SubtitleL1Overlay'
import type { Cue } from '../hooks/useSubtitles'

const mk = (text_ru: string): Cue[] => [{ start: 0, end: 2, text_en: 'Hello', text_ru }]

describe('SubtitleL1Overlay — пустой русский текст не рисует плашку', () => {
  it('пустой text_ru и нет ruByIndex — узла нет', () => {
    const { queryByTestId } = render(<SubtitleL1Overlay cues={mk('')} activeIndex={0} mode="l2l1" />)
    expect(queryByTestId('subtitle-l1-overlay')).toBeNull()
  })
  it('только пробелы — узла нет', () => {
    const { queryByTestId } = render(<SubtitleL1Overlay cues={mk('  \n ')} activeIndex={0} mode="l2l1" ruByIndex={{ 0: '   ' }} />)
    expect(queryByTestId('subtitle-l1-overlay')).toBeNull()
  })
  it('перевод из ruByIndex при пустом text_ru — плашка есть', () => {
    const { getByTestId } = render(<SubtitleL1Overlay cues={mk('')} activeIndex={0} mode="l2l1" ruByIndex={{ 0: 'Привет' }} />)
    expect(getByTestId('subtitle-l1-overlay').textContent).toContain('Привет')
  })
  it('есть text_ru — плашка есть', () => {
    const { getByTestId } = render(<SubtitleL1Overlay cues={mk('Привет')} activeIndex={0} mode="l2l1" />)
    expect(getByTestId('subtitle-l1-overlay').textContent).toContain('Привет')
  })
})
