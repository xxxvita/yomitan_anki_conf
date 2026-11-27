// site-host.ts — хост состояния теста на сайте (спека §4 «Фронт»): StoreHost поверх `/api/me/placement`
// и localStorage.
//   • `pt.session`, `pt.provider-ui` — localStorage `flib:placement:v1:<owner>:<ключ>` (ответ не должен
//     ждать сети). Нет хранилища или оно переполнено — память страницы, прогон идёт дальше.
//   • история, `pt_results/last`, `pt_pending/*` — файл на сервере. Серверные операции (docs.put/delete,
//     `pt.history.corrupt`) копятся в памяти хоста и уходят ОДНИМ PUT вместе с записью `pt.history`
//     (она последняя и в финише, и в ответе R16, и в ремонте). Чтения видят накопленное. Сбой PUT —
//     накопленное отброшено, перед следующей операцией кэш перечитывается.
//   • одна вкладка на ключ: Web Lock `flib-placement:<owner>` на время жизни хоста.
//   • после dispose() любая запись — ошибка, localStorage не пишется.
//   • чужой `pt.session` (run_id, которого эта страница не читала и не писала) не перезаписывается и не
//     удаляется.
import type { DocEntry, DocListPage, DocPutParams, DocRef } from './host'
import { SESSION_TTL_MS, type StoreHost } from './store'
import { placementApi, type PlacementApi } from './placement-api'
import type { ApiDeps, ApiError } from '../route/route-api'

export type PlacementErrorCode =
  | 'network' | 'unauthorized' | 'key_changed' | 'stale' | 'rate_limited' | 'too_large'
  | 'unavailable' | 'server' | 'disposed' | 'foreign_session' | 'tab_busy' | 'aborted'

export class PlacementHostError extends Error {
  constructor(readonly code: PlacementErrorCode, readonly retryAfterSec: number | null = null) {
    super(`placement: ${code}`)
    this.name = 'PlacementHostError'
  }
}

export interface RunMeta { appliedRunId: string | null; declinedRunId: string | null; lastRunId: string | null }

export type SiteHost = StoreHost & {
  /** Первые 16 hex имени файла ключа (BFF Owner): что отправляется в PUT/apply. */
  owner: string
  meta(): RunMeta
  markApplied(runId: string): void
  dispose(): void
}

export interface SiteHostOptions {
  /** Подмена клиента и сети — только тестам. */
  api?: PlacementApi
  apiDeps?: ApiDeps
  storage?: Storage | null
  locks?: LockManager | null
  /** Отмена открытия (размонтирование, StrictMode): замок снимается, хост не создаётся. */
  signal?: AbortSignal
}

const LS_PREFIX = 'flib:placement:v1:'
export const KEY_PREFIX_LATER = 'flib:placement-later:v1:'
const KV_SERVER = new Set(['pt.history', 'pt.history.corrupt'])
const KV_LOCAL = new Set(['pt.session', 'pt.provider-ui'])
const COLS = new Set(['pt_results', 'pt_pending'])

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const clone = <T,>(x: T): T => (x === undefined ? x : (JSON.parse(JSON.stringify(x)) as T))

export function localStorageOrNull(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null
  } catch {
    return null
  }
}

/** Ключ localStorage состояния теста этого владельца. */
export const lsKeyOf = (owner: string, key: string) => `${LS_PREFIX}${owner}:${key}`

/** Есть ли у владельца живой незаконченный прогон (для «Продолжить тест» на Главной и старте). */
export function hasLiveSession(owner: string, storage: Storage | null = localStorageOrNull(), now: number = Date.now()): boolean {
  if (!storage) return false
  try {
    const raw = storage.getItem(lsKeyOf(owner, 'pt.session'))
    if (!raw) return false
    const s = JSON.parse(raw) as Record<string, unknown>
    if (!isObj(s) || s.v !== 1 || typeof s.run_id !== 'string') return false
    if (isObj(s.finishing)) return true
    const t = Date.parse(String(s.updated_at))
    return Number.isFinite(t) && now - t <= SESSION_TTL_MS
  } catch {
    return false
  }
}

function errorOf(r: ApiError): PlacementHostError {
  if (r.status === 0 || r.cls === 'temporary') return new PlacementHostError('network', r.retryAfterSec)
  if (r.status === 401) return new PlacementHostError('unauthorized')
  if (r.status === 409 && r.code === 'key_changed') return new PlacementHostError('key_changed')
  if (r.status === 409 && r.code === 'stale') return new PlacementHostError('stale')
  if (r.status === 429) return new PlacementHostError('rate_limited', r.retryAfterSec)
  if (r.status === 413) return new PlacementHostError('too_large')
  if (r.status === 404) return new PlacementHostError('unavailable')
  return new PlacementHostError('server')
}

// --- один тест-вкладка на ключ ------------------------------------------------------

