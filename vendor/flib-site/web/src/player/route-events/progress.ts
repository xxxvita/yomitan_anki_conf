// progress.ts — прогресс ролика маршрута (спека 2026-11-17 §4.8 «Прогресс ролика»,
// план B8d).
//
// `GET /api/me/route/progress?puzzle_id=` при открытии ДО первого `PUT` (норма 5):
// восстанавливает счётчик из `state` (той же дорожки) и предлагает продолжить с
// `position_ms`. `PUT` — не чаще раза в 20 с (пауза ставит запись, только если с
// прошлой прошло ≥ 5 с: петли Shadowing постоянно ставят паузу) и при уходе:
// `{track_key, position_ms, heard_total, state}`, где
//   track_key   = "yt-en:" + FNV-1a(тексты EN-реплик),
//   heard_total = различные услышанные реплики (целое),
//   state       = {v:1, heard:[индексы], replays:{индекс: возвраты}} ≤ 96 КиБ.
//
// Ведро реплик шлюза (M3, line-credit.ts): `PUT` тратит прирост `heard_total` сверх
// высшей отметки ролика, у нового ролика — целиком. Поэтому `heard_total` растёт не
// больше чем на MAX_PROGRESS_HEARD_STEP за запрос и только на столько, сколько
// выдало общее ведро сайта (`reserveLineCredit`). Это нижняя оценка услышанного —
// безопасная: правило `full` шлюза сравнивает отчёт с высшей отметкой СНИЗУ.
import { useEffect, useRef, useState } from 'react'
import { routeApi, retryDelaySec, type ApiResult, type RouteProgress } from '../../site/cabinet/route/route-api'
import { getRouteOutbox } from '../../site/cabinet/route/outbox'
import { pageKeepalive } from '../../site/cabinet/route/keepalive-budget'
import { CSRF_HEADERS } from '../../site/session'
import { MAX_PROGRESS_HEARD_STEP } from '../../site/cabinet/route/line-credit'
import type { Cue } from '../hooks/useSubtitles'
import type { Счётчик } from './subtitle-counter'
import type { ProgressInfo } from './clip-played'
import type { RouteModeView } from './route-mode'

export const PUT_INTERVAL_MS = 20_000
export const PAUSE_MIN_GAP_MS = 5_000
export const STATE_MAX_BYTES = 96 * 1024

