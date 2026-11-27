// Состояние модуля placement — ВСЕ места записи (спека §5.4, R16, РК-1; план П5, П14, П15, П16):
//   KV   pt.session            — незавершённый прогон: seed (десятичная строка) + ответы для повтора;
//                                 на финише — ещё finishing {outcome, taken_at} (пишется ДО docs);
//   KV   pt.history            — строки прогонов (≤ 50; «Старт», «Сейчас» и ожидающий не обрезаются);
//   docs pt_results/last       — принятый прогон (его читает канал знаний и экран);
//   docs pt_pending/<run_id>   — невалидный прогон, ждущий ответа «Заменить прошлый результат?».
//   KV   pt.provider-ui        — {last_tab} — последняя вкладка «Тест / История» (мелочь UI).
// Порядок финиша: pt.session.finishing → docs → pt.history → dropSession. Инвариант: docs прогона не
// появляются без finishing в его сессии, поэтому недоделанный финиш всегда можно довести без движка и
// банка — это делают openSession и startRun (до сброса/замены сессии), с исходным taken_at.
// Ожидающий прогон — не больше одного: любой финиш закрывает прежние (accepted:false, документы удалены).
// Записи идут строго по одной очереди на страницу (одна страница = один модуль): StrictMode повторяет
// эффекты, и обёртка хоста может пересоздаваться — очередь от тождества объекта хоста не зависит.
// ФОНОВЫЙ ВИД (канал знаний) ДОЛЖЕН ОСТАВАТЬСЯ ТОЛЬКО ЧИТАЮЩИМ: шторка и фоновый вид — разные страницы,
// их очереди не общие; писать состояние имеет право только шторка.
// Битый pt.history (не массив) не перезаписывается никогда: запись истории отказывает (history_corrupt),
// пока явный repairHistory не уберёт значение в резерв pt.history.corrupt.
import type { DocEntry, DocListPage, DocPutParams, DocRef } from './host';
import { ENGINE_VERSION, FLAG_CARELESS, FLAG_FLOOR, FLAG_NO_AUDIO, FLAG_YEASAYER, type Kind, type Response } from './engine/session';

export const COL_RESULTS = 'pt_results', ID_LAST = 'last', COL_PENDING = 'pt_pending';
export const KEY_SESSION = 'pt.session', KEY_HISTORY = 'pt.history', KEY_HISTORY_CORRUPT = 'pt.history.corrupt';
export const HISTORY_CAP = 50;
/** Незавершённый прогон старше суток (с последнего ответа) не восстанавливается (§10 п.1). */
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
/** Прогон с любым из этих флагов ничего надёжного не говорит (R16, §5.4). */
export const INVALID_FLAGS: readonly string[] = [FLAG_NO_AUDIO, FLAG_FLOOR, FLAG_YEASAYER, FLAG_CARELESS];
export const LEVELS = ['A1', 'A2', 'B1+'] as const;

const U64_MAX = (1n << 64n) - 1n;

/** Минимум хоста, который нужен состоянию (подмножество Host SDK). */
export interface StoreHost {
  storage: {
    get<T = unknown>(key: string): Promise<T | undefined>;
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<{ removed: number }>;
  };
  docs: {
    put(p: DocPutParams): Promise<{ rev: number }>;
    get<T = unknown>(p: DocRef): Promise<DocEntry<T> | undefined>;
    list<T = unknown>(p: { collection: string; after?: string; limit?: number }): Promise<DocListPage<T>>;
    delete(p: DocRef): Promise<{ removed: 0 | 1 }>;
  };
}

export interface Clock { now?: () => number }

export type StoreErrorCode = 'history_corrupt';

export class StoreError extends Error {
  constructor(readonly code: StoreErrorCode, message: string) {
    super(message);
    this.name = 'StoreError';
  }
}

/** Ответ для повтора: id, kind и lemma задания сверяются при восстановлении (иначе «Тест обновился»). */
export interface StoredAnswer { id: string; kind: Kind; lemma: string; r: Response }

