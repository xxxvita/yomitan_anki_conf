/**
 * ТЗ-2 — стартовый приор из анкеты. Порт 1:1 из onboarding-test.html
 * (функции priorScore, combineTest). Референс называет это "упрощённая свёртка".
 */
import { clampBand } from './math';
import type { PriorResult, SurveyAnswers } from './types';

/** exam -> [mu, sigma] прямого свидетельства уровня. */
const EXAM_TABLE: Record<string, [number, number] | null> = {
  none: null,
  school_only: [2.5, 2.0],
  ege_low: [3.0, 1.9],
  ege_mid: [3.7, 1.9],
  ege_high: [4.3, 1.9],
  pet: [3.5, 0.9],
  ielts_5: [3.9, 1.1],
  ielts_6: [4.6, 1.0],
  ielts_65: [5.5, 1.0],
  ielts_75: [6.8, 1.0],
  fce: [4.8, 0.9],
  cae: [6.5, 0.9],
  cpe: [8.0, 0.9],
};

/** years -> [mu, sigma] длительности/регулярности обучения. */
const YEARS_TABLE: Record<string, [number, number] | null> = {
  '': null,
  lt1: [2.0, 2.0],
  y13c: [2.8, 2.0],
  y13r: [3.5, 1.8],
  y3r: [4.5, 1.8],
  intensive: [5.0, 1.8],
};

/** brk -> [mu_shift, listening_shift, sigma_add] эффект перерыва (Bahrick decay). */
const BREAK_TABLE: Record<string, [number, number, number]> = {
  none: [0, 0, 0],
  lt1y: [0, -0.1, 0.1],
  y13: [0, -0.3, 0.2],
  y310: [-0.1, -0.7, 0.3],
  y10: [-0.3, -1.0, 0.4],
};

/** domain -> [vocab_evidence, listening_skew] на пункт самоотчёта. */
const DOMAIN_TABLE: Record<string, [number, number]> = {
  games: [0.2, 0.3],
  youtube: [0.2, 0.5],
  nosubs: [0.3, 0.7],
  ensubs: [0.3, 0.2],
  rusubs: [0.1, -0.2],
  reading: [0.3, -0.1],
  podcasts: [0.1, 0.6],
  music: [0.1, 0],
  work_meet: [0.4, 0.5],
};

/** env -> [mu|null, listening_shift] длительности погружения в среду. */
const ENV_TABLE: Record<string, [number | null, number]> = {
  no: [null, 0],
  lt6m: [null, 0.3],
  m62y: [4.3, 0.8],
  y2p: [5.0, 1.2],
};

/**
 * Байесовская свёртка анкетных свидетельств в приор (mu, sigma) + перекос слуха.
 * Наблюдения (obs) — [значение, sigma, "уровневое ли"(влияет на CHANNEL_CONFLICT/GLH_CAPPED)].
 */
export function priorFromSurvey(a: SurveyAnswers): PriorResult {
  const obs: Array<[number, number, boolean]> = [];
  let listen = 0;
  let sigmaAdd = 0;
  const flags: string[] = [];

  const exam = EXAM_TABLE[a.exam];
  if (exam) obs.push([exam[0], exam[1], true]);
  if (['school_only', 'ege_low', 'ege_mid', 'ege_high'].includes(a.exam)) {
    listen += a.exam === 'school_only' ? -0.3 : -0.2;
  }

  const years = YEARS_TABLE[a.years];
  if (years) obs.push([years[0], years[1], true]);

  const brk = BREAK_TABLE[a.brk] ?? [0, 0, 0];
  sigmaAdd += brk[2];
  listen += brk[1];

  let vocabEvidence = 0;
  let domainListen = 0;
  (a.domains ?? []).forEach((d) => {
    const v = DOMAIN_TABLE[d];
    if (v) {
      vocabEvidence += v[0];
      domainListen += v[1];
    }
  });
  if (vocabEvidence) obs.push([clampBand(3.5 + Math.min(vocabEvidence, 1.0)), 2.2, false]);
  listen += Math.tanh(domainListen);

  if (a.cando != null) listen += (a.cando - 0.5) * 1.0;

  const env = ENV_TABLE[a.env] ?? [null, 0];
  listen += env[1];
  if (env[0] != null) obs.push([env[0], 1.7, true]);

  const strong = obs.some((o) => o[2] && o[1] <= 1.0);
  const priorSigma = strong ? 3.2 : 2.0;
  let prec = 1 / (priorSigma * priorSigma);
  let num = 3.5 / (priorSigma * priorSigma);
  obs.forEach((o) => {
    prec += 1 / (o[1] * o[1]);
    num += o[0] / (o[1] * o[1]);
  });
  let mu = num / prec;
  let sigma = Math.sqrt(1 / prec);
  mu += brk[0];

  const levelObs = obs.filter((o) => o[2]).map((o): [number, number] => [o[0], o[1]]);
  for (let i = 0; i < levelObs.length; i++) {
    for (let j = i + 1; j < levelObs.length; j++) {
      const conflict = Math.abs(levelObs[i][0] - levelObs[j][0]) / Math.sqrt(levelObs[i][1] ** 2 + levelObs[j][1] ** 2) > 2;
      if (conflict) {
        sigma *= 1.4;
        if (!flags.includes('CHANNEL_CONFLICT')) flags.push('CHANNEL_CONFLICT');
      }
    }
  }

  if (years) {
    const ceiling = years[0] + 1.5;
    if (mu > ceiling) {
      sigma = Math.sqrt(sigma ** 2 + (mu - ceiling) ** 2);
      mu = ceiling;
      flags.push('GLH_CAPPED');
    }
  }

  sigma = Math.max(sigma + sigmaAdd, 0.8);
  mu = clampBand(mu);
  if (!obs.length) flags.push('NO_SIGNAL');

  return {
    mu: +mu.toFixed(2),
    sigma: +sigma.toFixed(2),
    listeningOffset: +clampBand(listen, -1.2, 1.2).toFixed(2),
    flags,
  };
}

/** Байесовская свёртка приора с итогом теста, кап приора ±1 полоса вокруг testMu. */
export function combineWithTest(priorMu: number, priorSigma: number, testMu: number, testSigma: number): number {
  const pp = 1 / (priorSigma * priorSigma);
  const pt = 1 / (testSigma * testSigma);
  const post = (priorMu * pp + testMu * pt) / (pp + pt);
  return clampBand(Math.max(testMu - 1, Math.min(testMu + 1, post)));
}