// fnv1a — 32-битный FNV-1a по UTF-16 кодам строки.
export function fnv1a(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

export function trackKeyOf(cues: Array<{ text_en: string }>): string {
  return 'yt-en:' + fnv1a(cues.map(c => c.text_en).join('\n'))
}

export interface ProgressState { v: 1; heard: number[]; replays: Record<string, number> }

// progressState — состояние счётчика для PUT; > 96 КиБ — без возвратов, затем
// с урезанным списком услышанных (с конца).
export function progressState(c: Счётчик | null): ProgressState {
  const heard: number[] = []
  const replays: Record<string, number> = {}
  if (c) c.услышано.forEach((n, i) => { if (n >= 1) { heard.push(i); if (c.возвраты[i] > 1) replays[String(i)] = c.возвраты[i] } })
  let st: ProgressState = { v: 1, heard, replays }
  const size = (x: unknown) => new TextEncoder().encode(JSON.stringify(x)).length
  if (size(st) > STATE_MAX_BYTES) st = { v: 1, heard, replays: {} }
  while (size(st) > STATE_MAX_BYTES && st.heard.length) st = { ...st, heard: st.heard.slice(0, Math.floor(st.heard.length * 0.9)) }
  return st
}

// heardFromState — индексы услышанных из `state` ответа GET (чужая форма — пусто).
export function heardFromState(state: unknown): number[] {
  const s = state as { v?: unknown; heard?: unknown } | null
  if (!s || s.v !== 1 || !Array.isArray(s.heard)) return []
  return s.heard.filter((x): x is number => Number.isInteger(x) && x >= 0)
}

export interface ProgressDeps {
  get: (pid: string) => Promise<ApiResult<RouteProgress>>
  put: (pid: string, body: { track_key: string; position_ms: number; heard_total: number; state: unknown }) => Promise<ApiResult<{ ok: boolean }>>
  // putKeepalive — PUT на выгрузке страницы: fetch keepalive, без ожидания
  // блокировки ведра (страница, которую выгружают, её не получит — ревью C2).
  putKeepalive: (pid: string, body: { track_key: string; position_ms: number; heard_total: number; state: unknown }) => void
  reserve: (n: number) => Promise<number>
  now: () => number
}

// progressBrowserDeps — зависимости браузера (экспорт — для теста общего бюджета
// keepalive, R2-L4).
export const progressBrowserDeps: ProgressDeps = {
  get: pid => routeApi.getProgress(pid),
  put: (pid, b) => routeApi.putProgress(pid, b),
  // Бюджет keepalive общий с очередью событий (R-L1): тело, не влезающее в
  // оставшееся место, не отправляется — браузер всё равно отверг бы запрос.
  putKeepalive: (pid, b) => {
    pageKeepalive.send((url, init) => fetch(url, init), `/api/me/route/progress?puzzle_id=${encodeURIComponent(pid)}`, {
      method: 'PUT', credentials: 'same-origin', keepalive: true,
      headers: { 'Content-Type': 'application/json', ...CSRF_HEADERS }, body: JSON.stringify(b),
    })
  },
  reserve: n => getRouteOutbox().reserveLineCredit(n),
  now: () => Date.now(),
}

export interface ProgressView {
  info: ProgressInfo | null
  settled: boolean
  restoreHeard: number[] | null
  resumeMs: number | null
}

export interface ProgressArgs {
  routeMode: RouteModeView
  cues: Cue[]
  counter: () => Счётчик | null
  currentTime: number
  paused: boolean
  deps?: ProgressDeps
}

type Got = { kind: 'ok'; p: RouteProgress } | { kind: 'not_found' } | { kind: 'failed' }

export function useRouteProgress(a: ProgressArgs): ProgressView {
  const deps = a.deps ?? progressBrowserDeps
  const pid = a.routeMode.kind === 'confirmed' ? a.routeMode.puzzleId : ''
  const [got, setGot] = useState<{ pid: string; g: Got } | null>(null)
  const argsRef = useRef(a); argsRef.current = a
  // blockedUntil — 429 на PUT (свой лимит BFF, `route_banned`, лимит шлюза): до
  // Retry-After ни одного PUT — ни по шагу, ни на паузе, ни при уходе (финальное
  // ревью PR-B, L9: иначе PUT впустую тратили бюджет записи ключа).
  const putState = useRef({ last: 0, pending: false, knownMax: 0, timer: null as ReturnType<typeof setTimeout> | null, inflight: false, settled: false, blockedUntil: 0 })

  // GET при открытии (до первого PUT).
  useEffect(() => {
    if (!pid) return
    let alive = true
    putState.current = { last: 0, pending: false, knownMax: 0, timer: null, inflight: false, settled: false, blockedUntil: 0 }
    void deps.get(pid).then(r => {
      if (!alive) return
      let g: Got
      if (r.ok) g = { kind: 'ok', p: r.data }
      else if (r.status === 404) g = { kind: 'not_found' }
      else g = { kind: 'failed' }
      if (g.kind === 'ok') putState.current.knownMax = Math.max(0, Math.floor(g.p.heard_max || 0))
      putState.current.settled = true
      setGot({ pid, g })
    })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid])

  const g = got && got.pid === pid ? got.g : null
  const key = a.cues.length ? trackKeyOf(a.cues) : null
  let info: ProgressInfo | null = null
  let restoreHeard: number[] | null = null
  let resumeMs: number | null = null
  if (g) {
    if (g.kind === 'not_found') info = { kind: 'not_found', heardMax: 0 }
    else if (g.kind === 'failed') info = { kind: 'failed', heardMax: 0 }
    else {
      const same = key !== null && g.p.track_key === key
      info = { kind: same ? 'restored' : 'other', heardMax: Math.max(0, Math.floor(g.p.heard_max || 0)) }
      if (same) restoreHeard = heardFromState(g.p.state)
      if (g.p.position_ms > 5000) resumeMs = Math.floor(g.p.position_ms)
    }
  }
  const settled = !!g

  // PUT: не чаще раза в 20 с; пауза — только если с прошлого прошло ≥ 5 с.
  const doPut = async (): Promise<void> => {
    const ps = putState.current
    const x = argsRef.current
    if (ps.inflight || !pid || !x.cues.length || !ps.settled) return
    if (deps.now() < ps.blockedUntil) { schedule(); return }
    ps.inflight = true
    ps.pending = false
    ps.last = deps.now()
    try {
      const c = x.counter()
      const st = progressState(c)
      const distinct = c ? c.услышано.filter(n => n >= 1).length : 0
      const want = Math.max(0, distinct - ps.knownMax)
      const granted = want > 0 ? await deps.reserve(Math.min(want, MAX_PROGRESS_HEARD_STEP)) : 0
      const heardTotal = Math.max(0, Math.min(distinct, ps.knownMax + granted))
      const r = await deps.put(pid, { track_key: trackKeyOf(x.cues), position_ms: Math.max(0, Math.round(x.currentTime * 1000)), heard_total: heardTotal, state: st })
      if (r.ok) ps.knownMax = Math.max(ps.knownMax, heardTotal)
      else if (r.status === 429) ps.blockedUntil = deps.now() + retryDelaySec(r) * 1000
    } finally {
      ps.inflight = false
    }
  }

  const schedule = (): void => {
    const ps = putState.current
    if (ps.timer) return
    const wait = Math.max(0, ps.last + PUT_INTERVAL_MS - deps.now(), ps.blockedUntil - deps.now())
    ps.timer = setTimeout(() => { ps.timer = null; void doPut() }, wait)
  }

  // Ход воспроизведения: раз в 20 с.
  useEffect(() => {
    if (!pid || !settled || a.paused) return
    const ps = putState.current
    if (deps.now() - ps.last >= PUT_INTERVAL_MS) schedule()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.currentTime, settled, pid])

  // Пауза: запись, только если с прошлой прошло ≥ 5 с (не чаще раза в 20 с).
  useEffect(() => {
    if (!pid || !settled || !a.paused) return
    const ps = putState.current
    if (ps.last === 0 || deps.now() - ps.last >= PAUSE_MIN_GAP_MS) { ps.pending = true; schedule() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.paused, settled, pid])

  // Уход. pagehide: PUT keepalive сразу, `heard_total` = известная отметка (ведро
  // не трогаем — его блокировку выгружаемая страница не получит; ни реплики
  // сверх отметки не списываются, ни отметка не растёт). Размонтирование внутри
  // сайта — обычный PUT. Оба — только после ответа GET (норма 5, ревью L5b):
  // уход до ответа не затирает сохранённое состояние.
  useEffect(() => {
    if (!pid) return
    const onHide = () => {
      const ps = putState.current
      const x = argsRef.current
      if (!ps.settled || !x.cues.length || deps.now() < ps.blockedUntil) return
      const st = progressState(x.counter())
      const distinct = st.heard.length
      deps.putKeepalive(pid, { track_key: trackKeyOf(x.cues), position_ms: Math.max(0, Math.round(x.currentTime * 1000)), heard_total: Math.min(distinct, ps.knownMax), state: st })
      ps.last = deps.now()
    }
    window.addEventListener('pagehide', onHide)
    return () => {
      window.removeEventListener('pagehide', onHide)
      const ps = putState.current
      if (ps.timer) { clearTimeout(ps.timer); ps.timer = null }
      if (ps.settled && deps.now() >= ps.blockedUntil && (ps.last !== 0 || argsRef.current.currentTime > 0)) void doPut()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid])

  return { info, settled, restoreHeard, resumeMs }
}
