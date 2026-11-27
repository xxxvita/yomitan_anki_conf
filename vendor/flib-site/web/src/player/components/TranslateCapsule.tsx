// TranslateCapsule.tsx — [ID:P-subtitle-translate-capsule] маленькая кнопка-иконка
// «перевести ЭТУ строку», один компонент на оба хоста (видео-плашка + CueList).
// Показ RU для текущей строки даже в EN-only режиме, БЕЗ смены глобального режима.
//
// Видимость (hover-desktop / always-coarse / display:none) задаёт CSS ХОСТА, НЕ
// JS-состояние (SPEC §3): у видео-плашки инвариант «no mouseenter listeners» ради
// Yomitan, а display:none (не opacity) не оставляет кнопку в Tab-порядке (WCAG 2.4.7).
import { Languages } from 'lucide-react'
import { useT } from '../i18n'
import './translate-capsule.css'

export function TranslateCapsule({ onActivate, busy = false }: {
  onActivate: () => void
  // busy — дизейбл ТОЛЬКО HTTP-пути. Вызывающий хост передаёт true лишь для строк
  // БЕЗ готового RU (иначе corpus-reveal, который бесплатен, душился бы при
  // чужом переводе/Retry-After — SPEC анти-инстр #10).
  busy?: boolean
}) {
  const t = useT()
  // stopPropagation на ВСЕХ жестах: плашка-хост слушает mousedown(drag)/
  // dblclick(reset)/contextmenu(меню) — клик капсулы это ДРУГОЙ жест и не должен
  // их триггерить (SPEC §3).
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation()
  return (
    <button
      type="button"
      className="translate-capsule"
      aria-label={t('player.translateLine') || 'Перевести эту строку'}
      aria-busy={busy || undefined}
      disabled={busy}
      onMouseDown={stop}
      onDoubleClick={stop}
      onContextMenu={stop}
      onClick={(e) => { e.stopPropagation(); onActivate() }}
    >
      {/* Внешняя кнопка = прозрачная тап-зона ≥44px; видимый chrome — меньший
          внутренний элемент (26px), чтобы не перекрывать крайние word-span'ы
          на маленькой плашке субтитра (аудит C2 HIGH / SPEC §3). */}
      <span className="translate-capsule__chrome"><Languages size={13} aria-hidden /></span>
    </button>
  )
}
