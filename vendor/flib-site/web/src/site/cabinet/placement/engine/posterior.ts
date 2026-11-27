// Апостериор на сетке θ×δ_L в логарифмах — порт internal/placement/model/posterior.go.
// Порядок циклов и сумм — как в Go (от него зависят последние биты).
import { goInt, goRound } from './gomath';
import type { Params } from './params';

/** Нижний порог правдоподобия: клетка с нулевым правдоподобием не даёт -Inf и NaN. */
export const LOG_FLOOR = -690.0; // ≈ ln(1e-300)

export class Posterior {
  readonly thetas: number[];
  readonly deltas: number[];
  readonly logw: number[]; // индекс клетки i*deltas.length + j

  /** Нормальный prior по θ из p.priors[prior] (неизвестный → school), равномерный по δ. */
  constructor(p: Params, prior: string) {
    const pr = Object.prototype.hasOwnProperty.call(p.priors, prior) ? p.priors[prior] : p.priors.school;
    const n = goInt(goRound((p.thetaMax - p.thetaMin) / p.thetaStep)) + 1;
    this.thetas = new Array<number>(n);
    for (let i = 0; i < n; i++) this.thetas[i] = p.thetaMin + i * p.thetaStep;
    this.deltas = p.deltas.slice();
    const nd = this.deltas.length;
    this.logw = new Array<number>(n * nd);
    for (let i = 0; i < n; i++) {
      const z = (this.thetas[i] - pr[0]) / pr[1];
      for (let j = 0; j < nd; j++) this.logw[i * nd + j] = -0.5 * z * z;
    }
    normalizeLog(this.logw);
  }

  update(lik: (theta: number, delta: number) => number): void {
    const nd = this.deltas.length;
    for (let i = 0; i < this.thetas.length; i++) {
      const th = this.thetas[i];
      for (let j = 0; j < nd; j++) {
        const l = lik(th, this.deltas[j]);
        let ll = LOG_FLOOR;
        if (l > 0) ll = Math.max(Math.log(l), LOG_FLOOR);
        this.logw[i * nd + j] += ll;
      }
    }
    normalizeLog(this.logw);
  }

  /** Веса по θ (сумма по δ). */
  marginalTheta(): number[] {
    const nd = this.deltas.length;
    const m = new Array<number>(this.thetas.length).fill(0);
    for (let i = 0; i < this.thetas.length; i++) {
      for (let j = 0; j < nd; j++) m[i] += Math.exp(this.logw[i * nd + j]);
    }
    return m;
  }

  meanSDTheta(): [number, number] {
    const m = this.marginalTheta();
    let mean = 0;
    for (let i = 0; i < this.thetas.length; i++) mean += m[i] * this.thetas[i];
    let v = 0;
    for (let i = 0; i < this.thetas.length; i++) {
      const th = this.thetas[i];
      v += m[i] * (th - mean) * (th - mean);
    }
    return [mean, Math.sqrt(v)];
  }

  meanDelta(): number {
    const nd = this.deltas.length;
    let e = 0;
    for (let i = 0; i < this.thetas.length; i++) {
      for (let j = 0; j < nd; j++) e += Math.exp(this.logw[i * nd + j]) * this.deltas[j];
    }
    return e;
  }

  /** P(δ ≥ x) по апостериору. */
  probDeltaAtLeast(x: number): number {
    return this.expect((_, d) => (d >= x - 1e-9 ? 1 : 0));
  }

  /** Квантиль маргинали θ (первая точка сетки, где CDF ≥ p). */
  quantileTheta(p: number): number {
    let c = 0;
    const m = this.marginalTheta();
    for (let i = 0; i < m.length; i++) {
      c += m[i];
      if (c >= p) return this.thetas[i];
    }
    return this.thetas[this.thetas.length - 1];
  }

  /** E[f(θ,δ)] по апостериору. */
  expect(f: (theta: number, delta: number) => number): number {
    const nd = this.deltas.length;
    let e = 0;
    for (let i = 0; i < this.thetas.length; i++) {
      const th = this.thetas[i];
      for (let j = 0; j < nd; j++) e += Math.exp(this.logw[i * nd + j]) * f(th, this.deltas[j]);
    }
    return e;
  }
}

/** Нормировка log-sum-exp на месте (normalizeLog Go). */
export function normalizeLog(lw: number[]): void {
  let mx = -Infinity;
  for (const v of lw) mx = Math.max(mx, v);
  let sum = 0;
  for (const v of lw) sum += Math.exp(v - mx);
  const lz = mx + Math.log(sum);
  for (let i = 0; i < lw.length; i++) lw[i] -= lz;
}
