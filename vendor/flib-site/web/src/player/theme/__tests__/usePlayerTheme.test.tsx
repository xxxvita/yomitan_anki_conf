import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { usePlayerTheme } from '../usePlayerTheme'

function Harness({ showRoot }: { showRoot: boolean }) {
  const { themeRef } = usePlayerTheme()
  // эмуляция late-mount: root появляется только на втором рендере
  return <div>{showRoot ? <div data-testid="root" ref={themeRef} /> : <span>loading</span>}</div>
}

describe('usePlayerTheme (late-mount)', () => {
  it('applies cssVars when the root mounts LATER than the hook first render (callback ref)', () => {
    const { rerender, getByTestId, queryByTestId } = render(<Harness showRoot={false} />)
    expect(queryByTestId('root')).toBeNull() // root ещё не смонтирован
    rerender(<Harness showRoot={true} />)    // late mount → callback-ref срабатывает
    const root = getByTestId('root') as HTMLElement
    expect(root.style.getPropertyValue('--accent')).not.toBe('') // vars применены при attach
  })
})
