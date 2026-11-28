// IFrameAdapter.ts
import type { PlayerAdapter, PlayerEvent } from './PlayerAdapter'
import { createClockShim } from './clock-shim'

declare global { interface Window { YT?: any; onYouTubeIframeAPIReady?: () => void } }

// startSeconds — seekTo в onReady (пример слова урока; из CUED seekTo ЗАПУСКАЕТ воспроизведение).
// cueStart — целая секунда старта через playerVars.start: ролик остаётся на паузе (ссылка /player?t=).
// Если переданы оба — побеждает startSeconds.
export interface IFrameAdapterOpts { startSeconds?: number; cueStart?: number }

const SEEK_INFLIGHT_MS = 400
// P-unplayable: сколько ждём PLAYING после play() до "подозрения на бот-стену".
// 7с→15с: прод-регрессия 2026-07-14 (телефон, Chrome) — на мобильной сети
// легитимный старт легко превышает 7с, эвристика давала ложную «стену»
// (вдобавок оверлей не скрывался при последующем PLAYING — починено в
// PlayerPage). 15с при живом старте не срабатывает, при настоящей стене
// задержка подсказки некритична.
const BOTWALL_CHECK_MS = 15000
// Удержание часов на старте из ссылки: после первого PLAYING ждём, пока YouTube доедет до старта
// (getCurrentTime ≥ старт − 1), но не дольше этого срока.
const CUE_HOLD_MAX_MS = 1500

