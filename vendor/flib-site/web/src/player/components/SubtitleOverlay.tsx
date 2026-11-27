// SubtitleOverlay — L2 (English) caption plate. Ported from the desktop
// VideoPlayerPanel/SubtitleOverlay.tsx: dark glass plate (theme cssVars),
// draggable/repositionable, data-word spans for the Yomitan browser
// extension to scan. Yomitan click/hover handlers, karaoke word-by-word
// highlighting, alt-drag phrase-select, and the collect-examples
// target-cue accent are all desktop-only features and are intentionally
// NOT ported — flib has no in-app dictionary popup, TTS karaoke, or
// collect-examples pipeline.
//
// T1a «видео-примеры по слову» [ID:P-video-chat] (docs/contract-2026-07-15-
// examples-by-word.md): optional onWordClick adds OUR OWN click handler to
// the SAME data-word spans, on plain click (no modifier). Yomitan owns
// Shift+hover — a disjoint interaction, this does not collide with it and
// does not add any mouseenter/hover listener (see the existing "no onClick
// handler" test above — that test renders WITHOUT onWordClick and keeps
// passing: the handler below is only attached when the prop is provided).
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import type { Cue } from '../hooks/useSubtitles'
import { useDraggablePosition, type SubtitleMode, type SubtitlePosition } from './subtitle-drag'
import { TranslateCapsule } from './TranslateCapsule'
import './subtitle-overlay.css'

export type { SubtitleMode, SubtitlePosition }

const STORAGE_KEY = 'flib:sub-pos-l2'
const DEFAULT_POSITION: SubtitlePosition = { anchored: 'bottom', x: 50, y: 90 }
const BOTTOM_PCT = '10%'

// cleanWord — strips leading/trailing punctuation a raw whitespace-split
// token can carry ("controlled." / "«amazing»" / "wait—") so the popup/
// examples query gets a clean surface word, not "controlled." with a
// trailing period the gateway's porter-stemmer resolver was never asked to
// handle. Keeps internal apostrophes ("don't") — those are part of the word.
// \p{L}\p{N} (Unicode letter/number, флаг u) вместо [A-Za-z] — иначе краевые
// цифры/диакритика съедались ("COVID-19"→"COVID", "café"→"caf") и в porter
// уходило искажённое слово (аудит LOW-2). Внутренние дефисы/цифры сохраняются
// (обрезаем только с краёв), апостроф — тоже часть слова.
export function cleanWord(raw: string): string {
  return raw.replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, '')
}

// soundLabelMask — какие токены строки (те же, что `text.split(/\s+/)`) — звуковые
// метки, а не слова речи: «[Music]», «(laughs)», «[Light music]», «♪». Спека
// кабинета §4.7 п.1 и §4.8: размываются и сообщаются в `subtitles_shown` СЛОВА
// реплики; шумовые метки — не речь (`шумоваяРеплика` счётчика, решение владельца
// 2026-10-05), их не слушают и не читают. Живая проверка на проде 2026-11-19:
// «[Music]» размывалось как слово, а нажатие рождало subtitles_shown {music}.
// Метка — токен, который пересекает закрытую пару скобок «[…]» / «(…)» или несёт
// ноту, и вне скобок и нот в нём нет ни буквы, ни цифры («hey[Music]» — слово;
// незакрытая скобка — не метка, иначе хвост строки ушёл бы из размытия).
const NOTE = /[\u266A\u266B\u266C\u2669]/u
const NOTES = /[\u266A\u266B\u266C\u2669]/gu
export function soundLabelMask(text: string): boolean[] {
  const spans: Array<[number, number]> = []
  for (const m of text.matchAll(/\[[^\]]*\]|\([^)]*\)/g)) spans.push([m.index!, m.index! + m[0].length])
  const out: boolean[] = []
  for (const m of text.matchAll(/\S+/g)) {
    const from = m.index!, tok = m[0]
    let rest = '', touches = false
    for (let i = 0; i < tok.length; i++) {
      const at = from + i
      if (spans.some(([a, b]) => at >= a && at < b)) { touches = true; continue }
      rest += tok[i]
    }
    if (NOTE.test(rest)) touches = true
    out.push(touches && !/[\p{L}\p{N}]/u.test(rest.replace(NOTES, '')))
  }
  return out
}

// LONG_PRESS_MS — долгое нажатие на сенсорном экране открывает всю строку
// (первый проход маршрута, спека кабинета §4.7 п.4).
const LONG_PRESS_MS = 500

