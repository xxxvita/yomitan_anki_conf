// route-api.ts — клиент `/api/me/route/*` в браузере (спека 2026-11-17 §4.3, §5,
// план B7). Ключа здесь нет: его держит cookie сессии, BFF ходит на шлюз сам.
//
// Автоповтор решается по КОДУ ошибки, а не по статусу (§4.3):
//   • временный сбой — `502 gateway_unavailable`, любой `503 <код>` и `502`/`503`
//     БЕЗ разбираемого JSON-кода BFF (тело не JSON или без `error` — ответ туннеля
//     или края Cloudflare, F-M1): повтор по Retry-After (нет — 5 с), затем
//     перечитать состояние;
//   • отказ шлюза — `502 gateway_refused` и `502` с РАЗОБРАННЫМ, но незнакомым
//     кодом: постоянный, без повтора;
//   • `429` — ждать Retry-After на КАЖДОМ (норма 1 клиентов шлюза).
import { CSRF_HEADERS } from '../../session'
import { parseRetryAfterSec } from '../../retry-after'

// --- проекции BFF (§4.2) ------------------------------------------------------------

export interface RouteParams { daily_listening_budget_min: number | null; daily_new_words: number | null }

export interface DayClipKept {
  puzzle_id: string; kind: string; video_id?: string; title?: string; series_title?: string; source?: string
  duration_sec?: number; delivered: true; played: true; kept: true; words?: string[]
}
export interface DayClipDelivered {
  puzzle_id: string; kind: 'youtube' | 'words' | 'other' | string; video_id?: string; title?: string
  series_title?: string; source?: string; duration_sec?: number; delivered: true; played: boolean
  queued_played: boolean; new_words: number; words: string[]
}
export interface DayClipUndelivered { delivered: false; duration_sec?: number; new_words: number }
export type DayClip = DayClipKept | DayClipDelivered | DayClipUndelivered

export interface ActiveExchange { job_id: string; status: string; created_at: string }

// ExtraRow — строка «дополнительного видео» (спека extra-video §7).
export interface ExtraRow {
  puzzle_id: string; kind: string; video_id?: string; title?: string; series_title?: string; source?: string
  duration_sec?: number; played: boolean
}
export type ExtraOutcome = 'clip' | 'none' | 'failed' | null

// HeardQuestion — открытый вопрос «Тест после ролика» (безопасная проекция BFF:
// ключа ответа здесь нет и быть не может).
export interface HeardQuestion { id: string; kind: 'heard_check' | string; puzzle_id: string; words: string[] }

export interface RouteState {
  started: boolean
  route_id: string | null
  revision: number
  snapshot_date: string | null
  started_at: string | null
  goal_label: string
  params: RouteParams
  day: { date: string; clips: DayClip[] } | null
  next_clip: { title?: string } | null
  current_puzzle_id: string | null
  replace_available: boolean
  stop_reason: string | null
  active_exchange: ActiveExchange | null
  // Старый BFF поля не знает — отсутствие = вопросов нет.
  heard_check_questions?: HeardQuestion[]
  // Старый BFF полей не знает — отсутствие = дополнительных видео нет.
  extras?: ExtraRow[]
  extra_available?: boolean
  extra_active?: ActiveExchange | null
}

export interface RouteJob {
  status: string
  committed: boolean
  committed_revision: number | null
  cancel_reason: string | null
  error_code: string | null
}

export interface RouteProgress { track_key: string; position_ms: number; heard_max: number; state: unknown }

// --- ответы --------------------------------------------------------------------------

export type ErrClass = 'temporary' | 'refused' | 'rate' | 'other'

export interface ApiError {
  ok: false
  status: number      // 0 — сеть, таймаут
  code: string | null // JSON-код BFF (error / code), прошедший ^[a-z_]{1,64}$
  retryAfterSec: number | null
  cls: ErrClass
  body: Record<string, unknown> | null
}
export interface ApiOk<T> { ok: true; status: number; data: T }
export type ApiResult<T> = ApiOk<T> | ApiError

