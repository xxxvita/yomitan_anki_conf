// Calendar.tsx — календарь экрана дня (спека 2026-11-17 §4.5, §4.12 элемент 7
// и «Календарь»; план B10c; макет `ДИЗ/README.md:147-158`, `cab-route.jsx:101-142`).
// Правила ячеек и листания — calendar-model.ts. Месяцы читает route-days.ts (один
// запрос в полёте на вкладку). На ширине ≤ 1100 px календарь свёрнут кнопкой
// «Сегодня ▾» / «13 ноя ▾» (CSS макета).
import { useEffect, useState } from 'react'
import { CabI } from '../cab-icons'
import { GatewayRefused, TemporaryDown } from './RouteMessages'
import { calendarCells, canNext, canPrev, addMonths, ymOf, type DaysEntry } from './calendar-model'

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
const WEEK = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

export function monthTitle(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return `${MONTHS[m - 1]} ${y}`
}

export function shortDay(date: string): string {
  const [, m, d] = date.split('-').map(Number)
  return `${d} ${MONTHS_SHORT[m - 1]}`
}

export interface CalendarProps {
  today: string
  startDay: string | null
  dayDate: string
  todayMinutes: number
  months: ReadonlyMap<string, DaysEntry[]>
  want: (ym: string) => void
  failure?: (ym: string) => { kind: 'temporary' | 'refused' | 'stopped'; until: number } | null
  sel: string | null            // выбранный прошлый день; null — сегодня
  onSelect: (date: string | null) => void
}

export function Calendar({ today, startDay, dayDate, todayMinutes, months, want, failure, sel, onSelect }: CalendarProps) {
  const [view, setView] = useState(() => ymOf(sel ?? today))
  const [open, setOpen] = useState(false)
  useEffect(() => { want(view) }, [view, want])
  // Отказ чтения месяца (ревью 3b, L5, R1-L1): временный — отсчёт повтора;
  // окончательный — текст отказа шлюза; прочие (401/403/400/404) — только ячейки
  // в виде ошибки (сессию перечитывает загрузчик, экран страницы — её состояние).
  const fail = failure?.(view) ?? null
  const cells = calendarCells({ today, startDay, viewYm: view, dayDate, todayMinutes, months, failed: fail !== null })
  const prev = canPrev(view, startDay, months)
  const next = canNext(view, today)
  const selDate = sel ?? today
  return (
    <aside className={'cal' + (open ? '' : ' closed')} data-testid="route-calendar">
      <div className="cal-h">
        <span className="serif" data-testid="cal-month">{monthTitle(view)}</span>
        <span className="cal-nav">
          <button type="button" className="btn sm" aria-label="Предыдущий месяц" disabled={!prev} onClick={() => setView(v => addMonths(v, -1))}>‹</button>
          <button type="button" className="btn sm" aria-label="Следующий месяц" disabled={!next} onClick={() => setView(v => addMonths(v, 1))}>›</button>
        </span>
        <button type="button" className="btn sm cal-toggle" aria-expanded={open} onClick={() => setOpen(o => !o)}>
          <CabI.cal />{sel === null ? 'Сегодня' : shortDay(sel)}<CabI.chev style={{ transform: open ? 'rotate(180deg)' : 'none' }} />
        </button>
      </div>
      <div className="cal-grid">
        {WEEK.map(w => <div key={w} className="wd">{w}</div>)}
        {cells.map((c, i) => {
          if (!c) return <div key={'e' + i} />
          const cls = ['cd', c.kind === 'past' ? 'past' : '', c.kind === 'today' ? 'today' : '', c.kind === 'pre' ? 'pre' : '',
            c.kind === 'empty' || c.kind === 'error' ? 'off' : '', c.kind === 'today' && c.tm === '—' ? 'off' : '', selDate === c.date ? 'sel' : ''].filter(Boolean).join(' ')
          const body = <><span>{c.day}</span>{c.tm !== null && <span className="tm">{c.tm}</span>}</>
          return c.clickable ? (
            <button key={c.date} type="button" className={cls} data-lvl={c.lvl} data-kind={c.kind} data-testid={`cal-${c.date}`}
              aria-pressed={selDate === c.date} onClick={() => { onSelect(c.kind === 'today' ? null : c.date); setOpen(false) }}>{body}</button>
          ) : (
            <div key={c.date} className={cls} data-lvl={c.lvl} data-kind={c.kind} data-testid={`cal-${c.date}`}>{body}</div>
          )
        })}
      </div>
      {fail?.kind === 'temporary' && <div className="cal-err" data-testid="cal-error"><TemporaryDown until={fail.until} /></div>}
      {fail?.kind === 'refused' && <div className="cal-err" data-testid="cal-error"><GatewayRefused /></div>}
      <div className="cal-foot">
        <span className="lg"><i className="t" />Сегодня</span>
        <span className="lg"><i className="h" />Время занятий за день — только за сегодня</span>
        <span className="lg"><i className="o">—</i>Не занимались</span>
        <span>Прошлые дни можно открыть и пересмотреть. Следующие дни появятся по мере прохождения.</span>
      </div>
    </aside>
  )
}
