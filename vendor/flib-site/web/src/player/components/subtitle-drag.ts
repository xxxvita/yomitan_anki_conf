// subtitle-drag.ts — shared drag-to-reposition + localStorage persistence
// for the two independent subtitle plates (L2 English / L1 Russian).
// Ported from the desktop SubtitleOverlay/SubtitleL1Overlay drag protocol:
// live DOM writes during drag (no re-render until mouseup), commit-on-mouseup,
// double-click reset. Each plate gets its own storage key so L2 and L1 can be
// dragged to different spots on screen independently.
import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react'

export type SubtitleMode = 'l2' | 'l2l1' | 'hidden'

export interface SubtitlePosition {
  anchored: 'free' | 'bottom'
  x: number
  y: number
}

export const DRAG_THRESHOLD = 6

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val))
}

function loadPosition(key: string, fallback: SubtitlePosition): SubtitlePosition {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<SubtitlePosition>
    if (
      (parsed.anchored === 'free' || parsed.anchored === 'bottom') &&
      typeof parsed.x === 'number' &&
      typeof parsed.y === 'number'
    ) {
      return { anchored: parsed.anchored, x: parsed.x, y: parsed.y }
    }
  } catch {
    /* corrupt JSON or storage unavailable — fall back to default */
  }
  return fallback
}

function savePosition(key: string, pos: SubtitlePosition): void {
  try {
    localStorage.setItem(key, JSON.stringify(pos))
  } catch {
    /* quota exceeded / storage denied — position just won't persist */
  }
}

/**
 * Drag state + position persistence for one subtitle plate. `bottomPct` is
 * the CSS `bottom` value used while the plate is in its default anchored
 * ('bottom') mode; dragging switches it to 'free' (percentage x/y of the
 * parent) until double-click resets it back to `defaultPosition`.
 */
export function useDraggablePosition(storageKey: string, defaultPosition: SubtitlePosition, bottomPct: string) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<SubtitlePosition>(() => loadPosition(storageKey, defaultPosition))
  const [dragging, setDragging] = useState(false)
  const livePosRef = useRef<SubtitlePosition>(position)
  const dragRef = useRef<{ startX: number; startY: number; started: boolean } | null>(null)

  // Keep the live ref synced with committed state unless a drag is in flight
  // (mid-drag the ref is the source of truth, applied straight to the DOM).
  useEffect(() => {
    if (!dragRef.current?.started) livePosRef.current = position
  }, [position])

  const applyPositionToDOM = useCallback((pos: SubtitlePosition) => {
    const el = containerRef.current
    if (!el) return
    if (pos.anchored === 'free') {
      el.style.left = `${pos.x}%`
      el.style.top = `${pos.y}%`
      el.style.bottom = 'auto'
      el.style.transform = 'translate(-50%, -50%)'
    } else {
      el.style.left = '50%'
      el.style.top = ''
      el.style.bottom = bottomPct
      el.style.transform = 'translateX(-50%)'
    }
  }, [bottomPct])

  const handleMouseDown = useCallback((e: ReactMouseEvent) => {
    if (e.button !== 0) return
    dragRef.current = { startX: e.clientX, startY: e.clientY, started: false }
  }, [])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const drag = dragRef.current
      if (!drag) return
      const dx = e.clientX - drag.startX
      const dy = e.clientY - drag.startY

      if (!drag.started) {
        if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return
        drag.started = true
        setDragging(true)

        // Switching out of anchored mode: convert the plate's current pixel
        // position to percentages so the first drag frame doesn't jump.
        if (livePosRef.current.anchored === 'bottom') {
          const el = containerRef.current
          const parent = el?.parentElement
          if (el && parent) {
            const elRect = el.getBoundingClientRect()
            const parentRect = parent.getBoundingClientRect()
            const centerX = ((elRect.left + elRect.width / 2 - parentRect.left) / parentRect.width) * 100
            const centerY = ((elRect.top + elRect.height / 2 - parentRect.top) / parentRect.height) * 100
            livePosRef.current = { x: centerX, y: centerY, anchored: 'free' }
            applyPositionToDOM(livePosRef.current)
            drag.startX = e.clientX
            drag.startY = e.clientY
            return
          }
        }
      }

      const parent = containerRef.current?.parentElement
      if (!parent) return
      const parentRect = parent.getBoundingClientRect()
      const dxPct = (dx / parentRect.width) * 100
      const dyPct = (dy / parentRect.height) * 100
      const pos = livePosRef.current
      const newX = clamp(pos.x + dxPct, 5, 95)
      const newY = clamp(pos.y + dyPct, 5, 95)
      livePosRef.current = { x: newX, y: newY, anchored: 'free' }
      applyPositionToDOM(livePosRef.current)
      drag.startX = e.clientX
      drag.startY = e.clientY
    }

    const handleMouseUp = () => {
      if (dragRef.current?.started) {
        setDragging(false)
        // Commit final position to React state + localStorage (only on drop,
        // not on every mousemove).
        setPosition(livePosRef.current)
        savePosition(storageKey, livePosRef.current)
      }
      dragRef.current = null
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [applyPositionToDOM, storageKey])

  const handleDoubleClick = useCallback((e: ReactMouseEvent) => {
    e.preventDefault()
    setPosition(defaultPosition)
    savePosition(storageKey, defaultPosition)
  }, [defaultPosition, storageKey])

  const style: CSSProperties = position.anchored === 'free'
    ? { position: 'absolute', left: `${position.x}%`, top: `${position.y}%`, transform: 'translate(-50%, -50%)' }
    : { position: 'absolute', left: '50%', bottom: bottomPct, transform: 'translateX(-50%)' }

  return { containerRef, style, dragging, handleMouseDown, handleDoubleClick }
}
