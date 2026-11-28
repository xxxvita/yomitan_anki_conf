// route-mode.ts — маршрутный режим плеера (спека 2026-11-17 §4.7, план B8c;
// нужен уже гейту субтитров B8b, поэтому живёт здесь с B8b).
//
// `/player?v=<id>&rp=<puzzle_id>` — маршрутный, только если `rp === "youtube::"+v`,
// есть сессия, есть метка маршрута, и `rp` равен `current_puzzle_id` СВЕЖЕГО
// `GET /api/me/route/state` (общий запрос вкладки). На `429` и `503` вызов
// повторяется по Retry-After — до 3 повторов, не дольше 15 с в сумме; лишь после
// этого ролик гостевой. Пока ответа нет — `pending`: гейт субтитров включён, а
// события копятся в памяти и отбрасываются, если режим не подтвердился.
//
// `rc` (выданный ролик СЕГОДНЯШНЕГО дня, не текущий, §4.7) — `rc === "youtube::"+v`,
// сессия и в свежем состоянии `rc` — строка текущего плана с `delivered:true` или
// `kept`. Маршрутного режима `rc` НЕ включает: событий, кроме `clip_rated`, нет,
// гейта субтитров нет.
//
// `rx` (дополнительное видео, extra-video §9) — `rx === "youtube::"+v`, сессия, метка маршрута и в
// свежем состоянии строка в `extras` без такой же среди выданных плана: режим `extra`. Пока проверки
// нет — `pending` с `extra:true` (потолок 15 с, как у `rp`). Собственный `rp` сильнее `rx`.
import { useEffect, useRef, useState } from 'react'
import { ensureSession, getSession, isActiveSession, subscribeSession } from '../../site/session'
import { cabinetRouteMarked } from '../../site/cabinet/route/route-storage'
import { fetchRouteState, type StateRead } from '../../site/cabinet/route/use-route-state'
import { retryDelaySec, type DayClip, type DayClipDelivered, type DayClipKept, type ExtraRow, type RouteState } from '../../site/cabinet/route/route-api'

export type RouteModeView =
  | { kind: 'off' }
  | { kind: 'pending'; puzzleId: string; extra?: true }
  | { kind: 'confirmed'; puzzleId: string; state: RouteState; row: DayClipDelivered | null }
  | { kind: 'rc'; puzzleId: string; state: RouteState; row: DayClipDelivered | DayClipKept }
  | { kind: 'extra'; puzzleId: string; state: RouteState; row: ExtraRow }

export const ROUTE_MODE_MAX_RETRIES = 3
export const ROUTE_MODE_BUDGET_MS = 15_000

const delivered = (c: DayClip): c is DayClipDelivered | DayClipKept => c.delivered === true

// resolveRouteMode — решение по свежему состоянию (чистая функция).
export function resolveRouteMode(state: RouteState, videoId: string, rp: string | null, rc: string | null, rx: string | null = null): RouteModeView {
  const own = `youtube::${videoId}`
  const rows = state.day?.clips.filter(delivered) ?? []
  if (rp && rp === own) {
    if (state.current_puzzle_id === rp) {
      const row = rows.find((c): c is DayClipDelivered => c.puzzle_id === rp && !('kept' in c && c.kept)) ?? null
      return { kind: 'confirmed', puzzleId: rp, state, row }
    }
    return { kind: 'off' }
  }
  // rx — дополнительное видео (extra-video §9): выдано (`extras`) и НЕ строка плана дня
  // (выданная или оставленная): иначе это дневной ролик и он идёт через rp/rc.
  if (rx && rx === own) {
    const row = state.extras?.find(e => e.puzzle_id === rx)
    if (row && !rows.some(c => c.puzzle_id === rx)) return { kind: 'extra', puzzleId: rx, state, row }
    return { kind: 'off' }
  }
  if (rc && rc === own) {
    const row = rows.find(c => c.puzzle_id === rc)
    if (row) return { kind: 'rc', puzzleId: rc, state, row }
  }
  return { kind: 'off' }
}

export interface RouteModeDeps {
  marked: () => boolean
  session: () => Promise<boolean>
  read: () => Promise<StateRead>
  sleep: (ms: number) => Promise<void>
  now: () => number
}

const browserDeps: RouteModeDeps = {
  marked: cabinetRouteMarked,
  session: async () => isActiveSession(await ensureSession()),
  read: () => fetchRouteState(),
  sleep: ms => new Promise(r => setTimeout(r, ms)),
  now: () => Date.now(),
}

