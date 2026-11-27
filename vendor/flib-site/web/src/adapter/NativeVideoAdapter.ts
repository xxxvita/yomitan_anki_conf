// NativeVideoAdapter.ts [ID:P-hybrid] — Track B: PlayerAdapter поверх HTML5
// <video playsinline>, src=/api/video/{id} (BFF video_proxy.go). ДЕШЁВЫЙ
// ВРЕМЕННЫЙ fallback для тестеров, которых YouTube-embed бот-стеной не
// пускает (iOS Safari — структурно ловит стену), см. PlayerAdapter.ts doc и
// владелец задачи P-hybrid. Спроектирован под лёгкое отключение (флаг
// VIDEO_FALLBACK_ENABLED на бэке — здесь просто перестаёт быть выбранным
// транспортом, см. PlayerPage.tsx) — НЕ под вечность.
//
// /api/video/{id} — "кэш или прогрев": 202 {"status":"warming"} пока файла
// нет (BFF в фоне тянет его с gateway), клиент ОБЯЗАН поллить тот же URL
// (min-gap на бэке 1с per-IP — 3с-интервал ниже проходит с запасом), пока не
// придёт 200 (файл готов, ServeContent сам умеет Range/206). 404 — фича
// выключена флагом (см. VideoProxyHandler) — НЕ повод поллить, сразу unplayable.
//
// currentTime()/duration() читают <video> НАПРЯМУЮ (в отличие от
// IFrameAdapter, которому нужен clock-shim из-за postMessage-задержки
// YouTube IFrame API) — HTML5 media element даёт currentTime без задержки,
// шим не нужен.
import type { PlayerAdapter, PlayerEvent, UnplayablePayload } from './PlayerAdapter'

// cueStart — старт из ссылки /player?t=; игнорируется при ≥ duration. startSeconds побеждает.
export interface NativeVideoAdapterOpts { startSeconds?: number; cueStart?: number }

// NATIVE_POLL_INTERVAL_MS — 3с (владелец задачи: "клиент поллит этот же URL
// раз в 3с"). Больше, чем videoProxyPerIPMinGap=1с на бэке (internal/bff/
// video_proxy.go) — с запасом, polling никогда не рейт-лимитится своим же ритмом.
const NATIVE_POLL_INTERVAL_MS = 3000
// NATIVE_POLL_MAX_MS — 10 минут (владелец задачи: "поллит... до 10 мин").
// Gateway само по себе может грузить видео до 15 минут (сериализация на
// egress-IP) — 10 минут здесь НАМЕРЕННО короче: если прогрев так долго не
// приходит, UX-честнее сдаться и показать "Попробовать снова"/"Пропустить
// шаг", чем держать тестера перед вечным "Готовим видео" ещё 5 минут.
const NATIVE_POLL_MAX_MS = 10 * 60 * 1000
// NATIVE_SEEK_INFLIGHT_MS — паритет с IFrameAdapter.SEEK_INFLIGHT_MS (400мс):
// тот же контракт isOurSeekInFlight() (ad-guard-подобные потребители
// отличают наш программный seek от пользовательского/нативного скраба),
// хотя <video>.currentTime не имеет poll-задержки YouTube — окно тут скорее
// защита от гонки "наш seek ещё не осел в событии timeupdate".
const NATIVE_SEEK_INFLIGHT_MS = 400

function mapReadyState(video: HTMLVideoElement): 'playing' | 'paused' | 'buffering' | 'ended' {
  if (video.ended) return 'ended'
  if (video.paused) return 'paused'
  // readyState < HAVE_FUTURE_DATA (3) во время play = буферизация (то же
  // значение, что даёт 'waiting'-событие, но геттер должен быть честен и
  // без него — например, сразу после play() до первого 'waiting'/'playing').
  if (video.readyState < 3) return 'buffering'
  return 'playing'
}

