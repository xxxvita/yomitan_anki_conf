// VideoChatPanel.tsx — T1a «видео-примеры по слову»
// (docs/contract-2026-07-15-examples-by-word.md): боковая «Чат: Видео»
// (дизайн-референс — десктопный Flibooster «Чат: Видео»). Десктоп: правый
// drawer (тот же визуальный паттерн, что SettingsDrawer — translateX-слайд),
// мобила: полноэкранный оверлей поверх видео (паттерн .workspace-lift
// bottom-sheet из app.css @media(pointer:coarse), но fullscreen, не sheet —
// панель с карточками нуждается в большем пространстве, чем нижний лист).
//
// Чистый презентационный компонент — состояние (word/status/items) владеет
// useVideoChat.ts, PlayerPage только монтирует и прокидывает пропсы (тот же
// принцип разделения, что WorkspacePanel — тонкий рендер поверх внешнего ws).
import type { ExampleItem } from '../examples-api'
import type { VideoChatStatus } from '../hooks/useVideoChat'
import './video-chat-panel.css'

// formatTimestamp — мс → мм:сс (округление вниз, film-таймкод в контракте —
// start_ms целое число миллисекунд). Не заботится о часах: учебные реплики
// фильма — единицы минут, не часы; если понадобится >99:59, переполнение
// просто напечатает "100:00" читаемо, без краша.
function formatTimestamp(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function ExampleCard({ item, onFilmPlay }: { item: ExampleItem; onFilmPlay?: (item: ExampleItem) => void }) {
  if (item.source === 'youtube') {
    // Контракт: youtube-примеры БЕЗ таймкода — играть можно только целым
    // видео (наш плеер, соседняя вкладка). thumbnail_url у youtube контракт
    // тоже допускает null — фронт сам строит превью из i.ytimg.com/vi/<ref>,
    // не полагаясь на поле гейтвея.
    // encodeURIComponent(ref) — video_id всегда URL-safe, но кодируем
    // симметрично fetchExamples (аудит LOW-1): префикс схемы/хоста фиксирован,
    // так что инъекции нет и сейчас, но не полагаемся на «ref всегда чистый».
    const safeRef = encodeURIComponent(item.ref)
    const thumb = `https://i.ytimg.com/vi/${safeRef}/mqdefault.jpg`
    const href = `/player?v=${safeRef}`
    return (
      <a
        className="vcp-card vcp-card--youtube"
        data-testid="vcp-card-youtube"
        href={href}
        target="_blank"
        rel="noopener noreferrer"
      >
        <img src={thumb} alt="" className="vcp-card-thumb" />
        <span className="vcp-card-title">{item.text_en || item.ref}</span>
      </a>
    )
  }
  // film/episode — T1b (puzzle-cache стриминг клипа) ещё не реализован.
  // Карточка строится по контракту УЖЕ сейчас (превью + реплика + тайминг),
  // но клик — заглушка "скоро" (onFilmPlay, PlayerPage.tsx подключает
  // showToast('Скоро') — тот же паттерн, что onToggleDictation/onStartPuzzle).
  return (
    <button
      type="button"
      className="vcp-card vcp-card--film"
      data-testid="vcp-card-film"
      onClick={() => onFilmPlay?.(item)}
    >
      <span className="vcp-card-thumb vcp-card-thumb--placeholder">
        {item.thumbnail_url ? <img src={item.thumbnail_url} alt="" /> : '🎬'}
      </span>
      <span className="vcp-card-body">
        <span className="vcp-card-text">{item.text_en}</span>
        {item.start_ms != null && (
          <span className="vcp-card-time" data-testid="vcp-card-time">{formatTimestamp(item.start_ms)}</span>
        )}
      </span>
    </button>
  )
}

export function VideoChatPanel({ open, word, status, items, errorMessage, onClose, onFilmPlay }: {
  open: boolean
  word: string | null
  status: VideoChatStatus
  items: ExampleItem[]
  errorMessage: string | null
  onClose: () => void
  onFilmPlay?: (item: ExampleItem) => void
}) {
  return (
    <div className={`video-chat-panel${open ? ' open' : ''}`} data-testid="video-chat-panel" aria-hidden={!open}>
      <div className="vcp-header">
        <span className="vcp-title">Чат: Видео</span>
        <button type="button" className="vcp-close" data-testid="vcp-close" onClick={onClose} aria-label="Закрыть">✕</button>
      </div>
      <div className="vcp-body" data-testid="vcp-body">
        {status === 'idle' && (
          <p className="vcp-empty" data-testid="vcp-idle">Кликните по слову в субтитрах, чтобы найти примеры</p>
        )}
        {word && status !== 'idle' && (
          <p className="vcp-message" data-testid="vcp-message">Нашёл примеры со словом «{word}»</p>
        )}
        {status === 'loading' && <div className="vcp-spinner" data-testid="vcp-spinner" role="status">Ищу примеры…</div>}
        {status === 'not_ready' && <p className="vcp-empty" data-testid="vcp-not-ready">Примеры скоро</p>}
        {status === 'error' && (
          <p className="vcp-empty" data-testid="vcp-error">{errorMessage || 'Не удалось загрузить примеры'}</p>
        )}
        {status === 'ok' && items.length === 0 && (
          <p className="vcp-empty" data-testid="vcp-no-results">Ничего не нашлось</p>
        )}
        {status === 'ok' && items.length > 0 && (
          <div className="vcp-cards" data-testid="vcp-cards">
            {items.map((item, i) => (
              <ExampleCard key={`${item.source}-${item.ref}-${i}`} item={item} onFilmPlay={onFilmPlay} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
