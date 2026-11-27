// RoutePageCabinet.tsx — страница «Маршрут» кабинета /app/route (спека
// 2026-11-17 §4.3–§4.6, §4.12; план B10a, B10b).
//
// Состояния §4.3: загрузка, нет права, ключ истёк, маршрута нет (быстрый старт),
// подбор, «начат, дня нет», день, маршрут кончился, временный сбой (по КОДУ
// ошибки: отсчёт и автоповтор), отказ шлюза (без повтора).
//
// Флаг маршрута (метка `flib-route` в index.html) выключен — «скоро», как до
// этапа 2 (CabinetRouteGate): ни одного запроса маршрута.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useSession } from '../../useSession'
import { CabinetSoon } from '../CabinetSoon'
import { cabinetRouteMarked } from './route-storage'
import { useRouteState, broadcastRouteRevision, invalidateRouteStateRead } from './use-route-state'
import { routeApi, retryDelaySec, type RouteState } from './route-api'
import { refreshSession } from '../../session'
import { isStuckExchange } from './exchange-machine'
import { useRouteExchange, type ExchangeHookDeps } from './use-route-exchange'
import { getRouteOutbox } from './outbox'
import { pruneWatched } from '../../../player/route-events/route-watched'
import { buildDayModel, nextGuard } from './day-model'
import { QuickStart } from './QuickStart'
import { BuildingView } from './BuildingView'
import { NoDayView } from './NoDayView'
import { DayView } from './DayView'
import { useExtraVideo } from './use-extra-video'
import { GatewayRefused, KeyExpired, NoRouteRight, RouteOver, TemporaryDown } from './RouteMessages'
import { localDayInputs } from './local-inputs'
import { runHeardCheck } from './heard-check/heard-check-flow'
import { confirmNextClip, SKIP_HC_PARAM } from './heard-check/next-warning-flow'
import { resetHeardCheckMemory } from './heard-check/heard-check-memory'
import './route.css'

export interface RoutePageTestDeps extends ExchangeHookDeps {
  now?: () => number
  fetch?: (url: string, init?: RequestInit) => Promise<Response>
}

export function CabinetRouteGate() {
  return cabinetRouteMarked() ? <RoutePageCabinet /> : <CabinetSoon title="Маршрут" />
}

const ROUTE_OVER = new Set(['goal', 'exhausted', 'prep_done'])

export function RoutePageCabinet({ testDeps }: { testDeps?: RoutePageTestDeps } = {}) {
  const s = useSession()
  if (s.state === 'expired') return <><PageHead /><KeyExpired demo={s.demo} /></>
  // Право маршрута известно только у активного снимка: при «unknown» (шлюз
  // недоступен) снимок говорит routeAllowed:false — это не отказ, а незнание;
  // страница читает состояние и покажет временный сбой по коду ответа.
  if (s.state === 'active' && !s.routeAllowed) return <><PageHead /><NoRouteRight /></>
  return <RouteBody demo={s.demo} testDeps={testDeps} />
}

function PageHead({ label }: { label?: string }) {
  return (
    <div className="ph" style={{ marginBottom: 24 }}>
      <span className="mono">{label ? `Маршрут · ${label}` : 'Маршрут'}</span>
    </div>
  )
}

