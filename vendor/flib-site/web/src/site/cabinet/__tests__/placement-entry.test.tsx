// placement-entry.test.tsx — входы в тест уровня (спека §4 «Входы»): карточка на Главной, старт маршрута
// (предложение / результат теста / принудительное применение / 409 placement_not_applied), кнопка «Мои знания».
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { CabinetLayout } from '../CabinetLayout'
import { CabinetHome } from '../CabinetHome'
import { KnowledgePage } from '../knowledge/KnowledgePage'
import { __resetSessionForTests, __setSessionForTests } from '../../session'
import { __resetRouteStateForTests } from '../route/use-route-state'
import { __resetRouteOutboxForTests } from '../route/outbox'
import { __resetPlacementCacheForTests } from '../placement/use-placement'
import { openSiteHost } from '../placement/site-host'
import { finishRun, startRun, type RunOutcome } from '../placement/store'
import { fakeServer, json, type FakeServer } from '../placement/__fixtures__/fake-server'
import { fakeLocks } from '../placement/__fixtures__/fake-locks'
import { setCabinetMarker } from '../../__tests__/cabinet-marker'
import { QuickStart } from '../route/QuickStart'
import { FakeRouteBFF, renderRoutePage, setRouteMarker, st, fullText } from '../route/__tests__/route-page-fakes'

const RUN = 'pt-aaaa-0000000000000001'
const T0 = Date.parse('2026-11-25T12:00:00Z')
const LATER = (owner: string) => `flib:placement-later:v1:${owner}`
const QS = '/api/me/route/quick-start'
const APPLY = '/api/me/placement/apply'
const OK_JOB = { job_id: '33333333-3333-4333-8333-333333333333', revision: 1 }
const FAIL_TEXT = 'Не удалось передать слова теста маршруту. Попробуйте ещё раз или укажите уровень самому'

let server: FakeServer
let bff: FakeRouteBFF

const outcome = (level: 'A1' | 'A2' | 'B1+', flags: string[] = []): RunOutcome => ({
  level, vocab_size: 2100, ci90: [1800, 2400], listening_offset: 0, flags,
  words: [{ lemma: 'dog', p: 0.9, rank: 5, cefrj: 1 }, { lemma: 'owl', p: 0.7, rank: 900, cefrj: 2, s3: 1 }],
})

/** Принятый результат в файле ключа (как после финиша теста). */
async function seed(level: 'A1' | 'A2' | 'B1+' = 'A2', flags: string[] = []) {
  const h = await openSiteHost({ apiDeps: { fetch: server.fetch }, storage: localStorage, locks: fakeLocks() })
  const s = await startRun(h, { prior: 'school', bankVersion: 'v', runId: RUN, now: () => T0 })
  await finishRun(h, s, outcome(level, flags), { now: () => T0 + 1000 })
  h.dispose()
  await new Promise((r) => setTimeout(r, 0))
  server.calls.length = 0
}

beforeEach(() => {
  __resetSessionForTests(); __resetRouteStateForTests(); __resetRouteOutboxForTests(); __resetPlacementCacheForTests()
  localStorage.clear()
  server = fakeServer()
  bff = new FakeRouteBFF()
  bff.state = st(null, { started: false, route_id: null, revision: 0, started_at: null })
  vi.stubGlobal('fetch', vi.fn((u: string, i?: RequestInit) => (String(u).startsWith('/api/me/placement') ? server.fetch(String(u), i) : bff.fetch(u, i))))
  setCabinetMarker(true); setRouteMarker(true)
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo
  __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_abcd', routeAllowed: true, demo: false })
})
afterEach(() => {
  cleanup(); vi.unstubAllGlobals(); setCabinetMarker(false); setRouteMarker(false)
  __resetRouteOutboxForTests(); __resetSessionForTests(); __resetPlacementCacheForTests()
})

const summaryCalls = () => server.callsTo('GET', '/api/me/placement/summary')

// ---------------------------------------------------------------- Главная

