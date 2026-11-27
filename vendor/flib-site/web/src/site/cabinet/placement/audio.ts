// Звук теста на сайте (спека §4 «Звук»; порт PL/src/audio.ts). Файлы слов отдаёт BFF
// (`/api/placement/audio/<имя>`); на каждое задание — fetch → blob → objectURL, до 3 попыток
// (паузы 0, 1, 3 с; таймаут попытки 10 с). Один <audio> на страницу — проигрывания не накладываются:
// новое отменяет прежнее.
//
// Исход:
//   played    — звук доигран (событие ended; playing — ещё не «услышано», прерывание посреди слова);
//   failed    — ошибка воспроизведения (декодер), отказ play() кроме NotAllowedError или тишина
//               AUDIO_TIMEOUT_MS до старта: экран отвечает пропуском (skipped), а движок после MaxSkipRun
//               подряд сам ставит no_audio + floor;
//   network   — файл не скачан (сеть, 5xx, 503 audio_not_ready): НЕ пропуск — сеть не портит прогон,
//               экран предлагает «Повторить»;
//   hidden    — страница скрыта (звук не стартует или остановлен скрытием);
//   cancelled — прервано (новое проигрывание, blur, dispose) и NotAllowedError (браузер не дал играть
//               без нажатия: «звук на паузе», «Повторить звук»), не сбой.
// Safari/iOS: play() должен идти синхронно в обработчике нажатия. Поэтому preload(url) заранее кладёт
// blob в кэш, и play() для такого url доходит до audio.play() без единого await.
import { audioFileOf } from './engine/bank'

export const AUDIO_TIMEOUT_MS = 3000
/** Страховка после playing: ended не пришёл за max(PLAY_STALL_MS, 3 × длительность) — слово было слышно, played. */
export const PLAY_STALL_MS = 6000
export const FETCH_TIMEOUT_MS = 10_000
export const FETCH_DELAYS_MS: readonly number[] = [0, 1000, 3000]
const CACHE_MAX = 8

export type PlayResult = 'played' | 'failed' | 'hidden' | 'cancelled' | 'network'

export interface Player {
  play(url: string): Promise<PlayResult>
  /** Заранее скачать файл (S0 — слово проверки звука); повторный вызов и скачанный файл — без запроса. */
  preload(url: string): void
  /** Остановить звук; ожидающее play → cancelled. */
  stop(): void
  /** Снять звук, слушатели и objectURL; дальше play → cancelled. */
  dispose(): void
}

/** URL файла задания на сайте. */
export function audioUrlOf(it: { lemma: string; pseudo: boolean }): string {
  return `/api/placement/audio/${audioFileOf(it.pseudo ? 'pseudo' : 'word', it.lemma)}`
}

/** Ogg Opus (Safari до 18.4 его не играет, запасного формата нет — спека Р-8). */
export function isAudioSupported(): boolean {
  try {
    return document.createElement('audio').canPlayType('audio/ogg; codecs="opus"') !== ''
  } catch {
    return false
  }
}

export interface PlayerOptions {
  timeoutMs?: number
  makeAudio?: () => HTMLAudioElement
  fetch?: (url: string, init: RequestInit) => Promise<Response>
  delaysMs?: readonly number[]
  fetchTimeoutMs?: number
}

type Fetched = { kind: 'ok'; blob: Blob } | { kind: 'network' } | { kind: 'aborted' }