export interface Session {
  v: 1;
  run_id: string;
  bank_version: string;
  engine_version: string;
  prior: string;
  /** uint64 десятичной строкой (П15): Number точен только до 2^53. */
  seed: string;
  answers: StoredAnswer[];
  started_at: string;
  updated_at: string;
  /** Финиш начат: итог и время. Есть — прогон довершается без повтора ответов. */
  finishing?: { outcome: RunOutcome; taken_at: string };
}

export type Level = typeof LEVELS[number];

export interface ResultsWord { lemma: string; p: number; rank: number; cefrj: number; s3?: 0 | 1 }

export interface ResultsDoc {
  run_id: string;
  bank_version: string;
  level: Level;
  flags: string[];
  taken_at: string;
  words: ResultsWord[];
}

/** Итог прогона для finishRun (собирает run.outcomeOf из Result движка и банка). */
export interface RunOutcome {
  level: Level;
  vocab_size: number;
  ci90: [number, number];
  listening_offset: number;
  flags: string[];
  words: ResultsWord[];
}

export interface HistoryRow {
  run_id: string;
  taken_at: string;
  bank_version: string;
  level: Level;
  vocab_size: number;
  ci90: [number, number];
  flags: string[];
  listening_offset: number;
  known_count: number;
  duration_sec: number;
  valid: boolean;
  /** true — принят; false — отвергнут («Нет» или закрыт новым); null — ждёт ответа R16. */
  accepted: boolean | null;
}

// ---------- очередь записей (одна на страницу) ----------

let queue: Promise<unknown> = Promise.resolve();

function serial<T>(fn: () => Promise<T>): Promise<T> {
  const p = queue.then(fn, fn);
  queue = p.catch(() => undefined);
  return p;
}

const nowOf = (c?: Clock) => (c?.now ?? Date.now)();
const iso = (ms: number) => new Date(ms).toISOString();
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === 'string';
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isLevel = (x: unknown): x is Level => (LEVELS as readonly unknown[]).includes(x);
const isStrArr = (x: unknown): x is string[] => Array.isArray(x) && x.every(isStr);
const isCi = (x: unknown): x is [number, number] => Array.isArray(x) && x.length === 2 && x.every(isNum);

export const isValidRun = (flags: readonly string[]) => !flags.some((f) => INVALID_FLAGS.includes(f));

function isWord(x: unknown): x is ResultsWord {
  return isObj(x) && isStr(x.lemma) && isNum(x.p) && isNum(x.rank) && isNum(x.cefrj)
    && (x.s3 === undefined || x.s3 === 0 || x.s3 === 1);
}

function isOutcome(x: unknown): x is RunOutcome {
  return isObj(x) && isLevel(x.level) && isNum(x.vocab_size) && isCi(x.ci90) && isNum(x.listening_offset)
    && isStrArr(x.flags) && Array.isArray(x.words) && x.words.every(isWord);
}

function isResultsDoc(x: unknown): x is ResultsDoc {
  return isObj(x) && isStr(x.run_id) && x.run_id !== '' && isStr(x.bank_version) && isLevel(x.level)
    && isStrArr(x.flags) && isStr(x.taken_at) && Array.isArray(x.words) && x.words.every(isWord);
}

// ---------- сессия ----------

function randomSeed(): bigint {
  return crypto.getRandomValues(new BigUint64Array(1))[0];
}

function randomRunId(now: number): string {
  const b = crypto.getRandomValues(new Uint8Array(8));
  return `pt-${now.toString(36)}-${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}`;
}

function parseSession(x: unknown): Session | null {
  if (!isObj(x) || x.v !== 1) return null;
  const { run_id, bank_version, engine_version, prior, seed, answers, started_at, updated_at, finishing } = x;
  if (!isStr(run_id) || run_id === '' || !isStr(bank_version) || !isStr(engine_version) || !isStr(prior)) return null;
  if (!isStr(seed) || !/^\d{1,20}$/.test(seed) || BigInt(seed) > U64_MAX) return null;
  if (!isStr(started_at) || !isStr(updated_at) || Number.isNaN(Date.parse(started_at)) || Number.isNaN(Date.parse(updated_at))) return null;
  if (!Array.isArray(answers)) return null;
  for (const a of answers) {
    if (!isObj(a) || !isStr(a.id) || !isStr(a.kind) || !isStr(a.lemma) || !isObj(a.r)) return null;
  }
  if (finishing !== undefined) {
    if (!isObj(finishing) || !isOutcome(finishing.outcome) || !isStr(finishing.taken_at) || Number.isNaN(Date.parse(finishing.taken_at))) return null;
  }
  return x as unknown as Session;
}

