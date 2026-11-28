// player-route.tsx — плеер в маршруте кабинета (спека 2026-11-17 §4.6, §4.7,
// §4.12 элемент 11; план B9): оценка и замена в VideoVoteBar, «← К маршруту»,
// карточка конца ролика.
//
// Оценка: при `rp` (подтверждён) и подтверждённом `rc` — clip_rated с
// subs_source этого открытия (useRouteEvents.rate), затем запись
// `flib:route-ratings`; выбранная оценка повторно не шлётся (L14).
// «Не нравится» с галкой — замена ЭТОГО ролика (шаги replace-flow): отчёт этого
// открытия не отправляется (dropReport), несданные clip_played и запись
// `flib:route-watched` ролика удаляются, обмен `replace`; по коммиту — плеер
// нового текущего ролика (`rp`), а урок слов и `other` — `/app/route` (страница
// урока сама не открывается, W-M2). Отдельной кнопки «Заменить» в плеере нет.
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { RouteModeView } from './route-mode'
import type { RouteEventsApi } from './useRouteEvents'
import type { RouteVote } from '../components/VideoVoteBar'
import type { ClipDislikeReason } from './mapper'
import type { PlayerAdapter } from '../../adapter/PlayerAdapter'
import { ratingOf, saveRating } from '../../site/cabinet/route/route-ratings'
import { getRouteOutbox } from '../../site/cabinet/route/outbox'
import { browserExchangeDeps, type ExchangeOutcome } from '../../site/cabinet/route/exchange-machine'
import { broadcastRouteRevision, fetchFreshRouteState } from '../../site/cabinet/route/use-route-state'
import { forDate } from '../../site/cabinet/route/learning-day'
import { afterReplaceUrl, epochOf, markReplaced, replaceClip } from '../../site/cabinet/route/replace-flow'
import { REPLACE_UNAVAILABLE_TEXT, STATE_CHECK_FAILED_TEXT, UNAVAILABLE_TEXT } from '../../site/cabinet/route/use-route-exchange'

// REPLACE_STALE_PLAYER_TEXT — вариант плеера: списка дня здесь нет (R1-L3).
export const REPLACE_STALE_PLAYER_TEXT = 'День изменился, пока шла замена, — замена не выполнена'
import { useSession } from '../../site/useSession'
import type { DayClipDelivered, DayClipKept, RouteState } from '../../site/cabinet/route/route-api'

function statusOf(o: ExchangeOutcome): string | null {
  switch (o.type) {
    case 'committed': return o.foreign ? REPLACE_STALE_PLAYER_TEXT : null
    case 'reread': return o.code === 'stale_revision' ? REPLACE_STALE_PLAYER_TEXT : null
    case 'replace_unavailable': return REPLACE_UNAVAILABLE_TEXT
    case 'snapshot_required': return 'Замена станет доступна после первого ролика'
    case 'unavailable': case 'refused': return UNAVAILABLE_TEXT
    case 'no_clip': case 'retry_offer': return 'Не удалось подобрать ролик'
    case 'timeout': return 'Подбор занял слишком много времени'
    default: return null
  }
}

const isKeptRow = (r: DayClipDelivered | DayClipKept | null): boolean => !!r && 'kept' in r && (r as DayClipKept).kept === true

// replaceableIn — ролик можно заменить по ЭТОМУ состоянию (ревью 3а, C1): Г7, выданная
// строка текущего плана (не kept), не урок слов.
export function replaceableIn(state: RouteState, pid: string): boolean {
  if (!state.replace_available || pid.startsWith('words::')) return false
  const r = state.day?.clips.find(c => c.delivered === true && c.puzzle_id === pid) as DayClipDelivered | DayClipKept | undefined
  return !!r && !isKeptRow(r) && (r as DayClipDelivered).kind !== 'words'
}

