/**
 * ТЗ-5 — Elicited Imitation (повтор по памяти). Порт 1:1 из onboarding-test.html
 * (scoreEI/estEI). Упрощённый скорер: орфография+омофоны, без espeak IPA.
 */
import { FUNCTION_WORDS } from './stimuli';
import { align, canon, mleTheta } from './text-scoring';
import { round2 } from './math';
import type { EIResult, EISentence, TokenScore } from './types';

/**
 * Скорит одно EI-предложение: band растёт линейно с позицией токена в предложении
 * (0.12 за позицию — конец длинной фразы сложнее удержать в памяти), +0.4 за
 * содержательное (не служебное) слово.
 */
export function scoreEISentence(sentence: EISentence, typed: string): TokenScore[] {
  const ref = canon(sentence.text);
  const typedTokens = canon(typed);
  const pairs = align(typedTokens, ref);

  const tokens: TokenScore[] = [];
  let ri = 0;
  pairs.forEach(([, r, c]) => {
    if (r === null) return;
    const isContent = !FUNCTION_WORDS.has(r);
    tokens.push([sentence.band + 0.12 * ri + (isContent ? 0.4 : 0), c === null ? 0 : c]);
    ri++;
  });
  return tokens;
}

/**
 * Оценка theta_ei по всем ответам. Ветка "skipped" — если суммарная длина введённого
 * текста по всем предложениям <4 токенов (пользователь пропустил шаг/ничего не напечатал):
 * возвращается {theta:null, skipped:true} БЕЗ штрафа (см. tz6 §3в "EI-скип не роутит вниз").
 *
 * `thetaVocab`/`vocabSigma` приняты для единообразия с estimateDecoding() (по аналогии
 * ожидались UI-слоем), но референс НЕ использует приор словаря при MLE — чистая MLE по
 * токенам EI. Параметры сознательно не влияют на результат — 1:1 порт математики референса.
 */
export function estimateEI(
  responses: Array<[EISentence, string]>,
  _thetaVocab?: number,
  _vocabSigma?: number,
): EIResult {
  const tokens: TokenScore[] = [];
  let typedTokenCount = 0;
  responses.forEach(([sentence, typed]) => {
    typedTokenCount += canon(typed).length;
    scoreEISentence(sentence, typed).forEach((t) => tokens.push(t));
  });
  if (typedTokenCount < 4) return { theta: null, skipped: true };
  const [theta, sd] = mleTheta(tokens);
  return { theta: round2(theta), se: round2(sd), skipped: false };
}
