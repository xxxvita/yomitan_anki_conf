// useRouteEvents.ts — события плеера → очередь маршрута (спека 2026-11-17 §4.8,
// план B8c). Порт логики `route-clip-events.ts` / `route-word-events.ts` /
// `use-subtitle-listening.ts` приложения.
//
// Гейт (§4.8): только в маршрутном режиме (`rp` подтверждён) или в режиме дополнительного видео
// (`rx` подтверждён, extra-video §9: события несут origin:"more"). Пока проверка
// режима не ответила (`pending`), события копятся в памяти и отбрасываются, если
// режим не подтвердился. При подтверждённом `rc` рождается ТОЛЬКО `clip_rated`.
//
// Событие относится к ролику, на котором набрано:
//   • сессия событий — на открытие ролика (смена ролика закрывает прежнюю: её
//     clip_played уходит, память пословных событий и доля обнуляются);
//   • доля копится только пока носитель «свой» (CarrierGate, порт `useOwnCarrier`):
//     пара (время, длительность) на первых рендерах после смены ролика ещё
//     прежнего носителя («145,101 → 0»);
//   • перемотка назад сравнивает время ТОГО ЖЕ открытия.
//
// clip_played — раз на открытие: на конце ролика (`конецРолика`, окно 0,75 с —
// счётчику засчитывается наблюдение на длительности), при уходе (размонтирование,
// pagehide) и смене ролика; доля — максимум достигнутой. Постановка — в
// `flib:route-outbox`, затем ПОД ТОЙ ЖЕ блокировкой запись `flib:route-watched`.
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { getRouteOutbox, type RouteOutbox } from '../../site/cabinet/route/outbox'
import { forDate } from '../../site/cabinet/route/learning-day'
import type { DayClipDelivered, DayClipKept } from '../../site/cabinet/route/route-api'
import type { Cue } from '../hooks/useSubtitles'
import type { SubtitlesStatus } from '../hooks/useSubtitles'
import {
  завестиСчётчик, ключСнимка, перенестиНаСнимок, сбросить, шаг, type Реплика, type Счётчик,
} from './subtitle-counter'
import { buildClipPlayed, clipShare, type ProgressInfo } from './clip-played'
import {
  clipRatedEvent, clipReplayedEvent, clipboardCopyEvent, envelope, hintRequestedEvent, lineTranslatedEvent,
  newEventId, subsSourceOf, subtitlesShownEvent, type Envelope, type SiteEvent,
} from './mapper'
import { WordEventMemory } from './word-events'
import { wordsOf } from './lemmas'
import { isExtraListened, markClipListened, markExtraListened, shouldMarkListened } from './clip-listened'
import { asExtraEvent } from './extra-origin'
import { enqueueClipPlayed, type WatchedMeta } from './route-watched'
import type { RouteModeView } from './route-mode'
import { noteHeardFrac, retainHeardFrac } from '../../site/cabinet/route/heard-check/heard-check-memory'

/** Окно конца ролика (порт `ОКНО_КОНЦА_РОЛИКА`). */
export const END_WINDOW_SEC = 0.75
export const REPLAY_BACK_SEC = 1.5
const MAX_HELD_OBSERVATIONS = 400
// Отчёт дополнительного видео строится как первое открытие (спека extra-video §9): прогресс ролика
// для него на шлюзе не читается и не пишется, поэтому счёт всегда с нуля, а не из восстановления.
const EXTRA_PROGRESS: ProgressInfo = { kind: 'not_found', heardMax: 0 }

export function конецРолика(время: number, длительность: number): boolean {
  if (!(длительность > 0) || !Number.isFinite(длительность)) return false
  return время > 0 && длительность - время < END_WINDOW_SEC
}

// CarrierGate — «носитель свой» (порт `useOwnCarrier`): после смены ролика пара
// (время, длительность) считается чужой, пока не сменится длительность, время не
// уйдёт назад или не станет ≤ 1 с.
export class CarrierGate {
  private s: { first: boolean; pid: string | null; own: boolean; t: number; d: number } = { first: true, pid: null, own: false, t: 0, d: 0 }
  own(pid: string, t: number, d: number): boolean {
    const s = this.s
    if (s.first) { this.s = { first: false, pid, own: true, t, d }; return true }
    if (s.pid !== pid) { this.s = { first: false, pid, own: false, t, d }; return false }
    if (s.own) return true
    if (d !== s.d || t < s.t || t <= 1) { s.own = true; return true }
    return false
  }
}

