// RegionMenu.tsx — custom right-click popup for mute regions (Ф3).
// Owner 3:53-4:19: ПКМ по mute-области → мини-меню (Удалить / Вкл-выкл). No
// window.confirm (repo has no popup precedent — this is it). Closes on
// outside-click or Esc. Fixed-positioned at the cursor; pointer-events own.
import { useEffect, useRef } from 'react'

export interface RegionMenuState { id: string; x: number; y: number; muted: boolean }

export function RegionMenu({ state, onToggle, onDelete, onClose }: {
  state: RegionMenuState | null
  onToggle: (id: string) => void
  onDelete: (id: string) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!state) return
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose() }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    // pointerdown (not click) so the same gesture that opens elsewhere closes here.
    document.addEventListener('pointerdown', onDoc, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onDoc, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [state, onClose])

  if (!state) return null
  // M-c: clamp so the menu never renders past the right/bottom viewport edge
  // (cursor near the edge would otherwise push it off-screen and unclickable).
  const left = Math.min(state.x, window.innerWidth - 180)
  const top = Math.min(state.y, window.innerHeight - 96)
  return (
    <div
      ref={ref}
      className="region-menu"
      data-testid="region-menu"
      role="menu"
      style={{ position: 'fixed', top, left, zIndex: 300 }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button
        type="button" role="menuitem" className="region-menu-item"
        data-testid="region-menu-toggle"
        onClick={() => { onToggle(state.id); onClose() }}
      >{state.muted ? 'Выключить (снять mute)' : 'Включить (mute)'}</button>
      <button
        type="button" role="menuitem" className="region-menu-item region-menu-danger"
        data-testid="region-menu-delete"
        onClick={() => { onDelete(state.id); onClose() }}
      >Удалить</button>
    </div>
  )
}
