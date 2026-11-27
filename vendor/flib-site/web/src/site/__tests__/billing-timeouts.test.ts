import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createOrder, fetchProducts, revealKey, submitContact,
  CREATE_ORDER_TIMEOUT_MS, PRODUCTS_TIMEOUT_MS, REVEAL_TIMEOUT_MS, CONTACT_TIMEOUT_MS,
} from '../billing-api'

const ORDER_ID = '0b6f3c1e-8a2d-4c5b-9e7f-1a2b3c4d5e6f'
const INPUT = { productId: 'month1', promoCode: '', renewKey: '', email: '' }

// fetch, который никогда не отвечает, но уважает AbortSignal.
function hangingFetch() {
  let signal: AbortSignal | undefined
  const f = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_res, rej) => {
    signal = init?.signal ?? undefined
    signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))
  }))
  vi.stubGlobal('fetch', f)
  return { f, signal: () => signal }
}

function jsonRes(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

describe('таймауты запросов billing-api', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it('createOrder: 70 с без ответа → timeout и отмена запроса', async () => {
    const h = hangingFetch()
    const p = createOrder(INPUT)
    await vi.advanceTimersByTimeAsync(CREATE_ORDER_TIMEOUT_MS - 1)
    expect(h.signal()?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await p).toEqual({ kind: 'timeout' })
    expect(h.signal()?.aborted).toBe(true)
  })

  it('createOrder: ответ до таймаута → обычный результат, таймеров не осталось', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonRes({ order_id: ORDER_ID, confirmation_url: 'https://pay.example/x' }, 201)))
    expect(await createOrder(INPUT)).toEqual({ kind: 'ok', orderId: ORDER_ID, confirmationUrl: 'https://pay.example/x' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('createOrder: сетевая ошибка до таймаута остаётся network', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('x'))))
    expect(await createOrder(INPUT)).toEqual({ kind: 'network' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('fetchProducts: 20 с без ответа → error и отмена запроса', async () => {
    const h = hangingFetch()
    const p = fetchProducts()
    await vi.advanceTimersByTimeAsync(PRODUCTS_TIMEOUT_MS)
    expect(await p).toEqual({ kind: 'error' })
    expect(h.signal()?.aborted).toBe(true)
  })

  it('fetchProducts: ответ до таймаута → без висящего таймера', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonRes({ products: [{ id: 'a', title: 'A', price_kopecks: 100, duration_days: 30, sort: 1 }] })))
    const r = await fetchProducts()
    expect(r.kind).toBe('ok')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('revealKey: 65 с без ответа → timeout', async () => {
    const h = hangingFetch()
    const p = revealKey(ORDER_ID)
    await vi.advanceTimersByTimeAsync(REVEAL_TIMEOUT_MS)
    expect(await p).toEqual({ kind: 'timeout' })
    expect(h.signal()?.aborted).toBe(true)
  })

  it('submitContact: 65 с без ответа → timeout', async () => {
    const h = hangingFetch()
    const p = submitContact(ORDER_ID, 'a@b.c')
    await vi.advanceTimersByTimeAsync(CONTACT_TIMEOUT_MS)
    expect(await p).toEqual({ kind: 'timeout' })
    expect(h.signal()?.aborted).toBe(true)
  })
})