export interface RouteEventsDeps {
  outbox: Pick<RouteOutbox, 'enqueue' | 'enqueueDurable' | 'onPagehide'>
  storage: Storage | null
  now: () => Date
}

export interface RouteEventsArgs {
  videoId: string
  routeMode: RouteModeView
  cues: Cue[]
  subsStatus: SubtitlesStatus
  subsSource: string | null
  currentTime: number
  duration: number
  rate: number
  seeking: () => boolean
  // progress — что сказал GET прогресса (B8d); progressSettled — GET ответил или
  // не удался: до этого наблюдения счётчика копятся (счёт восстанавливается из
  // `state` ДО первого шага, норма 6).
  progress?: ProgressInfo | null
  progressSettled?: boolean
  restoreHeard?: number[] | null
  deps?: RouteEventsDeps
}

export interface RouteEventsApi {
  onWordsRevealed: (cueIndex: number, words: string[]) => void
  onWordClick: (word: string) => void
  onLineTranslated: (cueIndex: number) => void
  onSeek: (from: number, to: number) => void
  rate: (rating: 'like' | 'dislike', reason?: string) => boolean
  // dropReport — отчёт этого открытия не отправлять (замена этого ролика из
  // плеера, §4.6 «Шаги замены» п.2: долю отвергнутого ролика приложение не шлёт).
  dropReport: () => void
  // counter — счётчик текущего открытия (читатель — PUT progress, B8d).
  counter: () => Счётчик | null
  subsSource: string
}

interface Held { build: (env: Envelope) => SiteEvent | null; at: Date; frac?: number; clipPlayed?: boolean; meta?: WatchedMeta }

interface Session {
  pid: string
  // extra — сессия создана для дополнительного видео: её отчёт всегда строится как первое
  // открытие (прогресса на шлюзе нет), независимо от режима, который к закрытию уже сменился.
  extra: boolean
  counter: Счётчик | null
  trackKey: string | null
  maxFrac: number
  sent: boolean
  words: WordEventMemory
  held: Held[]
  observations: Array<{ t: number; seeking: boolean; rate: number }>
  // restored — восстановление из прогресса сделано (или нечего восстанавливать);
  // restoreApplied — счёт действительно восстановлен из `state` до первого шага:
  // только тогда ответ прогресса 200 даёт `full` (таблица subs_report §4.8).
  restored: boolean
  restoreApplied: boolean
  // carrierOwn — хоть одно наблюдение времени этого открытия было «своим»: до
  // этого перемотка не считается (прежнее время принадлежит прежнему ролику).
  carrierOwn: boolean
  // conf — состояние, подтвердившее маршрутный режим ЭТОГО ролика (эпоха, дата
  // плана, строка дня). Отчёт и события сессии ставятся с ним, а не с текущим
  // режимом: при смене ролика на месте (confirmed A → pending B → confirmed B)
  // отчёт A уходит с эпохой и строкой A (ревью M2). Нет conf — режим не
  // подтвердился, события сессии выбрасываются.
  conf: SessionConf | null
  // overflow — наблюдения, ждавшие дорожку или прогресс, не поместились (L7):
  // счёт неполон, отчёт не может быть full.
  overflow: boolean
}

// extra — сессия дополнительного видео: `commit` оставляет только роды с `origin:"more"`.
// silent — «тихая» сессия: дополнительное видео открыто уже ПОЛНОСТЬЮ прослушанным (отметка маршрута и ролика
// стояла в момент подтверждения режима И строка extras уже played, extra-video §9): `commit` не шлёт ничего. Отметка, появившаяся
// в самой сессии (первый проход кончается сейчас), тихой её не делает.
interface SessionConf { routeId: string; snapshotDate: string | null; day: string; row: DayClipDelivered | null; extra: boolean; extraPlayed?: boolean; silent?: boolean }

function repliki(cues: Cue[]): Реплика[] {
  return cues.map(c => ({ start: c.start, end: c.end, text: c.text_en }))
}

function browserDeps(): RouteEventsDeps {
  let storage: Storage | null = null
  try { storage = window.localStorage } catch { storage = null }
  return { outbox: getRouteOutbox(), storage, now: () => new Date() }
}

const NO_OP: RouteEventsApi = {
  onWordsRevealed: () => {}, onWordClick: () => {}, onLineTranslated: () => {}, onSeek: () => {},
  rate: () => false, dropReport: () => {}, counter: () => null, subsSource: 'server',
}

