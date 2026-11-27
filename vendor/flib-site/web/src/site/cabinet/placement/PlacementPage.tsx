// PlacementPage.tsx — `/app/test`: тест уровня в кабинете (порт PL/src/App.tsx; спека §1, §4, §6).
// Порядок экранов: открытие (openRun — ремонт недоделанного финиша, восстановление, причина сброса) →
// S0 → S1–S3 → результат; над ними «Старт · Сейчас» и вкладка «История»; вопрос R16 — пока есть прогон
// с accepted:null. Все записи состояния — только через store.ts/run.ts поверх SiteHost (одна очередь на
// страницу). После принятого результата слова уходят в профиль маршрута (apply.ts).
// Жизнь хоста: открывается в эффекте, снимается в очистке (StrictMode повторяет эффект: замок вкладки и
// хост освобождаются, поздний результат отменённого открытия игнорируется). Внутренняя часть
// перемонтируется при смене того, кто вошёл (ключ по profileIdent и поколению сессии) — хост снимается.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from '../../useSession'
import { sessionGen } from '../../session'
import { CabinetSoon } from '../CabinetSoon'
import { profileIdent } from '../profile-api'
import { KeyExpired, NoRouteRight } from '../route/RouteMessages'
import { cabinetRouteMarked } from '../route/route-storage'
import { applyPlacement, type ApplyOptions, type ApplyOutcome } from './apply'
import { audioUrlOf, createPlayer, isAudioSupported, type Player } from './audio'
import { loadPlacementBank } from './bank-loader'
import type { Bank, Word } from './engine/bank'
import type { Item, Response, Session as Engine } from './engine/session'
import { langOf, t } from './i18n'
import { applyAnswer, openRun, outcomeOf, resumeRun } from './run'
import { openSiteHost, PlacementHostError, type SiteHost, type SiteHostOptions } from './site-host'
import {
  answerReplace, dropSession, finishRun, loadLastTab, loadOverview, repairHistory, saveLastTab, startRun,
  type Overview, type RunOutcome, type Session, type Tab,
} from './store'
import { AuralYesNo } from './ui/AuralYesNo'
import { History } from './ui/History'
import { MeaningMC } from './ui/MeaningMC'
import { ReplacePrompt } from './ui/ReplacePrompt'
import { Result } from './ui/Result'
import { RouteBlock, type ApplyUi } from './ui/RouteBlock'
import { S0SelfCheck, type Prior } from './ui/S0SelfCheck'
import { StartNow } from './ui/StartNow'
import { invalidatePlacement } from './use-placement'
import '../route/route.css'
import './placement.css'

const lang = langOf()

/** Подмена зависимостей — только тестам. */
export interface PlacementDeps {
  loadBank?: () => Promise<Bank>
  makePlayer?: () => Player
  newSeed?: () => bigint
  now?: () => number
  openHost?: (o: SiteHostOptions) => Promise<SiteHost>
  apply?: (host: SiteHost, o: ApplyOptions) => Promise<ApplyOutcome>
  supported?: () => boolean
}

type Phase =
  | { k: 'opening' }
  | { k: 'corrupt' }
  | { k: 's0'; notice?: string }
  | { k: 'resume'; session: Session; engine: Engine; item: Item }
  | { k: 'item'; session: Session; engine: Engine; item: Item }
  | { k: 'result'; outcome: RunOutcome; runId: string; asked: boolean }
  | { k: 'error'; key: string }

const RESET_NOTICE: Record<string, string> = {
  updated: 'pt.reset.updated', bank_changed: 'pt.reset.updated', engine_changed: 'pt.reset.updated',
  expired: 'pt.reset.expired', malformed: 'pt.reset.malformed',
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))
/** Сырой текст ошибки — только в лог; человеку — русское сообщение по ключу i18n. */
const logErr = (what: string, e: unknown) => { console.error(`placement: ${what}:`, errText(e)) }

