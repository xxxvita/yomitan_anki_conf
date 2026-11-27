// translate-api.ts — клиент BFF-ручки перевода (образец examples-api: union без
// throw). Разбирает контрактные статусы в дискриминированный результат.
import { parseRetryAfterSec } from '../site/retry-after'

export interface TranslateRespCue {
  en: string
  ru: string
  start: number
  end: number
}

export type TranslateResult =
  | { status: 'ok'; cues: TranslateRespCue[]; source: string } // 200 {cues:[…]}
  | { status: 'empty' } // 200 {cues:[]} — тишина
  | { status: 'busy'; retryAfterSec: number; kind: '429' | '503' } // 429/503
  | { status: 'not_in_corpus' } // 404 — скрыть для этого видео
  | { status: 'forbidden' } // 403 — операторский мисконфиг, сессионный дизейбл
  | { status: 'error' } // 400 / 5xx / BFF 405/502 / сеть / малформ — не показывать

// TRANSLATE_DEFAULT_RETRY_SEC — дефолт, когда 429/503 не принёс ни заголовка, ни
// тела с Retry-After (напр. семафорный writeBusy BFF шлёт 429 без Retry-After).
export const TRANSLATE_DEFAULT_RETRY_SEC = 5
// TRANSLATE_MAX_RETRY_SEC — потолок (1ч) на значение из шлюза (Fable LOW-2):
// астрономический Retry-After запер бы пилюлю на весь маунт, а >~2.1e6с
// переполнил бы setTimeout ре-энейбла в 1мс → busy-loop ре-рендеров.
export const TRANSLATE_MAX_RETRY_SEC = 3600

export async function translateWindow(videoId: string, fromMs: number, toMs: number): Promise<TranslateResult> {
  try {
    const res = await fetch('/api/youtube/subtitles/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ video_id: videoId, from_ms: fromMs, to_ms: toMs }),
    })
    if (res.status === 200) {
      const body = await res.json().catch(() => null)
      const cues = (body as { cues?: unknown } | null)?.cues
      if (!Array.isArray(cues)) return { status: 'error' } // малформ-200
      if (cues.length === 0) return { status: 'empty' }
      return { status: 'ok', cues: cues as TranslateRespCue[], source: res.headers.get('X-Subtitle-Source') ?? '' }
    }
    if (res.status === 404) return { status: 'not_in_corpus' }
    if (res.status === 403) return { status: 'forbidden' }
    if (res.status === 429 || res.status === 503) {
      const body = await res.json().catch(() => null)
      const ra = Math.min(parseRetryAfterSec(res.headers.get('Retry-After'), body) ?? TRANSLATE_DEFAULT_RETRY_SEC, TRANSLATE_MAX_RETRY_SEC)
      return { status: 'busy', retryAfterSec: ra, kind: res.status === 429 ? '429' : '503' }
    }
    return { status: 'error' } // 400 / 5xx / BFF 405/502
  } catch {
    return { status: 'error' } // сеть/парс
  }
}
