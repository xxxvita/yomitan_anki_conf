// drop-time.test.ts — T9: lifted VERBATIM from desktop
// components/workspace/drop-time.test.ts (anki_conf-shadowing-fix). Note
// viewStart=10 (>0) is load-bearing: with view=[0,duration] the correct
// dropTimeFromFraction(f, 0, duration) formula and the WRONG f*duration
// formula produce the same numbers — a zero viewStart would never catch a
// regression back to f*duration (BL2, audit/28). This fixture already had
// viewStart>0 in the desktop original, so lifting it verbatim satisfies that
// requirement without any changes.
import { describe, it, expect } from 'vitest';
import { dropTimeFromFraction } from '../drop-time';

describe('dropTimeFromFraction', () => {
  const viewStart = 10;
  const viewEnd = 70;

  it('fraction 0 returns viewStart', () => {
    expect(dropTimeFromFraction(0, viewStart, viewEnd)).toBe(viewStart);
  });

  it('fraction 1 returns viewEnd', () => {
    expect(dropTimeFromFraction(1, viewStart, viewEnd)).toBe(viewEnd);
  });

  it('fraction 0.5 returns the midpoint', () => {
    expect(dropTimeFromFraction(0.5, viewStart, viewEnd)).toBeCloseTo((viewStart + viewEnd) / 2);
  });

  it('fraction below 0 is clamped to viewStart', () => {
    expect(dropTimeFromFraction(-0.5, viewStart, viewEnd)).toBe(viewStart);
  });

  it('fraction above 1 is clamped to viewEnd', () => {
    expect(dropTimeFromFraction(1.5, viewStart, viewEnd)).toBe(viewEnd);
  });
});
