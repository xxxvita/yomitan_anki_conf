import { it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { useClearSelectionOutsidePlates } from '../useClearSelectionOutsidePlates'

function Harness() {
  useClearSelectionOutsidePlates()
  return (
    <div>
      <div className="subtitle-overlay"><span data-testid="inside">word</span></div>
      <div data-testid="outside">timeline</div>
    </div>
  )
}

it('clears selection on mousedown outside the plates', () => {
  const removeAllRanges = vi.fn()
  vi.spyOn(window, 'getSelection').mockReturnValue({ isCollapsed: false, removeAllRanges } as any)
  const { getByTestId } = render(<Harness />)
  fireEvent.mouseDown(getByTestId('outside'))
  expect(removeAllRanges).toHaveBeenCalledTimes(1)
})

it('does NOT clear when mousedown lands inside a subtitle plate', () => {
  const removeAllRanges = vi.fn()
  vi.spyOn(window, 'getSelection').mockReturnValue({ isCollapsed: false, removeAllRanges } as any)
  const { getByTestId } = render(<Harness />)
  fireEvent.mouseDown(getByTestId('inside'))
  expect(removeAllRanges).not.toHaveBeenCalled()
})

it('clears selection and removes iframe focus on window blur with iframe focused', async () => {
  vi.useFakeTimers()
  const removeAllRanges = vi.fn()
  vi.spyOn(window, 'getSelection').mockReturnValue({ isCollapsed: false, removeAllRanges } as any)

  function HarnessWithIframe() {
    useClearSelectionOutsidePlates()
    return (
      <div>
        <iframe data-testid="yt" />
        <div className="subtitle-overlay"><span>word</span></div>
      </div>
    )
  }

  const { getByTestId } = render(<HarnessWithIframe />)
  const iframe = getByTestId('yt')

  // Focus the iframe
  iframe.focus()
  expect(document.activeElement).toBe(iframe)

  // Trigger window blur
  fireEvent.blur(window)

  // Run pending timers
  vi.runAllTimers()

  // Verify: removeAllRanges was called AND iframe is no longer focused
  expect(removeAllRanges).toHaveBeenCalledTimes(1)
  expect(document.activeElement).not.toBe(iframe)

  vi.useRealTimers()
})

it('does NOT clear on window blur when activeElement is NOT an iframe', async () => {
  vi.useFakeTimers()
  const removeAllRanges = vi.fn()
  vi.spyOn(window, 'getSelection').mockReturnValue({ isCollapsed: false, removeAllRanges } as any)

  render(<Harness />)

  // Trigger window blur without iframe focus
  fireEvent.blur(window)

  // Run pending timers
  vi.runAllTimers()

  // Verify: removeAllRanges was NOT called
  expect(removeAllRanges).not.toHaveBeenCalled()

  vi.useRealTimers()
})