export interface StartParams extends Clock {
  prior: string;
  bankVersion: string;
  engineVersion?: string;
  seed?: bigint;
  runId?: string;
}

/**
 * Ответ на S0 («Начать», «Начать заново»): новая сессия в KV. Если в KV лежит недоделанный финиш
 * прежнего прогона — сначала он доводится (иначе замена сессии потеряла бы его итог).
 */
export function startRun(h: StoreHost, p: StartParams): Promise<Session> {
  return serial(async () => {
    const seed = p.seed ?? randomSeed();
    if (seed < 0n || seed > U64_MAX) throw new RangeError('placement: seed out of uint64');
    const prev = parseSession(await h.storage.get(KEY_SESSION));
    if (prev?.finishing) await finishInner(h, prev, prev.finishing.outcome, Date.parse(prev.finishing.taken_at), nowOf(p));
    const t = nowOf(p);
    const s: Session = {
      v: 1,
      run_id: p.runId ?? randomRunId(t),
      bank_version: p.bankVersion,
      engine_version: p.engineVersion ?? ENGINE_VERSION,
      prior: p.prior,
      seed: seed.toString(10),
      answers: [],
      started_at: iso(t),
      updated_at: iso(t),
    };
    await h.storage.set(KEY_SESSION, s);
    return s;
  });
}

/**
 * Каждый ответ — до показа следующего задания. s меняется только после успешной записи. Идемпотентен
 * по id задания: повтор (двойной вызов, повтор после таймаута RPC) не дублирует ответ.
 */
export function recordAnswer(h: StoreHost, s: Session, ans: StoredAnswer, c?: Clock): Promise<void> {
  return serial(async () => {
    if (s.answers.some((a) => a.id === ans.id)) return;
    const updated_at = iso(nowOf(c));
    await h.storage.set(KEY_SESSION, { ...s, answers: [...s.answers, ans], updated_at });
    s.answers.push(ans);
    s.updated_at = updated_at;
  });
}

export function dropSession(h: StoreHost): Promise<void> {
  return serial(async () => { await h.storage.delete(KEY_SESSION); });
}

export type OpenResult =
  | { kind: 'none' }
  | { kind: 'resume'; session: Session }
  | { kind: 'finished'; run_id: string; asked: boolean; outcome: RunOutcome }
  | { kind: 'reset'; reason: 'malformed' | 'bank_changed' | 'engine_changed' | 'expired' };

/**
 * При открытии шторки. Сначала ремонт: прогон уже в истории → сессия удаляется (none); финиш начат
 * (finishing) → доводится с исходным taken_at (finished) — при любом банке, движке и возрасте. Иначе —
 * можно ли продолжить; невозможно — сессия удаляется (reset).
 */
export function openSession(h: StoreHost, p: { bankVersion: string; engineVersion?: string } & Clock): Promise<OpenResult> {
  return serial(async (): Promise<OpenResult> => {
    const raw = await h.storage.get(KEY_SESSION);
    if (raw === undefined || raw === null) return { kind: 'none' };
    const s = parseSession(raw);
    if (!s) {
      await h.storage.delete(KEY_SESSION);
      return { kind: 'reset', reason: 'malformed' };
    }
    const hist = await readHistory(h);
    if (!hist.corrupt && rowsOf(hist.entries).some((r) => r.run_id === s.run_id)) {
      await h.storage.delete(KEY_SESSION);
      return { kind: 'none' };
    }
    if (s.finishing) {
      const { asked } = await finishInner(h, s, s.finishing.outcome, Date.parse(s.finishing.taken_at), nowOf(p));
      return { kind: 'finished', run_id: s.run_id, asked, outcome: s.finishing.outcome };
    }
    let reason: Extract<OpenResult, { kind: 'reset' }>['reason'] | null = null;
    if (s.bank_version !== p.bankVersion) reason = 'bank_changed';
    else if (s.engine_version !== (p.engineVersion ?? ENGINE_VERSION)) reason = 'engine_changed';
    else if (nowOf(p) - Date.parse(s.updated_at) > SESSION_TTL_MS) reason = 'expired';
    if (reason) {
      await h.storage.delete(KEY_SESSION);
      return { kind: 'reset', reason };
    }
    return { kind: 'resume', session: s };
  });
}

