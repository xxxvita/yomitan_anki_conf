import { describe, it, expect } from 'vitest'
import { parseLinkStart } from '../link-start'

const p = (q: string) => parseLinkStart(new URLSearchParams(q))

describe('parseLinkStart', () => {
  it.each([
    ['v=a&t=1', 1], ['v=a&t=60', 60], ['v=a&t=86400', 86400], ['v=a&t=999999&x=1', null],
    ['v=a&t=86401', null], ['v=a&t=0', null], ['v=a&t=-5', null], ['v=a&t=1.5', null],
    ['v=a&t=1m30s', null], ['v=a&t=abc', null], ['v=a&t=', null], ['v=a', null],
    ['v=a&t=007', null], ['v=a&t=+5', null], ['v=a&t=1234567', null],
    ['v=a&t=60&t=5', 60], ['v=a&t=x&t=5', null],
  ])('%s → %s', (q, exp) => { expect(p(q)).toBe(exp) })

  it.each(['rp=1', 'rc=1', 'rx=1', 'route_step=s1', 'rp=', 'back=route'])('маршрут (%s) → игнор', (r) => {
    expect(p(`v=a&t=60&${r}`)).toBeNull()
  })
  it('back≠route не мешает', () => { expect(p('v=a&t=60&back=home')).toBe(60) })
})
