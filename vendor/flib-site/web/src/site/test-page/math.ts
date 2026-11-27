// math.ts — единственная точка входа test-page/** в математику теста
// (web/src/site/test/**, реализована параллельным агентом того же этапа Э4,
// docs/plan-2026-07-13-design-transfer.md). Все экраны/тесты импортируют
// math-примитивы ОТСЮДА, не напрямую из '../test/*' — поэтому
// `vi.mock('../math', ...)` в тестах экранов остаётся единственной точкой
// мока даже после того, как реальная математика приземлилась.
//
// Реальные сигнатуры (сверено с web/src/site/test/{types,prior,aural-engine,
// dictation,ei,synth,known-words,stimuli}.ts после их появления в этой же
// сессии — ниже НЕ спекуляция, а факт):
//   priorFromSurvey(a: SurveyAnswers): PriorResult  — {mu, sigma, listeningOffset, flags}
//     SurveyAnswers = {exam, years, brk, domains: ExposureDomain[], cando: 0..1, env}
//     (НЕ {learned,gap,abroad,exposure,self,goals} — тест-дата.js использует
//     русские лейблы 1:1 позиционно с этими enum'ами, см. SurveyScreen.tsx)
//   class AuralEngine({priorMu, priorSigma, rng?}):
//     next(): AuralItem|null = {word, isPseudo, isControl, band?}
//     answer('yes'|'seems'|'no'): void — ТРЕБУЕТ, чтобы next() уже вернул
//       не-null айтем (иначе throw) — экраны обязаны это гарантировать.
//     get done(): boolean
//     result(): VocabResult = {sizeLemmas, ci90, finalMu, testSd, estSlope,
//       falseAlarm, flags, responses, n}
//   scoreDictSentence(sentence: DictationSentence, typed: string): TokenScore[]
//   estimateDecoding(responses: Array<[DictationSentence, string]>, thetaVocab?, vocabSigma?): DecodingResult
//     — responses это СЫРЫЕ пары (sentence, typed), НЕ результат scoreDictSentence:
//     estimateDecoding зовёт scoreDictSentence сама на каждую пару. UI поэтому
//     НЕ вызывает scoreDictSentence отдельно (см. DictationScreen.tsx) —
//     единственный практический эффект отдельного вызова был бы "посчитать и
//     выбросить", а это чистая функция без побочных эффектов/валидации.
//     thetaVocab/vocabSigma принимаются math-слоем для соответствия контракту
//     вызова, но математически НЕ используются (комментарий в dictation.ts) —
//     всё равно передаём их (не ломает вызов, документирует намерение).
//   scoreEISentence(sentence: EISentence, typed: string): TokenScore[]
//   estimateEI(responses: Array<[EISentence, string]>, thetaVocab?, vocabSigma?): EIResult
//     — тот же паттерн, что estimateDecoding.
//   synthesize(prior, vocab, dec, ei, clipResults?: number[], target?: TargetProfile): SynthResult
//     — v1 без клип-верификации (TODO в TestPage.tsx): зовём с clipResults=undefined.
//     target — опционален, "какой сериал хочешь понимать" из анкеты (см.
//     TARGET_PRESETS в stimuli.ts, только 2 пресета easy/hard — SurveyScreen
//     мапит выбор на ближайший, см. комментарий там).
//   topNWords(freq: string[], n): string[]
export { priorFromSurvey } from '../test/prior'
export { AuralEngine } from '../test/aural-engine'
export { estimateDecoding } from '../test/dictation'
export { estimateEI } from '../test/ei'
export { synthesize } from '../test/synth'
export { topNWords } from '../test/known-words'
export { DICTATION_SENTENCES, EI_SENTENCES, TARGET_PRESETS } from '../test/stimuli'
export type {
  SurveyAnswers, ExamLevel, YearsStudied, BreakLength, ExposureDomain, ImmersionEnv,
  PriorResult, AuralItem, DictationSentence,
  EISentence, EIResult, SynthResult, SynthPreset, SynthProfile, SynthFit, TargetProfile,
} from '../test/types'

// Локальные алиасы под имена, которыми уже пользуются экраны — держим их,
// чтобы не переименовывать пропсы по всему test-page/** при любой будущей
// правке названий в test/types.ts (один шов, см. шапку файла). Реэкспорт
// VocabResult/DecodingResult ПОД СВОИМ ЖЕ ИМЕНЕМ (не алиасом) через `export
// type {...} from` выше конфликтовал бы с этими же именами ниже — поэтому
// они только здесь, не дублированы в блоке экспорта типов сверху.
import type {
  PriorResult, AuralItem, VocabResult as RealVocabResult, DecodingResult as RealDecodingResult, EIResult,
} from '../test/types'

export type Prior = PriorResult
export type VocabItem = AuralItem
export type VocabResult = RealVocabResult
export type DecodingResult = RealDecodingResult
export type EiResult = EIResult

// sentenceText — DICTATION_SENTENCES/EI_SENTENCES оба гарантированно несут
// поле `text` (test/types.ts DictationSentence/EISentence) — обёртка тонкая,
// оставлена ради единой точки, если поле когда-нибудь переименуют.
export function sentenceText(sentence: { text: string }): string {
  return sentence.text
}

// vocabSigmaFromCi90 — оценка sigma финального словарного постериора из
// 90%-го доверительного интервала result().ci90 (z₀.₉₅≈1.645 на сторону).
// dictation.ts/ei.ts принимают thetaVocab/vocabSigma только "для контракта"
// (математически не используют — см. комментарий выше), так что точность
// этой оценки не критична, но передавать осмысленное число дешевле, чем 0.
export function vocabSigmaFromCi90(ci90: [number, number] | null | undefined): number {
  if (!ci90) return 0
  const [lo, hi] = ci90
  return Math.max(0, (hi - lo) / (2 * 1.645))
}