// ---------- история и документы ----------

/** Строка истории: разобранная или битая (битая не читается, но сохраняется при записи). */
type Entry = { row: HistoryRow } | { bad: unknown };
type History = { corrupt: true } | { corrupt: false; entries: Entry[] };

function parseRow(x: unknown): HistoryRow | null {
  if (!isObj(x)) return null;
  const ok = isStr(x.run_id) && isStr(x.taken_at) && isStr(x.bank_version) && isLevel(x.level) && isNum(x.vocab_size)
    && isCi(x.ci90) && isStrArr(x.flags) && isNum(x.listening_offset) && isNum(x.known_count) && isNum(x.duration_sec)
    && typeof x.valid === 'boolean' && (x.accepted === null || typeof x.accepted === 'boolean');
  return ok ? (x as unknown as HistoryRow) : null;
}

async function readHistory(h: StoreHost): Promise<History> {
  const raw = await h.storage.get(KEY_HISTORY);
  if (raw === undefined) return { corrupt: false, entries: [] };
  if (!Array.isArray(raw)) return { corrupt: true };
  return { corrupt: false, entries: raw.map((x): Entry => { const row = parseRow(x); return row ? { row } : { bad: x }; }) };
}

async function mustHistory(h: StoreHost): Promise<Entry[]> {
  const hist = await readHistory(h);
  if (hist.corrupt) throw new StoreError('history_corrupt', 'placement: pt.history is not an array — repairHistory first');
  return hist.entries;
}

const rowsOf = (es: Entry[]) => es.flatMap((e) => ('row' in e ? [e.row] : []));
const writeHistory = (h: StoreHost, es: Entry[]) => h.storage.set(KEY_HISTORY, es.map((e) => ('row' in e ? e.row : e.bad)));

async function readLast(h: StoreHost): Promise<ResultsDoc | undefined> {
  const e = await h.docs.get<ResultsDoc>({ collection: COL_RESULTS, id: ID_LAST });
  return e && isObj(e.body) && isStr(e.body.run_id) ? e.body : undefined;
}

/** Удаляет все pt_pending/* кроме keep (все страницы списка). */
async function dropPendingExcept(h: StoreHost, keep?: string): Promise<void> {
  const ids: string[] = [];
  let after: string | undefined;
  for (;;) {
    const page = await h.docs.list({ collection: COL_PENDING, ...(after !== undefined ? { after } : {}) });
    for (const it of page.items) ids.push(it.id);
    if (!page.next || page.items.length === 0) break;
    after = page.next;
  }
  for (const id of ids) if (id !== keep) await h.docs.delete({ collection: COL_PENDING, id });
}

/** «Старт» — первый валидный; пока валидных нет — первый принятый. «Сейчас» — строка run_id из pt_results/last. */
export function startAndNow(history: HistoryRow[], lastRunId: string | undefined): { start?: HistoryRow; now?: HistoryRow } {
  const start = history.find((r) => r.valid && r.accepted === true) ?? history.find((r) => r.accepted === true);
  const now = lastRunId === undefined ? undefined : history.find((r) => r.run_id === lastRunId);
  const out: { start?: HistoryRow; now?: HistoryRow } = {};
  if (start) out.start = start;
  if (now) out.now = now;
  return out;
}

/** Обрезка до HISTORY_CAP: удаляются самые старые разобранные строки, кроме «Старта», «Сейчас» и ожидающего. */
function capHistory(es: Entry[], lastRunId: string | undefined): Entry[] {
  const out = es.slice();
  while (out.length > HISTORY_CAP) {
    const { start, now } = startAndNow(rowsOf(out), lastRunId);
    const i = out.findIndex((e) => 'row' in e && e.row !== start && e.row !== now && e.row.accepted !== null);
    if (i < 0) break;
    out.splice(i, 1);
  }
  return out;
}