function RouteBody({ demo, testDeps }: { demo: boolean; testDeps?: RoutePageTestDeps }) {
  const rs = useRouteState()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const ex = useRouteExchange({ reload: rs.reload, onNavigate: url => navigate(url), deps: { sleep: testDeps?.sleep } })
  const [, setTick] = useState(0)
  const [resetting, setResetting] = useState(false)
  // Тест после ролика + выгрузка очереди по ?next=: кнопка героя занята (до ~5 с).
  const [nextBusy, setNextBusy] = useState(false)
  // resetFailedUntil — сброс не удался: сообщение и кнопка неактивна до конца
  // Retry-After (ревью 3а, L3).
  const [resetFailedUntil, setResetFailedUntil] = useState<number | null>(null)
  const resumed = useRef(new Set<string>())
  const nextHandled = useRef(false)

  const read = rs.read
  const state: RouteState | null = read && read.result.ok ? read.result.data : null

  // Сторож удаления `flib:route-watched` (§4.2 п.2) — на КАЖДОМ ответе
  // состояния, под блокировкой очереди (L13), с пробой момента отправки.
  useEffect(() => {
    if (!read || !read.result.ok) return
    const st = read.result.data
    let alive = true
    void getRouteOutbox().locked(() => { pruneWatched(st, read.sent) }).then(() => { if (alive) setTick(t => t + 1) })
    return () => { alive = false }
  }, [read])

  // 401 при чтении состояния (ключ отозван, сессия недействительна, §3.3, §7 случай
  // 2): перечитать сессию — каркас кабинета уведёт на вход (ревью 3а, M2).
  useEffect(() => {
    if (read && !read.result.ok && read.result.status === 401) void refreshSession().catch(() => undefined)
  }, [read])

  // Отчёт ролика дня принят шлюзом (пачка 200) — состояние на экране могло быть
  // посчитано до него: перечитать один раз свежим запросом (ревью 3а, H1).
  const reload = rs.reload
  const stateRef = useRef<RouteState | null>(null)
  stateRef.current = state
  useEffect(() => getRouteOutbox().onReportsAccepted(pids => {
    const cur = stateRef.current
    const rows = cur?.day?.clips ?? []
    // Первого ответа ещё нет — тоже перечитать (ревью 3а, R1-L1): запрос в полёте
    // мог уйти до отчёта.
    const extras = cur?.extras ?? []
    if (cur && !pids.some(p => rows.some(c => c.delivered === true && c.puzzle_id === p) || extras.some(e => e.puzzle_id === p))) return
    invalidateRouteStateRead()
    void reload()
  }), [reload])

  // Возобновление опроса обмена, начатого раньше (§4.6 п.3): active_exchange.
  useEffect(() => {
    if (!state || ex.isBusy()) return
    const a = state.active_exchange
    if (!a || isStuckExchange(a, Date.now()) || resumed.current.has(a.job_id)) return
    resumed.current.add(a.job_id)
    void ex.poll('resume', state, a.job_id, state.revision)
  }, [state, ex])

  // Сторож `?next=` (§4.7, N-C1): обмен — только если next = текущий и есть
  // невыданный; параметр убирается всегда.
  useEffect(() => {
    if (nextHandled.current || !state) return
    const next = params.get('next')
    nextHandled.current = true
    if (next === null) return
    const p = new URLSearchParams(params)
    p.delete('next')
    const skipHc = params.get(SKIP_HC_PARAM) === '1'
    p.delete(SKIP_HC_PARAM)
    setParams(p, { replace: true })
    // Тот же вход «дальше», что и герой дня: тест после ролика — до обмена
    // (из плеера он уже пройден — id в памяти отправленных, тест не повторится).
    // skip_hc=1 — человек уже подтвердил «Всё равно перейти» в плеере/уроке: теста нет.
    if (nextGuard(state, next)) {
      if (skipHc) void ex.run('next_clip', state, { want: 'next' })
      else void (async () => {
        // Единая точка: сюда приходят и «Продолжить маршрут» с главной кабинета. Прослушанный
        // ролик (и не-YouTube) возвращает 'listened' сразу — путь плеера/урока не меняется.
        const dec = await confirmNextClip(state.current_puzzle_id)
        if (dec === 'stay') return
        if (dec === 'listened') {
          setNextBusy(true)
          let r: Awaited<ReturnType<typeof runHeardCheck>>
          try { r = await runHeardCheck(state) } finally { setNextBusy(false) }
          if (r === 'abandoned') return
        }
        void ex.run('next_clip', state, { want: 'next' })
      })()
    }
  }, [state, params, setParams, ex])

  const reset = useCallback(async () => {
    setResetting(true)
    const r = await routeApi.reset()
    setResetting(false)
    if (!r.ok) {
      if (r.status === 401) { void refreshSession().catch(() => undefined); return }
      const until = Date.now() + retryDelaySec(r) * 1000
      setResetFailedUntil(until)
      setTimeout(() => setResetFailedUntil(u => (u === until ? null : u)), until - Date.now())
      return
    }
    setResetFailedUntil(null)
    resetHeardCheckMemory()
    // Чтение, ушедшее до сброса, показало бы прежний маршрут (ревью PR-C, N3).
    invalidateRouteStateRead()
    const after = await rs.reload()
    if (after.result.ok) broadcastRouteRevision(after.result.data.revision)
  }, [rs])
  const resetBusy = resetting || resetFailedUntil !== null
  const resetNote = resetFailedUntil !== null ? <NoticeLine text="Не удалось сбросить маршрут. Попробуйте позже" /> : null

  // Дополнительное видео: машина кнопки живёт здесь и переживает экран подбора дня.
  const extra = useExtraVideo({
    state, demo, reload: rs.reload,
    dayBusy: !!ex.view.running || nextBusy || (!!state?.active_exchange && !ex.view.notice && !isStuckExchange(state.active_exchange, Date.now())),
    deps: { sleep: testDeps?.sleep, now: testDeps?.now },
  })

  const pageError = ex.view.pageError ?? (read && !read.result.ok && read.result.status === 403 ? read.result.code ?? 'forbidden' : null)
  if (pageError === 'key_expired') return <><PageHead /><KeyExpired demo={demo} /></>
  if (pageError) return <><PageHead /><NoRouteRight /></>

  if (!read) return <><PageHead /><div className="done-card" data-testid="route-skeleton" aria-busy="true"><span className="hero-wait"><span className="spin" /></span></div></>

  if (!read.result.ok) {
    const e = read.result
    // 401: сессия перечитывается (эффект выше), каркас уведёт на вход — пока скелет.
    if (e.status === 401) return <><PageHead /><div className="done-card" data-testid="route-skeleton" aria-busy="true"><span className="hero-wait"><span className="spin" /></span></div></>
    if (e.cls === 'refused') return <><PageHead /><GatewayRefused /></>
    if (e.cls === 'temporary' || e.cls === 'rate') return <><PageHead /><TemporaryDown until={rs.retryAt} /></>
    if (e.status === 404) return <CabinetSoon title="Маршрут" />
    return <><PageHead /><GatewayRefused /></>
  }

  const st = read.result.data
  const running = ex.view.running
  const stuck = isStuckExchange(st.active_exchange, Date.now())
  const label = st.goal_label || undefined

  // Подбор: наш обмен (кроме замены — она ждёт на герое) или чужой active_exchange.
  if ((running && running.kind !== 'replace') || (st.active_exchange && !running && !ex.view.notice)) {
    return (
      <>
        <PageHead label={label} />
        <BuildingView phase={ex.view.phase} stuck={!running && stuck}
          first={!st.day}
          status={(ex.view.phase?.kind === 'polling' ? ex.view.phase.status : undefined) ?? st.active_exchange?.status ?? null}
          since={st.active_exchange ? Date.parse(st.active_exchange.created_at) : null}
          onRestart={() => void ex.run('start_day', st, { want: 'next' })} />
      </>
    )
  }

  if (!st.started) {
    return (
      <QuickStart
        onStarted={(jobId, revision) => void ex.poll('quick', null, jobId, revision)}
        onReread={() => void rs.reload()}
        onPageError={status => { if (status === 401) void refreshSession().catch(() => undefined); else void rs.reload() }} />
    )
  }

  // Маршрут кончился и дня нет (ревью 3а, L5): BFF отдаёт stop_reason и без плана.
  if (!st.day && st.stop_reason && ROUTE_OVER.has(st.stop_reason)) {
    return (
      <>
        <PageHead label={label} />
        {resetNote}
        <RouteOver reason={st.stop_reason} busy={resetBusy} onRestart={() => void reset()} />
      </>
    )
  }

  if (!st.day) {
    return (
      <>
        <PageHead label={label} />
        {ex.view.notice && <NoticeLine text={ex.view.notice.text} />}
        {resetNote}
        <NoDayView code={ex.view.lastErrorCode} busy={!!running || resetBusy}
          onRetry={() => void ex.run('retry', st, { want: 'next' })} onReset={() => void reset()} />
      </>
    )
  }

  const model = buildDayModel(st, localDayInputs(st, read.sent))
  if (st.stop_reason && ROUTE_OVER.has(st.stop_reason) && !model.hasUndelivered && (model.dayDone || !model.current)) {
    return (
      <>
        <PageHead label={label} />
        {resetNote}
        <RouteOver reason={st.stop_reason} busy={resetBusy} onRestart={() => void reset()} />
      </>
    )
  }

  return <DayView state={st} model={model} label={label} exchange={ex} onReset={() => void reset()} resetBusy={resetBusy} resetNote={resetNote} externalBusy={nextBusy} extra={extra} demo={demo} />
}

function NoticeLine({ text }: { text: string }) {
  return <div className="msg warn" role="status" style={{ marginBottom: 16 }}><span>{text}</span></div>
}
