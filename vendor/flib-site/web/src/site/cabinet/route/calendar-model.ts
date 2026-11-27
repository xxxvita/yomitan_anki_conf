// calendar-model.ts — чистая модель календаря экрана дня (спека 2026-11-17
// §4.12 элемент 7 и «Календарь», N-M3, R2-M1, OQ-B4, OQ-B8; план B10c; макет
// `ДИЗ/README.md:147-158`, `cab-route.jsx:101-142`).
//
// • Неделя с понедельника; «сегодня» — учебный день СЕЙЧАС.
// • Минуты и фон по трём порогам — ТОЛЬКО у сегодня и только когда план на
//   экране — сегодняшний (`day.date` = сегодня): сумма длительностей роликов с
//   признаком «просмотрен» (вкл. kept и kept_local этого устройства) — её
//   считает модель дня. `day.date` раньше сегодня — ячейка сегодня без минут и
//   без «—» (день не начат).
// • Прошлые дни со строкой `GET /days` — кликабельны, без минут, без фона и без
//   «—» (до Г5 данных о просмотре нет); после начала без строки — «—»; раньше
//   начала — тёмные. Начало = min(учебный день `started_at`, самая ранняя дата
//   среди строк, ПРОЧИТАННЫХ этой вкладкой) — день со строкой никогда не тёмный.
// • «‹» доступна до месяца начала и дальше, пока в самом раннем прочитанном
//   месяце есть строка раньше учебного дня `started_at`; «›» — до текущего месяца.

export interface DaysClip {
  puzzle_id: string; kind: string; video_id?: string; title?: string; series_title?: string; source?: string
  duration_sec?: number; words?: string[]
}
export interface DaysEntry { date: string; clips: DaysClip[] }

export type CellKind = 'today' | 'past' | 'empty' | 'pre' | 'future' | 'loading' | 'error'

export interface CalendarCell {
  date: string
  day: number
  kind: CellKind
  clickable: boolean
  tm: string | null   // подпись под числом: минуты, «—» или ничего
  lvl: 0 | 1 | 2 | 3  // фон по времени
}

export interface CalendarInput {
  today: string                     // учебный день сейчас
  startDay: string | null           // учебный день `started_at`
  viewYm: string                    // показываемый месяц YYYY-MM
  dayDate: string                   // дата плана на экране
  todayMinutes: number              // минуты сегодня по «просмотренным» (модель дня)
  months: ReadonlyMap<string, DaysEntry[]>  // прочитанные месяцы
  failed?: boolean                  // месяц не прочитан после отказа (ревью 3b, L5)
}

const pad = (n: number) => String(n).padStart(2, '0')

export function ymOf(date: string): string { return date.slice(0, 7) }

export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number)
  const t = y * 12 + (m - 1) + n
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`
}

export function daysInMonth(ym: string): number {
  const [y, m] = ym.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

// monthRange — диапазон запроса `GET /api/me/route/days`: ровно один месяц (≤ 31 день).
export function monthRange(ym: string): { from: string; to: string } {
  return { from: `${ym}-01`, to: `${ym}-${pad(daysInMonth(ym))}` }
}

export function fmtMinutes(m: number): string {
  return m < 60 ? `${m}м` : `${Math.floor(m / 60)}ч${m % 60 ? ` ${m % 60}м` : ''}`
}

export function lvlOf(m: number): 0 | 1 | 2 | 3 {
  return m <= 0 ? 0 : m < 30 ? 1 : m < 60 ? 2 : 3
}

// calendarStart — min(учебный день started_at, самая ранняя прочитанная строка).
export function calendarStart(startDay: string | null, months: ReadonlyMap<string, DaysEntry[]>): string | null {
  let s = startDay
  for (const rows of months.values()) for (const r of rows) if (s === null || r.date < s) s = r.date
  return s
}

export function canPrev(viewYm: string, startDay: string | null, months: ReadonlyMap<string, DaysEntry[]>): boolean {
  if (startDay && viewYm > ymOf(startDay)) return true
  const rows = months.get(viewYm)
  if (!rows) return false
  return startDay ? rows.some(r => r.date < startDay) : false
}

export function canNext(viewYm: string, today: string): boolean {
  return viewYm < ymOf(today)
}

// calendarCells — ячейки месяца с пустыми впереди (неделя с понедельника).
export function calendarCells(i: CalendarInput): Array<CalendarCell | null> {
  const [y, m] = i.viewYm.split('-').map(Number)
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7
  const rows = i.months.get(i.viewYm)
  const withRow = new Set((rows ?? []).map(r => r.date))
  const start = calendarStart(i.startDay, i.months)
  const out: Array<CalendarCell | null> = Array.from({ length: lead }, () => null)
  const n = daysInMonth(i.viewYm)
  for (let d = 1; d <= n; d++) {
    const date = `${i.viewYm}-${pad(d)}`
    let c: CalendarCell
    if (date > i.today) {
      c = { date, day: d, kind: 'future', clickable: false, tm: null, lvl: 0 }
    } else if (date === i.today) {
      const counted = i.dayDate === i.today
      const mins = counted ? Math.max(0, i.todayMinutes) : 0
      c = { date, day: d, kind: 'today', clickable: true, tm: counted ? (mins > 0 ? fmtMinutes(mins) : '—') : null, lvl: counted ? lvlOf(mins) : 0 }
    } else if (withRow.has(date)) {
      c = { date, day: d, kind: 'past', clickable: true, tm: null, lvl: 0 }
    } else if (start !== null && date < start) {
      c = { date, day: d, kind: 'pre', clickable: false, tm: null, lvl: 0 }
    } else if (!rows) {
      c = { date, day: d, kind: i.failed ? 'error' : 'loading', clickable: false, tm: null, lvl: 0 }
    } else {
      c = { date, day: d, kind: 'empty', clickable: false, tm: '—', lvl: 0 }
    }
    out.push(c)
  }
  return out
}
