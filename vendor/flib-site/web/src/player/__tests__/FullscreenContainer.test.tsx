import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { createRef } from 'react'
import { FullscreenContainer, type FullscreenHandle } from '../components/FullscreenContainer'

describe('FullscreenContainer', () => {
  it('imperative toggleFullscreen requests FS on the OUTER container (wraps children)', () => {
    const rfs = vi.fn(() => Promise.resolve())
    HTMLElement.prototype.requestFullscreen = rfs
    const ref = createRef<FullscreenHandle>()
    const { getByTestId } = render(
      <FullscreenContainer ref={ref}><div data-testid="child" /></FullscreenContainer>
    )
    ref.current!.toggleFullscreen()
    expect(rfs).toHaveBeenCalled()
    const outer = getByTestId('fs-root')
    expect(outer.contains(getByTestId('child'))).toBe(true) // FS-элемент содержит стек
  })
})
