import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { OrderRoute } from '../OrderPage'

// Заказ по ссылке продления: via_link и refund_reason (шлюз rev 4 + via_link).

const ID = '0b6f3c1e-8a2d-4c5b-9e7f-1a2b3c4d5e6f'

function order(extra: Record<string, unknown>) {
  return {
    order_id: ID, status: 'pending', product_id: 'month1', product_title: '1 месяц рекомендаций',
    duration_days: 30, amount_kopecks: 150000, key_ready: false, key_revealed: false, reveal_until: null,
    receipt_url: null, confirmation_url: 'https://yoomoney.ru/checkout/x', created_at: '2026-11-21T10:00:00Z',
    paid_at: null, ...extra,
  }
}

function stubOrder(body: unknown) {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }))))
}

function renderOrder() {
  return render(
    <MemoryRouter initialEntries={[`/order/${ID}`]}>
      <Routes>
        <Route path="/order/:id" element={<OrderRoute />} />
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(() => { vi.unstubAllGlobals() })

describe('OrderPage: заказ по ссылке', () => {
  it('contact_status=deferred без via_link — форма почты есть (контроль)', async () => {
    stubOrder(order({ status: 'fulfilled', key_ready: true, contact_status: 'deferred' }))
    renderOrder()
    expect(await screen.findByLabelText('Почта')).toBeTruthy()
  })

  it('via_link: форма почты не показывается, даже при contact_status=deferred', async () => {
    stubOrder(order({ status: 'fulfilled', key_ready: true, contact_status: 'deferred', via_link: true }))
    renderOrder()
    await screen.findByText(/1 месяц рекомендаций/)
    expect(screen.queryByLabelText('Почта')).toBeNull()
    expect(screen.queryByText('Оставьте почту')).toBeNull()
  })

  it('refund_reason=duplicate + refunded: «Эта ссылка уже оплачена, деньги вернутся на карту»', async () => {
    stubOrder(order({ status: 'refunded', via_link: true, refund_reason: 'duplicate' }))
    renderOrder()
    expect(await screen.findByText('Эта ссылка уже оплачена, деньги вернутся на карту')).toBeTruthy()
  })

  it('refund_reason=duplicate + canceled (бесплатный дубль): «Эта ссылка уже использована»', async () => {
    stubOrder(order({ status: 'canceled', via_link: true, refund_reason: 'duplicate' }))
    renderOrder()
    expect(await screen.findByText('Эта ссылка уже использована')).toBeTruthy()
    expect(screen.queryByText(/деньги вернутся/)).toBeNull()
  })

  it('refund_reason=key_unavailable: «Этот ключ больше нельзя продлить, деньги вернутся на карту»', async () => {
    stubOrder(order({ status: 'refunded', via_link: true, refund_reason: 'key_unavailable' }))
    renderOrder()
    expect(await screen.findByText('Этот ключ больше нельзя продлить, деньги вернутся на карту')).toBeTruthy()
  })

  it('refund_reason=key_unavailable + canceled (бесплатный заказ): «Этот ключ больше нельзя продлить» без денег', async () => {
    stubOrder(order({ status: 'canceled', via_link: true, amount_kopecks: 0, refund_reason: 'key_unavailable' }))
    renderOrder()
    expect(await screen.findByText('Этот ключ больше нельзя продлить')).toBeTruthy()
    expect(screen.queryByText(/деньги/)).toBeNull()
    expect(screen.queryByText('Оплата не прошла')).toBeNull()
  })

  it('refund_reason=null, refunded: прежний текст возврата', async () => {
    stubOrder(order({ status: 'refunded', refund_reason: null }))
    renderOrder()
    expect(await screen.findByText('Деньги возвращены, ключ отключён')).toBeTruthy()
  })

  it('canceled без причины: прежний текст «Оплата не прошла»', async () => {
    stubOrder(order({ status: 'canceled' }))
    renderOrder()
    expect(await screen.findByText('Оплата не прошла')).toBeTruthy()
  })
})
