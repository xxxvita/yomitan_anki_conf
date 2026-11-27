import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { BuyPage } from '../BuyPage'
import { spyStorageWrites, leaked } from './storage-probe'

// Продление по почте на странице покупки (спека 2026-11-21-renew-by-email-site.md).
// Страница получает флаг пропсом (по умолчанию — сборочная константа RENEW_BY_EMAIL).

const PRODUCTS = {
  products: [
    { id: 'month1', title: '1 месяц рекомендаций', price_kopecks: 150000, duration_days: 30, sort: 10 },
    { id: 'month3', title: '3 месяца рекомендаций', price_kopecks: 420000, duration_days: 90, sort: 20 },
  ],
}
const ORDER_ID = '0b6f3c1e-8a2d-4c5b-9e7f-1a2b3c4d5e6f'
const MAIL = '  Name@Mail.RU '
const MAIL_TRIMMED = 'Name@Mail.RU'
const KEY = 'tpk_' + 'a'.repeat(32)
const LINK_URL = '/api/billing/renew-link'

function res(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } }))
}

function stubFetch(linkResp: () => Promise<Response> = () => res({ sent: true, expires_at: '2026-11-24T10:00:00Z' })) {
  const f = vi.fn((url: string) => {
    if (url === '/api/billing/products') return res(PRODUCTS)
    if (url === LINK_URL) return linkResp()
    if (url === '/api/billing/orders') return res({ order_id: ORDER_ID, confirmation_url: 'https://pay.example/x' }, 201)
    return res({})
  })
  vi.stubGlobal('fetch', f)
  return f
}

function linkCalls(f: ReturnType<typeof stubFetch>) {
  return f.mock.calls.filter(c => c[0] === LINK_URL) as unknown as [string, RequestInit][]
}

