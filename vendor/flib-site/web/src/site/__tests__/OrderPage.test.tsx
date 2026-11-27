import { StrictMode, useEffect } from 'react'
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom'
import { OrderRoute } from '../OrderPage'
import { leaked, spyStorageWrites } from './storage-probe'
import { track } from '../telemetry'
import { reportRouteNext } from '../ab-events'

// Отправители поведенческих событий сайта — шпионы: ссылка привязки Telegram
// не должна уходить ни в один из них (см. блок tg_link_url ниже).
vi.mock('../telemetry', async (orig) => ({ ...(await orig<typeof import('../telemetry')>()), track: vi.fn() }))
vi.mock('../ab-events', () => ({ reportRouteNext: vi.fn() }))

const ID = '0b6f3c1e-8a2d-4c5b-9e7f-1a2b3c4d5e6f'
const KEY = 'tpk_0123456789abcdef0123456789abcdef'
const ID2 = '11111111-2222-4333-8444-555555555555'

function order(extra: Record<string, unknown> = {}) {
  return {
    order_id: ID, status: 'pending', product_id: 'month1', product_title: '1 месяц рекомендаций',
    duration_days: 30, amount_kopecks: 150000, key_ready: false, key_revealed: false, reveal_until: null,
    receipt_url: null, confirmation_url: 'https://yoomoney.ru/checkout/x', created_at: '2026-11-15T10:00:00Z',
    paid_at: null, ...extra,
  }
}

// Ответ без реального ввода-вывода: Response.json() под фейковыми таймерами ждёт настоящий tick.
function fake(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return Promise.resolve({ status, ok: status < 400, headers: new Headers(headers), json: async () => body } as unknown as Response)
}

function GoToSecond() {
  const navigate = useNavigate()
  return <button type="button" onClick={() => navigate(`/order/${ID2}`)}>другой заказ</button>
}

// Журнал всех адресов роутера (путь, query, hash, state). MemoryRouter не
// трогает window.location и window.history — сторож утечки смотрит сюда.
let locations: string[] = []
function LocationLog() {
  const loc = useLocation()
  useEffect(() => { locations.push(`${loc.pathname}${loc.search}${loc.hash} ${JSON.stringify(loc.state ?? null)}`) }, [loc])
  return null
}
function routerText(): string {
  expect(locations.length).toBeGreaterThan(0)
  return locations.join('\n')
}