/** Сессия `finishing`, чей прогон уже записан в историю (ответ записи потерялся): итог и состояние вопроса R16. */
function lostFinish(raw: unknown, ov: Overview): { outcome: RunOutcome; runId: string; asked: boolean } | null {
  const s = raw as { run_id?: unknown; finishing?: { outcome?: unknown } } | undefined
  if (!s || typeof s.run_id !== 'string' || !s.finishing || typeof s.finishing.outcome !== 'object' || s.finishing.outcome === null) return null
  const row = ov.history.find((r) => r.run_id === s.run_id)
  if (!row) return null
  return { outcome: s.finishing.outcome as RunOutcome, runId: s.run_id, asked: row.accepted === null }
}

const itemNo = (it: Item) => Number(/^it_(\d+)$/.exec(it.id)?.[1] ?? 0)

/** Сообщение по причине сбоя хоста; иное — базовое сообщение действия. */
function errorKey(base: string, e: unknown): string {
  if (!(e instanceof PlacementHostError)) return base
  switch (e.code) {
    case 'network': return 'pt.error.network'
    case 'unauthorized': return 'pt.error.unauthorized'
    case 'stale': return 'pt.error.stale'
    case 'unavailable': return 'pt.error.unavailable'
    case 'rate_limited': return 'pt.error.rate'
    case 'tab_busy': return 'pt.error.busytab'
    default: return base
  }
}

/**
 * Задание, которое экран не умеет показать (клип S4, meaning_mc без ru/дистракторов). Пакетный банк этого
 * не допускает; если всё же пришло — ошибка, а НЕ пропуск: skipped копил бы skipRun и после MaxSkipRun дал
 * ложный no_audio + floor.
 */
function Unsupported({ item, onError }: { item: Item; onError: (item: Item) => void }) {
  const ref = useRef(onError)
  ref.current = onError
  useEffect(() => { ref.current(item) }, [item])
  return null
}

function Head() {
  return (
    <div className="ph">
      <span className="mono">Тест уровня</span>
      <h1>Что Вы узнаёте <em>на слух</em></h1>
    </div>
  )
}

// Ворота — как у «Моих знаний»: без метки BFF — «скоро», ключ истёк — продление, нет права маршрута — объяснение.
export function PlacementPage({ deps = {} }: { deps?: PlacementDeps }) {
  const s = useSession()
  if (!cabinetRouteMarked()) return <CabinetSoon title="Тест уровня" />
  if (s.state === 'expired') return <><Head /><KeyExpired demo={s.demo} /></>
  if (s.state === 'active' && !s.routeAllowed) return <><Head /><NoRouteRight /></>
  return <PlacementBody key={`${profileIdent(s)}:${sessionGen()}`} deps={deps} />
}

type HostState = { k: 'opening' } | { k: 'ready'; host: SiteHost } | { k: 'error'; key: string }

