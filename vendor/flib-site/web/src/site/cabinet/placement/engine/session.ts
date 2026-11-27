// Сессия теста (этапы S1–S3, выбор заданий, остановка) — порт internal/placement/model/session.go.
// Детерминирована от (банк, параметры, prior, seed, ответы): восстановление прогона — повтор ответов.
// trace — диагностика порта: событие на каждой точке решения с запасом до границы (golden.test.ts
// сверяет их с testdata/golden/*.margins.json Go). ГСЧ и состояние от trace не зависят.
import type { Bank } from './bank';
import { difficulty, sigmoid, type Params } from './params';
import { newEngineRand, type Rand } from './pcg';
import { normalizeLog, Posterior } from './posterior';
import { computeResult, type Result } from './result';
import { answerS4, enterS4, issueS4, leaveS4a, newS4State, type S4State } from './session_s4';

/** Версия движка: меняется при любой правке, меняющей задания или результат при тех же ответах. */
export const ENGINE_VERSION = '1';

export type Kind = 'aural_yesno' | 'meaning_mc' | 'clip_tap' | 'clip_type';
export type Stage = 'S1' | 'S2' | 'S3' | 'S4a' | 'S4b' | 'done';

export const FLAG_YEASAYER = 'yeasayer';
export const FLAG_CARELESS = 'careless';
export const FLAG_FLOOR = 'floor';
export const FLAG_LISTENING_GAP = 'listening_gap';
export const FLAG_NO_AUDIO = 'no_audio';

/** Задание. lemma и pseudo — внутренние (интерфейс озвучивает по ним, но не показывает). */
export interface Item {
  id: string;
  kind: Kind;
  stage: Exclude<Stage, 'done'>;
  lemma: string;
  pseudo: boolean;
  clipId?: string;
  chips?: string[];
}

/** Ответ; поле — по kind. skipped — звук не проигрался: состояние не меняется, задание заменяется. */
export interface Response {
  yes?: boolean;
  correct?: boolean;
  marked?: string[];
  text?: string;
  skipped?: boolean;
  rt_ms?: number;
}

/**
 * Событие точки решения. value — величина, margin — знаковое расстояние до границы решения
 * (для argmin — разница двух лучших, null при одном кандидате), at — выбранный индекс/имя.
 */
export interface TraceEvent {
  step: number; // заданий выдано к моменту решения
  kind: 's2_stop' | 's2_bucket' | 'yea' | 's4_floor' | 's4_clip' | 's4b_gate'
    | 'quantile' | 'result_sum' | 'round50' | 'listening' | 'word_p';
  value: number;
  margin: number | null;
  at?: number | string;
}

export interface SessionOptions {
  trace?: (ev: TraceEvent) => void;
}

export type PlacementErrorCode = 'item_mismatch' | 'not_done';

export class PlacementError extends Error {
  constructor(readonly code: PlacementErrorCode, message: string) {
    super(message);
    this.name = 'PlacementError';
  }
}

/** Диапазоны рангов S2 (§4.2), [lo, hi), последний включительно. */
export const RANK_BUCKETS: ReadonlyArray<readonly [number, number]> = [[1, 300], [300, 1000], [1000, 2000], [2000, 3000], [3000, 5000], [5000, 8001]];

/** Номер диапазона рангов S2 (0..5); ранг за пределами 8000 — последний. */
export function bucketOf(rank: number): number {
  for (let bk = 0; bk < RANK_BUCKETS.length; bk++) {
    const r = RANK_BUCKETS[bk];
    if (rank >= r[0] && rank < r[1]) return bk;
  }
  return RANK_BUCKETS.length - 1;
}

const M_GRID_N = 20;
const S1_WORDS = 3;
const S1_MAX_RANK = 20;
const TARGET_P_YES = 0.75;

export const mGrid = (k: number) => 0.05 * (k + 1);

export class Session {
  readonly b: Bank;
  readonly p: Params;
  readonly prior: string;
  readonly rng: Rand;
  readonly q: Posterior;
  readonly diff: number[]; // b_w по индексу слова
  gA: number;
  gB: number;
  readonly mLogW: number[];
  readonly flags: string[] = [];
  readonly trace?: (ev: TraceEvent) => void;

