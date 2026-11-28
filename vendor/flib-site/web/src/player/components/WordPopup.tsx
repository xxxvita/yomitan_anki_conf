// WordPopup.tsx — T1a «видео-примеры по слову»
// (docs/contract-2026-07-15-examples-by-word.md): попап у кликнутого слова
// субтитра. Заготовка-пояснение (в будущем — дефиниция + RU-глосс, сейчас
// заглушка "Пояснение скоро", словарь — отдельная задача) + 2 кнопки,
// открывающие «Чат: Видео» (VideoChatPanel.tsx) с соответствующим kind.
//
// НЕ конфликтует с Yomitan: тот сидит на Shift+hover (браузерное расширение,
// свой обработчик вне React-дерева); наш попап — на ОБЫЧНЫЙ click слова
// (SubtitleOverlay.tsx onWordClick), эмитится ТОЛЬКО кликом, не hover.
import './word-popup.css'

export interface WordPopupPosition {
  x: number
  y: number
}

export function WordPopup({ word, position, onExamples, onClose }: {
  word: string
  position: WordPopupPosition
  onExamples: (kind: 'youtube' | 'film') => void
  onClose: () => void
}) {
  return (
    // Полноэкранный прозрачный backdrop — клик мимо попапа закрывает его
    // (типовой паттерн попапов), НЕ перехватывает клики, пока попап не открыт
    // (компонент вообще не монтируется, см. PlayerPage.tsx условие рендера).
    <div className="word-popup-backdrop" data-testid="word-popup-backdrop" onClick={onClose}>
      <div
        className="word-popup"
        data-testid="word-popup"
        style={{ left: position.x, top: position.y }}
        onClick={e => e.stopPropagation()}
      >
        <div className="wp-header">
          <span className="wp-word" data-testid="word-popup-word">{word}</span>
          <button type="button" className="wp-close" onClick={onClose} aria-label="Закрыть">✕</button>
        </div>
        <p className="wp-explain">Пояснение скоро</p>
        <div className="wp-actions">
          <button type="button" className="wp-btn" onClick={() => onExamples('youtube')}>
            Примеры YouTube
          </button>
          <button type="button" className="wp-btn" onClick={() => onExamples('film')}>
            Учебные примеры из фильмов
          </button>
        </div>
      </div>
    </div>
  )
}
