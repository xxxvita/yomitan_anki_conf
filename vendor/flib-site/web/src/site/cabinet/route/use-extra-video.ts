// use-extra-video.ts — машина кнопки «Дополнительное видео» (спека extra-video
// §6, §9, §10). Живёт в RouteBody: переживает экран подбора дня. Один подбор за
// раз (ссылка-сторож ставится синхронно), опрос раз в 2 с до 10 мин, подхват
// чужого подбора по `extra_active` без POST, результат — строка в `extras`
// перечитанного состояния (ролик браузеру задание не отдаёт).
//
// Правила: подбор останавливает ТОЛЬКО его токен (`run`); каждый выход подбора,
// которому токен ещё принадлежит, идёт через `finish`; пустое состояние (чтение
// не удалось) значит «не знаем», а не «чужой маршрут».
import { useCallback, useEffect, useRef, useState } from 'react'
import { routeApi, retryDelaySec, type ApiError, type ExtraRow, type RouteState } from './route-api'
import { forDate, learningDayOf, savedDayTransition } from './learning-day'
import { isStuckExchange } from './exchange-machine'
import { invalidateRouteStateRead, type StateRead } from './use-route-state'
import { refreshSession } from '../../session'

export const EXTRA_GENERIC = 'Не получилось подобрать видео. Попробуйте ещё раз'
export const EXTRA_NONE = 'Сейчас подходящего видео нет. Попробуйте позже'
export const EXTRA_LIMIT = 'На сегодня это все дополнительные видео'
export const EXTRA_UNAVAILABLE = 'Подбор видео сейчас недоступен'
export const EXTRA_BUSY = 'Подбор уже идёт в программе. Попробуйте через минуту'
export const EXTRA_SLOW = 'Подбор идёт дольше обычного'
const rateText = (min: number) => `Слишком часто. Попробуйте через ${min} мин`

const POLL_MS = 2_000
const SLOW_MS = 60_000
const GIVE_UP_MS = 10 * 60_000
const REREAD_MS = 60_000
const RATE_WAKE_MS = 60_000
const OVER_LIMIT_FAILS = 3

export interface ExtraVideoView {
  visible: boolean; disabled: boolean; busy: boolean
  note: string | null; focusPid: string | null
  start: () => void; focusDone: () => void
}
export interface ExtraVideoDeps { sleep?: (ms: number) => Promise<void>; now?: () => number }

const defaultSleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

// newRow — строка, чьего id не было в extras, когда подбор начался (шлюз выдаёт
// без повторов: тот же id, что был, новой строкой не считается).
function newRow(before: Set<string>, rows: ExtraRow[]): ExtraRow | null {
  let found: ExtraRow | null = null
  for (const r of rows) if (!before.has(r.puzzle_id)) found = r
  return found
}
const idsOf = (st: RouteState) => new Set((st.extras ?? []).map(e => e.puzzle_id))

