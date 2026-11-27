// ResetConfirm.tsx — «Сбросить маршрут» с подтверждением на странице, без
// модального окна (спека 2026-11-17 §4.5, §4.12 элемент 9, OQ-B9; план B10d;
// макет `cab-route.jsx:270-284`). [Отмена] ничего не шлёт; [Да, сбросить] —
// `DELETE /api/me/route` (делает страница), затем сразу «Маршрута нет».
import { useState } from 'react'

export const RESET_CONFIRM_TEXT = 'Маршрут начнётся заново: история дней и прогресс роликов удалятся. Ключ останется прежним.'

export function ResetConfirm({ busy, onConfirm }: { busy: boolean; onConfirm: () => void }) {
  const [open, setOpen] = useState(false)
  if (!open) return <div><button type="button" className="btn danger sm" disabled={busy} onClick={() => setOpen(true)}>Сбросить маршрут</button></div>
  return (
    <div className="confirm" data-testid="reset-confirm">
      <p>{RESET_CONFIRM_TEXT}</p>
      <div className="row">
        <button type="button" className="btn danger sm" disabled={busy} onClick={() => { setOpen(false); onConfirm() }}>Да, сбросить</button>
        <button type="button" className="btn sm" onClick={() => setOpen(false)}>Отмена</button>
      </div>
    </div>
  )
}
