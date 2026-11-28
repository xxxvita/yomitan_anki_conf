import { useCallback, useEffect, useRef, useState } from 'react'

// [ID:P-mobile] — тонкий мобильный control-bar (VideoControlsBar) не должен
// вечно перекрывать видео: показывается по тапу, гаснет через ~3с бездействия
// (владелец: "видео на весь экран, панель — тонкий оверлей по тапу"). Чистый
// хук без CSS/DOM-знания — PlayerPage решает, ЧТО показывать/скрывать (className),
// этот хук решает ТОЛЬКО КОГДА (visible: boolean + императивные show/setDragging).
//
// enabled=false (десктоп, mobile-хук matchMedia не сработал) — visible всегда
// true, таймер НИКОГДА не взводится: ноль поведенческой разницы для десктопа,
// даже если хук ошибочно смонтирован там (defense-in-depth, тот же принцип,
// что useCoarsePointer).
export function useAutoHideControls(enabled: boolean, hideDelayMs = 3000): {
  visible: boolean
  show: () => void
  setDragging: (dragging: boolean) => void
} {
  const [visible, setVisible] = useState(true)
  const draggingRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) { clearTimeout(timerRef.current); timerRef.current = null }
  }, [])

  const scheduleHide = useCallback(() => {
    clearTimer()
    if (!enabled) return // десктоп/выкл — бар не гаснет сам
    timerRef.current = setTimeout(() => {
      // Едж-кейс "автоскрытие НЕ срабатывает во время драга сик-бара": таймер
      // мог быть взведён ДО начала драга (show() → scheduleHide()) — на
      // самом срабатывании перепроверяем ref (не React state — синхронно
      // свежий), а не полагаемся на то, что drag-старт успел его отменить.
      if (!draggingRef.current) setVisible(false)
    }, hideDelayMs)
  }, [enabled, hideDelayMs, clearTimer])

  const show = useCallback(() => {
    setVisible(true)
    scheduleHide()
  }, [scheduleHide])

  const setDragging = useCallback((dragging: boolean) => {
    draggingRef.current = dragging
    if (dragging) { clearTimer(); setVisible(true) }
    else scheduleHide()
  }, [scheduleHide, clearTimer])

  // enabled переключился (напр. resize через порог coarse/fine) — сброс в
  // видимое состояние + перевзвод таймера под новый режим.
  useEffect(() => {
    setVisible(true)
    if (enabled) scheduleHide()
    else clearTimer()
    return clearTimer
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  return { visible, show, setDragging }
}
