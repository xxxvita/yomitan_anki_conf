import { useEffect, useRef, useState } from 'react'
import type { PlayerAdapter } from '../../adapter/PlayerAdapter'
import { findActiveCueIndex } from '../../lib/active-cue'
import { parseRetryAfterSec } from '../../site/retry-after'

export interface Cue { start: number; end: number; text_en: string; text_ru: string }
interface Bundle { video_id: string; source_language: string; cues: Cue[] }

// ── 503 + Retry-After [ID:P-subs-503] ───────────────────────────────────────
// Для видео вне закэшированного маршрута (случайные/свои ссылки юзера)
// gateway при невозможности достать субтитры СЕЙЧАС (весь egress-пул на
// cooldown после 429 YouTube, до 6ч worst-case) отдаёт 503 + Retry-After —
// НЕ 404 (у видео правда нет субтитров, постоянный ответ) и НЕ 200-пустой.
// Видео и так non-blocking (играет независимо от субтитров) — здесь только
// решаем, сколько клиенту имеет смысл ждать/поллить В РАМКАХ ЭТОГО сеанса.
//
// SUBS_POLL_CAP — порог «короткий retry_after (прокси вот-вот остынет) →
// стоит подождать и попробовать снова» vs «гейтвей сказал ждать часами →
// долбить бессмысленно, юзер успеет уйти, честнее сразу сказать
// "недоступны"». 20с — с запасом над владельческой моделью типичной
// ротации прокси (~17с).
// SUBS_POLL_WINDOW — суммарный бюджет поллинга НА ЭТО видео за сеанс: даже
// если каждый отдельный retry_after короткий, но субтитры так и не долетели
// за 3 минуты (прокси раз за разом уходят в cooldown) — прекращаем фоновый
// таймер, а не молотим бесконечно за спиной ушедшего пользователя.
export const SUBS_POLL_CAP = 20
export const SUBS_POLL_WINDOW = 180
const SUBS_POLL_MIN_DELAY = 3 // пол интервала в секундах — защита от busy-loop, если гейтвей вернёт retry_after<=0

// 'no_subtitles' (404, постоянно) ОТЛИЧАЕТСЯ от 'unavailable' (503, временно —
// может ещё долететь в эту же сессию). 'error' — прочие статусы/сеть, как раньше.
export type SubtitlesStatus = 'ok' | 'no_subtitles' | 'unavailable' | 'error'

type FetchOutcome =
  | { kind: 'ok'; bundle: Bundle; source: string | null }
  | { kind: 'no_subtitles' }
  | { kind: 'unavailable'; retryAfter: number | null }
  | { kind: 'error'; message: string }

export function useSubtitles(videoId: string, adapter: PlayerAdapter | null) {
  const [cues, setCues] = useState<Cue[]>([])
  const [activeIndex, setActiveIndex] = useState(-1)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<SubtitlesStatus>('ok')
  // retrying=true, ПОКА идёт поллинг короткого 503 — UI отличает «скоро
  // попробуем ещё» от «сдались, попробуй позже сам» (оба status='unavailable').
  const [retrying, setRetrying] = useState(false)
  // source — X-Subtitle-Source EN-дорожки (BFF пробрасывает метку шлюза; спека
  // кабинета 2026-11-17 §4.8): читатель — subs_source событий маршрута.
  const [source, setSource] = useState<string | null>(null)
  const rafRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    let timerId: number | undefined
    const deadline = Date.now() + SUBS_POLL_WINDOW * 1000
    setCues([]); setActiveIndex(-1); setError(null); setStatus('ok'); setRetrying(false); setSource(null)
    if (!videoId) return () => { cancelled = true } // пустой videoId — не шлём bad-request

    const classify = async (r: Response): Promise<FetchOutcome> => {
      // headers?.get — ответ-заглушка тестов и старые полифиллы бывают без заголовков:
      // источник тогда неизвестен, субтитры всё равно показываются.
      if (r.ok) return { kind: 'ok', bundle: (await r.json()) as Bundle, source: r.headers?.get?.('X-Subtitle-Source') ?? null }
      if (r.status === 404) return { kind: 'no_subtitles' }
      if (r.status === 503) {
        // Тело — приоритетный канал; заголовок Retry-After — fallback.
        // parseRetryAfterSec сохраняет ту же семантику: null = «ничего не
        // распарсилось» → ниже трактуется как «не поллить» (см. attempt).
        const body = await r.json().catch(() => null)
        const retryAfter = parseRetryAfterSec(r.headers.get('Retry-After'), body)
        return { kind: 'unavailable', retryAfter }
      }
      return { kind: 'error', message: `err_${r.status}` }
    }

    const attempt = () => {
      fetch(`/api/youtube/subtitles?v=${encodeURIComponent(videoId)}`)
        .then(classify)
        .catch((e) => ({ kind: 'error' as const, message: String(e) }))
        .then((result: FetchOutcome) => {
          if (cancelled) return
          if (result.kind === 'ok') {
            setCues(result.bundle.cues ?? []); setStatus('ok'); setRetrying(false); setError(null); setSource(result.source)
            return
          }
          if (result.kind === 'no_subtitles') {
            setStatus('no_subtitles'); setRetrying(false)
            return
          }
          if (result.kind === 'error') {
            setStatus('error'); setRetrying(false); setError(result.message)
            return
          }
          // 'unavailable' (503): retryAfter=null (гейтвей не сказал ничего
          // парсибельного) — трактуем как "не знаем, когда" → не поллим
          // (честнее сдаться, чем угадывать интервал).
          const ra = result.retryAfter
          const delaySec = ra != null ? Math.max(ra, SUBS_POLL_MIN_DELAY) : null
          const withinWindow = delaySec != null && Date.now() + delaySec * 1000 <= deadline
          const shortEnough = ra != null && ra <= SUBS_POLL_CAP
          setStatus('unavailable')
          if (shortEnough && withinWindow) {
            setRetrying(true)
            timerId = window.setTimeout(attempt, delaySec! * 1000)
          } else {
            setRetrying(false) // длинный retry_after ИЛИ окно исчерпано — сдаёмся честно, не долбим
          }
        })
    }
    attempt()
    // token-guard: смена videoId/unmount отменяет и устаревший fetch (через
    // cancelled), и запланированный таймер поллинга (иначе он всплыл бы уже
    // после смены видео и перезаписал cues/status чужого videoId).
    return () => { cancelled = true; if (timerId !== undefined) window.clearTimeout(timerId) }
  }, [videoId])

  useEffect(() => {
    if (!adapter || cues.length === 0) return
    const tick = () => {
      setActiveIndex(findActiveCueIndex(cues, adapter.currentTime())) // clock-shim интерполяция
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [adapter, cues])

  return { cues, activeIndex, error, status, retrying, source }
}
