// DayView.tsx — экран дня (спека 2026-11-17 §4.5, §4.6 «Оценка и замена»,
// §4.12; план B10b; макет «Маршрут — день»).
//
// Заголовок «Сегодня, 17 ноября» (по `day.date`; не сегодня — «17 ноября»),
// строка метаданных «k из M просмотрено · T мин · +W слов» (kept, kept_local и
// текущий план вместе); герой — последний выданный ролик (или карточка «На
// сегодня всё — до завтра», или «Начать день»); список дня; «Получить ролики на
// сегодня» в новый учебный день.
//
// Оценка и замена «точно как в приложении» (решения владельца 1–3):
//   • «Нравится» — clip_rated {like, subs_source:""} в очередь;
//   • «Не нравится» — строка причин; «Отправить» — clip_rated {dislike,
//     rate_reason, subs_source:""}, при галке затем замена с тем же replace_reason;
//   • «Заменить» — подтверждение одной строкой; [Заменить] — замена БЕЗ причины и
//     без clip_rated.
// Шаги замены (оба пути): несданные clip_played ролика выбрасываются и его запись
// `flib:route-watched` удаляется — под одной блокировкой очереди (L13); затем
// выгрузка (≤ 5 с) и обмен `replace` с `replace_puzzle_id` ЭТОГО ролика.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { RouteState } from './route-api'
import type { DayModel, DayRow } from './day-model'
import type { useRouteExchange } from './use-route-exchange'
import { learningDayOf, savedDayTransition } from './learning-day'
import { getRouteOutbox } from './outbox'
import { rateClip, ratingOf } from './route-ratings'
import { lessonHeardCount } from './route-lesson'
import { DayHero, StartDayHero } from './DayHero'
import { DayClipList } from './DayClipList'
import { ExtraVideos } from './ExtraVideos'
import type { ExtraVideoView } from './use-extra-video'
import { canReplaceRow, type DayActions, type OpenPanel } from './day-actions'
import { SupportLink } from './RouteMessages'
import { plural } from '../../plural'
import type { ClipDislikeReason } from '../../../player/route-events/mapper'
import { Calendar } from './Calendar'
import { PastDay, PastDayHead } from './PastDay'
import { RouteSettingsPanel } from './RouteSettingsPanel'
import { runHeardCheck } from './heard-check/heard-check-flow'
import { confirmNextClip } from './heard-check/next-warning-flow'
import { useRouteDays } from './route-days'
import { ymOf, type DaysEntry } from './calendar-model'

export interface DayViewProps {
  state: RouteState
  model: DayModel
  label?: string
  exchange: ReturnType<typeof useRouteExchange>
  // Сброс маршрута из настроек (B10d) — делает страница: DELETE, перечитать, канал.
  onReset?: () => void
  resetBusy?: boolean
  // Занятость снаружи (страница идёт по ?next=: тест после ролика и выгрузка очереди).
  externalBusy?: boolean
  resetNote?: ReactNode
  // Дополнительные видео (спека extra-video §9): машина кнопки живёт на странице.
  extra?: ExtraVideoView
  demo?: boolean
}

// learningStartDay — учебный день `started_at` (начало календаря, §4.12 N-M3).
export function learningStartDay(startedAt: string | null): string | null {
  if (!startedAt) return null
  const t = Date.parse(startedAt)
  return Number.isFinite(t) ? learningDayOf(new Date(t), savedDayTransition()) : null
}

// dayLabel — «18 ноября» из YYYY-MM-DD (дата плана, без сдвига поясом).
export function dayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' })
}

