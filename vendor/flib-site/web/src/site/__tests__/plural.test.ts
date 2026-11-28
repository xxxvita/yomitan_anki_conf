// plural.test.ts — русское словоизменение по числу (feedback-1 п.5).
import { describe, it, expect } from 'vitest'
import { plural } from '../plural'

describe('plural', () => {
  it('1, 21, 31 → one', () => {
    expect(plural(1, 'шаг', 'шага', 'шагов')).toBe('шаг')
    expect(plural(21, 'шаг', 'шага', 'шагов')).toBe('шаг')
    expect(plural(31, 'шаг', 'шага', 'шагов')).toBe('шаг')
  })

  it('2, 3, 4, 22, 24 → few', () => {
    expect(plural(2, 'шаг', 'шага', 'шагов')).toBe('шага')
    expect(plural(3, 'шаг', 'шага', 'шагов')).toBe('шага')
    expect(plural(4, 'шаг', 'шага', 'шагов')).toBe('шага')
    expect(plural(22, 'шаг', 'шага', 'шагов')).toBe('шага')
    expect(plural(24, 'шаг', 'шага', 'шагов')).toBe('шага')
  })

  it('0, 5-20, 25-30 → many', () => {
    expect(plural(0, 'шаг', 'шага', 'шагов')).toBe('шагов')
    expect(plural(5, 'шаг', 'шага', 'шагов')).toBe('шагов')
    expect(plural(11, 'шаг', 'шага', 'шагов')).toBe('шагов')
    expect(plural(12, 'шаг', 'шага', 'шагов')).toBe('шагов')
    expect(plural(14, 'шаг', 'шага', 'шагов')).toBe('шагов')
    expect(plural(20, 'шаг', 'шага', 'шагов')).toBe('шагов')
    expect(plural(25, 'шаг', 'шага', 'шагов')).toBe('шагов')
  })

  it('111-114 (mod100 in 11-14 range beyond the first hundred) → many', () => {
    expect(plural(111, 'шаг', 'шага', 'шагов')).toBe('шагов')
    expect(plural(114, 'шаг', 'шага', 'шагов')).toBe('шагов')
  })

  it('works for a different noun set (минута/минуты/минут)', () => {
    expect(plural(1, 'минута', 'минуты', 'минут')).toBe('минута')
    expect(plural(2, 'минута', 'минуты', 'минут')).toBe('минуты')
    expect(plural(40, 'минута', 'минуты', 'минут')).toBe('минут')
  })
})