export function useExtraVideo(a: {
  state: RouteState | null; demo: boolean; dayBusy: boolean
  reload: () => Promise<StateRead>; deps?: ExtraVideoDeps
}): ExtraVideoView {
  const { state, demo, dayBusy, reload } = a
  const sleep = a.deps?.sleep ?? defaultSleep
  const now = a.deps?.now ?? Date.now
  const [searching, setSearching] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [focusPid, setFocusPid] = useState<string | null>(null)
  const [limitKey, setLimitKey] = useState<string | null>(null)
  const [rate, setRate] = useState<{ until: number; ms: number } | null>(null)
  const [, setTick] = useState(0)

  const guard = useRef(false)
  const run = useRef(0)
  const mounted = useRef(true)
  const stateRef = useRef<RouteState | null>(state)
  stateRef.current = state
  const seen = useRef(new Set<string>())
  const lastRoute = useRef<string | null | undefined>(undefined)
  const dayBusyRef = useRef(dayBusy)
  dayBusyRef.current = dayBusy
  const reloadRef = useRef(reload)
  reloadRef.current = reload
  const depsRef = useRef({ sleep, now })
  depsRef.current = { sleep, now }

  const today = learningDayOf(new Date(now()), savedDayTransition())
  const newDay = !!state?.snapshot_date && state.snapshot_date < today
  const dayKey = `${state?.route_id ?? ''}|${state?.snapshot_date ?? ''}|${today}`
  const visible = !!state?.day && state.extras !== undefined && !demo && !newDay
  const limited = limitKey === dayKey
  const unavailable = state?.extra_available !== true
  // until − now() > ms: часы переведены назад — срок считается вышедшим.
  const rateLeft = rate === null ? 0 : rate.until - now()
  const rateActive = rate !== null && rateLeft > 0 && rateLeft <= rate.ms

  const reloadQuiet = useCallback(() => { void Promise.resolve().then(() => reloadRef.current()).catch(() => undefined) }, [])

  const finish = useCallback((my: number, text: string | null) => {
    if (run.current !== my) return
    guard.current = false
    setSearching(false)
    setNote(text)
  }, [])

  const cancelAll = useCallback(() => {
    run.current++
    guard.current = false
    seen.current.clear()
    setSearching(false); setNote(null); setFocusPid(null); setLimitKey(null); setRate(null)
  }, [])

  const poll = useCallback(async (my: number, jobId: string, routeId: string, before: Set<string>, own: boolean) => {
    const loop = async () => {
      const t0 = depsRef.current.now()
      let refreshed = false
      let overFails = 0
      // resolveClip — ролик выдан: строка берётся из состояния. Сначала то, что уже на
      // экране; одно своё перечитывание; неудачное чтение класса `other`/`refused` — общий
      // текст сразу, иначе ждём собственных повторов страницы (по Retry-After) до ~60 с.
      const resolveClip = async () => {
        const done = (fresh: ExtraRow | null) => {
          if (fresh && own) setFocusPid(fresh.puzzle_id)
          finish(my, fresh ? null : EXTRA_GENERIC)
        }
        const t1 = depsRef.current.now()
        let reloaded = false
        let failed = false
        let failedAt: RouteState | null = null
        for (;;) {
          const cur = stateRef.current
          if (cur && cur.route_id === routeId) {
            const fresh = newRow(before, cur.extras ?? [])
            if (fresh) { done(fresh); return }
            // Состояние прочитано ПОСЛЕ неудачи и строки в нём нет.
            if (failed && cur !== failedAt) { done(null); return }
          }
          if (!reloaded) {
            reloaded = true
            invalidateRouteStateRead()
            const read = await reloadRef.current()
            if (run.current !== my) return
            if (read.result.ok) {
              const dd = read.result.data
              if (dd.route_id !== routeId) { finish(my, null); return }
              done(newRow(before, dd.extras ?? []))
              return
            }
            failed = true
            failedAt = stateRef.current
            if (read.result.cls === 'other' || read.result.cls === 'refused') { finish(my, EXTRA_GENERIC); return }
          }
          if (depsRef.current.now() - t1 >= REREAD_MS) { finish(my, EXTRA_GENERIC); return }
          await depsRef.current.sleep(POLL_MS)
          if (run.current !== my) return
        }
      }
      for (;;) {
        await depsRef.current.sleep(POLL_MS)
        if (run.current !== my) return
        const r = await routeApi.extraJob(jobId)
        if (run.current !== my) return
        const elapsed = depsRef.current.now() - t0
        if (!r.ok) {
          if (r.status === 404 || r.cls === 'refused') { finish(my, EXTRA_GENERIC); return }
          if (r.status === 401) {
            if (refreshed) { finish(my, EXTRA_GENERIC); return }
            refreshed = true
            void refreshSession().catch(() => undefined)
          } else if (r.status === 403) { reloadQuiet(); finish(my, EXTRA_GENERIC); return }
        } else {
          const out = (r.data as { outcome?: unknown } | null)?.outcome
          if (out === 'none') { finish(my, EXTRA_NONE); return }
          if (out === 'failed') { finish(my, EXTRA_GENERIC); return }
          if (out === 'clip') { await resolveClip(); return }
        }
        // Срок вышел: заканчиваем только на удачном ответе опроса или после трёх
        // неудач подряд (спавшее устройство не должно терять готовый ролик).
        if (elapsed >= GIVE_UP_MS) {
          if (r.ok || ++overFails >= OVER_LIMIT_FAILS) { finish(my, EXTRA_GENERIC); return }
        }
        if (elapsed >= SLOW_MS) setNote(EXTRA_SLOW)
      }
    }
    try { await loop() } catch { finish(my, EXTRA_GENERIC) }
  }, [finish, reloadQuiet])

  const begin = useCallback((jobId: string, st: RouteState) => {
    const my = ++run.current
    guard.current = true
    seen.current.add(jobId)
    setSearching(true)
    setNote(null)
    setFocusPid(null)
    void poll(my, jobId, st.route_id ?? '', idsOf(st), false)
  }, [poll])

  const start = useCallback(() => {
    const st = stateRef.current
    if (guard.current || !st?.day || st.extras === undefined || demo || dayBusyRef.current) return
    const nowMs = depsRef.current.now()
    const todayNow = learningDayOf(new Date(nowMs), savedDayTransition())
    // Страница пережила смену учебного дня: запроса нет, состояние перечитывается.
    if (st.snapshot_date && st.snapshot_date < todayNow) { reloadQuiet(); return }
    guard.current = true
    const my = ++run.current
    setSearching(true)
    setNote(null)
    setFocusPid(null)
    const forDay = forDate(st.snapshot_date, new Date(nowMs))
    const routeId = st.route_id ?? ''
    const key = `${routeId}|${st.snapshot_date ?? ''}|${todayNow}`
    void (async () => {
      try {
        const r = await routeApi.extra(forDay)
        if (run.current !== my) return
        if (r.ok) {
          const jobId = (r.data as { job_id?: unknown } | null)?.job_id
          if (typeof jobId !== 'string' || jobId === '') { finish(my, EXTRA_GENERIC); return }
          seen.current.add(jobId)
          await poll(my, jobId, routeId, idsOf(st), true)
          return
        }
        refuse(r, my, key)
      } catch { finish(my, EXTRA_GENERIC) }
    })()
    function refuse(e: ApiError, id: number, k: string) {
      const code = e.code
      if (e.status === 409 && code === 'more_day_limit') { setLimitKey(k); finish(id, null); return }
      if (e.status === 409 && code === 'more_busy') { finish(id, EXTRA_BUSY); return }
      if (e.status === 429) {
        const sec = retryDelaySec(e)
        const until = depsRef.current.now() + sec * 1000
        setRate({ until, ms: sec * 1000 })
        finish(id, null)
        // Отсчёт: пока срок не вышел по часам, спим не дольше минуты и перерисовываем.
        void (async () => {
          while (mounted.current && until - depsRef.current.now() > 0 && until - depsRef.current.now() <= sec * 1000) {
            await depsRef.current.sleep(Math.min(until - depsRef.current.now(), RATE_WAKE_MS))
            setTick(t => t + 1)
          }
          if (mounted.current) setRate(cur => (cur && cur.until === until ? null : cur))
        })()
        return
      }
      if (e.status === 503 && code === 'more_unavailable') { reloadQuiet(); finish(id, EXTRA_UNAVAILABLE); return }
      if (e.status === 401) { void refreshSession().catch(() => undefined); finish(id, EXTRA_GENERIC); return }
      if (e.status === 403) { reloadQuiet(); finish(id, EXTRA_GENERIC); return }
      if (e.status === 409 && (code === 'no_day' || code === 'route_not_started')) { reloadQuiet(); finish(id, EXTRA_GENERIC); return }
      finish(id, EXTRA_GENERIC)
    }
  }, [demo, finish, poll, reloadQuiet])

  // Размонтирование останавливает опрос; повторный монтаж (StrictMode) не оставляет «занято».
  useEffect(() => {
    mounted.current = true
    if (guard.current) { guard.current = false; seen.current.clear(); setSearching(false) }
    return () => { mounted.current = false; run.current++ }
  }, [])

  // Другой маршрут (сброс, импорт, другой ключ — в том числе «маршрута нет»): всё
  // очищено. Пустое состояние (чтение не удалось) — «не знаем», подбор не трогает.
  useEffect(() => {
    if (state === null) return
    const rid = state.route_id
    if (lastRoute.current !== undefined && lastRoute.current !== rid) cancelAll()
    lastRoute.current = rid
  }, [state, cancelAll])

  // Заметка прошлого подбора устаревает: сменился учебный день (snapshot_date) или в extras того же
  // маршрута появилась строка, которой раньше не было (подбор из другой вкладки). Первое состояние,
  // другой маршрут и пустое чтение ничего не очищают (маршрут обрабатывает cancelAll выше).
  const lastSnap = useRef<string | null | undefined>(undefined)
  const knownRows = useRef<{ route: string | null; ids: Set<string> } | null>(null)
  useEffect(() => {
    if (state === null) return
    const snap = state.snapshot_date ?? null
    if (lastSnap.current !== undefined && lastSnap.current !== snap) { setNote(null); setFocusPid(null) }
    lastSnap.current = snap
    const ids = idsOf(state)
    const prev = knownRows.current
    if (prev && prev.route === state.route_id && [...ids].some(id => !prev.ids.has(id))) setNote(null)
    knownRows.current = { route: state.route_id, ids }
  }, [state])

  // Подхват подбора, начатого раньше (другая вкладка, прежняя загрузка).
  useEffect(() => {
    if (!state || demo || state.extras === undefined) return
    const act = state.extra_active
    if (!act || guard.current || seen.current.has(act.job_id) || isStuckExchange(act, depsRef.current.now())) return
    begin(act.job_id, state)
  }, [state, demo, begin])

  // Устройство спало: срок Retry-After сверяется с часами при возврате на вкладку.
  useEffect(() => {
    const on = () => setTick(t => t + 1)
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])

  const focusDone = useCallback(() => setFocusPid(null), [])

  const disabled = searching || dayBusy || unavailable || limited || rateActive
  const idle = note ?? (limited ? EXTRA_LIMIT : rateActive && rate ? rateText(Math.max(1, Math.ceil(rateLeft / 60_000))) : unavailable && visible ? EXTRA_UNAVAILABLE : null)
  const shown = searching ? (note === EXTRA_SLOW ? note : null) : idle
  return { visible, disabled, busy: searching, note: shown, focusPid, start, focusDone }
}
