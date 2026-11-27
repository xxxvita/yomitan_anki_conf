/**
 * ТЗ-3 — адаптивный ауральный Yes/No тест (постериор θ×a на сетке).
 * Порт 1:1 из onboarding-test.html (function AuralEngine + прототип).
 * См. tz3_adaptive_yesno/METHODICHKA.md для семантики (не для математики — та из кода).
 */
import { CONTROL_WORDS, PSEUDOWORDS, WORD_BANDS } from './stimuli';
import { GRID, SLOPE_GRID, clampBand, q250, sig, sizeOf } from './math';
import { combineWithTest } from './prior';
import type { AuralItem, AuralResponse, VocabResult } from './types';

type ItemKind = 'real' | 'pseudo' | 'control';

interface InternalItem {
  kind: ItemKind;
  word: string;
  band?: number;
}

export interface AuralEngineOptions {
  priorMu: number;
  priorSigma: number;
  /**
   * Инжектируемый генератор случайных чисел, для детерминированных тестов.
   * По умолчанию Math.random. ВАЖНО: сам алгоритм референса детерминирован
   * (нет рандомизации подачи айтемов — порядок полос/псевдослов/контролей фиксирован
   * правилами), поэтому rng в текущей версии не используется движком. Параметр
   * сохранён ради соответствия контракту и будущих расширений (напр. рандомизация
   * порядка слов внутри полосы).
   */
  rng?: () => number;
}

/** Слух-тест ТЗ-3: постериор по сетке (θ×наклон), адаптивная подача, стоп-правила. */
export class AuralEngine {
  private w: number[][];
  private fa: [number, number];
  private seen: Record<number, number>;
  private seemsCount = 0;
  private yesCount = 0;
  private realN = 0;
  private pseudoCount = 0;
  private ctrlHit = 0;
  private ctrlN = 0;
  private i = 0;
  private pwPool: string[];
  private ctrlPool: string[];
  private startBand: number;
  private current: InternalItem | null = null;
  private responses: AuralResponse[] = [];
  private readonly priorMu: number;
  private readonly priorSigma: number;

  constructor(opts: AuralEngineOptions) {
    this.priorMu = opts.priorMu;
    this.priorSigma = opts.priorSigma;
    // rng принят для соответствия контракту (детерминированные тесты), но не хранится —
    // 1:1 порт алгоритма референса не содержит рандомизации подачи айтемов.
    void (opts.rng ?? Math.random);

    // Постериор по (θ,a), проинициализирован гауссианой вокруг центра сетки (не приора —
    // так в референсе: центр 4.5, ширина 3, приор ТЗ-2 участвует только в combineWithTest в конце).
    this.w = GRID.map((t) => SLOPE_GRID.map(() => Math.exp(-0.5 * ((t - 4.5) / 3) ** 2)));
    this.normalize();

    this.fa = [0.5, 2.5]; // Beta(0.5,2.5) приор false-alarm rate (низкий, но не нулевой)
    this.seen = {};
    for (let b = 1; b <= 8; b++) this.seen[b] = 0;
    this.pwPool = [...PSEUDOWORDS];
    this.ctrlPool = [...CONTROL_WORDS];
    this.startBand = Math.max(1, Math.min(8, Math.round(opts.priorMu)));
  }

  private normalize(): void {
    let s = 0;
    this.w.forEach((row) => row.forEach((x) => (s += x)));
    this.w = this.w.map((row) => row.map((x) => x / s));
  }

  private mean(): number {
    let m = 0;
    for (let i = 0; i < GRID.length; i++) {
      const wt = this.w[i][0] + this.w[i][1] + this.w[i][2];
      m += GRID[i] * wt;
    }
    return m;
  }

  private sd(): number {
    const m = this.mean();
    let v = 0;
    for (let i = 0; i < GRID.length; i++) {
      const wt = this.w[i][0] + this.w[i][1] + this.w[i][2];
      v += (GRID[i] - m) ** 2 * wt;
    }
    return Math.sqrt(v);
  }

  /** Маргинализованный по постериору наклон (est_slope в референсе). */
  private meanSlope(): number {
    const s = [0, 0, 0];
    for (let i = 0; i < GRID.length; i++) {
      for (let j = 0; j < 3; j++) s[j] += this.w[i][j];
    }
    return s[0] * 1.0 + s[1] * 1.5 + s[2] * 2.5;
  }

  private falseAlarmRate(): number {
    return this.fa[0] / (this.fa[0] + this.fa[1]);
  }

  /** Стоп-правила: max_items=40 / ранний abort yea-sayer / SD<0.45 после min_items=24. */
  get done(): boolean {
    return (
      this.i >= 40 ||
      (this.i >= 24 && this.pseudoCount >= 6 && this.falseAlarmRate() > 0.25) ||
      (this.i >= 24 && this.sd() < 0.45)
    );
  }

