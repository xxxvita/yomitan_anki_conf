// TranslateMenu.test.tsx — ПКМ-меню перевода: портал, закрытие по Esc/outside,
// клик по пункту, disabled-гейт.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { TranslateMenu } from '../TranslateMenu'

afterEach(cleanup)

describe('TranslateMenu', () => {
  it('renders nothing when state is null', () => {
    render(<TranslateMenu state={null} label="Перевести блок" onTranslate={() => {}} onClose={() => {}} />)
    expect(screen.queryByTestId('translate-menu')).toBeNull()
  })

  it('renders the labelled item (portaled to document.body)', () => {
    render(<TranslateMenu state={{ x: 10, y: 10, cueIndex: 3 }} label="Перевести блок" onTranslate={() => {}} onClose={() => {}} />)
    const item = screen.getByTestId('translate-menu-item')
    expect(item.textContent).toBe('Перевести блок')
    // portal target is document.body, not the render container
    expect(document.body.contains(item)).toBe(true)
  })

  it('clicking the item calls onTranslate(cueIndex) then onClose', () => {
    const onTranslate = vi.fn()
    const onClose = vi.fn()
    render(<TranslateMenu state={{ x: 0, y: 0, cueIndex: 5 }} label="Перевести блоки субтитров" onTranslate={onTranslate} onClose={onClose} />)
    fireEvent.click(screen.getByTestId('translate-menu-item'))
    expect(onTranslate).toHaveBeenCalledWith(5)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('disabled item does not fire onTranslate', () => {
    const onTranslate = vi.fn()
    render(<TranslateMenu state={{ x: 0, y: 0, cueIndex: 1 }} label="Перевести блок" disabled onTranslate={onTranslate} onClose={() => {}} />)
    fireEvent.click(screen.getByTestId('translate-menu-item'))
    expect(onTranslate).not.toHaveBeenCalled()
  })

  it('Escape closes the menu', () => {
    const onClose = vi.fn()
    render(<TranslateMenu state={{ x: 0, y: 0, cueIndex: 0 }} label="x" onTranslate={() => {}} onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('outside pointerdown closes; pointerdown inside does not', () => {
    const onClose = vi.fn()
    render(<TranslateMenu state={{ x: 0, y: 0, cueIndex: 0 }} label="x" onTranslate={() => {}} onClose={onClose} />)
    fireEvent.pointerDown(screen.getByTestId('translate-menu-item')) // inside
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.pointerDown(document.body) // outside
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
