// WordsLessonPage.tsx — урок слов на сайте `/app/route/words?rw=<puzzle_id>`
// (спека 2026-11-17 §4.13 целиком, §7 случаи 30, 45–53; Д2 — «Урок слов на
// сайте»; план B10f).
//
// Открывается ТОЛЬКО нажатием (кнопка строки урока, героя или Главной): сама
// после обмена или замены не открывается (W-M2, Р27) — открытие тратит квоту
// примеров ключа. Гейт `rw`: префикс `words::` и в свежем общем состоянии вкладки
// `rw` — выданная строка `kind:"words"` ТЕКУЩЕГО плана (любая, не только текущая);
// иначе «Этот урок больше недоступен — день изменился.», событий нет.
//
// Примеры — ExampleQueue (words-lesson.ts) через `GET /api/me/route/examples`
// ключом сессии. Зачёт — clip_played урока БЕЗ subs_*/lemmas (тот же модуль, что
// у плеера), в очередь — только если доля выросла против `share` записи
// `flib:route-watched` строки и против `sent` записи урока `flib:route-lesson`
// (L8; `sent` гасит только доли ниже порога зачёта 0.6 — N1): (а) сразу при доле 1, с немедленной отправкой; (б) при уходе
// (размонтирование, pagehide) и перед выгрузкой «Выхода» (L5), если доля > 0;
// (в) перед обменом «Следующий ролик →». Запись `flib:route-watched` — той же функцией, что у
// плеера, под блокировкой очереди (enqueueClipPlayed).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useSession } from '../../useSession'
import { refreshSession } from '../../session'
import { cabinetRouteMarked } from './route-storage'
import { useRouteState, type StateRead } from './use-route-state'
import { routeApi, type DayClipDelivered, type RouteState } from './route-api'
import { getRouteOutbox, newEventId } from './outbox'
import { FLUSH_BEFORE_EXCHANGE_MS } from './exchange-machine'
import { forDate } from './learning-day'
import { lessonTitle } from './day-actions'
import { WATCHED_SHARE } from './day-model'
import { GatewayRefused, KeyExpired, NoRouteRight, TemporaryDown } from './RouteMessages'
import {
  ExampleQueue, addLessonHeard, lessonFraction, nextUnheard, noteLessonSent, readExampleCache, readLessonHeard, readLessonSent,
  round3, writeExampleCache,
} from './words-lesson'
import { WordCard } from './WordCard'
import { LessonExamplePlayer } from './LessonExamplePlayer'
import { wordsLessonClipPlayed } from '../../../player/route-events/clip-played'
import { envelope } from '../../../player/route-events/mapper'
import { enqueueClipPlayed, watchedFor } from '../../../player/route-events/route-watched'
import { confirmNextClip, SKIP_HC_PARAM } from './heard-check/next-warning-flow'
import './route.css'

export const LESSON_GONE_TEXT = 'Этот урок больше недоступен — день изменился.'
export const LESSON_EMPTY_TEXT = 'В уроке нет слов'
export const LESSON_FORBIDDEN_TEXT = 'Примеры для этого ключа недоступны — урок засчитается по списку слов.'

// CabinetLessonGate — без метки flib-route путь урока ведёт себя как до этапа 2:
// общий `*` кабинета перенаправлял его на `/app` (финальное ревью PR-B, L1 —
// паритет выключенного флага), а не «Маршрут — скоро».
export function CabinetLessonGate() {
  return cabinetRouteMarked() ? <WordsLessonPage /> : <Navigate to="/app" replace />
}

// lessonRowOf — гейт `rw`: выданная строка урока ТЕКУЩЕГО плана (не kept).
export function lessonRowOf(st: RouteState, rw: string): DayClipDelivered | null {
  if (!rw.startsWith('words::') || !st.started || !st.day) return null
  const r = st.day.clips.find(c => c.delivered === true && !('kept' in c && (c as { kept?: boolean }).kept) && c.puzzle_id === rw)
  if (!r || r.delivered !== true || !('queued_played' in r)) return null
  return r.kind === 'words' || r.puzzle_id.startsWith('words::') ? r as DayClipDelivered : null
}

function Head({ title }: { title: string }) {
  return <div className="ph"><span className="mono">Маршрут</span><h1>{title}</h1></div>
}

function BackLink({ primary }: { primary?: boolean }) {
  return <Link className={'btn' + (primary ? ' primary' : '')} to="/app/route">← К маршруту</Link>
}

