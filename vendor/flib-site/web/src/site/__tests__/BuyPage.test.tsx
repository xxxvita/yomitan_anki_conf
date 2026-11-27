import { useEffect } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { BuyPage } from '../BuyPage'
import { monthsIn, perMonthKopecks } from '../billing-api'
import { leaked, spyStorageWrites, storageText } from './storage-probe'
import { track } from '../telemetry'
import { reportRouteNext } from '../ab-events'

// Отправители поведенческих событий сайта — шпионы: почта покупателя не должна
// уходить ни в один из них (см. блок «почта покупателя» ниже).
vi.mock('../telemetry', async (orig) => ({ ...(await orig<typeof import('../telemetry')>()), track: vi.fn() }))
vi.mock('../ab-events', () => ({ reportRouteNext: vi.fn() }))

// Почта покупателя — персональные данные. Регистр и пробелы — как ввёл бы человек.
const EMAIL = 'Buyer.Name@Example.com'

// Названия и цены — как на проде; в коде страницы их нет, только здесь.
const PRODUCTS = {
  products: [
    { id: 'month3', title: '3 месяца рекомендаций', price_kopecks: 420000, duration_days: 90, sort: 20 },
    { id: 'year1', title: '12 месяцев рекомендаций', price_kopecks: 1200000, duration_days: 365, sort: 30 },
    { id: 'month1', title: '1 месяц рекомендаций', price_kopecks: 150000, duration_days: 30, sort: 10 },
  ],
}
const ORDER_ID = '0b6f3c1e-8a2d-4c5b-9e7f-1a2b3c4d5e6f'
const PROMO_URL = '/api/billing/promo/check'

function res(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } }))
}

// fetch: витрина → products, проверка кода → promoResp, заказ → orderResp
// (функции, чтобы считать вызовы).
function stubFetch(orderResp: () => Promise<Response>, promoResp: () => Promise<Response> = () => res({ products: [] })) {
  const f = vi.fn((url: string) => {
    if (url === '/api/billing/products') return res(PRODUCTS)
    if (url === PROMO_URL) return promoResp()
    return orderResp()
  })
  vi.stubGlobal('fetch', f)
  return f
}

function card(title: string): HTMLElement {
  return screen.getByText(title).closest('[role="radio"]') as HTMLElement
}

function orderBody(f: ReturnType<typeof stubFetch>): Record<string, unknown> {
  const call = f.mock.calls.find(c => c[0] === '/api/billing/orders') as unknown as [string, RequestInit]
  return JSON.parse(String(call[1].body))
}

async function applyPromo(code: string) {
  await screen.findByText('1 месяц рекомендаций')
  fireEvent.change(screen.getByLabelText(/Промокод/), { target: { value: code } })
  fireEvent.click(screen.getByRole('button', { name: 'Применить' }))
}

// Код применим только к month3 и year1.
const PROMO_OK = { products: [
  { product_id: 'month3', price_kopecks: 420000, amount_kopecks: 378000 },
  { product_id: 'year1', price_kopecks: 1200000, amount_kopecks: 960000 },
] }

let assign: ReturnType<typeof vi.fn>

function emailInput(): HTMLInputElement {
  return screen.getByLabelText('Почта') as HTMLInputElement
}

function confirmInput(): HTMLInputElement {
  return screen.getByLabelText('Повторите почту') as HTMLInputElement
}

function fillEmail(email = EMAIL, confirm = email) {
  fireEvent.change(emailInput(), { target: { value: email } })
  fireEvent.change(confirmInput(), { target: { value: confirm } })
}

// Кнопка оплаты стоит на странице дважды (под тарифами и внизу): обе — один
// обработчик и одно состояние, поэтому по умолчанию берём верхнюю.
function payBtns(name: string | RegExp): HTMLButtonElement[] {
  return screen.getAllByRole('button', { name }) as HTMLButtonElement[]
}
function payBtn(name: string | RegExp): HTMLButtonElement {
  return payBtns(name)[0]
}
async function findPayBtn(name: string | RegExp): Promise<HTMLButtonElement> {
  return (await screen.findAllByRole('button', { name }))[0] as HTMLButtonElement
}
function payButton(): HTMLButtonElement {
  return payBtn(/Оплатить|Получить ключ|Продлить ключ|Продлить на/)
}
// Режим продления: переключатель «Продлить мой ключ».
function goRenew() {
  fireEvent.click(screen.getByRole('tab', { name: 'Продлить мой ключ' }))
}

// Журнал всех адресов роутера (путь, query, hash, state). Тесты идут под
// MemoryRouter, а он window.location и window.history не трогает: сторож
// утечки смотрит сюда, иначе navigate('/order/…?email=…', { state }) он бы
// не заметил.
let locations: string[] = []
function LocationLog() {
  const loc = useLocation()
  useEffect(() => { locations.push(`${loc.pathname}${loc.search}${loc.hash} ${JSON.stringify(loc.state ?? null)}`) }, [loc])
  return null
}

// По умолчанию почта уже введена в оба поля: без неё «Оплатить» недоступна.
function renderBuy(path = '/buy', { email = true }: { email?: boolean } = {}) {
  locations = []
  const r = render(
    <MemoryRouter initialEntries={[path]}>
      <LocationLog />
      <Routes>
        <Route path="/buy" element={<BuyPage redirect={assign} renewByEmail={false} />} />
        <Route path="/order/:id" element={<div>страница заказа {ORDER_ID}</div>} />
      </Routes>
    </MemoryRouter>,
  )
  if (email) fillEmail()
  return r
}

async function pay() {
  await screen.findByText('1 месяц рекомендаций')
  fireEvent.click(payBtn(/Оплатить/))
}

