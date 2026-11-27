// use-route-state.ts — чтение `GET /api/me/route/state` вкладкой (спека §4.12
// «Чтения», §4.6 п.7, план B7).
//
// ОДИН общий запрос в полёте на вкладку: страница маршрута, Главная и проверка
// плеера делят его (шлюз держит 2 чтения состояния на ключ и отвечает `429 busy`).
// На `429 busy` — повтор по Retry-After внутри того же общего запроса, без
// параллельных запросов того же вида (норма 1 клиентов шлюза).
//
// В момент ОТПРАВКИ запроса запоминается проба для сторожа удаления
// `flib:route-watched` (§4.2 п.2, R3-M3, R4-C1): `seq` объекта отметок и
// множество роликов с clip_played в локальной очереди (включая пачку в полёте).
// Присоединившийся к запросу в полёте получает пробу ИСХОДНОЙ отправки — ровно
// поэтому сторож сравнивает `seq`, а не «revision выросла».
//
// После коммита обмена и сброса — `BroadcastChannel('flib-route')` `{revision}`;
// состояние перечитывается и при возврате на вкладку.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { routeApi, retryDelaySec, type ApiDeps, type ApiResult, type RouteState } from './route-api'
import { readWatchedSeq } from './route-storage'
import { getRouteOutbox } from './outbox'
import { getSession } from '../../session'

export interface StateSentProbe { watchedSeq: number; pendingClipPlayed: Set<string> }
export interface StateRead { result: ApiResult<RouteState>; sent: StateSentProbe }

export const BUSY_RETRIES = 5

export interface StateReadDeps {
  api?: ApiDeps
  probe?: () => StateSentProbe
  sleep?: (ms: number) => Promise<void>
  // onArrive — ответ чтения ПРИШЁЛ и будет показан (не устарел): зовётся синхронно
  // ДО setRead. Читатель — страница урока слов: живость строки решается в момент
  // прихода, а не отрисовки (ревью 3b, R1-N1: pagehide между ними).
  onArrive?: (r: StateRead) => void
}

const defaultProbe = (): StateSentProbe => ({
  watchedSeq: readWatchedSeq(),
  pendingClipPlayed: getRouteOutbox().pendingClipPlayed(),
})
const defaultSleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

let inflight: Promise<StateRead> | null = null
let inflightIdent: string | null = null

// sessionIdent — кто вошёл сейчас: 'in:<префикс ключа>', 'out' или null (снимка
// нет). Общий запрос в полёте делится ТОЛЬКО под тем же вошедшим ключом (ревью
// R2-L1): чтение, начатое под ключом A, не отдаётся проверке, начатой после входа
// ключом B, — BFF ответил бы маршрутом A, и плеер подтвердил бы его под B.
function sessionIdent(): string | null {
  const s = getSession()
  if (s.status !== 'ready') return null
  return s.authenticated ? `in:${s.keyPrefix}` : 'out'
}

// fetchRouteState — общий запрос вкладки; повтор `429 busy` до BUSY_RETRIES раз.
export function fetchRouteState(deps: StateReadDeps = {}): Promise<StateRead> {
  const ident = sessionIdent()
  if (inflight && inflightIdent === ident) return inflight
  const probe = deps.probe ?? defaultProbe
  const sleep = deps.sleep ?? defaultSleep
  const p = (async (): Promise<StateRead> => {
    for (let i = 0; ; i++) {
      const sent = probe()
      const result = await routeApi.state(deps.api)
      if (!result.ok && result.status === 429 && result.code === 'busy' && i < BUSY_RETRIES) {
        await sleep(retryDelaySec(result) * 1000)
        continue
      }
      const read = { result, sent }
      publishLastRead(ident, read)
      return read
    }
  })().finally(() => { if (inflight === p) { inflight = null; inflightIdent = null } })
  inflight = p
  inflightIdent = ident
  return p
}

// invalidateRouteStateRead — следующее чтение начнёт СВОЙ запрос, не присоединяясь к
// запросу в полёте: он мог уйти раньше, чем шлюз принял отчёт (ревью 3а, H1).
export function invalidateRouteStateRead(): void { inflight = null; inflightIdent = null }

// fetchFreshRouteState — чтение после изменения на шлюзе (коммит, сброс, проверка
// права замены): свой запрос, не присоединяясь к запросу в полёте (ревью PR-C, N3).
export function fetchFreshRouteState(deps: StateReadDeps = {}): Promise<StateRead> {
  invalidateRouteStateRead()
  return fetchRouteState(deps)
}

export function __resetRouteStateForTests(): void { inflight = null; inflightIdent = null; ownRevisions.length = 0; lastRead = null; notifyLast() }

// --- последнее удачное чтение вкладки (навигация v2) ------------------------------
//
// Счётчик дня «k из M» у «Маршрута» в меню кабинета и уведомления плеера берут
// ПОСЛЕДНЕЕ удачное чтение состояния, которое и так сделала страница (маршрут,
// Главная, проверка плеера), — своего запроса у них нет. Чтение помнит, под каким
// вошедшим ключом сделано: после выхода или входа другим ключом оно чужое и не
// показывается.