function renderHome() {
  return render(
    <MemoryRouter initialEntries={['/app']}>
      <Routes><Route path="/app" element={<CabinetLayout />}><Route index element={<CabinetHome />} /></Route></Routes>
    </MemoryRouter>,
  )
}

describe('Главная', () => {
  it('нет результата — карточка с текстом спеки и кнопками; она первая под приветствием, до home-grid', async () => {
    renderHome()
    const card = await screen.findByTestId('home-placement')
    expect(card.querySelector('h2')?.textContent).toBe('Давайте установим Ваш реальный уровень')
    expect(card.querySelector('p')?.textContent).toBe('Около 5 минут: Вы слушаете слова и отвечаете, знаете ли их. Маршрут не будет тратить время на то, что Вы уже знаете.')
    expect(within(card).getByRole('link', { name: 'Пройти тест' }).getAttribute('href')).toBe('/app/test')
    expect(within(card).getByRole('button', { name: 'Позже' })).toBeTruthy()
    const grid = document.querySelector('.home-grid') as HTMLElement
    expect(card.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(summaryCalls()).toHaveLength(1)
  })

  it('«Позже» прячет карточку только для этого ключа и переживает перезагрузку', async () => {
    const a = renderHome()
    fireEvent.click(within(await screen.findByTestId('home-placement')).getByRole('button', { name: 'Позже' }))
    expect(screen.queryByTestId('home-placement')).toBeNull()
    expect(localStorage.getItem(LATER(server.owner))).not.toBeNull()
    a.unmount(); __resetPlacementCacheForTests()
    renderHome()
    await screen.findByTestId('home-today')
    await waitFor(() => expect(summaryCalls()).toHaveLength(2))
    expect(screen.queryByTestId('home-placement')).toBeNull()
    // другой ключ (другой owner) — карточка снова есть
    cleanup(); __resetPlacementCacheForTests()
    localStorage.clear()
    localStorage.setItem(LATER('ffffffffffffffff'), '1')
    renderHome()
    await screen.findByTestId('home-placement')
  })

  it('есть результат или незаконченный на сервере прогон — карточки нет', async () => {
    await seed()
    renderHome()
    await screen.findByTestId('home-today')
    await waitFor(() => expect(summaryCalls().length).toBeGreaterThan(0))
    expect(screen.queryByTestId('home-placement')).toBeNull()
    cleanup(); __resetPlacementCacheForTests()
    server.items = { 'docs:pt_pending/pt-bbbb-0000000000000002': { x: 1 } }
    renderHome()
    await screen.findByTestId('home-today')
    await waitFor(() => expect(summaryCalls().length).toBeGreaterThan(1))
    expect(screen.queryByTestId('home-placement')).toBeNull()
  })

  it('незаконченный прогон на этом устройстве — «Продолжить тест»', async () => {
    localStorage.setItem(`flib:placement:v1:${server.owner}:pt.session`, JSON.stringify({ v: 1, run_id: RUN, updated_at: new Date().toISOString() }))
    renderHome()
    const card = await screen.findByTestId('home-placement')
    expect(within(card).getByRole('link', { name: 'Продолжить тест' })).toBeTruthy()
  })

  it('сбой сводки — нет карточки и нет ошибки; остальная Главная работает', async () => {
    server.once('GET', '/api/me/placement/summary', json(500, { error: 'boom' }))
    renderHome()
    await screen.findByTestId('home-today')
    await waitFor(() => expect(summaryCalls()).toHaveLength(1))
    expect(screen.queryByTestId('home-placement')).toBeNull()
    expect(document.querySelector('[role="alert"]')).toBeNull()
  })

  it('без метки маршрута сводка не запрашивается вовсе', async () => {
    setRouteMarker(false)
    renderHome()
    await screen.findByText('Здравствуйте!')
    expect(summaryCalls()).toHaveLength(0)
    expect(screen.queryByTestId('home-placement')).toBeNull()
  })
})

// ---------------------------------------------------------------- Старт маршрута

const openStart = async () => {
  renderRoutePage(bff)
  await screen.findByText(fullText('Давайте установим Ваш реальный уровень'))
  await screen.findByRole('button', { name: 'Friends' })
}
const pickGoalAndGo = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Friends' }))
  fireEvent.click(screen.getByRole('button', { name: 'Начать маршрут' }))
}
const qsBodies = () => bff.of(QS, 'POST').map(c => c.body as Record<string, unknown>)