export function useRouteEvents(a: RouteEventsArgs): RouteEventsApi {
  const depsRef = useRef<RouteEventsDeps | null>(a.deps ?? null)
  const deps = (): RouteEventsDeps => (depsRef.current ??= browserDeps())
  const mode = a.routeMode
  const eventsPid = mode.kind === 'pending' || mode.kind === 'confirmed' || mode.kind === 'extra' ? mode.puzzleId : ''
  // eventsExtra — сессия дополнительного видео (в т.ч. пока режим ещё pending). Смена флага у того же
  // ролика (rx ↔ rp на месте) закрывает сессию: дневное и дополнительное открытия не смешиваются.
  const eventsExtra = mode.kind === 'extra' || (mode.kind === 'pending' && !!mode.extra)
  const ratePid = mode.kind === 'confirmed' || mode.kind === 'rc' || mode.kind === 'pending' ? mode.puzzleId : ''
  const modeRef = useRef(mode); modeRef.current = mode
  const argsRef = useRef(a); argsRef.current = a
  const sess = useRef<Session | null>(null)
  // Ролик, для которого доли прочих уже отброшены: retainHeardFrac — на смене, не на каждом шаге.
  const retainedPid = useRef<string | null>(null)
  const carrier = useRef(new CarrierGate())
  const subsSource = subsSourceOf(a.subsSource)

  const trackResolved = (x: RouteEventsArgs): boolean =>
    (x.subsStatus === 'ok' && x.cues.length > 0) || x.subsStatus === 'no_subtitles'

  // envelopeFor — конверт по состоянию, подтвердившему режим: learning_day =
  // учебный день момента создания, прижатый к snapshot_date (как for_date).
  const envelopeFor = (at: Date, snapshotDate: string | null): Envelope =>
    envelope(forDate(snapshotDate, at), at, newEventId())

  const metaOf = (r: DayClipDelivered | DayClipKept | null): WatchedMeta => {
    if (!r) return {}
    const meta: WatchedMeta = {}
    if (r.video_id) meta.video_id = r.video_id
    if (r.title) meta.title = r.title
    if (r.series_title) meta.series_title = r.series_title
    if (r.source) meta.source = r.source
    if (typeof r.duration_sec === 'number') meta.duration_sec = r.duration_sec
    if (Array.isArray(r.words)) meta.words = r.words
    return meta
  }

  // commit — событие сессии в очередь с состоянием, подтвердившим ЕЁ режим.
  const commit = (h: Held, c: SessionConf): void => {
    if (c.silent) return
    let ev = h.build(envelopeFor(h.at, c.snapshotDate))
    if (!ev) return
    const d = deps()
    // Единственное место, где событие дополнительного видео уходит в очередь (§9):
    // чужие роды отбрасываются, остальным ставится origin; запись «просмотрен»
    // (`flib:route-watched`) для него не делается — отчёт идёт прямо в очередь.
    if (c.extra) {
      ev = asExtraEvent(ev)
      if (!ev) return
      // Постановка долговечно — только у отчёта; прочие роды обычной очередью.
      if (h.clipPlayed) void d.outbox.enqueueDurable(c.routeId, ev, { frac: h.frac })
      else d.outbox.enqueue(c.routeId, ev)
      return
    }
    if (h.clipPlayed) {
      const share = clipShare(ev)
      const meta = metaOf(c.row)
      const day = c.day
      void enqueueClipPlayed(d.outbox, { routeId: c.routeId, day, event: ev, share, meta, frac: h.frac, storage: d.storage })
      return
    }
    d.outbox.enqueue(c.routeId, ev)
  }

  // emit — событие сессии: режим её ролика подтверждён — в очередь; ещё ждём
  // проверку — копится в памяти; иначе — выброшено.
  const emit = (s: Session, h: Held): void => {
    if (s.conf) { commit(h, s.conf); return }
    const m = modeRef.current
    if (m.kind === 'pending' && m.puzzleId === s.pid) s.held.push(h)
  }

  const confOf = (m: RouteModeView): SessionConf | null =>
    (m.kind === 'confirmed' || m.kind === 'extra') && m.state.route_id
      ? { routeId: m.state.route_id, snapshotDate: m.state.snapshot_date, day: m.state.day?.date ?? '', row: m.kind === 'confirmed' ? m.row : null, extra: m.kind === 'extra', extraPlayed: m.kind === 'extra' ? !!m.row.played : undefined }
      : null

  const clipPlayedHeld = (s: Session): Held | null => {
    if (s.sent || !(s.maxFrac > 0)) return null
    s.sent = true
    const x = argsRef.current
    // «200 той же дорожки» даёт full, только если счёт и правда восстановлен.
    const base: ProgressInfo | null = s.extra ? EXTRA_PROGRESS : x.progress ?? null
    let progress: ProgressInfo | null = base && base.kind === 'restored' && !s.restoreApplied
      ? { ...base, kind: 'other' } : base
    // L7: часть наблюдений потеряна — состав неполон.
    if (s.overflow && progress) progress = { ...progress, kind: 'other' }
    else if (s.overflow) progress = { kind: 'failed', heardMax: 0 }
    const input = {
      puzzleId: s.pid, counter: s.counter, trackResolved: trackResolved(x), frac: s.maxFrac,
      progress, subsSource: subsSourceOf(x.subsSource),
    }
    const built = (env: Envelope) => buildClipPlayed(input, env).event
    const frac = buildClipPlayed(input, { event_id: 'web:x', learning_day: '2000-01-01', client_ts: '' }).frac
    return { build: built, at: deps().now(), frac, clipPlayed: true }
  }

  const finish = (s: Session | null): void => {
    if (!s) return
    const h = clipPlayedHeld(s)
    if (h) emit(s, h)
  }

  // Сессия на открытие ролика: смена ролика (и уход в режим off) закрывает
  // прежнюю — её отчёт уходит с её подтверждённым состоянием (M2).
  useEffect(() => {
    if (sess.current?.pid === eventsPid && (!eventsPid || sess.current.extra === eventsExtra)) return
    finish(sess.current)
    sess.current = eventsPid
      ? { pid: eventsPid, extra: eventsExtra, counter: null, trackKey: null, maxFrac: 0, sent: false, words: new WordEventMemory(), held: [], observations: [], restored: false, restoreApplied: false, carrierOwn: false, conf: null, overflow: false }
      : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventsPid, eventsExtra])

  // Режим ролика подтверждён: состояние — в сессию, накопленное — в очередь.
  useEffect(() => {
    const s = sess.current
    const c = confOf(mode)
    if (!s || !c || (mode.kind !== 'confirmed' && mode.kind !== 'extra') || s.pid !== mode.puzzleId || s.extra !== (mode.kind === 'extra')) return
    // silent решается ОДИН раз — на первом подтверждении; позднейшие обновления состояния его не пересматривают.
    const keep = !!c.extra && !!s.conf?.extra && s.conf.routeId === c.routeId
    // Тихо — только если отметка стояла И шлюз принял отчёт (строка played): потерянный первый отчёт чинится пересмотром.
    s.conf = c.extra ? { ...c, silent: keep ? s.conf!.silent : isExtraListened(c.routeId, s.pid) && !!c.extraPlayed } : c
    const held = s.held; s.held = []
    for (const h of held) commit(h, s.conf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  // Дорожка субтитров → счётчик (та же дорожка — перенос, другая — сброс).
  useEffect(() => {
    const s = sess.current
    if (!s || a.cues.length === 0) return
    const r = repliki(a.cues)
    const key = ключСнимка(r)
    if (s.trackKey === key) return
    const snap = { puzzleID: s.pid, ключ: key, реплики: r }
    if (!s.counter) s.counter = завестиСчётчик(snap)
    else s.counter = перенестиНаСнимок(s.counter, snap) ?? сбросить(snap)
    s.trackKey = key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.cues, eventsPid, eventsExtra])

  // Восстановление счёта из прогресса — до первого шага (норма 6). Пока GET
  // прогресса не ответил или дорожки ещё нет, наблюдения копятся и потом
  // проигрываются по порядку.
  // Дополнительное видео прогресса не ждёт: счёт стартует сразу.
  const settled = eventsExtra || (a.progressSettled ?? true)
  useEffect(() => {
    const s = sess.current
    if (!s || s.restored || !settled || !s.counter) return
    s.restored = true
    // Счёт той же дорожки (restoreHeard не null, даже пустой) восстановлен до
    // первого шага — отчёт может быть full.
    if (a.restoreHeard) s.restoreApplied = true
    // M1: сохранённое состояние отстаёт от высшей отметки шлюза (последний PUT
    // старше отчёта прошлого открытия) — счёт восстановлен НЕ полностью, и это
    // открытие отчитывается partial: иначе реплики разрыва ушли бы «неуслышанными».
    // Считаются РАЗЛИЧНЫЕ индексы, попадающие в дорожку (R-L5): чужое или
    // испорченное состояние с повторами и индексами за концом не добирает до отметки.
    if (a.restoreHeard && a.progress && distinctInTrack(a.restoreHeard, s.counter.услышано.length) < a.progress.heardMax) {
      s.counter = { ...s.counter, полный: false }
    }
    if (a.restoreHeard && a.restoreHeard.length) {
      const услышано = s.counter.услышано.slice()
      const возвраты = s.counter.возвраты.slice()
      for (const i of a.restoreHeard) if (Number.isInteger(i) && i >= 0 && i < услышано.length) { услышано[i] = Math.max(1, услышано[i]); возвраты[i] = Math.max(1, возвраты[i]) }
      s.counter = { ...s.counter, услышано, возвраты }
    }
    for (const o of s.observations) step(s, o.t, o.seeking, o.rate)
    s.observations = []
    if (s.overflow && s.counter) s.counter = { ...s.counter, полный: false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled, a.restoreHeard, eventsPid, eventsExtra, a.cues])

  const step = (s: Session, t: number, seeking: boolean, rate: number): void => {
    if (!s.counter) return
    s.counter = шаг(s.counter, { время: t, сдвиг: 0, идётПеремотка: seeking, ставка: rate })
  }

  // Наблюдение времени: доля, счётчик, отметка «прослушан», конец ролика.
  useEffect(() => {
    const s = sess.current
    if (!s) return
    const t = a.currentTime, d = a.duration
    if (!carrier.current.own(s.pid, t, d)) return
    s.carrierOwn = true
    if (!(d > 0) || !Number.isFinite(d)) return
    const atEnd = конецРолика(t, d)
    const obsT = atEnd ? d : t
    const seeking = a.seeking()
    if (!s.restored) {
      if (s.observations.length < MAX_HELD_OBSERVATIONS) s.observations.push({ t: obsT, seeking, rate: a.rate })
      else s.overflow = true
    } else {
      step(s, obsT, seeking, a.rate)
    }
    const frac = atEnd ? 1 : Math.min(1, Math.max(0, t / d))
    if (frac > s.maxFrac) s.maxFrac = frac
    // Доля АКТИВНОГО ролика маршрута — в постоянную память: порог теста после
    // ролика (0.6) читает её, а не флаги отчёта (heard-check-memory.ts).
    if (mode.kind === 'confirmed' && s.pid === mode.puzzleId) {
      if (retainedPid.current !== s.pid) { retainedPid.current = s.pid; retainHeardFrac(s.pid) }
      noteHeardFrac(s.pid, s.maxFrac)
    }
    if (s.conf && shouldMarkListened({ counter: s.counter, trackResolved: trackResolved(a), cues: repliki(a.cues), atEnd })) {
      // Отметка своя у каждого режима: extra ставит `flib:route-extra-listened`, дневной — `flib:route-listened`.
      if (s.conf.extra) markExtraListened(s.conf.routeId, s.pid)
      else markClipListened(s.pid)
    }
    if (atEnd) finish(s)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.currentTime, a.duration])

  // Уход: размонтирование и pagehide.
  useEffect(() => {
    // pagehide: отчёт ставится в очередь (буфер очереди — сразу, C2), затем
    // очередь синхронно пишет буфер и отметку и шлёт keepalive. Обработчик очереди
    // мог сработать раньше этого — поэтому зовём его ещё раз (отправленное не повторится).
    const onHide = () => {
      const s = sess.current
      if (!s || !s.conf || s.conf.silent) return
      const h = clipPlayedHeld(s)
      if (!h) return
      commit(h, s.conf)
      deps().outbox.onPagehide()
    }
    window.addEventListener('pagehide', onHide)
    return () => {
      window.removeEventListener('pagehide', onHide)
      finish(sess.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Копирование выделенного в субтитрах (новый слушатель copy, §4.8).
  useEffect(() => {
    if (!eventsPid) return
    const onCopy = () => {
      const s = sess.current
      if (!s) return
      const sel = typeof window.getSelection === 'function' ? window.getSelection() : null
      const text = sel?.toString() ?? ''
      const node = sel?.anchorNode ?? null
      const el = node ? (node.nodeType === 1 ? node as Element : node.parentElement) : null
      const inL2 = !!el?.closest('[data-testid="subtitle-overlay"]')
      const inL1 = !!el?.closest('[data-testid="subtitle-l1-overlay"]')
      if (!inL2 && !inL1 || !text.trim()) return
      const x = argsRef.current
      const enLine = x.cues[activeIndexAt(x.cues, x.currentTime)]?.text_en ?? null
      const words = inL1 ? wordsOf(enLine ?? '') : wordsOf(text)
      const fresh = s.words.take('clipboard_copy', words)
      if (!fresh.length) return
      const pid = s.pid
      emit(s, { build: env => clipboardCopyEvent(pid, fresh.join(' '), { fromL1: false }, env), at: deps().now() })
    }
    document.addEventListener('copy', onCopy)
    return () => document.removeEventListener('copy', onCopy)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventsPid])

  const onWordsRevealed = useCallback((cueIndex: number, words: string[]) => {
    const s = sess.current
    if (!s) return
    const fresh = s.words.take('subtitles_shown', words.flatMap(w => wordsOf(w)), `c${cueIndex}`)
    if (!fresh.length) return
    const pid = s.pid
    emit(s, { build: env => subtitlesShownEvent(pid, cueIndex, fresh, env), at: deps().now() })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onWordClick = useCallback((word: string) => {
    const s = sess.current
    if (!s) return
    const w = wordsOf(word).slice(0, 1)
    const fresh = s.words.take('hint_requested', w)
    if (!fresh.length) return
    const pid = s.pid
    emit(s, { build: env => hintRequestedEvent(pid, fresh[0], env), at: deps().now() })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onLineTranslated = useCallback((cueIndex: number) => {
    const s = sess.current
    const cue = argsRef.current.cues[cueIndex]
    if (!s || !cue) return
    const words = wordsOf(cue.text_en)
    const fresh = s.words.take('line_translated', words, `c${cueIndex}`)
    if (!fresh.length) return
    const pid = s.pid
    emit(s, { build: env => lineTranslatedEvent(pid, fresh.join(' '), env), at: deps().now() })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onSeek = useCallback((from: number, to: number) => {
    const s = sess.current
    if (!s || !s.carrierOwn || !(from - to >= REPLAY_BACK_SEC)) return
    const x = argsRef.current
    const cue = x.cues[activeIndexAt(x.cues, to)]
    if (!cue) return
    const fresh = s.words.take('clip_replayed', wordsOf(cue.text_en))
    if (!fresh.length) return
    const pid = s.pid
    emit(s, { build: env => clipReplayedEvent(pid, fresh.join(' '), env), at: deps().now() })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const rate = useCallback((rating: 'like' | 'dislike', reason?: string): boolean => {
    const m = modeRef.current
    if (m.kind !== 'confirmed' && m.kind !== 'rc' && m.kind !== 'pending') return false
    if (m.kind === 'pending' && m.extra) return false
    const pid = m.puzzleId
    const src = subsSourceOf(argsRef.current.subsSource)
    const h: Held = { build: env => clipRatedEvent(pid, { rating, reason, subsSource: src }, env), at: deps().now() }
    if (!h.build(envelope('2000-01-01'))) return false
    if (m.kind === 'rc') {
      if (!m.state.route_id) return false
      commit(h, { routeId: m.state.route_id, snapshotDate: m.state.snapshot_date, day: m.state.day?.date ?? '', row: null, extra: false })
      return true
    }
    const s = sess.current
    if (!s || s.pid !== pid) return false
    emit(s, h)
    return true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const dropReport = useCallback(() => {
    const s = sess.current
    if (!s) return
    s.sent = true
    s.held = s.held.filter(h => !h.clipPlayed)
  }, [])

  const api = useMemo<RouteEventsApi>(() => ({
    onWordsRevealed, onWordClick, onLineTranslated, onSeek, rate, dropReport,
    counter: () => sess.current?.counter ?? null, subsSource,
  }), [onWordsRevealed, onWordClick, onLineTranslated, onSeek, rate, dropReport, subsSource])
  return eventsPid || ratePid ? api : NO_OP
}

// distinctInTrack — сколько различных индексов реплик дорожки из n строк.
export function distinctInTrack(heard: number[], n: number): number {
  return new Set(heard.filter(i => Number.isInteger(i) && i >= 0 && i < n)).size
}

function activeIndexAt(cues: Cue[], t: number): number {
  for (let i = 0; i < cues.length; i++) if (t >= cues[i].start && t < cues[i].end) return i
  return -1
}
