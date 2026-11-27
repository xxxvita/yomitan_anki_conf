/**
 * Точка A — экспорт "уже известных" слов пользователя (exportKnown() в референсе).
 *
 * В референсе (onboarding-test.html) источник — локальный `const FREQ = [...]`:
 * топ-9000 слов того же корпуса (устная частотность субтитров, имена собственные
 * вычищены по регистру), что и WORD_BANDS, отсортированных по убыванию частоты.
 * `exportKnown(n,label)` брал `FREQ.slice(0, clamp(n,1,FREQ.length))`.
 *
 * Мы НЕ вшиваем список в бандл — источник частотного списка живёт на бэкенде
 * (GET /api/dicts), его подгружает UI-страница и передаёт сюда.
 */

/** Первые `n` слов частотного списка (уже отсортированного по убыванию частоты). */
export function topNWords(freq: string[], n: number): string[] {
  const count = Math.max(1, Math.min(n, freq.length));
  return freq.slice(0, count);
}
