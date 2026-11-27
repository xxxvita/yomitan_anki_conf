import { useEffect, useRef, type ReactNode } from 'react'
import type { PlayerAdapter } from '../adapter/PlayerAdapter'
import { createIFrameAdapter } from '../adapter/IFrameAdapter'
import { createNativeVideoAdapter } from '../adapter/NativeVideoAdapter'

// PlayerTransport — Track A (YouTube IFrame API, дефолт) | Track B (наш
// video-прокси, ВРЕМЕННЫЙ fallback при бот-стене, [ID:P-hybrid]). PlayerPage
// решает, какой транспорт активен (дефолт/кнопка оверлея/sessionStorage/
// ?transport=native — см. PlayerPage.tsx), PlayerRoot только монтирует
// СООТВЕТСТВУЮЩИЙ адаптер под ОБЩИЙ id 'yt-player' (оба адаптера монтируют
// свой узел ВНУТРЬ него, тем же host-паттерном, что и раньше — остальная
// вёрстка/CSS .player-video не знает о разнице транспортов).
export type PlayerTransport = 'iframe' | 'native'

// PlayerRoot больше НЕ оборачивает FullscreenContainer (это делает PlayerPage вокруг
// всего стека). Здесь только сцена: iframe/video + overlay-слот (pointer-events:none).
export function PlayerRoot({ videoId, transport = 'iframe', cueStart, onAdapter, insetRight = 0, onTapStage, revealCatcher = false, children }: {
  videoId: string
  transport?: PlayerTransport
  // Старт из ссылки (/player?t=): целые секунды. Читается ТОЛЬКО при создании адаптера
  // (намеренно не в deps эффекта) — смена пропа без ремаунта плеер не двигает.
  cueStart?: number
  onAdapter?: (a: PlayerAdapter | null) => void
  insetRight?: number
  // [ID:P-mobile]: тап по видео-сцене показывает мобильный оверлей-контрол-бар
  // (владелец: "появляется по тапу на видео"). Опционален и передаётся ТОЛЬКО
  // на мобиле (PlayerPage гейтит по useCoarsePointer) — на десктопе проп
  // undefined ⇒ onPointerDown вообще не навешивается, ноль поведенческой
  // разницы для существующих десктопных вызовов/тестов PlayerRoot.
  onTapStage?: () => void
  // Ревью v2a R2-C1: тап по видео уходит ВНУТРЬ <iframe> YouTube и до onPointerDown
  // сцены не доходит — автоскрытые бары телефона было не вернуть. PlayerPage ставит
  // true, пока бары скрыты (только coarse pointer): над видео ложится прозрачный
  // слой, тап по которому только показывает бары (onTapStage) — без seek/mute/
  // fullscreen/листа/play-pause. Бары видимы → слоя нет, тапы идут в YouTube как раньше.
  revealCatcher?: boolean
  children?: ReactNode
}) {
  const catcherRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let a: PlayerAdapter | null = null, cancelled = false
    // P-A-dev: isCancelled — замыкание на cancelled, читается ПОСЛЕ await YT API и ДО new YT.Player,
    // чтобы StrictMode dev-даблинг (mount#1 отменён до резолва общего кэшированного промиса API)
    // не создавал лишний YT.Player поверх host. Существующая cancelled-проверка ниже — вторая
    // защита (на случай отмены УЖЕ ПОСЛЕ создания плеера).
    // [ID:P-hybrid]: transport в deps ниже — смена iframe↔native переиспользует
    // ЭТОТ ЖЕ эффект (полный teardown/remount), а не отдельный ветвящийся код;
    // PlayerPage к тому же меняет remountNonce на переключении (принадлежность
    // key), так что этот эффект и так пересоздаётся с нуля при смене транспорта.
    const create = transport === 'native' ? createNativeVideoAdapter : createIFrameAdapter
    create('yt-player', videoId, cueStart ? { cueStart } : {}, () => cancelled).then(ad => {
      if (cancelled) { ad.destroy(); return }
      a = ad; onAdapter?.(ad)
      // Dev-шов: ручка адаптера для браузер-смоуков оркестратора (в прод-бандл
      // не попадает — import.meta.env.DEV статически false при vite build).
      if (import.meta.env.DEV) (window as unknown as { __adapter?: PlayerAdapter }).__adapter = ad
    })
    return () => { cancelled = true; a?.destroy(); onAdapter?.(null) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId, transport]) // onAdapter (setState) стабилен — не в deps намеренно
  return (
    <div
      className="player-stage"
      // pointerdown со слоя-ловушки сюда не считается: слой показывает бары по click
      // (см. ниже), иначе он исчез бы посреди касания.
      onPointerDown={onTapStage ? (e) => { if (e.target !== catcherRef.current) onTapStage() } : undefined}
    >
      {/* WEB-SEAM (T6): порт VideoContainer.tsx:72-80 — inset-обёртка; при videoBoxed
          && drawerOpen right:insetRight (transition 0.18s) → drawer ДВИГАЕТ видео,
          а не оверлеит. iframe (width/height 100% из T1) заполняет .stage-media. */}
      <div className="stage-media" data-testid="stage-media" style={{ right: insetRight, transition: 'right 0.18s ease' }}>
        <div id="yt-player" className="player-video" />
        {revealCatcher && onTapStage && (
          // Слой-ловушка (R2-C1): над видео (iframe/video без z-index), ПОД оверлеем
          // (z 5) — субтитры, капсула оценки и концовка остаются кликабельными.
          // Показ — по click, а не по pointerdown: размонтируйся слой на pointerdown,
          // click того же тапа достался бы кнопке проявившегося бара (mute/seek/⛶).
          // stopPropagation — тап «только показать» не должен ничего задеть выше.
          <div
            ref={catcherRef}
            data-testid="stage-reveal"
            className="stage-reveal"
            aria-hidden="true"
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1 }}
            onClick={(e) => { e.stopPropagation(); onTapStage() }}
          />
        )}
        {/* [ID:P-mobile] ПАРИТЕТ iframe↔video: iframe получает position:absolute
            через `.player-stage iframe` в app.css, а нативный <video>
            (NativeVideoAdapter) монтировался в обычном потоке (position:static)
            — на iOS инлайн-видео композитится ПОВЕРХ этого HTML-оверлея,
            субтитры невидимы. z-index + isolation запирают новый stacking
            context строго над видео (не над settings-drawer/toast — те выше
            в дереве, вне .player-stage). translateZ(0) — принудительная GPU-
            композиция: на iOS Safari/Chrome обычный z-index иногда проигрывает
            видео-слою браузерного медиа-движка без явного composite-layer hint. */}
        <div
          className="overlay"
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 5, isolation: 'isolate', transform: 'translateZ(0)' }}
        >
          {children}
        </div>
      </div>
    </div>
  )
}
