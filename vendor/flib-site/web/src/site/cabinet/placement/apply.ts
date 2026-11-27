// apply.ts — слова принятого прогона → профиль маршрута (спека §3.3, §4 «После финиша»).
// Слова берутся из pt_results/last тем же снимком, что и канал «Мои знания» (snapshotOf); сервер сам
// решает уровень и валидность по своему файлу и сверяет run_id (чужой/устаревший — 409 stale_run).
import { snapshotOf } from './knowledge'
import { placementApi, type PlacementApi } from './placement-api'
import type { SiteHost } from './site-host'
import { COL_RESULTS, ID_LAST } from './store'
import type { ApiDeps } from '../route/route-api'

export type ApplyOutcome =
  | { kind: 'done'; counted: number }
  | { kind: 'nothing' }
  | { kind: 'declined' }
  | { kind: 'failed' }
  | { kind: 'key_changed' }

export interface ApplyOptions {
  /** «Учесть слова теста» (declined) и «Повторить»: применить, даже если прогон отмечен как отклонённый. */
  force?: boolean
  api?: PlacementApi
  apiDeps?: ApiDeps
  sleep?: (ms: number) => Promise<void>
  /** Уход со страницы: пауза 429 прерывается, новых запросов нет. */
  signal?: AbortSignal
}

const MAX_TRIES = 3
const sleepOf = (signal?: AbortSignal) => (ms: number) => new Promise<void>((r) => {
  if (signal?.aborted) { r(); return }
  const t = setTimeout(done, ms)
  function done() { clearTimeout(t); signal?.removeEventListener('abort', done); r() }
  signal?.addEventListener('abort', done, { once: true })
})

export async function applyPlacement(host: SiteHost, opts: ApplyOptions = {}): Promise<ApplyOutcome> {
  const api = opts.api ?? placementApi
  const sleep = opts.sleep ?? sleepOf(opts.signal)
  let runId: string
  try {
    const last = await host.docs.get<{ run_id?: unknown }>({ collection: COL_RESULTS, id: ID_LAST })
    if (!last || typeof last.body.run_id !== 'string') return { kind: 'nothing' }
    runId = last.body.run_id
  } catch {
    return { kind: 'failed' }
  }
  const m = host.meta()
  if (!opts.force) {
    if (m.appliedRunId === runId) return { kind: 'nothing' }
    if (m.declinedRunId === runId) return { kind: 'declined' }
  }
  let words: { lemma: string; confidence: number }[]
  try {
    const snap = await snapshotOf(host)
    words = snap.items.filter((i) => i.kind === 'word').map((i) => ({ lemma: i.text, confidence: i.confidence }))
  } catch {
    return { kind: 'failed' }
  }
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    if (opts.signal?.aborted) return { kind: 'failed' }
    const r = await api.apply({ owner: host.owner, run_id: runId, words }, opts.apiDeps)
    if (r.ok) {
      // Тело ответа проверяется ДО отметки «применено»: мусор не должен гасить повтор.
      const counted = (r.data as { counted?: unknown } | null)?.counted
      if (typeof counted !== 'number' || !Number.isFinite(counted) || counted < 0) return { kind: 'failed' }
      host.markApplied(runId)
      return { kind: 'done', counted }
    }
    if (r.status === 409 && r.code === 'key_changed') return { kind: 'key_changed' }
    if (r.status === 429 && attempt < MAX_TRIES - 1) {
      const wait = r.retryAfterSec && r.retryAfterSec > 0 ? Math.min(r.retryAfterSec, 30) : 1
      await sleep(wait * 1000)
      continue
    }
    // Прогон уже не текущий (другое устройство записало новее): применять нечего, и это не сбой.
    if (r.status === 409 && r.code === 'stale_run') return { kind: 'nothing' }
    return { kind: 'failed' }
  }
  return { kind: 'failed' }
}