function renderBuy(renewByEmail: boolean, path = '/buy#renew') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/buy" element={<BuyPage redirect={vi.fn()} renewByEmail={renewByEmail} />} />
        <Route path="/order/:id" element={<div>страница заказа</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

const LINK_BTN = 'Прислать ссылку для оплаты'

function renewInput(): HTMLInputElement {
  return document.querySelector('#renew input') as HTMLInputElement
}
async function typeRenew(v: string) {
  await screen.findByRole('radiogroup')
  fireEvent.change(renewInput(), { target: { value: v } })
}
function linkBtns(name: string | RegExp = LINK_BTN) {
  return screen.getAllByRole('button', { name }) as HTMLButtonElement[]
}

beforeEach(() => { window.scrollTo = vi.fn() as unknown as typeof window.scrollTo })
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('продление по почте: RENEW_BY_EMAIL = true', () => {
  it('подпись и подсказка поля: ключ или почта', async () => {
    stubFetch()
    renderBuy(true)
    await screen.findByRole('radiogroup')
    expect(screen.getByText('Ключ или почта, на которую он оформлен')).toBeTruthy()
    expect(renewInput().placeholder).toBe('tpk_… или name@mail.ru')
  })

  it('«@» в поле: почтовый путь — полей почты нет, одна кнопка «Прислать ссылку для оплаты»', async () => {
    stubFetch()
    renderBuy(true)
    await typeRenew(MAIL)
    expect(screen.queryByLabelText('Почта')).toBeNull()
    expect(screen.queryByLabelText('Повторите почту')).toBeNull()
    expect(linkBtns()).toHaveLength(1)
    linkBtns().forEach(b => expect(b.disabled).toBe(false))
  })

  it('клик: один POST с trimmed-почтой, тарифом и без renew_key; ответ «отправили» под кнопкой', async () => {
    const f = stubFetch()
    renderBuy(true)
    await typeRenew(MAIL)
    fireEvent.click(linkBtns()[0])
    expect(await screen.findByText(`Мы отправили ссылку для оплаты на ${MAIL_TRIMMED}. Ссылка действует 3 дня.`)).toBeTruthy()
    expect(screen.getByText(/проверьте папку «Спам»/)).toBeTruthy()
    const calls = linkCalls(f)
    expect(calls).toHaveLength(1)
    expect(JSON.parse(String(calls[0][1].body))).toEqual({ email: MAIL_TRIMMED, product_id: 'month1' })
    expect(f.mock.calls.some(c => c[0] === '/api/billing/orders')).toBe(false)
  })

  it('промокод и выбранный тариф уходят в запрос ссылки', async () => {
    const f = stubFetch()
    renderBuy(true)
    await typeRenew(MAIL)
    fireEvent.click(screen.getByText('+ 3 месяца').closest('[role="radio"]') as HTMLElement)
    fireEvent.change(screen.getByLabelText(/Промокод/), { target: { value: ' PROMO ' } })
    fireEvent.click(linkBtns()[0])
    await waitFor(() => expect(linkCalls(f)).toHaveLength(1))
    expect(JSON.parse(String(linkCalls(f)[0][1].body))).toEqual({ email: MAIL_TRIMMED, product_id: 'month3', promo_code: 'PROMO' })
  })

  it('двойной клик — один запрос', async () => {
    const f = stubFetch(() => new Promise<Response>(() => {}))
    renderBuy(true)
    await typeRenew(MAIL)
    const [top] = linkBtns()
    fireEvent.click(top)
    fireEvent.click(top)
    fireEvent.click(top)
    expect(linkCalls(f)).toHaveLength(1)
  })

  it('после «отправлено»: «Отправлено» недоступна 60 с, затем «Прислать ещё раз»', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const f = stubFetch()
    renderBuy(true)
    await typeRenew(MAIL)
    fireEvent.click(linkBtns()[0])
    await screen.findByText(/Мы отправили ссылку/)
    const locked = linkBtns('Отправлено')
    expect(locked).toHaveLength(1)
    locked.forEach(b => expect(b.disabled).toBe(true))
    await act(async () => { await vi.advanceTimersByTimeAsync(59_000) })
    expect(linkBtns('Отправлено')[0].disabled).toBe(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(1_500) })
    const again = linkBtns('Прислать ещё раз')
    expect(again[0].disabled).toBe(false)
    fireEvent.click(again[0])
    await waitFor(() => expect(linkCalls(f)).toHaveLength(2))
  })

  it('правка почты после отправки сбрасывает результат и блокировку', async () => {
    stubFetch()
    renderBuy(true)
    await typeRenew(MAIL)
    fireEvent.click(linkBtns()[0])
    await screen.findByText(/Мы отправили ссылку/)
    fireEvent.change(renewInput(), { target: { value: 'other@mail.ru' } })
    expect(screen.queryByText(/Мы отправили ссылку/)).toBeNull()
    expect(linkBtns()[0].disabled).toBe(false)
  })

  const FAILS: [string, number, unknown, Record<string, string>, RegExp][] = [
    ['нет ключа на почте', 404, { error: 'no_key_for_email' }, {}, /^На эту почту не оформлен ни один ключ\.$/],
    ['ключ не подходит тарифу', 404, { error: 'no_renewable_key_for_product' }, {}, /Ключ на этой почте нельзя продлить выбранным тарифом\. Напишите в поддержку: @FliboosterHelpUser_bot\./],
    ['голый 404 (подось выключена)', 404, {}, {}, /Не удалось отправить ссылку\. Попробуйте ещё раз немного позже\./],
    ['404 с чужим кодом', 404, { error: 'not_found' }, {}, /Не удалось отправить ссылку/],
    ['503 сбой хранилища ключей шлюза (Retry-After 2)', 503, { error: 'gateway_error' }, { 'Retry-After': '2' }, /Не удалось отправить ссылку/],
    ['503', 503, { error: 'mail_unavailable' }, {}, /Не удалось отправить ссылку/],
    ['500/502', 502, { error: 'gateway_unavailable' }, {}, /Не удалось отправить ссылку/],
    ['email_invalid', 400, { error: 'email_invalid' }, {}, /Проверьте адрес почты\./],
    ['429 с Retry-After', 429, { error: 'rate_limited' }, { 'Retry-After': '600' }, /Слишком много попыток\. Попробуйте через 10 мин\./],
    ['429 без Retry-After', 429, { error: 'rate_limited' }, {}, /Слишком много попыток\. Попробуйте позже\./],
    ['promo_invalid', 400, { error: 'promo_invalid' }, {}, /Промокод не подошёл/],
  ]
  for (const [name, status, body, headers, text] of FAILS) {
    it(`${name}: ${String(text)}`, async () => {
      stubFetch(() => res(body, status, headers))
      renderBuy(true)
      await typeRenew(MAIL)
      fireEvent.click(linkBtns()[0])
      expect(await screen.findByText(text)).toBeTruthy()
      // Ошибка не блокирует повтор.
      expect(linkBtns()[0].disabled).toBe(false)
    })
  }

  it('только два точных кода дают «нет ключа»; голый 404 и 5xx — нет', async () => {
    for (const [status, body] of [[404, {}], [503, { error: 'no_key_for_email' }], [500, {}]] as [number, unknown][]) {
      stubFetch(() => res(body, status))
      const { unmount } = renderBuy(true)
      await typeRenew(MAIL)
      fireEvent.click(linkBtns()[0])
      await screen.findByText(/Не удалось отправить ссылку/)
      expect(screen.queryByText(/не оформлен ни один ключ/)).toBeNull()
      expect(screen.queryByText(/нельзя продлить выбранным тарифом/)).toBeNull()
      unmount()
    }
  })

  it('сетевая ошибка → общий текст, повтор возможен', async () => {
    stubFetch(() => Promise.reject(new TypeError('net')))
    renderBuy(true)
    await typeRenew(MAIL)
    fireEvent.click(linkBtns()[0])
    expect(await screen.findByText(/Не удалось отправить ссылку/)).toBeTruthy()
    expect(linkBtns()[0].disabled).toBe(false)
  })

  it('ключ tpk_…: прежний путь — почта в форме, заказ с renew_key, письмо не запрашивается', async () => {
    const f = stubFetch()
    renderBuy(true)
    await typeRenew(KEY)
    expect(screen.getByLabelText('Почта')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Почта'), { target: { value: 'b@mail.ru' } })
    fireEvent.change(screen.getByLabelText('Повторите почту'), { target: { value: 'b@mail.ru' } })
    fireEvent.click(screen.getAllByRole('button', { name: /Продлить на/ })[0])
    await waitFor(() => expect(f.mock.calls.some(c => c[0] === '/api/billing/orders')).toBe(true))
    const call = f.mock.calls.find(c => c[0] === '/api/billing/orders') as unknown as [string, RequestInit]
    expect(JSON.parse(String(call[1].body))).toEqual({ email: 'b@mail.ru', product_id: 'month1', renew_key: KEY })
    expect(linkCalls(f)).toHaveLength(0)
  })

  it('мусор вместо ключа/почты: подсказка, кнопка недоступна, запросов нет', async () => {
    const f = stubFetch()
    renderBuy(true)
    await typeRenew('abc123')
    expect(screen.getAllByText('Укажите ключ (tpk_…) или почту.').length).toBeGreaterThan(0)
    screen.getAllByRole('button', { name: /Продлить на|Оплатить|Прислать/ }).forEach(b => expect((b as HTMLButtonElement).disabled).toBe(true))
    expect(linkCalls(f)).toHaveLength(0)
  })

  it('переключение на «Новый ключ» очищает почтовый путь; в заказ нового ключа ничего из поля не уходит', async () => {
    const f = stubFetch()
    renderBuy(true)
    await typeRenew(MAIL)
    fireEvent.click(linkBtns()[0])
    await screen.findByText(/Мы отправили ссылку/)
    fireEvent.click(screen.getByRole('tab', { name: 'Новый ключ' }))
    expect(screen.queryByText(/Мы отправили ссылку/)).toBeNull()
    expect(screen.getByLabelText('Почта')).toBeTruthy()
    // Вернулись в продление — поле пустое, ссылка не «отправлена».
    fireEvent.click(screen.getByRole('tab', { name: 'Продлить мой ключ' }))
    expect(renewInput().value).toBe('')
    expect(screen.queryByText('Отправлено')).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Новый ключ' }))
    fireEvent.change(screen.getByLabelText('Почта'), { target: { value: 'new@mail.ru' } })
    fireEvent.change(screen.getByLabelText('Повторите почту'), { target: { value: 'new@mail.ru' } })
    fireEvent.click(screen.getAllByRole('button', { name: /Оплатить/ })[0])
    await waitFor(() => expect(f.mock.calls.some(c => c[0] === '/api/billing/orders')).toBe(true))
    const call = f.mock.calls.find(c => c[0] === '/api/billing/orders') as unknown as [string, RequestInit]
    expect(JSON.parse(String(call[1].body))).toEqual({ email: 'new@mail.ru', product_id: 'month1' })
  })

  it('почта не попадает в хранилища', async () => {
    const probe = spyStorageWrites()
    stubFetch()
    renderBuy(true)
    await typeRenew(MAIL)
    fireEvent.click(linkBtns()[0])
    await screen.findByText(/Мы отправили ссылку/)
    expect(leaked(probe, [MAIL_TRIMMED])).toEqual([])
    probe.forEach(p => p.mockRestore())
  })
})