export function createPlayer(opts: PlayerOptions = {}): Player {
  const timeoutMs = opts.timeoutMs ?? AUDIO_TIMEOUT_MS
  const delays = opts.delaysMs ?? FETCH_DELAYS_MS
  const fetchTimeout = opts.fetchTimeoutMs ?? FETCH_TIMEOUT_MS
  const doFetch = opts.fetch ?? ((u: string, i: RequestInit) => fetch(u, i))
  let el: HTMLAudioElement | null = null
  let disposed = false
  let curObjUrl: string | null = null
  /** Ожидающее проигрывание: снять слушатели/запрос и отдать исход. */
  let pending: ((r: PlayResult) => void) | null = null
  const cache = new Map<string, Blob>()
  const inflight = new Map<string, Promise<Fetched>>()
  const life = new AbortController() // dispose обрывает и предзагрузки

  const audio = () => {
    if (!el) {
      el = opts.makeAudio ? opts.makeAudio() : new Audio()
      el.preload = 'auto'
    }
    return el
  }

  const remember = (url: string, b: Blob) => {
    cache.delete(url)
    cache.set(url, b)
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string)
  }

  const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((res) => {
    if (ms <= 0 || signal.aborted) { res(); return }
    const t = setTimeout(done, ms)
    function done() { clearTimeout(t); signal.removeEventListener('abort', done); res() }
    signal.addEventListener('abort', done, { once: true })
  })

  async function fetchBlob(url: string, signal: AbortSignal): Promise<Fetched> {
    for (let i = 0; i < delays.length; i++) {
      await sleep(delays[i], signal)
      if (signal.aborted) return { kind: 'aborted' }
      const ctl = new AbortController()
      const onAbort = () => ctl.abort()
      signal.addEventListener('abort', onAbort, { once: true })
      const timer = setTimeout(() => ctl.abort(), fetchTimeout)
      try {
        const res = await doFetch(url, { signal: ctl.signal })
        // Скачанным считается только 200, не пустой, Content-Type audio/ogg: 404, 503 audio_not_ready,
        // text/html от прокси и пустое тело — повтор, затем network (файл не получен, это не сбой слова).
        if (res.status === 200 && (res.headers?.get('Content-Type') ?? '').toLowerCase().startsWith('audio/ogg')) {
          const blob = await res.blob()
          if (blob.size > 0) return { kind: 'ok', blob }
        }
      } catch {
        if (signal.aborted) return { kind: 'aborted' }
      } finally {
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
      }
    }
    return { kind: signal.aborted ? 'aborted' : 'network' }
  }

  /** Один запрос на url в полёте (предзагрузка и play делят его). */
  function load(url: string, signal: AbortSignal, own = false): Promise<Fetched> {
    const have = own ? undefined : inflight.get(url)
    if (have) return have
    const p = fetchBlob(url, signal).then((r) => {
      if (r.kind === 'ok') remember(url, r.blob)
      return r
    }).finally(() => { if (inflight.get(url) === p) inflight.delete(url) })
    if (!own) inflight.set(url, p) // собственное скачивание play (его обрывает stop) общим не становится
    return p
  }

  const settle = (r: PlayResult) => {
    const p = pending
    pending = null
    p?.(r)
  }
  const halt = (r: PlayResult) => {
    settle(r)
    if (el) el.pause()
  }
  const stop = () => halt('cancelled')

  const onHide = () => { if (document.visibilityState === 'hidden') halt('hidden') }
  window.addEventListener('blur', stop)
  document.addEventListener('visibilitychange', onHide)

  return {
    play(url) {
      stop()
      if (disposed) return Promise.resolve<PlayResult>('cancelled')
      if (document.visibilityState === 'hidden') return Promise.resolve<PlayResult>('hidden')
      return new Promise<PlayResult>((resolve) => {
        let timer: ReturnType<typeof setTimeout> | undefined
        let a: HTMLAudioElement | null = null
        const onPlaying = () => {
          clearTimeout(timer)
          const d = a?.duration ?? NaN
          const stall = Number.isFinite(d) && d > 0 ? Math.max(PLAY_STALL_MS, 3 * d * 1000) : PLAY_STALL_MS
          timer = setTimeout(() => { if (pending === done) settle('played') }, stall)
        }
        const onEnded = () => settle('played')
        const onError = () => { a?.pause(); settle('failed') }
        const ctl = new AbortController() // обрывает собственное скачивание (не предзагрузку) при stop/новом play
        const shared = inflight.has(url)
        const done = (r: PlayResult) => {
          clearTimeout(timer)
          if (!shared) ctl.abort()
          if (a) {
            a.removeEventListener('playing', onPlaying)
            a.removeEventListener('ended', onEnded)
            a.removeEventListener('error', onError)
          }
          resolve(r)
        }
        pending = done

        const start = (blob: Blob) => {
          a = audio()
          a.addEventListener('playing', onPlaying)
          a.addEventListener('ended', onEnded)
          a.addEventListener('error', onError)
          timer = setTimeout(() => { if (pending === done) onError() }, timeoutMs)
          const next = URL.createObjectURL(blob)
          a.src = next
          // Прежний objectURL освобождается ПОСЛЕ того, как новый src выставлен.
          const prev = curObjUrl
          curObjUrl = next
          if (prev) URL.revokeObjectURL(prev)
          let started: Promise<void> | undefined
          try {
            started = a.play()
          } catch (e) {
            if (pending === done) {
              if ((e as { name?: string })?.name === 'NotAllowedError') halt('cancelled')
              else onError()
            }
            return
          }
          started?.catch((e: unknown) => {
            if (pending !== done) return
            if ((e as { name?: string })?.name === 'NotAllowedError') halt('cancelled')
            else onError()
          })
        }

        const cached = cache.get(url)
        if (cached) { start(cached); return } // синхронно: iOS играет только из обработчика нажатия
        // Скачивание живёт до dispose: предзагрузку и общий запрос новое play не обрывает.
        void load(url, shared ? life.signal : ctl.signal, !shared).then((r) => {
          if (pending !== done) return
          if (r.kind === 'ok') start(r.blob)
          else settle(r.kind === 'aborted' ? 'cancelled' : 'network')
        })
      })
    },
    preload(url) {
      if (disposed || cache.has(url) || inflight.has(url)) return
      void load(url, life.signal)
    },
    stop,
    dispose() {
      if (disposed) return
      disposed = true
      stop()
      life.abort()
      window.removeEventListener('blur', stop)
      document.removeEventListener('visibilitychange', onHide)
      if (el) {
        el.removeAttribute('src')
        el.load()
      }
      if (curObjUrl) { URL.revokeObjectURL(curObjUrl); curObjUrl = null }
      cache.clear()
    },
  }
}
