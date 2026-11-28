// SubtitleL1Overlay — L1 (Russian) caption plate. Ported from the desktop
// VideoPlayerPanel/SubtitleL1Overlay.tsx, stripped down to the l2l1-mode
// path: no 'hover' reveal-on-hover mode (flib only has l2/l2l1/hidden), no
// target-cue accent (collect-examples-only). Independently draggable from
// the L2 plate — separate localStorage key, separate default bottom offset.
import type { Cue } from '../hooks/useSubtitles'
import { useDraggablePosition, type SubtitleMode, type SubtitlePosition } from './subtitle-drag'
import './subtitle-overlay.css'

const STORAGE_KEY = 'flib:sub-pos-l1'
const DEFAULT_POSITION: SubtitlePosition = { anchored: 'bottom', x: 50, y: 97 }
const BOTTOM_PCT = '3%'

export function SubtitleL1Overlay({ cues, activeIndex, mode, suppressed = false, ruByIndex, revealedByIndex, ruHidden = false }: {
  cues: Cue[]; activeIndex: number; mode: SubtitleMode; suppressed?: boolean
  // [ID:P-subtitle-translate] — on-demand RU-перевод по индексу cue (аддитивный
  // оверрайд поверх cue.text_ru): показываем cue.text_ru || ruByIndex[activeIndex].
  ruByIndex?: Record<number, string>
  // [ID:P-subtitle-translate-capsule] — индексы строк, раскрытых капсулой. Гейтим
  // видимость RU-плашки по НИМ (НЕ по ruByIndex): иначе пилюльные переводы
  // (диапазон) всплыли бы в l2 нескрываемо (SPEC §2, анти-инстр #4).
  revealedByIndex?: Set<number>
  // ruHidden — первый проход ролика маршрута (спека кабинета §4.7 п.5): русская
  // строка не показывается вовсе, до и после согласия на субтитры.
  ruHidden?: boolean
}) {
  const { containerRef, style, dragging, handleMouseDown, handleDoubleClick } =
    useDraggablePosition(STORAGE_KEY, DEFAULT_POSITION, BOTTOM_PCT)

  // revealed — строка раскрыта капсулой в НЕ-hidden режиме → показать RU даже в l2
  // БЕЗ смены глобального режима.
  const revealed = mode !== 'hidden' && !!revealedByIndex?.has(activeIndex)
  const visible = (mode === 'l2l1' || revealed) && activeIndex >= 0 && activeIndex < cues.length
  // WEB-SEAM: скрытие плашки в mute-регионе — веб-требование владельца, десктоп-аналога нет
  if (!visible || suppressed || ruHidden) return null
  const cue = cues[activeIndex]
  // on-demand перевод фолбэком, если у cue нет корпусного text_ru (аддитивно).
  const ru = cue.text_ru || ruByIndex?.[activeIndex] || ''
  // Нет русского текста в текущий момент — плашку не рисуем вовсе (иначе пустая
  // тёмная полоса: padding+background). Все хуки выше уже вызваны.
  if (!ru.trim()) return null

  return (
    <div
      ref={containerRef}
      className="subtitle-overlay subtitle-overlay--l1"
      data-testid="subtitle-l1-overlay"
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
      style={{
        ...style,
        cursor: dragging ? 'grabbing' : 'grab',
        userSelect: dragging ? 'none' : 'text',
      }}
    >
      {/* aria-live НЕ здесь: этот узел живёт постоянно в l2l1 и анонсировал бы
          КАЖДУЮ смену RU-строки при воспроизведении (SR-спам, аудит C3 MED).
          Корректный анонс момента капсульного reveal — на стороне PlayerPage (C4). */}
      <div className="subtitle-l1">{ru}</div>
    </div>
  )
}
