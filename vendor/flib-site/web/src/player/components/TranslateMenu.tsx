// TranslateMenu.tsx — [ID:P-subtitle-translate] ПКМ-меню «Перевести блок(и)».
// По образцу RegionMenu.tsx, НО с двумя обязательными отличиями (Fable M4):
//  1) ПОРТАЛ в document.fullscreenElement ?? document.body — панель таймлайна под
//     backdrop-filter создаёт containing-block для position:fixed (меню бы
//     заякорилось к панели, не к вьюпорту), а в фуллскрине body-портал невидим.
//  2) Esc в CAPTURE-фазе с stopPropagation — чтобы bubble-teardown-Esc бара не
//     сработал; закрытие по outside-pointerdown.
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

export interface TranslateMenuState { x: number; y: number; cueIndex: number }

export function TranslateMenu({ state, label, disabled = false, onTranslate, onClose }: {
  state: TranslateMenuState | null
  label: string
  disabled?: boolean
  onTranslate: (cueIndex: number) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!state) return
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose() }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    document.addEventListener('pointerdown', onDoc, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onDoc, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [state, onClose])

  if (!state) return null
  // Кламп, чтобы меню не ушло за правый/нижний край вьюпорта.
  const left = Math.min(state.x, window.innerWidth - 240)
  const top = Math.min(state.y, window.innerHeight - 56)
  const menu = (
    <div
      ref={ref}
      className="region-menu"
      data-testid="translate-menu"
      role="menu"
      style={{ position: 'fixed', top, left, zIndex: 300 }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button
        type="button"
        role="menuitem"
        className="region-menu-item"
        data-testid="translate-menu-item"
        disabled={disabled}
        onClick={() => { onTranslate(state.cueIndex); onClose() }}
      >{label}</button>
    </div>
  )
  const target = (typeof document !== 'undefined' && document.fullscreenElement) || document.body
  return createPortal(menu, target)
}