describe('BuyPage', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    window.scrollTo = vi.fn()
    assign = vi.fn()
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('помощник проверки хранилищ видит записи в обоих хранилищах', () => {
    const spies = spyStorageWrites()
    window.localStorage.setItem('a', 'секрет-1')
    window.sessionStorage.setItem('b', 'секрет-2')
    window.sessionStorage.removeItem('b')
    expect(storageText()).toContain('секрет-1')
    expect(leaked(spies, ['секрет-1', 'секрет-2', 'нет-такого'])).toEqual(['секрет-1', 'секрет-2'])
  })

  it('заказ завис: через 70 с текст про долгий ответ, кнопка снова доступна', async () => {
    const f = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/billing/products') return res(PRODUCTS)
      return new Promise<Response>((_r, rej) => {
        init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))
      })
    })
    vi.stubGlobal('fetch', f)
    renderBuy()
    await screen.findByText('1 месяц рекомендаций')
    vi.useFakeTimers()
    try {
      fireEvent.click(payBtn(/Оплатить/))
      await act(async () => { await vi.advanceTimersByTimeAsync(69_000) })
      expect(screen.queryByText(/Сервер долго не отвечает/)).toBeNull()
      expect((payBtn('Оформляем…') as HTMLButtonElement).disabled).toBe(true)
      await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
      expect(screen.getByText('Сервер долго не отвечает. Проверьте соединение и попробуйте ещё раз.')).toBeTruthy()
      expect(payButton().disabled).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('верхняя панель /buy подписана «FLIBOOSTER», ссылка ведёт на главную', () => {
    stubFetch(() => res({}))
    renderBuy()
    const link = screen.getByTitle('На главную')
    expect(link.textContent).toContain('FLIBOOSTER')
    expect(link.textContent).not.toContain('flib.club')
    expect(link.getAttribute('href')).toBe('/')
  })

  it('показывает тарифы с сервера по sort, цену в рублях и срок', async () => {
    stubFetch(() => res({}))
    renderBuy()
    await screen.findByText('1 месяц рекомендаций')
    const titles = screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent)
    expect(titles).toEqual(['1 месяц рекомендаций', '3 месяца рекомендаций', '12 месяцев рекомендаций'])
    expect(screen.getByText(/^1\s500\s₽$/)).toBeTruthy()
    expect(screen.getByText(/^4\s200\s₽$/)).toBeTruthy()
    expect(screen.getByText(/^12\s000\s₽$/)).toBeTruthy()
    expect(screen.getByText('30 дней')).toBeTruthy()
    expect(screen.getByText(/ключ покажем на следующей странице после оплаты/i)).toBeTruthy()
  })

  it('поле ключа для продления не сохраняется браузером', async () => {
    stubFetch(() => res({}))
    renderBuy()
    await screen.findByText('1 месяц рекомендаций')
    goRenew()
    const input = screen.getByLabelText(/Ключ, который нужно продлить/)
    expect(input.getAttribute('autocomplete')).toBe('off')
    expect(input.getAttribute('spellcheck')).toBe('false')
    expect(input.closest('#renew')).toBeTruthy()
  })

  it('/buy#renew прокручивает к блоку продления и ставит фокус в поле ключа', async () => {
    stubFetch(() => res({}))
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    renderBuy('/buy#renew')
    const input = await screen.findByLabelText(/Ключ, который нужно продлить/)
    await waitFor(() => expect(document.activeElement).toBe(input))
    expect(scroll).toHaveBeenCalled()
    expect((scroll.mock.contexts[0] as Element).id).toBe('renew')
  })

  it('без #renew открывается режим нового ключа: поля ключа нет, прокрутки и фокуса нет', async () => {
    stubFetch(() => res({}))
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    renderBuy('/buy')
    await screen.findByText('1 месяц рекомендаций')
    expect(screen.queryByLabelText(/Ключ, который нужно продлить/)).toBeNull()
    expect(screen.getByRole('tab', { name: 'Новый ключ' }).getAttribute('aria-selected')).toBe('true')
    expect(scroll).not.toHaveBeenCalled()
  })

  it('переключатель «Продлить мой ключ» показывает поле ключа и ставит в него фокус; обратно — поле исчезает', async () => {
    stubFetch(() => res({}))
    renderBuy('/buy')
    await screen.findByText('1 месяц рекомендаций')
    goRenew()
    const input = screen.getByLabelText(/Ключ, который нужно продлить/) as HTMLInputElement
    expect(input.placeholder).toBe('tpk_…')
    expect(document.activeElement).toBe(input)
    expect(screen.getByText('Срок добавится к текущему. Ключ и маршрут останутся прежними.')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/или почта/i)
    expect(screen.getByRole('tab', { name: 'Продлить мой ключ' }).getAttribute('aria-selected')).toBe('true')
    // Карточки в режиме продления: «+ срок» и «+N дней к ключу».
    expect(screen.getByText('+ 1 месяц')).toBeTruthy()
    expect(screen.getByText('+30 дней к ключу')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Новый ключ' }))
    expect(screen.queryByLabelText(/Ключ, который нужно продлить/)).toBeNull()
    expect(screen.getByText('1 месяц рекомендаций')).toBeTruthy()
  })

  it('в режиме «Новый ключ» ключ, введённый раньше в режиме продления, в заказ не уходит', async () => {
    const f = stubFetch(() => res({ order_id: ORDER_ID, confirmation_url: 'https://yoomoney.ru/x' }, 201))
    renderBuy()
    await screen.findByText('1 месяц рекомендаций')
    goRenew()
    fireEvent.change(screen.getByLabelText(/Ключ, который нужно продлить/), { target: { value: 'tpk_' + 'd'.repeat(32) } })
    fireEvent.click(screen.getByRole('tab', { name: 'Новый ключ' }))
    fireEvent.click(payBtn(/Оплатить/))
    await waitFor(() => expect(assign).toHaveBeenCalled())
    expect(orderBody(f)).toEqual({ email: EMAIL, product_id: 'month1' })
    // Вернулись в продление — ключ на месте и уходит.
    expect(f.mock.calls.filter(c => c[0] === '/api/billing/orders')).toHaveLength(1)
  })

  it('режим продления: без ключа кнопки недоступны, подсказка «Укажите ключ.»; с ключом — доступны', async () => {
    stubFetch(() => res({}))
    renderBuy()
    await screen.findByText('1 месяц рекомендаций')
    goRenew()
    expect(payBtns(/Продлить на 30 дней\s—\s1\s500\s₽/)).toHaveLength(1)
    for (const b of payBtns(/Продлить на/)) expect(b.disabled).toBe(true)
    const keyHints = screen.getAllByText('Укажите ключ.')
    expect(keyHints).toHaveLength(1)
    const [kt] = payBtns(/Продлить на/)
    expect(kt.getAttribute('aria-describedby')).toBe(keyHints[0].id)
    fireEvent.change(screen.getByLabelText(/Ключ, который нужно продлить/), { target: { value: 'tpk_' + 'e'.repeat(32) } })
    for (const b of payBtns(/Продлить на/)) expect(b.disabled).toBe(false)
    expect(screen.queryByText('Укажите ключ.')).toBeNull()
    for (const b of payBtns(/Продлить на/)) expect(b.getAttribute('aria-describedby')).toBeNull()
  })

  it('кнопка оплаты одна; тройной клик — один заказ', async () => {
    const f = stubFetch(() => new Promise<Response>(() => {}))
    renderBuy()
    await screen.findByText('1 месяц рекомендаций')
    const [top] = payBtns(/Оплатить\s1\s500\s₽/)
    expect(payBtns(/Оплатить/)).toHaveLength(1)
    fireEvent.click(top)
    fireEvent.click(top)
    fireEvent.click(top)
    await waitFor(() => expect(payBtns('Оформляем…')).toHaveLength(1))
    expect(f.mock.calls.filter(c => c[0] === '/api/billing/orders')).toHaveLength(1)
  })

  it('кнопка недоступна, пока не введена почта', async () => {
    stubFetch(() => res({}))
    renderBuy('/buy', { email: false })
    await screen.findByText('1 месяц рекомендаций')
    for (const b of payBtns(/Оплатить/)) expect(b.disabled).toBe(true)
  })

  it('ошибка заказа показывается под кнопкой', async () => {
    const f = stubFetch(() => res({ error: 'payments_unavailable' }, 503))
    renderBuy()
    await screen.findByText('1 месяц рекомендаций')
    fireEvent.click(payBtns(/Оплатить/)[0])
    await screen.findByText(/Оплата временно недоступна/)
    expect(f.mock.calls.filter(c => c[0] === '/api/billing/orders')).toHaveLength(1)
  })

  it('промокод со скидкой: подпись кнопки показывает сумму со скидкой', async () => {
    stubFetch(() => res({}), () => res(PROMO_OK))
    renderBuy()
    await applyPromo('Spring_2026')
    await screen.findByText(/Промокод действует только на тарифы/)
    fireEvent.click(card('3 месяца рекомендаций'))
    await waitFor(() => expect(payBtns(/Оплатить\s3\s780\s₽/)).toHaveLength(1))
  })

  it('отправляет выбранный тариф, промокод и ключ, затем уходит на confirmation_url', async () => {
    const f = stubFetch(() => res({ order_id: ORDER_ID, status: 'pending', confirmation_url: 'https://yoomoney.ru/checkout/x' }, 201))
    const spies = spyStorageWrites()
    renderBuy()
    await screen.findByText('1 месяц рекомендаций')
    fireEvent.click(screen.getByText('3 месяца рекомендаций'))
    fireEvent.change(screen.getByLabelText(/Промокод/), { target: { value: ' test_user_2026 ' } })
    goRenew()
    fireEvent.change(screen.getByLabelText(/Ключ, который нужно продлить/), { target: { value: 'tpk_' + 'a'.repeat(32) } })
    fireEvent.click(payButton())
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://yoomoney.ru/checkout/x'))
    const call = f.mock.calls.find(c => c[0] === '/api/billing/orders') as unknown as [string, RequestInit]
    expect(call[1].method).toBe('POST')
    expect(JSON.parse(String(call[1].body))).toEqual({ email: EMAIL, product_id: 'month3', promo_code: 'test_user_2026', renew_key: 'tpk_' + 'a'.repeat(32) })
    // Ни ключ продления, ни промокод не попадают в хранилища браузера.
    expect(leaked(spies, ['tpk_' + 'a'.repeat(32), 'test_user_2026'])).toEqual([])
    for (const s of ['tpk_' + 'a'.repeat(32), 'test_user_2026', 'example.com']) expect(locations.join('\n')).not.toContain(s)
  })

  it('без confirmation_url (бесплатный промокод) переходит на страницу заказа', async () => {
    stubFetch(() => res({ order_id: ORDER_ID, status: 'fulfilled', confirmation_url: null }, 201))
    renderBuy()
    await pay()
    expect(await screen.findByText(`страница заказа ${ORDER_ID}`)).toBeTruthy()
    expect(assign).not.toHaveBeenCalled()
  })

  it('двойной клик создаёт один заказ', async () => {
    let resolve!: (r: Response) => void
    const f = stubFetch(() => new Promise<Response>(r => { resolve = r }))
    renderBuy()
    await screen.findByText('1 месяц рекомендаций')
    const btn = payBtn(/Оплатить/) as HTMLButtonElement
    // Оба клика внутри одного act: React ещё не перерисовал кнопку, disabled
    // не стоит — второй заказ держит только синхронная защита (ref).
    act(() => { btn.click(); btn.click() })
    expect(btn.hasAttribute('disabled')).toBe(true)
    expect(f.mock.calls.filter(c => c[0] === '/api/billing/orders')).toHaveLength(1)
    await act(async () => {
      resolve(new Response(JSON.stringify({ order_id: ORDER_ID, confirmation_url: 'https://yoomoney.ru/x' }), { status: 201 }))
    })
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1))
  })

  it.each([
    [400, { error: 'promo_invalid' }, {}, /Промокод не подошёл/],
    [400, { error: 'key_not_renewable' }, {}, /Этот ключ нельзя продлить/],
    [503, { error: 'payments_unavailable' }, {}, /Оплата временно недоступна/],
    [429, { error: 'rate_limited' }, { 'Retry-After': '42' }, /через 42 с/],
    [429, { error: 'busy' }, {}, /Слишком много попыток/],
    [429, { error: 'rate_limited' }, { 'Retry-After': '600' }, /через 10 мин/],
    [400, { error: 'product_unavailable' }, {}, /тариф сейчас недоступен/],
    [502, { error: 'gateway_unavailable' }, {}, /Не удалось оформить заказ/],
  ])('ошибка %i %j → сообщение и кнопка снова активна', async (status, body, headers, msg) => {
    stubFetch(() => res(body, status as number, headers as Record<string, string>))
    renderBuy()
    await pay()
    expect(await screen.findByText(msg as RegExp)).toBeTruthy()
    expect(payBtn(/Оплатить/).hasAttribute('disabled')).toBe(false)
    expect(assign).not.toHaveBeenCalled()
  })

  it.each([
    ['javascript:alert(1)'],
    ['http://yoomoney.ru/checkout/x'],
    ['JAVASCRIPT:alert(1)'],
  ])('небезопасный confirmation_url %s → на оплату не уходим, открываем заказ', async (url) => {
    stubFetch(() => res({ order_id: ORDER_ID, status: 'pending', confirmation_url: url }, 201))
    renderBuy()
    await pay()
    expect(await screen.findByText(`страница заказа ${ORDER_ID}`)).toBeTruthy()
    expect(assign).not.toHaveBeenCalled()
  })

  it('обрыв сети → отдельное сообщение', async () => {
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')))
    renderBuy()
    await pay()
    expect(await screen.findByText(/Нет связи с сервером/)).toBeTruthy()
  })

  // ─── цена за месяц ──────────────────────────────────────────────────────

  it('цена за месяц мелким шрифтом в каждой карточке', async () => {
    stubFetch(() => res({}))
    renderBuy()
    await screen.findByText('1 месяц рекомендаций')
    expect(card('1 месяц рекомендаций').textContent).toMatch(/1\s500\s₽\/мес/)
    expect(card('3 месяца рекомендаций').textContent).toMatch(/1\s400\s₽\/мес/)
    expect(card('12 месяцев рекомендаций').textContent).toMatch(/1\s000\s₽\/мес/)
  })

  it('perMonthKopecks: месяцы = round(дни / 30.4375), меньше месяца — строки нет', () => {
    expect(monthsIn(30)).toBe(1)
    expect(monthsIn(90)).toBe(3)
    expect(monthsIn(365)).toBe(12)
    expect(perMonthKopecks(150000, 30)).toBe(150000)
    expect(perMonthKopecks(420000, 90)).toBe(140000)
    expect(perMonthKopecks(1200000, 365)).toBe(100000)
    expect(perMonthKopecks(50000, 7)).toBeNull()
    expect(perMonthKopecks(50000, 0)).toBeNull()
    // Округление до рубля: 1 000 ₽ за 3 мес → 333 ₽/мес, без копеек.
    expect(perMonthKopecks(100000, 90)).toBe(33300)
    // Ловят делитель: при «/ 30» вышло бы 2 и 37.
    expect(monthsIn(45)).toBe(1)
    expect(monthsIn(1095)).toBe(36)
  })

  it('тариф короче полумесяца — без строки цены за месяц', async () => {
    vi.stubGlobal('fetch', vi.fn(() => res({ products: [{ id: 'week', title: 'Неделя', price_kopecks: 50000, duration_days: 7, sort: 1 }] })))
    renderBuy()
    await screen.findByText('Неделя')
    expect(card('Неделя').textContent).not.toMatch(/\/мес/)
  })

  // ─── промокод: «Применить» ──────────────────────────────────────────────

  it('«Применить»: зачёркнута старая цена только у применимых тарифов', async () => {
    const f = stubFetch(() => res({}), () => res(PROMO_OK))
    renderBuy()
    await applyPromo('  Spring_2026 ')
    await screen.findByText(/3\s780\s₽/)
    const call = f.mock.calls.find(c => c[0] === PROMO_URL) as unknown as [string, RequestInit]
    expect(call[1].method).toBe('POST')
    expect(JSON.parse(String(call[1].body))).toEqual({ code: 'Spring_2026' })
    const m3 = card('3 месяца рекомендаций')
    expect(m3.querySelector('s')?.textContent).toMatch(/^4\s200\s₽$/)
    expect(m3.textContent).toMatch(/3\s780\s₽/)
    const y1 = card('12 месяцев рекомендаций')
    expect(y1.querySelector('s')?.textContent).toMatch(/^12\s000\s₽$/)
    expect(y1.textContent).toMatch(/9\s600\s₽/)
    // month1 из ответа нет — цена без изменений, ничего не зачёркнуто.
    const m1 = card('1 месяц рекомендаций')
    expect(m1.querySelector('s')).toBeNull()
    expect(m1.textContent).toMatch(/1\s500\s₽/)
    expect(screen.getByText(/только на тарифы с новой ценой/)).toBeTruthy()
  })

  it('после «Применить» заказ на применимом тарифе — с кодом', async () => {
    const f = stubFetch(() => res({ order_id: ORDER_ID, confirmation_url: 'https://yoomoney.ru/x' }, 201), () => res(PROMO_OK))
    renderBuy()
    await applyPromo('Spring_2026')
    await screen.findByText(/3\s780\s₽/)
    fireEvent.click(screen.getByText('3 месяца рекомендаций'))
    fireEvent.click(payBtn(/Оплатить/))
    await waitFor(() => expect(assign).toHaveBeenCalled())
    expect(orderBody(f)).toEqual({ email: EMAIL, product_id: 'month3', promo_code: 'Spring_2026' })
  })

  it('после «Применить» заказ на неприменимом тарифе — без кода', async () => {
    const f = stubFetch(() => res({ order_id: ORDER_ID, confirmation_url: 'https://yoomoney.ru/x' }, 201), () => res(PROMO_OK))
    renderBuy()
    await applyPromo('Spring_2026')
    await screen.findByText(/3\s780\s₽/)
    fireEvent.click(screen.getByText('1 месяц рекомендаций'))
    fireEvent.click(payBtn(/Оплатить/))
    await waitFor(() => expect(assign).toHaveBeenCalled())
    expect(orderBody(f)).toEqual({ email: EMAIL, product_id: 'month1' })
  })

  it('правка поля промокода сбрасывает применённую скидку', async () => {
    const f = stubFetch(() => res({ order_id: ORDER_ID, confirmation_url: 'https://yoomoney.ru/x' }, 201), () => res(PROMO_OK))
    renderBuy()
    await applyPromo('Spring_2026')
    await screen.findByText(/3\s780\s₽/)
    fireEvent.change(screen.getByLabelText(/Промокод/), { target: { value: 'Spring_2027' } })
    expect(document.querySelector('.billing-plans s')).toBeNull()
    expect(screen.queryByText(/3\s780\s₽/)).toBeNull()
    expect(screen.queryByText(/только на тарифы с новой ценой/)).toBeNull()
    // Непроверенный код уходит в заказ как раньше — его проверит заказ.
    fireEvent.click(screen.getByText('1 месяц рекомендаций'))
    fireEvent.click(payBtn(/Оплатить/))
    await waitFor(() => expect(assign).toHaveBeenCalled())
    expect(orderBody(f)).toEqual({ email: EMAIL, product_id: 'month1', promo_code: 'Spring_2027' })
  })

  it('ответ пришёл после правки поля — не применяется', async () => {
    let resolve!: (r: Response) => void
    stubFetch(() => res({}), () => new Promise<Response>(r => { resolve = r }))
    renderBuy()
    await applyPromo('Spring_2026')
    fireEvent.change(screen.getByLabelText(/Промокод/), { target: { value: 'другой' } })
    await act(async () => { resolve(new Response(JSON.stringify(PROMO_OK), { status: 200 })) })
    expect(document.querySelector('.billing-plans s')).toBeNull()
    expect(screen.queryByText(/новой ценой/)).toBeNull()
  })

  it('products:[] → «Код не подходит к этим тарифам», заказ без кода', async () => {
    const f = stubFetch(() => res({ order_id: ORDER_ID, confirmation_url: 'https://yoomoney.ru/x' }, 201), () => res({ products: [] }))
    renderBuy()
    await applyPromo('Spring_2026')
    expect(await screen.findByText('Код не подходит к этим тарифам')).toBeTruthy()
    expect(document.querySelector('.billing-plans s')).toBeNull()
    fireEvent.click(payBtn(/Оплатить/))
    await waitFor(() => expect(assign).toHaveBeenCalled())
    expect(orderBody(f)).toEqual({ email: EMAIL, product_id: 'month1' })
  })

  it('404 (ручки нет на шлюзе) → «проверим при оформлении», заказ с кодом как раньше', async () => {
    const f = stubFetch(() => res({ order_id: ORDER_ID, confirmation_url: 'https://yoomoney.ru/x' }, 201),
      () => res({ error: 'promo_check_unavailable' }, 404))
    renderBuy()
    await applyPromo('Spring_2026')
    expect(await screen.findByText(/Код проверим при оформлении заказа/)).toBeTruthy()
    fireEvent.click(payBtn(/Оплатить/))
    await waitFor(() => expect(assign).toHaveBeenCalled())
    expect(orderBody(f)).toEqual({ email: EMAIL, product_id: 'month1', promo_code: 'Spring_2026' })
  })

  it.each([
    [429, { error: 'rate_limited' }, { 'Retry-After': '1800' }, /Слишком много проверок.*через 30 мин/],
    [429, { error: 'rate_limited', retry_after_sec: 2 }, { 'Retry-After': '2' }, /через 2 с/],
    [400, { error: 'promo_invalid' }, {}, /Промокод не подошёл/],
    [502, { error: 'gateway_unavailable' }, {}, /Не удалось проверить код/],
  ])('проверка кода: %i %j → сообщение', async (status, body, headers, msg) => {
    stubFetch(() => res({}), () => res(body, status as number, headers as Record<string, string>))
    renderBuy()
    await applyPromo('Spring_2026')
    expect(await screen.findByText(msg as RegExp)).toBeTruthy()
    expect(document.querySelector('.billing-plans s')).toBeNull()
    expect((screen.getByRole('button', { name: 'Применить' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('двойной клик «Применить» — один запрос', async () => {
    let resolve!: (r: Response) => void
    const f = stubFetch(() => res({}), () => new Promise<Response>(r => { resolve = r }))
    renderBuy()
    await screen.findByText('1 месяц рекомендаций')
    fireEvent.change(screen.getByLabelText(/Промокод/), { target: { value: 'Spring_2026' } })
    const btn = screen.getByRole('button', { name: 'Применить' }) as HTMLButtonElement
    act(() => { btn.click(); btn.click() })
    expect(f.mock.calls.filter(c => c[0] === PROMO_URL)).toHaveLength(1)
    await act(async () => { resolve(new Response(JSON.stringify(PROMO_OK), { status: 200 })) })
    expect(f.mock.calls.filter(c => c[0] === PROMO_URL)).toHaveLength(1)
  })

  it('пустое поле — «Применить» недоступна', async () => {
    stubFetch(() => res({}))
    renderBuy()
    await screen.findByText('1 месяц рекомендаций')
    expect((screen.getByRole('button', { name: 'Применить' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(/Промокод/), { target: { value: '   ' } })
    expect((screen.getByRole('button', { name: 'Применить' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('промокод не попадает ни в хранилища, ни в URL', async () => {
    const spies = spyStorageWrites()
    const f = stubFetch(() => res({ order_id: ORDER_ID, confirmation_url: 'https://yoomoney.ru/x' }, 201), () => res(PROMO_OK))
    renderBuy('/buy?src=app')
    await applyPromo('Spring_2026')
    await screen.findByText(/3\s780\s₽/)
    fireEvent.click(screen.getByText('3 месяца рекомендаций'))
    fireEvent.click(payBtn(/Оплатить/))
    await waitFor(() => expect(assign).toHaveBeenCalled())
    expect(leaked(spies, ['Spring_2026'])).toEqual([])
    expect(window.location.href).not.toContain('Spring_2026')
    expect(locations.length).toBeGreaterThan(0)
    expect(locations.join('\n')).not.toContain('Spring_2026')
    for (const c of f.mock.calls) expect(String(c[0])).not.toContain('Spring_2026')
  })

  // Карточки тарифов на лендинге шлюза ведут на /buy?product=<id>: открываться
  // должен именно этот тариф, а не первый по sort.
  describe('?product=<id> выбирает тариф', () => {
    async function checkedTitle(): Promise<string | null | undefined> {
      await screen.findAllByRole('radio')
      return screen.getAllByRole('radio').find(c => c.getAttribute('aria-checked') === 'true')?.querySelector('h3')?.textContent
    }

    it('совпал с активным тарифом → выбран он, и он же уходит в заказ', async () => {
      const f = stubFetch(() => res({ order_id: ORDER_ID, status: 'pending', confirmation_url: 'https://yoomoney.ru/checkout/x' }, 201))
      renderBuy('/buy?product=month3')
      expect(await checkedTitle()).toBe('3 месяца рекомендаций')
      fireEvent.click(payButton())
      await waitFor(() => expect(assign).toHaveBeenCalled())
      expect(orderBody(f).product_id).toBe('month3')
    })

    it('неизвестный id → первый тариф', async () => {
      stubFetch(() => res({}))
      renderBuy('/buy?product=nope')
      expect(await checkedTitle()).toBe('1 месяц рекомендаций')
    })

    it('без параметра → первый тариф', async () => {
      stubFetch(() => res({}))
      renderBuy('/buy')
      expect(await checkedTitle()).toBe('1 месяц рекомендаций')
    })

    it('вместе с #renew: тариф выбран, прокрутка и фокус в поле ключа', async () => {
      stubFetch(() => res({}))
      const scroll = vi.fn()
      Element.prototype.scrollIntoView = scroll
      renderBuy('/buy?product=year1#renew')
      expect(await checkedTitle()).toBe('+ 12 месяцев')
      const input = screen.getByLabelText(/Ключ, который нужно продлить/)
      await waitFor(() => expect(document.activeElement).toBe(input))
      expect((scroll.mock.contexts[0] as Element).id).toBe('renew')
    })
  })

  it('/buy?src=…#renew по-прежнему прокручивает к продлению и ставит фокус', async () => {
    stubFetch(() => res({}))
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    renderBuy('/buy?src=app_renew#renew')
    const input = await screen.findByLabelText(/Ключ, который нужно продлить/)
    await waitFor(() => expect(document.activeElement).toBe(input))
    expect((scroll.mock.contexts[0] as Element).id).toBe('renew')
  })

  // На телефоне первая прокрутка идёт до загрузки тарифов: карточки потом
  // выталкивают поле ключа за экран. Поэтому после загрузки — ещё одна, и
  // только одна; фокус остаётся в поле ключа.
  describe('/buy#renew: повторная прокрутка после загрузки тарифов', () => {
    let resolveProducts!: (r: Response) => void
    let reduced = false
    beforeEach(() => {
      reduced = false
      vi.stubGlobal('matchMedia', vi.fn((q: string) => ({
        matches: q.includes('prefers-reduced-motion') && reduced, media: q,
        addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(),
      })))
      vi.stubGlobal('fetch', vi.fn((url: string) => (url === '/api/billing/products'
        ? new Promise<Response>(r => { resolveProducts = r })
        : res({}))))
    })

    async function loadProducts() {
      await act(async () => { resolveProducts(new Response(JSON.stringify(PRODUCTS), { status: 200 })) })
      await screen.findAllByRole('radio')
    }

    it.each([
      [false, 'smooth'],
      [true, 'auto'],
    ])('reduced-motion=%s → вторая прокрутка с behavior=%s, фокус в поле ключа', async (isReduced, behavior) => {
      reduced = isReduced as boolean
      const scroll = vi.fn()
      Element.prototype.scrollIntoView = scroll
      renderBuy('/buy#renew')
      const input = screen.getByLabelText(/Ключ, который нужно продлить/)
      expect(scroll).toHaveBeenCalledTimes(1)
      expect(document.activeElement).toBe(input)
      await loadProducts()
      expect(scroll).toHaveBeenCalledTimes(2)
      expect((scroll.mock.contexts[1] as Element).id).toBe('renew')
      expect(scroll.mock.calls[1][0]).toEqual({ block: 'center', behavior })
      expect(document.activeElement).toBe(input)
      // Дальнейшие изменения страницы (выбор тарифа) больше не прокручивают.
      fireEvent.click(card('+ 3 месяца'))
      await act(async () => {})
      expect(scroll).toHaveBeenCalledTimes(2)
    })

    it('пользователь уже ушёл в другое поле — фокус не отнимаем, но прокрутка есть', async () => {
      const scroll = vi.fn()
      Element.prototype.scrollIntoView = scroll
      renderBuy('/buy#renew')
      emailInput().focus()
      await loadProducts()
      expect(scroll).toHaveBeenCalledTimes(2)
      expect(document.activeElement).toBe(emailInput())
    })

    it('без #renew — ни одной прокрутки к блоку, и после загрузки тоже', async () => {
      const scroll = vi.fn()
      Element.prototype.scrollIntoView = scroll
      renderBuy('/buy')
      await loadProducts()
      expect(scroll).not.toHaveBeenCalled()
    })

    it('тарифы не загрузились — повторной прокрутки нет', async () => {
      const scroll = vi.fn()
      Element.prototype.scrollIntoView = scroll
      renderBuy('/buy#renew')
      await act(async () => { resolveProducts(new Response(JSON.stringify({ error: 'x' }), { status: 502 })) })
      await screen.findByText(/Не удалось загрузить тарифы/)
      expect(scroll).toHaveBeenCalledTimes(1)
    })
  })

  // ─── аудит: зависание, повторы, сбросы ──────────────────────────────────

  it('зависшая проверка через 10 с отменяется: «Оплатить» снова доступна, код проверим при оформлении', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      let promoSignal: AbortSignal | undefined
      const f = vi.fn((url: string, init?: RequestInit) => {
        if (url === '/api/billing/products') return res(PRODUCTS)
        if (url === PROMO_URL) {
          promoSignal = init?.signal ?? undefined
          return new Promise<Response>((_, rej) => {
            init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))
          })
        }
        return res({ order_id: ORDER_ID, confirmation_url: 'https://yoomoney.ru/x' }, 201)
      })
      vi.stubGlobal('fetch', f)
      renderBuy()
      await applyPromo('Spring_2026')
      const pb = payBtn(/Оплатить/) as HTMLButtonElement
      expect(pb.disabled).toBe(true)
      expect(promoSignal).toBeTruthy()
      await act(async () => { vi.advanceTimersByTime(10_000) })
      expect(await screen.findByText(/проверим при оформлении/)).toBeTruthy()
      expect(pb.disabled).toBe(false)
      expect(promoSignal?.aborted).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('правка поля отменяет идущую проверку', async () => {
    let promoSignal: AbortSignal | undefined
    const f = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/billing/products') return res(PRODUCTS)
      promoSignal = init?.signal ?? undefined
      return new Promise<Response>((_, rej) => {
        init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))
      })
    })
    vi.stubGlobal('fetch', f)
    renderBuy()
    await applyPromo('Spring_2026')
    fireEvent.change(screen.getByLabelText(/Промокод/), { target: { value: 'Spring_2027' } })
    expect(promoSignal?.aborted).toBe(true)
    // Новую проверку можно запустить сразу, сообщение об отмене не показывается.
    expect((screen.getByRole('button', { name: 'Применить' }) as HTMLButtonElement).disabled).toBe(false)
    await act(async () => {})
    expect(screen.queryByText(/проверим при оформлении/)).toBeNull()
  })

  it('уже проверенный код повторно не проверяется', async () => {
    const f = stubFetch(() => res({}), () => res(PROMO_OK))
    renderBuy()
    await applyPromo('Spring_2026')
    await screen.findByText(/3\s780\s₽/)
    fireEvent.click(screen.getByRole('button', { name: 'Применить' }))
    // Пробелы вокруг того же кода — тот же код: скидка не сбрасывается.
    fireEvent.change(screen.getByLabelText(/Промокод/), { target: { value: ' Spring_2026 ' } })
    expect(screen.getByText(/3\s780\s₽/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Применить' }))
    await act(async () => {})
    expect(f.mock.calls.filter(c => c[0] === PROMO_URL)).toHaveLength(1)
  })

  it('promo_invalid от заказа сбрасывает скидку и зелёное сообщение; новая проверка с ошибкой скидку не возвращает', async () => {
    let promoCalls = 0
    const f = stubFetch(() => res({ error: 'promo_invalid' }, 400),
      () => (++promoCalls === 1 ? res(PROMO_OK) : res({ error: 'rate_limited' }, 429, { 'Retry-After': '60' })))
    renderBuy()
    await applyPromo('Spring_2026')
    await screen.findByText(/3\s780\s₽/)
    fireEvent.click(screen.getByText('3 месяца рекомендаций'))
    fireEvent.click(payBtn(/Оплатить/))
    expect(await screen.findByText(/Промокод не подошёл/)).toBeTruthy()
    expect(document.querySelector('.billing-plans s')).toBeNull()
    expect(screen.queryByText(/только на тарифы с новой ценой/)).toBeNull()
    // Проверка снова разрешена, но неудачная — скидки нет.
    fireEvent.click(screen.getByRole('button', { name: 'Применить' }))
    expect(await screen.findByText(/Слишком много проверок/)).toBeTruthy()
    expect(document.querySelector('.billing-plans s')).toBeNull()
    expect(f.mock.calls.filter(c => c[0] === PROMO_URL)).toHaveLength(2)
  })

  it('Enter в поле промокода запускает проверку', async () => {
    const f = stubFetch(() => res({}), () => res(PROMO_OK))
    renderBuy()
    await screen.findByText('1 месяц рекомендаций')
    const input = screen.getByLabelText(/Промокод/)
    fireEvent.change(input, { target: { value: 'Spring_2026' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await screen.findByText(/3\s780\s₽/)
    expect(f.mock.calls.filter(c => c[0] === PROMO_URL)).toHaveLength(1)
  })

  it('пока идёт проверка, «Оплатить» недоступна', async () => {
    let resolve!: (r: Response) => void
    stubFetch(() => res({}), () => new Promise<Response>(r => { resolve = r }))
    renderBuy()
    await applyPromo('Spring_2026')
    expect((payBtn(/Оплатить/) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => { resolve(new Response(JSON.stringify(PROMO_OK), { status: 200 })) })
    expect((payBtn(/Оплатить/) as HTMLButtonElement).disabled).toBe(false)
  })

  it('amount == price — цена не зачёркнута, но код к тарифу применим', async () => {
    const f = stubFetch(() => res({ order_id: ORDER_ID, confirmation_url: 'https://yoomoney.ru/x' }, 201),
      () => res({ products: [{ product_id: 'month1', price_kopecks: 150000, amount_kopecks: 150000 }] }))
    renderBuy()
    await applyPromo('Spring_2026')
    await screen.findByText(/только на тарифы с новой ценой/)
    expect(card('1 месяц рекомендаций').querySelector('s')).toBeNull()
    fireEvent.click(payBtn(/Оплатить/))
    await waitFor(() => expect(assign).toHaveBeenCalled())
    expect(orderBody(f)).toEqual({ email: EMAIL, product_id: 'month1', promo_code: 'Spring_2026' })
  })

  it('цена за месяц под скидкой считается от новой цены', async () => {
    stubFetch(() => res({}), () => res(PROMO_OK))
    renderBuy()
    await applyPromo('Spring_2026')
    await screen.findByText(/3\s780\s₽/)
    expect(card('3 месяца рекомендаций').textContent).toMatch(/1\s260\s₽\/мес/)
    expect(card('12 месяцев рекомендаций').textContent).toMatch(/800\s₽\/мес/)
    expect(card('1 месяц рекомендаций').textContent).toMatch(/1\s500\s₽\/мес/)
  })

  it('product_id не с витрины игнорируется', async () => {
    const f = stubFetch(() => res({ order_id: ORDER_ID, confirmation_url: 'https://yoomoney.ru/x' }, 201),
      () => res({ products: [{ product_id: 'ghost', price_kopecks: 100000, amount_kopecks: 1 }] }))
    renderBuy()
    await applyPromo('Spring_2026')
    expect(await screen.findByText('Код не подходит к этим тарифам')).toBeTruthy()
    expect(document.querySelector('.billing-plans s')).toBeNull()
    fireEvent.click(payBtn(/Оплатить/))
    await waitFor(() => expect(assign).toHaveBeenCalled())
    expect(orderBody(f)).toEqual({ email: EMAIL, product_id: 'month1' })
  })

  it('код длиннее 64 байт — сразу «не подошёл», без запросов', async () => {
    const f = stubFetch(() => res({}), () => res(PROMO_OK))
    renderBuy()
    await applyPromo('я'.repeat(33))
    expect(await screen.findByText(/Промокод не подошёл/)).toBeTruthy()
    fireEvent.click(payBtn(/Оплатить/))
    await act(async () => {})
    expect(f.mock.calls.filter(c => c[0] === PROMO_URL || c[0] === '/api/billing/orders')).toHaveLength(0)
    // 32 «я» = 64 байта — проверка уходит.
    fireEvent.change(screen.getByLabelText(/Промокод/), { target: { value: 'я'.repeat(32) } })
    fireEvent.click(screen.getByRole('button', { name: 'Применить' }))
    await waitFor(() => expect(f.mock.calls.filter(c => c[0] === PROMO_URL)).toHaveLength(1))
  })

  it('витрина не загрузилась → сообщение, кнопка недоступна', async () => {
    vi.stubGlobal('fetch', vi.fn(() => res({ error: 'gateway_unavailable' }, 502)))
    renderBuy()
    expect(await screen.findByText(/Не удалось загрузить тарифы/)).toBeTruthy()
    expect(payBtn(/Оплатить/).hasAttribute('disabled')).toBe(true)
  })

  it('цена выбранного тарифа 0 ₽ по промокоду → кнопка «Получить ключ», другой тариф → «Оплатить»', async () => {
    stubFetch(() => res({}), () => res({ products: [{ product_id: 'month1', price_kopecks: 150000, amount_kopecks: 0 }] }))
    renderBuy()
    expect(await findPayBtn(/Оплатить/)).toBeTruthy()
    await applyPromo('FREE')
    expect(await findPayBtn('Получить ключ')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Оплатить/ })).toBeNull()
    expect(screen.getByText('Ключ покажем на следующей странице.')).toBeTruthy()
    expect(screen.queryByText(/ЮKassa/)).toBeNull()
    fireEvent.click(card('3 месяца рекомендаций'))
    expect(payBtn(/Оплатить/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Получить ключ' })).toBeNull()
  })

  it('правка кода после «Применить» возвращает «Оплатить»', async () => {
    stubFetch(() => res({}), () => res({ products: [{ product_id: 'month1', price_kopecks: 150000, amount_kopecks: 0 }] }))
    renderBuy()
    await applyPromo('FREE')
    expect(await findPayBtn('Получить ключ')).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/Промокод/), { target: { value: 'FREE2' } })
    expect(payBtn(/Оплатить/)).toBeTruthy()
  })
})

// ─── почта покупателя ─────────────────────────────────────────────────────
// Решения владельца 2026-11-16: под выбором тарифа — «Куда отправить копию
// заказа?», поля «Почта» и «Повторите почту»; во второе поле нельзя вставить
// или перетащить текст; «Оплатить» недоступна, пока адреса не совпадут (после
// trim, без учёта регистра). Почта — персональные данные: только в теле заказа.

describe('BuyPage: почта покупателя', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    window.scrollTo = vi.fn()
    assign = vi.fn()
    vi.mocked(track).mockClear()
    vi.mocked(reportRouteNext).mockClear()
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('под тарифами — заголовок, два поля, подсказка и ссылки на канал и поддержку', async () => {
    stubFetch(() => res({}))
    renderBuy('/buy', { email: false })
    await screen.findByText('1 месяц рекомендаций')
    const heading = screen.getByRole('heading', { name: 'Мы отправим копию ключа на эту почту:' })
    // Блок почты идёт после выбора тарифа.
    const plans = screen.getByRole('radiogroup', { name: 'Тариф' })
    expect(plans.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(emailInput().getAttribute('type')).toBe('email')
    expect(confirmInput().getAttribute('type')).toBe('email')
    expect(emailInput().getAttribute('maxlength')).toBe('254')
    expect(confirmInput().getAttribute('maxlength')).toBe('254')
    expect(screen.getByText('Проверьте адрес внимательно: ключ будет показан на экране и придёт на эту почту.')).toBeTruthy()
    const channel = screen.getByRole('link', { name: '@flibclub' })
    expect(channel.getAttribute('href')).toBe('https://t.me/flibclub')
    const support = screen.getByRole('link', { name: '@FliboosterHelpUser_bot' })
    expect(support.getAttribute('href')).toBe('https://t.me/FliboosterHelpUser_bot')
    for (const a of [channel, support]) {
      expect(a.getAttribute('target')).toBe('_blank')
      expect(a.getAttribute('rel')).toBe('noopener noreferrer')
    }
    // Порядок на /buy: заголовок → поля → подсказка владельца → строка про канал и поддержку.
    const hint = screen.getByText('Проверьте адрес внимательно: ключ будет показан на экране и придёт на эту почту.')
    const seq = [heading, emailInput(), confirmInput(), hint, channel]
    for (let i = 1; i < seq.length; i++) {
      expect(seq[i - 1].compareDocumentPosition(seq[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
    const note = channel.closest('p') as HTMLElement
    expect(note.textContent).toBe('Вступайте в канал @flibclub. По техническим вопросам и проблемам с оплатой пишите в поддержку: @FliboosterHelpUser_bot.')
  })

  it('продление (/buy#renew): те же поля, почта уходит в заказ вместе с ключом', async () => {
    const f = stubFetch(() => res({ order_id: ORDER_ID, confirmation_url: 'https://yoomoney.ru/x' }, 201))
    Element.prototype.scrollIntoView = vi.fn()
    renderBuy('/buy#renew', { email: false })
    await screen.findByText('+ 1 месяц')
    // Режим продления открыт якорем; почта спрашивается и тут (шлюз требует её для каждого заказа).
    expect(screen.getByRole('heading', { name: 'Мы отправим подтверждение продления на эту почту:' })).toBeTruthy()
    const HINT = 'Проверьте адрес внимательно: ключ будет показан на экране и придёт на эту почту.'
    fireEvent.change(screen.getByLabelText(/Ключ, который нужно продлить/), { target: { value: 'tpk_' + 'b'.repeat(32) } })
    // Продление: нового ключа не будет — подсказки нет вовсе (решение владельца 2026-11-17).
    expect(screen.queryByText(HINT)).toBeNull()
    expect(screen.queryByText(/ключ будет показан/)).toBeNull()
    expect(payButton().disabled).toBe(true)
    fillEmail()
    fireEvent.click(payButton())
    await waitFor(() => expect(assign).toHaveBeenCalled())
    expect(orderBody(f)).toEqual({ email: EMAIL, product_id: 'month1', renew_key: 'tpk_' + 'b'.repeat(32) })
  })

  it('тексты продления (решение владельца 2026-11-17): заголовок почты и строка под «Оплатить» меняются по режиму', async () => {
    stubFetch(() => res({}))
    renderBuy('/buy', { email: false })
    await screen.findByText('1 месяц рекомендаций')
    const NEW_HEADING = 'Мы отправим копию ключа на эту почту:'
    const RENEW_HEADING = 'Мы отправим подтверждение продления на эту почту:'
    const NEW_NOTE = 'Оплата через ЮKassa. Ключ покажем на следующей странице после оплаты.'
    const RENEW_NOTE = 'Оплата через ЮKassa. Срок ключа продлим сразу после оплаты.'
    // Новый доступ.
    expect(screen.getByRole('heading', { name: NEW_HEADING })).toBeTruthy()
    expect(screen.getByText(NEW_NOTE)).toBeTruthy()
    expect(screen.queryByRole('heading', { name: RENEW_HEADING })).toBeNull()
    expect(screen.queryByText(RENEW_NOTE)).toBeNull()
    // Продление.
    goRenew()
    expect(screen.getByRole('heading', { name: RENEW_HEADING })).toBeTruthy()
    expect(screen.getByText(RENEW_NOTE)).toBeTruthy()
    expect(screen.queryByRole('heading', { name: NEW_HEADING })).toBeNull()
    expect(screen.queryByText(NEW_NOTE)).toBeNull()
    // Обратно на «Новый ключ» — прежние тексты.
    fireEvent.click(screen.getByRole('tab', { name: 'Новый ключ' }))
    expect(screen.getByRole('heading', { name: NEW_HEADING })).toBeTruthy()
    expect(screen.getByText(NEW_NOTE)).toBeTruthy()
  })

  it('бесплатный заказ (0 ₽): новый доступ — «Получить ключ», продление — «Продлить ключ» и «Срок ключа продлим сразу.»', async () => {
    const f = stubFetch(() => res({ order_id: ORDER_ID, status: 'fulfilled', confirmation_url: null }, 201),
      () => res({ products: [{ product_id: 'month1', price_kopecks: 150000, amount_kopecks: 0 }] }))
    renderBuy('/buy')
    await applyPromo('FREE')
    // Бесплатный новый доступ — прежние тексты.
    expect(await findPayBtn('Получить ключ')).toBeTruthy()
    expect(screen.getByText('Ключ покажем на следующей странице.')).toBeTruthy()
    // Бесплатное продление: нового ключа нет, слов об оплате нет.
    goRenew()
    const key = screen.getByLabelText(/Ключ, который нужно продлить/)
    fireEvent.change(key, { target: { value: 'tpk_' + 'c'.repeat(32) } })
    expect(payBtn('Продлить ключ')).toBeTruthy()
    expect(screen.getByText('Срок ключа продлим сразу.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Получить ключ' })).toBeNull()
    expect(screen.queryByText('Ключ покажем на следующей странице.')).toBeNull()
    // (строка про поддержку «…проблемам с оплатой…» — не про этот заказ, её не считаем)
    expect(screen.queryByText(/ЮKassa|после оплаты/)).toBeNull()
    // Платный тариф при том же ключе — платные тексты продления.
    fireEvent.click(card('+ 3 месяца'))
    expect(payBtn(/Продлить на 90 дней/)).toBeTruthy()
    expect(screen.getByText('Оплата через ЮKassa. Срок ключа продлим сразу после оплаты.')).toBeTruthy()
    // Назад на бесплатный тариф — заказ уходит с ключом и кодом.
    fireEvent.click(card('+ 1 месяц'))
    fireEvent.click(payBtn('Продлить ключ'))
    expect(await screen.findByText(`страница заказа ${ORDER_ID}`)).toBeTruthy()
    expect(orderBody(f)).toEqual({ email: EMAIL, product_id: 'month1', promo_code: 'FREE', renew_key: 'tpk_' + 'c'.repeat(32) })
  })

  it('продление: после ввода ключа заказ уходит как раньше', async () => {
    const f = stubFetch(() => res({ order_id: ORDER_ID, confirmation_url: 'https://yoomoney.ru/x' }, 201))
    renderBuy('/buy', { email: false })
    await screen.findByText('1 месяц рекомендаций')
    goRenew()
    fireEvent.change(screen.getByLabelText(/Ключ, который нужно продлить/), { target: { value: 'tpk_' + 'b'.repeat(32) } })
    fillEmail()
    fireEvent.click(payButton())
    await waitFor(() => expect(assign).toHaveBeenCalled())
    expect(orderBody(f)).toEqual({ email: EMAIL, product_id: 'month1', renew_key: 'tpk_' + 'b'.repeat(32) })
  })

  it('во второе поле нельзя вставить и перетащить текст, в первое — вставить можно', async () => {
    stubFetch(() => res({}))
    renderBuy('/buy', { email: false })
    await screen.findByText('1 месяц рекомендаций')
    // fireEvent возвращает false, если обработчик отменил действие по умолчанию.
    expect(fireEvent.paste(confirmInput())).toBe(false)
    expect(fireEvent.drop(confirmInput())).toBe(false)
    expect(fireEvent.paste(emailInput())).toBe(true)
  })

  it('«Оплатить» недоступна, пока адреса не совпадут; сравнение без пробелов и регистра', async () => {
    const f = stubFetch(() => res({ order_id: ORDER_ID, confirmation_url: 'https://yoomoney.ru/x' }, 201))
    renderBuy('/buy', { email: false })
    await screen.findByText('1 месяц рекомендаций')
    expect(payButton().disabled).toBe(true)
    fireEvent.change(emailInput(), { target: { value: EMAIL } })
    expect(payButton().disabled).toBe(true)
    fireEvent.change(confirmInput(), { target: { value: 'buyer.name@example.co' } })
    expect(payButton().disabled).toBe(true)
    // Второе поле ещё короче первого и не покинуто — человек ещё печатает.
    expect(screen.queryByText('Адреса не совпадают.')).toBeNull()
    fireEvent.blur(confirmInput())
    expect(screen.getByText('Адреса не совпадают.')).toBeTruthy()
    fireEvent.change(confirmInput(), { target: { value: '  BUYER.NAME@example.COM ' } })
    expect(payButton().disabled).toBe(false)
    expect(screen.queryByText('Адреса не совпадают.')).toBeNull()
    // Поле можно изменить и после совпадения — кнопка снова закрывается.
    fireEvent.change(emailInput(), { target: { value: 'other@example.com' } })
    expect(payButton().disabled).toBe(true)
    fireEvent.change(emailInput(), { target: { value: ` ${EMAIL}  ` } })
    fireEvent.click(payButton())
    await waitFor(() => expect(assign).toHaveBeenCalled())
    // В заказ уходит первое поле без пробелов по краям; формат проверяет шлюз.
    expect(orderBody(f)).toEqual({ email: EMAIL, product_id: 'month1' })
  })

  it('«Адреса не совпадают.» — не с первого символа, а когда второе поле догнало первое по длине', async () => {
    stubFetch(() => res({}))
    renderBuy('/buy', { email: false })
    await screen.findByText('1 месяц рекомендаций')
    fireEvent.change(emailInput(), { target: { value: 'ab@example.com' } })
    fireEvent.change(confirmInput(), { target: { value: 'x' } })
    expect(screen.queryByText('Адреса не совпадают.')).toBeNull()
    fireEvent.change(confirmInput(), { target: { value: 'ax@example.co' } })
    expect(screen.queryByText('Адреса не совпадают.')).toBeNull()
    // Та же длина, что у первого поля, — набор закончен.
    fireEvent.change(confirmInput(), { target: { value: 'ax@example.com' } })
    expect(screen.getByText('Адреса не совпадают.')).toBeTruthy()
    fireEvent.change(confirmInput(), { target: { value: 'ab@example.com' } })
    expect(screen.queryByText('Адреса не совпадают.')).toBeNull()
  })

  it('пустая почта — у кнопки пояснение, почему она недоступна; после ввода пояснения нет', async () => {
    stubFetch(() => res({}))
    renderBuy('/buy', { email: false })
    await screen.findByText('1 месяц рекомендаций')
    expect(payButton().disabled).toBe(true)
    const notes = screen.getAllByText('Укажите почту.')
    expect(notes).toHaveLength(1)
    const btns = payBtns(/Оплатить/)
    notes.forEach((n, i) => {
      expect(n.getAttribute('id')).toBeTruthy()
      expect(btns[i].getAttribute('aria-describedby')).toBe(n.getAttribute('id'))
    })
    fillEmail()
    expect(screen.queryByText('Укажите почту.')).toBeNull()
    for (const b of payBtns(/Оплатить/)) expect(b.getAttribute('aria-describedby')).toBeNull()
  })

  it('промокод длиннее 64 байт: ошибка под кнопкой', async () => {
    const f = stubFetch(() => res({}))
    renderBuy()
    await screen.findByText('1 месяц рекомендаций')
    fireEvent.change(screen.getByLabelText(/Промокод/), { target: { value: 'я'.repeat(33) } })
    fireEvent.click(payBtns(/Оплатить/)[0])
    await screen.findByText(/Промокод не подошёл/)
    expect(f.mock.calls.filter(c => c[0] === '/api/billing/orders')).toHaveLength(0)
  })

  it.each([
    ['пусто', '', ''],
    ['одни пробелы', '   ', '   '],
    ['длиннее 254 символов', 'a'.repeat(245) + '@example.com', 'a'.repeat(245) + '@example.com'],
  ])('%s → «Оплатить» недоступна, заказ не уходит', async (_, a, b) => {
    const f = stubFetch(() => res({ order_id: ORDER_ID, confirmation_url: 'https://yoomoney.ru/x' }, 201))
    renderBuy('/buy', { email: false })
    await screen.findByText('1 месяц рекомендаций')
    fillEmail(a, b)
    expect(payButton().disabled).toBe(true)
    fireEvent.click(payButton())
    await act(async () => {})
    expect(f.mock.calls.filter(c => c[0] === '/api/billing/orders')).toHaveLength(0)
  })

  it('бесплатный заказ («Получить ключ») тоже требует почту', async () => {
    stubFetch(() => res({}), () => res({ products: [{ product_id: 'month1', price_kopecks: 150000, amount_kopecks: 0 }] }))
    renderBuy('/buy', { email: false })
    await applyPromo('FREE')
    const btn = await findPayBtn('Получить ключ') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    fillEmail()
    expect(btn.disabled).toBe(false)
  })

  it.each([
    ['email_invalid', /Проверьте адрес почты/],
    ['email_required', /Укажите почту/],
  ])('400 %s → сообщение у поля почты, кнопка снова активна, правка поля его убирает', async (code, msg) => {
    stubFetch(() => res({ error: code }, 400))
    renderBuy()
    await pay()
    const alert = await screen.findByText(msg)
    // Сообщение — в блоке почты, рядом с полями, а не общей ошибкой под кнопкой.
    expect(alert.closest('.billing-email')).toBeTruthy()
    expect(alert.getAttribute('role')).toBe('alert')
    expect(payButton().disabled).toBe(false)
    expect(screen.queryByText(/Не удалось оформить заказ/)).toBeNull()
    // Сообщение об ошибке не повторяет адрес.
    expect(alert.textContent).not.toContain(EMAIL)
    fireEvent.change(emailInput(), { target: { value: 'new@example.com' } })
    expect(screen.queryByText(msg)).toBeNull()
  })

  it('почта не попадает в хранилища, cookie, URL, историю, заголовок, window.name, консоль и отправители событий', async () => {
    const consoles = (['log', 'info', 'warn', 'error', 'debug'] as const).map(m => vi.spyOn(console, m))
    const beacon = vi.fn(() => true)
    Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: beacon })
    let n = 0
    const f = stubFetch(() => (++n === 1 ? res({ error: 'email_invalid' }, 400)
      : n === 2 ? res({ error: 'gateway_unavailable' }, 502)
      : res({ order_id: ORDER_ID, confirmation_url: null }, 201)))
    const spies = spyStorageWrites()
    renderBuy('/buy?src=app')
    await pay()
    await screen.findByText(/Проверьте адрес почты/)
    fireEvent.click(payButton())
    await screen.findByText(/Не удалось оформить заказ/)
    fireEvent.click(payButton())
    expect(await screen.findByText(`страница заказа ${ORDER_ID}`)).toBeTruthy()

    // Журнал роутера видел и /buy, и переход на страницу заказа.
    expect(locations.some(l => l.startsWith('/buy?src=app'))).toBe(true)
    expect(locations.some(l => l.startsWith(`/order/${ORDER_ID}`))).toBe(true)
    for (const secret of [EMAIL, EMAIL.toLowerCase(), 'example.com']) {
      expect(leaked(spies, [secret])).toEqual([])
      expect(document.cookie).not.toContain(secret)
      expect(window.location.href).not.toContain(secret)
      expect(JSON.stringify(window.history.state ?? null)).not.toContain(secret)
      // Адреса и state роутера (путь, query, hash, state каждого перехода).
      expect(locations.join('\n').toLowerCase()).not.toContain(secret.toLowerCase())
      expect(locations.join('\n').toLowerCase()).not.toContain(encodeURIComponent(secret).toLowerCase())
      expect(document.title).not.toContain(secret)
      expect(window.name).not.toContain(secret)
      for (const c of consoles) expect(JSON.stringify(c.mock.calls).toLowerCase()).not.toContain(secret.toLowerCase())
    }
    expect(beacon).not.toHaveBeenCalled()
    expect(JSON.stringify(vi.mocked(track).mock.calls).toLowerCase()).not.toContain('example.com')
    expect(vi.mocked(reportRouteNext)).not.toHaveBeenCalled()
    // Сеть: почта только в ТЕЛЕ заказа, ни в одном URL и ни в каком другом теле.
    for (const [url, init] of f.mock.calls as unknown as [string, RequestInit | undefined][]) {
      expect(String(url).toLowerCase()).not.toContain('example.com')
      if (url !== '/api/billing/orders') expect(String(init?.body ?? '').toLowerCase()).not.toContain('example.com')
    }
  })
})
