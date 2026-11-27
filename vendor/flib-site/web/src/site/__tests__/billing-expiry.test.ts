// billing-expiry.test.ts — key_expires_at (шлюз, OpenAPI 0.40.0): разбор
// RFC3339 и формат «16 декабря 2026, 14:37» без «г.» и «в» из Intl.
import { describe, it, expect } from 'vitest'
import { formatKeyExpiry, parseKeyExpiry } from '../billing-api'

describe('key_expires_at', () => {
  it.each([
    ['2026-12-16T09:37:00Z', true],
    ['2026-12-16T09:37:00.123456Z', true],
    ['2026-12-16T14:37:00+05:00', true],
    ['2026-12-16t09:37:00z', true],
    ['2026-12-16', false],
    ['2026-12-16T09:37:00', false],
    ['2026-13-45T09:37:00Z', false],
    ['2026-02-30T09:37:00Z', false],
    ['завтра', false],
    ['', false],
    [1797000000, false],
    [null, false],
    [undefined, false],
  ])('parseKeyExpiry(%j) → %s', (v, ok) => {
    expect(parseKeyExpiry(v) !== null).toBe(ok)
  })

  it('формат: число, месяц словом, год, запятая, часы:минуты — в заданном поясе', () => {
    const t = parseKeyExpiry('2026-12-16T09:37:00Z')!
    expect(formatKeyExpiry(t, 'Asia/Tashkent')).toBe('16 декабря 2026, 14:37')
    expect(formatKeyExpiry(t, 'UTC')).toBe('16 декабря 2026, 09:37')
    expect(formatKeyExpiry(t, 'America/New_York')).toBe('16 декабря 2026, 04:37')
    // Переход через полночь меняет и дату.
    expect(formatKeyExpiry(parseKeyExpiry('2026-12-31T20:05:00Z')!, 'Asia/Tashkent')).toBe('1 января 2027, 01:05')
    expect(formatKeyExpiry(t, 'Asia/Tashkent')).not.toMatch(/г\.|\sв\s/)
  })
})
