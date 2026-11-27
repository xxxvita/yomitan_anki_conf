// Банк заданий стартового теста — схема internal/placement/bank/bank.go (JSON-имена полей те же) и
// строгий загрузчик (П10): схемы 1 и 2; v2 несёт ru и ровно 3 различных дистрактора ≠ ru у слов,
// покрытых словарём (r3: непокрытое слово — без обоих полей, в S3 не идёт).
import { sha1Hex } from './sha1';

export const SCHEMA_V1 = 1;
export const SCHEMA_V2 = 2;

export interface Word {
  lemma: string;
  rank: number; // 1-based, только слова банка (без free layer)
  cefrj: number; // 0 = нет в CEFR-J, иначе 1..4 (A1..B2)
  df: number; // в скольких роликах корпуса
  updated_at?: string;
  ru?: string; // v2: основной перевод (словарь Yomitan ru)
  distractors?: string[]; // v2: ровно 3 неверных перевода, различны и ≠ ru
}

export interface Clip {
  id: string;
  source: string; // "puzzle_movies" | "lingq"
  cefr: number; // 1..4
  lemmas: string[]; // леммы банка, звучащие в клипе
  tokens: string[]; // эталон для clip_type, нижний регистр
  dur_ms: number;
}

export interface Bank {
  schema_version: number;
  version: string;
  free_top: number; // лемм free layer в топ-5000 корпуса
  words: Word[]; // по возрастанию rank
  pseudo: string[];
  clips?: Clip[];
}

type Json = Record<string, unknown>;

function fail(msg: string): never {
  throw new Error(`placement bank: ${msg}`);
}

const isObj = (x: unknown): x is Json => typeof x === 'object' && x !== null && !Array.isArray(x);
const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x);
const isStr = (x: unknown): x is string => typeof x === 'string';

function strArray(x: unknown, what: string): string[] {
  if (!Array.isArray(x) || !x.every(isStr)) fail(`${what}: want string[]`);
  return x.slice();
}

/**
 * Вариант ответа S3 (ru и дистракторы): кириллица (скрипт), между словами один пробел или дефис.
 * Тот же шаблон в Go (bank.IsAnswerText, internal/placement/bank/load.go): на таком алфавите JS
 * toLowerCase и Go strings.ToLower совпадают, поэтому normRu и NormRU дают одно и то же.
 */
export const ANSWER_RE = /^\p{Script=Cyrillic}+(?:[ -]\p{Script=Cyrillic}+)*$/u;

/** Нормализация перевода для сравнения: регистр, пробелы по краям и внутри, ё → е. */
export function normRu(s: string): string {
  return s.normalize('NFC').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

function loadWord(x: unknown, i: number, schema: number): Word {
  if (!isObj(x)) fail(`words[${i}]: want object`);
  const { lemma, rank, cefrj, df, updated_at, ru, distractors } = x;
  if (!isStr(lemma) || lemma === '') fail(`words[${i}].lemma: want non-empty string`);
  if (!isInt(rank) || rank < 1) fail(`words[${i}].rank: want integer ≥ 1`);
  if (!isInt(cefrj) || cefrj < 0 || cefrj > 4) fail(`words[${i}].cefrj: want 0..4`);
  if (!isInt(df) || df < 0) fail(`words[${i}].df: want integer ≥ 0`);
  if (updated_at !== undefined && !isStr(updated_at)) fail(`words[${i}].updated_at: want string`);
  const w: Word = { lemma, rank, cefrj, df };
  if (updated_at !== undefined) w.updated_at = updated_at;
  if (schema === SCHEMA_V1) {
    if (ru !== undefined || distractors !== undefined) fail(`words[${i}]: ru/distractors in schema 1`);
    return w;
  }
  if (ru === undefined && distractors === undefined) return w; // r3: не покрыто словарём
  if (!isStr(ru) || normRu(ru) === '') fail(`words[${i}].ru: want non-empty string with distractors`);
  if (!ANSWER_RE.test(ru)) fail(`words[${i}].ru: want Cyrillic words separated by single space or hyphen: ${JSON.stringify(ru)}`);
  const ds = strArray(distractors, `words[${i}].distractors`);
  if (ds.length !== 3) fail(`words[${i}].distractors: want exactly 3, got ${ds.length}`);
  const seen = new Set([normRu(ru)]);
  for (const d of ds) {
    if (!ANSWER_RE.test(d)) fail(`words[${i}].distractors: want Cyrillic words separated by single space or hyphen: ${JSON.stringify(d)}`);
    const n = normRu(d);
    if (n === '' || seen.has(n)) fail(`words[${i}].distractors: empty, duplicate or equal to ru: ${JSON.stringify(d)}`);
    seen.add(n);
  }
  w.ru = ru;
  w.distractors = ds;
  return w;
}

function loadClip(x: unknown, i: number): Clip {
  if (!isObj(x)) fail(`clips[${i}]: want object`);
  const { id, source, cefr, lemmas, tokens, dur_ms } = x;
  if (!isStr(id) || id === '') fail(`clips[${i}].id: want non-empty string`);
  if (!isStr(source)) fail(`clips[${i}].source: want string`);
  if (!isInt(cefr)) fail(`clips[${i}].cefr: want integer`);
  if (!isInt(dur_ms)) fail(`clips[${i}].dur_ms: want integer`);
  return { id, source, cefr, lemmas: strArray(lemmas, `clips[${i}].lemmas`), tokens: strArray(tokens, `clips[${i}].tokens`), dur_ms };
}

/** Читает банк строго: битый JSON, чужая schema_version или нарушение схемы — ошибка (как bank.Load Go). */
export function loadBank(input: unknown): Bank {
  let x = input;
  if (isStr(x)) {
    try {
      x = JSON.parse(x);
    } catch (e) {
      fail(`bad JSON: ${(e as Error).message}`);
    }
  }
  if (!isObj(x)) fail('want object');
  const { schema_version, version, free_top, words, pseudo, clips } = x;
  if (schema_version !== SCHEMA_V1 && schema_version !== SCHEMA_V2) fail(`schema_version ${String(schema_version)}, want 1 or 2`);
  if (!isStr(version)) fail('version: want string');
  if (!isInt(free_top) || free_top < 0) fail('free_top: want integer ≥ 0');
  if (!Array.isArray(words)) fail('words: want array');
  const b: Bank = {
    schema_version,
    version,
    free_top,
    words: words.map((w, i) => loadWord(w, i, schema_version)),
    pseudo: strArray(pseudo ?? [], 'pseudo'),
  };
  if (clips !== undefined && clips !== null) {
    if (!Array.isArray(clips)) fail('clips: want array');
    b.clips = clips.map(loadClip);
  }
  if (schema_version === SCHEMA_V2 && !b.words.some((w) => w.ru !== undefined)) fail('schema 2 without any ru');
  return b;
}

/** Имя аудиофайла (П13): w_<sha1(лемма)[:12]>.opus для слов, p_<sha1(псевдо)[:12]>.opus для псевдослов. */
export function audioFileOf(kind: 'word' | 'pseudo', text: string): string {
  if (kind !== 'word' && kind !== 'pseudo') fail(`audio kind ${String(kind)}`);
  if (text === '') fail('audio text is empty');
  return `${kind === 'word' ? 'w_' : 'p_'}${sha1Hex(text).slice(0, 12)}.opus`;
}
