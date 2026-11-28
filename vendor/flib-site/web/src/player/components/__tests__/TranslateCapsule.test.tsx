// TranslateCapsule.test.tsx — [ID:P-subtitle-translate-capsule] кнопка-капсула.
// Покрываем: aria/disabled по busy, onActivate по клику, и ГЛАВНОЕ —
// stopPropagation на всех 4 жестах (клик капсулы не должен пузырить в
// drag/reset/context-menu хоста-плашки).
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TranslateCapsule } from '../TranslateCapsule'

describe('TranslateCapsule', () => {
  it('рендерит доступную кнопку с aria-label', () => {
    render(<TranslateCapsule onActivate={() => {}} />)
    const btn = screen.getByRole('button', { name: 'Перевести эту строку' })
    expect(btn).toBeTruthy()
  })

  it('клик вызывает onActivate', () => {
    const onActivate = vi.fn()
    render(<TranslateCapsule onActivate={onActivate} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onActivate).toHaveBeenCalledTimes(1)
  })

  it('busy → disabled + aria-busy, клик НЕ вызывает onActivate', () => {
    const onActivate = vi.fn()
    render(<TranslateCapsule onActivate={onActivate} busy />)
    const btn = screen.getByRole('button') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    expect(btn.getAttribute('aria-busy')).toBe('true')
    fireEvent.click(btn)
    expect(onActivate).not.toHaveBeenCalled()
  })

  it('НЕ busy → нет aria-busy, кнопка активна', () => {
    render(<TranslateCapsule onActivate={() => {}} />)
    const btn = screen.getByRole('button') as HTMLButtonElement
    expect(btn.disabled).toBe(false)
    expect(btn.getAttribute('aria-busy')).toBeNull()
  })

  it('stopPropagation: click/mousedown/dblclick/contextmenu НЕ пузырят в хост', () => {
    const hostClick = vi.fn()
    const hostMouseDown = vi.fn()
    const hostDblClick = vi.fn()
    const hostCtx = vi.fn()
    const onActivate = vi.fn()
    render(
      <div
        onClick={hostClick}
        onMouseDown={hostMouseDown}
        onDoubleClick={hostDblClick}
        onContextMenu={hostCtx}
      >
        <TranslateCapsule onActivate={onActivate} />
      </div>,
    )
    const btn = screen.getByRole('button')
    fireEvent.click(btn)
    fireEvent.mouseDown(btn)
    fireEvent.doubleClick(btn)
    fireEvent.contextMenu(btn)
    // onActivate сработал (клик по капсуле легитимен), а хост-хендлеры — НЕТ.
    expect(onActivate).toHaveBeenCalledTimes(1)
    expect(hostClick).not.toHaveBeenCalled()
    expect(hostMouseDown).not.toHaveBeenCalled()
    expect(hostDblClick).not.toHaveBeenCalled()
    expect(hostCtx).not.toHaveBeenCalled()
  })
})
