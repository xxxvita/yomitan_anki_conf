// survey-data.ts — типизированный порт temp/flib/test-data.js SURVEY_* (Э4),
// с привязкой к реальным enum-типам SurveyAnswers (web/src/site/test/types.ts).
//
// Русские лейблы (`options`, из temp/flib/test-data.js дословно) и enum-
// значения математики (`values`, priorFromSurvey()) — ПОЗИЦИОННО совпадающие
// массивы одинаковой длины: options[i] на экране соответствует values[i] в
// SurveyAnswers. Это не совпадение — test-data.js и test/types.ts независимо
// портируют один и тот же vanilla-JS референс (onboarding-test.html), у
// которого те же 13/6/5/4/9 вариантов в том же порядке. Поля здесь названы
// как в SurveyAnswers (exam/years/brk/env), а не как в исходном
// test-data.js (exam/learned/gap/abroad) — one less translation table.
import type { ExamLevel, YearsStudied, BreakLength, ExposureDomain, ImmersionEnv } from './math'

export interface SurveySelectField<V extends string> {
  label: string
  options: string[]
  values: V[]
}

export const SURVEY_FIELDS: {
  exam: SurveySelectField<ExamLevel>
  years: SurveySelectField<YearsStudied>
  brk: SurveySelectField<BreakLength>
  env: SurveySelectField<ImmersionEnv>
} = {
  exam: {
    label: 'Экзамен по английскому?',
    options: [
      'Не сдавал(а)', 'Только школа', 'ЕГЭ <60', 'ЕГЭ 60–80', 'ЕГЭ 80–100',
      'Cambridge B1 (PET)', 'IELTS 5.0–5.5', 'IELTS 6.0', 'IELTS 6.5–7.0', 'IELTS 7.5+',
      'Cambridge B2 (FCE)', 'Cambridge C1 (CAE)', 'Cambridge C2 (CPE)',
    ],
    values: ['none', 'school_only', 'ege_low', 'ege_mid', 'ege_high', 'pet', 'ielts_5', 'ielts_6', 'ielts_65', 'ielts_75', 'fce', 'cae', 'cpe'],
  },
  years: {
    label: 'Сколько и как учил(а)?',
    options: ['—', '<1 года изредка', '1–3 года изредка', '1–3 года регулярно', '3+ года регулярно', 'Интенсив-подготовка'],
    values: ['', 'lt1', 'y13c', 'y13r', 'y3r', 'intensive'],
  },
  brk: {
    label: 'Перерыв, когда не трогал(а) язык?',
    options: ['Нет', '<1 года', '1–3 года', '3–10 лет', '10+ лет'],
    values: ['none', 'lt1y', 'y13', 'y310', 'y10'],
  },
  env: {
    label: 'Жил(а) в англоязычной среде?',
    options: ['Нет', '<6 мес', '6 мес–2 года', '2+ года'],
    values: ['no', 'lt6m', 'm62y', 'y2p'],
  },
}

export const SURVEY_EXPOSURE_OPTIONS: string[] = [
  'игры EN', 'YouTube EN', 'сериалы без сабов', 'сериалы EN-сабы',
  'сериалы RU-сабы', 'чтение', 'подкасты', 'музыка', 'английский на работе',
]
export const SURVEY_EXPOSURE_VALUES: ExposureDomain[] = [
  'games', 'youtube', 'nosubs', 'ensubs', 'rusubs', 'reading', 'podcasts', 'music', 'work_meet',
]

// Самооценка слуха — cando в SurveyAnswers это ЧИСЛО (доля отмеченных из 3,
// см. test/types.ts:51), не список строк — SurveyScreen.tsx считает
// self.length/3 из выбранных лейблов ниже.
export const SURVEY_SELF: string[] = [
  'Понимаю простые фразы на слух', 'Слежу за сериалом с EN-сабами', 'Понимаю живую речь без сабов',
]

// «Какой сериал/фильм хочешь понимать без субтитров» — НЕ входит в
// SurveyAnswers (математика приора её не использует); используется только
// для synthesize()'s опционального target-параметра, см. TARGET_PRESETS
// (web/src/site/test/stimuli.ts) и SurveyScreen.tsx targetForGoal().
export const SURVEY_GOALS: string[] = ['Friends', 'The Office', 'BBC News', 'Zootopia', 'Lex Fridman', 'Harry Potter']
