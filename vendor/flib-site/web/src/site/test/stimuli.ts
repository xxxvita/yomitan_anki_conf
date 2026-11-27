/**
 * Данные онбординг-теста: банк стимулов ТЗ-1, диктант ТЗ-4, EI ТЗ-5, клипы ТЗ-6.
 * Портировано КАК ЕСТЬ (значения не менялись) из vanilla-JS референса:
 * anki_conf-lexicon-lab-ux/onboarding-methodology/web/onboarding-test.html (строки 85-116, 457-461).
 */
import type { CefrLevel, ClipSentence, DictationSentence, EISentence } from './types';

/**
 * Банк слов ТЗ-1, полосы 1-8 (частота устной речи, пересобран из корпуса lexicon.db).
 * По 12 слов на полосу; имена собственные вычищены по регистру.
 */
export const WORD_BANDS: Record<number, string[]> = {
  1: ['yes', 'challenge', 'haven', 'add', 'magic', 'fault', 'photo', 'stick', 'loved', 'team', 'quiet', 'hoping'],
  2: ['showing', 'freeze', 'extremely', 'suffering', 'male', 'lied', 'opinion', 'evil', 'bone', 'explanation', 'therefore', 'complex'],
  3: ['reveal', 'invitation', 'unusual', 'cycle', 'instruction', 'quiz', 'researcher', 'unlike', 'papa', 'slave', 'symptom', 'user'],
  4: ['challenging', 'teenage', 'mortal', 'diamonds', 'rub', 'maker', 'confess', 'mill', 'jungle', 'estimate', 'trend', 'forbid'],
  5: ['rushed', 'puppet', 'kindly', 'supper', 'packing', 'fist', 'fragile', 'compromised', 'requirement', 'phenomenon', 'neural', 'confirmation'],
  6: ['pursuing', 'hub', 'sinking', 'norm', 'diplomacy', 'advisor', 'clearance', 'consultant', 'spoil', 'wrestling', 'centimeter', 'berry'],
  7: ['camel', 'ammunition', 'disabled', 'broader', 'relic', 'rains', 'influential', 'jealousy', 'spinal', 'tornado', 'matched', 'aerial'],
  8: ['chromosome', 'opioid', 'drought', 'brute', 'sparks', 'innit', 'hash', 'clam', 'ranking', 'erupt', 'peril', 'peacefully'],
};

/** Псевдослова (не существующие в английском) — оценка false-alarm rate. */
export const PSEUDOWORDS: string[] = [
  'blicket', 'glinth', 'trisk', 'vope', 'sleeb', 'narb', 'brundle', 'sprock',
  'drenth', 'plosh', 'snurp', 'gorl', 'spize', 'klemp', 'murd', 'thrup',
];

/** Контрольные сверхчастотные слова — проверка невнимательности (careless). */
export const CONTROL_WORDS: string[] = ['dog', 'book', 'water', 'friend'];

/** Базовая полоса CEFR-уровня диктантных предложений (используется scoreDictSentence). */
export const DICTATION_CEFR_BASE: Record<CefrLevel, number> = {
  A2: 2.5,
  B1: 3.75,
  B2: 4.75,
  C1: 6.0,
  C2: 7.5,
};

/** Предложения ТЗ-4 (диктант). `redundant` — не строго обязательные токены (стяжения-варианты). */
export const DICTATION_SENTENCES: DictationSentence[] = [
  { cefr: 'A2', text: "I have a cup of tea before breakfast.", redundant: [] },
  { cefr: 'A2', text: "She said she'd be a little late tonight.", redundant: ["she'd"] },
  { cefr: 'B1', text: "We were gonna leave early, but it started raining.", redundant: ['gonna'] },
  { cefr: 'B1', text: "He said he'd have finished the whole report by Friday.", redundant: ["he'd", "he'd have"] },
  { cefr: 'B2', text: "If I'd known you were coming, I would've made dinner.", redundant: ["i'd", "would've"] },
  { cefr: 'C1', text: "There's no way anyone could've predicted what happened afterwards.", redundant: ["there's", "could've"] },
  { cefr: 'C1', text: "You can't just assume they'll agree with everything you say.", redundant: ["can't", "they'll"] },
  { cefr: 'C2', text: "Had he been paying attention, he'd have caught the mistake immediately.", redundant: ["he'd", "he'd have"] },
];