  /** Следующий айтем на озвучку, либо null когда банк исчерпан. */
  next(): AuralItem | null {
    const idx = this.i;
    let item: InternalItem | null = null;

    if ([2, 12, 20].includes(idx) && this.ctrlPool.length) {
      item = { kind: 'control', word: this.ctrlPool.shift()! };
    } else if (idx % 4 === 3 && this.pwPool.length) {
      item = { kind: 'pseudo', word: this.pwPool.shift()! };
    } else {
      let targetBand = this.realN === 0 ? this.startBand : Math.round(this.mean());
      targetBand = Math.max(1, Math.min(8, targetBand));
      search: for (let d = 0; d < 8; d++) {
        const candidates = d ? [targetBand + d, targetBand - d] : [targetBand];
        for (const c of candidates) {
          if (c >= 1 && c <= 8 && this.seen[c] < WORD_BANDS[c].length) {
            const word = WORD_BANDS[c][this.seen[c]];
            this.seen[c]++;
            item = { kind: 'real', word, band: c };
            break search;
          }
        }
      }
      if (!item && this.pwPool.length) {
        item = { kind: 'pseudo', word: this.pwPool.shift()! };
      }
    }

    this.current = item;
    if (!item) return null;
    return {
      word: item.word,
      isPseudo: item.kind === 'pseudo',
      isControl: item.kind === 'control',
      band: item.band,
    };
  }

  /** Ответ на последний айтем, отданный next(). Обновляет постериор θ×a по правилу high-threshold. */
  answer(ans: 'yes' | 'seems' | 'no'): void {
    const item = this.current;
    if (!item) {
      throw new Error('AuralEngine.answer() called without a pending item — call next() first');
    }

    if (item.kind === 'control') {
      this.ctrlN++;
      if (ans === 'yes') this.ctrlHit++;
    } else if (item.kind === 'pseudo') {
      this.pseudoCount++;
      this.fa[ans === 'yes' ? 0 : 1]++;
    } else {
      this.realN++;
      if (ans === 'seems') this.seemsCount++;
      else if (ans === 'yes') this.yesCount++;
      // "seems" трактуется как "yes" для обновления постериора (якорь границы, см. METHODICHKA §7).
      const f = this.falseAlarmRate();
      const yl = ans === 'yes' || ans === 'seems';
      for (let i = 0; i < GRID.length; i++) {
        for (let j = 0; j < 3; j++) {
          const p = f + (1 - f) * sig(SLOPE_GRID[j] * (GRID[i] - item.band! + 0.5));
          this.w[i][j] *= yl ? p : 1 - p;
        }
      }
      this.normalize();
    }

    this.responses.push({
      band: item.band ?? null,
      word: item.word,
      isPseudo: item.kind === 'pseudo',
      isControl: item.kind === 'control',
      answer: ans,
    });
    this.current = null;
    this.i++;
  }

  /** Финальная оценка объёма словаря + CI + флаги добросовестности. */
  result(): VocabResult {
    const testMu = this.mean();
    const testSd = this.sd();
    const finalMu = combineWithTest(this.priorMu, this.priorSigma, testMu, Math.max(testSd, 0.2));

    const inflatedSd = testSd * 1.3; // CI_INFLATE=1.3 — компенсация точечной (не совместной) оценки f
    const size = sizeOf(finalMu);
    const lo = sizeOf(clampBand(finalMu - 1.64 * inflatedSd));
    const hi = sizeOf(clampBand(finalMu + 1.64 * inflatedSd));

    const f = this.falseAlarmRate();
    const pos = this.yesCount + this.seemsCount;
    const shareOfSeems = pos ? this.seemsCount / pos : 0;
    const ctrlAccuracy = this.ctrlN ? this.ctrlHit / this.ctrlN : null;

    const flags: string[] = [];
    if (f > 0.25) flags.push('UNVERIFIED_YEASAYER');
    else if (f > 0.15) flags.push('SUSPECT_YEASAYER');
    if (ctrlAccuracy != null && this.ctrlN >= 3 && this.ctrlN - this.ctrlHit >= 2) flags.push('UNVERIFIED_CARELESS');
    if (pos >= 5 && shareOfSeems > 0.4 && f < 0.12) flags.push('UNVERIFIED_HEDGER');
    if (q250(hi) < 1500 || finalMu < 1.4) flags.push('FLOOR');
    const topBandBelief = sig(this.meanSlope() * (finalMu - 8 + 0.5));
    if (topBandBelief >= 0.5) flags.push('CEILING');

    return {
      finalMu: +finalMu.toFixed(2),
      testSd: +testSd.toFixed(3),
      estSlope: +this.meanSlope().toFixed(2),
      sizeLemmas: q250(size),
      ci90: [q250(lo), q250(hi)],
      falseAlarm: +f.toFixed(3),
      flags,
      n: this.i,
      responses: this.responses,
    };
  }
}
