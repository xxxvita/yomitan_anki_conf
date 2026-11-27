// local-inputs.ts — память этого браузера для модели дня (спека 2026-11-17 §4.2):
// отметки `flib:route-watched` той же эпохи и даты плана, ролики с clip_played в
// локальной очереди (вкл. пачку в полёте) и просмотренные слова урока.
import type { RouteState } from './route-api'
import type { LocalDayInputs } from './day-model'
import type { StateSentProbe } from './use-route-state'
import { getRouteOutbox } from './outbox'
import { watchedFor } from '../../../player/route-events/route-watched'
import { lessonHeardCount } from './route-lesson'

export function localDayInputs(state: RouteState, sent?: StateSentProbe): LocalDayInputs {
  const routeId = state.route_id ?? ''
  const day = state.day?.date ?? ''
  return {
    watched: routeId && day ? watchedFor(routeId, day) : {},
    pendingClipPlayed: getRouteOutbox().pendingClipPlayed(),
    ...(sent ? { sentPending: sent.pendingClipPlayed, sentWatchedSeq: sent.watchedSeq } : {}),
    lessonHeard: pid => lessonHeardCount(routeId, day, pid),
  }
}
