// routes.test.tsx — router smoke: главная + воронка (Э1) + маршрут (Э2) + тест (Э4).
//
// App.tsx статически импортирует TestPage.tsx → math.ts → web/src/site/test/**
// (математика теста, пишется параллельным агентом того же этапа Э4 — см.
// docs/plan-2026-07-13-design-transfer.md). Пока эти файлы не появились на
// диске, ЛЮБОЙ тест, транзитивно импортирующий App.tsx, падает на
// резолве модуля — не только assertions про /test. Мок ниже перехватывает
// ../site/test-page/math ПОЛНОСТЬЮ (vi.mock с фабрикой не грузит реальный
// файл), так что остальные маршруты (/, /fork, /try, /import, /route)
// остаются зелёными независимо от математики. StartScreen (idx 'start')
// не зовёт ни одну из math-функций при монтировании — фабрике достаточно
// вернуть vi.fn()-заглушки, реальные значения тут не нужны.
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { App } from '../../App'
import { __resetSessionForTests } from '../session'
import { setCabinetMarker } from './cabinet-marker'

vi.mock('../test-page/math', () => ({
  priorFromSurvey: vi.fn(),
  AuralEngine: class { next() { return null }; answer() {}; done = true; result() { return null } },
  scoreDictSentence: vi.fn(),
  estimateDecoding: vi.fn(),
  scoreEISentence: vi.fn(),
  estimateEI: vi.fn(),
  synthesize: vi.fn(),
  topNWords: vi.fn(),
  DICTATION_SENTENCES: [],
  EI_SENTENCES: [],
  sentenceText: () => '',
  vocabSigmaFromCi90: () => 0,
}))

describe('routes (router smoke)', () => {
  it('/extension renders ExtensionPage', () => {
    const { getByRole } = render(<MemoryRouter initialEntries={['/extension']}><App /></MemoryRouter>)
    expect(getByRole('heading', { level: 1 }).textContent).toContain('Flib-club')
  })

  // «/» — лендинг со шлюза (BFF). SPA, загруженная прямо на «/» (как в этом
  // тесте: jsdom стартует с pathname "/"), не уходит на «/» снова — петли нет.
  it('/ served as SPA shows a link instead of reloading', () => {
    const { getByRole } = render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>)
    expect(getByRole('link', { name: 'Открыть главную страницу' })).toBeTruthy()
  })

  it('/buy и /order/:id — страницы покупки', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', { status: 502 }))))
    window.scrollTo = vi.fn()
    const buy = render(<MemoryRouter initialEntries={['/buy']}><App /></MemoryRouter>)
    expect(buy.getByRole('heading', { level: 1 }).textContent).toBe('Доступ к рекомендациям')
    buy.unmount()
    const order = render(<MemoryRouter initialEntries={['/order/not-an-id']}><App /></MemoryRouter>)
    expect(order.getByRole('heading', { level: 1 }).textContent).toBe('Заказ не найден')
    order.unmount()
    vi.unstubAllGlobals()
  })

  // Кабинет выключен (на BFF нет сессии — 404): прежнее окно, как на origin/main.
  // Окно выбирается по ответу GET /api/session, поэтому ждём его.
  it('/login shows the key login dialog', async () => {
    __resetSessionForTests()
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{"error":"not_found"}', { status: 404 }))))
    const { findByRole } = render(<MemoryRouter initialEntries={['/login']}><App /></MemoryRouter>)
    expect(await findByRole('heading', { name: 'Войти по ключу' })).toBeTruthy()
    vi.unstubAllGlobals()
    __resetSessionForTests()
  })

  // Кабинет (A8): /app — Главная при живой сессии; без сессии — на /login.
  it('/app с живой сессией — Главная кабинета; без сессии — окно входа', async () => {
    __resetSessionForTests()
    setCabinetMarker(true)
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo
    const active = { authenticated: true, state: 'active', cabinet: true, key_prefix: 'tpk_aaaa', demo: false, key_expires_at: null, shadowing: false, route_allowed: true }
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify(active), { status: 200 }))))
    const app = render(<MemoryRouter initialEntries={['/app']}><App /></MemoryRouter>)
    expect(await app.findByRole('heading', { name: 'Здравствуйте!' })).toBeTruthy()
    app.unmount()
    __resetSessionForTests()
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{"authenticated":false,"cabinet":true}', { status: 200 }))))
    const anon = render(<MemoryRouter initialEntries={['/app/route']}><App /></MemoryRouter>)
    expect(await anon.findByRole('heading', { name: 'Вход' })).toBeTruthy()
    anon.unmount()
    vi.unstubAllGlobals()
    __resetSessionForTests()
    setCabinetMarker(false)
  })

  it.each([
    ['/fork', 'Как быстро уточним Ваш уровень?'],
    ['/try', 'Три шага — и маршрут готов'],
    ['/import', 'Отдайте, что уже знаете'],
    ['/test', 'Оценка Вашего английского на слух'],
    // /route без сохранённого flib:route и без flib:pointA — empty-state (Э2).
    ['/route', 'Маршрута пока нет'],
  ])('%s renders its page with BrandMark', (path, title) => {
    const { getByRole, getByTitle } = render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>)
    expect(getByRole('heading', { level: 1 }).textContent).toBe(title)
    expect(getByTitle('На главную').getAttribute('href')).toBe('/')
  })
})
