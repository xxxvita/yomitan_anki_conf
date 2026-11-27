// Таблица уверенности канала «Мои знания» (спека §7.1, R8; числа приняты владельцем — R18). ЕДИНСТВЕННОЕ место
// этих чисел среди не-тестовых src модуля (сторож — confidence.test.ts).
// ⚠️ SNAPSHOT_V — версия ВСЕГО отдаваемого снимка: этой таблицы И правил knowledge.ts (чистка текста, kind, дубли,
// отбор слов, from, learned_at). Любое изменение отдаваемого содержимого — поднимите SNAPSHOT_V: ревизия канала
// "<run_id>:<SNAPSHOT_V>" сменится, и хост перечитает снимок (§5.4; в спеке/плане — CONF_TABLE_V). Иначе хост
// ответит себе `unchanged` и оставит старые элементы. Сторож — золотой снимок в knowledge.test.ts.
import { FLAG_CARELESS, FLAG_FLOOR, FLAG_YEASAYER } from './engine/session';
import type { Level, ResultsWord } from './store';

/** Версия отдаваемого снимка (таблица + правила knowledge.ts) — часть ревизии канала. */
export const SNAPSHOT_V = 1;
/** Остальное (и всё у прогона с yeasayer/careless). Ниже 90: видно только обмену маршрута (§7.2). */
export const CONF_BASE = 50;
/** Подтверждено в S3 (верный перевод). */
export const CONF_S3 = 70;
/** Частое и на уровень ниже человека (b = L − 1): known_offanki — известно всем. */
export const CONF_FREQ_NEAR = 90;
/** Частое и на два уровня ниже и больше (b ≤ L − 2). */
export const CONF_FREQ_FAR = 95;
/** «Частое» — rank ≤ этой границы в банке (граница S2-диапазонов). */
export const FREQ_RANK_MAX = 3000;
/** CEFR-J 0 («нет в списке») считается как b = 3, как Difficulty модели. */
const CEFRJ_UNLISTED_AS = 3;

const LEVEL_NUM: Record<Level, number> = { A1: 1, A2: 2, 'B1+': 3 };

/** L прогона: A1=1, A2=2, B1+=3. */
export const levelNum = (l: Level): number => LEVEL_NUM[l];

/** b слова: CEFR-J 1..4; 0 → 3. */
export const wordLevel = (cefrj: number): number => (cefrj === 0 ? CEFRJ_UNLISTED_AS : cefrj);

/** Принятый прогон с floor — снимок пустой (§7.1, §10 п.6): отдаётся только признанное известным (R7). */
export const runIsEmpty = (flags: readonly string[]): boolean => flags.includes(FLAG_FLOOR);

const runIsCapped = (flags: readonly string[]) => flags.includes(FLAG_YEASAYER) || flags.includes(FLAG_CARELESS);

/** Уверенность слова из results/last.words (сверху вниз, первое совпавшее; floor — до вызова, runIsEmpty). */
export function confidenceOf(w: Pick<ResultsWord, 'rank' | 'cefrj' | 's3'>, L: number, flags: readonly string[]): number {
  if (runIsCapped(flags)) return CONF_BASE;
  const frequent = w.rank >= 1 && w.rank <= FREQ_RANK_MAX;
  const b = wordLevel(w.cefrj);
  if (frequent && b <= L - 2) return CONF_FREQ_FAR;
  if (frequent && b === L - 1) return CONF_FREQ_NEAR;
  if (w.s3 === 1) return CONF_S3;
  return CONF_BASE;
}
