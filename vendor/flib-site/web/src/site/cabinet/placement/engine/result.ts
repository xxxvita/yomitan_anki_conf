// Итог теста — порт internal/placement/model/result.go: P*(w) = E[m]·P_form(w), слова S3
// фиксированы наблюдением; размер, CI90, уровень, флаги, words[].
import { goInt, goRound } from './gomath';
import { FLAG_FLOOR, FLAG_LISTENING_GAP, FLAG_NO_AUDIO, FLAG_YEASAYER, type Session } from './session';

export interface ResultWord {
  lemma: string;
  p: number;
  rank: number;
}

/** Итог (§4.3); имена полей — контракт gateway (JSON Go). */
export interface Result {
  level: 'A1' | 'A2' | 'B1+';
  vocab_size: number;
  ci90: [number, number];
  listening_offset: number;
  flags: string[];
  words: ResultWord[];
  items: number;
}

/** R4: слово известно при P* ≥ 0.5. */
export const RESULT_THRESHOLD = 0.5;
/** listening_gap — только при P(δ ≥ listeningGap) ≥ 0.8 (у равномерного prior это 4/7). */
export const LISTENING_CONF = 0.8;

const sumOf = (xs: number[]) => xs.reduce((t, x) => t + x, 0);

/** int(math.Round(x/50)*50) Go. */
export function round50(x: number): number {
  return goInt(goRound(x / 50) * 50);
}

/** Расстояние x/50 до границы округления (k + 0.5) — запас решения round50. */
function round50Margin(x: number): number {
  const r = x / 50;
  return Math.abs(Math.abs(r - Math.trunc(r)) - 0.5);
}

function level(s: Session, size: number): Result['level'] {
  if (size < s.p.a1Max) return 'A1';
  if (size < s.p.a2Max) return 'A2';
  return 'B1+';
}

/** Квантиль с событием запаса: min(c_i − p, p − c_{i−1}) на шаге пересечения. */
function quantileTraced(s: Session, p: number): number {
  const m = s.q.marginalTheta();
  let c = 0;
  for (let i = 0; i < m.length; i++) {
    const prev = c;
    c += m[i];
    if (c >= p) {
      const th = s.q.thetas[i];
      s.emit('quantile', th, i === 0 ? c - p : Math.min(c - p, p - prev), p);
      return th;
    }
  }
  const th = s.q.thetas[s.q.thetas.length - 1];
  s.emit('quantile', th, null, p);
  return th;
}

/** Топ floorWords банка (P=0.5) и слова, верно отвеченные в S3 (P=1), без неверных; по рангу. */
function yeaSayerWords(s: Session): ResultWord[] {
  const out: ResultWord[] = [];
  s.b.words.forEach((w, i) => {
    const ok = s.s3Result.get(i);
    if (ok === true) out.push({ lemma: w.lemma, p: 1, rank: w.rank });
    else if (ok === undefined && i < s.p.floorWords) out.push({ lemma: w.lemma, p: 0.5, rank: w.rank });
  });
  return out;
}

export function computeResult(s: Session): Result {
  const em = s.mMean();
  const q05 = quantileTraced(s, 0.05);
  const q95 = quantileTraced(s, 0.95);
  const pstar = s.hasFlag(FLAG_YEASAYER) ? s.pStarAt(q05, em) : s.pStarPosterior(em);
  const sum = sumOf(pstar);
  const flags = [...s.flags];
  // δ_L измеряется только клипами S4; без них E[δ] — среднее prior, а не измерение.
  let delta = 0;
  if (s.s4.issuedA + s.s4.issuedB > 0) delta = s.q.meanDelta();
  if (delta > 0) {
    const pr = s.q.probDeltaAtLeast(s.p.listeningGap);
    s.emit('listening', pr, pr - LISTENING_CONF);
    if (pr >= LISTENING_CONF && !flags.includes(FLAG_LISTENING_GAP)) flags.push(FLAG_LISTENING_GAP);
  }
  s.emit('round50', sum, round50Margin(sum), 'size');
  const vocab = s.b.free_top + round50(sum);
  const lo = sumOf(s.pStarAt(q05, em));
  const hi = sumOf(s.pStarAt(q95, em));
  s.emit('round50', lo, round50Margin(lo), 'ci_lo');
  s.emit('round50', hi, round50Margin(hi), 'ci_hi');
  const ci90: [number, number] = [
    Math.min(s.b.free_top + round50(lo), vocab),
    Math.max(s.b.free_top + round50(hi), vocab),
  ];

  const passed: ResultWord[] = [];
  pstar.forEach((v, i) => {
    s.emit('word_p', v, v - RESULT_THRESHOLD, i);
    if (v >= RESULT_THRESHOLD) passed.push({ lemma: s.b.words[i].lemma, p: v, rank: s.b.words[i].rank });
  });
  s.emit('result_sum', sum, sum - s.p.floorWords);
  let words: ResultWord[];
  if (s.hasFlag(FLAG_FLOOR) || s.hasFlag(FLAG_NO_AUDIO) || sum < s.p.floorWords || passed.length === 0) {
    if (!flags.includes(FLAG_FLOOR)) flags.push(FLAG_FLOOR);
    words = [];
    for (let i = 0; i < Math.min(s.p.floorWords, s.b.words.length); i++) {
      words.push({ lemma: s.b.words[i].lemma, p: 0.5, rank: s.b.words[i].rank });
    }
  } else if (s.hasFlag(FLAG_YEASAYER)) {
    words = yeaSayerWords(s);
  } else {
    words = passed;
  }
  return { level: level(s, vocab), vocab_size: vocab, ci90, listening_offset: delta, flags, words, items: s.answered };
}
