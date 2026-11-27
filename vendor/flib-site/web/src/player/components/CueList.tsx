import { useEffect, useRef } from 'react'
import type { Cue } from '../hooks/useSubtitles'
import { TranslateCapsule } from './TranslateCapsule'
import { capsuleVisible } from '../translate-capsule'
import { formatTime } from '../workspace/vtt-format'

// Список субтитров: клик по строке → выбор её ИНДЕКСА (не времени — вызывающая
// сторона решает, что делать: range+seek+view-shift, см. PlayerPage.selectCue).
// Авто-скролл к активной строке через scrollTop (НЕ scrollIntoView — тот даёт
// горизонтальный рывок родителю).
//
// [ID:P-subtitle-translate-capsule] Строка — <div> с ДВУМЯ sibling-<button>:
// seek-кнопка (текст) + капсула-кнопка. Раньше вся строка была одним <button>;
// <button> внутри <button> невалиден и ломает клавиатуру/скринридер, поэтому
// разделили. data-testid/data-active/scroll-ref переехали на <div>.
export function CueList({ cues, activeIndex, onSelect, ruByIndex, onCueContextMenu, onTranslateLine, translateBusy, ruHidden: ruHiddenProp = false, enHidden = false }: {
  cues: Cue[]; activeIndex: number; onSelect: (index: number) => void
  // [ID:P-subtitle-translate] — on-demand RU-оверрайд по индексу; ПКМ по строке.
  ruByIndex?: Record<number, string>
  onCueContextMenu?: (index: number, x: number, y: number) => void
  // [ID:P-subtitle-translate-capsule] — перевод ОДНОЙ строки по капсуле; busy —
  // общий in-flight/Retry-After (дизейблит только HTTP-путь, см. ниже).
  onTranslateLine?: (index: number) => void
  translateBusy?: boolean
  // ruHidden — первый проход ролика маршрута (спека кабинета §4.7 п.5): ни
  // русской строки, ни капсулы перевода, ни ПКМ-меню перевода.
  ruHidden?: boolean
  // enHidden — первый проход ролика маршрута (прод 2026-11-19, ревью M-1):
  // английский текст не печатается вовсе — синхронный транскрипт в одном клике
  // от видео обнулял скрытые субтитры. Строка показывает только время начала,
  // переход по строке работает. Включает и ruHidden.
  enHidden?: boolean
}) {
  const ruHidden = ruHiddenProp || enHidden
  const containerRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const c = containerRef.current, a = activeRef.current
    if (!c || !a) return
    c.scrollTop = Math.max(0, a.offsetTop - c.clientHeight / 2 + a.clientHeight / 2)
  }, [activeIndex])
  return (
    <div ref={containerRef} className="cue-list" data-testid="cue-list">
      {cues.map((cue, i) => {
        const hasRu = !ruHidden && !!(cue.text_ru || ruByIndex?.[i])
        return (
          <div
            key={i}
            ref={i === activeIndex ? activeRef : undefined}
            data-testid={`cue-${i}`}
            data-active={i === activeIndex ? 'true' : 'false'}
            className="cue-row"
          >
            <button
              type="button"
              className="cue-seek"
              onClick={() => onSelect(i)}
              onContextMenu={onCueContextMenu && !ruHidden ? (e) => { e.preventDefault(); e.stopPropagation(); onCueContextMenu(i, e.clientX, e.clientY) } : undefined}
            >
              {enHidden
                ? <span className="cue-time">{formatTime(cue.start)}</span>
                : <span className="cue-en">{cue.text_en}</span>}
              {hasRu && <span className="cue-ru">{cue.text_ru || ruByIndex?.[i]}</span>}
            </button>
            {onTranslateLine && !ruHidden && capsuleVisible({ textEn: cue.text_en, hasVisibleRu: hasRu, windowOk: true }) && (
              // busy дизейблит ТОЛЬКО HTTP-путь: у строки без RU перевод идёт в
              // шлюз; corpus-строка сюда не попадёт (hasRu → капсулы нет).
              <TranslateCapsule onActivate={() => onTranslateLine(i)} busy={!!translateBusy && !hasRu} />
            )}
          </div>
        )
      })}
    </div>
  )
}