export function WordsLessonPage() {
  const s = useSession()
  const [params] = useSearchParams()
  const rw = params.get('rw') ?? ''
  if (s.state === 'expired') return <><Head title="Урок слов" /><KeyExpired demo={s.demo} /></>
  if (s.state === 'active' && !s.routeAllowed) return <><Head title="Урок слов" /><NoRouteRight /></>
  return <LessonGate rw={rw} demo={s.demo} />
}

// bodyKey — ключ открытия урока: эпоха, дата плана и строка.
const bodyKey = (st: RouteState, pid: string) => `${st.route_id}:${st.day?.date ?? ''}:${pid}`

function LessonGate({ rw, demo }: { rw: string; demo: boolean }) {
  // validKey — ключ урока, который ПОСЛЕДНЕЕ удачное чтение состояния считает
  // живой строкой текущего плана (null — строки нет: день пересобран, сброс,
  // новая дата плана). Ставится в момент ПРИХОДА ответа, до его отрисовки
  // (onArrive; ревью 3b, R1-N1: pagehide между приходом и отрисовкой), и ещё раз
  // при отрисовке. Тело, чей ключ уже не живой, при размонтировании и на pagehide
  // ничего не шлёт и не пишет (H1; §4.13 п.1 «событий нет»). Неудачное чтение ключ
  // не трогает: строка, может быть, жива — уход по-прежнему шлёт.
  const validKey = useRef<string | null>(null)
  // lastGood — последнее удачное состояние с живой строкой урока: временный сбой
  // чтения не сносит открытый урок (ревью 3b, L1).
  const lastGood = useRef<RouteState | null>(null)
  const note = useCallback((r: StateRead) => {
    if (!r.result.ok) return
    const row = lessonRowOf(r.result.data, rw)
    validKey.current = row ? bodyKey(r.result.data, row.puzzle_id) : null
    lastGood.current = row ? r.result.data : null
  }, [rw])
  const rs = useRouteState({ onArrive: note })
  const read = rs.read
  useEffect(() => {
    if (read && !read.result.ok && read.result.status === 401) void refreshSession().catch(() => undefined)
  }, [read])
  if (!read) return <><Head title="Урок слов" /><div className="done-card" data-testid="route-skeleton" aria-busy="true"><span className="hero-wait"><span className="spin" /></span></div></>
  let st: RouteState
  if (!read.result.ok) {
    const e = read.result
    if ((e.cls === 'temporary' || e.cls === 'rate') && lastGood.current) {
      st = lastGood.current
    } else {
      if (e.status === 403 && e.code === 'key_expired') return <><Head title="Урок слов" /><KeyExpired demo={demo} /></>
      if (e.status === 403) return <><Head title="Урок слов" /><NoRouteRight /></>
      if (e.cls === 'temporary' || e.cls === 'rate') return <><Head title="Урок слов" /><TemporaryDown until={rs.retryAt} /></>
      if (e.status === 401) return <><Head title="Урок слов" /><div className="done-card" aria-busy="true"><span className="hero-wait"><span className="spin" /></span></div></>
      return <><Head title="Урок слов" /><GatewayRefused /></>
    }
  } else {
    st = read.result.data
  }
  const row = lessonRowOf(st, rw)
  note(read)
  if (!row) {
    return (
      <>
        <Head title="Урок слов" />
        <div className="done-card" data-testid="lesson-gone"><p>{LESSON_GONE_TEXT}</p><BackLink /></div>
      </>
    )
  }
  const words = (Array.isArray(row.words) ? row.words : []).filter(w => typeof w === 'string' && w !== '')
  if (words.length === 0) {
    return (
      <>
        <Head title={lessonTitle(0)} />
        <div className="done-card" data-testid="lesson-empty"><p>{LESSON_EMPTY_TEXT}</p><BackLink /></div>
      </>
    )
  }
  const key = bodyKey(st, row.puzzle_id)
  return <LessonBody key={key} st={st} pid={row.puzzle_id} words={words} alive={() => validKey.current === key} />
}

