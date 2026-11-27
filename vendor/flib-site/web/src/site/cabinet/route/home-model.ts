// home-model.ts — «Сегодня в маршруте» на Главной (спека 2026-11-17 §4.12
// «Главная», M4, L4, R2-C2; план B10e; макет экран 2, `cab-route.jsx:34-53`).
// Признаки роликов — модель дня (day-model.ts), та же, что у страницы маршрута.
//
// Правило «до выдачи»: название невыданного ролика здесь не появляется НИКОГДА —
// «Дальше» показывает только название ТЕКУЩЕГО (выданного) ролика, а когда
// следующий ещё не выдан — «Дальше: следующий ролик» без названия.
import type { RouteState } from './route-api'
import { lessonUrl, playerRouteUrl, type DayModel } from './day-model'

export type HomeSeg = 'done' | 'cur' | ''

export type HomeNext =
  | { kind: 'start_day' }                         // план без выданных — «Начать день»
  | { kind: 'new_day' }                           // day.date раньше сегодня — «Получить ролики на сегодня»
  | { kind: 'done' }                              // день завершён — «На сегодня всё — до завтра.»
  | { kind: 'clip'; title: string; href: string } // текущий не «просмотрен» — его плеер с rp
  | { kind: 'lesson'; href: string }              // текущий урок не «просмотрен» — страница урока
  | { kind: 'next'; href: string }                // текущий «просмотрен», есть невыданные — обмен через ?next=

export interface HomeSummary { segs: HomeSeg[]; next: HomeNext }

export function homeSummary(state: RouteState, model: DayModel, today: string): HomeSummary {
  const segs: HomeSeg[] = model.rows.map(r => (r.watched ? 'done' : r.kind === 'current' ? 'cur' : ''))
  const c = model.current
  const day = state.day?.date ?? ''
  if (!c) return { segs, next: { kind: 'start_day' } }
  if (day && day < today) return { segs, next: { kind: 'new_day' } }
  if (model.dayDone) return { segs, next: { kind: 'done' } }
  const pid = c.puzzleId!
  const nextHref = `/app/route?next=${encodeURIComponent(pid)}`
  if (c.lesson) return { segs, next: c.watched ? { kind: 'next', href: nextHref } : { kind: 'lesson', href: lessonUrl(pid) } }
  if (!c.watched && c.clipKind === 'youtube' && c.videoId) {
    return { segs, next: { kind: 'clip', title: c.title || 'Ролик YouTube', href: playerRouteUrl(c.videoId, pid) } }
  }
  // «просмотрен» (или не открываемый на сайте `other`) и есть невыданные (иначе день завершён)
  return { segs, next: { kind: 'next', href: nextHref } }
}
