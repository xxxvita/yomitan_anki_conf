import { describe, it, expect } from 'vitest'
import { RENEW_BY_EMAIL, REDEEM_TIMEOUT_MS } from '../billing-api'

describe('продление по почте: сборочный флаг', () => {
  it('включён', () => { expect(RENEW_BY_EMAIL).toBe(true) })
  it('клиентский таймаут redeem больше таймаута BFF к шлюзу (60 с)', () => { expect(REDEEM_TIMEOUT_MS).toBeGreaterThan(60_000) })
})
