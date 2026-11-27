// WordCard.tsx — карточка слова урока (спека 2026-11-17 §4.13 пп.4–5; план B10f).
// Слово (выражение с пробелом — цветом акцента), фраза примера `text_en`, под ней
// `text_ru`, если пришла; «▶ Пример» / «Смотреть снова», «✓ просмотрен». Тексты
// состояний — §4.13 п.10 дословно.
import type { ReactNode } from 'react'
import type { WordState } from './words-lesson'

export interface WordCardProps {
  word: string
  state: WordState
  heard: boolean
  playing: boolean
  player: ReactNode
  onPlay: () => void
  onRetry: () => void
}

export function WordCard({ word, state, heard, playing, player, onPlay, onRetry }: WordCardProps) {
  const ex = state.k === 'example' ? state.items[state.idx] : null
  return (
    <div className={'lesson-card' + (playing ? ' on' : '')} data-testid={`word-${word}`} data-state={state.k}>
      <div className="lesson-card-head">
        <span className={'lesson-word' + (word.includes(' ') ? ' ph' : '')}>{word}</span>
        {heard && ex && <span className="lesson-heard">✓ просмотрен</span>}
      </div>
      {state.k === 'searching' && <p className="mute">Ищем пример…</p>}
      {state.k === 'none' && state.why === 'empty' && <p className="mute">Пример не нашёлся</p>}
      {state.k === 'none' && state.why === 'unembeddable' && <p className="mute">Этот пример не открывается</p>}
      {state.k === 'failed' && (
        <p className="mute">Не удалось загрузить пример <button type="button" className="btn sm" onClick={onRetry}>Повторить</button></p>
      )}
      {ex && (
        <>
          <p className="lesson-en">{ex.text_en}</p>
          {ex.text_ru && <p className="lesson-ru">{ex.text_ru}</p>}
          {playing ? player : (
            <div><button type="button" className="btn sm" onClick={onPlay}>{heard ? 'Смотреть снова' : '▶ Пример'}</button></div>
          )}
        </>
      )}
    </div>
  )
}
