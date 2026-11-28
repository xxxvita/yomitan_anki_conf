// calendar-model.test.ts — чистая модель календаря (спека 2026-11-17 §4.12
// элемент 7 и «Календарь», N-M3, R2-M1, OQ-B4, OQ-B8; план B10c).
import { describe, it, expect } from 'vitest'
import {
  addMonths, calendarCells, calendarStart, canNext, canPrev, fmtMinutes, lvlOf, monthRange, ymOf,
  type CalendarInput, type DaysEntry,
} from '../calendar-model'

const row = (date: string): DaysEntry => ({ date, clips: [{ puzzle_id: 'youtube::vid00000001', kind: 'youtube', video_id: 'vid00000001', title: 't', duration_sec: 300 }] })

function input(over: Partial<CalendarInput> = {}): CalendarInput {
  return {
    today: '2026-11-18', startDay: '2026-11-10', viewYm: '2026-11', dayDate: '2026-11-18', todayMinutes: 0,
    months: new Map([['2026-11', [row('2026-11-12'), row('2026-11-18')]]]), ...over,
  }
}
const cell = (cells: ReturnType<typeof calendarCells>, date: string) => cells.find(c => c?.date === date)!

describe('месяцы и диапазон запроса', () => {
  it('ymOf, addMonths через границу года, диапазон месяца ≤ 31 дня', () => {
    expect(ymOf('2026-11-18')).toBe('2026-11')
    expect(addMonths('2026-01', -1)).toBe('2025-12')
    expect(addMonths('2026-12', 1)).toBe('2027-01')
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(monthRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' })
    for (const ym of ['2026-01', '2026-04', '2026-11', '2026-12']) {
      const { from, to } = monthRange(ym)
      const span = (Date.parse(to) - Date.parse(from)) / 86400000 + 1
      expect(span).toBeLessThanOrEqual(31)
    }
  })
})

describe('ячейки', () => {
  it('неделя с понедельника: 1 ноября 2026 — воскресенье, шесть пустых ячеек впереди', () => {
    const cells = calendarCells(input())
    expect(cells.slice(0, 6).every(c => c === null)).toBe(true)
    expect(cells[6]?.date).toBe('2026-11-01')
  })

  it('будущие дни неактивны, без времени', () => {
    const c = cell(calendarCells(input()), '2026-11-19')
    expect(c.kind).toBe('future')
    expect(c.clickable).toBe(false)
    expect(c.tm).toBeNull()
  })

  it('прошлый день со строкой — кликабелен, без минут и без фона (OQ-B4)', () => {
    const c = cell(calendarCells(input()), '2026-11-12')
    expect(c).toMatchObject({ kind: 'past', clickable: true, tm: null, lvl: 0 })
  })

  it('прошлый день после начала без строки — «—», не кликается', () => {
    const c = cell(calendarCells(input()), '2026-11-13')
    expect(c).toMatchObject({ kind: 'empty', clickable: false, tm: '—', lvl: 0 })
  })

  it('день до начала маршрута — тёмный и не кликается', () => {
    const c = cell(calendarCells(input()), '2026-11-05')
    expect(c).toMatchObject({ kind: 'pre', clickable: false, tm: null })
  })

  it('месяц ещё не прочитан — прошлые дни без «—» и без клика', () => {
    const c = cell(calendarCells(input({ months: new Map() })), '2026-11-13')
    expect(c).toMatchObject({ kind: 'loading', clickable: false, tm: null })
  })

  it('день со строкой раньше начала (импорт) — не тёмный, кликабелен', () => {
    const cells = calendarCells(input({ viewYm: '2026-10', months: new Map([['2026-10', [row('2026-10-20')]]]) }))
    expect(cell(cells, '2026-10-20')).toMatchObject({ kind: 'past', clickable: true })
    // начало календаря = самая ранняя прочитанная строка: дни между ней и started_at — «—»
    expect(cell(cells, '2026-10-21')).toMatchObject({ kind: 'empty', tm: '—' })
    expect(cell(cells, '2026-10-19')).toMatchObject({ kind: 'pre' })
  })

  it('сегодня: минуты по «просмотренным» и фон по трём порогам', () => {
    expect(cell(calendarCells(input({ todayMinutes: 25 })), '2026-11-18')).toMatchObject({ kind: 'today', clickable: true, tm: '25м', lvl: 1 })
    expect(cell(calendarCells(input({ todayMinutes: 35 })), '2026-11-18').lvl).toBe(2)
    expect(cell(calendarCells(input({ todayMinutes: 95 })), '2026-11-18')).toMatchObject({ tm: '1ч 35м', lvl: 3 })
    expect(cell(calendarCells(input({ todayMinutes: 0 })), '2026-11-18')).toMatchObject({ tm: '—', lvl: 0 })
  })

  it('day.date = вчера: ячейка сегодня без минут и без «—», вчера — обычный прошлый день', () => {
    const cells = calendarCells(input({ dayDate: '2026-11-17', todayMinutes: 40, months: new Map([['2026-11', [row('2026-11-17')]]]) }))
    expect(cell(cells, '2026-11-18')).toMatchObject({ kind: 'today', tm: null, lvl: 0 })
    expect(cell(cells, '2026-11-17')).toMatchObject({ kind: 'past', clickable: true, tm: null, lvl: 0 })
  })
})

describe('начало календаря и листание (N-M3, R2-M1, OQ-B8)', () => {
  it('начало = min(учебный день started_at, самая ранняя прочитанная строка)', () => {
    expect(calendarStart('2026-11-10', new Map([['2026-11', [row('2026-11-12')]]]))).toBe('2026-11-10')
    expect(calendarStart('2026-11-10', new Map([['2026-10', [row('2026-10-03')]], ['2026-11', []]]))).toBe('2026-10-03')
    expect(calendarStart(null, new Map())).toBeNull()
  })

  it('«‹» до месяца started_at; на месяце начала — стоп, если раньше started_at строк нет', () => {
    const months = new Map([['2026-10', [row('2026-10-20'), row('2026-10-28')]]])
    expect(canPrev('2026-11', '2026-10-20', months)).toBe(true)
    expect(canPrev('2026-10', '2026-10-20', months)).toBe(false)
  })

  it('импорт: строки раньше started_at в самом раннем прочитанном месяце — «‹» дальше', () => {
    const months = new Map([['2026-11', [row('2026-11-02'), row('2026-11-18')]], ['2026-10', [row('2026-10-05')]], ['2026-09', []]])
    expect(canPrev('2026-11', '2026-11-18', months)).toBe(true)
    expect(canPrev('2026-10', '2026-11-18', months)).toBe(true)
    expect(canPrev('2026-09', '2026-11-18', months)).toBe(false)
  })

  it('месяц раньше начала ещё не прочитан — «‹» нет', () => {
    expect(canPrev('2026-10', '2026-11-18', new Map())).toBe(false)
  })

  it('«›» — до текущего месяца', () => {
    expect(canNext('2026-10', '2026-11-18')).toBe(true)
    expect(canNext('2026-11', '2026-11-18')).toBe(false)
  })
})

describe('формат минут и пороги', () => {
  it('25м, 1ч, 1ч 35м; пороги <30, 30–59, ≥60', () => {
    expect(fmtMinutes(25)).toBe('25м')
    expect(fmtMinutes(60)).toBe('1ч')
    expect(fmtMinutes(95)).toBe('1ч 35м')
    expect([lvlOf(0), lvlOf(29), lvlOf(30), lvlOf(59), lvlOf(60)]).toEqual([0, 1, 2, 2, 3])
  })
})