// checkRouteMode — один проход проверки (§4.7, N-M5).
export async function checkRouteMode(videoId: string, rp: string | null, rc: string | null, d: RouteModeDeps = browserDeps, rx: string | null = null): Promise<RouteModeView> {
  const own = `youtube::${videoId}`
  if (!d.marked() || !videoId) return { kind: 'off' }
  if (rp !== own && rc !== own && rx !== own) return { kind: 'off' }
  if (!(await d.session())) return { kind: 'off' }
  const start = d.now()
  for (let attempt = 0; ; attempt++) {
    const r = await d.read()
    if (r.result.ok) return resolveRouteMode(r.result.data, videoId, rp, rc, rx)
    const st = r.result.status
    if (st !== 429 && st !== 503) return { kind: 'off' }
    const wait = retryDelaySec(r.result) * 1000
    if (attempt >= ROUTE_MODE_MAX_RETRIES || d.now() - start + wait > ROUTE_MODE_BUDGET_MS) return { kind: 'off' }
    await d.sleep(wait)
  }
}

// initialRouteMode — до ответа: `pending` для подходящего `rp` при метке; для подходящего `rx`
// (и без собственного `rp`) — `pending` с `extra:true`.
export function initialRouteMode(videoId: string, rp: string | null, marked: boolean, rx: string | null = null): RouteModeView {
  if (!marked || !videoId) return { kind: 'off' }
  const own = `youtube::${videoId}`
  if (rp === own) return { kind: 'pending', puzzleId: rp }
  if (rx === own) return { kind: 'pending', puzzleId: rx, extra: true }
  return { kind: 'off' }
}

// sessionIdentity — кто вошёл: 'out' — сессии нет («Выход» здесь или в другой
// вкладке, сессия кончилась); 'in:<префикс ключа>' — вошёл этот ключ; null —
// снимок ничего не говорит (загрузка, сбой чтения), прежнее значение остаётся.
function sessionIdentity(): string | null {
  const s = getSession()
  if (s.status !== 'ready') return null
  return s.authenticated ? `in:${s.keyPrefix}` : 'out'
}

// useRouteMode — режим плеера. Сессия кончилась — режим `off` сразу и сброшен
// (ревью партии 2, C1). Новый вход при открытом плеере (после «Выхода» или другим
// ключом) — проверка заново, свежим GET состояния (повторное ревью R-M1): иначе
// прежний `confirmed` возвращался непроверенным, и плеер слал события под route_id
// прежнего ключа и прогресс чужого ролика под новым. Первый ответ снимка после
// загрузки страницы (null → вошёл) проверку не повторяет: её первый проход сам
// ждёт снимка (ensureSession).
export function useRouteMode(videoId: string, rp: string | null, rc: string | null, deps: RouteModeDeps = browserDeps, rx: string | null = null): RouteModeView {
  const [view, setView] = useState<RouteModeView>(() => initialRouteMode(videoId, rp, deps.marked(), rx))
  const [ident, setIdent] = useState<string | null>(sessionIdentity)
  const identRef = useRef(ident)
  const [epoch, setEpoch] = useState(0)
  useEffect(() => subscribeSession(() => {
    const next = sessionIdentity()
    const prev = identRef.current
    if (next === null || next === prev) return
    identRef.current = next
    setIdent(next)
    if (next === 'out') setView(OFF_VIEW)
    else if (prev !== null) setEpoch(e => e + 1)
  }), [])
  useEffect(() => {
    let alive = true
    setView(initialRouteMode(videoId, rp, deps.marked(), rx))
    let budget: ReturnType<typeof setTimeout> | null = null
    if (deps.marked() && (rp === `youtube::${videoId}` || rx === `youtube::${videoId}`)) {
      // Жёсткий потолок 15 с: не подтвердился — гостевой режим, поздний ответ не нужен.
      budget = setTimeout(() => { if (alive) { alive = false; setView({ kind: 'off' }) } }, ROUTE_MODE_BUDGET_MS)
    }
    void checkRouteMode(videoId, rp, rc, deps, rx).then(v => {
      if (!alive) return
      if (budget) clearTimeout(budget)
      budget = null
      setView(v)
    })
    return () => { alive = false; if (budget) clearTimeout(budget) }
    // deps — стабильный объект модуля; смена ролика, параметров или вошедшего
    // ключа (epoch) — новая проверка.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId, rp, rc, rx, epoch])
  return ident === 'out' ? OFF_VIEW : view
}

const OFF_VIEW: RouteModeView = { kind: 'off' }