export function createIFrameAdapter(
  elId: string,
  videoId: string,
  opts: IFrameAdapterOpts,
  isCancelled?: () => boolean,
): Promise<PlayerAdapter> {
  return loadYTApi().then(() => new Promise<PlayerAdapter>((resolve) => {
    // P-A-dev: StrictMode double-mount — если монтаж уже отменён к моменту готовности API,
    // НЕ создаём YT.Player вовсе (никакого Player на отменённый монтаж).
    if (isCancelled?.()) { resolve(createNoopAdapter()); return }

    // P-A-dev: монтируем на СОЗДАВАЕМЫЙ дочерний div внутри host, а не на сам host-элемент.
    // YT.Player заменяет переданный элемент iframe-ом; destroy() эту замену НЕ откатывает.
    // Дочерний узел делает повторные монтажи (StrictMode double-mount) идемпотентными:
    // destroy() одного монтажа сносит только СВОЙ child-iframe, никогда — соседний.
    const host = document.getElementById(elId)
    const mountTarget: string | HTMLElement = host ? host.appendChild(document.createElement('div')) : elId

    let seekUntil = 0
    const seekInFlight = () => performance.now() < seekUntil
    const shim = createClockShim({ seekInFlight })
    const listeners: Record<PlayerEvent, ((p?: unknown) => void)[]> =
      { state: [], ready: [], error: [], volume: [], unplayable: [] }
    const emit = (e: PlayerEvent, p?: unknown) => listeners[e].forEach(cb => cb(p))

    let pollId: ReturnType<typeof setInterval> | null = null
    let lastVolKey = ''
    // P-yt-title-tooltip: наблюдатель за атрибутом title на iframe (см.
    // stripIframeTitle ниже). Disconnect в destroy.
    let titleObserver: MutationObserver | null = null
    // P-unplayable: бот-стена эвристика — YouTube может отрисовать "Sign in to
    // confirm you're not a bot" ВНУТРИ iframe без единого onError/onStateChange
    // (с точки зрения IFrame API ничего не сломалось, плеер просто не начинает
    // play). Единственный доступный сигнал — "play() вызван, но состояние не
    // дошло до PLAYING за разумное время". Эвристика — не факт (у медленных
    // сетей 7с тоже может не хватить), поэтому один раз за жизнь инстанса
    // (botwallSuspected-флаг), не повторный спам на каждый play().
    let botwallTimer: ReturnType<typeof setTimeout> | null = null
    let botwallSuspected = false
    const clearBotwallTimer = () => { if (botwallTimer !== null) { clearTimeout(botwallTimer); botwallTimer = null } }

    // cueStart (парсер гарантирует целое ≥ 1) — только когда нет startSeconds (тот побеждает).
    const cueStart = opts.startSeconds ? 0 : (opts.cueStart ?? 0)
    // Удержание часов: пока старт из ссылки не «осел», поллы шим НЕ кормят. До play YouTube
    // отдаёт сырое getCurrentTime (для t ≥ длительности — t, не 0), на play кратко 0 до PLAYING —
    // оба варианта дёргали бы полосу времени. Снимается: PLAYING достигнут И (время ≥ цель−1 ИЛИ
    // прошло CUE_HOLD_MAX_MS с этого PLAYING), либо нашим seek().
    let cueHold = cueStart > 0
    let cueHoldTarget = cueStart
    let cuePlayingAt: number | null = null
    const player = new window.YT.Player(mountTarget, {
      videoId,
      width: '100%', height: '100%',   // T1: iframe заполняет .stage-media, иначе дефолт YT 640×390
      // host НЕ ставим = дефолтный www.youtube.com. nocookie не передаёт YT-cookie
      // залогиненного юзера → YouTube-анти-бот показывает "подтвердите, что вы не бот".
      // Обычный host пропускает сессию → бот-гейта нет. (Приватный nocookie-режим —
      // опциональным тумблером позже, не дефолтом.)
      playerVars: {
        fs: 0, controls: 0, modestbranding: 1, rel: 0, playsinline: 1,  // controls:0 — свой Dusk-бар (VideoControlsBar) рулит транспортом
        // P-yt-captions: субтитры YouTube в embed не нужны никогда — см. suppressYTCaptions.
        cc_load_policy: 0,
        origin: window.location.origin,
        ...(cueStart > 0 ? { start: cueStart } : {}),
      },
      events: {
        onReady: () => {
          stripIframeTitle() // P-yt-title-tooltip: снять нативный тултип названия ролика
          suppressYTCaptions()
          // H7: resync к целевой стартовой позиции, а НЕ к getCurrentTime() (после seekTo он ещё 0)
          if (opts.startSeconds) { player.seekTo(opts.startSeconds, true); shim.resyncHard(opts.startSeconds) }
          else if (cueStart) {
            // start уже в playerVars: без seekTo/playVideo (иначе из CUED пойдёт автоплей).
            // t ≥ длительности (замер: на t∈[dur, dur+~5с) YouTube заканчивает ролик, а не стартует с 0):
            // переключаем cue на 0. Длительность 0/неизвестна — оставляем как есть.
            const dur = player.getDuration?.()
            if (dur > 0 && cueStart >= dur) {
              player.cueVideoById({ videoId, startSeconds: 0 })
              cueHoldTarget = 0
            }
            shim.resyncHard(cueHoldTarget)
          }
          else shim.resyncHard(player.getCurrentTime?.() ?? 0)
          shim.setRate(player.getPlaybackRate?.() ?? 1)
          // poll-цикл (часы + громкость)
          pollId = setInterval(() => {
            const st = mapState(player.getPlayerState?.())
            const cur = player.getCurrentTime?.() ?? 0
            if (cueHold) {
              if (st === 'playing' && cuePlayingAt === null) cuePlayingAt = performance.now()
              if (cuePlayingAt !== null && (cur >= cueHoldTarget - 1 || performance.now() - cuePlayingAt >= CUE_HOLD_MAX_MS)) cueHold = false
            }
            if (!cueHold) shim.tick(cur, st)
            const muted = !!player.isMuted?.(), volume = player.getVolume?.() ?? 100
            const key = `${muted}:${volume}`
            if (key !== lastVolKey) { lastVolKey = key; emit('volume', { muted, volume }) } // M9: только на изменение
          }, 150)
          resolve(adapter)
          emit('ready')
        },
        onStateChange: (e: { data: number }) => {
          // P-unplayable: PLAYING реально достигнут — снимаем ожидание бот-стены.
          if (e.data === window.YT.PlayerState.PLAYING) {
            clearBotwallTimer(); suppressYTCaptions()
            // отсчёт удержания — от СОБЫТИЯ (полл раз в 150 мс мог проморгать короткий PLAYING)
            if (cueHold && cuePlayingAt === null) cuePlayingAt = performance.now()
          }
          // ролик закончился (t у самого конца): ждать «время ≥ t−1» нечего — снимаем удержание
          if (e.data === window.YT.PlayerState.ENDED) cueHold = false
          if (e.data === window.YT.PlayerState.ENDED) emit('state', 'ended')
          else emit('state', mapState(e.data))
        },
        // P-yt-captions: YouTube сообщает о (пере)загрузке модуля captions через onApiChange.
        onApiChange: () => suppressYTCaptions(),
        onPlaybackRateChange: () => { shim.setRate(player.getPlaybackRate?.() ?? 1); emit('state', mapState(player.getPlayerState?.())) }, // H2
        // P-unplayable: и известные "плохие" коды (100 удалено, 101/150 embedding
        // запрещён), и остальные (2/5) — раньше emit('error') был без единого
        // подписчика. Теперь ВСЕГДА дополнительно emit('unplayable', {code}) —
        // UnplayableOverlay сам решает текст по коду; emit('error') сохранён как есть.
        onError: (e: { data: number }) => { emit('error', e.data); emit('unplayable', { reason: 'embed-error', code: e.data }) },
      },
    })

    function mapState(s: number): 'playing' | 'paused' | 'buffering' | 'ended' {
      const YT = window.YT.PlayerState
      if (s === YT.PLAYING) return 'playing'
      if (s === YT.BUFFERING) return 'buffering'
      if (s === YT.ENDED) return 'ended'
      return 'paused'
    }
    function snapRate(r: number): number {
      const rates: number[] = player.getAvailablePlaybackRates?.() ?? [1]
      return rates.reduce((a, b) => Math.abs(b - r) < Math.abs(a - r) ? b : a, rates[0])
    }
    // P-yt-title-tooltip: YouTube вешает на созданный iframe атрибут
    // title = НАЗВАНИЕ РОЛИКА. Наш overlay поверх видео — pointer-events:none
    // (PlayerRoot), поэтому курсор попадает на сам iframe, и браузер на каждом
    // наведении показывает нативный тултип с названием (баг владельца
    // 2026-07-18: «hint вылетает, когда вожу мышкой по поверхности видео»).
    // Снимаем title и наблюдаем: YT может проставить его повторно (ре-билд/
    // смена ролика) — наблюдатель чистит снова. Петли нет: реагируем только на
    // НЕПУСТОЙ title, а наш removeAttribute даёт getAttribute===null → no-op.
    function stripIframeTitle(): void {
      const ifr: HTMLIFrameElement | undefined = player.getIframe?.()
      if (!ifr) return
      if (ifr.getAttribute('title')) ifr.removeAttribute('title')
      if (titleObserver || typeof MutationObserver === 'undefined') return
      titleObserver = new MutationObserver(() => {
        if (ifr.getAttribute('title')) ifr.removeAttribute('title')
      })
      titleObserver.observe(ifr, { attributes: true, attributeFilter: ['title'] })
    }

    // P-yt-captions (прод-баг 2026-11-19): поверх видео рисовались субтитры
    // САМОГО YouTube — при выбранном на сайте «Скрыть» и на первом проходе
    // маршрута, который держится на скрытом тексте. Источник — настройка аккаунта
    // зрителя «всегда показывать субтитры» или дорожка ролика, включённая по
    // умолчанию (3G_D9cKSRDA показывает её даже в чистом профиле Chromium).
    // Сайт показывает СВОИ субтитры, поэтому в embed они не нужны никогда.
    // cc_load_policy:0 это не гасит — нужна выгрузка модуля через IFrame API.
    // YouTube подгружает модуль заново при старте воспроизведения (выгрузка
    // только в onReady/onApiChange в Chromium НЕ помогла), отсюда вызов и на
    // каждом PLAYING. setOption('captions','track',{}) намеренно не зовём: он
    // может записать «субтитры выкл.» в настройки YouTube самого зрителя.
    // Идемпотентно: повторная выгрузка невыгруженного модуля — no-op.
    function suppressYTCaptions(): void {
      for (const m of ['captions', 'cc']) {
        try { player.unloadModule?.(m) } catch { /* модуля нет или API изменился — не ломаем плеер */ }
      }
    }

    const adapter: PlayerAdapter = {
      currentTime: () => shim.now(),
      duration: () => player.getDuration?.() ?? 0,
      paused: () => player.getPlayerState?.() !== window.YT.PlayerState.PLAYING,
      rate: () => player.getPlaybackRate?.() ?? 1,
      muted: () => !!player.isMuted?.(),
      volume: () => player.getVolume?.() ?? 100,
      buffering: () => player.getPlayerState?.() === window.YT.PlayerState.BUFFERING,
      loadedFraction: () => player.getVideoLoadedFraction?.() ?? 0,
      isOurSeekInFlight: seekInFlight,
      getAvailableRates: () => player.getAvailablePlaybackRates?.() ?? [1],
      seek: (t) => { cueHold = false; seekUntil = performance.now() + SEEK_INFLIGHT_MS; player.seekTo(t, true); shim.resyncHard(t) },
      play: () => {
        player.playVideo?.()
        // P-unplayable: один наблюдатель на жизнь инстанса (после подозрения —
        // повторные play() его больше не заводят, не дублируем телеметрию/оверлей).
        if (!botwallSuspected) {
          clearBotwallTimer()
          botwallTimer = setTimeout(() => {
            botwallTimer = null
            const st = player.getPlayerState?.()
            if (st === window.YT.PlayerState.UNSTARTED || st === window.YT.PlayerState.CUED) {
              botwallSuspected = true
              emit('unplayable', { reason: 'botwall-suspect' })
            }
          }, BOTWALL_CHECK_MS)
        }
      },
      pause: () => player.pauseVideo?.(),
      setRate: (r) => { const s = snapRate(r); player.setPlaybackRate?.(s); shim.setRate(s) }, // H2
      mute: () => player.mute?.(),
      unmute: () => player.unMute?.(),
      setVolume: (v) => player.setVolume?.(v),
      on: (evt, cb) => { listeners[evt].push(cb); return () => { const i = listeners[evt].indexOf(cb); if (i >= 0) listeners[evt].splice(i, 1) } },
      destroy: () => {                                        // H4: полный teardown
        if (pollId !== null) { clearInterval(pollId); pollId = null }
        if (titleObserver) { titleObserver.disconnect(); titleObserver = null }
        clearBotwallTimer()
        ;(Object.keys(listeners) as PlayerEvent[]).forEach(k => { listeners[k].length = 0 })
        player.destroy?.()
      },
    }
  }))
}

// P-A-dev: заглушка для отменённого монтажа — без DOM/Player, безопасный no-op destroy().
function createNoopAdapter(): PlayerAdapter {
  return {
    currentTime: () => 0, duration: () => 0, paused: () => true, rate: () => 1, muted: () => false, volume: () => 0,
    buffering: () => false, loadedFraction: () => 0, isOurSeekInFlight: () => false, getAvailableRates: () => [1],
    seek: () => {}, play: () => {}, pause: () => {}, setRate: () => {}, mute: () => {}, unmute: () => {}, setVolume: () => {},
    on: () => () => {},
    destroy: () => {},
  }
}

let ytApiPromise: Promise<void> | null = null
function loadYTApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve()
  if (ytApiPromise) return ytApiPromise
  ytApiPromise = new Promise((resolve) => {
    const prev = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve() }
    const s = document.createElement('script')
    s.src = 'https://www.youtube.com/iframe_api'
    document.head.appendChild(s)
  })
  return ytApiPromise
}