// Замки этой страницы: StrictMode (и повторное открытие после «Повторить») создаёт второе открытие ДО
// того, как первое отпустило замок. Свой же отменённый замок ждём, а не принимаем за «другую вкладку».
const pageLocks = new Map<string, { signal: AbortSignal; done: Promise<void> }>()

async function acquireTabLock(name: string, signal: AbortSignal, locks: LockManager | null): Promise<'ok' | 'busy'> {
  if (!locks) return 'ok'
  const prev = pageLocks.get(name)
  if (prev) {
    if (!prev.signal.aborted) return 'busy'
    await prev.done
  }
  if (signal.aborted) return 'ok'
  return new Promise<'ok' | 'busy'>((resolve) => {
    const done: Promise<void> = locks.request(name, { ifAvailable: true }, (lock) => {
      if (!lock) { resolve('busy'); return undefined }
      resolve('ok')
      return new Promise<void>((release) => {
        if (signal.aborted) release()
        else signal.addEventListener('abort', () => release(), { once: true })
      })
    }).then(() => undefined, () => { resolve('ok') /* замки недоступны (контекст, политика) — без замка */ })
    const entry = { signal, done }
    pageLocks.set(name, entry)
    void done.then(() => { if (pageLocks.get(name) === entry) pageLocks.delete(name) })
  })
}

// --- хост ----------------------------------------------------------------------------