/** Предложения ТЗ-5 (Elicited Imitation / повтор по памяти), `band` — базовая сложность. */
export const EI_SENTENCES: EISentence[] = [
  { text: 'The cat is sleeping under the wooden chair.', band: 3.0 },
  { text: 'My brother always forgets to lock the front door.', band: 3.5 },
  { text: 'They wanted to cancel the trip because of rain.', band: 4.0 },
  { text: "She couldn't remember exactly where she had parked the car.", band: 5.0 },
  { text: 'Everyone quietly agreed that the meeting had lasted far too long.', band: 5.5 },
  { text: 'Despite the noise outside, he somehow managed to finish his essay.', band: 6.0 },
];

/** Клипы ТЗ-6 (клип-верификация): объективный частотный профиль (share по полосам b1..b8). */
export const CLIP_SENTENCES: ClipSentence[] = [
  { band: 3, share: [0.5, 0.25, 0.15, 0.06, 0.02, 0.01, 0.01, 0], text: 'The little boy opened the door and looked outside.' },
  { band: 5, share: [0.35, 0.2, 0.15, 0.12, 0.1, 0.05, 0.02, 0.01], text: 'She reluctantly admitted that the whole plan had been rather clumsy.' },
  { band: 7, share: [0.25, 0.18, 0.15, 0.12, 0.1, 0.09, 0.07, 0.04], text: 'His perfunctory remarks did little to quell their mounting unease.' },
];

/** Целевые пресеты анкеты (q-target: "какой сериал/фильм хочешь понимать"). */
export const TARGET_PRESETS = {
  easy: { title: 'Friends', share: [0.55, 0.2, 0.12, 0.07, 0.03, 0.02, 0.01, 0] },
  hard: { title: 'The Wire', share: [0.32, 0.2, 0.15, 0.12, 0.09, 0.06, 0.04, 0.02] },
} as const;

// ============================================================
// Словари скореров ТЗ-4/5 (браузерная версия: орфография+омофоны, без espeak IPA)
// ============================================================

/** Раскрытие стяжений при канонизации текста (canon()). */
export const CONTRACTIONS: Record<string, string> = {
  "she'd": 'she would', "he'd": 'he would', "i'd": 'i would', "we'd": 'we would',
  "they'd": 'they would', "you'd": 'you would', "would've": 'would have', "could've": 'could have',
  "should've": 'should have', "there's": 'there is', "that's": 'that is', "it's": 'it is',
  "he's": 'he is', "she's": 'she is', gonna: 'going to', wanna: 'want to',
  "don't": 'do not', "didn't": 'did not', "won't": 'will not', "can't": 'can not',
  "couldn't": 'could not', "wouldn't": 'would not', "i'm": 'i am', "you're": 'you are',
  "they're": 'they are', "i'll": 'i will', "you'll": 'you will', "he'll": 'he will',
  "she'll": 'she will', "they'll": 'they will', "that'll": 'that will', "i've": 'i have',
  "you've": 'you have', "we've": 'we have', "they've": 'they have', cannot: 'can not',
};

/** Гомофоны — не считаются ошибкой при диктанте/EI (tokenVerdict). */
export const HOMOPHONES: Record<string, string> = {
  to: 'too', too: 'to', two: 'to', there: 'their', their: 'there',
  for: 'four', by: 'buy', here: 'hear', hear: 'here', no: 'know', know: 'no',
};

/** Неправильные формы -> лемма, для сравнения "по стему" (stem()). */
export const IRREGULAR_VERBS: Record<string, string> = {
  forgot: 'forget', forgets: 'forget', went: 'go', made: 'make', said: 'say',
  parked: 'park', wanted: 'want', agreed: 'agree', managed: 'manage',
  lasted: 'last', finished: 'finish', sleeping: 'sleep', coming: 'come', raining: 'rain',
};

/** Служебные слова — в EI не несут "содержательного" веса (isContent=false). */
export const FUNCTION_WORDS: Set<string> = new Set(
  ('the a an is are was were be to of in on under at for with and but or because that where who ' +
    'what he she it they we you i my his her their your its him them this had has have do does did ' +
    'will would could should not no so too').split(' '),
);