// Коды `502`, которые BFF ставит сам: прочие разобранные коды `502` — отказ.
const TEMP_502 = new Set(['gateway_unavailable'])

// classifyError — решение автоповтора по коду (§4.3, план B7).
export function classifyError(status: number, code: string | null): ErrClass {
  if (status === 0) return 'temporary'
  if (status === 429) return 'rate'
  if (status === 503) return 'temporary'
  if (status === 502) {
    if (code === null) return 'temporary'
    return TEMP_502.has(code) ? 'temporary' : 'refused'
  }
  return 'other'
}

// retryDelaySec — пауза до повтора временного сбоя или 429: Retry-After, нет — 5 с.
export function retryDelaySec(e: ApiError): number {
  return e.retryAfterSec && e.retryAfterSec > 0 ? e.retryAfterSec : 5
}

export const LONG_TIMEOUT_MS = 100_000
export const SHORT_TIMEOUT_MS = 30_000

function codeOf(body: unknown): string | null {
  const b = body as { code?: unknown; error?: unknown } | null
  const c = typeof b?.code === 'string' ? b.code : typeof b?.error === 'string' ? b.error : null
  return c && /^[a-z_]{1,64}$/.test(c) ? c : null
}

export interface ApiDeps { fetch: (url: string, init: RequestInit) => Promise<Response> }
const defaultDeps: ApiDeps = { fetch: (u, i) => fetch(u, i) }

export async function apiCall<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string,
  o: { body?: unknown; timeoutMs?: number; deps?: ApiDeps; csrf?: boolean } = {},
): Promise<ApiResult<T>> {
  const deps = o.deps ?? defaultDeps
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), o.timeoutMs ?? SHORT_TIMEOUT_MS)
  const headers: Record<string, string> = { Accept: 'application/json' }
  // GET — без заголовка сторожа, кроме ручки примеров: каждый её вызов тратит
  // квоту ключа, и BFF требует X-Flib-Request: 1 (§3.4, R-C1).
  if (method !== 'GET' || o.csrf) Object.assign(headers, CSRF_HEADERS)
  if (o.body !== undefined) headers['Content-Type'] = 'application/json'
  let res: Response
  try {
    res = await deps.fetch(url, {
      method, credentials: 'same-origin', headers, signal: ctl.signal,
      ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}),
    })
  } catch {
    clearTimeout(t)
    return { ok: false, status: 0, code: null, retryAfterSec: null, cls: 'temporary', body: null }
  }
  let data: unknown = null
  try { data = await res.json() } catch { data = null } finally { clearTimeout(t) }
  if (res.ok) return { ok: true, status: res.status, data: data as T }
  const body = data && typeof data === 'object' ? data as Record<string, unknown> : null
  const code = codeOf(body)
  return {
    ok: false, status: res.status, code,
    retryAfterSec: parseRetryAfterSec(res.headers.get('Retry-After'), body),
    cls: classifyError(res.status, code), body,
  }
}

/** goal быстрого старта; titles — slug тайтлов каталога (≤ 10, спека §7.3). При
 *  включённом каталоге puzzle_ids — только youtube::<11>. */
export interface QuickStartGoal {
  puzzle_ids?: string[]
  titles?: string[]
  categories?: string[]
  words?: string[]
  text_queries?: string[]
  label?: string
  /** request_id сбора «Моих целей»: BFF берёт леммы из него. */
  source_request_id?: string
}

export interface ExchangeBody {
  expected_revision: number
  want: 'next' | 'replace'
  for_date: string
  replace_puzzle_id?: string
  replace_reason?: string
}