export function createNativeVideoAdapter(
  elId: string,
  videoId: string,
  opts: NativeVideoAdapterOpts,
  isCancelled?: () => boolean,
): Promise<PlayerAdapter> {
  return new Promise<PlayerAdapter>((resolve) => {
    // P-A-dev паритет с IFrameAdapter: отменённый монтаж (StrictMode double-
    // mount) не должен создавать реальный <video>/сетевые запросы вовсе.
    if (isCancelled?.()) { resolve(createNoopAdapter()); return }

    const host = document.getElementById(elId)
    const video = document.createElement('video')
    video.playsInline = true
    video.controls = false
    video.style.width = '100%'
    video.style.height = '100%'
    ;(host ?? document.body).appendChild(video)

    let destroyed = false
    let seekUntil = 0
    // Старт из ссылки (cueStart) ждёт loadedmetadata; наш seek до этого отменяет его — перемотка пользователя главнее.
    let cuePending = true
    const seekInFlight = () => performance.now() < seekUntil
    const listeners: Record<PlayerEvent, ((p?: unknown) => void)[]> =
      { state: [], ready: [], error: [], volume: [], unplayable: [] }
    const emit = (e: PlayerEvent, p?: unknown) => listeners[e].forEach(cb => cb(p))

    // warming — true пока идёт прогрев (202-поллинг), т.е. video.src ЕЩЁ не
    // назначен. buffering()-геттер и НАЧАЛЬНЫЙ 'state' держат 'buffering' всё
    // это время (владелец задачи: "юзер видит существующий буферинг-стейт").
    let warming = true
    let pollTimer: ReturnType<typeof setTimeout> | null = null
    let lastVolKey = ''
    let volPollTimer: ReturnType<typeof setInterval> | null = null

    function clearPoll() { if (pollTimer !== null) { clearTimeout(pollTimer); pollTimer = null } }

    function emitUnplayable(): void {
      warming = false
      clearPoll()
      const payload: UnplayablePayload = { reason: 'native-error' }
      emit('unplayable', payload)
    }

    // startPlayback — прогрев завершён (200 от /api/video/{id}) → назначаем
    // src (браузер сам делает Range-запросы, ServeContent на бэке их умеет).
    function startPlayback(): void {
      warming = false
      clearPoll()
      video.src = `/api/video/${encodeURIComponent(videoId)}`
      if (opts.startSeconds) {
        // H7-паритет с IFrameAdapter: seekTo целевой позиции ПОСЛЕ src, не
        // раньше (currentTime до loadedmetadata на некоторых движках — no-op).
        const applyStart = () => { video.currentTime = opts.startSeconds ?? 0 }
        video.addEventListener('loadedmetadata', applyStart, { once: true })
      } else if (opts.cueStart && opts.cueStart > 0) {
        const cue = opts.cueStart
        // t ≥ длительности → с нуля (duration в loadedmetadata уже известна)
        video.addEventListener('loadedmetadata', () => {
          if (cuePending && (!(video.duration > 0) || cue < video.duration)) video.currentTime = cue
        }, { once: true })
      }
    }

    // poll — GET /api/video/{id} раз в NATIVE_POLL_INTERVAL_MS, пока не
    // придёт что-то, кроме 202. 200 → startPlayback (тело НЕ читаем целиком —
    // .cancel() обрывает соединение сразу после статуса, иначе poll-запрос
    // скачал бы весь mp4 в никуда, а <video> потом скачал бы его ЕЩЁ раз).
    // 404 → фича выключена флагом — сразу unplayable, без дальнейших поллов
    // (владелец задачи: "404 (флаг выключен) → сразу 'unplayable'"). Любой
    // другой статус (429/502/500) — транзиентный, пробуем снова на
    // следующем тике, пока не истёк NATIVE_POLL_MAX_MS.
    const pollStartedAt = Date.now()
    function poll(): void {
      if (destroyed) return
      fetch(`/api/video/${encodeURIComponent(videoId)}`, { method: 'GET' })
        .then(res => {
          if (destroyed) return
          if (res.status === 200) {
            void res.body?.cancel().catch(() => {})
            startPlayback()
            return
          }
          if (res.status === 404) {
            emitUnplayable()
            return
          }
          if (Date.now() - pollStartedAt >= NATIVE_POLL_MAX_MS) {
            emitUnplayable()
            return
          }
          pollTimer = setTimeout(poll, NATIVE_POLL_INTERVAL_MS)
        })
        .catch(() => {
          if (destroyed) return
          if (Date.now() - pollStartedAt >= NATIVE_POLL_MAX_MS) {
            emitUnplayable()
            return
          }
          pollTimer = setTimeout(poll, NATIVE_POLL_INTERVAL_MS)
        })
    }

    video.addEventListener('loadedmetadata', () => emit('ready'))
    video.addEventListener('playing', () => emit('state', 'playing'))
    video.addEventListener('pause', () => { if (!video.ended) emit('state', 'paused') })
    video.addEventListener('waiting', () => emit('state', 'buffering'))
    video.addEventListener('ended', () => emit('state', 'ended'))
    // 'error' на <video> — сеть легла ПОСЛЕ старта, битый файл, кэш стёрт
    // ротацией (eviction, video_proxy.go) между warming и фактическим play —
    // тот же UnplayableOverlay, что embed-error/botwall-suspect у Track A.
    video.addEventListener('error', emitUnplayable)
    // Громкость — polled (тот же паттерн, что IFrameAdapter M9: эмитим
    // ТОЛЬКО на изменение, не на каждый tick), потому что нативных событий на
    // volume/muted DOM даёт ОДНО общее 'volumechange' — poll проще и надёжнее
    // отличает muted-toggle от volume-slide без доп. логики диффа события.
    volPollTimer = setInterval(() => {
      const muted = video.muted, volume = Math.round(video.volume * 100)
      const key = `${muted}:${volume}`
      if (key !== lastVolKey) { lastVolKey = key; emit('volume', { muted, volume }) }
    }, 150)

    const adapter: PlayerAdapter = {
      currentTime: () => video.currentTime || 0,
      duration: () => (Number.isFinite(video.duration) ? video.duration : 0),
      paused: () => video.paused,
      rate: () => video.playbackRate,
      muted: () => video.muted,
      volume: () => Math.round(video.volume * 100), // 0..100, паритет с YouTube-шкалой (см. PlayerAdapter.ts)
      buffering: () => warming || mapReadyState(video) === 'buffering',
      // loadedFraction — доля буфера ОТ ДЛИТЕЛЬНОСТИ (video.buffered — набор
      // непрерывных отрезков; берём конец ПОСЛЕДНЕГО, консервативно
      // приближает getVideoLoadedFraction() семантику YT-адаптера).
      loadedFraction: () => {
        const dur = video.duration
        if (!Number.isFinite(dur) || dur <= 0 || video.buffered.length === 0) return 0
        return Math.min(1, video.buffered.end(video.buffered.length - 1) / dur)
      },
      isOurSeekInFlight: seekInFlight,
      // Нативный <video> НЕ даёт список поддерживаемых скоростей (в отличие
      // от YT.getAvailablePlaybackRates) — фиксированный набор, который
      // одинаково широко работает во всех современных браузерах.
      getAvailableRates: () => [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2],
      seek: (t) => {
        cuePending = false
        seekUntil = performance.now() + NATIVE_SEEK_INFLIGHT_MS
        video.currentTime = t
      },
      play: () => { video.play()?.catch(() => { /* автоплей-политика/ещё не готов — не наша забота здесь */ }) },
      pause: () => { try { video.pause() } catch { /* jsdom/некоторые движки — не критично для контракта */ } },
      setRate: (r) => { video.playbackRate = r },
      mute: () => { video.muted = true },
      unmute: () => { video.muted = false },
      setVolume: (v) => { video.volume = Math.max(0, Math.min(100, v)) / 100 },
      on: (evt, cb) => { listeners[evt].push(cb); return () => { const i = listeners[evt].indexOf(cb); if (i >= 0) listeners[evt].splice(i, 1) } },
      destroy: () => {
        destroyed = true
        clearPoll()
        if (volPollTimer !== null) { clearInterval(volPollTimer); volPollTimer = null }
        ;(Object.keys(listeners) as PlayerEvent[]).forEach(k => { listeners[k].length = 0 })
        video.removeEventListener('error', emitUnplayable)
        // pause()/load() — best-effort: реальные браузеры их поддерживают
        // всегда, jsdom (юнит-тесты) кидает "not implemented" — не даём этому
        // сломать сам teardown (src/DOM ниже снимаются безусловно).
        try { video.pause() } catch { /* см. коммент выше */ }
        video.removeAttribute('src')
        try { video.load() } catch { /* обрывает текущую загрузку/буферизацию — не жжём сеть после destroy */ }
        video.remove()
      },
    }

    resolve(adapter)
    // Первый fetch — НЕ синхронно в конструкторе, а следующим тиком: даёт
    // вызывающему (PlayerRoot → PlayerPage useEffect) шанс подписаться через
    // adapter.on('unplayable', …) ДО того, как может прилететь ответ. В
    // проде это и так гарантировано сетевым RTT (fetch никогда не резолвится
    // синхронно), здесь — явная защита от гонки в юнит-тестах, где
    // замоканный fetch может отрезолвиться в тот же микротаск.
    setTimeout(() => {
      if (destroyed) return
      // Пока файла нет — сразу видно "буферизация" (владелец задачи: "юзер
      // видит существующий буферинг-стейт плеера"), НЕ мёртвый экран.
      emit('state', 'buffering')
      poll()
    }, 0)
  })
}

// P-A-dev: заглушка для отменённого монтажа — паритет createNoopAdapter в
// IFrameAdapter.ts (без DOM/сети, безопасный no-op destroy()).
function createNoopAdapter(): PlayerAdapter {
  return {
    currentTime: () => 0, duration: () => 0, paused: () => true, rate: () => 1, muted: () => false, volume: () => 0,
    buffering: () => false, loadedFraction: () => 0, isOurSeekInFlight: () => false, getAvailableRates: () => [1],
    seek: () => {}, play: () => {}, pause: () => {}, setRate: () => {}, mute: () => {}, unmute: () => {}, setVolume: () => {},
    on: () => () => {},
    destroy: () => {},
  }
}
