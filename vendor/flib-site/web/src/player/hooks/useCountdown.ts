// web/src/player/hooks/useCountdown.ts
// Порт verbatim из electron/renderer/.../hooks/useCountdown.ts.
// Транспорт-агностичный: только setTimeout, драйвит CountdownOverlay.
import { useCallback, useEffect, useRef, useState } from 'react'

export function useCountdown() {
  const [value, setValue] = useState<number | null>(null)
  const timerRef = useRef<number | null>(null)
  const doneRef = useRef<(() => void) | null>(null)

  const cancel = useCallback(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    doneRef.current = null
    setValue(null)
  }, [])

  const start = useCallback((from: number, onComplete: () => void) => {
    if (timerRef.current != null) clearTimeout(timerRef.current)
    doneRef.current = onComplete
    setValue(from)
    let n = from
    const tick = () => {
      n -= 1
      if (n <= 0) {
        timerRef.current = null
        setValue(null)
        const done = doneRef.current
        doneRef.current = null
        done?.()
      } else {
        setValue(n)
        timerRef.current = window.setTimeout(tick, 1000)
      }
    }
    timerRef.current = window.setTimeout(tick, 1000)
  }, [])

  // Unmount cleanup: погасить висящий setTimeout, чтобы отсчёт не выстрелил
  // resume()/play() на уже уничтоженном адаптере после ухода со страницы (M1).
  useEffect(() => () => {
    if (timerRef.current != null) clearTimeout(timerRef.current)
  }, [])

  return { value, start, cancel }
}