describe('Старт маршрута', () => {
  it('без результата: предложение со ссылкой, «Скоро: тест уровня» нет, радиогруппа на месте', async () => {
    await openStart()
    const offer = await screen.findByTestId('st-placement-offer')
    expect(offer.textContent).toContain('Не знаете свой уровень? Пройдите тест — около 5 минут.')
    expect(within(offer).getByRole('link', { name: 'Пройти тест' }).getAttribute('href')).toBe('/app/test')
    expect(screen.queryByText(/Скоро: тест уровня/)).toBeNull()
    expect(screen.getByRole('radiogroup', { name: 'Уровень' })).toBeTruthy()
  })

  it('сбой сводки: ни предложения, ни ошибки, радиогруппа как раньше', async () => {
    server.once('GET', '/api/me/placement/summary', json(503, { error: 'x' }))
    await openStart()
    await waitFor(() => expect(summaryCalls()).toHaveLength(1))
    expect(screen.queryByTestId('st-placement-offer')).toBeNull()
    expect(screen.getByRole('radiogroup', { name: 'Уровень' })).toBeTruthy()
  })

  it('годный результат применён: карточка вместо радиогруппы; старт — as_is, B1+ → B1, без вопроса keep/replace', async () => {
    await seed('B1+'); server.applied = RUN
    bff.quickStartReply = () => json(202, OK_JOB)
    await openStart()
    const res = await screen.findByTestId('st-placement-result')
    expect(res.textContent).toContain('По тесту от 25.11.2026: B1+, примерно 2 100 слов')
    expect(screen.queryByRole('radiogroup', { name: 'Уровень' })).toBeNull()
    await pickGoalAndGo()
    await waitFor(() => expect(qsBodies()).toHaveLength(1))
    expect(qsBodies()[0]).toMatchObject({ known_words: 'as_is', cefr_level: 'B1' })
    expect(server.callsTo('POST', APPLY)).toHaveLength(0)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('не применён: сначала apply (хост без замка вкладки, force), потом старт', async () => {
    await seed('A2')
    // другая вкладка теста держит замок — старту он не нужен
    vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { locks: { request: (_n: string, a: unknown, b?: (l: unknown) => unknown) => {
      // с ifAvailable (замок теста) — занято; обычный запрос (outbox) — выдаётся
      const cb = (typeof a === 'function' ? a : b) as (l: unknown) => unknown
      const busy = typeof a === 'object' && a !== null && (a as { ifAvailable?: boolean }).ifAvailable === true
      return Promise.resolve(busy ? cb(null) : cb({}))
    } } }))
    bff.quickStartReply = () => json(202, OK_JOB)
    await openStart()
    await screen.findByTestId('st-placement-result')
    await pickGoalAndGo()
    await waitFor(() => expect(qsBodies()).toHaveLength(1))
    expect(server.callsTo('POST', APPLY)).toHaveLength(1)
    expect(server.applied).toBe(RUN)
    expect(qsBodies()[0]).toMatchObject({ known_words: 'as_is', cefr_level: 'A2' })
  })

  it('apply не удался — старта нет, видимая ошибка; повтор снова применяет', async () => {
    await seed('A2')
    server.once('POST', APPLY, json(500, { error: 'x' }))
    bff.quickStartReply = () => json(202, OK_JOB)
    await openStart()
    await screen.findByTestId('st-placement-result')
    await pickGoalAndGo()
    await screen.findByText(FAIL_TEXT)
    expect(qsBodies()).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Попробовать снова' }))
    await waitFor(() => expect(qsBodies()).toHaveLength(1))
  })

  it('declined: результат показан; выбор = apply с force, затем as_is', async () => {
    await seed('A2'); server.declined = RUN
    bff.quickStartReply = () => json(202, OK_JOB)
    await openStart()
    await screen.findByTestId('st-placement-result')
    await pickGoalAndGo()
    await waitFor(() => expect(qsBodies()).toHaveLength(1))
    expect(server.callsTo('POST', APPLY)).toHaveLength(1)
    expect(qsBodies()[0]).toMatchObject({ known_words: 'as_is' })
  })

  it('409 placement_not_applied → один принудительный apply и один повтор; второй 409 — видимая ошибка', async () => {
    await seed('A2'); server.applied = RUN
    let n = 0
    bff.quickStartReply = () => (++n === 1 ? json(409, { error: 'placement_not_applied' }) : json(202, OK_JOB))
    await openStart()
    await screen.findByTestId('st-placement-result')
    await pickGoalAndGo()
    await waitFor(() => expect(qsBodies()).toHaveLength(2))
    expect(server.callsTo('POST', APPLY)).toHaveLength(1)
    cleanup(); __resetPlacementCacheForTests(); bff.calls.length = 0; server.calls.length = 0
    bff.quickStartReply = () => json(409, { error: 'placement_not_applied' })
    await openStart()
    await screen.findByTestId('st-placement-result')
    await pickGoalAndGo()
    await screen.findByText(FAIL_TEXT)
    expect(qsBodies()).toHaveLength(2)
    expect(server.callsTo('POST', APPLY)).toHaveLength(1)
  })

  it('кнопка не даёт запустить дважды, пока идёт apply («Запускаем»)', async () => {
    await seed('A2')
    let release: (r: Response) => void = () => {}
    server.once('POST', APPLY, () => new Promise<Response>(res => { release = res }))
    bff.quickStartReply = () => json(202, OK_JOB)
    await openStart()
    await screen.findByTestId('st-placement-result')
    await pickGoalAndGo()
    const go = await screen.findByRole('button', { name: /Запускаем/ }) as HTMLButtonElement
    expect(go.disabled).toBe(true)
    fireEvent.submit(document.querySelector('form') as HTMLFormElement)
    release(json(200, { counted: 2 }))
    await waitFor(() => expect(qsBodies()).toHaveLength(1))
    expect(server.callsTo('POST', APPLY)).toHaveLength(1)
  })

  it('«Указать уровень самому» возвращает прежнее поведение, включая вопрос keep/replace; «Вернуться к результату теста» — обратно', async () => {
    await seed('A2'); server.applied = RUN
    let n = 0
    bff.quickStartReply = () => (++n === 1 ? json(409, { error: 'profile_has_words' }) : json(202, OK_JOB))
    await openStart()
    await screen.findByTestId('st-placement-result')
    fireEvent.click(screen.getByRole('button', { name: 'Указать уровень самому' }))
    expect(screen.queryByTestId('st-placement-result')).toBeNull()
    const radios = within(screen.getByRole('radiogroup', { name: 'Уровень' })).getAllByRole('radio')
    expect(radios).toHaveLength(5)
    fireEvent.click(screen.getByRole('radio', { name: /^B2/ }))
    await pickGoalAndGo()
    await screen.findByText('У этого ключа уже сохранён список слов, которые Вы знаете. Оставить его или заменить словами уровня B2?')
    fireEvent.click(screen.getByRole('button', { name: 'Заменить' }))
    await waitFor(() => expect(qsBodies()).toHaveLength(2))
    expect(qsBodies()[1]).toMatchObject({ known_words: 'replace', cefr_level: 'B2' })
    expect(qsBodies()[0].known_words).toBeUndefined()
    expect(server.callsTo('POST', APPLY)).toHaveLength(0)
    cleanup(); __resetPlacementCacheForTests()
    await openStart()
    await screen.findByTestId('st-placement-result')
    fireEvent.click(screen.getByRole('button', { name: 'Указать уровень самому' }))
    fireEvent.click(screen.getByRole('button', { name: 'Вернуться к результату теста' }))
    expect(screen.getByTestId('st-placement-result')).toBeTruthy()
    expect(screen.queryByRole('radiogroup', { name: 'Уровень' })).toBeNull()
  })

  it('невалидный (yeasayer, careless) результат — обычный выбор уровня и предложение пройти заново', async () => {
    for (const f of ['yeasayer', 'careless']) {
      cleanup(); __resetPlacementCacheForTests(); server = fakeServer(); await seed('B1+', [f])
      await openStart()
      await screen.findByTestId('st-placement-offer')
      expect(screen.queryByTestId('st-placement-result')).toBeNull()
      const radios = within(screen.getByRole('radiogroup', { name: 'Уровень' })).getAllByRole('radio')
      expect(radios.find(r => r.getAttribute('aria-checked') === 'true')?.textContent).toMatch(/^A2/)
    }
  })

  it('пустой (floor) результат — обычный выбор, A1 предвыбран', async () => {
    // настоящий floor-прогон: 50 слов и флаг floor
    const words = Array.from({ length: 50 }, (_, i) => ({ lemma: `w${i}`, p: 0.1, rank: i + 1, cefrj: 1 }))
    server.items = { 'docs:pt_results/last': { run_id: RUN, level: 'A1', taken_at: new Date(T0).toISOString(), flags: ['floor'], words } }
    await openStart()
    await screen.findByTestId('st-placement-offer')
    await waitFor(() => {
      const radios = within(screen.getByRole('radiogroup', { name: 'Уровень' })).getAllByRole('radio')
      expect(radios.find(r => r.getAttribute('aria-checked') === 'true')?.textContent).toMatch(/^A1/)
    })
  })

  it('начатый маршрут: страница маршрута ничем не блокируется (экран старта не показывается)', async () => {
    await seed('A2')
    bff.state = st(null)
    renderRoutePage(bff)
    await waitFor(() => expect(bff.stateGets).toBeGreaterThan(0))
    expect(screen.queryByTestId('st-placement-offer')).toBeNull()
    expect(screen.queryByText('Не удалось передать слова теста маршруту. Попробуйте ещё раз или укажите уровень самому')).toBeNull()
  })
})

