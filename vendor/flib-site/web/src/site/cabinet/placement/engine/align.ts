// Сопоставление напечатанного с эталоном клипа (S4b) — порт internal/placement/model/align.go.
// Go режет по рунам и понижает регистр по руне (unicode.ToLower): здесь — по кодовым точкам.

const CONTRACTIONS: Record<string, string> = {
  "don't": 'do not', "i'm": 'i am', "it's": 'it is', "you're": 'you are', "can't": 'can not',
};

const LETTER_OR_DIGIT = /^[\p{L}\p{Nd}]$/u;

/** Нижний регистр по кодовой точке (простое отображение, как unicode.ToLower Go, без контекста). */
function lowerRune(ch: string): string {
  const l = ch.toLowerCase();
  // Многосимвольное отображение (İ → i + U+0307) — Go отдаёт одну руну: берём первую.
  return Array.from(l)[0] ?? ch;
}

/** Нижний регистр, без пунктуации (апостроф сохраняется до раскрытия сокращений), сокращения раскрыты. */
export function normTokens(s: string): string[] {
  let mapped = '';
  for (const ch0 of s.replace(/’/g, "'")) {
    const ch = lowerRune(ch0);
    mapped += LETTER_OR_DIGIT.test(ch) || ch === "'" ? ch : ' ';
  }
  const out: string[] = [];
  for (const f0 of mapped.split(' ')) {
    if (f0 === '') continue;
    const e = Object.prototype.hasOwnProperty.call(CONTRACTIONS, f0) ? CONTRACTIONS[f0] : undefined;
    if (e !== undefined) {
      out.push(...e.split(' '));
      continue;
    }
    const f = f0.replace(/^'+|'+$/g, '');
    if (f !== '') out.push(f);
  }
  return out;
}

function tokenMatch(ref: string, typed: string): boolean {
  if (ref === typed) return true;
  return Array.from(ref).length >= 5 && levenshtein(ref, typed) <= 1;
}

/**
 * Для каждого токена эталона — найден ли он в напечатанном: без регистра и пунктуации, сокращения
 * раскрыты, опечатка в одну букву прощается словам от 5 букв, порядок соблюдается (LCS).
 * Эталонный токен-сокращение засчитан, только если найдены все его части.
 */
export function alignTokens(ref: string[], typed: string): boolean[] {
  const sub: string[] = [];
  const owner: number[] = [];
  ref.forEach((r, i) => {
    for (const t of normTokens(r)) {
      sub.push(t);
      owner.push(i);
    }
  });
  const ty = normTokens(typed);
  const n = sub.length;
  const m = ty.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = tokenMatch(sub[i], ty[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const hit = new Array<boolean>(n).fill(false);
  for (let i = 0, j = 0; i < n && j < m;) {
    if (tokenMatch(sub[i], ty[j]) && dp[i][j] === dp[i + 1][j + 1] + 1) {
      hit[i] = true;
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  const out = new Array<boolean>(ref.length).fill(true);
  const seen = new Array<boolean>(ref.length).fill(false);
  hit.forEach((h, k) => {
    seen[owner[k]] = true;
    if (!h) out[owner[k]] = false;
  });
  for (let i = 0; i < ref.length; i++) if (!seen[i]) out[i] = false; // токен из одной пунктуации
  return out;
}

/** Расстояние Левенштейна по кодовым точкам (Go — по рунам). */
export function levenshtein(a: string, b: string): number {
  const ra = Array.from(a);
  const rb = Array.from(b);
  let prev = Array.from({ length: rb.length + 1 }, (_, j) => j);
  let cur = new Array<number>(rb.length + 1).fill(0);
  for (let i = 1; i <= ra.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= rb.length; j++) {
      const c = ra[i - 1] === rb[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + c);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[rb.length];
}
