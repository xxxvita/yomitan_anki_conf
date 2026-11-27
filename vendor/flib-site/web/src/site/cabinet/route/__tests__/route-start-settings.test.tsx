// route-start-settings.test.tsx — «Настройки маршрута» на экране старта (решение
// владельца 2026-11-21): пресеты, ползунки, тело быстрого старта, смена учебного дня.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { __resetSessionForTests, __setSessionForTests } from '../../../session'
import { __resetRouteStateForTests } from '../use-route-state'
import { __resetRouteOutboxForTests } from '../outbox'
import { FakeRouteBFF, renderRoutePage, st, TODAY, fullText } from './route-page-fakes'
import {
  applyPreset, DEFAULT_SETTINGS, loadSettings, saveSettings, setField, setKids, settingsBody, SETTINGS_KEY, ROUTE_PRESETS,
} from '../route-settings'
import { DAY_TRANSITION_KEY, forDate, savedDayTransition } from '../learning-day'

const FRIENDS = { id: 'friends', title: 'Friends', kind: 'Ситком', level: 'B1–B2', target: 'friends-light/s01e01', title_ru: 'Друзья', year: 1994, type: 'Сериал', imdb_id: 'tt0108778', poster_slug: 'friends-light' }

describe('route-settings (модель)', () => {
  beforeEach(() => localStorage.clear())

  it('пресеты ставят ползунки 2–5 ровно как в приложении', () => {
    expect(ROUTE_PRESETS).toEqual({
      comfort: { gatePct: 10, coveragePct: 95, minutes: 60, words: 15 },
      balanced: { gatePct: 15, coveragePct: 95, minutes: 120, words: 20 },
      fast: { gatePct: 30, coveragePct: 95, minutes: 180, words: 30 },
    })
    expect(DEFAULT_SETTINGS).toMatchObject({ presetId: 'balanced', ...ROUTE_PRESETS.balanced })
    expect(applyPreset(DEFAULT_SETTINGS, 'fast')).toMatchObject({ presetId: 'fast', gatePct: 30, minutes: 180 })
  })

  it('движение ползунка 2–5 снимает пресет; детский уровень и темп — нет', () => {
    for (const f of ['gatePct', 'coveragePct', 'minutes', 'words'] as const) {
      expect(setField(DEFAULT_SETTINGS, f, 25).presetId).toBe('custom')
    }
    expect(setKids(DEFAULT_SETTINGS, 40).presetId).toBe('balanced')
  })

  it('значения прижимаются к диапазону и шагу приложения', () => {
    expect(setField(DEFAULT_SETTINGS, 'gatePct', 1).gatePct).toBe(5)
    expect(setField(DEFAULT_SETTINGS, 'gatePct', 99).gatePct).toBe(50)
    expect(setField(DEFAULT_SETTINGS, 'coveragePct', 10).coveragePct).toBe(40)
    expect(setField(DEFAULT_SETTINGS, 'minutes', 3).minutes).toBe(15)
    expect(setField(DEFAULT_SETTINGS, 'minutes', 9999).minutes).toBe(540)
    expect(setField(DEFAULT_SETTINGS, 'words', 51).words).toBe(50)
    expect(setKids(DEFAULT_SETTINGS, 99).kidsPct).toBe(70)
  })

  it('settingsBody: ровно выбранные значения; детский уровень «по профилю» и темп 0 не уходят', () => {
    expect(settingsBody(DEFAULT_SETTINGS)).toEqual({
      comprehensibility_max: 0.15, target_coverage: 0.95, daily_listening_budget_min: 120, daily_new_words: 20,
    })
    expect(settingsBody(setKids(DEFAULT_SETTINGS, 55))).toMatchObject({ min_r_clean_override: 0.55 })
    expect(settingsBody(setKids(DEFAULT_SETTINGS, 0))).toMatchObject({ min_r_clean_override: 0 })
    expect('min_r_clean_override' in settingsBody(DEFAULT_SETTINGS)).toBe(false)
    // темп: сборка держит ручку выключенной, и даже включённая не шлёт ноль
    const t = { ...DEFAULT_SETTINGS, tempo: 20 }
    expect('tempo_over_goal_wpm' in settingsBody(t)).toBe(false)
    expect(settingsBody(t, true)).toMatchObject({ tempo_over_goal_wpm: 20 })
    expect('tempo_over_goal_wpm' in settingsBody({ ...t, tempo: 0 }, true)).toBe(false)
  })

  it('хранение: возврат пользователя видит прежние значения; испорченное и бросающее хранилище — умолчания', () => {
    saveSettings(setField(DEFAULT_SETTINGS, 'minutes', 200))
    expect(loadSettings()).toMatchObject({ presetId: 'custom', minutes: 200 })
    saveSettings(applyPreset(DEFAULT_SETTINGS, 'comfort'))
    expect(loadSettings().presetId).toBe('comfort')
    localStorage.setItem(SETTINGS_KEY, '{oops')
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ gatePct: 'x', minutes: 1e9, kidsPct: 'y' }))
    expect(loadSettings()).toMatchObject({ gatePct: 15, minutes: 540, kidsPct: null })
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } })
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
    expect(savedDayTransition()).toBe(240)
    expect(() => saveSettings(DEFAULT_SETTINGS)).not.toThrow()
    vi.unstubAllGlobals()
  })
})

