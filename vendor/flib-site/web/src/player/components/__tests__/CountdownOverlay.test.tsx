// web/src/player/components/__tests__/CountdownOverlay.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { CountdownOverlay } from '../CountdownOverlay'

describe('CountdownOverlay', () => {
  it('renders nothing when value is null', () => {
    const { container } = render(<CountdownOverlay value={null} />)
    expect(container.firstChild).toBeNull()
  })
  it('shows the digit and reveals STOP on hover → onStop', () => {
    const onStop = vi.fn()
    const { getByText, getByTestId } = render(<CountdownOverlay value={2} onStop={onStop} />)
    expect(getByText('2')).toBeTruthy()
    fireEvent.mouseEnter(getByTestId('countdown-ring')) // data-testid надёжнее [style*="168"]
    fireEvent.click(getByTestId('countdown-stop'))
    expect(onStop).toHaveBeenCalledTimes(1)
  })
})
