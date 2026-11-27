import type { ReactNode } from 'react'
import type { SubtitleMode } from './subtitle-drag'
import { useT, useLocale, setLocale, type Locale } from '../i18n'

// W3: exported so PlayerPage's .video-topbar segment buttons reuse the exact
// same SubtitleMode literals + label KEYS instead of re-declaring a parallel
// list that could drift out of sync with the drawer.
// i18n (T2): label → labelKey; текст резолвится через useT() в точке рендера.
export const SUBTITLE_MODE_OPTIONS: { value: SubtitleMode; labelKey: string }[] = [
  { value: 'l2', labelKey: 'player.subtitleEn' },
  { value: 'l2l1', labelKey: 'player.subtitleEnRu' },
  { value: 'hidden', labelKey: 'player.subtitleOff' },
]
const MODES = SUBTITLE_MODE_OPTIONS

// Кнопки переключателя локали (RU|EN) — паттерн sd-mode-btn.
const LOCALES: { value: Locale; label: string }[] = [
  { value: 'ru', label: 'RU' },
  { value: 'en', label: 'EN' },
]

// Правый drawer — дом субтитровых операций (PR#3: режим + [CueList/поиск из A6]).
// Открытие/закрытие: шестерёнка + ✕ (Esc/хоткей C добавит C1).
export function SettingsDrawer({ open, onClose, mode, onMode, children }: {
  open: boolean
  onClose: () => void
  mode: SubtitleMode
  onMode: (m: SubtitleMode) => void
  children?: ReactNode
}) {
  const t = useT()
  const locale = useLocale()
  return (
    <div className={`settings-drawer${open ? ' open' : ''}`} data-testid="settings-drawer" aria-hidden={!open}>
      <div className="sd-header">
        <span className="sd-title">Субтитры</span>
        <button data-testid="sd-close" className="sd-close" onClick={onClose} aria-label="Закрыть">✕</button>
      </div>
      <div className="sd-section">
        <div className="sd-label">Режим</div>
        <div className="sd-modes">
          {MODES.map(m => (
            <button
              key={m.value}
              data-testid={`sd-mode-${m.value}`}
              data-active={mode === m.value ? 'true' : 'false'}
              className="sd-mode-btn"
              onClick={() => onMode(m.value)}
            >{t(m.labelKey)}</button>
          ))}
        </div>
      </div>
      <div className="sd-section">
        <div className="sd-label">Язык · Language</div>
        <div className="sd-modes">
          {LOCALES.map(l => (
            <button
              key={l.value}
              data-testid={`sd-locale-${l.value}`}
              data-active={locale === l.value ? 'true' : 'false'}
              className="sd-mode-btn"
              onClick={() => setLocale(l.value)}
            >{l.label}</button>
          ))}
        </div>
      </div>
      <div className="sd-body" data-testid="sd-body">{children}</div>
    </div>
  )
}