function rowOf(s: Session, res: RunOutcome, takenMs: number, accepted: boolean | null): HistoryRow {
  return {
    run_id: s.run_id,
    taken_at: iso(takenMs),
    bank_version: s.bank_version,
    level: res.level,
    vocab_size: res.vocab_size,
    ci90: [res.ci90[0], res.ci90[1]],
    flags: [...res.flags],
    listening_offset: res.listening_offset,
    known_count: res.words.length,
    duration_sec: Math.max(0, Math.round((takenMs - Date.parse(s.started_at)) / 1000)),
    valid: isValidRun(res.flags),
    accepted,
  };
}

/** Тело финиша вне очереди (зовут finishRun, openSession и startRun уже из очереди). */
async function finishInner(h: StoreHost, s: Session, res: RunOutcome, takenMs: number, nowMs: number): Promise<{ asked: boolean }> {
  let entries = await mustHistory(h);
  const done = rowsOf(entries).find((r) => r.run_id === s.run_id);
  if (done) {
    await h.storage.delete(KEY_SESSION);
    return { asked: done.accepted === null };
  }
  // Шаг 0: итог и время — в сессию, до docs. Уже записан (в т.ч. прошлым вызовом, чья запись легла,
  // а ответ потерялся) — берём записанный: ремонт сохраняет исходный taken_at.
  let fin = s.finishing;
  if (!fin) {
    const stored = parseSession(await h.storage.get(KEY_SESSION));
    fin = stored?.run_id === s.run_id ? stored.finishing : undefined;
  }
  if (!fin) {
    fin = { outcome: res, taken_at: iso(takenMs) };
    await h.storage.set(KEY_SESSION, { ...s, finishing: fin });
  }
  s.finishing = fin;
  const out = fin.outcome;
  const taken = Date.parse(fin.taken_at);

  const valid = isValidRun(out.flags);
  const prev = await readLast(h);
  // Старее принятого результата, который не из будущего (prev.taken_at ≤ now + 5 мин; now — часы вызова финиша или ремонта, не taken_at).
  const prevMs = prev ? Date.parse(prev.taken_at) : NaN;
  const stale = !!prev && prev.run_id !== s.run_id && prevMs > taken && prevMs <= nowMs + 5 * 60_000;
  let accepted: boolean | null;
  if (prev?.run_id === s.run_id) {
    accepted = true; // сбой после docs.put(last): документ уже на месте
  } else if (stale) {
    accepted = false; // Сайт (две вкладки/устройства): прогон старее принятого — только строка истории
  } else if (await h.docs.get({ collection: COL_PENDING, id: s.run_id })) {
    accepted = null; // сбой после docs.put(pending)
  } else {
    accepted = valid || !prev ? true : null;
  }
  if (stale) {
    // Устаревший прогон трогает только свои следы: чужие вопросы и строки истории остаются.
    await h.docs.delete({ collection: COL_PENDING, id: s.run_id });
    entries.push({ row: rowOf(s, out, taken, false) });
    await writeHistory(h, capHistory(entries, prev!.run_id));
    await h.storage.delete(KEY_SESSION);
    return { asked: false };
  }
  // Ожидающий — не больше одного: прежние закрываются при любом финише.
  await dropPendingExcept(h, accepted === null ? s.run_id : undefined);
  const doc: ResultsDoc = {
    run_id: s.run_id, bank_version: s.bank_version, level: out.level, flags: [...out.flags],
    taken_at: fin.taken_at, words: out.words.map((w) => ({ ...w })),
  };
  if (accepted === true && prev?.run_id !== s.run_id) {
    await h.docs.put({ collection: COL_RESULTS, id: ID_LAST, body: doc });
  } else if (accepted === null) {
    await h.docs.put({ collection: COL_PENDING, id: s.run_id, body: doc });
  }
  entries = entries.map((e) => ('row' in e && e.row.accepted === null ? { row: { ...e.row, accepted: false } } : e));
  entries.push({ row: rowOf(s, out, taken, accepted) });
  const lastRunId = accepted === true ? s.run_id : prev?.run_id;
  await writeHistory(h, capHistory(entries, lastRunId));
  await h.storage.delete(KEY_SESSION);
  return { asked: accepted === null };
}