function PlacementBody({ deps }: { deps: PlacementDeps }) {
  const [attempt, setAttempt] = useState(0)
  const [hs, setHs] = useState<HostState>({ k: 'opening' })
  const [bank, setBank] = useState<{ k: 'loading' } | { k: 'ready'; bank: Bank } | { k: 'failed' }>({ k: 'loading' })
  const [player, setPlayer] = useState<Player | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [bankAttempt, setBankAttempt] = useState(0)
  const depsRef = useRef(deps)
  depsRef.current = deps

  useEffect(() => {
    const ctl = new AbortController()
    let host: SiteHost | null = null
    setHs({ k: 'opening' })
    ;(depsRef.current.openHost ?? openSiteHost)({ signal: ctl.signal }).then(
      (h) => {
        if (ctl.signal.aborted) { h.dispose(); return }
        host = h
        setHs({ k: 'ready', host: h })
      },
      (e: unknown) => {
        if (ctl.signal.aborted) return
        logErr('open host', e)
        setHs({ k: 'error', key: errorKey('pt.error.open', e) })
      },
    )
    return () => { ctl.abort(); host?.dispose() }
  }, [attempt])

  useEffect(() => {
    let alive = true
    ;(depsRef.current.loadBank ?? loadPlacementBank)().then(
      (b) => { if (alive) setBank({ k: 'ready', bank: b }) },
      (e: unknown) => { logErr('bank load', e); if (alive) setBank({ k: 'failed' }) },
    )
    return () => { alive = false }
  }, [bankAttempt])

  useEffect(() => {
    const p = (depsRef.current.makePlayer ?? createPlayer)()
    setPlayer(p)
    return () => { p.dispose() }
  }, [])

  const reopen = useCallback((noticeKey: string | null) => { setNotice(noticeKey); setAttempt((a) => a + 1) }, [])

  let body: React.ReactNode
  if (hs.k === 'error') {
    body = (
      <div className="msg warn pt-banner" role="alert">
        <span>{t(lang, hs.key)}</span>
        <div className="pt-actions"><button type="button" className="btn" onClick={() => reopen(null)}>{t(lang, 'pt.retry')}</button></div>
      </div>
    )
  } else if (bank.k === 'failed') {
    body = (
      <div className="msg warn pt-banner" role="alert">
        <span>{t(lang, 'pt.bank.failed')}</span>
        <div className="pt-actions">
          <button type="button" className="btn" onClick={() => { setBank({ k: 'loading' }); setBankAttempt((a) => a + 1) }}>{t(lang, 'pt.retry')}</button>
        </div>
      </div>
    )
  } else if (hs.k === 'opening' || bank.k !== 'ready' || !player) {
    body = <p className="pt-muted" role="status">{t(lang, 'pt.loading')}</p>
  } else {
    body = <PlacementRun key={attempt} host={hs.host} bank={bank.bank} player={player} deps={deps} onKeyChanged={() => reopen('pt.error.keychanged')} />
  }
  return (
    <div className="pt-page">
      <Head />
      <div className="pt-root">
        {notice && <p className="pt-notice" role="status">{t(lang, notice)}</p>}
        {body}
        <p className="pt-attr">{t(lang, 'pt.cefrj')}</p>
      </div>
    </div>
  )
}

interface RunProps { host: SiteHost; bank: Bank; player: Player; deps: PlacementDeps; onKeyChanged: () => void }

