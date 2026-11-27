// RateButtons.tsx — «Нравится» / «Не нравится» (макет: квадратные иконки 40×40
// у героя, `btn sm icon` в строке). Подсветка — `flib:route-ratings`; нажатие на
// выбранную ничего не шлёт и строку причин не открывает (OQ-B3, L14).
import { CabI } from '../cab-icons'
import type { DayRow } from './day-model'
import type { DayActions } from './day-actions'

export function RateButtons({ row, a, sm, where }: { row: DayRow; a: DayActions; sm?: boolean; where: 'hero' | 'row' }) {
  if (!row.puzzleId) return null
  const r = a.ratingOf(row.puzzleId)
  const cls = (on: boolean) => 'btn icon' + (sm ? ' sm' : '') + (on ? ' on' : '')
  return (
    <>
      <button type="button" className={cls(r === 'like')} aria-label="Нравится" title="Нравится" aria-pressed={r === 'like'}
        disabled={a.busy} onClick={() => { if (r !== 'like') a.like(row) }}><CabI.like /></button>
      <button type="button" className={cls(r === 'dislike')} aria-label="Не нравится" title="Не нравится" aria-pressed={r === 'dislike'}
        disabled={a.busy} onClick={() => { if (r !== 'dislike') a.dislike(row, where) }}><CabI.dislike /></button>
    </>
  )
}