/**
 * Финиш прогона (R16): валидный → pt_results/last без вопроса; невалидный при прошлом результате →
 * pt_pending/<run_id> и вопрос (asked:true); невалидный без прошлого → last, принят неявно.
 * Повторный вызов той же сессии после сбоя доводит недоделанные шаги, не дублируя их.
 */
export function finishRun(h: StoreHost, s: Session, res: RunOutcome, c?: Clock): Promise<{ asked: boolean }> {
  return serial(() => finishInner(h, s, res, nowOf(c), nowOf(c)));
}

/**
 * Ответ на «Заменить прошлый результат теста?»: «Да» переносит pt_pending/<run_id> в pt_results/last,
 * «Нет» удаляет документ. pt_results/last уже этот прогон (прошлое «Да» легло до истории) — принят при
 * любом ответе. Документа нет или он битый («Удалить и данные», П5) — вопрос закрывается accepted:false,
 * pt_results/last не трогается. Ответ на решённый или неизвестный прогон ничего не меняет.
 */
export function answerReplace(h: StoreHost, runId: string, yes: boolean): Promise<void> {
  return serial(async () => {
    const entries = await mustHistory(h);
    const i = entries.findIndex((e) => 'row' in e && e.row.run_id === runId);
    if (i < 0) return;
    const row = (entries[i] as { row: HistoryRow }).row;
    if (row.accepted !== null) return;
    let accepted = false;
    if ((await readLast(h))?.run_id === runId) {
      accepted = true;
    } else if (yes) {
      const pend = await h.docs.get<unknown>({ collection: COL_PENDING, id: runId });
      if (pend && isResultsDoc(pend.body) && pend.body.run_id === runId) {
        await h.docs.put({ collection: COL_RESULTS, id: ID_LAST, body: pend.body });
        accepted = true;
      }
    }
    await h.docs.delete({ collection: COL_PENDING, id: runId });
    const next = entries.slice();
    next[i] = { row: { ...row, accepted } };
    await writeHistory(h, next);
  });
}

/** Явный ремонт битого pt.history: значение уходит в pt.history.corrupt, история начинается пустой. */
export function repairHistory(h: StoreHost): Promise<void> {
  return serial(async () => {
    const raw = await h.storage.get(KEY_HISTORY);
    if (raw === undefined || Array.isArray(raw)) return;
    await h.storage.set(KEY_HISTORY_CORRUPT, raw);
    await h.storage.set(KEY_HISTORY, []);
  });
}

export interface Overview {
  history: HistoryRow[];
  /** pt.history не массив: показываем пусто и предлагаем repairHistory; запись истории отказывает. */
  historyCorrupt?: true;
  lastRunId?: string;
  start?: HistoryRow;
  now?: HistoryRow;
  /** Прогон, ждущий ответа R16 (последний с accepted:null). */
  question?: HistoryRow;
}

/** Для экрана: история, «Старт / Сейчас», ожидающий вопрос. Только чтение. */
export function loadOverview(h: StoreHost): Promise<Overview> {
  return serial(async () => {
    const hist = await readHistory(h);
    const history = hist.corrupt ? [] : rowsOf(hist.entries);
    const lastRunId = (await readLast(h))?.run_id;
    const q = [...history].reverse().find((r) => r.accepted === null);
    const ov: Overview = { history, ...startAndNow(history, lastRunId) };
    if (hist.corrupt) ov.historyCorrupt = true;
    if (lastRunId !== undefined) ov.lastRunId = lastRunId;
    if (q) ov.question = q;
    return ov;
  });
}

// ---------- вкладка UI ----------

export const KEY_PROVIDER_UI = 'pt.provider-ui';
export type Tab = 'test' | 'history';

/** Последняя вкладка шторки; нет записи или мусор — «Тест». */
export function loadLastTab(h: StoreHost): Promise<Tab> {
  return serial(async () => {
    const v = await h.storage.get(KEY_PROVIDER_UI);
    return isObj(v) && v.last_tab === 'history' ? 'history' : 'test';
  });
}

export function saveLastTab(h: StoreHost, tab: Tab): Promise<void> {
  return serial(async () => { await h.storage.set(KEY_PROVIDER_UI, { last_tab: tab }); });
}
