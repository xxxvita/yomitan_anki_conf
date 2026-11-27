// use-dialog.ts — поведение модального слоя (панель каталога, подробная карточка):
// фокус внутрь при открытии и возврат на прежний элемент при закрытии, Tab не
// выходит за слой, Esc закрывает ТОЛЬКО верхний слой (карточка поверх панели
// закрывается первой). Стек слоёв общий для страницы.
import { useEffect, useRef, type RefObject } from 'react'

const stack: symbol[] = []

// Блокировка прокрутки страницы — общий счётчик: первый слой запоминает значение,
// последний возвращает его. Порядок закрытия (и размонтирование всех сразу) не важен.
let locks = 0
let savedOverflow = ''
function lockScroll(): void {
  if (locks === 0) { savedOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden' }
  locks++
}
function unlockScroll(): void {
  if (locks === 0) return
  locks--
  if (locks === 0) document.body.style.overflow = savedOverflow
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

function focusables(root: HTMLElement): HTMLElement[] {
  // Слои рисуют только видимое: скрытых (display:none) фокусируемых внутри нет.
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
}

export function useDialog(ref: RefObject<HTMLElement | null>, onClose: () => void, opts: { lockScroll?: boolean } = {}): void {
  const close = useRef(onClose)
  close.current = onClose
  const lock = opts.lockScroll !== false // по умолчанию слой блокирует прокрутку страницы
  useEffect(() => {
    const id = Symbol('dialog')
    stack.push(id)
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const root = ref.current
    if (root) {
      // Фокус — на первый элемент слоя; нет такого — на сам слой.
      const first = focusables(root)[0]
      if (first) first.focus(); else { root.tabIndex = -1; root.focus() }
    }
    if (lock) lockScroll()
    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== id) return
      const el = ref.current
      if (e.key === 'Escape') { e.preventDefault(); close.current(); return }
      if (e.key !== 'Tab' || !el) return
      const list = focusables(el)
      if (list.length === 0) { e.preventDefault(); el.focus(); return }
      const a = document.activeElement as HTMLElement | null
      const firstEl = list[0]
      const lastEl = list[list.length - 1]
      if (!a || !el.contains(a)) { e.preventDefault(); (e.shiftKey ? lastEl : firstEl).focus(); return }
      if (e.shiftKey && a === firstEl) { e.preventDefault(); lastEl.focus() }
      else if (!e.shiftKey && a === lastEl) { e.preventDefault(); firstEl.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      const i = stack.indexOf(id)
      if (i >= 0) stack.splice(i, 1)
      if (lock) unlockScroll()
      if (prev && prev.isConnected) prev.focus()
    }
  }, [ref, lock])
}
