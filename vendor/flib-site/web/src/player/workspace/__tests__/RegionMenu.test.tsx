// RegionMenu.test.tsx — pure-component seam test (T5a).
// Covers: null-state renders nothing; delete → onDelete(id) then onClose;
// toggle → onToggle(id) then onClose; Esc closes; outside pointerdown closes,
// inside pointerdown does not.
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { RegionMenu } from '../RegionMenu'

describe('RegionMenu (T5a)', () => {
  it('renders nothing when state is null', () => {
    const { container } = render(
      <RegionMenu state={null} onToggle={() => {}} onDelete={() => {}} onClose={() => {}} />
    )
    expect(container.querySelector('[data-testid="region-menu"]')).toBeNull()
  })

  it('delete click calls onDelete(id) then onClose', () => {
    const onDelete = vi.fn()
    const onClose = vi.fn()
    const { getByTestId } = render(
      <RegionMenu state={{ id: 'r1', x: 10, y: 20, muted: true }}
        onToggle={() => {}} onDelete={onDelete} onClose={onClose} />
    )
    expect(getByTestId('region-menu')).toBeTruthy()
    fireEvent.click(getByTestId('region-menu-delete'))
    expect(onDelete).toHaveBeenCalledWith('r1')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('toggle click calls onToggle(id) then onClose', () => {
    const onToggle = vi.fn()
    const onClose = vi.fn()
    const { getByTestId } = render(
      <RegionMenu state={{ id: 'r2', x: 10, y: 20, muted: false }}
        onToggle={onToggle} onDelete={() => {}} onClose={onClose} />
    )
    fireEvent.click(getByTestId('region-menu-toggle'))
    expect(onToggle).toHaveBeenCalledWith('r2')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Esc closes the menu', () => {
    const onClose = vi.fn()
    render(
      <RegionMenu state={{ id: 'r3', x: 0, y: 0, muted: true }}
        onToggle={() => {}} onDelete={() => {}} onClose={onClose} />
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('outside pointerdown closes; inside pointerdown does not', () => {
    const onClose = vi.fn()
    const { getByTestId } = render(
      <RegionMenu state={{ id: 'r4', x: 0, y: 0, muted: true }}
        onToggle={() => {}} onDelete={() => {}} onClose={onClose} />
    )
    fireEvent.pointerDown(getByTestId('region-menu'))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.pointerDown(document.body)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
