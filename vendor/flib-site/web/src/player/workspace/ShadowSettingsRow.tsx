// ShadowSettingsRow.tsx — ТЗ №3 п.4: the settings row (mode subtitle↔custom /
// loop / АВТОПЕРЕХОД switch + threshold slider) LIFTED OUT of ShadowCardLifted
// into a standalone component so it can render in the workspace bar (between the
// transport and the training pills) instead of inside the floating card, freeing
// the card's vertical space for the attempts feed. The JSX and props are the
// SAME as the card's old `settings &&` block — this is a move, not a rewrite:
// PlayerPage passes the identical settings snapshot + the identical 4 delivery
// callbacks it used to pass to the card. `iconChip` came with it (it was only
// ever used by this row; the card's remaining custom-mode side buttons keep
// their own `sideBtn`).
import React from 'react'
import { Subtitles, Type, Pencil, RotateCw } from 'lucide-react'
import { useT } from '../i18n'
import type { ShadowMode } from './panel-types'

// ── VERBATIM from ShadowChat.tsx :1208-1220 (iconChip) — the mode/loop chip style. ──
function iconChip(on: boolean): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 3,
    height: 28, padding: '0 8px',
    background: on ? 'color-mix(in srgb, var(--accent) 18%, transparent)' : 'var(--btn-bg, rgba(0,0,0,0.25))',
    border: `1px solid ${on ? 'var(--accent, #60a5fa)' : 'var(--border, rgba(255,255,255,0.10))'}`,
    borderRadius: 6,
    color: on ? 'var(--accent, #60a5fa)' : 'var(--fg-dim, #94a3b8)',
    cursor: 'pointer', flexShrink: 0,
  }
}

export interface ShadowSettings {
  advanceEnabled: boolean
  advanceThreshold: number
  mode: ShadowMode
  loopMode: boolean
}

export interface ShadowSettingsRowProps {
  settings: ShadowSettings
  /** Тумблер АВТОПЕРЕХОД (свитч). */
  onAdvanceEnabledChange?: (enabled: boolean) => void
  /** Слайдер порога 50–100/5. */
  onAdvanceThresholdChange?: (threshold: number) => void
  /** Кнопка режима субтитр↔custom. */
  onModeChange?: (mode: ShadowMode) => void
  /** Кнопка повтора. */
  onLoopModeChange?: (loopMode: boolean) => void
}

// ── VERBATIM visual from ShadowChat.tsx :754-816 (only full-layout). Same
// data-testids the card exposed before ТЗ №3 (shadow-settings-row /
// shadow-mode-toggle / shadow-loop-toggle / shadow-advance-toggle /
// shadow-advance-slider) so the срез-B contract is unchanged — only the mount
// point moved from the card to the bar. ──
export const ShadowSettingsRow: React.FC<ShadowSettingsRowProps> = ({
  settings, onAdvanceEnabledChange, onAdvanceThresholdChange, onModeChange, onLoopModeChange,
}) => {
  const t = useT()
  return (
    <div data-testid="shadow-settings-row" style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, minWidth: 240 }}>
      <button
        data-testid="shadow-mode-toggle"
        onClick={() => onModeChange?.(settings.mode === 'custom' ? 'subtitle' : 'custom')}
        title={settings.mode === 'subtitle' ? t('player.shadowModeCustom') : t('player.shadowModeSubtitle')}
        style={iconChip(settings.mode === 'custom')}
      >
        {settings.mode === 'subtitle' ? <Subtitles size={13} /> : <Type size={13} />}
        <Pencil size={11} style={{ opacity: .7 }} />
      </button>
      <button
        data-testid="shadow-loop-toggle"
        onClick={() => onLoopModeChange?.(!settings.loopMode)}
        title={t('player.shadowLoop')}
        style={iconChip(settings.loopMode)}
      ><RotateCw size={13} /></button>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 5, flex: 1, minWidth: 0,
        height: 28, padding: '0 6px 0 4px',
        background: 'var(--btn-bg, rgba(0,0,0,0.25))',
        border: '1px solid var(--border, rgba(255,255,255,0.10))',
        borderRadius: 6,
        opacity: settings.advanceEnabled ? 1 : 0.7,
      }}>
        <button
          data-testid="shadow-advance-toggle"
          onClick={() => onAdvanceEnabledChange?.(!settings.advanceEnabled)}
          style={{
            width: 22, height: 12, padding: 0, border: 'none', borderRadius: 8,
            background: settings.advanceEnabled ? 'var(--accent, #60a5fa)' : 'var(--fg-mute, #64748b)',
            cursor: 'pointer', position: 'relative', flexShrink: 0,
            transition: 'background 0.15s',
          }}
          aria-label="toggle auto-advance"
        >
          <span style={{
            position: 'absolute', top: 1, left: 1, width: 10, height: 10, borderRadius: '50%',
            background: 'var(--surface, #fff)',
            transform: settings.advanceEnabled ? 'translateX(10px)' : 'none',
            transition: 'transform 0.15s',
          }} />
        </button>
        <span style={{
          fontFamily: 'var(--mono-font, monospace)', fontSize: 8.5, letterSpacing: .4,
          textTransform: 'uppercase', color: 'var(--fg-mute, #64748b)', whiteSpace: 'nowrap',
          opacity: settings.advanceEnabled ? 1 : .4,
        }}>{t('player.shadowAuto')}</span>
        <input
          data-testid="shadow-advance-slider"
          type="range" min={50} max={100} step={5}
          value={settings.advanceThreshold}
          disabled={!settings.advanceEnabled}
          onChange={e => onAdvanceThresholdChange?.(+e.target.value)}
          style={{ flex: 1, minWidth: 0, accentColor: 'var(--accent, #60a5fa)', height: 14 }}
        />
        <span style={{
          fontFamily: 'var(--mono-font, monospace)', fontSize: 10,
          color: 'var(--fg, #e2e8f0)', fontVariantNumeric: 'tabular-nums',
          minWidth: 30, textAlign: 'right',
          opacity: settings.advanceEnabled ? 1 : .4,
        }}>{settings.advanceThreshold}%</span>
      </div>
    </div>
  )
}
