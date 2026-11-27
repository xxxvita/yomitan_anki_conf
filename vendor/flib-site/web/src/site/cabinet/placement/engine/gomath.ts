// Числа Go, которых в JS нет один к одному (перечень расхождений Go ↔ JS — golden.test.ts):
//  - math.Round: половина — от нуля (Math.round(-2.5) = -2, а Go даёт -3);
//  - int(x) для float64: усечение к нулю (Math.trunc), не Math.floor.
// Остальное — одинаково по IEEE 754: + − × ÷, Math.sqrt, Math.abs, Math.max на конечных.

/** math.Round Go: ближайшее целое, половина — от нуля. */
export function goRound(x: number): number {
  if (!Number.isFinite(x)) return x;
  const t = Math.trunc(x);
  // x − trunc(x) точна для double (дробная часть представима).
  return Math.abs(x - t) >= 0.5 ? t + Math.sign(x) : t;
}

/** int(x) Go для float64: усечение к нулю. */
export function goInt(x: number): number {
  return Math.trunc(x);
}