  stage: Stage = 'S1';
  issued = 0;
  cur: Item | null = null;
  curWord = -1;
  curBkt = 0;
  answered = 0;
  skipRun = 0;

  readonly usedWord = new Set<number>();
  readonly usedPseudo = new Set<number>();

  s1n = 0;
  s1No = 0;
  s2n = 0;
  s2Pseudo = 0;
  readonly s2Yes: number[] = [];
  s3Queue: number[] = [];
  readonly s3Result = new Map<number, boolean>();

  readonly s4: S4State = newS4State();

  constructor(b: Bank, p: Params, prior: string, seed: bigint, opts: SessionOptions = {}) {
    this.b = b;
    this.p = p;
    this.prior = prior;
    this.rng = newEngineRand(seed);
    this.q = new Posterior(p, prior);
    this.gA = p.gPrior[0];
    this.gB = p.gPrior[1];
    this.trace = opts.trace;
    this.diff = b.words.map((w) => difficulty(p, w.rank, w.cefrj));
    this.mLogW = new Array<number>(M_GRID_N);
    for (let k = 0; k < M_GRID_N; k++) {
      const m = mGrid(k);
      this.mLogW[k] = (p.mPrior[0] - 1) * Math.log(m) + (p.mPrior[1] - 1) * Math.log(Math.max(1 - m, 1e-9));
    }
    normalizeLog(this.mLogW);
  }

  /** Текущее задание (повторный вызов — то же) или null, если тест окончен. */
  next(): Item | null {
    if (this.cur) return cloneItem(this.cur);
    while (this.stage !== 'done') {
      const it = this.issue();
      if (it) {
        this.cur = it;
        return cloneItem(it);
      }
      this.advance();
    }
    return null;
  }

  /** Применяет ответ на текущее задание (сверка по id). */
  answer(it: Item, r: Response): void {
    if (!this.cur || it.id !== this.cur.id) {
      throw new PlacementError('item_mismatch', 'placement: answer is not for the current item');
    }
    const cur = this.cur;
    this.cur = null;
    if (r.skipped) {
      // Слово/клип уже помечены использованными; next выдаст замену. Сплошные пропуски — звук не играет.
      this.skipRun++;
      if (this.p.maxSkipRun > 0 && this.skipRun >= this.p.maxSkipRun) {
        this.addFlag(FLAG_NO_AUDIO);
        this.stage = 'done';
      }
      return;
    }
    this.skipRun = 0;
    this.answered++;
    switch (cur.stage) {
      case 'S1': this.answerS1(r); break;
      case 'S2': this.answerS2(cur, r); break;
      case 'S3': this.answerS3(r); break;
      case 'S4a': case 'S4b': answerS4(this, cur, r); break;
    }
  }

  result(): Result {
    if (this.stage !== 'done' || this.cur) throw new PlacementError('not_done', 'placement: test is not finished');
    return computeResult(this);
  }

  newItem(kind: Kind, lemma: string): Item {
    this.issued++;
    return { id: `it_${this.issued}`, kind, stage: this.stage as Item['stage'], lemma, pseudo: false };
  }

  emit(kind: TraceEvent['kind'], value: number, margin: number | null, at?: number | string): void {
    if (!this.trace) return;
    const ev: TraceEvent = { step: this.issued, kind, value, margin };
    if (at !== undefined) ev.at = at;
    this.trace(ev);
  }

  private issue(): Item | null {
    switch (this.stage) {
      case 'S1': {
        if (this.s1n >= S1_WORDS) return null;
        const hi = Math.min(S1_MAX_RANK, this.b.words.length);
        const w = this.pickWord(0, hi);
        if (w < 0) return null;
        this.curWord = w;
        return this.newItem('aural_yesno', this.b.words[w].lemma);
      }
      case 'S2': {
        if (this.s2Done()) return null;
        if (this.s2n % this.p.pseudoEvery === this.p.pseudoEvery - 1) {
          const k = this.pickPseudo();
          if (k >= 0) {
            this.curWord = -1;
            const it = this.newItem('aural_yesno', this.b.pseudo[k]);
            it.pseudo = true;
            return it;
          }
        }
        const bk = this.chooseBucket();
        if (bk < 0) return null;
        const [lo, hi] = this.bucketRange(bk);
        const w = this.pickWord(lo, hi);
        this.curWord = w;
        this.curBkt = bk;
        return this.newItem('aural_yesno', this.b.words[w].lemma);
      }
      case 'S3': {
        if (this.s3Result.size >= this.p.s3Items || this.s3Queue.length === 0) return null;
        const w = this.s3Queue.shift()!;
        this.curWord = w;
        return this.newItem('meaning_mc', this.b.words[w].lemma);
      }
      case 'S4a': case 'S4b':
        return issueS4(this);
    }
    return null;
  }