function PlacementRun({ host, bank: ready, player, deps, onKeyChanged }: RunProps) {
  const [overview, setOverview] = useState<Overview | null>(null)
  const [phase, setPhase] = useState<Phase>({ k: 'opening' })
  const [tab, setTab] = useState<Tab>('test')
  const [busy, setBusy] = useState(false)
  const [applyUi, setApplyUi] = useState<ApplyUi>({ k: 'idle' })
  const busyRef = useRef(false)
  const epoch = useRef(0)
  const alive = useRef(true)
  // Колбэки родителя и подмены тестов — через ref: их новая тождественность не должна переоткрывать тест.
  const keyChangedRef = useRef(onKeyChanged)
  keyChangedRef.current = onKeyChanged
  const applyFnRef = useRef(deps.apply)
  applyFnRef.current = deps.apply
  const clock = useMemo(() => (deps.now ? { now: deps.now } : {}), [deps.now])
  const supported = useMemo(() => (deps.supported ?? isAudioSupported)(), [deps.supported])
  const words = useMemo(() => new Map<string, Word>(ready.words.map((w) => [w.lemma, w])), [ready])

  const life = useRef(new AbortController())
  useEffect(() => {
    alive.current = true
    if (life.current.signal.aborted) life.current = new AbortController() // StrictMode: повторный эффект
    return () => { alive.current = false; life.current.abort() }
  }, [])

  /** Обёртка записи: один ответ за раз (клавиши могут прийти дважды до перерисовки). */
  const guarded = useCallback(async (fn: () => Promise<void>) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try { await fn() } finally { busyRef.current = false; if (alive.current) setBusy(false) }
  }, [])

  const runApply = useCallback(async (force: boolean) => {
    setApplyUi({ k: 'working' })
    let r: ApplyOutcome
    try {
      r = await (applyFnRef.current ?? applyPlacement)(host, { force, signal: life.current.signal })
    } catch (e) {
      logErr('apply', e)
      r = { kind: 'failed' }
    }
    invalidatePlacement()
    if (!alive.current) return
    if (r.kind === 'key_changed') { keyChangedRef.current(); return }
    setApplyUi(r.kind === 'done' ? { k: 'done', counted: r.counted } : r.kind === 'failed' ? { k: 'failed' } : r.kind === 'declined' ? { k: 'declined' } : { k: 'idle' })
  }, [host])

  /** Принятый результат, слова которого маршрут ещё не получил (или не отказался получать), — применить. */
  const applyIfPending = useCallback((ov: Overview) => {
    const m = host.meta()
    if (!ov.lastRunId || m.appliedRunId === ov.lastRunId) return
    void runApply(false)
  }, [host, runApply])

  /** Сбой записи: смена ключа — открыть заново под новым; иначе экран ошибки с «Повторить». */
  const fail = useCallback((key: string, e: unknown) => {
    logErr(key, e)
    if (e instanceof PlacementHostError && e.code === 'key_changed') { keyChangedRef.current(); return }
    setPhase({ k: 'error', key: errorKey(key, e) })
  }, [])

  const open = useCallback(async () => {
    const my = ++epoch.current
    setPhase({ k: 'opening' })
    try {
      const first = await loadOverview(host)
      if (my !== epoch.current) return
      if (first.historyCorrupt) {
        setOverview(first)
        setPhase({ k: 'corrupt' })
        return
      }
      // Потерянный ответ на финише: запись легла, а страница узнала об ошибке. Сессия с finishing уже в
      // истории — openRun её удалит и скажет «none», но человеку надо показать результат ЭТОГО прогона.
      const lost = lostFinish(await host.storage.get('pt.session'), first)
      const [r, lastTab] = await Promise.all([openRun(host, ready, clock), loadLastTab(host)])
      const ov = await loadOverview(host)
      if (my !== epoch.current) return
      setOverview(ov)
      setTab(lastTab)
      if (r.kind === 'finished' || lost) invalidatePlacement()
      switch (r.kind) {
        case 'none': setPhase(lost ? { k: 'result', outcome: lost.outcome, runId: lost.runId, asked: lost.asked } : { k: 's0' }); break
        case 'resumed': setPhase({ k: 'resume', session: r.session, engine: r.engine, item: r.item }); break
        case 'finished': setPhase({ k: 'result', outcome: r.outcome, runId: r.run_id, asked: r.asked }); break
        case 'reset': setPhase({ k: 's0', notice: RESET_NOTICE[r.reason] ?? 'pt.reset.updated' }); break
      }
      applyIfPending(ov)
    } catch (e) {
      if (my === epoch.current) fail('pt.error.open', e)
    }
  }, [host, ready, clock, fail, applyIfPending])

  useEffect(() => {
    void open()
    return () => { epoch.current++ }
  }, [open])

  const refreshOverview = useCallback(async (): Promise<Overview | null> => {
    const my = epoch.current
    const ov = await loadOverview(host)
    if (my !== epoch.current) return null
    setOverview(ov)
    return ov
  }, [host])

  const start = (prior: Prior) => guarded(async () => {
    const my = epoch.current
    try {
      setApplyUi({ k: 'idle' })
      const s = await startRun(host, { prior, bankVersion: ready.version, ...(deps.newSeed ? { seed: deps.newSeed() } : {}), ...clock })
      const eng = resumeRun(ready, s)
      const item = eng.next()
      if (my !== epoch.current) return
      if (item) {
        setPhase({ k: 'item', session: s, engine: eng, item })
        return
      }
      const outcome = outcomeOf(eng)
      const { asked } = await finishRun(host, s, outcome, clock)
      const ov = await refreshOverview()
      if (ov && my === epoch.current) {
        setPhase({ k: 'result', outcome, runId: s.run_id, asked })
        if (ov.lastRunId === s.run_id) applyIfPending(ov)
      }
    } catch (e) { if (my === epoch.current) fail('pt.error.start', e) }
  })

  const answer = (r: Response) => guarded(async () => {
    if (phase.k !== 'item') return
    const my = epoch.current
    try {
      const res = await applyAnswer(host, phase.session, phase.engine, phase.item, r, clock)
      if (my !== epoch.current) return
      if (res.kind === 'next') setPhase({ ...phase, item: res.item })
      else if (res.kind === 'finished') {
        const ov = await refreshOverview()
        if (ov && my === epoch.current) {
          setPhase({ k: 'result', outcome: res.outcome, runId: res.run_id, asked: res.asked })
          invalidatePlacement()
          if (ov.lastRunId === res.run_id) applyIfPending(ov)
        }
      }
      // stale — ответ не на текущее задание, ничего не записано: экран тот же.
    } catch (e) { if (my === epoch.current) fail('pt.error.save', e) }
  })

  const restart = () => guarded(async () => {
    const my = epoch.current
    try {
      await dropSession(host)
      if (my === epoch.current) setPhase({ k: 's0' })
    } catch (e) { if (my === epoch.current) fail('pt.error.save', e) }
  })

  const replace = (runId: string, yes: boolean) => guarded(async () => {
    const my = epoch.current
    try {
      await answerReplace(host, runId, yes)
      const ov = await refreshOverview()
      invalidatePlacement()
      if (ov && yes && ov.lastRunId === runId) applyIfPending(ov)
    } catch (e) { if (my === epoch.current) fail('pt.error.replace', e) }
  })

  const repair = () => guarded(async () => {
    const my = epoch.current
    try {
      await repairHistory(host)
    } catch (e) { if (my === epoch.current) fail('pt.error.repair', e); return }
    if (my === epoch.current) void open()
  })

  const unsupported = useCallback((it: Item) => {
    logErr('unsupported item', new Error(`${it.kind} ${it.id}`))
    setPhase({ k: 'error', key: 'pt.error.item' })
  }, [])

  const switchTab = (next: Tab) => {
    setTab(next)
    saveLastTab(host, next).catch(() => {})
  }

  const retake = () => { setApplyUi({ k: 'idle' }); setPhase({ k: 's0' }) }

  /** «Прервать тест»: прогон остаётся в хранилище, экран «Продолжить / Начать заново». */
  const abort = () => {
    if (phase.k === 'item') setPhase({ k: 'resume', session: phase.session, engine: phase.engine, item: phase.item })
  }

  const applyNote = (phase.k === 's0' || phase.k === 'resume') && (applyUi.k === 'failed' || applyUi.k === 'declined')
    ? <div className="pt-notice"><RouteBlockNote state={applyUi} onApply={(f) => void runApply(f)} /></div>
    : null

  const body = () => {
    if (phase.k === 'opening') return <p className="pt-muted" role="status">{t(lang, 'pt.loading')}</p>
    if (phase.k === 'corrupt') {
      return (
        <div className="pt-banner" role="alert">
          <p>{t(lang, 'pt.hist.corrupt')}</p>
          <p className="pt-muted">{t(lang, 'pt.hist.repair.note')}</p>
          <div className="pt-actions"><button type="button" disabled={busy} onClick={repair}>{t(lang, 'pt.hist.repair')}</button></div>
        </div>
      )
    }
    if (phase.k === 'error') {
      return (
        <div className="pt-banner" role="alert">
          <p>{t(lang, phase.key)}</p>
          <div className="pt-actions">
            {phase.key === 'pt.error.item'
              ? <button type="button" disabled={busy} onClick={restart}>{t(lang, 'pt.resume.restart')}</button>
              : <button type="button" onClick={() => { void open() }}>{t(lang, 'pt.retry')}</button>}
          </div>
        </div>
      )
    }
    if (tab === 'history') {
      return (
        <History lang={lang} rows={overview?.history ?? []} lastRunId={overview?.lastRunId} startRunId={overview?.start?.run_id}
          bankVersion={ready.version} onBack={() => switchTab('test')} />
      )
    }
    const q = overview?.question
    if (q && phase.k !== 'item') return <ReplacePrompt lang={lang} row={q} busy={busy} onAnswer={(yes) => replace(q.run_id, yes)} />
    switch (phase.k) {
      case 's0':
        return (
          <>
            {applyNote}
            <S0SelfCheck lang={lang} player={player} testUrl={audioUrlOf({ lemma: ready.words[0]?.lemma ?? 'the', pseudo: false })}
              busy={busy} notice={phase.notice} supported={supported} onStart={start} />
          </>
        )
      case 'resume':
        return (
          <>
            {applyNote}
            <section className="pt-resume">
              <h2>{t(lang, 'pt.resume.title')}</h2>
              <div className="pt-actions">
                <button type="button" className="pt-primary" disabled={busy}
                  onClick={() => setPhase({ k: 'item', session: phase.session, engine: phase.engine, item: phase.item })}>
                  {t(lang, 'pt.resume.continue')}
                </button>
                <button type="button" disabled={busy} onClick={restart}>{t(lang, 'pt.resume.restart')}</button>
              </div>
            </section>
          </>
        )
      case 'item': {
        const it = phase.item
        const common = { lang, item: it, n: itemNo(it), url: audioUrlOf(it), player, busy, onAnswer: answer, onAbort: abort }
        if (it.kind === 'aural_yesno') return <AuralYesNo key={it.id} {...common} />
        const w = words.get(it.lemma)
        if (it.kind === 'meaning_mc' && w?.ru && w.distractors?.length === 3) {
          return <MeaningMC key={it.id} {...common} word={w} runId={phase.session.run_id} />
        }
        return <Unsupported key={it.id} item={it} onError={unsupported} />
      }
      case 'result': {
        // Прогон не стал текущим: на другом устройстве уже есть более новый результат (accepted:false без вопроса).
        const stale = !phase.asked && overview !== null && overview.lastRunId !== phase.runId
        const accepted = overview !== null && overview.lastRunId === phase.runId
        return (
          <Result lang={lang} outcome={phase.outcome} onRetake={retake} stale={stale}
            extra={accepted ? <RouteBlock lang={lang} state={applyUi} flags={phase.outcome.flags} onApply={(f) => void runApply(f)} /> : undefined} />
        )
      }
    }
    return null
  }

  const showChrome = overview !== null && !overview.historyCorrupt
  return (
    <>
      {showChrome && <StartNow lang={lang} start={overview.start} now={overview.now} lastRunId={overview.lastRunId} />}
      {showChrome && (
        <nav className="pt-tabs" aria-label={t(lang, 'pt.title')}>
          <button type="button" aria-pressed={tab === 'test'} onClick={() => switchTab('test')}>{t(lang, 'pt.tab.test')}</button>
          <button type="button" aria-pressed={tab === 'history'} onClick={() => switchTab('history')}>{t(lang, 'pt.tab.history')}</button>
        </nav>
      )}
      {body()}
    </>
  )
}

/** Строка об итоге передачи слов вне экрана результата (открытие теста: сбой или «начали сами»). */
function RouteBlockNote({ state, onApply }: { state: ApplyUi; onApply: (force: boolean) => void }) {
  return (
    <div role="status">
      {state.k === 'failed' && (
        <>
          <p className="pt-warn">{t(lang, 'pt.route.failed')}</p>
          <div className="pt-actions"><button type="button" onClick={() => onApply(false)}>{t(lang, 'pt.route.retry')}</button></div>
        </>
      )}
      {state.k === 'declined' && (
        <>
          <p className="pt-warn">{t(lang, 'pt.route.declined')}</p>
          <div className="pt-actions"><button type="button" onClick={() => onApply(true)}>{t(lang, 'pt.route.apply')}</button></div>
        </>
      )}
    </div>
  )
}