export async function openSiteHost(opts: SiteHostOptions = {}): Promise<SiteHost> {
  const api = opts.api ?? placementApi
  const storage = opts.storage === undefined ? localStorageOrNull() : opts.storage
  const locks = opts.locks === undefined ? (typeof navigator !== 'undefined' && navigator.locks ? navigator.locks : null) : opts.locks
  const life = new AbortController()
  const onOuterAbort = () => life.abort()
  if (opts.signal?.aborted) onOuterAbort()
  else opts.signal?.addEventListener('abort', onOuterAbort, { once: true })
  const abortedErr = () => new PlacementHostError('aborted')

  let owner = ''
  let rev = 0
  let items: Record<string, unknown> = {}
  let applied: string | null = null
  let declined: string | null = null

  const read = async (): Promise<void> => {
    const r = await api.get(opts.apiDeps)
    if (!r.ok) throw errorOf(r)
    const d = r.data
    if (!isObj(d) || typeof d.owner !== 'string' || typeof d.rev !== 'number') throw new PlacementHostError('server')
    if (owner !== '' && d.owner !== owner) throw new PlacementHostError('key_changed')
    owner = d.owner
    rev = d.rev
    items = isObj(d.items) ? d.items : {}
    applied = typeof d.applied_run_id === 'string' ? d.applied_run_id : null
    declined = typeof d.declined_run_id === 'string' ? d.declined_run_id : null
  }

  try {
    await read()
    if (life.signal.aborted) throw abortedErr()
    const lock = await acquireTabLock(`flib-placement:${owner}`, life.signal, locks)
    if (life.signal.aborted) throw abortedErr()
    if (lock === 'busy') throw new PlacementHostError('tab_busy')
  } catch (e) {
    life.abort()
    throw e
  }

  let disposed = false
  let dirty = false
  const staged = new Map<string, unknown | null>()
  const mem = new Map<string, string>()
  const known = new Set<string>() // run_id сессий, которые эта страница читала или писала
  let tail: Promise<unknown> = Promise.resolve()
  const queue = <T,>(fn: () => Promise<T>): Promise<T> => {
    const p = tail.then(fn, fn)
    tail = p.catch(() => undefined)
    return p
  }
  const alive = () => { if (disposed) throw new PlacementHostError('disposed') }

  // --- localStorage ---
  const lsGet = (k: string): string | null => {
    if (mem.has(k)) return mem.get(k) as string
    try { return storage ? storage.getItem(lsKeyOf(owner, k)) : null } catch { return null }
  }
  const lsSet = (k: string, v: string) => {
    if (storage) {
      try { storage.setItem(lsKeyOf(owner, k), v); mem.delete(k); return } catch { /* квота — в память страницы */ }
    }
    mem.set(k, v)
  }
  const lsDel = (k: string) => {
    mem.delete(k)
    try { storage?.removeItem(lsKeyOf(owner, k)) } catch { /* no-op */ }
  }
  const runIdOf = (raw: string | null): string | undefined => {
    if (raw === null) return undefined
    try {
      const v = JSON.parse(raw) as unknown
      return isObj(v) && typeof v.run_id === 'string' ? v.run_id : undefined
    } catch { return undefined }
  }

  // --- сервер ---
  const ensureFresh = async () => {
    if (!dirty) return
    await read()
    dirty = false
  }
  const view = (k: string): unknown | undefined => (staged.has(k) ? (staged.get(k) ?? undefined) : items[k])
  const flush = async () => {
    const set = Object.fromEntries(staged)
    try {
      const r = await api.put({ owner, rev, set }, opts.apiDeps)
      if (!r.ok) throw errorOf(r)
      if (disposed) throw new PlacementHostError('disposed')
      for (const [k, v] of staged) { if (v === null) delete items[k]; else items[k] = v }
      rev = r.data.rev
    } catch (e) {
      dirty = true
      throw e
    } finally {
      staged.clear()
    }
  }
  const docKey = (c: string, id: string) => {
    if (!COLS.has(c) || id === '') throw new Error(`placement: collection ${c}`)
    return `docs:${c}/${id}`
  }

  const host: SiteHost = {
    owner,
    meta: () => {
      const last = view('docs:pt_results/last')
      return { appliedRunId: applied, declinedRunId: declined, lastRunId: isObj(last) && typeof last.run_id === 'string' ? last.run_id : null }
    },
    markApplied: (runId) => { applied = runId },
    dispose: () => {
      if (disposed) return
      disposed = true
      staged.clear()
      life.abort() // отпускает замок вкладки
    },
    storage: {
      get: <T = unknown>(key: string) => queue(async (): Promise<T | undefined> => {
        alive()
        if (KV_LOCAL.has(key)) {
          const raw = lsGet(key)
          if (raw === null) return undefined
          if (key === 'pt.session') { const id = runIdOf(raw); if (id) known.add(id) }
          try { return clone(JSON.parse(raw)) as T } catch { return raw as unknown as T }
        }
        if (!KV_SERVER.has(key)) throw new Error(`placement: key ${key}`)
        await ensureFresh()
        return clone(view(`kv:${key}`)) as T | undefined
      }),
      set: (key: string, value: unknown) => queue(async () => {
        alive()
        if (KV_LOCAL.has(key)) {
          if (key === 'pt.session') {
            const mine = isObj(value) && typeof value.run_id === 'string' ? value.run_id : undefined
            const lying = runIdOf(lsGet(key))
            if (lying !== undefined && lying !== mine && !known.has(lying)) throw new PlacementHostError('foreign_session')
            if (mine) known.add(mine)
          }
          lsSet(key, JSON.stringify(value))
          return
        }
        if (!KV_SERVER.has(key)) throw new Error(`placement: key ${key}`)
        await ensureFresh()
        staged.set(`kv:${key}`, clone(value))
        // История пишется последней: здесь всё накопленное уходит одним PUT.
        if (key === 'pt.history') await flush()
      }),
      delete: (key: string) => queue(async () => {
        alive()
        if (KV_LOCAL.has(key)) {
          const raw = lsGet(key)
          if (raw === null) return { removed: 0 }
          if (key === 'pt.session') {
            const lying = runIdOf(raw)
            if (lying !== undefined && !known.has(lying)) return { removed: 0 } // чужой прогон не трогаем
          }
          lsDel(key)
          return { removed: 1 }
        }
        if (!KV_SERVER.has(key)) throw new Error(`placement: key ${key}`)
        await ensureFresh()
        const had = view(`kv:${key}`) !== undefined
        staged.set(`kv:${key}`, null)
        if (key === 'pt.history') await flush()
        return { removed: had ? 1 : 0 }
      }),
    },
    docs: {
      put: (p: DocPutParams) => queue(async () => {
        alive()
        const k = docKey(p.collection, p.id)
        await ensureFresh()
        staged.set(k, clone(p.body))
        return { rev: rev + 1 }
      }),
      get: <T = unknown>(p: DocRef) => queue(async (): Promise<DocEntry<T> | undefined> => {
        alive()
        const k = docKey(p.collection, p.id)
        await ensureFresh()
        const v = view(k)
        return v === undefined ? undefined : { body: clone(v) as T, rev, updated_at: '' }
      }),
      list: <T = unknown>(p: { collection: string; after?: string; limit?: number }) => queue(async (): Promise<DocListPage<T>> => {
        alive()
        docKey(p.collection, 'x')
        await ensureFresh()
        const pre = `docs:${p.collection}/`
        const keys = new Set([...Object.keys(items), ...staged.keys()].filter((k) => k.startsWith(pre)))
        const ids = [...keys].filter((k) => view(k) !== undefined).map((k) => k.slice(pre.length)).sort()
          .filter((id) => p.after === undefined || id > p.after)
        return { items: ids.map((id) => ({ id, body: clone(view(pre + id)) as T, rev, updated_at: '' })) }
      }),
      delete: (p: DocRef) => queue(async (): Promise<{ removed: 0 | 1 }> => {
        alive()
        const k = docKey(p.collection, p.id)
        await ensureFresh()
        const had = view(k) !== undefined
        staged.set(k, null)
        return { removed: had ? 1 : 0 }
      }),
    },
  }
  return host
}
