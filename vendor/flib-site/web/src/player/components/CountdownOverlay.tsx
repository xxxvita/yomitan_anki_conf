// web/src/player/components/CountdownOverlay.tsx
// Порт из electron/renderer/.../components/CountdownOverlay.tsx.
// Единственное отличие: иконка STOP — inline-SVG (в flib.club нет lucide-react).
// rAF-радар (inline transform), CSS @keyframes избегаются намеренно (застревают
// на 100% при remount цифры). Hover → STOP → onStop (обрыв рестарта лупа).
import React, { useEffect, useRef, useState } from 'react'

const StopSquare = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
    <rect width="12" height="12" fill="#fff" />
  </svg>
)

export const CountdownOverlay: React.FC<{
  value: number | null
  onStop?: () => void
}> = ({ value, onStop }) => {
  const [angle, setAngle] = useState(0)
  const [hovered, setHovered] = useState(false)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (value == null) {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      setHovered(false)
      return
    }
    const t0 = performance.now()
    const loop = (now: number) => {
      setAngle(((now - t0) / 1000 % 1) * 360) // 360°/с, по часовой
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [value])

  if (value == null) return null

  return (
    <div
      style={{
        position: 'absolute', inset: 0, zIndex: 82, pointerEvents: 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.35)',
      }}
    >
      <div
        data-testid="countdown-ring"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{ position: 'relative', width: 168, height: 168, pointerEvents: 'auto' }}
      >
        <div style={{
          position: 'absolute', inset: 0, borderRadius: '50%',
          border: '2px solid var(--accent, #E0B341)', opacity: 0.45,
        }} />
        <div style={{ position: 'absolute', inset: 0, transform: `rotate(${angle}deg)` }}>
          <div style={{
            position: 'absolute', left: '50%', top: '50%', height: 2, width: '50%',
            transformOrigin: 'left center',
            background: 'linear-gradient(90deg, transparent, var(--accent, #E0B341))',
          }} />
        </div>
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 68, fontWeight: 800, lineHeight: 1,
          color: 'var(--fg, #f5f6f8)',
          fontFamily: 'var(--mono-font, "IBM Plex Mono", ui-monospace, monospace)',
          textShadow: '0 2px 12px rgba(0,0,0,0.6)',
          opacity: hovered ? 0.25 : 1,
        }}>
          {value}
        </div>
        {hovered && onStop && (
          <button
            data-testid="countdown-stop"
            onClick={(e) => { e.stopPropagation(); onStop() }}
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              position: 'absolute', left: '50%', top: '50%',
              transform: 'translate(-50%, -50%)',
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '9px 18px', borderRadius: 8,
              background: '#000', color: '#fff',
              border: '1px solid rgba(255,255,255,0.30)',
              fontSize: 13, fontWeight: 800, letterSpacing: 1.5,
              cursor: 'pointer', zIndex: 3,
              fontFamily: 'var(--mono-font, "IBM Plex Mono", ui-monospace, monospace)',
            }}
          >
            <StopSquare /> STOP
          </button>
        )}
      </div>
    </div>
  )
}
