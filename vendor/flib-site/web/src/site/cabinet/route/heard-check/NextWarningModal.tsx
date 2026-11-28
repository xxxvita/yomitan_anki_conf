// NextWarningModal.tsx — окно «Вы прослушали не весь ролик.» (два выбора, без
// подсказок и счётчиков — решение владельца 2026-11-20).
//
// ⚠️ КЛАВИАТУРА — НА window В ФАЗЕ CAPTURE СО stopPropagation: горячие клавиши
// плеера (пробел, цифры, Esc) не должны получать клавиши, пока окно открыто.
// Фокус по умолчанию — «Вернуться к ролику»; Esc = «Вернуться к ролику».
import { useEffect, useRef } from 'react'
import { finishNextWarning, useNextWarningOpen } from './next-warning-store'
import { NW_TEXT } from './next-warning-flow'
import './next-warning.css'

export function NextWarningDialogHost() {
  const open = useNextWarningOpen()
  if (!open) return null
  return <div className="nw-root"><NextWarningDialog /></div>
}

function NextWarningDialog() {
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const backRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null
    backRef.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      e.stopPropagation()
      if (e.key === 'Tab') {
        const dlg = dialogRef.current
        if (!dlg) return
        const items = Array.from(dlg.querySelectorAll<HTMLElement>('button:not([disabled])'))
        if (items.length === 0) return
        const act = document.activeElement
        const i = act instanceof HTMLElement ? items.indexOf(act) : -1
        const last = items.length - 1
        if (e.shiftKey && i <= 0) { e.preventDefault(); items[last].focus() }
        else if (!e.shiftKey && (i === -1 || i === last)) { e.preventDefault(); items[0].focus() }
        return
      }
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        const el = document.activeElement
        if (el instanceof HTMLButtonElement && dialogRef.current?.contains(el)) { if (!e.repeat) el.click() }
        else if (!e.repeat) finishNextWarning('stay')
        return
      }
      if (e.key === 'Escape') { e.preventDefault(); if (!e.repeat) finishNextWarning('stay') }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      if (prev && prev.isConnected) prev.focus()
    }
  }, [])

  return (
    <div className="nw-backdrop" role="presentation" data-testid="next-warning-backdrop">
      <div ref={dialogRef} className="nw-dialog" role="dialog" aria-modal="true" aria-labelledby="nw-msg" tabIndex={-1} data-testid="next-warning">
        <p id="nw-msg" className="nw-msg">{NW_TEXT.message}</p>
        <div className="nw-actions">
          <button ref={backRef} type="button" className="nw-back" data-testid="nw-back" onClick={() => finishNextWarning('stay')}>{NW_TEXT.back}</button>
          <button type="button" className="nw-proceed" data-testid="nw-proceed" onClick={() => finishNextWarning('proceed')}>{NW_TEXT.proceed}</button>
        </div>
      </div>
    </div>
  )
}
