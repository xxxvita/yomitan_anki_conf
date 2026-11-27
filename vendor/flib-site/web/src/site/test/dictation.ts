/**
 * ТЗ-4 — диктант. Порт 1:1 из onboarding-test.html (scoreDict/estDecoding).
 * Упрощённый скорер (см. text-scoring.ts): орфография+омофоны, без espeak IPA.
 */
import { DICTATION_CEFR_BASE } from './stimuli';
import { align, canon, mleTheta } from './text-scoring';
import { round2 } from './math';
import type { DecodingResult, DictationSentence, TokenScore } from './types';

/**
 * Скорит одно диктантное предложение: выравнивает напечатанный текст с эталоном,
 * присваивает каждому распознанному эталонному токену band-сложность
 * (CEFR-база + бонус за "избыточный"/длинный токен) и вердикт (0|0.4|0.9|1).
 * Вставки (typed-токены без пары в эталоне) не порождают строк — считаются только
 * по эталонным токенам, как в референсе.
 */
export function scoreDictSentence(sentence: DictationSentence, typed: string): TokenScore[] {
  const ref = canon(sentence.text);
  const typedTokens = canon(typed);
  const pairs = align(typedTokens, ref);

  const redundant = new Set<string>();
  sentence.redundant.forEach((x) => canon(x).forEach((t) => redundant.add(t)));

  const tokens: TokenScore[] = [];
  pairs.forEach(([, r, c]) => {
    if (r === null) return; // typed-only вставка — не эталонный токен, пропускаем
    const isRedundant = redundant.has(r);
    const isLong = r.length >= 8;
    const band = DICTATION_CEFR_BASE[sentence.cefr] + (isRedundant ? 1 : 0) + (isLong ? 0.5 : 0);
    tokens.push([band, c === null ? 0 : c]);
  });
  return tokens;
}

/**
 * Оценка theta_decoding по всем ответам диктанта (MLE по объединённым токенам).
 *
 * `thetaVocab`/`vocabSigma` приняты для соответствия контракту вызова (согласован с
 * UI-слоем), но референс НЕ использует приор словаря при MLE декодинга — это чистая
 * MLE по токенам диктанта с фиксированным наклоном (см. mleTheta в text-scoring.ts).
 * Параметры сознательно не влияют на результат — 1:1 порт математики референса.
 */
/**
 * Порог «ответ есть»: минимум распознанных typed-токенов, чтобы предложение
 * участвовало в MLE. Пустой/почти пустой ответ («не расслышал» — UI прямо
 * обещает, что это без штрафа, DictationScreen) — это ОТСУТСТВИЕ сигнала, а
 * не сигнал «всё неверно»: без порога align([], ref) даёт c=0 на каждый
 * эталонный токен и утягивает θ к полу сетки — blank становился ХУЖЕ любого
 * реального неверного ответа (аудит Э4-финал, CRIT). Зеркало skip-логики
 * ei.ts (там порог 4 токена на фразу; здесь 1 — диктант короткие фразы, даже
 * частичный ответ информативен).
 */
const DICT_MIN_TYPED_TOKENS = 1;

export function estimateDecoding(
  responses: Array<[DictationSentence, string]>,
  _thetaVocab?: number,
  _vocabSigma?: number,
): DecodingResult {
  const tokens: TokenScore[] = [];
  let scoredSentences = 0;
  responses.forEach(([sentence, typed]) => {
    if (canon(typed).length < DICT_MIN_TYPED_TOKENS) return; // «не расслышал» — без штрафа
    scoredSentences += 1;
    scoreDictSentence(sentence, typed).forEach((t) => tokens.push(t));
  });
  if (!scoredSentences || !tokens.length) return { theta: null };
  const [theta, sd] = mleTheta(tokens);
  return { theta: round2(theta), se: round2(sd) };
}