export function DayView({ state, model, label, exchange: ex, onReset, resetBusy = false, resetNote = null, externalBusy = false, extra, demo = false }: DayViewProps) {
  const [panel, setPanel] = useState<OpenPanel | null>(null)
  const [openWords, setOpenWords] = useState<number | null>(null)
  const [, setTick] = useState(0)
  const [fresh, setFresh] = useState(false)
  const bump = useCallback(() => setTick(t => t + 1), [])
  // localBusy — замена нажата, обмен ещё не начат (ждёт постановки clip_rated под
  // блокировкой очереди): оценка и замена уже неактивны (ревью 3а, L7).
  const [localBusy, setLocalBusy] = useState(false)
  // rating — оценки в полёте (постановка ждёт блокировку): второй клик не шлёт (L4).
  const rating = useRef(new Set<string>())
  const running = ex.view.running
  const busy = !!running || localBusy || externalBusy
  const routeId = state.route_id ?? ''
  const day = state.day!.date
  const today = learningDayOf(new Date(), savedDayTransition())
  const isToday = day === today
  const newDay = !!state.snapshot_date && state.snapshot_date < today
  // Календарь (B10c): выбранный прошлый день (null — сегодня) и прочитанные месяцы.
  const [sel, setSel] = useState<string | null>(null)
  const days = useRouteDays(`${routeId}:${state.revision}`)
  // Выбранный прошлый день переживает смену ревизии (ревью 3b, L8): пока месяц
  // перечитывается, показывается его последняя прочитанная строка; выбор снимается,
  // только когда перечитанный месяц этого дня больше не несёт.
  const lastPast = useRef<DaysEntry | null>(null)
  const selMonth = sel ? days.months.get(ymOf(sel)) : undefined
  const pastEntry = !sel ? null
    : selMonth ? selMonth.find(d => d.date === sel) ?? null
    : lastPast.current && lastPast.current.date === sel ? lastPast.current : null
  lastPast.current = pastEntry
  useEffect(() => { if (sel && selMonth && !selMonth.some(d => d.date === sel)) setSel(null) }, [sel, selMonth])
  // Месяц выбранного дня — своё «место» загрузчика (ревью 3b, R1-L4): после смены
  // ревизии он перечитывается, даже если календарь листан на другой месяц.
  const wantDays = days.want
  useEffect(() => { wantDays(sel ? ymOf(sel) : null, 'sel') }, [sel, wantDays, state.revision, routeId])
  const calendar = (
    <Calendar today={today} startDay={learningStartDay(state.started_at)} dayDate={day} todayMinutes={model.watchedMinutes}
      months={days.months} want={days.want} failure={days.failure} sel={pastEntry ? sel : null} onSelect={d => { setSel(d); setOpenWords(null) }} />
  )

  // Вспышка 0,6 с у героя по коммиту замены (§4.12).
  useEffect(() => {
    if (ex.view.flashKey === 0) return
    setFresh(true)
    const t = setTimeout(() => setFresh(false), 600)
    return () => clearTimeout(t)
  }, [ex.view.flashKey])

  // Открытая строка, чья строка дня потеряла право (перечитанное состояние: ролик
  // ушёл в kept / kept_local, Г7 откатили, герой сменился) — закрывается (C1).
  useEffect(() => {
    if (!panel) return
    const r = panel.where === 'hero' ? model.current : model.rows.find(x => x.puzzleId === panel.puzzleId)
    const can = !!r && canReplaceRow(r, state.replace_available)
    if (!r || r.puzzleId !== panel.puzzleId || can !== panel.canReplace) setPanel(null)
  })

  const doReplace = useCallback(async (row: DayRow, reason: ClipDislikeReason | undefined, where: 'hero' | 'row') => {
    const pid = row.puzzleId!
    await ex.run('replace', state, { want: 'replace', replacePuzzleId: pid, ...(reason ? { replaceReason: reason } : {}) }, {
      anchor: where === 'hero' ? 'hero' : pid,
    })
  }, [ex, state])

  const a: DayActions = {
    busy,
    replaceAvailable: state.replace_available,
    panel,
    notice: ex.view.notice && ex.view.notice.anchor ? { text: ex.view.notice.text, anchor: ex.view.notice.anchor } : null,
    ratingOf: pid => ratingOf(routeId, pid),
    lessonHeard: pid => lessonHeardCount(routeId, day, pid),
    like: row => {
      const pid = row.puzzleId
      if (busy || !pid || rating.current.has(pid)) return
      rating.current.add(pid)
      void rateClip({ routeId, puzzleId: pid, rating: 'like', subsSource: '', snapshotDate: state.snapshot_date, outbox: getRouteOutbox() })
        .finally(() => { rating.current.delete(pid); bump() })
    },
    dislike: (row, where) => { if (!busy && row.puzzleId) { ex.clearNotice(); setPanel({ kind: 'dislike', puzzleId: row.puzzleId, where, canReplace: canReplaceRow(row, state.replace_available) }) } },
    replace: (row, where) => { if (!busy && row.puzzleId && canReplaceRow(row, state.replace_available)) { ex.clearNotice(); setPanel({ kind: 'replace', puzzleId: row.puzzleId, where, canReplace: true }) } },
    submitDislike: (row, reason, replace) => {
      const pid = row.puzzleId
      if (busy || !pid || rating.current.has(pid)) return
      const where = panel?.where ?? 'row'
      const doIt = replace && canReplaceRow(row, state.replace_available)
      setPanel(null)
      rating.current.add(pid)
      if (doIt) setLocalBusy(true)
      void (async () => {
        try {
          await rateClip({ routeId, puzzleId: pid, rating: 'dislike', reason, subsSource: '', snapshotDate: state.snapshot_date, outbox: getRouteOutbox() })
          bump()
          if (doIt) await doReplace(row, reason, where)
        } finally {
          rating.current.delete(pid)
          setLocalBusy(false)
        }
      })()
    },
    confirmReplace: row => {
      // Право замены — по ТЕКУЩЕМУ состоянию (C1): строка, ставшая kept / kept_local, не заменяется.
      if (busy || !row.puzzleId || !canReplaceRow(row, state.replace_available)) { setPanel(null); return }
      const where = panel?.where ?? 'row'
      setPanel(null)
      setLocalBusy(true)
      void doReplace(row, undefined, where).finally(() => setLocalBusy(false))
    },
    closePanel: () => setPanel(null),
    // «Следующий ролик»: тест после ролика (если есть) — ДО запроса; закрыли без
    // ответа — запроса нет. Дальше обмен выгружает очередь сам (фаза flushing).
    next: () => {
      if (busy) return
      // Непрослушанный активный ролик: сначала предупреждение; «Всё равно перейти» —
      // без теста после ролика и без событий.
      void (async () => {
        const dec = await confirmNextClip(state.current_puzzle_id)
        if (dec === 'stay') return
        if (dec === 'listened') {
          // Занято на время теста и выгрузки очереди (до 5 с) — кнопка не «мёртвая».
          setLocalBusy(true)
          let r: Awaited<ReturnType<typeof runHeardCheck>>
          try { r = await runHeardCheck(state) } finally { setLocalBusy(false) }
          if (r === 'abandoned') return
        }
        void ex.run('next_clip', state, { want: 'next' })
      })()
    },
  }

  const topNotice = ex.view.notice && !ex.view.notice.anchor ? ex.view.notice : null
  const waitingReplace = running?.kind === 'replace'

  if (pastEntry) {
    return (
      <>
        <PastDayHead entry={pastEntry} label={label} onBack={() => setSel(null)} />
        <div className="route">
          <div>
            <PastDay entry={pastEntry} openWords={openWords} toggleWords={i => setOpenWords(o => (o === i ? null : i))} />
          </div>
          {calendar}
        </div>
      </>
    )
  }

  return (
    <>
      <div className="ph">
        <span className="mono">{label ? `Маршрут · ${label}` : 'Маршрут'}</span>
        <h1>{isToday ? <>Сегодня, <em>{dayLabel(day)}</em></> : <em>{dayLabel(day)}</em>}</h1>
        <div className="route-meta" data-testid="route-meta">
          <span><b>{model.watchedCount} из {model.total}</b> просмотрено</span>
          <span>{model.minutes} мин</span>
          <span>+{model.words} {plural(model.words, 'слово', 'слова', 'слов')}</span>
        </div>
      </div>
      <div className="route">
        <div>
          {resetNote}
          {newDay && (
            <div className="demo-bar">
              <p>Наступил новый учебный день.</p>
              <button type="button" className="btn primary sm" disabled={busy} onClick={() => void ex.run('new_day', state, { want: 'next' })}>Получить ролики на сегодня</button>
            </div>
          )}
          {ex.view.replanned && <div className="msg ok" role="status" style={{ marginBottom: 16 }}><span>День подобран заново — просмотренные ролики остались в списке</span></div>}
          {topNotice && (
            <div className={'msg ' + (topNotice.support ? 'err' : 'warn')} role="status" style={{ marginBottom: 16 }}>
              <span>
                <span>{topNotice.text}</span>
                {topNotice.support && <>. <span>Поддержка: <SupportLink /></span></>}
                {topNotice.action && (
                  <> <button type="button" className="btn sm" style={{ marginLeft: 8 }} onClick={() => void (topNotice.action === 'restart' ? ex.run('start_day', state, { want: 'next' }) : ex.repeat(state))}>
                    {topNotice.action === 'restart' ? 'Подобрать заново' : 'Повторить'}
                  </button></>
                )}
              </span>
            </div>
          )}
          {model.current === null ? (
            <StartDayHero busy={busy} onStart={() => void ex.run('start_day', state, { want: 'next' })} />
          ) : model.dayDone ? (
            <div className="done-card" data-testid="day-done">
              {model.allWatched
                ? <span className="mono" style={{ color: 'var(--ok)' }}>Все ролики дня просмотрены</span>
                : <span className="mono">{model.watchedCount} из {model.total} просмотрено</span>}
              <h2>На сегодня всё — <em>до завтра</em></h2>
              <p className="mute">Завтра маршрут подберёт новые ролики по тому, как Вы смотрели сегодня.</p>
            </div>
          ) : (
            <DayHero model={model} a={a} waiting={waitingReplace} phase={ex.view.phase} fresh={fresh} flashKey={ex.view.flashKey} />
          )}
          <DayClipList model={model} a={a} openWords={openWords} toggleWords={i => setOpenWords(o => (o === i ? null : i))} />
          {extra && <ExtraVideos rows={state.extras ?? []} view={{ ...extra, disabled: extra.disabled || busy }} demo={demo} />}
          {onReset && <RouteSettingsPanel params={state.params} resetBusy={resetBusy || busy} onReset={onReset} />}
        </div>
        {calendar}
      </div>
    </>
  )
}