export const routeApi = {
  state: (deps?: ApiDeps) => apiCall<RouteState>('GET', '/api/me/route/state', { deps }),
  job: (id: string, deps?: ApiDeps) => apiCall<RouteJob>('GET', `/api/me/route/jobs/${encodeURIComponent(id)}`, { deps }),
  exchange: (body: ExchangeBody, deps?: ApiDeps) =>
    apiCall<{ job_id: string; base_revision: number }>('POST', '/api/me/route/exchange', { body, timeoutMs: LONG_TIMEOUT_MS, deps }),
  extra: (forDate: string, deps?: ApiDeps) =>
    apiCall<{ job_id: string }>('POST', '/api/me/route/extra', { body: { for_date: forDate }, timeoutMs: LONG_TIMEOUT_MS, deps }),
  extraJob: (id: string, deps?: ApiDeps) =>
    apiCall<{ status: string; outcome: ExtraOutcome }>('GET', `/api/me/route/extra-jobs/${encodeURIComponent(id)}`, { deps }),
  quickStart: (body: Record<string, unknown> & { goal?: QuickStartGoal }, deps?: ApiDeps) =>
    apiCall<{ job_id: string; revision: number }>('POST', '/api/me/route/quick-start', { body, timeoutMs: LONG_TIMEOUT_MS, deps }),
  params: (body: { daily_listening_budget_min?: number; daily_new_words?: number }, deps?: ApiDeps) =>
    apiCall<Record<string, never>>('PUT', '/api/me/route/params', { body, deps }),
  reset: (deps?: ApiDeps) => apiCall<{ removed: number }>('DELETE', '/api/me/route', { deps }),
  days: (from: string, to: string, deps?: ApiDeps) =>
    apiCall<{ days: unknown[] }>('GET', `/api/me/route/days?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { deps }),
  examples: (word: string, deps?: ApiDeps) =>
    apiCall<unknown>('GET', `/api/me/route/examples?word=${encodeURIComponent(word)}`, { deps, csrf: true }),
  getProgress: (puzzleId: string, deps?: ApiDeps) =>
    apiCall<RouteProgress>('GET', `/api/me/route/progress?puzzle_id=${encodeURIComponent(puzzleId)}`, { deps }),
  // Названия роликов целей: titles — узнанные, pending — узнать сейчас не вышло (повторить позже).
  videoTitles: (ids: string[], deps?: ApiDeps) =>
    apiCall<{ titles: Record<string, string>; pending: string[] }>('GET', `/api/me/route/video-titles?ids=${ids.map(encodeURIComponent).join(',')}`, { deps }),
  putProgress: (puzzleId: string, body: { track_key: string; position_ms: number; heard_total: number; state: unknown }, deps?: ApiDeps) =>
    apiCall<{ ok: boolean }>('PUT', `/api/me/route/progress?puzzle_id=${encodeURIComponent(puzzleId)}`, { body, deps }),
}

// --- «Мои цели»: сбор слов из роликов пользователя ----------------------------------

export interface GoalVideoView {
  video_id: string; status: string; error?: string; title?: string; duration_sec?: number
}
export interface GoalLimitView {
  daily_limit: number; used: number; remaining: number | null; resets_at?: string
}
export interface GoalView {
  request_id: string; status: string; reason?: string; revision: number
  total: number; ready_count: number
  videos: GoalVideoView[]
  limit?: GoalLimitView
  worker_online: boolean
}
export type GoalResult =
  | { ok: true; goal: GoalView }
  | { ok: false; status: number; code: string; retryAfterSec?: number; resetsAt?: string }

function goalResult(r: ApiResult<GoalView>): GoalResult {
  if (r.ok) return { ok: true, goal: r.data }
  const out: GoalResult = { ok: false, status: r.status, code: r.code ?? 'unknown' }
  if (r.retryAfterSec !== null && r.retryAfterSec > 0) out.retryAfterSec = r.retryAfterSec
  const ra = r.body?.resets_at
  if (typeof ra === 'string') out.resetsAt = ra
  return out
}

export async function createGoal(
  body: { video_urls: string[]; client_request_id: string }, deps?: ApiDeps,
): Promise<GoalResult> {
  return goalResult(await apiCall<GoalView>('POST', '/api/me/route/goals', { body, deps }))
}

export async function getGoal(id: string, deps?: ApiDeps): Promise<GoalResult> {
  return goalResult(await apiCall<GoalView>('GET', `/api/me/route/goals/${encodeURIComponent(id)}`, { deps }))
}
