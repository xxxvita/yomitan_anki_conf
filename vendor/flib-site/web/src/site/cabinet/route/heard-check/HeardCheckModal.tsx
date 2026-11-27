// HeardCheckModal.tsx — экран «Тест после ролика» (порт HeardCheckModal.tsx
// приложения Flibooster; спека heard-check §2, E4–E8).
//
// Тексты — дословно из приложения (`i18n/ru.ts`, ключи heardCheck.*); заголовок
// «Тест после ролика» — по решению владельца для сайта. Слова — только
// английские, без перевода.
//
// ⚠️ КЛАВИАТУРА — НА window В ФАЗЕ CAPTURE СО stopPropagation (E7): горячие
// клавиши плеера (пробел, цифры, Esc) висят на document/внутри плеера и не должны
// получить ни одной клавиши, пока экран открыт. Enter/пробел на кнопке в фокусе
// нажимают ЭТУ кнопку (иначе Tab → «Пропустить» → Enter дал бы answered с
// пустым списком — ровно обратное намерению).
// ⚠️ Закрытие без ответа (размонтирование, смена страницы) — abandonHeardCheck:
// ничего не отправляется (E4). declined — только явные «Пропустить»/Esc.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { shownWords } from './heard-check-event'
import { abandonHeardCheck, finishHeardCheck, useHeardQuestion } from './heard-check-store'
import type { HeardQuestion } from '../route-api'
import { abandonNextWarning } from './next-warning-store'
import { NextWarningDialogHost } from './NextWarningModal'
import './heard-check.css'

export const HC_TEXT = {
  title: 'Тест после ролика',
  prompt: 'Отметьте слова, которые Вы услышали в этом ролике',
  hint: 'Цифры 1–6 — отметить слово, Enter — готово, Esc — пропустить',
  done: 'Готово',
  skip: 'Пропустить',
} as const

// HeardCheckHost — монтируется ОДИН раз в корне страницы (плеер, кабинет).
export function HeardCheckHost() {
  const q = useHeardQuestion()
  const loc = useLocation()
  // Смена страницы при открытом экране — уход без ответа.
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    abandonHeardCheck()
    abandonNextWarning()
  }, [loc.pathname])
  // Размонтирование хоста при открытом экране — тоже уход без ответа.
  useEffect(() => () => { abandonHeardCheck(); abandonNextWarning() }, [])
  return (
    <>
      {q && <div className="hc-root"><HeardCheckDialog key={q.id} question={q} /></div>}
      <NextWarningDialogHost />
    </>
  )
}

function HeardCheckDialog({ question }: { question: HeardQuestion }) {
  const words = useMemo(() => shownWords(question), [question])
  const [marked, setMarked] = useState<ReadonlySet<string>>(() => new Set())
  // Ссылка обновляется в самом переключении: цифра и Enter одним тиком иначе
  // прочли бы отметки до перерисовки.
  const markedRef = useRef<ReadonlySet<string>>(marked)
  const dialogRef = useRef<HTMLDivElement | null>(null)

  const toggle = useCallback((w: string) => {
    const next = new Set(markedRef.current)
    if (next.has(w)) next.delete(w); else next.add(w)
    markedRef.current = next
    setMarked(next)
  }, [])
  const done = useCallback(() => {
    finishHeardCheck({ outcome: 'answered', marked: words.filter(w => markedRef.current.has(w)) })
  }, [words])
  const skip = useCallback(() => finishHeardCheck({ outcome: 'declined' }), [])

  useEffect(() => {
    // Фокус — в диалог (если он был в iframe YouTube, клавиши ушли бы туда);
    // прежний фокус возвращаем при закрытии.
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialogRef.current?.focus()
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
      if (e.key.length === 1 && e.key >= '1' && e.key <= '6') {
        e.preventDefault()
        if (e.repeat) return // зажатая цифра шлёт автоповтор — плашка не должна мигать
        const w = words[Number(e.key) - 1]
        if (w !== undefined) toggle(w)
        return
      }
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        // Кнопка в фокусе важнее горячей клавиши; родное нажатие погашено — жмём сами, один раз.
        const el = document.activeElement
        if (el instanceof HTMLButtonElement && dialogRef.current?.contains(el)) {
          if (!e.repeat) el.click()
          return
        }
        if (e.key === 'Enter' && !e.repeat) done()
        return
      }
      if (e.key === 'Escape') { e.preventDefault(); if (!e.repeat) skip() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      if (prev && prev.isConnected) prev.focus()
    }
  }, [words, toggle, done, skip])

  return (
    <div className="hc-backdrop" role="presentation" data-testid="heard-check-backdrop">
      <div ref={dialogRef} className="hc-dialog" role="dialog" aria-modal="true" aria-labelledby="hc-title" aria-describedby="hc-prompt"
        tabIndex={-1} data-testid="heard-check">
        <h3 id="hc-title" className="hc-title">{HC_TEXT.title}</h3>
        <p id="hc-prompt" className="hc-prompt">{HC_TEXT.prompt}</p>
        <div className="hc-words">
          {words.map((w, i) => (
            <button key={w} type="button" aria-pressed={marked.has(w)} data-testid="hc-word"
              className={marked.has(w) ? 'hc-word hc-word--on' : 'hc-word'} onClick={() => toggle(w)}>
              <span className="hc-key" aria-hidden="true">{i + 1}</span>
              <span className="hc-text">{w}</span>
            </button>
          ))}
        </div>
        <p className="hc-hint">{HC_TEXT.hint}</p>
        <div className="hc-actions">
          <button type="button" className="hc-skip" data-testid="hc-skip" onClick={skip}>{HC_TEXT.skip}</button>
          <button type="button" className="hc-done" data-testid="hc-done" onClick={done}>{HC_TEXT.done}</button>
        </div>
      </div>
    </div>
  )
}