  private advance(): void {
    switch (this.stage) {
      case 'S1': this.stage = 'S2'; break;
      case 'S2': this.stage = 'S3'; this.buildS3Queue(); break;
      case 'S3': enterS4(this); break;
      case 'S4a': leaveS4a(this); break;
      default: this.stage = 'done';
    }
  }

  private answerS1(r: Response): void {
    this.s1n++;
    if (!r.yes) this.s1No++;
    if (this.s1n < S1_WORDS) return;
    if (this.prior === 'zero' && this.s1No === S1_WORDS) {
      this.addFlag(FLAG_FLOOR);
      this.stage = 'done';
      return;
    }
    if (this.prior !== 'zero' && this.s1No >= 2) this.addFlag(FLAG_CARELESS);
  }

  private answerS2(it: Item, r: Response): void {
    this.s2n++;
    if (it.pseudo) {
      this.s2Pseudo++;
      if (r.yes) this.gA++;
      else this.gB++;
      if (this.s2Pseudo >= this.p.yeaMinPseudo) {
        const g = this.gHat();
        this.emit('yea', g, g - this.p.yeaG);
        if (g > this.p.yeaG) this.addFlag(FLAG_YEASAYER);
      }
      return;
    }
    const b = this.diff[this.curWord];
    const g = this.gHat();
    const a = this.p.slope;
    const yes = !!r.yes;
    this.q.update((th) => {
      const pk = sigmoid(a * (th - b));
      const py = pk + (1 - pk) * g;
      return yes ? py : 1 - py;
    });
    if (yes) this.s2Yes.push(this.curWord);
  }

  private s2Done(): boolean {
    if (this.hasFlag(FLAG_YEASAYER) || this.s2n >= this.p.maxS2) return true;
    const sd = this.q.meanSDTheta()[1];
    if (this.s2n >= this.p.minS2) this.emit('s2_stop', sd, sd - this.p.stopSD);
    return this.s2n >= this.p.minS2 && sd < this.p.stopSD;
  }

  private answerS3(r: Response): void {
    const ok = !!r.correct;
    this.s3Result.set(this.curWord, ok);
    for (let k = 0; k < this.mLogW.length; k++) {
      const m = mGrid(k);
      let l = m + (1 - m) / 4;
      if (!ok) l = 1 - l;
      this.mLogW[k] += Math.log(Math.max(l, 1e-300));
    }
    normalizeLog(this.mLogW);
  }

  /**
   * Все слова из S2-«да», по кругу по диапазонам от старшего к младшему (ключи — явной сортировкой).
   * Банк v2 (r3): слово без ru (не покрыто словарём) в S3 не идёт — вариантов ответа у него нет. В схеме 1
   * ru нет ни у кого, и фильтр не действует (золотые векторы не меняются). Пропуск таким словом не
   * годится: skipped копит skipRun и после MaxSkipRun ставит ложный no_audio.
   */
  private buildS3Queue(): void {
    const byB = new Map<number, number[]>();
    for (const w of this.s2Yes) {
      if (this.b.schema_version >= 2 && this.b.words[w].ru === undefined) continue;
      const bk = bucketOf(this.b.words[w].rank);
      const xs = byB.get(bk);
      if (xs) xs.push(w);
      else byB.set(bk, [w]);
    }
    const keys = [...byB.keys()].sort((x, y) => y - x);
    for (;;) {
      let took = false;
      for (const k of keys) {
        const xs = byB.get(k)!;
        if (xs.length === 0) continue;
        this.s3Queue.push(xs.shift()!);
        took = true;
      }
      if (!took) break;
    }
  }

