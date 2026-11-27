// calendar-page.test.tsx — календарь и прошлые дни на странице (план B10c,
// «Приёмка»), настройки и сброс (план B10d, «Приёмка»).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { fireEvent, screen, waitFor, within, act } from '@testing-library/react'
import { __resetSessionForTests, __setSessionForTests } from '../../../session'
import { __resetRouteStateForTests } from '../use-route-state'
import { __resetRouteOutboxForTests } from '../outbox'
import { __resetDaysLoaderForTests } from '../route-days'
import { writeWatched } from '../../../../player/route-events/route-watched'
import { FakeRouteBFF, json, renderRoutePage, st, del, und, kept, pid, vid, ROUTE, TODAY, fullText } from './route-page-fakes'
import type { DaysEntry } from '../calendar-model'

let bff: FakeRouteBFF
beforeEach(() => {
  __resetSessionForTests(); __resetRouteStateForTests(); __resetRouteOutboxForTests(); __resetDaysLoaderForTests()
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(`${TODAY}T12:00:00`))
  bff = new FakeRouteBFF()
  vi.stubGlobal('fetch', vi.fn((u: string, i?: RequestInit) => bff.fetch(u, i)))
  __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_abcd', routeAllowed: true, demo: false })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); __resetRouteOutboxForTests(); __resetDaysLoaderForTests() })

const wait = (ms: number) => act(async () => { await new Promise(r => setTimeout(r, ms)) })
const cal = (date: string) => screen.getByTestId(`cal-${date}`)
const daysCalls = () => bff.of('/api/me/route/days').map(c => new URL(c.url, 'https://flib.club').searchParams)
const yt = (n: number, over: Record<string, unknown> = {}) => ({ puzzle_id: pid(n), kind: 'youtube', video_id: vid(n), title: `Past ${n}`, source: 'YouTube', duration_sec: 300, ...over })
function daysBy(map: Record<string, DaysEntry[]>) {
  bff.daysReply = from => json(200, { days: map[from.slice(0, 7)] ?? [] })
}
async function showDay(s = st([del(1, { played: true }), del(2), und()])) {
  bff.state = s
  renderRoutePage(bff)
  await screen.findByTestId('route-calendar')
  await waitFor(() => expect(daysCalls().length).toBeGreaterThan(0))
  await wait(20)
}

describe('B10c: календарь', () => {
  it('прошлый день: без отметок, «k из M» и минут; «+N сл.» только при words; урок прошедшего дня без кнопки; «Пересмотреть» без rc/rp', async () => {
    daysBy({ '2026-11': [{ date: '2026-11-12', clips: [
      yt(1, { words: ['alpha', 'big deal'] }), yt(2),
      { puzzle_id: 'words::aaaa', kind: 'words', words: ['one', 'two'] }, { puzzle_id: 'words::bbbb', kind: 'words' },
    ] }] })
    await showDay()
    expect(within(cal('2026-11-12')).queryByText(/м$/)).toBeNull()
    fireEvent.click(cal('2026-11-12'))
    const past = await screen.findByTestId('past-day')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Четверг, 12 ноября')
    expect(screen.getByTestId('past-meta').textContent).toContain('4 ролика · 10 мин')
    expect(past.querySelector('.ck')).toBeNull()
    expect(document.body.textContent).not.toMatch(/из \d+ просмотрено/)
    expect(within(screen.getByTestId('past-row-1')).getByRole('button', { name: /\+2 сл\./ })).toBeTruthy()
    expect(within(screen.getByTestId('past-row-2')).queryByRole('button', { name: /сл\./ })).toBeNull()
    expect(within(screen.getByTestId('past-row-1')).getByRole('link', { name: 'Пересмотреть' }).getAttribute('href')).toBe(`/player?v=${vid(1)}&back=route`)
    const l1 = screen.getByTestId('past-row-3')
    expect(l1.textContent).toContain('Урок слов · 2 слова')
    expect(l1.textContent).toContain('Урок прошедшего дня')
    expect(within(l1).queryByRole('link')).toBeNull()
    expect(screen.getByTestId('past-row-4').textContent).toContain('Урок слов')
    expect(screen.getByTestId('past-row-4').textContent).not.toContain('·  слов')
    // оценки и замены у прошлого дня нет
    expect(within(past).queryByRole('button', { name: 'Нравится' })).toBeNull()
    expect(within(past).queryByRole('button', { name: 'Заменить' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '← Вернуться к сегодня' }))
    await screen.findByTestId('day-hero')
  })

  it('будущие дни неактивны; день до начала тёмный и не кликается; после начала без строки — «—»', async () => {
    daysBy({ '2026-11': [{ date: '2026-11-12', clips: [yt(1)] }] })
    await showDay()
    expect(cal('2026-11-19').tagName).toBe('DIV')
    expect(cal('2026-11-19').getAttribute('data-kind')).toBe('future')
    expect(cal('2026-11-05').getAttribute('data-kind')).toBe('pre')
    expect(cal('2026-11-05').tagName).toBe('DIV')
    expect(cal('2026-11-13').textContent).toBe('13—')
    expect(cal('2026-11-13').tagName).toBe('DIV')
  })

  it('импорт: при листании назад месяцы со строками раньше started_at открываются, листание стоит на первом месяце без таких строк', async () => {
    daysBy({ '2026-11': [{ date: '2026-11-02', clips: [yt(1)] }], '2026-10': [{ date: '2026-10-05', clips: [yt(2)] }] })
    await showDay(st([del(3), und()], { started_at: '2026-11-18T09:00:00Z' }))
    const prev = () => screen.getByRole('button', { name: 'Предыдущий месяц' }) as HTMLButtonElement
    await waitFor(() => expect(prev().disabled).toBe(false))
    expect(cal('2026-11-02').tagName).toBe('BUTTON')
    fireEvent.click(prev())
    await waitFor(() => expect(cal('2026-10-05').tagName).toBe('BUTTON'))
    expect(cal('2026-10-05').getAttribute('data-kind')).toBe('past')
    expect(cal('2026-10-06').textContent).toBe('6—')
    await waitFor(() => expect(prev().disabled).toBe(false))
    fireEvent.click(prev())
    await waitFor(() => expect(screen.getByTestId('cal-month').textContent).toBe('Сентябрь 2026'))
    await waitFor(() => expect(daysCalls().some(q => q.get('from') === '2026-09-01')).toBe(true))
    await wait(20)
    expect(prev().disabled).toBe(true)
  })

  it('ни одного запроса days шире месяца', async () => {
    daysBy({})
    await showDay(st([del(3), und()], { started_at: '2026-08-02T09:00:00Z' }))
    for (let i = 0; i < 3; i++) { fireEvent.click(screen.getByRole('button', { name: 'Предыдущий месяц' })); await wait(20) }
    expect(daysCalls().length).toBeGreaterThanOrEqual(2)
    for (const q of daysCalls()) {
      const span = (Date.parse(q.get('to')!) - Date.parse(q.get('from')!)) / 86400000 + 1
      expect(span).toBeLessThanOrEqual(31)
      expect(q.get('from')!.slice(0, 7)).toBe(q.get('to')!.slice(0, 7))
    }
  })

  it('быстрое листание трёх месяцев — не больше одного запроса days одновременно', async () => {
    bff.daysReply = () => new Promise<Response>(r => setTimeout(() => r(json(200, { days: [] })), 40))
    await showDay(st([del(3), und()], { started_at: '2026-07-02T09:00:00Z' }))
    const prev = screen.getByRole('button', { name: 'Предыдущий месяц' })
    fireEvent.click(prev); fireEvent.click(prev); fireEvent.click(prev)
    await wait(300)
    expect(bff.daysMaxInflight).toBe(1)
    expect(screen.getByTestId('cal-month').textContent).toBe('Август 2026')
    await waitFor(() => expect(daysCalls().some(q => q.get('from') === '2026-08-01')).toBe(true))
  })

  it('маршрут, начатый в прошлом месяце (не импорт), листается назад ровно до месяца начала', async () => {
    daysBy({ '2026-10': [{ date: '2026-10-15', clips: [yt(1)] }, { date: '2026-10-20', clips: [yt(2)] }] })
    await showDay(st([del(3), und()], { started_at: '2026-10-15T09:00:00Z' }))
    fireEvent.click(screen.getByRole('button', { name: 'Предыдущий месяц' }))
    await waitFor(() => expect(cal('2026-10-15').tagName).toBe('BUTTON'))
    await wait(20)
    expect((screen.getByRole('button', { name: 'Предыдущий месяц' }) as HTMLButtonElement).disabled).toBe(true)
    expect(cal('2026-10-14').getAttribute('data-kind')).toBe('pre')
    expect(daysCalls().some(q => q.get('from') === '2026-09-01')).toBe(false)
  })

  it('переход учебного дня в 04:00: в 03:30 «сегодня» — ещё вчерашняя дата', async () => {
    vi.setSystemTime(new Date('2026-11-19T03:30:00'))
    daysBy({})
    await showDay()
    expect(cal('2026-11-18').getAttribute('data-kind')).toBe('today')
    expect(cal('2026-11-19').getAttribute('data-kind')).toBe('future')
  })

  it('day.date = вчера: минуты вчерашнего плана не попадают в ячейку сегодня', async () => {
    daysBy({ '2026-11': [{ date: '2026-11-17', clips: [yt(1), yt(2)] }] })
    const y = st([del(1, { played: true, duration_sec: 1800 }), del(2, { played: true, duration_sec: 1800 })], { snapshot_date: '2026-11-17' })
    y.day!.date = '2026-11-17'
    await showDay(y)
    expect(cal('2026-11-18').getAttribute('data-kind')).toBe('today')
    expect(cal('2026-11-18').textContent).toBe('18')
    expect(cal('2026-11-18').getAttribute('data-lvl')).toBe('0')
    expect(cal('2026-11-17').getAttribute('data-kind')).toBe('past')
    expect(cal('2026-11-17').textContent).toBe('17')
  })

  it('минуты сегодня после замены (с Г7) включают kept; на фикстуре Р24 — и kept_local 3-го ролика; без записи — нет', async () => {
    daysBy({})
    await showDay(st([kept(1), del(2, { played: true }), del(4), und()]))
    expect(cal(TODAY).textContent).toBe('1810м')
  })

  it('Р24: kept_local 3-го ролика (запись этого устройства) — в минутах сегодня', async () => {
    daysBy({})
    writeWatched(ROUTE, TODAY, pid(3), 0.9, { video_id: vid(3), title: 'Local 3', duration_sec: 600 })
    await showDay(st([kept(1), del(2, { played: true }), del(4), und()]))
    expect(cal(TODAY).textContent).toBe('1820м')
  })

  it('после смены учебного дня ячейка вчера и прошлый день ролика kept_local не показывают', async () => {
    writeWatched(ROUTE, '2026-11-17', pid(3), 0.9, { video_id: vid(3), title: 'Local 3', duration_sec: 600 })
    daysBy({ '2026-11': [{ date: '2026-11-17', clips: [yt(1)] }] })
    await showDay(st([del(5), und()]))
    expect(cal('2026-11-17').textContent).toBe('17')
    fireEvent.click(cal('2026-11-17'))
    const past = await screen.findByTestId('past-day')
    expect(past.textContent).not.toContain('Local 3')
    expect(screen.getAllByTestId(/^past-row-/)).toHaveLength(1)
  })
})

describe('B10d: настройки и сброс', () => {
  const settings = () => screen.getByTestId('route-settings') as HTMLDetailsElement
  const puts = () => bff.of('/api/me/route/params', 'PUT').map(c => c.body)

  const range = (f: string) => screen.getByTestId(`range-${f}`) as HTMLInputElement
  const slide = (f: string, v: number) => { fireEvent.change(range(f), { target: { value: String(v) } }); fireEvent.pointerUp(range(f)) }

  it('блок по умолчанию закрыт; ползунки 15–540 шаг 5 и 5–50 шаг 1 вместо кнопок', async () => {
    await showDay()
    expect(settings().open).toBe(false)
    const m = range('daily_listening_budget_min')
    expect([m.min, m.max, m.step]).toEqual(['15', '540', '5'])
    const w = range('daily_new_words')
    expect([w.min, w.max, w.step]).toEqual(['5', '50', '1'])
    expect(screen.queryByTestId('seg-daily_listening_budget_min')).toBeNull()
    expect(screen.getByText('Изменение применится к новому маршруту')).toBeTruthy()
  })

  it('маршрут из приложения с бюджетом 60 мин — ползунок стоит на 60; отпускание без изменения не шлёт PUT', async () => {
    await showDay(st([del(1, { played: true }), del(2), und()], { params: { daily_listening_budget_min: 60, daily_new_words: 15 } }))
    expect(range('daily_listening_budget_min').value).toBe('60')
    expect(range('daily_new_words').value).toBe('15')
    fireEvent.pointerUp(range('daily_listening_budget_min'))
    fireEvent.keyUp(range('daily_new_words'))
    await wait(50)
    expect(puts()).toHaveLength(0)
  })

  it('смена значения — PUT одним полем (одним, несмотря на несколько событий отпускания) и «Применится к следующему дню маршрута»; список дня не меняется', async () => {
    await showDay()
    const before = screen.getAllByTestId(/^row-\d+$/).map(r => r.textContent)
    fireEvent.change(range('daily_new_words'), { target: { value: '33' } })
    fireEvent.pointerUp(range('daily_new_words'))
    fireEvent.mouseUp(range('daily_new_words'))
    fireEvent.blur(range('daily_new_words'))
    await screen.findByText('Применится к следующему дню маршрута')
    expect(puts()).toEqual([{ daily_new_words: 33 }])
    expect(range('daily_new_words').value).toBe('33')
    expect(screen.getAllByTestId(/^row-\d+$/).map(r => r.textContent)).toEqual(before)
    expect(bff.of('/api/me/route/exchange', 'POST')).toHaveLength(0)
  })

  it('минуты уходят в PUT своим одним полем', async () => {
    await showDay()
    slide('daily_listening_budget_min', 135)
    await screen.findByText('Применится к следующему дню маршрута')
    expect(puts()).toEqual([{ daily_listening_budget_min: 135 }])
  })

  it('[Отмена] ничего не шлёт', async () => {
    await showDay()
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить маршрут' }))
    expect(screen.getByTestId('reset-confirm').textContent).toContain('Маршрут начнётся заново: история дней и прогресс роликов удалятся. Ключ останется прежним.')
    fireEvent.click(within(screen.getByTestId('reset-confirm')).getByRole('button', { name: 'Отмена' }))
    await wait(50)
    expect(bff.of('/api/me/route', 'DELETE')).toHaveLength(0)
    expect(screen.queryByTestId('reset-confirm')).toBeNull()
  })

  it('[Да, сбросить] — DELETE, затем сразу «Маршрута нет» (старт)', async () => {
    await showDay()
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить маршрут' }))
    bff.state = st(null, { started: false, route_id: null, revision: 6, started_at: null })
    fireEvent.click(within(screen.getByTestId('reset-confirm')).getByRole('button', { name: 'Да, сбросить' }))
    await screen.findByText(fullText('Давайте установим Ваш реальный уровень'))
    expect(bff.of('/api/me/route', 'DELETE')).toHaveLength(1)
  })
})
