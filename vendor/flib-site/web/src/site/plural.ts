// plural.ts — общий хелпер русского словоизменения существительного по числу
// (1 шаг / 2 шага / 5 шагов). Вынесен из ImportPage.tsx (там жила локальная
// wordsLabel с этой же mod100/mod10-логикой) — теперь переиспользуется в
// RoutePage.tsx (шаги, часы/минуты в FreshBanner) и ImportPage.tsx (слова),
// вместо двух параллельных копий одной и той же логики (feedback-1 п.5).
//
// Правило: числительные 11–14 всегда "many" (одиннадцать шагов, а не
// "одиннадцать шага"), иначе последняя цифра решает: ...1 → one, ...2-4 →
// few, всё остальное (0, 5-9, 11-14) → many.
export function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = Math.abs(n) % 100
  const mod10 = mod100 % 10
  if (mod100 >= 11 && mod100 <= 14) return many
  if (mod10 === 1) return one
  if (mod10 >= 2 && mod10 <= 4) return few
  return many
}
