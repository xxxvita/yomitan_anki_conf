// Клавиши экранов теста: слушатель на window, по e.code (не зависит от раскладки: 1/2/R на русской тоже).
// Автоповтор, модификаторы, поля ввода и выпадающие списки — мимо. Хуком пользуются только экраны
// задания и истории: когда страница на другом экране, слушателя нет вовсе.
import { useEffect, useRef } from 'react'

export function useKeys(handler: (e: KeyboardEvent) => void, active = true): void {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => {
    if (!active) return
    const on = (e: KeyboardEvent) => {
      if (e.repeat || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      ref.current(e)
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [active])
}

/** Номер варианта 1..9 из Digit/Numpad; иначе 0. */
export function digitOf(e: KeyboardEvent): number {
  const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code)
  return m ? Number(m[1]) : 0
}