describe('продление по почте: RENEW_BY_EMAIL = false (инертно)', () => {
  it('подпись и поле как до фичи, про почту ни слова', async () => {
    stubFetch()
    renderBuy(false)
    await screen.findByRole('radiogroup')
    expect(screen.getByText('Ключ, который нужно продлить')).toBeTruthy()
    expect(renewInput().placeholder).toBe('tpk_…')
    expect(screen.queryByText(/на которую он оформлен/)).toBeNull()
    expect(screen.queryByText(LINK_BTN)).toBeNull()
  })

  it('ввод с «@»: подсказка «Укажите ключ (tpk_…).», кнопка недоступна, запросов нет', async () => {
    const f = stubFetch()
    renderBuy(false)
    await typeRenew(MAIL)
    expect(screen.getAllByText('Укажите ключ (tpk_…).').length).toBeGreaterThan(0)
    screen.getAllByRole('button', { name: /Продлить на|Оплатить/ }).forEach(b => expect((b as HTMLButtonElement).disabled).toBe(true))
    expect(linkCalls(f)).toHaveLength(0)
    expect(screen.getByLabelText('Почта')).toBeTruthy()
  })

  it('ключ уходит в заказ как раньше', async () => {
    const f = stubFetch()
    renderBuy(false)
    await typeRenew(KEY)
    fireEvent.change(screen.getByLabelText('Почта'), { target: { value: 'b@mail.ru' } })
    fireEvent.change(screen.getByLabelText('Повторите почту'), { target: { value: 'b@mail.ru' } })
    fireEvent.click(screen.getAllByRole('button', { name: /Продлить на/ })[0])
    await waitFor(() => expect(f.mock.calls.some(c => c[0] === '/api/billing/orders')).toBe(true))
    const call = f.mock.calls.find(c => c[0] === '/api/billing/orders') as unknown as [string, RequestInit]
    expect(JSON.parse(String(call[1].body))).toEqual({ email: 'b@mail.ru', product_id: 'month1', renew_key: KEY })
  })

  it('по умолчанию (без пропса) продление по почте включено: сборочная константа RENEW_BY_EMAIL = true', async () => {
    stubFetch()
    render(
      <MemoryRouter initialEntries={['/buy#renew']}>
        <Routes><Route path="/buy" element={<BuyPage redirect={vi.fn()} />} /></Routes>
      </MemoryRouter>,
    )
    await screen.findByRole('radiogroup')
    expect(screen.getByText('Ключ или почта, на которую он оформлен')).toBeTruthy()
    expect(screen.queryByText('Ключ, который нужно продлить')).toBeNull()
  })
})
