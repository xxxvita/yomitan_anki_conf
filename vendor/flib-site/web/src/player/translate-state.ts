// translate-state.ts — чистое состояние доступности перевода (единая модель для
// пилюли И пункта меню; Fable H2). inFlight гейтит ОБА входа; disabledUntilMs —
// per-key лимит 429/503 (общий на сайт → переживает смену videoId); notInCorpus
// — per-video 404; forbidden — 403 (мисконфиг ключа, сессионный дизейбл).
//
// ⚠️ Fable HIGH-1: КАЖДОЕ терминальное событие снимает inFlight (иначе busy/404/
// 403 оставили бы кнопку мёртвой навсегда).
// ⚠️ Fable MED-2 scope: «переживает videoId» = переживает смену ?v= в рамках
// смонтированного PlayerPage (route-away/reload сбрасывают — это mount-scope, не
// browser-session). НЕ сбрасывать это состояние на смене videoId.

export interface TranslateState {
  inFlight: boolean
  disabledUntilMs: number
  notInCorpus: Set<string>
  forbidden: boolean
}

export const initialTranslateState: TranslateState = {
  inFlight: false,
  disabledUntilMs: 0,
  notInCorpus: new Set(),
  forbidden: false,
}

export type TranslateEvent =
  | { type: 'request' }
  | { type: 'ok' }
  | { type: 'empty' }
  | { type: 'error' }
  | { type: 'busy'; retryAfterSec: number; nowMs: number }
  | { type: 'not_in_corpus'; videoId: string }
  | { type: 'forbidden' }

export function translateReducer(s: TranslateState, ev: TranslateEvent): TranslateState {
  switch (ev.type) {
    case 'request':
      return { ...s, inFlight: true }
    case 'ok':
    case 'empty':
    case 'error':
      return { ...s, inFlight: false }
    case 'busy':
      // max — не укорачивать уже действующий более длинный дизейбл.
      return { ...s, inFlight: false, disabledUntilMs: Math.max(s.disabledUntilMs, ev.nowMs + ev.retryAfterSec * 1000) }
    case 'not_in_corpus': {
      const notInCorpus = new Set(s.notInCorpus) // копия (чистота, Fable LOW-g)
      notInCorpus.add(ev.videoId)
      return { ...s, inFlight: false, notInCorpus }
    }
    case 'forbidden':
      return { ...s, inFlight: false, forbidden: true }
  }
}

export function isTranslateDisabled(s: TranslateState, videoId: string, nowMs: number): boolean {
  return s.inFlight || nowMs < s.disabledUntilMs || s.notInCorpus.has(videoId) || s.forbidden
}
