import { StrictMode } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { RenewPage } from '../RenewPage'

// /renew — клик по ссылке из письма (спека 2026-11-21-renew-by-email-site.md §1–§3).

const TOKEN = 'q3x7t5zk2mhw8vjbn4rcdfgpya'
const ORDER_ID = '0b6f3c1e-8a2d-4c5b-9e7f-1a2b3c4d5e6f'
const REDEEM = '/api/billing/renew-link/redeem'

function res(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } }))
}

function stubFetch(handler: (body: Record<string, unknown>) => Promise<Response>) {
  const f = vi.fn((_url: string, init?: RequestInit) => handler(JSON.parse(String(init?.body ?? '{}'))))
  vi.stubGlobal('fetch', f)
  return f
}
function bodies(f: ReturnType<typeof stubFetch>): Record<string, unknown>[] {
  return f.mock.calls.map(c => JSON.parse(String((c[1] as RequestInit).body)))
}

let redirect: ReturnType<typeof vi.fn>

function renderRenew(hash = `#t=${TOKEN}`, strict = false) {
  window.history.replaceState(null, '', `/renew${hash}`)
  const tree = (
    <MemoryRouter initialEntries={['/renew']}>
      <Routes>
        <Route path="/renew" element={<RenewPage redirect={redirect} />} />
        <Route path="/order/:id" element={<div>страница заказа {ORDER_ID}</div>} />
        <Route path="/buy" element={<div>страница покупки</div>} />
      </Routes>
    </MemoryRouter>
  )
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree)
}

beforeEach(() => { redirect = vi.fn() })
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); window.history.replaceState(null, '', '/') })

