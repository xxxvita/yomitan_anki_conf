// Канал «Мои знания» модуля placement (knowledge.words@1; спека §7.1–§7.3, §5.4). Ответ — ТОЛЬКО из
// pt_results/last (принятый прогон, R16): и элементы, и revision. Ожидающий (pt_pending), отвергнутый и
// незавершённый (pt.session) прогоны в канал не попадают; pt.history не читается (сбой финиша между docs и историей
// иначе отдал бы новые элементы под старой ревизией).
// Фоновый вид ТОЛЬКО ЧИТАЕТ: очередь записей store.ts — своя у каждой страницы, писать имеет право лишь шторка.
// Банк не нужен: rank и cefrj лежат в results/last. Числа таблицы — только в confidence.ts.
// ⚠️ Любое изменение отдаваемого содержимого (cleanText, kind, дубли, отбор слов, from, learned_at, TEXT_MAX_RUNES)
// — поднимите SNAPSHOT_V в confidence.ts: ревизия "<run_id>:<SNAPSHOT_V>" иначе не сменится и хост оставит старый
// снимок. Сторож — золотой снимок в knowledge.test.ts.
import type { KnowledgeItem } from './host';
import { SNAPSHOT_V, confidenceOf, levelNum, runIsEmpty } from './confidence';
import { sha1Hex } from './engine/sha1';
import { COL_RESULTS, ID_LAST, LEVELS, type Level, type StoreHost } from './store';

/** Ревизия «принятых прогонов нет». С "<run_id>:<v>" не совпадает: там всегда есть «:». */
export const REVISION_NONE = 'none';
/** Потолок ревизии у хоста (host-api.md). */
const REVISION_MAX = 128;
/** Потолок text у ядра (knowledge_const.go knowledgeMaxTextRunes). */
const TEXT_MAX_RUNES = 200;

/** "<run_id>:<SNAPSHOT_V>" (§5.4); длиннее потолка хоста — её sha1 (стабильно, тот же вход — та же ревизия). */
export function revisionOf(runId: string, tableV: number = SNAPSHOT_V): string {
  const r = `${runId}:${tableV}`;
  return r.length <= REVISION_MAX ? r : `sha1:${sha1Hex(r)}`;
}

/** Что снимку нужно от хоста: ЧТЕНИЕ одного документа — записей нет и по типу. */
export interface KnowledgeHost {
  docs: { get: StoreHost['docs']['get'] };
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isLevel = (x: unknown): x is Level => (LEVELS as readonly unknown[]).includes(x);
const isCefrj = (x: unknown): x is number => Number.isInteger(x) && (x as number) >= 0 && (x as number) <= 4;
const pad2 = (n: number) => String(n).padStart(2, '0');
/** Местная дата YYYY-MM-DD (человек видит день прохождения у себя, а не по UTC). */
const localDate = (ms: number) => { const t = new Date(ms); return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`; };
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

interface LastHead { run_id: string; level: Level; flags: string[]; taken_at: string; words: unknown[] }

/** Шапка документа; не та форма — ошибка (хост оставит прошлый снимок, источник покажет ошибку). */
function headOf(body: unknown): LastHead {
  if (!isObj(body) || typeof body.run_id !== 'string' || body.run_id === '' || !isLevel(body.level)
    || !Array.isArray(body.flags) || !body.flags.every((f) => typeof f === 'string')
    || typeof body.taken_at !== 'string' || !Array.isArray(body.words)) {
    throw new Error('placement: pt_results/last is malformed');
  }
  return body as unknown as LastHead;
}

/**
 * Текст: как у ядра (knowledge_sanitize.go) — NFC, без Cc/Cf, без крайних пробелов, нижний регистр; СВЕРХ ядра —
 * схлопывание внутренних пробелов в один (ядро их не схлопывает): «look  after» и «look after» — один элемент.
 */
function cleanText(s: string): string {
  return s.normalize('NFC').replace(/[\p{Cc}\p{Cf}]/gu, '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Полный снимок из pt_results/last (одно чтение docs; без записей). */
export async function snapshotOf(host: KnowledgeHost): Promise<{ revision: string; items: KnowledgeItem[] }> {
  const e = await host.docs.get<unknown>({ collection: COL_RESULTS, id: ID_LAST });
  if (!e) return { revision: REVISION_NONE, items: [] };
  const d = headOf(e.body);
  const revision = revisionOf(d.run_id);
  if (runIsEmpty(d.flags)) return { revision, items: [] };

  const L = levelNum(d.level);
  const learned = RFC3339.test(d.taken_at) && !Number.isNaN(Date.parse(d.taken_at)) ? d.taken_at : undefined;
  // Без языка интерфейса (§5.4): смена языка не должна менять ревизию.
  const from = learned ? `Test ${localDate(Date.parse(learned))} · ${d.level}` : `Test · ${d.level}`;

  // Текст → элемент; дубль — максимум уверенности, позиция первого появления (ядро сливает так же).
  const best = new Map<string, KnowledgeItem>();
  for (const w of d.words) {
    if (!isObj(w) || typeof w.lemma !== 'string' || !isNum(w.rank) || !isCefrj(w.cefrj)) continue;
    const text = cleanText(w.lemma);
    if (!text || [...text].length > TEXT_MAX_RUNES) continue;
    const confidence = confidenceOf({ rank: w.rank, cefrj: w.cefrj, ...(w.s3 === 1 ? { s3: 1 as const } : {}) }, L, d.flags);
    const prev = best.get(text);
    if (prev && prev.confidence >= confidence) continue;
    // has_card не ставится: у теста карточек Anki нет (§7.5).
    const it: KnowledgeItem = {
      text, kind: /\s/.test(text) ? 'phrase' : 'word', state: 'known', confidence,
      ...(learned ? { learned_at: learned } : {}), from,
    };
    if (prev) Object.assign(prev, it); else best.set(text, it);
  }
  return { revision, items: [...best.values()] };
}