export function SubtitleOverlay({ cues, activeIndex, mode, suppressed = false, onWordClick, onPlateContextMenu, onTranslateLine, translateBusy, showCapsule = false, blur = false, onWordsRevealed }: {
  cues: Cue[]; activeIndex: number; mode: SubtitleMode; suppressed?: boolean
  // onWordClick — T1a: PlayerPage passes this to open the WordPopup at the
  // clicked word's screen position. Optional — tests/other call sites that
  // don't pass it get the exact same markup as before this feature.
  onWordClick?: (word: string, rect: DOMRect) => void
  // [ID:P-subtitle-translate] — ПКМ по плашке субтитра на видео → меню перевода
  // текущего (активного) блока. Optional; без него разметка прежняя.
  onPlateContextMenu?: (x: number, y: number) => void
  // [ID:P-subtitle-translate-capsule] — капсула «перевести эту (активную) строку»
  // в углу плашки. showCapsule вычисляет PlayerPage (RU этой строки ещё не виден).
  // translateBusy дизейблит ТОЛЬКО когда путь HTTP-шный (вызывающий уже отфильтровал).
  onTranslateLine?: () => void
  translateBusy?: boolean
  showCapsule?: boolean
  // blur — первый проход ролика маршрута (спека кабинета 2026-11-17 §4.7 п.4):
  // слова размыты; нажатие на размытое слово открывает ТОЛЬКО его и зовёт
  // onWordsRevealed(cue, [слово]) — без окна примеров (onWordClick не зовётся:
  // слово ещё не прочитано). Нажатие на открытое слово — как обычно. Правая
  // кнопка мыши / долгое нажатие — вся строка, в обработчик только ещё размытые
  // слова. Открытые слова снова размываются при смене реплики. Наведение не
  // открывает ничего. Без blur разметка и поведение прежние.
  blur?: boolean
  onWordsRevealed?: (cueIndex: number, words: string[]) => void
}) {
  const { containerRef, style, dragging, handleMouseDown, handleDoubleClick } =
    useDraggablePosition(STORAGE_KEY, DEFAULT_POSITION, BOTTOM_PCT)
  const [revealed, setRevealed] = useState<{ cue: number; idx: Set<number> }>({ cue: -1, idx: new Set() })
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Смена реплики: открытые слова снова размыты (и при возврате к той же
  // реплике), долгое нажатие на прежнюю строку отменяется (ревью L8).
  useEffect(() => {
    setRevealed(r => (r.cue === -1 && r.idx.size === 0 ? r : { cue: -1, idx: new Set() }))
    if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null }
  }, [activeIndex])

  const visible = (mode === 'l2' || mode === 'l2l1') && activeIndex >= 0 && activeIndex < cues.length
  // WEB-SEAM: скрытие плашки в mute-регионе — веб-требование владельца, десктоп-аналога нет
  if (!visible || suppressed) return null
  const cue = cues[activeIndex]
  const words = cue.text_en.split(/\s+/).filter(Boolean)
  // Звуковые метки — только на первом проходе (blur): гость и просмотренный
  // ролик видят прежнюю разметку, где «[Music]» — обычное слово.
  const label = blur ? soundLabelMask(cue.text_en) : []
  const open = revealed.cue === activeIndex ? revealed.idx : new Set<number>()
  const revealAll = () => {
    const still = words.map((w, i) => ({ w: cleanWord(w), i })).filter(x => !open.has(x.i) && !label[x.i] && x.w)
    setRevealed({ cue: activeIndex, idx: new Set(words.map((_, i) => i)) })
    if (still.length) onWordsRevealed?.(activeIndex, still.map(x => x.w))
  }
  const cancelPress = () => { if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null } }
  const contextMenu = blur
    ? (e: ReactMouseEvent) => { e.preventDefault(); e.stopPropagation(); revealAll() }
    : onPlateContextMenu ? (e: ReactMouseEvent) => { e.preventDefault(); e.stopPropagation(); onPlateContextMenu(e.clientX, e.clientY) } : undefined

  return (
    <div
      ref={containerRef}
      className="subtitle-overlay subtitle-overlay--l2"
      data-testid="subtitle-overlay"
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
      onContextMenu={contextMenu}
      onTouchStart={blur ? () => { cancelPress(); pressTimer.current = setTimeout(() => { pressTimer.current = null; revealAll() }, LONG_PRESS_MS) } : undefined}
      onTouchEnd={blur ? cancelPress : undefined}
      onTouchMove={blur ? cancelPress : undefined}
      style={{
        ...style,
        cursor: dragging ? 'grabbing' : 'grab',
        userSelect: dragging ? 'none' : 'text',
      }}
    >
      {onTranslateLine && showCapsule && (
        <TranslateCapsule onActivate={onTranslateLine} busy={translateBusy} />
      )}
      <div className="subtitle-l2">
        {words.map((w, i) => label[i] ? (
          // Первый проход маршрута: звуковая метка — не слово. Не размыта, без
          // data-word и без нажатия: ни subtitles_shown, ни окна примеров.
          <span key={i} className="sub-word sub-word--label" data-sound-label="true">{w}{' '}</span>
        ) : blur && !open.has(i) ? (
          // Первый проход маршрута: размытое слово. Нажатие открывает только
          // его; окна примеров нет (onWordClick не зовётся).
          <span
            key={i}
            className="sub-word sub-word--blur"
            data-blurred="true"
            onClick={(e) => {
              e.stopPropagation()
              const word = cleanWord(w)
              setRevealed({ cue: activeIndex, idx: new Set([...open, i]) })
              if (word) onWordsRevealed?.(activeIndex, [word])
            }}
          >{w}{' '}</span>
        ) : (
          // data-word: cosmetic hook for the Yomitan browser extension.
          // Yomitan still owns hover — no onMouseEnter is added here. The
          // onClick below is OUR OWN plain-click handler (T1a), attached
          // only when onWordClick is supplied by the caller.
          <span
            key={i}
            data-word
            className="sub-word"
            onClick={onWordClick ? (e) => {
              // stopPropagation: the plate's own onMouseDown/onDoubleClick
              // (drag-to-reposition, handleDoubleClick reset) sit on this
              // span's ancestor — a word click is a DIFFERENT gesture and
              // must not also toggle/reset the plate position handlers that
              // listen on click-adjacent events elsewhere in the app.
              e.stopPropagation()
              const word = cleanWord(w)
              if (word) onWordClick(word, e.currentTarget.getBoundingClientRect())
            } : undefined}
          >{w}{' '}</span>
        ))}
      </div>
    </div>
  )
}