describe('RenewPage', () => {
  it('фрагмент снимается из адреса ДО первого запроса; токен — только в теле redeem', async () => {
    let hashAtRequest: string | null = null
    const f = stubFetch(() => {
      hashAtRequest = window.location.hash
      return res({ order_id: ORDER_ID, confirmation_url: 'https://yoomoney.ru/pay' }, 201)
    })
    renderRenew()
    expect(screen.getByText('Открываем оплату…')).toBeTruthy()
    await waitFor(() => expect(redirect).toHaveBeenCalledWith('https://yoomoney.ru/pay'))
    expect(hashAtRequest).toBe('')
    expect(window.location.href).not.toContain(TOKEN)
    expect(bodies(f)).toEqual([{ token: TOKEN }])
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(REDEEM)
    expect(init.method).toBe('POST')
    expect(url).not.toContain(TOKEN)
  })

  it('200 (повторная выдача) ведёт на оплату так же, как 201', async () => {
    stubFetch(() => res({ order_id: ORDER_ID, confirmation_url: 'https://yoomoney.ru/pay' }, 200))
    renderRenew()
    await waitFor(() => expect(redirect).toHaveBeenCalledWith('https://yoomoney.ru/pay'))
  })

  it('бесплатный заказ (нет confirmation_url) → страница заказа', async () => {
    stubFetch(() => res({ order_id: ORDER_ID, status: 'paid' }, 201))
    renderRenew()
    expect(await screen.findByText(`страница заказа ${ORDER_ID}`)).toBeTruthy()
    expect(redirect).not.toHaveBeenCalled()
  })

  it('небезопасный confirmation_url не открывается', async () => {
    stubFetch(() => res({ order_id: ORDER_ID, confirmation_url: 'javascript:alert(1)' }, 201))
    renderRenew()
    expect(await screen.findByText(`страница заказа ${ORDER_ID}`)).toBeTruthy()
    expect(redirect).not.toHaveBeenCalled()
  })

  it('без фрагмента или с негодным токеном: «Ссылка недействительна.», запросов нет', async () => {
    for (const hash of ['', '#t=', '#x=1', '#t=short', `#t=${TOKEN}%20x`]) {
      const f = stubFetch(() => res({}, 500))
      const { unmount } = renderRenew(hash)
      expect(await screen.findByText('Ссылка недействительна.')).toBeTruthy()
      expect(f).not.toHaveBeenCalled()
      expect(screen.getByRole('link', { name: 'На страницу покупки' }).getAttribute('href')).toBe('/buy#renew')
      unmount()
    }
  })

  it('StrictMode: один запрос, токен не теряется при повторном монтировании', async () => {
    const f = stubFetch(() => res({ order_id: ORDER_ID, confirmation_url: 'https://yoomoney.ru/pay' }, 201))
    renderRenew(`#t=${TOKEN}`, true)
    await waitFor(() => expect(redirect).toHaveBeenCalled())
    expect(f).toHaveBeenCalledTimes(1)
  })

  const FAILS: [string, number, unknown, RegExp][] = [
    ['410 link_expired', 410, { error: 'link_expired' }, /Срок ссылки истёк\. Запросите новую на странице покупки\./],
    ['410 link_replaced', 410, { error: 'link_replaced' }, /Эта ссылка заменена более новой\. Откройте последнее письмо или запросите ссылку заново\./],
    ['410 link_used', 410, { error: 'link_used' }, /По этой ссылке уже оплачено продление\./],
    ['404 link_not_found', 404, { error: 'link_not_found' }, /Ссылка недействительна\./],
    ['409 key_not_renewable', 409, { error: 'key_not_renewable' }, /Этот ключ сейчас нельзя продлить\. Напишите в поддержку:/],
  ]
  for (const [name, status, body, text] of FAILS) {
    it(`${name}: текст и кнопка/ссылка`, async () => {
      stubFetch(() => res(body, status))
      renderRenew()
      expect(await screen.findByText(text)).toBeTruthy()
      expect(redirect).not.toHaveBeenCalled()
      expect(screen.getByRole('link', { name: 'На страницу покупки' }).getAttribute('href')).toMatch(/^\/buy/)
    })
  }

  it('429/503/сеть/ошибка: «Не удалось открыть оплату» и повтор с тем же токеном', async () => {
    for (const mk of [() => res({ error: 'rate_limited' }, 429), () => res({ error: 'payments_unavailable' }, 503),
      () => Promise.reject(new TypeError('net')), () => res({}, 502), () => res({ error: 'busy' }, 503),
      () => res({ error: 'gateway_error' }, 503, { 'Retry-After': '2' })]) {
      let first = true
      const f = stubFetch(() => {
        if (first) { first = false; return mk() }
        return res({ order_id: ORDER_ID, confirmation_url: 'https://yoomoney.ru/pay' }, 201)
      })
      redirect.mockClear()
      const { unmount } = renderRenew()
      expect(await screen.findByText('Не удалось открыть оплату. Попробуйте ещё раз.')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
      await waitFor(() => expect(redirect).toHaveBeenCalledWith('https://yoomoney.ru/pay'))
      expect(bodies(f)).toEqual([{ token: TOKEN }, { token: TOKEN }])
      unmount()
    }
  })

  it('таймаут 70 с → «Не удалось открыть оплату», запрос отменён', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    stubFetch(() => new Promise<Response>(() => {}))
    // hanging fetch без abort-обработки: таймер deadline всё равно переведёт результат в timeout
    vi.stubGlobal('fetch', vi.fn((_u: string, init?: RequestInit) => new Promise<Response>((_r, rej) => {
      init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))
    })))
    renderRenew()
    await act(async () => { await vi.advanceTimersByTimeAsync(70_500) })
    expect(await screen.findByText('Не удалось открыть оплату. Попробуйте ещё раз.')).toBeTruthy()
  })

  it('409 confirm_required: «Продлить бесплатно» повторяет с confirm_free', async () => {
    const f = stubFetch(body => body.confirm_free
      ? res({ order_id: ORDER_ID, status: 'paid' }, 201)
      : res({ error: 'confirm_required', amount_kopecks: 0 }, 409))
    renderRenew()
    expect(await screen.findByText('Продление бесплатно по промокоду.')).toBeTruthy()
    expect(redirect).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Продлить бесплатно' }))
    expect(await screen.findByText(`страница заказа ${ORDER_ID}`)).toBeTruthy()
    expect(bodies(f)).toEqual([{ token: TOKEN }, { token: TOKEN, confirm_free: true }])
  })

  it('409 promo_no_longer_valid: цена без скидки, повтор с drop_promo, ссылка на покупку', async () => {
    const f = stubFetch(body => body.drop_promo
      ? res({ order_id: ORDER_ID, confirmation_url: 'https://yoomoney.ru/pay' }, 201)
      : res({ error: 'promo_no_longer_valid', price_kopecks: 150000 }, 409))
    renderRenew()
    expect(await screen.findByText('Промокод больше не действует.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'На страницу покупки' }).getAttribute('href')).toBe('/buy#renew')
    fireEvent.click(screen.getByRole('button', { name: /^Оплатить 1\s500\s₽ без скидки$/ }))
    await waitFor(() => expect(redirect).toHaveBeenCalledWith('https://yoomoney.ru/pay'))
    expect(bodies(f)).toEqual([{ token: TOKEN }, { token: TOKEN, drop_promo: true }])
  })

  it('promo_no_longer_valid без цены: кнопка «Оплатить без скидки»', async () => {
    stubFetch(() => res({ error: 'promo_no_longer_valid' }, 409))
    renderRenew()
    expect(await screen.findByRole('button', { name: 'Оплатить без скидки' })).toBeTruthy()
  })

  it('после drop_promo повтор из ошибки сети сохраняет drop_promo', async () => {
    let n = 0
    const f = stubFetch(() => {
      n++
      if (n === 1) return res({ error: 'promo_no_longer_valid', price_kopecks: 100 }, 409)
      if (n === 2) return res({}, 503)
      return res({ order_id: ORDER_ID, confirmation_url: 'https://yoomoney.ru/pay' }, 201)
    })
    renderRenew()
    fireEvent.click(await screen.findByRole('button', { name: /без скидки/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Повторить' }))
    await waitFor(() => expect(redirect).toHaveBeenCalled())
    expect(bodies(f)[2]).toEqual({ token: TOKEN, drop_promo: true })
  })

  it('страница не грузит сторонних ресурсов и не пишет в хранилища', async () => {
    stubFetch(() => res({ error: 'link_used' }, 410))
    const { container } = renderRenew()
    await screen.findByText(/уже оплачено/)
    expect(container.querySelectorAll('img, script, iframe, link[href^="http"], a[href^="http"]').length).toBe(0)
    expect(window.localStorage.length + window.sessionStorage.length).toBe(0)
  })
})
