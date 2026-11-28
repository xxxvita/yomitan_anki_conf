import { useRef, useState } from 'react'
import type { PlayerAdapter } from '../../adapter/PlayerAdapter'
import type { PlayerState } from '../hooks/usePlayerState'
import type { WorkspaceApi } from '../hooks/useWorkspace'

function fmt(t: number): string {
  if (!Number.isFinite(t) || t < 0) t = 0
  const m = Math.floor(t / 60), s = Math.floor(t % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function VideoControlsBar({
  adapter, state, ws, seek, onFullscreen, onToggleMute,
  mobile = false, visible = true, onScrubbingChange, onToggleWorkspace, workspaceOpen, onRateChange,
}: {
  adapter: PlayerAdapter
  state: PlayerState
  ws: Pick<WorkspaceApi, 'onUserSeek'>
  // S3-5: scrub-bar pointer-up — user-сик, маршрут через runtime.seek
  // (observedSeek, carry T4/F3 forward-escape). Опционален, без него падает на
  // adapter.seek — байт-в-байт прежнее поведение (транспарентность для
  // caller'ов без runtime + существующих тестов).
  seek?: (t: number) => void
  onFullscreen?: () => void
  // T4-ревью: единственный писатель в adapter.mute()/unmute() — useMuteDriver.
  // Бар только тогглит ручной интент (manualMuted в PlayerPage), не пишет в адаптер напрямую.
  onToggleMute?: () => void
  // [ID:P-mobile] — всё ниже опционально; mobile=false/visible=true (дефолты)
  // рендерят БАЙТ-В-БАЙТ прежний <div className="controls-bar">, десктоп не
  // видит ни одного нового класса/атрибута.
  // mobile — PlayerPage передаёт useCoarsePointer(); включает тонкий
  // оверлейный вид (media-query-хук .cb-mobile-класс в app.css нет — визуал
  // целиком в @media(pointer:coarse) на .controls-bar, этот флаг только
  // гейтит JS-поведение: показ кнопки workspace + допуск cb-hidden класса).
  mobile?: boolean
  // visible — от useAutoHideControls (PlayerPage): false → бар гаснет
  // (.cb-hidden в app.css, эффективно ТОЛЬКО под pointer:coarse — двойной гейт).
  visible?: boolean
  // Драг сик-бара НЕ должен гасить бар автоскрытием — родитель держит это в
  // useAutoHideControls.setDragging(true/false) вокруг pointerDown/Up ниже.
  onScrubbingChange?: (dragging: boolean) => void
  // Кнопка вызова тяжёлого workspace как bottom-sheet поверх видео (владелец:
  // "кнопка в тонком баре вызывает его"). Рендерится ТОЛЬКО при mobile===true.
  onToggleWorkspace?: () => void
  workspaceOpen?: boolean
  // rate_change-телеметрия: вызывается ПОСЛЕ фактической смены скорости кнопкой
  // (cycleRate). Опционален — без него cycleRate ведёт себя байт-в-байт как прежде.
  onRateChange?: (rate: number) => void
}) {
  const { duration, currentTime, muted, volume, rate } = state
  const [previewT, setPreviewT] = useState<number | null>(null)
  const barRef = useRef<HTMLDivElement>(null)

  const xToTime = (clientX: number): number => {
    const el = barRef.current; if (!el) return 0
    const r = el.getBoundingClientRect(); if (r.width <= 0) return 0
    return Math.max(0, Math.min(duration, ((clientX - r.left) / r.width) * duration))
  }
  // [ID:P-mobile]: onScrubbingChange держит мобильный автоскрывающийся бар
  // ВИДИМЫМ на всё время драга (edge case из брифа — "автоскрытие не
  // срабатывает во время драга сик-бара"). undefined на десктопе — no-op.
  const onDown = (e: React.PointerEvent) => { barRef.current?.setPointerCapture(e.pointerId); setPreviewT(xToTime(e.clientX)); onScrubbingChange?.(true) } // H8: pointerup гарантированно придёт на бар
  const onMove = (e: React.PointerEvent) => { if (previewT !== null) setPreviewT(xToTime(e.clientX)) }                        // превью локально
  const onUp = (e: React.PointerEvent) => {
    if (previewT === null) { onScrubbingChange?.(false); return }
    const t = xToTime(e.clientX)
    try { barRef.current?.releasePointerCapture(e.pointerId) } catch { /* jsdom */ }
    ws.onUserSeek(t)   // сперва арбитраж лупа (авто-disable вне [A,B])
    // S3-5: ОДИН seek на pointer-up (не на каждый move — иначе YT-шторм), через
    // runtime.seek/observedSeek, если передан; иначе adapter.seek напрямую.
    ;(seek ?? ((tt: number) => adapter.seek(tt)))(t)
    setPreviewT(null)
    onScrubbingChange?.(false)
  }

  const shownT = previewT ?? currentTime
  const pct = duration > 0 ? (shownT / duration) * 100 : 0
  const rates = adapter.getAvailableRates()
  const cycleRate = () => { const i = rates.indexOf(rate); const next = rates[(i + 1) % rates.length] ?? 1; adapter.setRate(next); onRateChange?.(next) }

  return (
    <div
      className={'controls-bar' + (mobile && !visible ? ' cb-hidden' : '')}
      // Скрытый бар (mobile, cb-hidden) касаний не ловит: inline 'auto' перебивал
      // .cb-hidden { pointer-events: none }, и невидимый бар съедал тапы у низа видео
      // (ревью v2a R1-C1: тап по «Отправить» формы оценки глушил звук).
      style={{ pointerEvents: mobile && !visible ? 'none' : 'auto' }}
      data-testid="controls-bar"
      // [ID:P-mobile]: тап ПО САМОМУ бару не должен всплыть и переинтерпретиро-
      // ваться где-то выше как "тап по видео" (родитель вешает show() на тап
      // по .player-stage — бар сидит СНАРУЖИ него в DOM, так что структурно
      // всплытие туда и так невозможно; stopPropagation — явная страховка по
      // тексту брифа на случай будущего рефакторинга разметки). На десктопе
      // (mobile=false) обработчик вообще не навешивается.
      onPointerDown={mobile ? (e) => e.stopPropagation() : undefined}
    >
      <span className="cb-time" data-testid="time">{fmt(shownT)} / {fmt(duration)}</span>
      <div ref={barRef} data-testid="seek-bar" className="cb-seek" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
        <div className="cb-seek-fill" style={{ width: pct + '%' }} />
      </div>
      <button data-testid="rate-btn" className="cb-btn" onClick={cycleRate}>{rate}×</button>
      <button data-testid="mute-btn" className="cb-btn" onClick={() => onToggleMute?.()} aria-label={muted ? 'Unmute' : 'Mute'}>{muted ? '🔇' : '🔊'}</button>
      <input data-testid="volume" className="cb-vol" type="range" min={0} max={100} value={muted ? 0 : volume} onChange={(e) => adapter.setVolume(Number(e.target.value))} aria-label="Volume" />
      {mobile && onToggleWorkspace && (
        // [ID:P-mobile]: вызов тяжёлого workspace как bottom-sheet (владелец:
        // "кнопка в тонком баре вызывает его как нижний лист"). Заменяет
        // десктопную полноширинную ".timeline-reopen" полосу на мобиле (та
        // скрыта CSS-медиа-запросом в app.css — этой кнопке дублировать
        // нечего, один источник правды для toggle-состояния — timelineCollapsed).
        <button
          data-testid="cb-ws-btn"
          className={'cb-btn' + (workspaceOpen ? ' is-active' : '')}
          onClick={onToggleWorkspace}
          aria-pressed={!!workspaceOpen}
          aria-label="Панель упражнений"
          title="Панель упражнений"
        >☰</button>
      )}
      <button data-testid="cb-fs-btn" className="cb-btn" onClick={() => onFullscreen?.()} aria-label="Fullscreen">⛶</button>
    </div>
  )
}
