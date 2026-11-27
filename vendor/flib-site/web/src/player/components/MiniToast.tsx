// web/src/player/components/MiniToast.tsx
import { useCallback, useRef, useState } from 'react'

export function useMiniToast() {
  const [msg, setMsg] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const show = useCallback((text: string) => {
    setMsg(text)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setMsg(null), 1800)
  }, [])
  return { msg, show }
}

export function MiniToast({ msg }: { msg: string | null }) {
  if (!msg) return null
  return (
    <div className="mini-toast" role="status" data-testid="mini-toast">{msg}</div>
  )
}