let lastRead: { ident: string; read: StateRead } | null = null
const lastListeners = new Set<() => void>()

function notifyLast(): void { for (const f of lastListeners) f() }

function publishLastRead(ident: string | null, read: StateRead): void {
  if (ident === null || !ident.startsWith('in:') || !read.result.ok) return
  lastRead = { ident, read }
  notifyLast()
}

function subscribeLast(f: () => void): () => void {
  lastListeners.add(f)
  return () => { lastListeners.delete(f) }
}

// useLastRouteRead — последнее удачное чтение под ТЕКУЩИМ вошедшим ключом или null.
export function useLastRouteRead(): StateRead | null {
  const v = useSyncExternalStore(subscribeLast, () => lastRead, () => null)
  return v && v.ident === sessionIdent() ? v.read : null
}

export function __setLastRouteReadForTests(read: StateRead | null, ident: string | null = sessionIdent()): void {
  lastRead = read && ident ? { ident, read } : null
  notifyLast()
}

// --- канал вкладок ---------------------------------------------------------------

const CHANNEL = 'flib-route'

// ownRevisions — ревизии, о которых сообщила САМА эта вкладка: BroadcastChannel
// доставляет сообщение и другим объектам канала той же вкладки. Своё сообщение не
// сбрасывает общий запрос в полёте — его уже начала машина обмена после коммита
// (иначе вкладка читала бы состояние дважды); чужое — сбрасывает (L6). Запись
// помнит, под каким вошедшим ключом объявлена: номера ревизий — у каждого ключа
// свои, и после смены ключа (выход, вход другим) прежние записи — чужие (N3).
const ownRevisions: Array<{ revision: number; ident: string }> = []

function pruneOwnRevisions(ident: string | null): void {
  for (let i = ownRevisions.length - 1; i >= 0; i--) if (ownRevisions[i].ident !== ident) ownRevisions.splice(i, 1)
}

function isOwnRevision(revision: unknown): boolean {
  const ident = sessionIdent()
  pruneOwnRevisions(ident)
  return ident !== null && typeof revision === 'number' && ownRevisions.some(o => o.revision === revision)
}

export function broadcastRouteRevision(revision: number): void {
  const ident = sessionIdent()
  pruneOwnRevisions(ident)
  if (ident !== null) {
    ownRevisions.push({ revision, ident })
    if (ownRevisions.length > 20) ownRevisions.shift()
  }
  try {
    if (typeof BroadcastChannel !== 'function') return
    const ch = new BroadcastChannel(CHANNEL)
    ch.postMessage({ revision })
    ch.close()
  } catch { /* канал недоступен */ }
}

// --- хук страницы --------------------------------------------------------------------

export interface RouteStateView {
  read: StateRead | null
  loading: boolean
  // retryAt — время автоповтора временного сбоя (§4.3), для отсчёта на экране.
  retryAt: number | null
  reload: () => Promise<StateRead>
}

export function useRouteState(deps: StateReadDeps = {}): RouteStateView {
  const [read, setRead] = useState<StateRead | null>(null)
  const [loading, setLoading] = useState(true)
  const [retryAt, setRetryAt] = useState<number | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const alive = useRef(true)
  const depsRef = useRef(deps)
  depsRef.current = deps

  // seq — номер последнего начатого чтения: ответ более раннего чтения, пришедший
  // позже, экран не перезаписывает (ревью 3а, H1: чтение, ушедшее до отчёта, иначе
  // затёрло бы свежее, запрошенное после приёма отчёта).
  const seq = useRef(0)
  const reload = useCallback(async (): Promise<StateRead> => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    setLoading(true)
    const my = ++seq.current
    const r = await fetchRouteState(depsRef.current)
    if (!alive.current || my !== seq.current) return r
    depsRef.current.onArrive?.(r)
    setRead(r)
    setLoading(false)
    if (!r.result.ok && (r.result.cls === 'temporary' || r.result.cls === 'rate')) {
      const ms = retryDelaySec(r.result) * 1000
      setRetryAt(Date.now() + ms)
      timer.current = setTimeout(() => { void reload() }, ms)
    } else {
      setRetryAt(null)
    }
    return r
  }, [])

  useEffect(() => {
    alive.current = true
    void reload()
    let ch: BroadcastChannel | null = null
    try {
      if (typeof BroadcastChannel === 'function') {
        ch = new BroadcastChannel(CHANNEL)
        // Коммит или сброс в другой вкладке: запрос в полёте мог уйти ДО него —
        // не присоединяемся к нему (финальное ревью PR-B, L6). Сообщение о ревизии,
        // которую объявила эта же вкладка, запрос не сбрасывает.
        ch.onmessage = (e: MessageEvent) => {
          if (!isOwnRevision((e?.data as { revision?: unknown } | null)?.revision)) invalidateRouteStateRead()
          void reload()
        }
      }
    } catch { ch = null }
    const onVis = () => { if (document.visibilityState === 'visible') void reload() }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      alive.current = false
      if (timer.current) clearTimeout(timer.current)
      try { ch?.close() } catch { /* no-op */ }
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [reload])

  return { read, loading, retryAt, reload }
}