// alive — строка этого открытия всё ещё живая по последнему удачному чтению
// (иначе уход не шлёт ничего, H1).
function LessonBody({ st, pid, words, alive }: { st: RouteState; pid: string; words: string[]; alive: () => boolean }) {
  const navigate = useNavigate()
  const routeId = st.route_id ?? ''
  const day = st.day!.date
  const [, setTick] = useState(0)
  const [heard, setHeard] = useState<Set<string>>(() => new Set(readLessonHeard(routeId, day, pid)))
  const [playing, setPlaying] = useState<{ word: string; n: number } | null>(null)
  const [queueMode, setQueueMode] = useState(false)
  const [leaving, setLeaving] = useState(false)
  // gen — поколение сессии, в котором открыт урок (ревью 3b, R1-L3).
  const gen = useRef(getRouteOutbox().generation())
  const sameSession = () => !getRouteOutbox().isClosed() && getRouteOutbox().generation() === gen.current
  const q = useMemo(() => new ExampleQueue(words, {
    fetchExamples: w => routeApi.examples(w),
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: h => clearTimeout(h as ReturnType<typeof setTimeout>),
    readCache: w => readExampleCache(w, Date.now()),
    // После «Выхода» кэш не пишется — ни пока очередь закрыта, ни после нового входа
    // (поколение сессии сменилось): поздний ответ не воскрешает стёртый
    // `flib:examples-cache` (§13 утв. 7; ревью 3b, R1-L3).
    writeCache: (w, a) => { if (sameSession()) writeExampleCache(w, a, Date.now()) },
    onAuth: () => { void refreshSession().catch(() => undefined) },
  // Очередь — одна на открытие урока (слова и строка — ключ компонента).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [])
  useEffect(() => {
    const un = q.subscribe(() => setTick(t => t + 1))
    q.start()
    return () => { un(); q.dispose() }
  }, [q])

  const { k, m, frac } = lessonFraction(words, q.states, heard)
  // Доля за открытие только растёт (максимум, как notePlayed приложения).
  const maxFrac = useRef(0)
  maxFrac.current = Math.max(maxFrac.current, round3(frac))
  const sent = useRef(0)
  const sameSessionRef = useRef(sameSession)
  sameSessionRef.current = sameSession

  // send — постановка clip_played урока, только если доля выросла против
  // записанной в `flib:route-watched`, против уже поставленной в это открытие и
  // против поставленной в эту дату плана раньше (`sent` записи урока: отметку
  // незасчитанного урока снимает сторож, а повтор той же доли не нужен — L8).
  const ctx = useRef({ routeId, day, pid, words, snapshotDate: st.snapshot_date })
  ctx.current = { routeId, day, pid, words, snapshotDate: st.snapshot_date }
  const send = useCallback((f: number, flushNow: boolean): boolean => {
    const c = ctx.current
    const share = round3(f)
    const recorded = watchedFor(c.routeId, c.day)[c.pid]?.share ?? 0
    // `sent` гасит только доли НИЖЕ порога зачёта (ревью PR-C, N1): `sent` — что
    // страница поставила, а не что демон применил. Доля ≥ 0.6, чью отметку снял
    // сторож, демон обработал и не засчитал (день пересобран до применения) —
    // её надо послать снова, иначе урок до смены даты плана не засчитать.
    const before = share < WATCHED_SHARE ? readLessonSent(c.routeId, c.day, c.pid) : 0
    if (!(share > 0) || share <= Math.max(recorded, before, sent.current) || !sameSessionRef.current()) return false
    sent.current = share
    const at = new Date()
    const event = wordsLessonClipPlayed(c.pid, share, envelope(forDate(c.snapshotDate, at), at, newEventId()))
    void enqueueClipPlayed(getRouteOutbox(), {
      routeId: c.routeId, day: c.day, event, share, meta: { words: c.words },
      afterMark: () => noteLessonSent(c.routeId, c.day, c.pid, share),
    })
    if (flushNow) void getRouteOutbox().flush({ timeoutMs: FLUSH_BEFORE_EXCHANGE_MS })
    return true
  }, [])

  const aliveRef = useRef(alive)
  aliveRef.current = alive
  const done = frac >= 1
  useEffect(() => { if (done && aliveRef.current()) send(1, true) }, [done, send])

  // «Выход» в этой вкладке: доля ставится до выгрузки перед выходом, как при уходе
  // со страницы (финальное ревью PR-B, L5) — после выхода размонтирование уже
  // ничего не шлёт.
  useEffect(() => getRouteOutbox().onBeforeLogout(() => { if (aliveRef.current()) send(maxFrac.current, false) }), [send])

  // Уход: размонтирование («← К маршруту», переход) и pagehide.
  useEffect(() => {
    const onHide = () => { if (aliveRef.current() && send(maxFrac.current, false)) getRouteOutbox().onPagehide() }
    window.addEventListener('pagehide', onHide)
    return () => { window.removeEventListener('pagehide', onHide); if (aliveRef.current()) send(maxFrac.current, false) }
  }, [send])

  const markHeard = (w: string): Set<string> => {
    addLessonHeard(routeId, day, pid, w)
    const next = new Set(heard)
    next.add(w)
    setHeard(next)
    return next
  }
  const onEnd = (w: string) => {
    const h = markHeard(w)
    const nxt = queueMode ? nextUnheard(words, q.states, h, w) : null
    setPlaying(nxt ? { word: nxt, n: Date.now() } : null)
    if (!nxt) setQueueMode(false)
  }
  const onFail = (w: string) => {
    q.unembeddable(w)
    if (q.states.get(w)?.k === 'example') { setPlaying({ word: w, n: Date.now() }); return }
    const nxt = queueMode ? nextUnheard(words, q.states, heard, w) : null
    setPlaying(nxt ? { word: nxt, n: Date.now() } : null)
    if (!nxt) setQueueMode(false)
  }
  const playAll = () => {
    const first = nextUnheard(words, q.states, heard)
    if (!first) return
    setQueueMode(true)
    setPlaying({ word: first, n: Date.now() })
  }

  const isCurrent = st.current_puzzle_id === pid
  const hasUndelivered = (st.day?.clips ?? []).some(c => c.delivered === false)
  const nextClip = async () => {
    if (leaving) return
    setLeaving(true)
    // Непрослушанный активный ролик — предупреждение; «Всё равно» — страница маршрута без теста.
    const dec = await confirmNextClip(isCurrent ? pid : null)
    if (dec === 'stay') { setLeaving(false); return }
    send(maxFrac.current, false)
    try { await getRouteOutbox().flush({ timeoutMs: FLUSH_BEFORE_EXCHANGE_MS }) } catch { /* обмен идёт и без выгрузки */ }
    navigate(`/app/route?next=${encodeURIComponent(pid)}${dec === 'skip_check' ? `&${SKIP_HC_PARAM}=1` : ''}`)
  }

  return (
    <>
      <div className="ph">
        <span className="mono">Маршрут</span>
        <h1>{lessonTitle(words.length)}</h1>
        <p className="mute" style={{ marginTop: 8 }}>Посмотрите пример к каждому слову — после этого маршрут засчитает урок.</p>
        <div className="route-meta" data-testid="lesson-meta"><span>Просмотрено <b>{k} из {m}</b> примеров</span></div>
      </div>
      {q.forbidden && <div className="msg warn" role="status" style={{ marginBottom: 16 }}><span>{LESSON_FORBIDDEN_TEXT}</span></div>}
      {done && (
        <div className="msg ok" role="status" data-testid="lesson-done" style={{ marginBottom: 16 }}>
          <span>Урок пройден</span>
          {isCurrent && hasUndelivered
            ? <button type="button" className="btn primary sm" style={{ marginLeft: 12 }} disabled={leaving} onClick={() => void nextClip()}>Следующий ролик →</button>
            : <Link className="btn sm" style={{ marginLeft: 12 }} to="/app/route">← К маршруту</Link>}
        </div>
      )}
      <div className="hero-actions" style={{ marginBottom: 20 }}>
        <button type="button" className="btn" disabled={!nextUnheard(words, q.states, heard)} onClick={playAll}>Смотреть все подряд</button>
        <BackLink />
      </div>
      <div className="lesson-list">
        {words.map(w => {
          const s = q.states.get(w) ?? { k: 'searching' as const }
          const item = s.k === 'example' ? s.items[s.idx] : null
          const on = playing?.word === w && !!item
          return (
            <WordCard key={w} word={w} state={s} heard={heard.has(w)} playing={on}
              player={on && item ? <LessonExamplePlayer key={`${item.video_id}:${s.k === 'example' ? s.idx : 0}:${playing!.n}`} item={item} onEnd={() => onEnd(w)} onFail={() => onFail(w)} /> : null}
              onPlay={() => { setQueueMode(false); setPlaying({ word: w, n: Date.now() }) }}
              onRetry={() => q.retry(w)} />
          )
        })}
      </div>
    </>
  )
}
