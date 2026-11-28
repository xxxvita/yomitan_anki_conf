// useMediaQuery — живое значение matchMedia(query) (тот же приём, что
// useCoarsePointer: addEventListener с фолбэком на addListener). Без matchMedia
// (старые браузеры, часть тестовых окружений) — false.
import { useEffect, useState } from 'react'

function current(query: string): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches
  } catch {
    return false
  }
}

export function useMediaQuery(query: string): boolean {
  const [on, setOn] = useState(() => current(query))
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(query)
    const onChange = () => setOn(mql.matches)
    onChange()
    if (typeof mql.addEventListener === 'function') mql.addEventListener('change', onChange)
    else if (typeof mql.addListener === 'function') mql.addListener(onChange)
    return () => {
      if (typeof mql.removeEventListener === 'function') mql.removeEventListener('change', onChange)
      else if (typeof mql.removeListener === 'function') mql.removeListener(onChange)
    }
  }, [query])
  return on
}