export function usePlayerRouteVote(mode: RouteModeView, events: Pick<RouteEventsApi, 'rate' | 'dropReport'>, onNavigate: (url: string) => void): RouteVote | undefined {
  const [, setTick] = useState(0)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  // retryReason — причина замены, чья проверка свежим состоянием не удалась (R2-L6).
  const [retryReason, setRetryReason] = useState<ClipDislikeReason | null>(null)
  const active = mode.kind === 'confirmed' || mode.kind === 'rc'
  const state = active ? mode.state : null
  const pid = active ? mode.puzzleId : ''
  const row = active ? mode.row : null
  useEffect(() => { setStatus(null); setRetryReason(null) }, [pid])

  const onLike = useCallback(() => {
    if (!state?.route_id || ratingOf(state.route_id, pid) === 'like') return
    if (events.rate('like') && !getRouteOutbox().isClosed()) saveRating(state.route_id, pid, 'like')
    setTick(t => t + 1)
  }, [state, pid, events])

  const canReplace = !!state && state.replace_available && !pid.startsWith('words::') && !isKeptRow(row)
    && (!row || (row as DayClipDelivered).kind !== 'words')

  // tryReplace — шаги замены ЭТОГО ролика (оценка уже поставлена). Свежее чтение не
  // удалось — «Не удалось проверить маршрут. Попробуйте ещё раз» и кнопка
  // «Повторить», которая повторяет ТОЛЬКО эту проверку и замену (ревью 3а, R2-L6):
  // оценка уже сохранена, строка причин второй раз не открывается.
  const tryReplace = useCallback(async (reason: ClipDislikeReason) => {
    if (!state?.route_id) return
    setBusy(true)
    setRetryReason(null)
    setStatus('Подбираем замену…')
    // Право замены — по СВЕЖЕМУ состоянию (C1): день могли пересобрать, пока
    // открыт плеер (ролик ушёл в kept) — тогда замены нет, отчёт открытия цел.
    const fresh = await fetchFreshRouteState()
    if (!fresh.result.ok) { setBusy(false); setStatus(STATE_CHECK_FAILED_TEXT); setRetryReason(reason); return }
    const st = fresh.result.data
    if (st.route_id !== state.route_id || !replaceableIn(st, pid)) {
      setBusy(false)
      setStatus(REPLACE_UNAVAILABLE_TEXT)
      return
    }
    events.dropReport()
    const deps = browserExchangeDeps({
      // Чтения машины обмена — после изменения на шлюзе: свой запрос (ревью PR-C, N3).
      readState: async () => (await fetchFreshRouteState()).result,
      outbox: getRouteOutbox(), broadcast: broadcastRouteRevision, forDate: sd => forDate(sd),
    })
    const out = await replaceClip({ state: st, puzzleId: pid, reason, deps })
    setBusy(false)
    if (out.type === 'committed' && !out.foreign) {
      const ep = epochOf(st)
      if (ep) await markReplaced(pid, ep)
      setStatus(null); onNavigate(afterReplaceUrl(out.state)); return
    }
    setStatus(statusOf(out))
  }, [state, pid, events, onNavigate])

  const onDislike = useCallback((reason: ClipDislikeReason, replace: boolean) => {
    if (!state?.route_id || busy) return
    if (events.rate('dislike', reason) && !getRouteOutbox().isClosed()) saveRating(state.route_id, pid, 'dislike')
    setTick(t => t + 1)
    if (!replace || !canReplace) return
    void tryReplace(reason)
  }, [state, pid, events, busy, canReplace, tryReplace])

  const onRetry = useCallback(() => {
    if (busy || !retryReason) return
    void tryReplace(retryReason)
  }, [busy, retryReason, tryReplace])

  if (!active || !state?.route_id) return undefined
  return { rating: ratingOf(state.route_id, pid), canReplace, busy, status, onLike, onDislike, ...(retryReason && !busy ? { onRetry } : {}) }
}

// useVideoEnded — ролик досмотрен (событие адаптера 'ended'); новое
// проигрывание или ожидание снимает признак.
export function useVideoEnded(adapter: PlayerAdapter | null): [boolean, () => void] {
  const [ended, setEnded] = useState(false)
  useEffect(() => {
    setEnded(false)
    if (!adapter) return
    return adapter.on('state', p => {
      if (p === 'ended') setEnded(true)
      else if (p === 'playing' || p === 'buffering') setEnded(false)
    })
  }, [adapter])
  return [ended, () => setEnded(false)]
}

// BackToRouteLink — «← К маршруту» над видео: с сессией — `/app/route`, без —
// вход с возвратом на маршрут.
export function BackToRouteLink() {
  const s = useSession({ passive: true })
  const href = s.status === 'ready' && s.authenticated ? '/app/route' : '/login?next=/app/route'
  // Подпись — в .vtb-label: на узком телефоне она скрыта (остаётся стрелка), имя ссылки — aria-label.
  return <Link to={href} className="tb-btn vtb-route-link vtb-route-back" data-testid="back-to-route-link" title="К маршруту" aria-label="К маршруту">←<span className="vtb-label"> К маршруту</span></Link>
}

export function useRouteHref(): string {
  const s = useSession({ passive: true })
  return s.status === 'ready' && s.authenticated ? '/app/route' : '/login?next=/app/route'
}
