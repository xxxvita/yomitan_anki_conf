// line-credit.ts — ведро реплик сайта (перенос пункта M3 ревью партии 1).
//
// У шлюза два повода забанить маршрут ключа (client-spec «Серверный маршрут» →
// «Бан»): частота пишущих запросов (её держит бюджет BFF 60/мин) и ВЕДРО РЕПЛИК —
// 100 в минуту, потолок 3000. Его тратит каждый принятый отчёт: прирост сверх
// высшей отметки `heard_max` ролика — `PUT /clips/progress` по `heard_total`,
// `clip_played` по числу различных `sub_ref` в `subs_heard`; у ролика без строки
// прогресса — целиком. Ведро в минусе — бан. BFF пропускает оба поля как есть,
// поэтому ОДИН запрос с `heard_total: 3001` по новому ролику банит маршрут.
//
// Сайт никогда не рождает таких значений:
//   1. Отчёт о ролике, в котором услышано больше MAX_HEARD_PER_REPORT различных
//      реплик, уходит без состава (`subs_report:""` + `played_frac`, clip-played.ts).
//   2. `PUT progress` поднимает `heard_total` не больше чем на
//      MAX_PROGRESS_HEARD_STEP за запрос (progress.ts).
//   3. Очередь и прогресс тратят ОБЩЕЕ ведро сайта (лежит в `flib:route-outbox`,
//      общее для вкладок): половина ведра шлюза, половина пополнения — вторая
//      половина остаётся приложению на том же ключе (как бюджет записи 60 из 120).
//      Отчёт, на который в ведре нет места, ждёт пополнения: долгий офлайн
//      выгружается порциями (норма 4 клиентов).
// Оценка стоимости `clip_played` — ВСЕ его различные услышанные реплики, без
// вычета отметки шлюза: сверху, то есть в безопасную сторону.

export const SITE_LINE_CREDIT_CAP = 1500
export const SITE_LINE_CREDIT_PER_MIN = 50
// MAX_HEARD_PER_REPORT < SITE_LINE_CREDIT_CAP: любой отчёт однажды помещается.
export const MAX_HEARD_PER_REPORT = 1200
export const MAX_PROGRESS_HEARD_STEP = 300

export interface LineCredit { level: number; at: number }

// refillCredit — ведро на момент now (пополнение по времени, потолок).
// Нет записи или она битая — полное ведро.
export function refillCredit(c: LineCredit | null | undefined, now: number): LineCredit {
  if (!c || !Number.isFinite(c.level) || !Number.isFinite(c.at)) return { level: SITE_LINE_CREDIT_CAP, at: now }
  const dt = Math.max(0, now - c.at)
  const level = Math.min(SITE_LINE_CREDIT_CAP, Math.max(0, c.level) + (dt / 60000) * SITE_LINE_CREDIT_PER_MIN)
  return { level, at: now }
}

// msUntil — сколько ждать, чтобы в ведре стало cost (cost ≤ потолка).
export function msUntil(c: LineCredit, cost: number): number {
  const need = Math.min(cost, SITE_LINE_CREDIT_CAP) - c.level
  if (need <= 0) return 0
  return Math.ceil((need / SITE_LINE_CREDIT_PER_MIN) * 60000)
}

// eventLineCost — сколько реплик спишет событие: у `clip_played` — число
// различных `sub_ref` в `subs_heard`, у прочих родов — 0.
export function eventLineCost(ev: { type?: unknown; subs_heard?: unknown }): number {
  if (ev.type !== 'clip_played' || !Array.isArray(ev.subs_heard)) return 0
  const refs = new Set<string>()
  for (const h of ev.subs_heard) {
    const r = (h as { sub_ref?: unknown })?.sub_ref
    if (typeof r === 'string') refs.add(r)
  }
  return refs.size
}