  /** Диапазон со свободными словами, где модельная P(yes) медианного слова при θ̂ и ĝ ближе всего к 0.75. */
  private chooseBucket(): number {
    const th = this.q.meanSDTheta()[0];
    const g = this.gHat();
    let best = -1;
    let bestD = Infinity;
    let second = Infinity;
    for (let bk = 0; bk < RANK_BUCKETS.length; bk++) {
      const [lo, hi] = this.bucketRange(bk);
      if (lo >= hi || !this.hasFree(lo, hi)) continue;
      const pk = sigmoid(this.p.slope * (th - this.diff[Math.trunc((lo + hi - 1) / 2)]));
      const d = Math.abs(pk + (1 - pk) * g - TARGET_P_YES);
      if (d < bestD) {
        second = bestD;
        best = bk;
        bestD = d;
      } else if (d < second) {
        second = d;
      }
    }
    if (best >= 0) this.emit('s2_bucket', bestD, Number.isFinite(second) ? second - bestD : null, best);
    return best;
  }

  /** Индексы слов [lo, hi) диапазона bk в words (ранги 1-based); хвост длиннее 8000 — последний. */
  bucketRange(bk: number): [number, number] {
    const lo = RANK_BUCKETS[bk][0] - 1;
    let hi = Math.min(RANK_BUCKETS[bk][1] - 1, this.b.words.length);
    if (bk === RANK_BUCKETS.length - 1) hi = this.b.words.length;
    return [Math.min(lo, hi), hi];
  }

  private hasFree(lo: number, hi: number): boolean {
    for (let i = lo; i < hi; i++) if (!this.usedWord.has(i)) return true;
    return false;
  }

  /** Случайное неиспользованное слово в [lo, hi), помечается использованным; -1 — нет свободных. */
  private pickWord(lo: number, hi: number): number {
    const free: number[] = [];
    for (let i = lo; i < hi; i++) if (!this.usedWord.has(i)) free.push(i);
    if (free.length === 0) return -1;
    const w = free[this.rng.intN(free.length)];
    this.usedWord.add(w);
    return w;
  }

  private pickPseudo(): number {
    const free: number[] = [];
    for (let i = 0; i < this.b.pseudo.length; i++) if (!this.usedPseudo.has(i)) free.push(i);
    if (free.length === 0) return -1;
    const k = free[this.rng.intN(free.length)];
    this.usedPseudo.add(k);
    return k;
  }

  gHat(): number {
    return this.gA / (this.gA + this.gB);
  }

  /** E[m] по сетке. */
  mMean(): number {
    let e = 0;
    for (let k = 0; k < this.mLogW.length; k++) e += Math.exp(this.mLogW[k]) * mGrid(k);
    return e;
  }

  /** P*(w) по апостериору θ. */
  pStarPosterior(em: number): number[] {
    const mt = this.q.marginalTheta();
    const out = new Array<number>(this.b.words.length);
    for (let i = 0; i < this.diff.length; i++) {
      const b = this.diff[i];
      let pf = 0;
      for (let k = 0; k < this.q.thetas.length; k++) pf += mt[k] * sigmoid(this.p.slope * (this.q.thetas[k] - b));
      out[i] = this.override(i, em * pf);
    }
    return out;
  }

  /** P*(w) в точке θ (границы CI90 и yeasayer). */
  pStarAt(theta: number, em: number): number[] {
    return this.diff.map((b, i) => this.override(i, em * sigmoid(this.p.slope * (theta - b))));
  }

  private override(w: number, v: number): number {
    const ok = this.s3Result.get(w);
    if (ok === undefined) return v;
    return ok ? 1 : 0;
  }

  addFlag(f: string): void {
    if (!this.hasFlag(f)) this.flags.push(f);
  }

  hasFlag(f: string): boolean {
    return this.flags.includes(f);
  }
}

function cloneItem(it: Item): Item {
  return it.chips ? { ...it, chips: [...it.chips] } : { ...it };
}

/** Начинает тест. prior — ответ S0 ("zero" | "school" | "subs" | "no_subs"); seed — uint64. */
export function newSession(b: Bank, p: Params, prior: string, seed: bigint, opts: SessionOptions = {}): Session {
  return new Session(b, p, prior, seed, opts);
}
