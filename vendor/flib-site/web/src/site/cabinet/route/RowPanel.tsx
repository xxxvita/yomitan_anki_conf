// RowPanel.tsx — то, что раскрывается под нажатой кнопкой героя или строки
// (спека 2026-11-17 §4.12): строка причин «Не нравится», подтверждение
// «Заменить», уведомление замены («Замена сейчас недоступна» …). Открыта одна
// на страницу.
import { useEffect, useRef } from 'react'
import type { DayRow } from './day-model'
import { canReplaceRow, type DayActions } from './day-actions'
import { DislikeReasons } from './DislikeReasons'
import { ReplaceConfirm } from './ReplaceConfirm'

export function RowPanel({ row, a, where }: { row: DayRow; a: DayActions; where: 'hero' | 'row' }) {
  const p = a.panel
  const pid = row.puzzleId
  const anchor = where === 'hero' ? 'hero' : pid
  const mine = !!p && !!pid && p.puzzleId === pid && p.where === where
  const notice = a.notice && a.notice.anchor && a.notice.anchor === anchor ? a.notice : null
  // Панель героя ОТКРЫЛАСЬ по действию (причины / подтверждение замены) — прокрутить в
  // видимую область: на телефоне она иначе целиком под нижней панелью разделов.
  // Только переход закрыто → открыто: не при перерисовке и не при монтировании уже
  // открытой панели (prevOpen стартует равным текущему); строки дня не прокручиваются.
  const open = where === 'hero' && mine
  const prevOpen = useRef(open)
  const boxRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (open && !prevOpen.current) {
      const el = boxRef.current
      if (el && typeof el.scrollIntoView === 'function') {
        const calm = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
        el.scrollIntoView({ block: 'nearest', behavior: calm ? 'auto' : 'smooth' })
      }
    }
    prevOpen.current = open
  }, [open])
  if (!mine && !notice) return null
  return (
    <div ref={boxRef} className="row-panel" style={{ marginTop: 12 }}>
      {mine && p!.kind === 'dislike' && (
        <DislikeReasons canReplace={canReplaceRow(row, a.replaceAvailable)}
          onSubmit={(reason, replace) => a.submitDislike(row, reason, replace)} onCancel={a.closePanel} />
      )}
      {/* Подтверждение — только пока строка ТЕКУЩЕГО состояния заменяема (ревью 3а, C1):
          строка, ставшая kept / kept_local после перечитывания, его не показывает. */}
      {mine && p!.kind === 'replace' && canReplaceRow(row, a.replaceAvailable) && <ReplaceConfirm onConfirm={() => a.confirmReplace(row)} onCancel={a.closePanel} />}
      {notice && <div className="msg warn" role="status"><span>{notice.text}</span></div>}
    </div>
  )
}
