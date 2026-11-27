// WordPopup.test.tsx — T1a popup: word + explanation stub + 2 buttons
// (docs/contract-2026-07-15-examples-by-word.md, раздел "Фронт (web/src)").
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WordPopup } from '../WordPopup'

describe('WordPopup', () => {
  it('renders the word, an explanation stub, and exactly 2 example buttons', () => {
    render(
      <WordPopup
        word="controlled"
        position={{ x: 10, y: 20 }}
        onExamples={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByTestId('word-popup-word').textContent).toBe('controlled')
    expect(screen.getByText('Пояснение скоро')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Примеры YouTube' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Учебные примеры из фильмов' })).toBeTruthy()
  })

  it('clicking "Примеры YouTube" calls onExamples("youtube")', () => {
    const onExamples = vi.fn()
    render(<WordPopup word="controlled" position={{ x: 0, y: 0 }} onExamples={onExamples} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Примеры YouTube' }))
    expect(onExamples).toHaveBeenCalledWith('youtube')
  })

  it('clicking "Учебные примеры из фильмов" calls onExamples("film")', () => {
    const onExamples = vi.fn()
    render(<WordPopup word="controlled" position={{ x: 0, y: 0 }} onExamples={onExamples} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Учебные примеры из фильмов' }))
    expect(onExamples).toHaveBeenCalledWith('film')
  })

  it('clicking the close button calls onClose', () => {
    const onClose = vi.fn()
    render(<WordPopup word="controlled" position={{ x: 0, y: 0 }} onExamples={vi.fn()} onClose={onClose} />)
    fireEvent.click(screen.getByLabelText('Закрыть'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('clicking the backdrop (outside the popup) calls onClose', () => {
    const onClose = vi.fn()
    render(<WordPopup word="controlled" position={{ x: 0, y: 0 }} onExamples={vi.fn()} onClose={onClose} />)
    fireEvent.click(screen.getByTestId('word-popup-backdrop'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('clicking inside the popup body does not bubble to the backdrop (stopPropagation)', () => {
    const onClose = vi.fn()
    render(<WordPopup word="controlled" position={{ x: 0, y: 0 }} onExamples={vi.fn()} onClose={onClose} />)
    fireEvent.click(screen.getByTestId('word-popup'))
    expect(onClose).not.toHaveBeenCalled()
  })
})
