// Параметры модели — порт internal/placement/model/params.go (значения DefaultParams, спека §4).
// Имена — camelCase от полей Go (Alpha → alpha, S4aClips → s4aClips); paramsFromGo — для векторов.

export interface Params {
  alpha: number; beta: number; slope: number; // b = alpha*ln(rank) + beta*(cefrj-1), cefrj=0 → как 3
  thetaMin: number; thetaMax: number; thetaStep: number;
  deltas: number[];
  gPrior: [number, number]; // Beta-prior склонности к ложным «да»
  mPrior: [number, number]; // Beta-prior доли «знаю значение | узнал форму»
  priors: Record<string, [number, number]>;
  stopSD: number;
  minS2: number; maxS2: number;
  pseudoEvery: number;
  s3Items: number; s4aClips: number; s4bClips: number;
  s4bGate: number;
  yeaG: number;
  yeaMinPseudo: number;
  floorWords: number;
  a1Max: number; a2Max: number;
  listeningGap: number;
  maxSkipRun: number; // подряд пропусков (звук не играет) → тест завершается с no_audio
}

export function defaultParams(): Params {
  return {
    alpha: 1.0, beta: 0.35, slope: 1.7,
    thetaMin: 3.0, thetaMax: 11.0, thetaStep: 0.05,
    deltas: [0, 0.25, 0.5, 0.75, 1.0, 1.25, 1.5],
    gPrior: [1, 9],
    mPrior: [7, 3],
    priors: {
      zero: [5.7, 0.8],
      school: [7.1, 0.9],
      subs: [7.8, 0.9],
      no_subs: [8.3, 0.9],
    },
    stopSD: 0.25, minS2: 12, maxS2: 45,
    pseudoEvery: 4,
    s3Items: 8, s4aClips: 5, s4bClips: 3,
    s4bGate: 0.6,
    yeaG: 0.30, yeaMinPseudo: 4,
    floorWords: 50,
    a1Max: 1500, a2Max: 2500,
    listeningGap: 0.75,
    maxSkipRun: 5,
  };
}

/** Params из JSON Go (поля с заглавной буквы: Alpha, S4aClips, …) — формат золотых векторов. */
export function paramsFromGo(g: Record<string, unknown>): Params {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(g)) {
    const m = /^(S\d|A\d)(.*)$/.exec(k);
    const key = m ? m[1].toLowerCase() + m[2] : k[0].toLowerCase() + k.slice(1);
    out[key] = v;
  }
  const p = out as unknown as Params;
  const want = Object.keys(defaultParams()).sort();
  const got = Object.keys(p).sort();
  if (want.join() !== got.join()) throw new Error(`params: fields ${got.join()} != ${want.join()}`);
  return p;
}

/** Трудность слова на шкале θ: alpha*ln(rank) + beta*(cefrj-1); cefrj=0 → как B1 (3). */
export function difficulty(p: Params, rank: number, cefrj: number): number {
  if (cefrj === 0) cefrj = 3;
  if (rank < 1) rank = 1;
  return p.alpha * Math.log(rank) + p.beta * (cefrj - 1);
}

export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}
