/**
 * Общие текстовые примитивы скоринга ТЗ-4 (диктант) и ТЗ-5 (Elicited Imitation).
 * Порт 1:1 из onboarding-test.html (функции canon/stem/osa/tverdict/align/mleTheta).
 * Комментарий референса фиксирует упрощение: "орфография+омофоны, без espeak IPA" —
 * это НЕ фонетический скорер, сравнение текстовое (после канонизации).
 */
import { CONTRACTIONS, HOMOPHONES, IRREGULAR_VERBS } from './stimuli';
import { GRID, sig } from './math';
import type { TokenScore } from './types';

/** Разбивка на токены + раскрытие стяжений + починка "could of" -> "could have". */
export function canon(text: string): string[] {
  const out: string[] = [];
  text
    .toLowerCase()
    .split(/[^a-z']+/)
    .filter(Boolean)
    .forEach((w) => {
      (CONTRACTIONS[w] || w).split(' ').forEach((x) => out.push(x));
    });
  for (let i = 1; i < out.length; i++) {
    if (out[i] === 'of' && ['could', 'would', 'should', 'might', 'must'].includes(out[i - 1])) {
      out[i] = 'have';
    }
  }
  return out;
}

/** Грубый стеммер: неправильные формы по словарю, иначе срез частых суффиксов. */
export function stem(word: string): string {
  if (IRREGULAR_VERBS[word]) return IRREGULAR_VERBS[word];
  for (const suffix of ['ing', 'ed', 'es', 's', 'd']) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 3) {
      return word.slice(0, -suffix.length);
    }
  }
  return word;
}

/** Optimal String Alignment (Damerau-Levenshtein с одной транспозицией) distance. */
export function osa(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const d: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[m][n];
}

const VOWELS = new Set('aeiou');

/**
 * Вердикт по одной паре (typed, ref): 1 — точное совпадение/омофон, 0.9 — тот же стем
 * или ≤1 правка (не считая гласный<->гласный той же длины), 0.4 — опечатка в одной
 * гласной при равной длине, 0 — не совпало.
 */
export function tokenVerdict(typed: string, ref: string): number {
  if (typed === ref) return 1;
  if (HOMOPHONES[typed] === ref || HOMOPHONES[ref] === typed) return 1;
  if (ref.length >= 3 && stem(typed) === stem(ref)) return 0.9;
  if (typed.length >= 3 && ref.length >= 3 && osa(typed, ref) <= 1) {
    if (typed.length === ref.length) {
      const diff: Array<[string, string]> = [];
      for (let k = 0; k < typed.length; k++) {
        if (typed[k] !== ref[k]) diff.push([typed[k], ref[k]]);
      }
      if (diff.length === 1 && VOWELS.has(diff[0][0]) && VOWELS.has(diff[0][1])) return 0.4;
    }
    return 0.9;
  }
  return 0;
}

/** [typed-token|null, ref-token|null, verdict|null] — null verdict = чистая вставка. */
export type AlignedPair = [string | null, string | null, number | null];

/** Выравнивание напечатанного текста с эталоном (Needham-Wunsch-подобный DP с tokenVerdict как score). */
export function align(typedTokens: string[], refTokens: string[]): AlignedPair[] {
  const m = typedTokens.length;
  const n = refTokens.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  const bt: Array<Array<'diag' | 'up' | 'left' | null>> = Array.from({ length: m + 1 }, () => Array(n + 1).fill(null));
  for (let i = 1; i <= m; i++) {
    dp[i][0] = -i;
    bt[i][0] = 'up';
  }
  for (let j = 1; j <= n; j++) {
    dp[0][j] = -j;
    bt[0][j] = 'left';
  }
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const s = tokenVerdict(typedTokens[i - 1], refTokens[j - 1]);
      let best = dp[i - 1][j - 1] + (s > 0 ? s : -1);
      let mv: 'diag' | 'up' | 'left' = 'diag';
      if (dp[i - 1][j] - 1 > best) {
        best = dp[i - 1][j] - 1;
        mv = 'up';
      }
      if (dp[i][j - 1] - 1 > best) {
        best = dp[i][j - 1] - 1;
        mv = 'left';
      }
      dp[i][j] = best;
      bt[i][j] = mv;
    }
  }
  const pairs: AlignedPair[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    const mv = bt[i][j];
    if (mv === 'diag') {
      pairs.push([typedTokens[i - 1], refTokens[j - 1], tokenVerdict(typedTokens[i - 1], refTokens[j - 1])]);
      i--;
      j--;
    } else if (mv === 'up') {
      pairs.push([typedTokens[i - 1], null, null]);
      i--;
    } else {
      pairs.push([null, refTokens[j - 1], 0]);
      j--;
    }
  }
  return pairs.reverse();
}

/**
 * MLE-оценка theta по набору токенов [band, correctness] с фиксированным наклоном 1.2
 * (без явного приора по theta — плоское взвешивание по сетке GRID).
 * Возвращает [theta, sd].
 */
export function mleTheta(tokens: TokenScore[]): [number, number] {
  const ll = GRID.map((th) => {
    let acc = 0;
    tokens.forEach(([d, c]) => {
      const p = Math.min(Math.max(sig(1.2 * (th - d + 0.5)), 1e-6), 1 - 1e-6);
      acc += c * Math.log(p) + (1 - c) * Math.log(1 - p);
    });
    return acc;
  });
  const mx = Math.max(...ll);
  let w = ll.map((x) => Math.exp(x - mx));
  const sw = w.reduce((a, b) => a + b, 0);
  w = w.map((x) => x / sw);
  let th = 0;
  for (let i = 0; i < GRID.length; i++) th += GRID[i] * w[i];
  let v = 0;
  for (let i = 0; i < GRID.length; i++) v += (GRID[i] - th) ** 2 * w[i];
  return [th, Math.sqrt(v)];
}
