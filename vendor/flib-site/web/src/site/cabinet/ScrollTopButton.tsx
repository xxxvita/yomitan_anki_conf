// ScrollTopButton.tsx — «Наверх»: появляется, когда страница прокручена больше
// чем на 400 px (дизайн), плавно возвращает к началу. Кнопка fixed, но в подвал не
// заходит: когда подвал виден, её нижний край поднимается на GAP над его верхним краем
// (переменная --totop-lift, CSS берёт max(базовый отступ, lift)).
import { useEffect, useRef, useState } from 'react'
import { CabI } from './cab-icons'

const SHOW_AFTER_PX = 400
export const FOOTER_GAP_PX = 16
const BTN_PX = 44
const GAP_TOP_PX = 8

/** Отступ кнопки от низа окна, нужный, чтобы она стояла выше подвала на GAP; 0 — подвал не виден. */
export function liftFor(footerTop: number, viewportH: number, gap = FOOTER_GAP_PX): number {
  if (!Number.isFinite(footerTop) || !Number.isFinite(viewportH) || footerTop >= viewportH) return 0
  const lift = Math.max(0, Math.round(viewportH - footerTop + gap))
  // На низком окне кнопка (44 px) не должна уезжать выше верха окна.
  return Math.min(lift, Math.max(0, viewportH - BTN_PX - GAP_TOP_PX))
}

export function ScrollTopButton() {
  const [show, setShow] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const update = () => {
      setShow(window.scrollY > SHOW_AFTER_PX)
      const el = btn.current
      if (!el) return
      const foot = document.querySelector('footer.foot')
      const lift = foot ? liftFor(foot.getBoundingClientRect().top, window.innerHeight) : 0
      if (lift > 0) el.style.setProperty('--totop-lift', `${lift}px`)
      else el.style.removeProperty('--totop-lift')
    }
    // Не чаще раза за кадр: на прокрутке и ресайзе пересчёт ставится в один ожидающий кадр.
    let frame = 0
    const schedule = () => {
      if (frame) return
      frame = requestAnimationFrame(() => { frame = 0; update() })
    }
    update()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule, { passive: true })
    // Высота страницы меняется без прокрутки («Показать ещё», переход внутри SPA) — подвал сдвигается.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null
    // body и html здесь высотой 100% и при росте контента не меняются: наблюдаем авто-высотный контейнер подвала.
    ro?.observe(document.body)
    const grow = document.querySelector('footer.foot')?.parentElement
    if (grow) ro?.observe(grow)
    return () => {
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      ro?.disconnect()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])
  return (
    <button
      ref={btn}
      type="button"
      className={'totop' + (show ? ' show' : '')}
      aria-label="Наверх"
      tabIndex={show ? 0 : -1}
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
    >
      <CabI.up />
    </button>
  )
}
