// exchange-machine.ts — машина обмена (спека 2026-11-17 §4.6, план B7).
//
// 1. Выгрузка очереди с потолком 5 с; исход выгрузки (отказ, офлайн, `queue_full`,
//    таймаут) обмен НЕ останавливает — неушедшие события поедут со следующим.
// 2. `POST /api/me/route/exchange` (таймаут браузера 100 с — шлюз отвечает до ~85 с).
// 3. Опрос задания: 2 с первые 30 с, затем 5 с, не дольше 10 мин; `429 busy` —
//    пропустить тик; `404 job_not_found` — прекратить и перечитать состояние.
// 4. Итог по `error_code` проекции (§4.6 п.4).
// 5. Отказы создания (§4.6 п.5), временные сбои — по коду (§4.3): повтор после
//    Retry-After начинается с перечитывания состояния (запись могла пройти:
//    `503 route_timeout`), а повтор `done`/`committed:false` сам не запускается.
// 6. Зависший обмен (> 10 мин в любом незавершённом статусе) — `isStuckExchange`.
// 7. Коммит — `onExchangeCommitted` очереди (снимает удержание `queue_full`) и
//    `BroadcastChannel('flib-route')` `{revision}`.
import { routeApi, retryDelaySec, type ActiveExchange, type ApiError, type ApiResult, type ExchangeBody, type RouteJob, type RouteState } from './route-api'
import type { FlushResult } from './outbox'

export const FLUSH_BEFORE_EXCHANGE_MS = 5000
export const POLL_FAST_MS = 2000
export const POLL_SLOW_MS = 5000
export const POLL_FAST_WINDOW_MS = 30_000
export const POLL_LIMIT_MS = 10 * 60_000
export const STUCK_AFTER_MS = 10 * 60_000
const UNFINISHED = new Set(['waiting', 'claimed', 'processing'])

export type ExchangeOutcome =
  // foreign — закоммитился ЧУЖОЙ обмен (409 exchange_in_progress, опрос присланного job_id):
  // наш запрос (например, замена) не выполнен.
  | { type: 'committed'; revision: number | null; state: RouteState | null; foreign?: boolean }
  | { type: 'no_clip'; code: string | null }             // done, committed:false, ревизия та же
  | { type: 'advanced'; state: RouteState }              // done, committed:false, ревизия выросла
  | { type: 'unavailable' }                              // failed commit_failed: «мы уже знаем» + поддержка
  | { type: 'retry_offer'; code: string | null }         // прочий failed / cancelled — «Повторить»
  | { type: 'reset' }                                    // cancelled reset — новая эпоха
  | { type: 'reread'; code: string }                     // stale_revision, job_not_found, …
  | { type: 'no_route' }                                 // route_not_started
  | { type: 'replace_unavailable' }                      // «Замена сейчас недоступна» + перечитанное состояние
  | { type: 'snapshot_required' }                        // «Замена станет доступна после первого ролика»
  | { type: 'refused' }                                  // gateway_refused и незнакомый 502: без повтора
  | { type: 'timeout' }                                  // опрос дольше 10 мин — «Подобрать заново»
  | { type: 'session'; status: number; code: string | null }
  | { type: 'cancelled' }                                // вкладка ушла

export type ExchangePhase =
  | { kind: 'flushing' }
  | { kind: 'creating' }
  // status — статус последнего удачного ответа опроса (экран подбора показывает шаг).
  | { kind: 'polling'; jobId: string; status?: string }
  | { kind: 'cooldown'; until: number; code: string | null }

export interface ExchangeDeps {
  api: {
    exchange: (b: ExchangeBody) => Promise<ApiResult<{ job_id: string; base_revision: number }>>
    job: (id: string) => Promise<ApiResult<RouteJob>>
  }
  readState: () => Promise<ApiResult<RouteState>>
  outbox: { flush: (o: { timeoutMs: number }) => Promise<FlushResult>; onExchangeCommitted: () => void }
  now: () => number
  sleep: (ms: number) => Promise<void>
  broadcast: (revision: number) => void
  forDate: (snapshotDate: string | null) => string
  onPhase?: (p: ExchangePhase) => void
  signal?: { aborted: boolean }
}

export interface ExchangeRequest {
  want: 'next' | 'replace'
  expectedRevision: number
  snapshotDate: string | null
  replacePuzzleId?: string
  replaceReason?: string
}

// isStuckExchange — активный обмен старше 10 мин в любом незавершённом статусе.
export function isStuckExchange(a: ActiveExchange | null, now: number): boolean {
  if (!a || !UNFINISHED.has(a.status)) return false
  const t = Date.parse(a.created_at)
  return Number.isFinite(t) && now - t > STUCK_AFTER_MS
}

function sessionOutcome(e: ApiError): ExchangeOutcome | null {
  if (e.status === 401 || e.status === 403) return { type: 'session', status: e.status, code: e.code }
  return null
}

async function finish(job: RouteJob, baseRevision: number, d: ExchangeDeps): Promise<ExchangeOutcome> {
  if (job.status === 'done' && job.committed) {
    d.outbox.onExchangeCommitted()
    if (job.committed_revision !== null) d.broadcast(job.committed_revision)
    const st = await d.readState()
    return { type: 'committed', revision: job.committed_revision, state: st.ok ? st.data : null }
  }
  if (job.status === 'done') {
    const st = await d.readState()
    if (st.ok && st.data.revision > baseRevision) return { type: 'advanced', state: st.data }
    return { type: 'no_clip', code: job.error_code }
  }
  if (job.status === 'failed') {
    return job.error_code === 'commit_failed' ? { type: 'unavailable' } : { type: 'retry_offer', code: job.error_code }
  }
  if (job.status === 'cancelled' && job.cancel_reason === 'reset') return { type: 'reset' }
  return { type: 'retry_offer', code: job.error_code }
}

