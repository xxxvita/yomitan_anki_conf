// ab-events.ts — seam для A/B-события «нажал Дальше» на /route.
//
// docs/plan-2026-07-13-design-transfer.md, Э3: POST /api/route/next —
// фиксированный контракт бэка ({"anon_id","route_goal","batch"} → 204).
// Остаётся отдельным package-level export (не заинлайнено в RoutePage.tsx),
// по тем же двум причинам, что и раньше (Э2 seam): (1) сигнатура не меняется
// при переключении реализации — RoutePage.tsx не трогается; (2)
// RoutePage.test.tsx мокает именно эту функцию (vi.mock('../ab-events')).
//
// keepalive:true — «Дальше» может быть последним кликом перед уходом со
// страницы (пользователь тут же кликает по первому видео нового батча);
// keepalive не даёт браузеру оборвать запрос при навигации. Ошибки (сеть,
// не-2xx) глотаются в console.warn — это A/B-телеметрия, не должна ломать UX
// пользователю, который уже увидел новый батч на экране.
export interface RouteNextEvent {
  anonId: string
  routeGoal: string
  batch: number
}

export function reportRouteNext(event: RouteNextEvent): void {
  fetch('/api/route/next', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    keepalive: true,
    body: JSON.stringify({ anon_id: event.anonId, route_goal: event.routeGoal, batch: event.batch }),
  }).then(res => {
    if (!res.ok) console.warn('[ab] route/next non-ok response', res.status)
  }).catch(err => {
    console.warn('[ab] route/next failed', err)
  })
}
