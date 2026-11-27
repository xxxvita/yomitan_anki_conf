// placement-api.ts — клиент `/api/me/placement*` (тест уровня, кабинет). Ключа здесь нет: его держит
// cookie сессии. Ответы BFF — internal/bff/cabinet_placement.go (спека §3.2–3.3).
import { apiCall, LONG_TIMEOUT_MS, type ApiDeps, type ApiResult } from '../route/route-api'
import { refreshSession } from '../../session'

export interface PlacementFile {
  owner: string
  rev: number
  /** Ключи `kv:pt.history`, `docs:pt_results/last`, `docs:pt_pending/<run_id>` … → JSON. */
  items: Record<string, unknown>
  applied_run_id: string | null
  declined_run_id: string | null
}

export interface PlacementSummary {
  owner: string
  last: null | { run_id: string; level: string; taken_at: string; vocab_size: number | null; word_count: number; valid: boolean; floor?: boolean }
  applied: boolean
  declined: boolean
  pending: boolean
}

export interface ApplyWord { lemma: string; confidence: number }

// 401 — сессия кончилась: снимок перечитывается (охрана кабинета сама уведёт на вход). С подменой
// сети (тесты) снимок не трогаем.
function guard<T>(p: Promise<ApiResult<T>>, deps?: ApiDeps): Promise<ApiResult<T>> {
  return p.then(r => {
    if (!r.ok && r.status === 401 && !deps) void refreshSession().catch(() => undefined)
    return r
  })
}

export const placementApi = {
  get: (deps?: ApiDeps) => guard(apiCall<PlacementFile>('GET', '/api/me/placement', { deps }), deps),
  summary: (deps?: ApiDeps) => guard(apiCall<PlacementSummary>('GET', '/api/me/placement/summary', { deps }), deps),
  put: (body: { owner: string; rev: number; set: Record<string, unknown> }, deps?: ApiDeps) =>
    guard(apiCall<{ rev: number }>('PUT', '/api/me/placement', { body, timeoutMs: LONG_TIMEOUT_MS, deps }), deps),
  apply: (body: { owner: string; run_id: string; words: ApplyWord[] }, deps?: ApiDeps) =>
    guard(apiCall<{ counted: number }>('POST', '/api/me/placement/apply', { body, timeoutMs: LONG_TIMEOUT_MS, deps }), deps),
}

export type PlacementApi = typeof placementApi
