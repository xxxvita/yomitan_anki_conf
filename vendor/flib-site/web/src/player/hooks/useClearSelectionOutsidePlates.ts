// web/src/player/hooks/useClearSelectionOutsidePlates.ts
// A4: снимает подвисшее текстовое выделение при клике ВНЕ плашек субтитров.
// Два пути: (1) mousedown в родительском документе (таймлайн/контролы/сцена);
// (2) window blur с новосфокусированным YT-<iframe> — кросс-документное видео
// глотает свой mousedown, единственный сигнал «клик В видео» — потеря фокуса
// родительским окном к элементу iframe. Слушатели read-only: без
// preventDefault/stopPropagation → делегированные pointer-события панели целы.
import { useEffect } from 'react'

export function useClearSelectionOutsidePlates(): void {
  useEffect(() => {
    const insidePlate = (el: EventTarget | null) =>
      el instanceof Element && !!el.closest('.subtitle-overlay')
    const clear = () => {
      const sel = window.getSelection?.()
      if (sel && !sel.isCollapsed) sel.removeAllRanges()
    }
    const onDown = (e: MouseEvent) => { if (!insidePlate(e.target)) clear() }

    let blurTimerId: ReturnType<typeof setTimeout> | null = null
    const onBlur = () => {
      // отложить на тик — activeElement устаканивается на iframe после blur
      blurTimerId = setTimeout(() => {
        const ae = document.activeElement
        if (ae?.tagName === 'IFRAME') {
          clear()
          // Re-arm: вернуть фокус документу — (1) следующий клик в видео снова даст
          // window-blur (иначе второй клик «немой»), (2) alt-tab при живом iframe-фокусе
          // не будет ложно сбрасывать, (3) хоткеи (document keydown) снова работают —
          // фокус в iframe глотал Space/стрелки в пользу YT. YT-контролы у нас controls:0.
          ;(ae as HTMLElement).blur()
        }
      }, 0)
    }

    document.addEventListener('mousedown', onDown)
    window.addEventListener('blur', onBlur)
    return () => {
      if (blurTimerId !== null) clearTimeout(blurTimerId)
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('blur', onBlur)
    }
  }, [])
}