function renderOrder() {
  locations = []
  return render(
    <MemoryRouter initialEntries={[`/order/${ID}`]}>
      <LocationLog />
      <GoToSecond />
      <Routes>
        <Route path="/order/:id" element={<OrderRoute />} />
        <Route path="/buy" element={<div>страница покупки</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

async function flush(ms = 0) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}

function orderCalls(f: ReturnType<typeof vi.fn>) {
  return f.mock.calls.filter(c => c[0] === `/api/billing/orders/${ID}`).length
}

let hidden = false

describe('OrderPage', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-15T10:05:00Z'))
    window.localStorage.clear()
    window.sessionStorage.clear()
    window.scrollTo = vi.fn()
    hidden = false
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') })
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('pending: «Ждём оплату», кнопка «Перейти к оплате», название и сумма из ответа', async () => {
    vi.stubGlobal('fetch', vi.fn(() => fake(order())))
    renderOrder()
    await flush()
    expect(screen.getByText('Ждём оплату')).toBeTruthy()
    const link = screen.getByRole('link', { name: 'Перейти к оплате' })
    expect(link.getAttribute('href')).toBe('https://yoomoney.ru/checkout/x')
    expect(screen.getByText(/1 месяц рекомендаций/)).toBeTruthy()
    expect(screen.getByText(/1\s500\s₽/)).toBeTruthy()
  })

  it('опрос: раз в 3 с первые 2 минуты, потом раз в 15 с', async () => {
    const f = vi.fn(() => fake(order()))
    vi.stubGlobal('fetch', f)
    renderOrder()
    await flush()
    expect(orderCalls(f)).toBe(1)
    await flush(3000)
    expect(orderCalls(f)).toBe(2)
    await flush(3000)
    expect(orderCalls(f)).toBe(3)
    // t=126 с: запросы шли в 0, 3, …, 120 (41 штука); после 120 с — шаг 15 с, следующий в 135.
    await flush(120_000)
    expect(orderCalls(f)).toBe(41)
    await flush(8_000)
    expect(orderCalls(f)).toBe(41)
    await flush(1_500)
    expect(orderCalls(f)).toBe(42)
    await flush(14_000)
    expect(orderCalls(f)).toBe(42)
    await flush(1_000)
    expect(orderCalls(f)).toBe(43)
  })

  it('во вкладке в фоне опрос стоит, при возврате — сразу запрос', async () => {
    const f = vi.fn(() => fake(order()))
    vi.stubGlobal('fetch', f)
    renderOrder()
    await flush()
    hidden = true
    document.dispatchEvent(new Event('visibilitychange'))
    await flush(30_000)
    expect(orderCalls(f)).toBe(1)
    hidden = false
    document.dispatchEvent(new Event('visibilitychange'))
    await flush()
    expect(orderCalls(f)).toBe(2)
  })

  it.each([
    ['refunded', {}, /Деньги возвращены, ключ отключён/],
    ['partially_refunded', {}, /Деньги возвращены, ключ отключён/],
    ['fulfilled', { key_ready: true }, /Ключ готов/],
  ])('конечный статус %s останавливает опрос', async (status, extra, text) => {
    const f = vi.fn(() => fake(order({ status, confirmation_url: null, ...extra })))
    vi.stubGlobal('fetch', f)
    renderOrder()
    await flush()
    expect(screen.getByText(text)).toBeTruthy()
    await flush(60_000)
    expect(orderCalls(f)).toBe(1)
  })

  it('canceled → ссылка «Попробовать снова» на /buy', async () => {
    vi.stubGlobal('fetch', vi.fn(() => fake(order({ status: 'canceled', confirmation_url: null }))))
    renderOrder()
    await flush()
    expect(screen.getByRole('link', { name: 'Попробовать снова' }).getAttribute('href')).toBe('/buy')
  })

  it('paid без key_ready → «готовим ключ», опрос продолжается и доходит до ключа', async () => {
    const f = vi.fn()
      .mockImplementationOnce(() => fake(order({ status: 'paid', confirmation_url: null, paid_at: '2026-11-15T10:04:00Z' })))
      .mockImplementation(() => fake(order({ status: 'fulfilled', key_ready: true, confirmation_url: null })))
    vi.stubGlobal('fetch', f)
    renderOrder()
    await flush()
    expect(screen.getByText(/Оплата прошла, готовим ключ/)).toBeTruthy()
    await flush(3000)
    expect(screen.getByRole('button', { name: 'Показать ключ' })).toBeTruthy()
  })

  it('fulfilled без нового ключа (продление) — сообщение о продлении, без кнопки показа', async () => {
    vi.stubGlobal('fetch', vi.fn(() => fake(order({ status: 'fulfilled', confirmation_url: null }))))
    renderOrder()
    await flush()
    expect(screen.getByText(/срок прежнего ключа продлён/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Показать ключ/ })).toBeNull()
  })

  it('reveal: ключ на экране, кнопка «Скопировать», предупреждение с reveal_until, ничего в storage', async () => {
    const f = vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith('/reveal')) {
        expect(init?.method).toBe('POST')
        return fake({ key: KEY, reveal_until: '2026-11-15T10:20:00Z' })
      }
      return fake(order({ status: 'fulfilled', key_ready: true, confirmation_url: null }))
    })
    vi.stubGlobal('fetch', f)
    const spies = spyStorageWrites()
    renderOrder()
    await flush(1_000) // reveal выдерживает 400 мс после опроса при открытии
    fireEvent.click(screen.getByRole('button', { name: 'Показать ключ' }))
    await flush()
    expect(screen.getByText(KEY)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Скопировать/ })).toBeTruthy()
    expect(screen.getByText(/сохраните ключ/i)).toBeTruthy()
    expect(screen.getByText(/только через поддержку/)).toBeTruthy()
    expect(leaked(spies, [KEY])).toEqual([])
    expect(window.location.href).not.toContain(KEY)
    expect(routerText()).not.toContain(KEY)
  })

  it('key_revealed и окно открыто → «Показать ключ ещё раз»', async () => {
    vi.stubGlobal('fetch', vi.fn(() => fake(order({
      status: 'fulfilled', key_ready: true, key_revealed: true, reveal_until: '2026-11-15T10:15:00Z', confirmation_url: null,
    }))))
    renderOrder()
    await flush()
    expect(screen.getByRole('button', { name: 'Показать ключ ещё раз' })).toBeTruthy()
  })

  it('key_revealed и окно истекло → «Ключ уже выдан» + поддержка', async () => {
    vi.stubGlobal('fetch', vi.fn(() => fake(order({
      status: 'fulfilled', key_ready: false, key_revealed: true, reveal_until: '2026-11-15T09:50:00Z', confirmation_url: null,
    }))))
    renderOrder()
    await flush()
    expect(screen.getByText('Ключ уже выдан')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'help@flib.club' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Показать ключ/ })).toBeNull()
  })

  it('reveal завис: через 65 с текст ошибки, кнопка снова доступна', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith('/reveal')) {
        return new Promise<Response>((_r, rej) => {
          init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))
        })
      }
      return fake(order({ status: 'fulfilled', key_ready: true, confirmation_url: null }))
    }))
    renderOrder()
    await flush(1_000)
    fireEvent.click(screen.getByRole('button', { name: 'Показать ключ' }))
    await flush(64_000)
    expect(screen.queryByText(/Не удалось получить ключ/)).toBeNull()
    await flush(1_500)
    expect(screen.getByText(/Не удалось получить ключ/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Показать ключ' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('reveal → 410 → «Ключ уже выдан»', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => url.endsWith('/reveal')
      ? fake({ error: 'key_already_issued' }, 410)
      : fake(order({ status: 'fulfilled', key_ready: true, key_revealed: true, reveal_until: '2026-11-15T10:15:00Z', confirmation_url: null }))))
    renderOrder()
    await flush(1_000)
    fireEvent.click(screen.getByRole('button', { name: 'Показать ключ ещё раз' }))
    await flush()
    expect(screen.getByText('Ключ уже выдан')).toBeTruthy()
  })

  it('чек: ссылка при receipt_url, иначе обещание', async () => {
    vi.stubGlobal('fetch', vi.fn(() => fake(order({ status: 'fulfilled', key_ready: true, confirmation_url: null, receipt_url: 'https://lknpd.nalog.ru/receipt/1' }))))
    renderOrder()
    await flush()
    const link = screen.getByRole('link', { name: 'Чек' })
    expect(link.getAttribute('href')).toBe('https://lknpd.nalog.ru/receipt/1')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    expect(link.getAttribute('target')).toBe('_blank')
  })

  it('чека ещё нет → «Чек появится здесь в течение 2 часов после оплаты»', async () => {
    vi.stubGlobal('fetch', vi.fn(() => fake(order({ status: 'paid', confirmation_url: null }))))
    renderOrder()
    await flush()
    expect(screen.getByText(/Чек появится здесь в течение 2 часов после оплаты/)).toBeTruthy()
  })

  it('401 order_token_missing → «откройте в том же браузере» + контакты, опрос стоп', async () => {
    const f = vi.fn(() => fake({ error: 'order_token_missing' }, 401))
    vi.stubGlobal('fetch', f)
    renderOrder()
    await flush()
    expect(screen.getByText(/Откройте эту страницу в том же браузере/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'help@flib.club' }).getAttribute('href')).toBe('mailto:help@flib.club')
    // Поддержка — бот помощи (решение владельца 2026-11-16), не функциональный @flibclub_bot.
    const help = screen.getByRole('link', { name: '@FliboosterHelpUser_bot' })
    expect(help.getAttribute('href')).toBe('https://t.me/FliboosterHelpUser_bot')
    expect(help.getAttribute('target')).toBe('_blank')
    expect(help.getAttribute('rel')).toBe('noopener noreferrer')
    expect(screen.queryByRole('link', { name: '@flibclub_bot' })).toBeNull()
    await flush(30_000)
    expect(orderCalls(f)).toBe(1)
  })

  it('404 → «Заказ не найден» + контакты, опрос стоп', async () => {
    const f = vi.fn(() => fake({ error: 'order_not_found' }, 404))
    vi.stubGlobal('fetch', f)
    renderOrder()
    await flush()
    expect(screen.getByText('Заказ не найден')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'help@flib.club' })).toBeTruthy()
    await flush(30_000)
    expect(orderCalls(f)).toBe(1)
  })

  it('сеть/5xx после успешного ответа → предупреждение, прежнее состояние остаётся, опрос идёт', async () => {
    const f = vi.fn()
      .mockImplementationOnce(() => fake(order()))
      .mockImplementationOnce(() => Promise.reject(new TypeError('Failed to fetch')))
      .mockImplementationOnce(() => fake({ error: 'gateway_unavailable' }, 502))
      .mockImplementation(() => fake(order({ status: 'canceled', confirmation_url: null })))
    vi.stubGlobal('fetch', f)
    renderOrder()
    await flush()
    await flush(3000)
    expect(screen.getByText(/Не удалось проверить заказ, обновите страницу/)).toBeTruthy()
    expect(screen.getByText('Ждём оплату')).toBeTruthy()
    await flush(3000)
    expect(screen.getByText('Ждём оплату')).toBeTruthy()
    await flush(3000)
    expect(screen.getByText(/Оплата не прошла/)).toBeTruthy()
    expect(screen.queryByText(/Не удалось проверить заказ/)).toBeNull()
  })

  it('canceled: «Оплата не прошла», опрос раз в 15 с ещё 30 минут (шлюз допускает canceled → paid)', async () => {
    const f = vi.fn(() => fake(order({ status: 'canceled', confirmation_url: null })))
    vi.stubGlobal('fetch', f)
    renderOrder()
    await flush()
    expect(screen.getByText(/Оплата не прошла/)).toBeTruthy()
    await flush(14_000)
    expect(orderCalls(f)).toBe(1)
    await flush(1_500)
    expect(orderCalls(f)).toBe(2)
    await flush(31 * 60_000)
    const stopped = orderCalls(f)
    expect(stopped).toBeLessThanOrEqual(122)
    await flush(10 * 60_000)
    expect(orderCalls(f)).toBe(stopped)
  })

  it('canceled → paid: страница подхватывает оплату', async () => {
    const f = vi.fn()
      .mockImplementationOnce(() => fake(order({ status: 'canceled', confirmation_url: null })))
      .mockImplementation(() => fake(order({ status: 'paid', confirmation_url: null })))
    vi.stubGlobal('fetch', f)
    renderOrder()
    await flush()
    expect(screen.getByText(/Оплата не прошла/)).toBeTruthy()
    await flush(15_000)
    expect(screen.getByText(/Оплата прошла, готовим ключ/)).toBeTruthy()
  })

  it('paid дольше 5 минут → контакты поддержки, опрос продолжается', async () => {
    const f = vi.fn(() => fake(order({ status: 'paid', confirmation_url: null })))
    vi.stubGlobal('fetch', f)
    renderOrder()
    await flush()
    expect(screen.queryByRole('link', { name: 'help@flib.club' })).toBeNull()
    await flush(4 * 60_000)
    expect(screen.queryByRole('link', { name: 'help@flib.club' })).toBeNull()
    await flush(75_000)
    expect(screen.getByRole('link', { name: 'help@flib.club' })).toBeTruthy()
    expect(screen.getByRole('link', { name: '@FliboosterHelpUser_bot' })).toBeTruthy()
    const n = orderCalls(f)
    await flush(15_000)
    expect(orderCalls(f)).toBe(n + 1)
  })

  it('confirmation_url javascript:/http: → кнопки оплаты нет', async () => {
    for (const url of ['javascript:alert(1)', 'http://yoomoney.ru/checkout/x']) {
      vi.stubGlobal('fetch', vi.fn(() => fake(order({ confirmation_url: url }))))
      const { unmount, container } = renderOrder()
      await flush()
      expect(screen.getByText('Ждём оплату')).toBeTruthy()
      expect(screen.queryByRole('link', { name: 'Перейти к оплате' })).toBeNull()
      expect(container.querySelector(`[href="${url}"]`)).toBeNull()
      unmount()
    }
  })

  it('receipt_url javascript:/http: → ссылки «Чек» нет', async () => {
    for (const url of ['javascript:alert(1)', 'http://lknpd.nalog.ru/receipt/1']) {
      vi.stubGlobal('fetch', vi.fn(() => fake(order({ status: 'fulfilled', key_ready: true, confirmation_url: null, receipt_url: url }))))
      const { unmount, container } = renderOrder()
      await flush()
      expect(screen.queryByRole('link', { name: 'Чек' })).toBeNull()
      expect(container.querySelector(`[href="${url}"]`)).toBeNull()
      unmount()
    }
  })

  it('после unmount новых запросов нет', async () => {
    const f = vi.fn(() => fake(order()))
    vi.stubGlobal('fetch', f)
    const { unmount } = renderOrder()
    await flush()
    const n = f.mock.calls.length
    unmount()
    await flush(60_000)
    expect(f.mock.calls.length).toBe(n)
  })

  it('смена id сбрасывает состояние (показанный ключ не переезжает на другой заказ)', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url.endsWith('/reveal')) return fake({ key: KEY, reveal_until: '2026-11-15T10:20:00Z' })
      if (url.includes(ID2)) return fake(order({ order_id: ID2, status: 'pending' }))
      return fake(order({ status: 'fulfilled', key_ready: true, confirmation_url: null }))
    }))
    renderOrder()
    await flush(1_000)
    fireEvent.click(screen.getByRole('button', { name: 'Показать ключ' }))
    await flush()
    expect(screen.getByText(KEY)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'другой заказ' }))
    await flush()
    expect(screen.queryByText(KEY)).toBeNull()
    expect(screen.getByText('Ждём оплату')).toBeTruthy()
  })

  it('запрос статуса висит дольше 20 с → предупреждение, опрос идёт дальше', async () => {
    const f = vi.fn((_url: string, init?: RequestInit) => {
      if (f.mock.calls.length === 1) return fake(order())
      return new Promise<Response>((_res, rej) => {
        init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))
      })
    })
    vi.stubGlobal('fetch', f)
    renderOrder()
    await flush()
    await flush(3_000)
    expect(orderCalls(f)).toBe(2)
    expect(screen.queryByText(/Не удалось проверить заказ/)).toBeNull()
    await flush(20_000)
    expect(screen.getByText(/Не удалось проверить заказ, обновите страницу/)).toBeTruthy()
    await flush(3_000)
    expect(orderCalls(f)).toBe(3)
  })

  it('reveal → 429 с Retry-After 600 → ожидание в минутах', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => url.endsWith('/reveal')
      ? fake({ error: 'rate_limited' }, 429, { 'Retry-After': '600' })
      : fake(order({ status: 'fulfilled', key_ready: true, confirmation_url: null }))))
    renderOrder()
    await flush(1_000)
    fireEvent.click(screen.getByRole('button', { name: 'Показать ключ' }))
    await flush()
    expect(screen.getByText(/через 10 мин/)).toBeTruthy()
  })

  describe('поля kind и key_purged (шлюз 0.35.1)', () => {
    it('fulfilled + kind=renewal → «Срок Вашего ключа продлён на N дней», без кнопки показа', async () => {
      vi.stubGlobal('fetch', vi.fn(() => fake(order({ status: 'fulfilled', kind: 'renewal', confirmation_url: null, duration_days: 90 }))))
      renderOrder()
      await flush()
      expect(screen.getByText('Срок Вашего ключа продлён на 90 дней')).toBeTruthy()
      expect(screen.queryByRole('button', { name: /Показать ключ/ })).toBeNull()
    })

    // key_expires_at (шлюз, OpenAPI 0.40.0) — текущий срок ключа. Решение
    // владельца 2026-11-17: заголовок «Оплата прошла, ключ продлён на N …» и
    // строка «Ключ активен до <дата, время>. Спасибо за доверие!» во времени
    // устройства покупателя. Часовой пояс теста зафиксирован (Asia/Tashkent,
    // UTC+5), поэтому проверка не зависит от машины.
    describe('продление с key_expires_at', () => {
      const prevTZ = process.env.TZ
      beforeAll(() => { process.env.TZ = 'Asia/Tashkent' })
      // Присвоение undefined записало бы в окружение строку "undefined".
      afterAll(() => { if (prevTZ === undefined) delete process.env.TZ; else process.env.TZ = prevTZ })

      it.each([
        [90, 'Оплата прошла, ключ продлён на 90 дней.'],
        [1, 'Оплата прошла, ключ продлён на 1 день.'],
        [3, 'Оплата прошла, ключ продлён на 3 дня.'],
      ])('%i дней → заголовок, дата и время окончания во времени устройства', async (days, heading) => {
        vi.stubGlobal('fetch', vi.fn(() => fake(order({
          status: 'fulfilled', kind: 'renewal', confirmation_url: null, duration_days: days, key_expires_at: '2026-12-16T09:37:00Z',
        }))))
        renderOrder()
        await flush()
        expect(screen.getByRole('heading', { level: 1, name: heading })).toBeTruthy()
        expect(screen.getByText('Ключ активен до 16 декабря 2026, 14:37. Спасибо за доверие!')).toBeTruthy()
        expect(screen.queryByText(/Срок Вашего ключа продлён/)).toBeNull()
        expect(screen.queryByRole('button', { name: /Показать ключ/ })).toBeNull()
      })

      it('бесплатное продление (amount 0) — без слов об оплате, строка срока остаётся', async () => {
        vi.stubGlobal('fetch', vi.fn(() => fake(order({
          status: 'fulfilled', kind: 'renewal', confirmation_url: null, duration_days: 30, amount_kopecks: 0,
          key_expires_at: '2026-12-16T09:37:00Z',
        }))))
        renderOrder()
        await flush()
        expect(screen.getByRole('heading', { level: 1, name: 'Ключ продлён на 30 дней.' })).toBeTruthy()
        expect(screen.queryByText(/Оплата прошла/)).toBeNull()
        expect(screen.getByText('Ключ активен до 16 декабря 2026, 14:37. Спасибо за доверие!')).toBeTruthy()
        expect(screen.getByText('Ключ остаётся прежним, вводить его заново не нужно.')).toBeTruthy()
      })

      // Решение владельца 2026-11-17: срок уже в прошлом (по часам устройства) —
      // «Срок ключа истёк <дата, время>.» и ссылка «Продлить снова» на /buy#renew.
      // Часы теста: 2026-11-15T10:05:00Z (beforeEach), пояс Asia/Tashkent.
      it('срок в прошлом → «Срок ключа истёк …» и «Продлить снова» на /buy#renew', async () => {
        vi.stubGlobal('fetch', vi.fn(() => fake(order({
          status: 'fulfilled', kind: 'renewal', confirmation_url: null, duration_days: 30, key_expires_at: '2026-11-01T09:37:00Z',
        }))))
        renderOrder()
        await flush()
        expect(screen.getByText('Срок ключа истёк 1 ноября 2026, 14:37.')).toBeTruthy()
        expect(screen.queryByText(/Ключ активен до/)).toBeNull()
        expect(screen.queryByText(/Спасибо за доверие/)).toBeNull()
        // Рядом с «Продлить снова» строка «ключ остаётся прежним» двусмысленна — её нет.
        expect(screen.queryByText('Ключ остаётся прежним, вводить его заново не нужно.')).toBeNull()
        const link = screen.getByRole('link', { name: 'Продлить снова' })
        expect(link.getAttribute('href')).toBe('/buy#renew')
        expect(link.getAttribute('target')).toBeNull()
        // Строка срока идёт перед ссылкой.
        const line = screen.getByText('Срок ключа истёк 1 ноября 2026, 14:37.')
        expect(line.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      })

      it('срок в будущем → «Ключ активен до …», ссылки «Продлить снова» нет', async () => {
        vi.stubGlobal('fetch', vi.fn(() => fake(order({
          status: 'fulfilled', kind: 'renewal', confirmation_url: null, key_expires_at: '2026-11-15T10:06:00Z',
        }))))
        renderOrder()
        await flush()
        expect(screen.getByText('Ключ активен до 15 ноября 2026, 15:06. Спасибо за доверие!')).toBeTruthy()
        expect(screen.getByText('Ключ остаётся прежним, вводить его заново не нужно.')).toBeTruthy()
        expect(screen.queryByText(/Срок ключа истёк/)).toBeNull()
        expect(screen.queryByRole('link', { name: 'Продлить снова' })).toBeNull()
      })

      it('срок ровно сейчас или минутой раньше — уже истёк (часы устройства в момент показа)', async () => {
        vi.stubGlobal('fetch', vi.fn(() => fake(order({
          status: 'fulfilled', kind: 'renewal', confirmation_url: null, key_expires_at: '2026-11-15T10:04:00Z',
        }))))
        renderOrder()
        await flush()
        expect(screen.getByText('Срок ключа истёк 15 ноября 2026, 15:04.')).toBeTruthy()
        expect(screen.getByRole('link', { name: 'Продлить снова' })).toBeTruthy()
      })

      it('«Продлить снова» ведёт на /buy в той же вкладке', async () => {
        vi.stubGlobal('fetch', vi.fn(() => fake(order({
          status: 'fulfilled', kind: 'renewal', confirmation_url: null, key_expires_at: '2026-11-01T09:37:00Z',
        }))))
        renderOrder()
        await flush()
        fireEvent.click(screen.getByRole('link', { name: 'Продлить снова' }))
        await flush()
        expect(screen.getByText('страница покупки')).toBeTruthy()
        expect(locations[locations.length - 1]).toMatch(/^\/buy#renew /)
      })

      it('платное продление (amount > 0) — «Оплата прошла, …»', async () => {
        vi.stubGlobal('fetch', vi.fn(() => fake(order({
          status: 'fulfilled', kind: 'renewal', confirmation_url: null, duration_days: 30, amount_kopecks: 150000,
          key_expires_at: '2026-12-16T09:37:00Z',
        }))))
        renderOrder()
        await flush()
        expect(screen.getByRole('heading', { level: 1, name: 'Оплата прошла, ключ продлён на 30 дней.' })).toBeTruthy()
      })

      it('дата со смещением и долями секунды тоже читается; полночь — 00:05', async () => {
        vi.stubGlobal('fetch', vi.fn(() => fake(order({
          status: 'fulfilled', kind: 'renewal', confirmation_url: null, key_expires_at: '2027-01-01T00:05:00.123456+05:00',
        }))))
        renderOrder()
        await flush()
        expect(screen.getByText('Ключ активен до 1 января 2027, 00:05. Спасибо за доверие!')).toBeTruthy()
      })

      it.each([
        ['нет поля', undefined],
        ['null', null],
        ['не дата', 'завтра'],
        ['дата без времени', '2026-12-16'],
        ['без часового пояса', '2026-12-16T09:37:00'],
        ['несуществующая дата', '2026-13-45T09:37:00Z'],
        ['число', 1797000000],
      ])('key_expires_at: %s → прежний текст продления', async (_, value) => {
        vi.stubGlobal('fetch', vi.fn(() => fake(order({
          status: 'fulfilled', kind: 'renewal', confirmation_url: null, duration_days: 90,
          ...(value === undefined ? {} : { key_expires_at: value }),
        }))))
        renderOrder()
        await flush()
        expect(screen.getByText('Срок Вашего ключа продлён на 90 дней')).toBeTruthy()
        expect(screen.queryByText(/Ключ активен до/)).toBeNull()
        expect(screen.queryByText(/Оплата прошла, ключ продлён/)).toBeNull()
      })

      it('новый ключ (kind=new) — поле не используется', async () => {
        vi.stubGlobal('fetch', vi.fn(() => fake(order({
          status: 'fulfilled', kind: 'new', key_ready: true, confirmation_url: null, key_expires_at: '2026-12-16T09:37:00Z',
        }))))
        renderOrder()
        await flush()
        expect(screen.getByRole('button', { name: 'Показать ключ' })).toBeTruthy()
        expect(screen.queryByText(/Ключ активен до/)).toBeNull()
      })
    })

    it('fulfilled + key_purged → «ключ больше нельзя открыть» + поддержка', async () => {
      vi.stubGlobal('fetch', vi.fn(() => fake(order({ status: 'fulfilled', kind: 'new', key_purged: true, confirmation_url: null }))))
      renderOrder()
      await flush()
      expect(screen.getByText('Ключ больше нельзя открыть')).toBeTruthy()
      expect(screen.getByText(/напишите в поддержку/)).toBeTruthy()
      expect(screen.getByRole('link', { name: 'help@flib.club' })).toBeTruthy()
      expect(screen.queryByRole('button', { name: /Показать ключ/ })).toBeNull()
    })

    // key_replaced (шлюз 0.41.0): поддержка перевыпустила ключ заказа. Вместо
    // блока ключа — текст владельца дословно; key_purged и 410 ошибкой не
    // показываются, показать ключ не предлагается.
    describe('key_replaced', () => {
      const REPLACED = 'Ключ этого заказа заменён поддержкой. Новый ключ выдан по Вашему обращению; ' +
        'если это были не Вы — напишите в @FliboosterHelpUser_bot'

      it('true → текст «ключ заменён» со ссылкой на бот поддержки, без показа ключа и без ошибки', async () => {
        const f = vi.fn((url: string) => url.endsWith('/reveal')
          ? fake({ error: 'key_already_issued' }, 410)
          : fake(order({
            status: 'fulfilled', kind: 'new', key_replaced: true, key_purged: true,
            key_ready: true, key_revealed: true, reveal_until: '2026-11-15T10:15:00Z', confirmation_url: null,
          })))
        vi.stubGlobal('fetch', f)
        renderOrder()
        await flush(1_000)
        const text = screen.getByText(/Ключ этого заказа заменён поддержкой/)
        expect(text.textContent).toBe(REPLACED)
        const link = screen.getByRole('link', { name: '@FliboosterHelpUser_bot' })
        expect(link.getAttribute('href')).toBe('https://t.me/FliboosterHelpUser_bot')
        expect(text.contains(link)).toBe(true)
        expect(screen.queryByRole('button', { name: /Показать ключ/ })).toBeNull()
        expect(screen.queryByText('Ключ больше нельзя открыть')).toBeNull()
        expect(screen.queryByText('Ключ уже выдан')).toBeNull()
        expect(screen.queryByRole('alert')).toBeNull()
        expect(f.mock.calls.some(c => String(c[0]).endsWith('/reveal'))).toBe(false)
      })

      it('true при kind=renewal → тот же текст вместо срока продления', async () => {
        vi.stubGlobal('fetch', vi.fn(() => fake(order({
          status: 'fulfilled', kind: 'renewal', key_replaced: true, key_expires_at: '2026-12-15T10:00:00Z', confirmation_url: null,
        }))))
        renderOrder()
        await flush()
        expect(screen.getByText(/Ключ этого заказа заменён поддержкой/).textContent).toBe(REPLACED)
        expect(screen.queryByText(/Ключ активен до/)).toBeNull()
      })

      it('false → прежние тексты (key_purged, продление)', async () => {
        vi.stubGlobal('fetch', vi.fn(() => fake(order({ status: 'fulfilled', kind: 'new', key_replaced: false, key_purged: true, confirmation_url: null }))))
        const { unmount } = renderOrder()
        await flush()
        expect(screen.getByText('Ключ больше нельзя открыть')).toBeTruthy()
        expect(screen.queryByText(/заменён поддержкой/)).toBeNull()
        unmount()
        vi.stubGlobal('fetch', vi.fn(() => fake(order({ status: 'fulfilled', kind: 'renewal', key_replaced: false, confirmation_url: null }))))
        renderOrder()
        await flush()
        expect(screen.getByText('Срок Вашего ключа продлён на 30 дней')).toBeTruthy()
        expect(screen.queryByText(/заменён поддержкой/)).toBeNull()
      })

      it('ссылка на бот поддержки открывается в новой вкладке без доступа к странице', async () => {
        vi.stubGlobal('fetch', vi.fn(() => fake(order({ status: 'fulfilled', kind: 'new', key_replaced: true, key_purged: true, confirmation_url: null }))))
        renderOrder()
        await flush()
        const link = screen.getByRole('link', { name: '@FliboosterHelpUser_bot' })
        expect(link.getAttribute('target')).toBe('_blank')
        expect(link.getAttribute('rel')).toBe('noopener noreferrer')
      })

      // Шлюз шлёт только true; всё остальное — как без поля.
      it.each([[null], ['true'], [1], [{}]])('key_replaced=%j → прежнее поведение', async (v) => {
        vi.stubGlobal('fetch', vi.fn(() => fake(order({ status: 'fulfilled', kind: 'new', key_replaced: v, key_ready: true, confirmation_url: null }))))
        renderOrder()
        await flush()
        expect(screen.queryByText(/заменён поддержкой/)).toBeNull()
        expect(screen.getByRole('button', { name: 'Показать ключ' })).toBeTruthy()
      })

      it('ключ уже на экране, перечитывание принесло key_replaced → ключ убран, текст «заменён»', async () => {
        let gets = 0
        vi.stubGlobal('fetch', vi.fn((url: string) => {
          if (url.endsWith('/reveal')) return fake({ key: KEY, reveal_until: '2026-11-15T10:20:00Z' })
          gets++
          return gets === 1
            ? fake(order({ status: 'fulfilled', kind: 'new', key_ready: true, confirmation_url: null }))
            : fake(order({ status: 'fulfilled', kind: 'new', key_replaced: true, key_revealed: true,
              reveal_until: '2026-11-15T10:20:00Z', confirmation_url: null }))
        }))
        renderOrder()
        await flush(1_000)
        fireEvent.click(screen.getByRole('button', { name: 'Показать ключ' }))
        await flush()
        expect(screen.getByText(KEY)).toBeTruthy()
        await flush(1_000) // перечитывание через 400 мс после reveal
        expect(document.body.textContent).not.toContain(KEY)
        expect(screen.getByText(/Ключ этого заказа заменён поддержкой/)).toBeTruthy()
        expect(screen.queryByRole('button', { name: /Скопировать|Показать ключ/ })).toBeNull()
      })

      // Показанный ключ стирается из состояния, как только заказ пришёл
      // заменённым: дальнейшие ответы его уже не вернут на экран. Третий ответ
      // без флага шлюз не даёт — он нужен, чтобы увидеть, что ключа в
      // состоянии больше нет.
      it('после key_replaced прежний ключ не возвращается на экран', async () => {
        const TG = 'https://t.me/flibclub_bot?start=lk_abcdefghijklmnopqrstuvwxyz'
        let gets = 0
        vi.stubGlobal('fetch', vi.fn((url: string) => {
          if (url.endsWith('/reveal')) return fake({ key: KEY, reveal_until: '2026-11-15T10:20:00Z' })
          gets++
          const base = { status: 'fulfilled', kind: 'new', key_revealed: true, reveal_until: '2026-11-15T10:20:00Z', confirmation_url: null, tg_link_url: TG }
          if (gets === 1) return fake(order({ ...base, key_revealed: false, reveal_until: null, key_ready: true }))
          if (gets === 2) return fake(order({ ...base, key_replaced: true }))
          return fake(order({ ...base, key_ready: true }))
        }))
        renderOrder()
        await flush(1_000)
        fireEvent.click(screen.getByRole('button', { name: 'Показать ключ' }))
        await flush(1_000)
        expect(screen.getByText(/Ключ этого заказа заменён поддержкой/)).toBeTruthy()
        // Возврат во вкладку перечитывает заказ, пока на экране кнопка Telegram.
        hidden = true
        act(() => { document.dispatchEvent(new Event('visibilitychange')) })
        hidden = false
        act(() => { document.dispatchEvent(new Event('visibilitychange')) })
        await flush(2_000)
        expect(gets).toBe(3)
        expect(document.body.textContent).not.toContain(KEY)
        expect(screen.getByRole('button', { name: 'Показать ключ ещё раз' })).toBeTruthy()
      })

      // Вкладка открыта до перевыпуска: «Показать ключ» → 410. Страница
      // перечитывает заказ и показывает «заменён», а не «время показа закончилось».
      it('старая вкладка: reveal → 410 → перечитывание → текст «заменён»', async () => {
        let gets = 0
        const f = vi.fn((url: string) => {
          if (url.endsWith('/reveal')) return fake({ error: 'key_already_issued' }, 410)
          gets++
          return gets === 1
            ? fake(order({ status: 'fulfilled', kind: 'new', key_ready: true, confirmation_url: null }))
            : fake(order({ status: 'fulfilled', kind: 'new', key_replaced: true, key_purged: true, confirmation_url: null }))
        })
        vi.stubGlobal('fetch', f)
        renderOrder()
        await flush(1_000)
        fireEvent.click(screen.getByRole('button', { name: 'Показать ключ' }))
        await flush(1_000)
        expect(gets).toBe(2)
        expect(screen.getByText(/Ключ этого заказа заменён поддержкой/)).toBeTruthy()
        expect(screen.queryByText('Ключ уже выдан')).toBeNull()
      })

      // Почту после перевыпуска не просим: копию ключа по этому заказу шлюз
      // уже не пришлёт.
      it('true + contact_status=deferred → формы «Оставьте почту» нет', async () => {
        vi.stubGlobal('fetch', vi.fn(() => fake(order({
          status: 'fulfilled', kind: 'new', key_replaced: true, key_purged: true, contact_status: 'deferred', confirmation_url: null,
        }))))
        renderOrder()
        await flush()
        expect(screen.getByText(/Ключ этого заказа заменён поддержкой/)).toBeTruthy()
        expect(screen.queryByText('Оставьте почту')).toBeNull()
        expect(screen.queryByLabelText('Почта')).toBeNull()
      })

      it('поля нет → прежнее поведение: кнопка показа ключа', async () => {
        vi.stubGlobal('fetch', vi.fn(() => fake(order({ status: 'fulfilled', kind: 'new', key_ready: true, confirmation_url: null }))))
        renderOrder()
        await flush()
        expect(screen.getByRole('button', { name: 'Показать ключ' })).toBeTruthy()
        expect(screen.queryByText(/заменён поддержкой/)).toBeNull()
      })
    })

    it('kind=new с key_ready (продлеваемый ключ исчез, выдан новый) → кнопка показа', async () => {
      vi.stubGlobal('fetch', vi.fn(() => fake(order({ status: 'fulfilled', kind: 'new', key_ready: true, confirmation_url: null }))))
      renderOrder()
      await flush()
      expect(screen.getByRole('button', { name: 'Показать ключ' })).toBeTruthy()
    })

    it('kind=new без ключа и без стирания → не текст про продление, а поддержка', async () => {
      vi.stubGlobal('fetch', vi.fn(() => fake(order({ status: 'fulfilled', kind: 'new', key_purged: false, confirmation_url: null }))))
      renderOrder()
      await flush()
      expect(screen.queryByText(/срок прежнего ключа продлён/)).toBeNull()
      expect(screen.getByRole('link', { name: 'help@flib.club' })).toBeTruthy()
    })
  })

  it('бесплатный заказ (amount 0) выдан: текста про чек нет', async () => {
    vi.stubGlobal('fetch', vi.fn(() => fake(order({ status: 'fulfilled', key_ready: true, amount_kopecks: 0, confirmation_url: null }))))
    renderOrder()
    await flush()
    expect(screen.getByText('Ключ готов')).toBeTruthy()
    expect(screen.queryByText(/Чек появится/)).toBeNull()
  })

  it('платный заказ без receipt_url: текст про чек остаётся', async () => {
    vi.stubGlobal('fetch', vi.fn(() => fake(order({ status: 'fulfilled', key_ready: true, confirmation_url: null }))))
    renderOrder()
    await flush()
    expect(screen.getByText(/Чек появится здесь в течение 2 часов после оплаты/)).toBeTruthy()
  })

  it('бесплатный заказ в created: «Готовим ключ…», без «Ждём оплату» и «Перейти к оплате»', async () => {
    vi.stubGlobal('fetch', vi.fn(() => fake(order({ status: 'created', amount_kopecks: 0, confirmation_url: null }))))
    renderOrder()
    await flush()
    expect(screen.getByText('Готовим ключ…')).toBeTruthy()
    expect(screen.queryByText('Ждём оплату')).toBeNull()
    expect(screen.queryByRole('link', { name: 'Перейти к оплате' })).toBeNull()
  })

  it('бесплатный заказ в paid: «Готовим ключ…» вместо «Оплата прошла»', async () => {
    vi.stubGlobal('fetch', vi.fn(() => fake(order({ status: 'paid', amount_kopecks: 0, confirmation_url: null }))))
    renderOrder()
    await flush()
    expect(screen.getByText('Готовим ключ…')).toBeTruthy()
    expect(screen.queryByText(/Оплата прошла/)).toBeNull()
  })

  it('нет суммы в ответе ≠ бесплатно: created → «Ждём оплату»', async () => {
    const o = order({ status: 'created' }) as Record<string, unknown>
    delete o.amount_kopecks
    vi.stubGlobal('fetch', vi.fn(() => fake(o)))
    renderOrder()
    await flush()
    expect(screen.getByText('Ждём оплату')).toBeTruthy()
    expect(screen.queryByText('Готовим ключ…')).toBeNull()
  })

  it('нет суммы в ответе: fulfilled → строка про чек на месте', async () => {
    const o = order({ status: 'fulfilled', key_ready: true, confirmation_url: null }) as Record<string, unknown>
    delete o.amount_kopecks
    vi.stubGlobal('fetch', vi.fn(() => fake(o)))
    renderOrder()
    await flush()
    expect(screen.getByText(/Чек появится здесь/)).toBeTruthy()
  })

  it('бесплатный created: «страница обновится сама», через 5 минут — подсказка про поддержку', async () => {
    vi.stubGlobal('fetch', vi.fn(() => fake(order({ status: 'created', amount_kopecks: 0, confirmation_url: null }))))
    renderOrder()
    await flush()
    expect(screen.getByText(/Страница обновится сама/)).toBeTruthy()
    expect(screen.queryByText(/дольше обычного/)).toBeNull()
    await flush(5 * 60_000 + 20_000)
    expect(screen.getByText(/дольше обычного/)).toBeTruthy()
  })

  it('бесплатный выданный заказ: «Заказ оформлен», без «Оплата прошла»', async () => {
    vi.stubGlobal('fetch', vi.fn(() => fake(order({ status: 'fulfilled', key_ready: false, kind: 'new', amount_kopecks: 0, confirmation_url: null }))))
    renderOrder()
    await flush()
    expect(screen.getByText(/Заказ оформлен/)).toBeTruthy()
    expect(screen.queryByText(/Оплата прошла/)).toBeNull()
  })

  describe('кнопка «Привязать Telegram» (tg_link_url, шлюз 0.38.0)', () => {
    const TG = 'https://t.me/flibclub_bot?start=lk_abcdefghijklmnopqrstuvwxyz'
    // Перед «%» — неразрывный пробел U+00A0: знак не отрывается от числа.
    const NOTE = 'бот напомнит ключ, если Вы его потеряете, и даст скидку 5 % на продление за подписку на канал @flibclub'
    // Окно показа открыто: шлюз шлёт ссылку только после первого reveal.
    const revealed = { status: 'fulfilled', kind: 'new', key_ready: true, key_revealed: true, reveal_until: '2026-11-15T10:15:00Z', confirmation_url: null }

    it.each([
      ['платный', 150000],
      ['бесплатный', 0],
    ])('%s заказ с полем → ссылка-кнопка в новой вкладке и подпись', async (_name, amount) => {
      vi.stubGlobal('fetch', vi.fn(() => fake(order({ ...revealed, amount_kopecks: amount, tg_link_url: TG }))))
      renderOrder()
      await flush()
      const link = screen.getByRole('link', { name: 'Привязать Telegram' })
      expect(link.getAttribute('href')).toBe(TG)
      expect(link.getAttribute('target')).toBe('_blank')
      expect(link.getAttribute('rel')).toBe('noopener noreferrer')
      // textContent без нормализации пробелов: U+00A0 перед «%» на месте.
      expect(screen.getByText(/бот напомнит ключ/).textContent).toBe(NOTE)
    })

    it('другое имя бота по форме шлюза → кнопка есть', async () => {
      const other = 'https://t.me/Flib_Test2?start=lk_abcdefghijklmnopqrstuvwx27'
      vi.stubGlobal('fetch', vi.fn(() => fake(order({ ...revealed, tg_link_url: other }))))
      renderOrder()
      await flush()
      expect(screen.getByRole('link', { name: 'Привязать Telegram' }).getAttribute('href')).toBe(other)
    })

    it('без поля (продление, возврат, уже привязан, функция выключена, старый шлюз) → кнопки нет', async () => {
      for (const extra of [revealed, { status: 'fulfilled', kind: 'renewal', confirmation_url: null }, { status: 'refunded', confirmation_url: null }]) {
        vi.stubGlobal('fetch', vi.fn(() => fake(order(extra))))
        const { unmount } = renderOrder()
        await flush()
        expect(screen.queryByRole('link', { name: 'Привязать Telegram' })).toBeNull()
        expect(screen.queryByText(/бот напомнит ключ/)).toBeNull()
        unmount()
      }
    })

    it('не https://t.me/<бот>?start=lk_<26 base32> → кнопки нет и значения нет ни в одном href', async () => {
      const T = 'abcdefghijklmnopqrstuvwxyz' // 26 символов base32 в нижнем регистре
      const bad: unknown[] = [
        'javascript:alert(1)', 'http://t.me/flibclub_bot?start=lk_x', 'https://t.me.evil.example/x',
        'https://evil.example/?u=https://t.me/x', 'https://t.me@evil.example/x', ' https://t.me/flibclub_bot?start=lk_x',
        'HTTPS://T.ME/flibclub_bot', 'https://t.me:8443/flibclub_bot', 'https://t.me/', '', 42, null, { href: TG },
        // Формат токена шлюза: lk_ + ровно 26 символов [a-z2-7].
        'https://t.me/flibclub_bot?start=lk_x', `https://t.me/flibclub_bot?start=xx_${T}`, `https://t.me/flibclub_bot?start=${T}`,
        `https://t.me/flibclub_bot?start=lk_${T.slice(1)}`, `https://t.me/flibclub_bot?start=lk_${T}a`,
        `https://t.me/flibclub_bot?start=lk_${T.toUpperCase()}`, `https://t.me/flibclub_bot?start=lk_${T.slice(1)}1`,
        `https://t.me/flibclub_bot?start=lk_${T.slice(1)}8`, `https://t.me/flibclub_bot?start=lk_${T.slice(1)}-`,
        `https://t.me/flibclub_bot?start=lk_${T}&x=1`, `https://t.me/flibclub_bot?start=lk_${T}#f`, `${TG}\n`,
        // Имя бота: буква, затем 3..31 символов [A-Za-z0-9_].
        `https://t.me/1bot?start=lk_${T}`, `https://t.me/_bot?start=lk_${T}`, `https://t.me/bot?start=lk_${T}`,
        `https://t.me/${'b'.repeat(33)}?start=lk_${T}`, `https://t.me/flib-bot?start=lk_${T}`, `https://t.me/?start=lk_${T}`,
      ]
      for (const v of bad) {
        vi.stubGlobal('fetch', vi.fn(() => fake(order({ ...revealed, tg_link_url: v }))))
        const { unmount, container } = renderOrder()
        await flush()
        expect(screen.getByRole('button', { name: 'Показать ключ ещё раз' })).toBeTruthy()
        expect(screen.queryByRole('link', { name: 'Привязать Telegram' })).toBeNull()
        const hrefs = Array.from(container.querySelectorAll('[href]'), a => a.getAttribute('href'))
        if (typeof v === 'string' && v) expect(hrefs).not.toContain(v)
        unmount()
      }
    })

    it('поле появляется после первого показа ключа → страница перечитывает заказ и показывает кнопку', async () => {
      const f = vi.fn((url: string) => {
        if (url.endsWith('/reveal')) return fake({ key: KEY, reveal_until: '2026-11-15T10:20:00Z' })
        // До reveal окна нет и ссылки нет; после — шлюз её отдаёт.
        const afterReveal = f.mock.calls.some(c => String(c[0]).endsWith('/reveal'))
        return fake(order(afterReveal
          ? { ...revealed, reveal_until: '2026-11-15T10:20:00Z', tg_link_url: TG }
          : { status: 'fulfilled', kind: 'new', key_ready: true, confirmation_url: null }))
      })
      vi.stubGlobal('fetch', f)
      renderOrder()
      await flush()
      expect(screen.queryByRole('link', { name: 'Привязать Telegram' })).toBeNull()
      // Опрос на fulfilled остановлен: без перечитывания кнопка не появилась бы.
      await flush(60_000)
      expect(orderCalls(f)).toBe(1)
      fireEvent.click(screen.getByRole('button', { name: 'Показать ключ' }))
      await flush()
      expect(screen.getByText(KEY)).toBeTruthy()
      // Гейт BFF — 250 мс на адрес, общий для reveal и чтения заказа: раньше
      // 400 мс страница заказ не перечитывает.
      await flush(399)
      expect(orderCalls(f)).toBe(1)
      await flush(1)
      expect(orderCalls(f)).toBe(2)
      expect(screen.getByRole('link', { name: 'Привязать Telegram' }).getAttribute('href')).toBe(TG)
      await flush(60_000)
      expect(orderCalls(f)).toBe(2)
    })

    function revealFlow(afterReveal: Array<() => Promise<Response>>) {
      let i = 0
      let revealedYet = false
      return vi.fn((url: string) => {
        if (url.endsWith('/reveal')) {
          revealedYet = true
          return fake({ key: KEY, reveal_until: '2026-11-15T10:20:00Z' })
        }
        if (!revealedYet) return fake(order({ status: 'fulfilled', kind: 'new', key_ready: true, confirmation_url: null }))
        const next = afterReveal[Math.min(i, afterReveal.length - 1)]
        i++
        return next()
      })
    }
    const withLink = () => fake(order({ ...revealed, reveal_until: '2026-11-15T10:20:00Z', tg_link_url: TG }))

    it('первое перечитывание получило 429 → повтор через Retry-After, кнопка появляется', async () => {
      const f = revealFlow([() => fake({ error: 'rate_limited', retry_after_sec: 1 }, 429, { 'Retry-After': '1' }), withLink])
      vi.stubGlobal('fetch', f)
      renderOrder()
      await flush(1_000)
      fireEvent.click(screen.getByRole('button', { name: 'Показать ключ' }))
      await flush(400)
      expect(orderCalls(f)).toBe(2)
      expect(screen.queryByRole('link', { name: 'Привязать Telegram' })).toBeNull()
      await flush(999)
      expect(orderCalls(f)).toBe(2)
      await flush(1)
      expect(orderCalls(f)).toBe(3)
      expect(screen.getByRole('link', { name: 'Привязать Telegram' }).getAttribute('href')).toBe(TG)
    })

    it('сбои перечитывания: повторы через 1, 2, 4 с, затем страница сдаётся', async () => {
      const f = revealFlow([() => fake({ error: 'gateway_unavailable' }, 502)])
      vi.stubGlobal('fetch', f)
      renderOrder()
      await flush(1_000)
      fireEvent.click(screen.getByRole('button', { name: 'Показать ключ' }))
      await flush(400)
      expect(orderCalls(f)).toBe(2)
      await flush(1000)
      expect(orderCalls(f)).toBe(3)
      await flush(2000)
      expect(orderCalls(f)).toBe(4)
      await flush(4000)
      expect(orderCalls(f)).toBe(5)
      await flush(10 * 60_000)
      expect(orderCalls(f)).toBe(5)
      expect(screen.getByText(KEY)).toBeTruthy()
    })

    it('уход со страницы во время ожидания повтора → таймеры сняты, запросов больше нет', async () => {
      const f = revealFlow([() => fake({ error: 'rate_limited' }, 429)])
      vi.stubGlobal('fetch', f)
      const { unmount } = renderOrder()
      await flush(1_000)
      fireEvent.click(screen.getByRole('button', { name: 'Показать ключ' }))
      await flush(400)
      const n = f.mock.calls.length
      unmount()
      await flush(60_000)
      expect(f.mock.calls.length).toBe(n)
    })

    it('уход до первого перечитывания (400 мс) → запроса нет', async () => {
      const f = revealFlow([withLink])
      vi.stubGlobal('fetch', f)
      const { unmount } = renderOrder()
      await flush(1_000)
      fireEvent.click(screen.getByRole('button', { name: 'Показать ключ' }))
      await flush(100)
      unmount()
      await flush(60_000)
      expect(orderCalls(f)).toBe(1)
    })

    it('вкладка снова видна, пока кнопка на экране → заказ перечитывается, использованная ссылка исчезает', async () => {
      let linked = false
      const f = vi.fn(() => fake(order(linked ? revealed : { ...revealed, tg_link_url: TG })))
      vi.stubGlobal('fetch', f)
      renderOrder()
      await flush()
      expect(screen.getByRole('link', { name: 'Привязать Telegram' })).toBeTruthy()
      // Пользователь ушёл в Telegram и привязал ключ.
      linked = true
      hidden = true
      document.dispatchEvent(new Event('visibilitychange'))
      await flush(5_000)
      expect(orderCalls(f)).toBe(1)
      hidden = false
      document.dispatchEvent(new Event('visibilitychange'))
      await flush()
      expect(orderCalls(f)).toBe(2)
      expect(screen.queryByRole('link', { name: 'Привязать Telegram' })).toBeNull()
      // Кнопки нет — новые возвраты во вкладку заказ не читают.
      hidden = true
      document.dispatchEvent(new Event('visibilitychange'))
      hidden = false
      document.dispatchEvent(new Event('visibilitychange'))
      await flush(5_000)
      expect(orderCalls(f)).toBe(2)
    })

    it('возврат во вкладку сразу после запроса → перечитывание выдерживает 400 мс', async () => {
      const f = vi.fn(() => fake(order({ ...revealed, tg_link_url: TG })))
      vi.stubGlobal('fetch', f)
      renderOrder()
      await flush(100)
      hidden = true
      document.dispatchEvent(new Event('visibilitychange'))
      hidden = false
      document.dispatchEvent(new Event('visibilitychange'))
      await flush(299)
      expect(orderCalls(f)).toBe(1)
      await flush(1)
      expect(orderCalls(f)).toBe(2)
    })

    // Ответ, который приходит через ms после запроса (или отменяется вместе с ним).
    function slow(body: unknown, ms: number, signal?: AbortSignal | null) {
      return new Promise<Response>((res, rej) => {
        const t = setTimeout(() => { void fake(body).then(res) }, ms)
        signal?.addEventListener('abort', () => { clearTimeout(t); rej(new DOMException('aborted', 'AbortError')) })
      })
    }
    function returnToTab() {
      hidden = true
      document.dispatchEvent(new Event('visibilitychange'))
      hidden = false
      document.dispatchEvent(new Event('visibilitychange'))
    }

    it('частые возвраты во вкладку, пока запрос в полёте → запросы не чаще раза в 400 мс', async () => {
      const sentAt: number[] = []
      const f = vi.fn((url: string, init?: RequestInit) => {
        if (url === `/api/billing/orders/${ID}`) sentAt.push(Date.now())
        // Первый ответ (опрос) — сразу, дальше — медленный: секунда.
        return sentAt.length === 1 ? fake(order({ ...revealed, tg_link_url: TG })) : slow(order({ ...revealed, tg_link_url: TG }), 1000, init?.signal)
      })
      vi.stubGlobal('fetch', f)
      renderOrder()
      await flush(500)
      returnToTab()
      await flush(0)
      expect(sentAt.length).toBe(2)
      // Запрос в полёте; пользователь щёлкает вкладками каждые 30 мс до ответа и после него.
      for (let t = 0; t < 2000; t += 30) {
        returnToTab()
        await flush(30)
      }
      await flush(5_000)
      for (let i = 1; i < sentAt.length; i++) expect(sentAt[i] - sentAt[i - 1]).toBeGreaterThanOrEqual(400)
      // Запрос в полёте не перезапускается: второй ушёл в 500 мс, третий — не раньше 400 мс после ответа (1500 мс).
      expect(sentAt[2] - sentAt[1]).toBeGreaterThanOrEqual(1400)
      expect(sentAt.length).toBeLessThanOrEqual(4)
    })

    it('часы ушли назад → пауза перед перечитыванием не больше 400 мс', async () => {
      const f = vi.fn(() => fake(order({ ...revealed, tg_link_url: TG })))
      vi.stubGlobal('fetch', f)
      renderOrder()
      await flush()
      vi.setSystemTime(new Date('2026-11-15T09:05:00Z'))
      returnToTab()
      await flush(400)
      expect(orderCalls(f)).toBe(2)
    })

    // gatedFetch — как BFF: один гейт на чтение заказа и показ ключа, 250 мс на
    // адрес (allowIP: время пишет только пропущенный запрос). Ответ — через
    // delay(url) мс. log — что ушло, когда и с каким исходом.
    function gatedFetch(delay: (url: string) => number, orderBody: () => unknown) {
      let lastAllowed = -Infinity
      const log: { url: string; at: number; status: number }[] = []
      const f = vi.fn((url: string, init?: RequestInit) => {
        const at = Date.now()
        if (at - lastAllowed < 250) {
          log.push({ url, at, status: 429 })
          return fake({ error: 'rate_limited', retry_after_sec: 1 }, 429, { 'Retry-After': '1' })
        }
        lastAllowed = at
        log.push({ url, at, status: 200 })
        const body = url.endsWith('/reveal') ? { key: KEY, reveal_until: '2026-11-15T10:20:00Z' } : orderBody()
        const ms = delay(url)
        return ms ? slow(body, ms, init?.signal) : fake(body)
      })
      return { f, log }
    }

    it.each([
      ['ответ на чтение сразу', 0],
      ['чтение ещё в полёте', 300],
    ])('возврат во вкладку, через 100 мс «Показать ключ» (%s) → reveal не раньше 400 мс после чтения, ключ на экране', async (_n, getDelay) => {
      // Первый запрос (опрос при открытии) отвечает сразу, дальнейшие чтения — через getDelay.
      const reads = () => log.filter(e => !e.url.endsWith('/reveal')).length
      const { f, log } = gatedFetch(url => (url.endsWith('/reveal') || reads() <= 1 ? 0 : getDelay), () => order({ ...revealed, tg_link_url: TG }))
      vi.stubGlobal('fetch', f)
      renderOrder()
      await flush(3_000)
      returnToTab()
      await flush(0)
      const getAt = log[log.length - 1].at
      expect(log[log.length - 1].url).toBe(`/api/billing/orders/${ID}`)
      await flush(100)
      fireEvent.click(screen.getByRole('button', { name: 'Показать ключ ещё раз' }))
      await flush(0)
      // Пока выдерживается пауза — кнопка заблокирована, ошибки нет.
      expect((screen.getByRole('button', { name: 'Показать ключ ещё раз' }) as HTMLButtonElement).disabled).toBe(true)
      await flush(2_000)
      const reveal = log.filter(e => e.url.endsWith('/reveal'))
      expect(reveal.length).toBe(1)
      expect(reveal[0].at - getAt).toBeGreaterThanOrEqual(400)
      expect(log.filter(e => e.status === 429)).toEqual([])
      expect(screen.getByText(KEY)).toBeTruthy()
      expect(screen.queryByText(/Слишком много попыток/)).toBeNull()
    })

    it.each([
      ['reveal отвечает за 100 мс', 100],
      ['reveal отвечает за 1 с', 1000],
    ])('возврат во вкладку, пока reveal в полёте (%s) → ровно одно чтение, не раньше 400 мс после ответа reveal', async (_n, revealDelay) => {
      const { f, log } = gatedFetch(url => (url.endsWith('/reveal') ? revealDelay : 0), () => order({ ...revealed, tg_link_url: TG }))
      vi.stubGlobal('fetch', f)
      renderOrder()
      await flush(1_000)
      fireEvent.click(screen.getByRole('button', { name: 'Показать ключ ещё раз' }))
      await flush(0)
      const revealAt = log[log.length - 1].at
      expect(log[log.length - 1].url).toBe(`/api/billing/orders/${ID}/reveal`)
      await flush(50)
      returnToTab()
      await flush(10_000)
      const gets = log.filter(e => e.at > revealAt && !e.url.endsWith('/reveal'))
      expect(gets.length).toBe(1)
      expect(gets[0].at - revealAt).toBeGreaterThanOrEqual(revealDelay + 400)
      expect(log.filter(e => e.status === 429)).toEqual([])
      expect(screen.getByText(KEY)).toBeTruthy()
    })

    it('reveal получил 429 гейта → один автоматический повтор, ключ на экране без ошибки', async () => {
      let reveals = 0
      vi.stubGlobal('fetch', vi.fn((url: string) => {
        if (!url.endsWith('/reveal')) return fake(order({ ...revealed, tg_link_url: TG }))
        reveals++
        return reveals === 1
          ? fake({ error: 'rate_limited', retry_after_sec: 1 }, 429, { 'Retry-After': '1' })
          : fake({ key: KEY, reveal_until: '2026-11-15T10:20:00Z' })
      }))
      renderOrder()
      await flush(1_000)
      fireEvent.click(screen.getByRole('button', { name: 'Показать ключ ещё раз' }))
      await flush(999)
      expect(reveals).toBe(1)
      expect(screen.queryByText(/Слишком много попыток/)).toBeNull()
      await flush(1)
      expect(reveals).toBe(2)
      expect(screen.getByText(KEY)).toBeTruthy()
    })

    it('reveal получил 429 с долгим Retry-After (лимит шлюза) → без повтора, сообщение с ожиданием', async () => {
      let reveals = 0
      vi.stubGlobal('fetch', vi.fn((url: string) => {
        if (!url.endsWith('/reveal')) return fake(order({ ...revealed, tg_link_url: TG }))
        reveals++
        return fake({ error: 'rate_limited' }, 429, { 'Retry-After': '600' })
      }))
      renderOrder()
      await flush(1_000)
      fireEvent.click(screen.getByRole('button', { name: 'Показать ключ ещё раз' }))
      await flush(60_000)
      expect(reveals).toBe(1)
      expect(screen.getByText(/через 10 мин/)).toBeTruthy()
    })

    it('StrictMode (двойной прогон эффектов) не глушит перечитывание после показа ключа', async () => {
      const f = revealFlow([withLink])
      vi.stubGlobal('fetch', f)
      render(
        <StrictMode>
          <MemoryRouter initialEntries={[`/order/${ID}`]}>
            <Routes><Route path="/order/:id" element={<OrderRoute />} /></Routes>
          </MemoryRouter>
        </StrictMode>,
      )
      await flush(1_000)
      fireEvent.click(screen.getByRole('button', { name: 'Показать ключ' }))
      await flush(400)
      expect(screen.getByRole('link', { name: 'Привязать Telegram' }).getAttribute('href')).toBe(TG)
    })

    it('уход со страницы, пока reveal в полёте → после ответа ни одного чтения заказа', async () => {
      const f = vi.fn((url: string) => url.endsWith('/reveal')
        ? slow({ key: KEY, reveal_until: '2026-11-15T10:20:00Z' }, 100)
        : fake(order({ status: 'fulfilled', kind: 'new', key_ready: true, confirmation_url: null })))
      vi.stubGlobal('fetch', f)
      const { unmount } = renderOrder()
      await flush(1_000)
      expect(orderCalls(f)).toBe(1)
      fireEvent.click(screen.getByRole('button', { name: 'Показать ключ' }))
      await flush(30)
      unmount()
      await flush(10 * 60_000)
      expect(orderCalls(f)).toBe(1)
    })

    it('ссылка не попадает в хранилища, cookie, URL, историю, заголовок, window.name, консоль и отправители событий', async () => {
      const consoles = (['log', 'info', 'warn', 'error', 'debug'] as const).map(m => vi.spyOn(console, m))
      const beacon = vi.fn(() => true)
      Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: beacon })
      const f = vi.fn((url: string) => url.endsWith('/reveal')
        ? fake({ key: KEY, reveal_until: '2026-11-15T10:20:00Z' })
        : fake(order({ ...revealed, tg_link_url: TG })))
      vi.stubGlobal('fetch', f)
      const spies = spyStorageWrites()
      renderOrder()
      await flush(1_000)
      fireEvent.click(screen.getByRole('button', { name: 'Показать ключ ещё раз' }))
      await flush()
      await flush(60_000)
      expect(screen.getByRole('link', { name: 'Привязать Telegram' })).toBeTruthy()

      expect(leaked(spies, [TG, 'lk_'])).toEqual([])
      expect(document.cookie).not.toContain('lk_')
      expect(window.location.href).not.toContain('lk_')
      expect(JSON.stringify(window.history.state ?? null)).not.toContain('lk_')
      expect(routerText()).not.toContain('lk_')
      expect(routerText()).not.toContain(KEY)
      expect(document.title).not.toContain('lk_')
      expect(window.name).not.toContain('lk_')
      for (const c of consoles) expect(JSON.stringify(c.mock.calls)).not.toContain('lk_')
      expect(beacon).not.toHaveBeenCalled()
      expect(vi.mocked(track)).not.toHaveBeenCalled()
      expect(vi.mocked(reportRouteNext)).not.toHaveBeenCalled()
      // Сеть: только чтение заказа и показ ключа, ссылка не уходит ни в URL, ни в тело.
      for (const [url, init] of f.mock.calls as unknown as [string, RequestInit | undefined][]) {
        expect([`/api/billing/orders/${ID}`, `/api/billing/orders/${ID}/reveal`]).toContain(url)
        expect(String(init?.body ?? '')).not.toContain('lk_')
      }
    })
  })

  // ─── почта после оплаты (contact_status = deferred) ──────────────────────
  // Шлюз не смог сохранить почту при заказе — страница просит её ещё раз и
  // шлёт в POST …/contact. ok / none / нет поля / vault_disabled — формы нет.
  describe('почта после оплаты', () => {
    const EMAIL = 'Buyer.Name@Example.com'
    const CONTACT = `/api/billing/orders/${ID}/contact`
    const paidDeferred = { status: 'fulfilled', kind: 'new', key_ready: true, confirmation_url: null, contact_status: 'deferred' }

    function fillContact(email = EMAIL, confirm = email) {
      fireEvent.change(screen.getByLabelText('Почта'), { target: { value: email } })
      fireEvent.change(screen.getByLabelText('Повторите почту'), { target: { value: confirm } })
    }
    function saveBtn(): HTMLButtonElement {
      return screen.getByRole('button', { name: 'Сохранить почту' }) as HTMLButtonElement
    }
    function contactFetch(contact: () => Promise<Response>, extra: Record<string, unknown> = paidDeferred) {
      return vi.fn((url: string) => (url === CONTACT ? contact() : fake(order(extra))))
    }
    function contactCalls(f: ReturnType<typeof vi.fn>) {
      return f.mock.calls.filter(c => c[0] === CONTACT)
    }

    it('deferred → форма «Оставьте почту» с двумя полями; во второе нельзя вставить и перетащить', async () => {
      vi.stubGlobal('fetch', contactFetch(() => fake({ contact_status: 'ok' })))
      renderOrder()
      await flush()
      expect(screen.getByRole('heading', { name: 'Оставьте почту' })).toBeTruthy()
      // Пояснение — дословно (решение владельца 2026-11-16).
      const intro = screen.getByText('При оформлении заказа почта не сохранилась. Пришлём копию ключа на этот адрес почты:')
      // Порядок: заголовок → пояснение (двоеточие указывает на поля) → поля → кнопка.
      const order = [
        screen.getByRole('heading', { name: 'Оставьте почту' }), intro,
        screen.getByLabelText('Почта'), screen.getByLabelText('Повторите почту'),
        screen.getByRole('button', { name: 'Сохранить почту' }),
      ]
      for (let i = 1; i < order.length; i++) {
        expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      }
      expect(fireEvent.paste(screen.getByLabelText('Повторите почту'))).toBe(false)
      expect(fireEvent.drop(screen.getByLabelText('Повторите почту'))).toBe(false)
      expect(fireEvent.paste(screen.getByLabelText('Почта'))).toBe(true)
      // Ключ при этом показывается как обычно.
      expect(screen.getByRole('button', { name: 'Показать ключ' })).toBeTruthy()
    })

    it.each([
      ['ok', { contact_status: 'ok' }],
      ['none', { contact_status: 'none' }],
      ['нет поля (старый шлюз)', {}],
      ['неизвестное значение', { contact_status: 'later' }],
    ])('contact_status %s → формы нет', async (_, extra) => {
      vi.stubGlobal('fetch', vi.fn(() => fake(order({ status: 'fulfilled', key_ready: true, confirmation_url: null, ...extra }))))
      renderOrder()
      await flush()
      expect(screen.getByRole('button', { name: 'Показать ключ' })).toBeTruthy()
      expect(screen.queryByRole('heading', { name: 'Оставьте почту' })).toBeNull()
      expect(screen.queryByLabelText('Почта')).toBeNull()
    })

    it.each([['canceled'], ['refunded'], ['partially_refunded']])('deferred, но заказ %s → формы нет', async (status) => {
      vi.stubGlobal('fetch', vi.fn(() => fake(order({ status, confirmation_url: null, contact_status: 'deferred' }))))
      renderOrder()
      await flush()
      expect(screen.queryByRole('heading', { name: 'Оставьте почту' })).toBeNull()
    })

    it('кнопка недоступна, пока адреса не совпадут; 200 → «Почта сохранена», форма исчезает', async () => {
      const f = contactFetch(() => fake({ contact_status: 'ok' }))
      vi.stubGlobal('fetch', f)
      renderOrder()
      await flush(1_000)
      expect(saveBtn().disabled).toBe(true)
      fillContact(EMAIL, 'other@example.com')
      expect(saveBtn().disabled).toBe(true)
      fillContact(` ${EMAIL} `, 'buyer.name@EXAMPLE.com')
      expect(saveBtn().disabled).toBe(false)
      fireEvent.click(saveBtn())
      await flush(1_000)
      const calls = contactCalls(f) as unknown as [string, RequestInit][]
      expect(calls).toHaveLength(1)
      expect(calls[0][1].method).toBe('POST')
      expect(JSON.parse(String(calls[0][1].body))).toEqual({ email: EMAIL })
      expect(screen.getByText('Почта сохранена.')).toBeTruthy()
      expect(screen.queryByLabelText('Почта')).toBeNull()
      // Опрос, вернувший тот же deferred, форму не возвращает.
      await flush(15_000)
      expect(screen.queryByLabelText('Почта')).toBeNull()
    })

    it('отправка выдерживает паузу после чтения заказа (общий гейт BFF)', async () => {
      const f = contactFetch(() => fake({ contact_status: 'ok' }))
      vi.stubGlobal('fetch', f)
      renderOrder()
      await flush()
      fillContact()
      fireEvent.click(saveBtn())
      await flush(100)
      expect(contactCalls(f)).toHaveLength(0)
      await flush(400)
      expect(contactCalls(f)).toHaveLength(1)
    })

    it.each([
      ['vault_disabled', null],
      ['contact_not_allowed', null],
      ['contact_already_set', 'Почта сохранена.'],
    ])('409 %s → форма скрыта, повторов нет', async (code, text) => {
      const f = contactFetch(() => fake({ error: code }, 409))
      vi.stubGlobal('fetch', f)
      renderOrder()
      await flush(1_000)
      fillContact()
      fireEvent.click(saveBtn())
      await flush(1_000)
      expect(screen.queryByLabelText('Почта')).toBeNull()
      if (text) expect(screen.getByText(text)).toBeTruthy()
      await flush(5 * 60_000)
      expect(contactCalls(f)).toHaveLength(1)
    })

    it.each([
      [400, { error: 'email_invalid' }, {}, /Проверьте адрес почты/],
      [400, { error: 'email_required' }, {}, /Укажите почту/],
      [503, { error: 'contacts_unavailable' }, { 'Retry-After': '60' }, /Не удалось сохранить почту.*через 60 с/],
      [429, { error: 'rate_limited' }, { 'Retry-After': '600' }, /Слишком много попыток.*через 10 мин/],
      [502, { error: 'gateway_unavailable' }, {}, /Не удалось сохранить почту/],
    ])('%i %j → сообщение у формы, форма остаётся, кнопка снова активна', async (status, body, headers, msg) => {
      const f = contactFetch(() => fake(body, status as number, headers as Record<string, string>))
      vi.stubGlobal('fetch', f)
      renderOrder()
      await flush(1_000)
      fillContact()
      fireEvent.click(saveBtn())
      await flush(1_000)
      const alert = screen.getByText(msg as RegExp)
      expect(alert.closest('.billing-email')).toBeTruthy()
      expect(alert.textContent).not.toContain(EMAIL)
      expect(saveBtn().disabled).toBe(false)
      expect(contactCalls(f)).toHaveLength(1)
    })

    it.each([
      [401, { error: 'order_token_missing' }],
      [404, { error: 'order_not_found' }],
    ])('%i от …/contact → ошибка у формы; показанный ключ и страница заказа остаются', async (status, body) => {
      vi.stubGlobal('fetch', vi.fn((url: string) => {
        if (url === CONTACT) return fake(body, status as number)
        if (url.endsWith('/reveal')) return fake({ key: KEY, reveal_until: '2026-11-15T10:20:00Z' })
        return fake(order(paidDeferred))
      }))
      renderOrder()
      await flush(1_000)
      fireEvent.click(screen.getByRole('button', { name: 'Показать ключ' }))
      await flush(1_000)
      expect(screen.getByText(KEY)).toBeTruthy()
      fillContact()
      fireEvent.click(saveBtn())
      await flush(1_000)
      expect(screen.queryByText('Заказ открыт в другом браузере')).toBeNull()
      expect(screen.queryByText('Заказ не найден')).toBeNull()
      expect(screen.getByText(KEY)).toBeTruthy()
      const alert = screen.getByText(/Не удалось сохранить почту/)
      expect(alert.closest('.billing-email')).toBeTruthy()
      expect(saveBtn().disabled).toBe(false)
    })

    it('двойной клик — один запрос', async () => {
      const f = contactFetch(() => fake({ contact_status: 'ok' }))
      vi.stubGlobal('fetch', f)
      renderOrder()
      await flush(1_000)
      fillContact()
      const btn = saveBtn()
      act(() => { btn.click(); btn.click() })
      await flush(1_000)
      expect(contactCalls(f)).toHaveLength(1)
    })

    it('почта не попадает в хранилища, cookie, URL, историю, заголовок, window.name, консоль и отправители событий', async () => {
      const consoles = (['log', 'info', 'warn', 'error', 'debug'] as const).map(m => vi.spyOn(console, m))
      const beacon = vi.fn(() => true)
      Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: beacon })
      vi.mocked(track).mockClear()
      vi.mocked(reportRouteNext).mockClear()
      let n = 0
      const f = contactFetch(() => (++n === 1 ? fake({ error: 'email_invalid' }, 400)
        : n === 2 ? fake({ error: 'contacts_unavailable' }, 503, { 'Retry-After': '5' })
        : fake({ contact_status: 'ok' })))
      vi.stubGlobal('fetch', f)
      const spies = spyStorageWrites()
      renderOrder()
      await flush(1_000)
      fillContact()
      for (let i = 0; i < 3; i++) {
        fireEvent.click(saveBtn())
        await flush(1_000)
      }
      expect(screen.getByText('Почта сохранена.')).toBeTruthy()

      for (const secret of [EMAIL, EMAIL.toLowerCase(), 'example.com']) {
        expect(leaked(spies, [secret])).toEqual([])
        expect(document.cookie).not.toContain(secret)
        expect(window.location.href).not.toContain(secret)
        expect(JSON.stringify(window.history.state ?? null)).not.toContain(secret)
        expect(routerText().toLowerCase()).not.toContain(secret.toLowerCase())
        expect(routerText().toLowerCase()).not.toContain(encodeURIComponent(secret).toLowerCase())
        expect(document.title).not.toContain(secret)
        expect(window.name).not.toContain(secret)
        for (const c of consoles) expect(JSON.stringify(c.mock.calls).toLowerCase()).not.toContain(secret.toLowerCase())
      }
      expect(beacon).not.toHaveBeenCalled()
      expect(vi.mocked(track)).not.toHaveBeenCalled()
      expect(vi.mocked(reportRouteNext)).not.toHaveBeenCalled()
      // Сеть: почта только в теле POST …/contact, ни в одном URL.
      for (const [url, init] of f.mock.calls as unknown as [string, RequestInit | undefined][]) {
        expect([`/api/billing/orders/${ID}`, CONTACT]).toContain(url)
        if (url !== CONTACT) expect(String(init?.body ?? '').toLowerCase()).not.toContain('example.com')
      }
    })
  })
})