// pollJob — опрос до конечного статуса (§4.6 п.3).
export async function pollJob(jobId: string, baseRevision: number, d: ExchangeDeps): Promise<ExchangeOutcome> {
  const started = d.now()
  d.onPhase?.({ kind: 'polling', jobId })
  for (;;) {
    if (d.signal?.aborted) return { type: 'cancelled' }
    const elapsed = d.now() - started
    if (elapsed > POLL_LIMIT_MS) return { type: 'timeout' }
    await d.sleep(elapsed < POLL_FAST_WINDOW_MS ? POLL_FAST_MS : POLL_SLOW_MS)
    if (d.signal?.aborted) return { type: 'cancelled' }
    const r = await d.api.job(jobId)
    if (r.ok) {
      d.onPhase?.({ kind: 'polling', jobId, status: r.data.status })
      if (UNFINISHED.has(r.data.status)) continue
      return finish(r.data, baseRevision, d)
    }
    const s = sessionOutcome(r)
    if (s) return s
    if (r.status === 404 && r.code === 'job_not_found') {
      await d.readState()
      return { type: 'reread', code: 'job_not_found' }
    }
    if (r.cls === 'refused') return { type: 'refused' }
    // 429 busy — пропустить тик; временный сбой — тоже ждать следующего тика.
  }
}

// runExchange — полный обмен: выгрузка → создание → опрос → итог.
export async function runExchange(req: ExchangeRequest, d: ExchangeDeps): Promise<ExchangeOutcome> {
  d.onPhase?.({ kind: 'flushing' })
  try { await d.outbox.flush({ timeoutMs: FLUSH_BEFORE_EXCHANGE_MS }) } catch { /* обмен идёт всё равно */ }
  let revision = req.expectedRevision
  let snapshotDate = req.snapshotDate
  for (;;) {
    if (d.signal?.aborted) return { type: 'cancelled' }
    d.onPhase?.({ kind: 'creating' })
    const body: ExchangeBody = {
      expected_revision: revision, want: req.want, for_date: d.forDate(snapshotDate),
      ...(req.want === 'replace' && req.replacePuzzleId ? { replace_puzzle_id: req.replacePuzzleId } : {}),
      ...(req.want === 'replace' && req.replaceReason ? { replace_reason: req.replaceReason } : {}),
    }
    const r = await d.api.exchange(body)
    if (r.ok) return pollJob(r.data.job_id, r.data.base_revision ?? revision, d)
    const s = sessionOutcome(r)
    if (s) return s
    const code = r.code
    if (r.status === 409) {
      if (code === 'exchange_in_progress' && typeof r.body?.job_id === 'string') {
        const out = await pollJob(r.body.job_id, typeof r.body.revision === 'number' ? r.body.revision : revision, d)
        return out.type === 'committed' ? { ...out, foreign: true } : out
      }
      if (code === 'route_not_started') return { type: 'no_route' }
      if (code === 'replace_unavailable') {
        await d.readState()
        return { type: 'replace_unavailable' }
      }
      await d.readState()
      return { type: 'reread', code: code ?? 'conflict' }
    }
    if (r.status === 400 && code === 'snapshot_required') return { type: 'snapshot_required' }
    if (r.cls === 'refused') return { type: 'refused' }
    if (r.cls === 'temporary' || r.cls === 'rate') {
      // Ожидание с отсчётом, затем ВСЕГДА перечитать: запись могла пройти
      // (`503 route_timeout`), обмен мог начаться на другом устройстве.
      const until = d.now() + retryDelaySec(r) * 1000
      d.onPhase?.({ kind: 'cooldown', until, code })
      await d.sleep(until - d.now())
      if (d.signal?.aborted) return { type: 'cancelled' }
      const st = await d.readState()
      if (st.ok) {
        if (st.data.active_exchange && UNFINISHED.has(st.data.active_exchange.status)) {
          return pollJob(st.data.active_exchange.job_id, st.data.revision, d)
        }
        if (st.data.revision !== revision) return { type: 'reread', code: 'revision_changed' }
        revision = st.data.revision
        snapshotDate = st.data.snapshot_date
      }
      continue
    }
    return { type: 'retry_offer', code }
  }
}

// browserExchangeDeps — зависимости для страницы (B10): настоящий клиент,
// очередь вкладки, часы и общий запрос состояния.
export function browserExchangeDeps(o: {
  readState: () => Promise<ApiResult<RouteState>>
  outbox: ExchangeDeps['outbox']
  broadcast: (revision: number) => void
  forDate: (snapshotDate: string | null) => string
  onPhase?: (p: ExchangePhase) => void
  signal?: { aborted: boolean }
}): ExchangeDeps {
  return {
    api: { exchange: b => routeApi.exchange(b), job: id => routeApi.job(id) },
    now: () => Date.now(),
    sleep: ms => new Promise(r => setTimeout(r, Math.max(0, ms))),
    ...o,
  }
}
