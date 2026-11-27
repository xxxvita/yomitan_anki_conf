// Прогон теста поверх движка и состояния (G4a Task 4a.3; спека §5.4, §10 п.1, п.10). Сессия движка
// детерминирована от (банк, параметры, prior, seed): восстановление — повтор сохранённых ответов на
// BigInt(seed). Каждое повторяемое задание сверяется по id, kind и lemma; расхождение (сменился
// движок/банк, подменён ответ) — PlacementError('item_mismatch') → «Тест обновился, начните заново».
// Финиш обязателен и живёт здесь, не в UI: последний ответ (applyAnswer) и повтор, после которого
// движок уже закончил (resumeOrReset/openRun), сами зовут finishRun.
import type { Bank } from './engine/bank';
import { defaultParams, type Params } from './engine/params';
import { ENGINE_VERSION, newSession, PlacementError, type Item, type Response, type Session as Engine } from './engine/session';
import {
  dropSession, finishRun, openSession, recordAnswer,
  type Clock, type OpenResult, type RunOutcome, type ResultsWord, type Session, type StoreHost,
} from './store';

const mismatch = (why: string) => new PlacementError('item_mismatch', `placement: resume failed (${why})`);

/** Движок на позиции после всех ответов сессии (новая сессия — на первом задании). Чистая функция. */
export function resumeRun(bank: Bank, session: Session, p: Params = defaultParams()): Engine {
  if (session.engine_version !== ENGINE_VERSION) throw mismatch('engine_version');
  if (session.bank_version !== bank.version) throw mismatch('bank_version');
  const eng = newSession(bank, p, session.prior, BigInt(session.seed));
  session.answers.forEach((a, i) => {
    const it = eng.next();
    if (!it || it.id !== a.id || it.kind !== a.kind || it.lemma !== a.lemma) throw mismatch(`answer ${i}`);
    eng.answer(it, a.r);
  });
  return eng;
}

export type Finished = { kind: 'finished'; run_id: string; asked: boolean; outcome: RunOutcome };

/** Итог шага: stale — ответ не на текущее задание (ничего не записано); next — следующее задание; finished — прогон записан. */
export type StepResult = { kind: 'stale' } | { kind: 'next'; item: Item } | Finished;

async function afterStep(h: StoreHost, session: Session, eng: Engine, c?: Clock): Promise<{ kind: 'next'; item: Item } | Finished> {
  const item = eng.next();
  if (item) return { kind: 'next', item };
  const outcome = outcomeOf(eng);
  const { asked } = await finishRun(h, session, outcome, c);
  return { kind: 'finished', run_id: session.run_id, asked, outcome };
}

export type ResumeResult = { kind: 'resumed'; engine: Engine; item: Item } | Finished | { kind: 'reset'; reason: 'updated' };

/**
 * resumeRun; при item_mismatch — сессия удаляется («Тест обновился, начните заново»). Движок уже закончил
 * (все ответы были, финиш не начался) — финиширует сам.
 */
export async function resumeOrReset(h: StoreHost, bank: Bank, session: Session, p?: Params, c?: Clock): Promise<ResumeResult> {
  let engine: Engine;
  try {
    engine = resumeRun(bank, session, p);
  } catch (e) {
    if (!(e instanceof PlacementError) || e.code !== 'item_mismatch') throw e;
    await dropSession(h);
    return { kind: 'reset', reason: 'updated' };
  }
  const st = await afterStep(h, session, engine, c);
  return st.kind === 'next' ? { kind: 'resumed', engine, item: st.item } : st;
}

export type OpenRunResult =
  | { kind: 'none' }
  | { kind: 'resumed'; session: Session; engine: Engine; item: Item }
  | Finished
  | { kind: 'reset'; reason: Extract<OpenResult, { kind: 'reset' }>['reason'] | 'updated' };

/** Открытие шторки: ремонт недоделанного финиша, восстановление прогона или причина сброса. */
export async function openRun(h: StoreHost, bank: Bank, opts: { params?: Params } & Clock = {}): Promise<OpenRunResult> {
  const o = await openSession(h, { bankVersion: bank.version, engineVersion: ENGINE_VERSION, ...(opts.now ? { now: opts.now } : {}) });
  if (o.kind !== 'resume') return o;
  const r = await resumeOrReset(h, bank, o.session, opts.params, opts);
  return r.kind === 'resumed' ? { kind: 'resumed', session: o.session, engine: r.engine, item: r.item } : r;
}

/**
 * Ответ на задание it. Не текущее задание движка (двойной клик, устаревший вызов) — stale, KV не пишется.
 * Иначе: сначала в KV (до показа следующего задания), потом в движок; сбой записи — движок не сдвигается,
 * повтор безопасен (recordAnswer идемпотентен по id). Последний ответ — финиш.
 */
export async function applyAnswer(h: StoreHost, session: Session, eng: Engine, it: Item, r: Response, c?: Clock): Promise<StepResult> {
  const cur = eng.next();
  if (!cur || cur.id !== it.id || cur.kind !== it.kind || cur.lemma !== it.lemma) return { kind: 'stale' };
  await recordAnswer(h, session, { id: cur.id, kind: cur.kind, lemma: cur.lemma, r: { ...r } }, c);
  eng.answer(cur, r);
  return afterStep(h, session, eng, c);
}

/** Итог для finishRun: Result движка + cefrj слова из банка и s3 (1/0 — ответ в S3, нет — слово в S3 не было). */
export function outcomeOf(eng: Engine): RunOutcome {
  const res = eng.result();
  const index = new Map<string, number>();
  eng.b.words.forEach((w, i) => index.set(w.lemma, i));
  const words: ResultsWord[] = res.words.map((w) => {
    const i = index.get(w.lemma);
    const out: ResultsWord = { lemma: w.lemma, p: w.p, rank: w.rank, cefrj: i === undefined ? 0 : eng.b.words[i].cefrj };
    const s3 = i === undefined ? undefined : eng.s3Result.get(i);
    if (s3 !== undefined) out.s3 = s3 ? 1 : 0;
    return out;
  });
  return { level: res.level, vocab_size: res.vocab_size, ci90: [res.ci90[0], res.ci90[1]], listening_offset: res.listening_offset, flags: [...res.flags], words };
}