// Сводка, пришедшая позже (задержанный ответ), — как в медленной сети.
function delaySummary(): () => Promise<void> {
  let release: (r: Response) => void = () => {}
  server.once('GET', '/api/me/placement/summary', () => new Promise<Response>(res => { release = res }))
  return async () => { release(await server.fetch('/api/me/placement/summary')) }
}
const selectedLevel = () => within(screen.getByRole('radiogroup', { name: 'Уровень' })).getAllByRole('radio').find(r => r.getAttribute('aria-checked') === 'true')?.textContent ?? ''

describe('Старт маршрута: выбор человека сильнее результата', () => {
  it('сводка пришла при открытом вопросе «Оставить / Заменить»: остаёмся в выборе человека; «Заменить» — replace и уровень из выбора, без apply', async () => {
    await seed('B1+')
    const arrive = delaySummary()
    let n = 0
    bff.quickStartReply = () => (++n === 1 ? json(409, { error: 'profile_has_words' }) : json(202, OK_JOB))
    await openStart()
    await pickGoalAndGo()
    await screen.findByText(/У этого ключа уже сохранён список слов/)
    await arrive()
    await waitFor(() => expect(summaryCalls().length).toBeGreaterThan(0))
    expect(screen.queryByTestId('st-placement-result')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Вернуться к результату теста' })).toBeNull() // пока открыт вопрос — ссылки нет
    fireEvent.click(screen.getByRole('button', { name: 'Заменить' }))
    await waitFor(() => expect(qsBodies()).toHaveLength(2))
    expect(qsBodies()[1]).toMatchObject({ known_words: 'replace', cefr_level: 'A2' })
    expect(server.callsTo('POST', APPLY)).toHaveLength(0)
  })

  it('«Оставить» — keep и выбранный уровень, не as_is', async () => {
    await seed('A1'); server.applied = RUN
    const arrive = delaySummary()
    let n = 0
    bff.quickStartReply = () => (++n === 1 ? json(409, { error: 'profile_has_words' }) : json(202, OK_JOB))
    await openStart()
    await pickGoalAndGo()
    await screen.findByText(/У этого ключа уже сохранён список слов/)
    await arrive()
    await waitFor(() => expect(summaryCalls().length).toBeGreaterThan(0))
    fireEvent.click(screen.getByRole('button', { name: 'Оставить мой список' }))
    await waitFor(() => expect(qsBodies()).toHaveLength(2))
    expect(qsBodies()[1]).toMatchObject({ known_words: 'keep', cefr_level: 'A2' })
  })

  it('уровень выбран до прихода сводки: выбор остаётся (радиогруппа, B2), результат не перехватывает экран', async () => {
    await seed('A1')
    const arrive = delaySummary()
    bff.quickStartReply = () => json(202, OK_JOB)
    await openStart()
    fireEvent.click(screen.getByRole('radio', { name: /^B2/ }))
    await arrive()
    await screen.findByRole('button', { name: 'Вернуться к результату теста' })
    expect(screen.queryByTestId('st-placement-result')).toBeNull()
    expect(selectedLevel()).toMatch(/^B2/)
    await pickGoalAndGo()
    await waitFor(() => expect(qsBodies()).toHaveLength(1))
    expect(qsBodies()[0]).toMatchObject({ cefr_level: 'B2' })
    expect(qsBodies()[0].known_words).toBeUndefined()
    expect(server.callsTo('POST', APPLY)).toHaveLength(0)
  })

  it('floor-результат не сбивает уже выбранный человеком уровень', async () => {
    const words = Array.from({ length: 50 }, (_, i) => ({ lemma: `w${i}`, p: 0.1, rank: i + 1, cefrj: 1 }))
    server.items = { 'docs:pt_results/last': { run_id: RUN, level: 'A1', taken_at: new Date(T0).toISOString(), flags: ['floor'], words } }
    const arrive = delaySummary()
    await openStart()
    fireEvent.click(screen.getByRole('radio', { name: /^B2/ }))
    await arrive()
    await screen.findByTestId('st-placement-offer')
    expect(selectedLevel()).toMatch(/^B2/)
  })

  it('сбой apply и перечитывания: результат теста остаётся, «Попробовать снова» снова шлёт as_is', async () => {
    await seed('A2')
    bff.quickStartReply = () => json(202, OK_JOB)
    await openStart()
    await screen.findByTestId('st-placement-result')
    server.once('GET', '/api/me/placement/summary', json(503, { error: 'x' }))
    server.once('POST', APPLY, json(503, { error: 'x' }))
    const before = summaryCalls().length
    await pickGoalAndGo()
    await screen.findByText(FAIL_TEXT)
    await waitFor(() => expect(summaryCalls().length).toBeGreaterThan(before))
    expect(screen.getByTestId('st-placement-result')).toBeTruthy()
    expect(screen.queryByRole('radiogroup', { name: 'Уровень' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Попробовать снова' }))
    await waitFor(() => expect(qsBodies()).toHaveLength(1))
    expect(qsBodies()[0]).toMatchObject({ known_words: 'as_is', cefr_level: 'A2' })
  })

  it('результат пришёл, пока шёл первый запрос, и ответ — profile_has_words: экран остаётся в выборе человека, ссылки «Вернуться» при вопросе нет', async () => {
    await seed('B1+')
    const arrive = delaySummary()
    let releaseQs: (r: Response) => void = () => {}
    let n = 0
    bff.quickStartReply = () => (++n === 1 ? new Promise<Response>(res => { releaseQs = res }) : json(202, OK_JOB))
    await openStart()
    await pickGoalAndGo()
    await waitFor(() => expect(qsBodies()).toHaveLength(1))
    await arrive()
    await screen.findByTestId('st-placement-result') // пока запрос идёт, экран показывает результат
    releaseQs(json(409, { error: 'profile_has_words' }))
    await screen.findByText(/У этого ключа уже сохранён список слов/)
    expect(screen.queryByTestId('st-placement-result')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Вернуться к результату теста' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Заменить' }))
    await waitFor(() => expect(qsBodies()).toHaveLength(2))
    expect(qsBodies()[1]).toMatchObject({ known_words: 'replace', cefr_level: 'A2' })
  })

  it('floor-результат, пришедший во время запроса, не меняет уровень под диалогом', async () => {
    const words = Array.from({ length: 50 }, (_, i) => ({ lemma: `w${i}`, p: 0.1, rank: i + 1, cefrj: 1 }))
    server.items = { 'docs:pt_results/last': { run_id: RUN, level: 'A1', taken_at: new Date(T0).toISOString(), flags: ['floor'], words } }
    const arrive = delaySummary()
    let releaseQs: (r: Response) => void = () => {}
    bff.quickStartReply = () => new Promise<Response>(res => { releaseQs = res })
    await openStart()
    await pickGoalAndGo()
    await waitFor(() => expect(qsBodies()).toHaveLength(1))
    await arrive()
    await screen.findByTestId('st-placement-offer')
    expect(selectedLevel()).toMatch(/^A2/)
    releaseQs(json(409, { error: 'profile_has_words' }))
    await screen.findByText('У этого ключа уже сохранён список слов, которые Вы знаете. Оставить его или заменить словами уровня A2?')
  })

  it('после старта сводка перечитывается (apply, declined)', async () => {
    await seed('A2')
    bff.quickStartReply = () => json(202, OK_JOB)
    await openStart()
    await screen.findByTestId('st-placement-result')
    const before = summaryCalls().length
    await pickGoalAndGo()
    await waitFor(() => expect(qsBodies()).toHaveLength(1))
    await waitFor(() => expect(summaryCalls().length).toBeGreaterThan(before))
  })
})

describe('QuickStart без ворот', () => {
  it('нет метки маршрута: ни запроса сводки, ни предложения, радиогруппа как раньше', async () => {
    setRouteMarker(false)
    render(<MemoryRouter><QuickStart onStarted={() => {}} onReread={() => {}} onPageError={() => {}} /></MemoryRouter>)
    await screen.findByRole('button', { name: 'Friends' })
    expect(summaryCalls()).toHaveLength(0)
    expect(screen.queryByTestId('st-placement-offer')).toBeNull()
    expect(screen.getByRole('radiogroup', { name: 'Уровень' })).toBeTruthy()
  })
})

// ---------------------------------------------------------------- Мои знания

describe('Мои знания', () => {
  const renderKn = () => render(<MemoryRouter><KnowledgePage /></MemoryRouter>)

  it('нет результата — «Пройти тест»', async () => {
    renderKn()
    const b = await screen.findByTestId('kn-placement')
    expect(b.textContent).toBe('Пройти тест')
    expect(b.getAttribute('href')).toBe('/app/test')
  })

  it('есть годный результат — «Тест уровня: A2, ≈ 2 100 слов»', async () => {
    await seed('A2')
    renderKn()
    const b = await screen.findByTestId('kn-placement')
    expect(b.textContent).toBe('Тест уровня: A2, ≈ 2 100 слов')
  })

  it('сбой сводки — кнопки нет, страница работает', async () => {
    server.once('GET', '/api/me/placement/summary', json(500, { error: 'x' }))
    renderKn()
    await screen.findByTestId('kn-tab-add')
    await waitFor(() => expect(summaryCalls()).toHaveLength(1))
    expect(screen.queryByTestId('kn-placement')).toBeNull()
  })
})
