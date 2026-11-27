// RoutePageCabinet.test.tsx — страница /app/route, состояния §4.3 и быстрый
// старт §4.4 (план B10a): тест на каждое состояние, тексты дословно, ни одного
// «шага»; временный сбой — только 502 gateway_unavailable / 503 / 502 без
// JSON-кода (отсчёт и автоповтор), отказ шлюза — без повтора; вопрос
// «Оставить / Заменить» и после гонки (409 profile_has_words на втором заходе).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { fireEvent, screen, waitFor, act, render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { __resetSessionForTests, __setSessionForTests } from '../../../session'
import { __resetRouteStateForTests } from '../use-route-state'
import { __resetRouteOutboxForTests } from '../../route/outbox'
import { FakeRouteBFF, json, renderRoutePage, st, del, und, setRouteMarker, TODAY, fullText } from './route-page-fakes'
import { CabinetRouteGate } from '../RoutePageCabinet'

let bff: FakeRouteBFF
beforeEach(() => {
  __resetSessionForTests(); __resetRouteStateForTests(); __resetRouteOutboxForTests()
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(`${TODAY}T12:00:00`))
  bff = new FakeRouteBFF()
  vi.stubGlobal('fetch', vi.fn((u: string, i?: RequestInit) => bff.fetch(u, i)))
  __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_abcd', routeAllowed: true, demo: false })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); setRouteMarker(false); __resetRouteOutboxForTests() })

const noSteps = () => expect(document.body.textContent ?? '').not.toMatch(/Шаг\s*\d+\s*из/)

describe('состояния страницы маршрута (§4.3)', () => {
  it('загрузка — скелет', () => {
    bff.state = () => new Promise<Response>(() => {})
    renderRoutePage(bff)
    expect(screen.getByTestId('route-skeleton')).toBeTruthy()
  })

  it('нет права маршрута у ключа (снимок сессии) — текст поддержки, запроса состояния нет', async () => {
    __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_abcd', routeAllowed: false })
    renderRoutePage(bff)
    await screen.findByText(fullText('Маршрут недоступен для этого ключа. Напишите в поддержку: @FliboosterHelpUser_bot'))
    expect(screen.getByRole('link', { name: '@FliboosterHelpUser_bot' }).getAttribute('href')).toBe('https://t.me/FliboosterHelpUser_bot')
    expect(bff.stateGets).toBe(0)
  })

  it('снимок «unknown» (шлюз недоступен) — не «нет права», а временный сбой по ответу состояния', async () => {
    __setSessionForTests({ cabinet: true, authenticated: true, state: 'unknown', keyPrefix: 'tpk_abcd', routeAllowed: false })
    bff.state = () => json(503, { error: 'gateway_unavailable' }, { 'Retry-After': '5' })
    renderRoutePage(bff)
    await screen.findByText(/Маршрут временно недоступен\. Повторим через/)
    expect(screen.queryByText(fullText(/^Маршрут недоступен для этого ключа/))).toBeNull()
  })

  it('403 route_forbidden — тот же экран', async () => {
    bff.state = () => json(403, { error: 'route_forbidden' })
    renderRoutePage(bff)
    await screen.findByText(fullText(/^Маршрут недоступен для этого ключа\./))
  })

  it('ключ истёк (403 key_expired): демо — «Продлите свой демо-ключ — маршрут сохранится» + «Продлить»; маршрут не показан', async () => {
    __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_abcd', routeAllowed: true, demo: true })
    bff.state = () => json(403, { error: 'key_expired' })
    renderRoutePage(bff)
    await screen.findByText('Продлите свой демо-ключ — маршрут сохранится')
    expect(screen.getByRole('link', { name: 'Продлить' }).getAttribute('href')).toBe('/buy#renew')
    expect(screen.queryByText(/Давайте установим/)).toBeNull()
  })

  it('ключ истёк, платный — «Срок действия ключа закончился» + «Продлить»', async () => {
    bff.state = () => json(403, { error: 'key_expired' })
    renderRoutePage(bff)
    await screen.findByText('Срок действия ключа закончился')
    expect(screen.getByRole('link', { name: 'Продлить' })).toBeTruthy()
  })

  it('снимок сессии «expired» — маршрут не запрашивается и не показывается', async () => {
    __setSessionForTests({ cabinet: true, authenticated: true, state: 'expired', keyPrefix: 'tpk_abcd', routeAllowed: false, demo: false })
    renderRoutePage(bff)
    await screen.findByText('Срок действия ключа закончился')
    expect(bff.stateGets).toBe(0)
  })

  it('временный сбой 503 + Retry-After 1 — «Маршрут временно недоступен. Повторим через 1 с», затем сам перечитывает', async () => {
    let n = 0
    bff.state = () => (++n === 1 ? json(503, { error: 'route_unavailable' }, { 'Retry-After': '1' }) : json(200, st([del(1)])))
    renderRoutePage(bff)
    await screen.findByText('Маршрут временно недоступен. Повторим через 1 с')
    await waitFor(() => expect(n).toBe(2), { timeout: 3000 })
    await screen.findByTestId('day-hero')
  })

  it('502 без JSON-кода (край Cloudflare) — тоже временный сбой', async () => {
    let n = 0
    bff.state = () => (++n === 1 ? new Response('<html>', { status: 502, headers: { 'Retry-After': '1' } }) : json(200, st([del(1)])))
    renderRoutePage(bff)
    await screen.findByText(/Маршрут временно недоступен\. Повторим через/)
    await waitFor(() => expect(n).toBe(2), { timeout: 3000 })
  })

  it('502 gateway_refused — «мы уже знаем о проблеме» + поддержка, без отсчёта и без повтора', async () => {
    bff.state = () => json(502, { error: 'gateway_refused' }, { 'Retry-After': '1' })
    renderRoutePage(bff)
    await screen.findByText('Маршрут временно недоступен, мы уже знаем о проблеме')
    expect(screen.getByRole('link', { name: '@FliboosterHelpUser_bot' })).toBeTruthy()
    expect(screen.queryByText(/Повторим через/)).toBeNull()
    await act(async () => { await new Promise(r => setTimeout(r, 1500)) })
    expect(bff.stateGets).toBe(1)
  })

  // Первый подбор (дня ещё нет) — экран «Подбираем ролики» дизайна 2026-11-19 §3b с его
  // плашкой; утверждённый текст спеки — у следующих подборов (quick-start-v2.test.tsx).
  it('подбор: есть active_exchange — экран подбора, опрос задания, по коммиту — день', async () => {
    bff.state = st(null, { active_exchange: { job_id: '44444444-4444-4444-8444-444444444444', status: 'processing', created_at: new Date().toISOString() } })
    bff.afterCommit = st([del(1), und()])
    renderRoutePage(bff)
    await screen.findByText('Первый подбор может занять до 2 минут. Страницу можно закрыть — маршрут будет ждать здесь.')
    await screen.findByTestId('day-hero')
    expect(bff.of('/api/me/route/jobs/44444444-4444-4444-8444-444444444444').length).toBeGreaterThan(0)
    noSteps()
  })

  it('зависший обмен (старше 10 мин) — «Подобрать заново» запускает новый обмен', async () => {
    const old = new Date(Date.now() - 11 * 60_000).toISOString()
    bff.state = st(null, { active_exchange: { job_id: '44444444-4444-4444-8444-444444444444', status: 'waiting', created_at: old } })
    renderRoutePage(bff)
    fireEvent.click(await screen.findByRole('button', { name: 'Подобрать заново' }))
    await waitFor(() => expect(bff.of('/api/me/route/exchange', 'POST').length).toBe(1))
    expect(bff.of('/api/me/route/exchange', 'POST')[0].body).toMatchObject({ want: 'next', for_date: TODAY })
  })

  it('начат, дня нет, обмена нет — «Не удалось подобрать ролики.»; «Попробовать ещё раз» — обмен next', async () => {
    bff.state = st(null)
    renderRoutePage(bff)
    await screen.findByText('Не удалось подобрать ролики.')
    fireEvent.click(screen.getByRole('button', { name: 'Попробовать ещё раз' }))
    await waitFor(() => expect(bff.of('/api/me/route/exchange', 'POST').length).toBe(1))
    expect(bff.of('/api/me/route/exchange', 'POST')[0].body).toMatchObject({ want: 'next', expected_revision: 5 })
  })

  it('«Сбросить и выбрать другую цель» — DELETE и экран старта', async () => {
    let n = 0
    bff.state = () => (++n === 1 ? json(200, st(null)) : json(200, st(null, { started: false, route_id: null })))
    renderRoutePage(bff)
    fireEvent.click(await screen.findByRole('button', { name: 'Сбросить и выбрать другую цель' }))
    await screen.findByText(fullText('Давайте установим Ваш реальный уровень'))
    expect(bff.of('/api/me/route', 'DELETE').length).toBe(1)
  })

  it('маршрут кончился (stop_reason goal, в дне нечего смотреть) — «Цель маршрута достигнута» + «Начать новый маршрут»', async () => {
    bff.state = st([del(1, { played: true })], { stop_reason: 'goal' })
    renderRoutePage(bff)
    await screen.findByText('Цель маршрута достигнута')
    expect(screen.getByRole('button', { name: 'Начать новый маршрут' })).toBeTruthy()
  })

  it('материал кончился (exhausted) — «Материал для этой цели закончился»', async () => {
    bff.state = st([del(1, { played: true })], { stop_reason: 'exhausted' })
    renderRoutePage(bff)
    await screen.findByText('Материал для этой цели закончился')
  })
})

describe('быстрый старт (§4.4)', () => {
  const notStarted = () => st(null, { started: false, route_id: null, revision: 0, started_at: null })

  it('заголовок, карточки, уровни A1…C1 без C2, ни одного «шага»', async () => {
    bff.state = notStarted()
    renderRoutePage(bff)
    await screen.findByText(fullText('Давайте установим Ваш реальный уровень'))
    // Старт v2 (дизайн 2026-11-19 §3a): блок «Быстрый старт» вместо трёх карточек,
    // «тест уровня» и «Мои знания» — строкой «Скоро: …»; уровни — радиогруппа.
    expect(screen.getByText('Быстрый старт')).toBeTruthy()
    expect(screen.queryByText('Скоро: тест уровня и загрузка Ваших слов')).toBeNull()
    for (const l of ['A1', 'A2', 'B1', 'B2', 'C1']) expect(screen.getByRole('radio', { name: new RegExp(`^${l}`) })).toBeTruthy()
    expect(screen.queryByRole('radio', { name: /^C2/ })).toBeNull()
    noSteps()
  })

  it('умолчания — из flib:pointA; отправка: cefr_level, goal по goalOf, for_date; 202 → подбор → день', async () => {
    localStorage.setItem('flib:pointA', JSON.stringify({ kind: 'cefr', level: 'B2', ageBand: 30, goals: [], savedAt: '2026-11-01', goalsV2: [{ type: 'youtube', videoId: 'dQw4w9WgXcQ', url: 'https://youtu.be/dQw4w9WgXcQ' }] }))
    let n = 0
    bff.state = () => (++n === 1 ? json(200, notStarted()) : json(200, st([del(1), und()])))
    renderRoutePage(bff)
    await screen.findByText(fullText('Давайте установим Ваш реальный уровень'))
    expect(screen.getByRole('radio', { name: /^B2/ }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Начать маршрут' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Начать без сбора слов' })) // платный с роликами: сначала сбор «Моих целей»
    await waitFor(() => expect(bff.of('/api/me/route/quick-start', 'POST').length).toBe(1))
    expect(bff.of('/api/me/route/quick-start', 'POST')[0].body).toEqual({
      cefr_level: 'B2', goal: { puzzle_ids: ['youtube::dQw4w9WgXcQ'], label: 'Мои ролики (1)' }, for_date: TODAY,
      // «Настройки маршрута» по умолчанию (пресет «Сбалансированно»), без детского уровня и темпа
      comprehensibility_max: 0.15, target_coverage: 0.95, daily_listening_budget_min: 120, daily_new_words: 20,
    })
    await screen.findByTestId('day-hero')
  })

  // Решение владельца 2026-11-19: «Маршрут без цели не имеет смысла» — кнопка активна,
  // но без цели запроса нет, страница просит выбрать цель (подсказка, не ошибка).
  it('без цели «Начать маршрут» активна; нажатие — подсказка «Выберите хотя бы одну цель», запроса нет', async () => {
    bff.state = notStarted()
    renderRoutePage(bff)
    const b = await screen.findByRole('button', { name: 'Начать маршрут' })
    expect((b as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(b)
    await waitFor(() => expect(document.querySelector('.st-need-msg')?.textContent).toBe('Выберите хотя бы одну цель'))
    expect(bff.of('/api/me/route/quick-start', 'POST').length).toBe(0)
    fireEvent.click(await screen.findByRole('button', { name: 'Friends' }))
    expect(document.querySelector('.st-need-msg')).toBeNull()
  })

  it('409 profile_has_words — вопрос; «Оставить мой список» → повтор с known_words:"keep"', async () => {
    bff.state = notStarted()
    let n = 0
    bff.quickStartReply = () => (++n === 1 ? json(409, { error: 'profile_has_words' }) : json(202, { job_id: '33333333-3333-4333-8333-333333333333', revision: 1 }))
    renderRoutePage(bff)
    fireEvent.click(await screen.findByRole('button', { name: 'Friends' }))
    fireEvent.click(screen.getByRole('radio', { name: /^A2/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Начать маршрут' }))
    await screen.findByText('У этого ключа уже сохранён список слов, которые Вы знаете. Оставить его или заменить словами уровня A2?')
    fireEvent.click(screen.getByRole('button', { name: 'Оставить мой список' }))
    await waitFor(() => expect(bff.of('/api/me/route/quick-start', 'POST').length).toBe(2))
    expect(bff.of('/api/me/route/quick-start', 'POST')[1].body).toMatchObject({ known_words: 'keep', cefr_level: 'A2' })
  })

  it('гонка (C2): 409 profile_has_words после «Заменить» не бывает, но после неявного входа — тот же вопрос; «Заменить» → known_words:"replace"', async () => {
    bff.state = notStarted()
    let n = 0
    bff.quickStartReply = () => (++n <= 1 ? json(409, { error: 'profile_has_words' }) : json(202, { job_id: '33333333-3333-4333-8333-333333333333', revision: 1 }))
    renderRoutePage(bff)
    fireEvent.click(await screen.findByRole('button', { name: 'Friends' }))
    fireEvent.click(screen.getByRole('button', { name: 'Начать маршрут' }))
    await screen.findByText(/У этого ключа уже сохранён список слов/)
    fireEvent.click(screen.getByRole('button', { name: 'Заменить' }))
    await waitFor(() => expect(bff.of('/api/me/route/quick-start', 'POST').length).toBe(2))
    expect(bff.of('/api/me/route/quick-start', 'POST')[1].body).toMatchObject({ known_words: 'replace' })
  })

  it('400 goal_not_resolved — утверждённый текст', async () => {
    bff.state = notStarted()
    bff.quickStartReply = () => json(400, { error: 'goal_not_resolved' })
    renderRoutePage(bff)
    fireEvent.click(await screen.findByRole('button', { name: 'Friends' }))
    fireEvent.click(screen.getByRole('button', { name: 'Начать маршрут' }))
    await screen.findByText('Для этой цели пока нет материала — добавьте фильм, ролик или свои слова')
  })

  it('409 route_exists — страница перечитывает состояние (начат на другом устройстве)', async () => {
    let n = 0
    bff.state = () => (++n === 1 ? json(200, notStarted()) : json(200, st([del(1)])))
    bff.quickStartReply = () => json(409, { error: 'route_exists' })
    renderRoutePage(bff)
    fireEvent.click(await screen.findByRole('button', { name: 'Friends' }))
    fireEvent.click(screen.getByRole('button', { name: 'Начать маршрут' }))
    await screen.findByTestId('day-hero')
  })

  it('YouTube-ссылка добавляется целью; ссылка без id видео — не добавляется', async () => {
    bff.state = notStarted()
    renderRoutePage(bff)
    await screen.findByText(fullText('Давайте установим Ваш реальный уровень'))
    const inp = screen.getByLabelText('Ссылка на ролик YouTube') as HTMLInputElement
    const added = () => document.querySelectorAll('.yt-card').length
    fireEvent.change(inp, { target: { value: 'not a link' } })
    fireEvent.click(screen.getByRole('button', { name: 'Добавить ролик' }))
    expect(added()).toBe(0)
    expect(inp.closest('.inp')?.className).toContain('bad')
    fireEvent.change(inp, { target: { value: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Добавить ролик' }))
    expect(added()).toBe(1)
  })
})

describe('флаг маршрута выключен — «скоро», как до этапа 2', () => {
  it('без метки flib-route — CabinetSoon, ни одного запроса маршрута', () => {
    setRouteMarker(false)
    render(<MemoryRouter><div className="cab"><CabinetRouteGate /></div></MemoryRouter>)
    expect(screen.getByText('Скоро')).toBeTruthy()
    expect(bff.calls.length).toBe(0)
  })
  it('с меткой — страница маршрута', async () => {
    setRouteMarker(true)
    render(<MemoryRouter><div className="cab"><CabinetRouteGate /></div></MemoryRouter>)
    await screen.findByText(fullText('Давайте установим Ваш реальный уровень'))
  })
})
