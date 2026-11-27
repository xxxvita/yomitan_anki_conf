/**
 * Общая математика онбординг-теста уровня.
 * Порт 1:1 из vanilla-JS референса:
 * anki_conf-lexicon-lab-ux/onboarding-methodology/web/onboarding-test.html
 *
 * Все функции чистые (без Date.now/Math.random) — детерминированы по входу.
 */

/** Логистическая сигмоида с насыщением на хвостах (защита от Math.exp overflow). */
export const sig = (x: number): number => (x < -60 ? 0 : x > 60 ? 1 : 1 / (1 + Math.exp(-x)));

/** Клампит полосу словаря (band) в допустимый диапазон, по умолчанию [0.5, 8.5]. */
export const clampBand = (x: number, lo = 0.5, hi = 8.5): number => Math.max(lo, Math.min(hi, x));

/**
 * Размер словаря (в леммах) для данной оценки полосы theta и наклона slope.
 * sizeOf(theta,a) = 1000 * Σ_{b=1..8} sig(a*(theta-b+0.5))
 */
export function sizeOf(theta: number, slope = 1.5): number {
  let s = 0;
  for (let b = 1; b <= 8; b++) s += sig(slope * (theta - b + 0.5));
  return 1000 * s;
}

/** Округление количества лемм до ближайших 250 (как в референсе, q250). */
export const q250 = (x: number): number => Math.round(Math.max(0, x) / 250) * 250;

/** Округление до 2 знаков (использовано повсеместно в референсе для читаемого JSON). */
export const round2 = (x: number): number => +x.toFixed(2);

/**
 * Сетка полос θ: 81 точка от 0.5 до 8.5 с шагом 0.1.
 * Используется постериором AuralEngine и MLE-скорерами (dictation/EI).
 */
export const GRID: number[] = Array.from({ length: 81 }, (_, i) => 0.5 + 0.1 * i);

/**
 * Сетка наклонов a (маргинализация "резкости" границы словаря в ТЗ-3).
 * ВАЖНО: методичка tz3 (§2) описывает a∈{0.8,1.5,2.5}, но код референса
 * (const AG=[1.0,1.5,2.5]) использует 1.0 вместо 0.8. Портируем КОД (источник истины),
 * не методичку — расхождение задокументировано, не исправлено самовольно.
 */
export const SLOPE_GRID: number[] = [1.0, 1.5, 2.5];