describe('смена учебного дня', () => {
  beforeEach(() => localStorage.clear())
  it('forDate читает сохранённую смену: в 03:00 при смене 04:00 — вчера, при 02:00 — сегодня', () => {
    const at = new Date('2026-11-18T03:00:00')
    expect(forDate(null, at)).toBe('2026-11-17')
    localStorage.setItem(DAY_TRANSITION_KEY, String(2 * 60))
    expect(forDate(null, at)).toBe('2026-11-18')
    localStorage.setItem(DAY_TRANSITION_KEY, 'junk')
    expect(forDate(null, at)).toBe('2026-11-17')
  })
})

describe('экран старта', () => {
  let bff: FakeRouteBFF
  beforeEach(() => {
    __resetSessionForTests(); __resetRouteStateForTests(); __resetRouteOutboxForTests()
    localStorage.clear()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(`${TODAY}T12:00:00`))
    bff = new FakeRouteBFF()
    bff.state = st(null, { started: false, route_id: null, revision: 0, started_at: null })
    bff.goals = [FRIENDS] as typeof bff.goals
    vi.stubGlobal('fetch', vi.fn((u: string, i?: RequestInit) => bff.fetch(u, i)))
    __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_abcd', routeAllowed: true, demo: false })
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); __resetRouteOutboxForTests() })

  async function open() {
    renderRoutePage(bff)
    await screen.findByText(fullText('Давайте установим Ваш реальный уровень'))
    await screen.findByRole('button', { name: 'Friends' })
  }
  const block = () => screen.getByTestId('route-start-settings')
  const chip = (name: string) => within(block()).getByRole('button', { name: new RegExp(name) })
  const slider = (label: string) => within(block()).getByLabelText(label) as HTMLInputElement
  const move = (label: string, v: number) => fireEvent.change(slider(label), { target: { value: String(v) } })
  const start = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Friends' }))
    fireEvent.click(screen.getByRole('button', { name: 'Начать маршрут' }))
    await waitFor(() => expect(bff.of('/api/me/route/quick-start', 'POST').length).toBe(1))
    return bff.of('/api/me/route/quick-start', 'POST')[0].body as Record<string, unknown>
  }

  it('блок стоит перед «Начать маршрут»; три чипа, «Сбалансированно» выбран; тонкая настройка свёрнута', async () => {
    await open()
    expect(block().compareDocumentPosition(document.querySelector('.st-bar') as Element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(chip('Комфортно').textContent).toContain('60 мин в день · 15 новых слов')
    expect(chip('Сбалансированно').getAttribute('aria-pressed')).toBe('true')
    expect(chip('Быстрее к цели').textContent).toContain('180 мин в день · 30 новых слов')
    expect((block().querySelector('details') as HTMLDetailsElement).open).toBe(false)
    // источников и «Речь быстрее цели» нет: маршрут сайта — только YouTube, темп скрыт константой
    expect(within(block()).queryByText('Источники')).toBeNull()
    expect(within(block()).queryByText('Речь быстрее цели')).toBeNull()
  })

  it('пресет «Быстрее к цели» ставит ползунки; ползунок снимает пресет; детский уровень пресет не трогает', async () => {
    await open()
    fireEvent.click(chip('Быстрее к цели'))
    expect(chip('Быстрее к цели').getAttribute('aria-pressed')).toBe('true')
    expect(slider('Незнакомого в уроке').value).toBe('30')
    expect(slider('Насколько закрываем цель').value).toBe('95')
    expect(slider('Минут в день').value).toBe('180')
    expect(slider('Новых слов в день').value).toBe('30')
    move('Детский уровень', 40)
    expect(chip('Быстрее к цели').getAttribute('aria-pressed')).toBe('true')
    move('Минут в день', 90)
    for (const n of ['Комфортно', 'Сбалансированно', 'Быстрее к цели']) expect(chip(n).getAttribute('aria-pressed')).toBe('false')
  })

  it('предупреждение о покрытии — только выше 99 % (то есть при 100)', async () => {
    await open()
    move('Насколько закрываем цель', 90)
    expect(within(block()).queryByText(/Последние проценты цели/)).toBeNull()
    move('Насколько закрываем цель', 95)
    expect(within(block()).queryByText(/Последние проценты цели/)).toBeNull()
    move('Насколько закрываем цель', 100)
    expect(within(block()).getByText(/Последние проценты цели/)).toBeTruthy()
  })

  it('быстрый старт без правок несёт значения «Сбалансированно» и не несёт детский уровень и темп', async () => {
    await open()
    const body = await start()
    expect(body).toMatchObject({ comprehensibility_max: 0.15, target_coverage: 0.95, daily_listening_budget_min: 120, daily_new_words: 20 })
    expect('min_r_clean_override' in body).toBe(false)
    expect('tempo_over_goal_wpm' in body).toBe(false)
  })

  it('быстрый старт несёт ровно выбранные значения; «по профилю» возвращает ключ в «не задан»', async () => {
    await open()
    move('Незнакомого в уроке', 25)
    move('Насколько закрываем цель', 95)
    move('Минут в день', 45)
    move('Новых слов в день', 7)
    move('Детский уровень', 60)
    expect(within(block()).getByText('60 из 70')).toBeTruthy()
    fireEvent.click(within(block()).getByRole('button', { name: 'вернуть по профилю' }))
    expect(within(block()).getAllByText('по профилю').length).toBeGreaterThan(0)
    move('Детский уровень', 30)
    const body = await start()
    expect(body).toMatchObject({
      comprehensibility_max: 0.25, target_coverage: 0.95, daily_listening_budget_min: 45, daily_new_words: 7, min_r_clean_override: 0.3,
    })
  })

  it('смена учебного дня: for_date считается по сохранённому часу, значение живёт между визитами', async () => {
    vi.setSystemTime(new Date(`${TODAY}T03:00:00`))
    await open()
    fireEvent.change(within(block()).getByLabelText('Смена учебного дня'), { target: { value: '02:00' } })
    expect(localStorage.getItem(DAY_TRANSITION_KEY)).toBe('120')
    const body = await start()
    expect(body.for_date).toBe(TODAY)
  })

  it('по умолчанию в 03:00 for_date — вчерашний учебный день (04:00)', async () => {
    vi.setSystemTime(new Date(`${TODAY}T03:00:00`))
    await open()
    const body = await start()
    expect(body.for_date).toBe('2026-11-17')
  })

  it('возвращающийся пользователь видит прошлые значения', async () => {
    saveSettings(setField(DEFAULT_SETTINGS, 'minutes', 200))
    await open()
    expect(slider('Минут в день').value).toBe('200')
    for (const n of ['Комфортно', 'Сбалансированно', 'Быстрее к цели']) expect(chip(n).getAttribute('aria-pressed')).toBe('false')
  })
})
