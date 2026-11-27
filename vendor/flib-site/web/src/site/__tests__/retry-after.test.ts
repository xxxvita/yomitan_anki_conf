// retry-after.test.ts — единый парсер Retry-After: body-first, оба ключа,
// null-семантика (Fable HIGH-3: null = «не знаем» → вызывающий сам решает).
import { describe, it, expect } from 'vitest'
import { parseRetryAfterSec } from '../retry-after'

describe('parseRetryAfterSec', () => {
  it('body retry_after_seconds wins over header (body-first canon)', () => {
    expect(parseRetryAfterSec('99', { retry_after_seconds: 12 })).toBe(12)
  })
  it('body retry_after_sec (gate.go writeRateLimited key) is honoured', () => {
    expect(parseRetryAfterSec(null, { retry_after_sec: 7 })).toBe(7)
  })
  it('retry_after_seconds takes precedence over retry_after_sec if both present', () => {
    expect(parseRetryAfterSec(null, { retry_after_seconds: 3, retry_after_sec: 9 })).toBe(3)
  })
  it('falls back to header when body has no key', () => {
    expect(parseRetryAfterSec('30', {})).toBe(30)
    expect(parseRetryAfterSec('30', null)).toBe(30)
  })
  it('returns null when NOTHING parses — NOT a default (give-up signal)', () => {
    expect(parseRetryAfterSec(null, null)).toBeNull()
    expect(parseRetryAfterSec(null, {})).toBeNull()
    expect(parseRetryAfterSec('', {})).toBeNull()
  })
  it('rejects non-positive / non-finite values → null', () => {
    expect(parseRetryAfterSec('0', {})).toBeNull()
    expect(parseRetryAfterSec('-5', {})).toBeNull()
    expect(parseRetryAfterSec('abc', {})).toBeNull()
    expect(parseRetryAfterSec(null, { retry_after_seconds: 0 })).toBeNull()
    expect(parseRetryAfterSec(null, { retry_after_seconds: -1 })).toBeNull()
    expect(parseRetryAfterSec(null, { retry_after_seconds: 'x' })).toBeNull()
  })
})
