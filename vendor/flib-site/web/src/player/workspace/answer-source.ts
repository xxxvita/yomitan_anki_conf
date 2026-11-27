// answer-source.ts — Answer-seam contract (T-ANS, decision D3, audit/25).
//
// The single abstraction the coordinator (useShadowLoopCoordinator.ts)
// consumes to learn the user's answer by the end of A-B: `AnswerSource`.
// Full contract + taxonomy: docs/superpowers/specs/
// 2026-07-06-shadowing-answer-seam-contract.md. This replaces the "hard
// dependency on real Ф2 streaming" from earlier drafts — the coordinator is
// transport-agnostic and is built/tested against `FakeAnswerSource` here;
// the real WS-streaming Ф2 implementation lands on this SAME seam later
// (separate task) without the coordinator changing.
//
// Where this plugs in: useShadowLoopCoordinator's `finalizeLoop` slot
// (startEval, the `if (a.finalizeLoop) { ... }` branch) is the "generalized
// finalizeLoop" the contract describes — a promise-final-with-timeout. This
// file does NOT touch that coordinator branch's logic; `useShadowRuntime.ts`
// wires `finalizeLoopFromAnswerSource(...)` into `UseShadowLoopCoordinatorArgs
// .finalizeLoop` from the outside, exactly like any other optional prop.

import type { WordMark } from './word-matcher';

/**
 * Единственное, что координатор ждёt к концу A-B (contract §Интерфейс).
 * `final` — есть финальный распознанный текст. Остальные 4 — таксономия
 * "ответа нет" (contract §Таксономия ошибок); все они трактуются
 * координатором как «порог не достигнут» (verdictHold-инвариант: НИ один
 * исход не оставляет луп без показанного результата — сам показ
 * («нет ответа» / серые glyphs) это T3 (hold-render) / T7 (нотация),
 * не эта абстракция).
 */
export type AnswerOutcome =
  | { status: 'final'; text: string; marks?: WordMark[] }
  | { status: 'no-response'; reason: 'no-connection' | 'no-audio' }
  | { status: 'error'; reason: string }
  | { status: 'non-final'; partial: string }
  | { status: 'timeout'; partial?: string };

export interface AnswerSource {
  /**
   * Координатор зовёт в момент reachBoundary (в слоте finalizeLoop внутри
   * startEval). НЕ бросает — всегда резолвится в AnswerOutcome, никогда не
   * зависает дольше budgetMs. budgetMs — сколько ждать финал ПОСЛЕ конца
   * A-B (не от старта записи).
   *
   * FIX F4 [важное]: `signal` — контракт РАСШИРЕН (T-ANS-fix). Адаптер
   * (`finalizeLoopFromAnswerSource` ниже) больше не доверяет источнику
   * «сам уложится в budgetMs» — он enforce'ит бюджет СВОИМ таймером и
   * абортит источник через этот `signal`, когда таймер выигрывает гонку
   * ИЛИ когда координаторский `finalizeLoop`-сигнал абортится раньше
   * (eval-timeout/unmount). Реальный Ф2-источник ОБЯЗАН слушать `signal`
   * и прекращать работу по аборту (закрыть WS-подписку и т.п.) — адаптер
   * больше НЕ ждёт его резолва после аборта, но висящий источник без
   * cleanup — утечка на его стороне, не контрактное нарушение адаптера.
   */
  awaitAnswerByBoundary(
    exerciseId: string,
    budgetMs: number,
    signal?: AbortSignal,
  ): Promise<AnswerOutcome>;
}

/**
 * budgetMs фикс = 3000ms — решение владельца (audit/25 D3), сознательно НЕ
 * привязано к pauseAtEnd (открытый вопрос контракта закрыт явным фиксом, а
 * не выведен из настроек упражнения). Дефолт-параметр — вызывающий код
 * может передать другое значение явно, но ничего в этом файле не выводит
 * budgetMs из ShadowState/pauseAtEnd.
 */
export const DEFAULT_ANSWER_BUDGET_MS = 3000;

export interface FakeAnswerSourceOptions {
  /** Канонический текст, отдаваемый по умолчанию (status:'final'),
   *  детерминированно — для сборки/тестов координатора без сети. */
  canonicalText?: string;
  canonicalMarks?: WordMark[];
}

/**
 * FakeAnswerSource — первая (единственная на срезе-2) реализация
 * AnswerSource. По умолчанию — детерминированный канонический `final`
 * (contract: "заглушка... возвращает {status:'final', text: канонический
 * ответ}, детерминированно, для сборки и тестов координатора без сети").
 *
 * Тест форсит ЛЮБОЙ из 5 исходов через `setForced`/`forceOnce`, чтобы
 * прогнать все ветки матрицы loop×автопереход (audit/18) и hold-инвариант.
 *
 * Таймаут-семантика: форс `{status:'timeout', ...}` реально ждёт budgetMs
 * (через setTimeout, а не резолвится мгновенно) — так тест на fake-timers
 * может убедиться, что ничего не резолвится на budgetMs-1мс и резолвится
 * РОВНО на budgetMs (contract §Таймаут-бюджет: "по истечении бюджета →
 * timeout, ожидание закрывается"). Остальные 4 исхода — форс без сети,
 * резолвятся немедленно (детерминированно, никакой сетевой задержки не
 * симулируют — это не их контракт).
 *
 * FIX F4 test rig: `hang(ms)` симулирует источник, который НЕ укладывается
 * сам в budgetMs (реальный баг/медленная сеть) — висит `ms` независимо от
 * budgetMs. Используется, чтобы доказать, что ЭТО адаптер
 * (`finalizeLoopFromAnswerSource`), а не сам источник, гарантирует 3000ms
 * потолок. Уважает `signal`: аборт останавливает hang раньше и пишет в
 * `abortedCalls` — так тест видит, что источник реально попросили
 * остановиться, а не просто «забыли» про него.
 */
export class FakeAnswerSource implements AnswerSource {
  private readonly canonicalText: string;
  private readonly canonicalMarks?: WordMark[];

  /** Персистентный форс — действует на КАЖДЫЙ вызов, пока не сброшен
   *  clearForce()/setForced(null). */
  private forced: AnswerOutcome | null = null;
  /** Одноразовый форс — потребляется ПЕРВЫМ же вызовом, затем откатывается
   *  к forced/дефолту. */
  private forcedOnce: AnswerOutcome | null = null;
  /** FIX F4 test rig — см. class-doc выше. `null` = не висим (обычное
   *  поведение, ничего не меняется). */
  private hangMs: number | null = null;

  /** Трасса вызовов (exerciseId+budgetMs на каждый awaitAnswerByBoundary) —
   *  тестам удобно проверять "позвали ровно раз, с этим id/бюджетом". */
  readonly calls: { exerciseId: string; budgetMs: number }[] = [];
  /** FIX F4 test rig — exerciseId каждого вызова, чей `signal` реально
   *  сработал (abort) во время hang. Пусто, если `hang()` не настроен или
   *  вызывающий никогда не абортит. */
  readonly abortedCalls: string[] = [];

  constructor(opts: FakeAnswerSourceOptions = {}) {
    this.canonicalText = opts.canonicalText ?? 'the quick brown fox';
    this.canonicalMarks = opts.canonicalMarks;
  }

  /** Форсит СЛЕДУЮЩИЙ (и только следующий) вызов. */
  forceOnce(outcome: AnswerOutcome): void {
    this.forcedOnce = outcome;
  }

  /** Форсит ВСЕ последующие вызовы, пока не вызван clearForce()/setForced(null). */
  setForced(outcome: AnswerOutcome | null): void {
    this.forced = outcome;
  }

  clearForce(): void {
    this.forced = null;
    this.forcedOnce = null;
  }

  /** FIX F4 test rig — see class-doc above. */
  hang(ms: number): void {
    this.hangMs = ms;
  }

  clearHang(): void {
    this.hangMs = null;
  }

  async awaitAnswerByBoundary(
    exerciseId: string,
    budgetMs: number,
    signal?: AbortSignal,
  ): Promise<AnswerOutcome> {
    this.calls.push({ exerciseId, budgetMs });

    let outcome: AnswerOutcome;
    if (this.forcedOnce) {
      outcome = this.forcedOnce;
      this.forcedOnce = null;
    } else if (this.forced) {
      outcome = this.forced;
    } else {
      outcome = { status: 'final', text: this.canonicalText, marks: this.canonicalMarks };
    }

    // FIX F4 test rig: hangs `hangMs` regardless of budgetMs — proves the
    // ADAPTER enforces the wall, not this fake self-limiting. Honours abort:
    // stops early and records it, exactly what a well-behaved real source
    // should do once given `signal`.
    if (this.hangMs != null) {
      const hangMs = this.hangMs;
      await new Promise<void>(resolve => {
        const t = setTimeout(resolve, hangMs);
        signal?.addEventListener('abort', () => {
          clearTimeout(t);
          this.abortedCalls.push(exerciseId);
          resolve();
        }, { once: true });
      });
      return outcome;
    }

    if (outcome.status === 'timeout') {
      // Бюджет реально исчерпывается — см. class-doc выше.
      await new Promise<void>(resolve => setTimeout(resolve, budgetMs));
    }
    return outcome;
  }
}

/**
 * FIX F3 [PLAUSIBLE] — payload of the `onOutcome` channel. Wraps the raw
 * `AnswerOutcome` with `exerciseId` (the id this call's outcome belongs to)
 * so a future T3/T7 consumer can identify/filter for itself, independent of
 * whatever internal loop-seq/epoch bookkeeping the coordinator keeps (NOT
 * plumbed here — coordinator-internal, and this task does not touch
 * coordinator logic).
 */
export interface AnswerOutcomeEvent {
  exerciseId: string;
  outcome: AnswerOutcome;
}

export interface AnswerSourceFinalizeLoopOptions {
  /** WEB-SEAM: outcome render → T3/T7. Получает ПОЛНЫЙ AnswerOutcome
   *  (включая no-response.reason / error.reason / non-final.partial /
   *  timeout.partial) — координаторский `finalizeLoop` возвращает только
   *  `string | null`, так что вся таксономия-детализация не-final исходов
   *  теряется на выходе адаптера для координатора (он трактует любой
   *  non-final ОДИНАКОВО — "порог не достигнут", contract §Таксономия).
   *  Единственное место, где деталь ещё жива — здесь. T3 (hold-render) и
   *  T7 (нотация: партиалы серым / диагноз «нет ответа») читают её отсюда
   *  ПОЗЖЕ; эта опция сейчас — только помеченная точка подключения, без
   *  реализации показа (не наша зона по T-ANS брифу).
   *
   *  FIX F3: fires ONLY when `signal` is still un-aborted at resolution
   *  time (a stale outcome that lands after the coordinator has already
   *  moved on must not reach T3/T7), and payload now carries `exerciseId`
   *  (see `AnswerOutcomeEvent`). */
  onOutcome?: (event: AnswerOutcomeEvent) => void;
}

/**
 * Адаптер AnswerSource → координаторский слот `finalizeLoop`
 * (`(signal: AbortSignal) => Promise<string | null>`, useShadowLoopCoordinator
 * .ts startEval). Семантически awaitAnswerByBoundary = generalized
 * finalizeLoop (contract §Интерфейс) — этот адаптер лишь СПЛЮЩИВАЕТ
 * 5-исходную AnswerOutcome в 2-исходный string|null, потому что это ровно
 * то, что координаторская логика УЖЕ понимает без изменений:
 *   - final       → text (координатор скорит по нему как обычно)
 *   - остальные 4 → null (координатор трактует null как "eval не дал
 *     результата" — reduceLoopOutcome(score:null) → action:'restart' →
 *     armedLoopingRef ? 'restart'-событие (ON+ON: ещё цикл) : 'hold'-событие
 *     (OFF+ON: стоять-ждать) — ИМЕННО матрица contract §Матрица, БЕЗ единой
 *     строки правки координаторской логики).
 *
 * `getExerciseId` читается ЛЕНИВО (на момент вызова, не на момент
 * построения адаптера) — у finalizeLoop нет параметра exerciseId в своей
 * сигнатуре (координатор его не передаёт), поэтому вызывающий
 * (useShadowRuntime) обязан дать геттер, отражающий ТЕКУЩЕЕ армед-
 * упражнение на момент вызова.
 */
export function finalizeLoopFromAnswerSource(
  source: AnswerSource,
  getExerciseId: () => string,
  budgetMs: number = DEFAULT_ANSWER_BUDGET_MS,
  opts: AnswerSourceFinalizeLoopOptions = {},
): (signal: AbortSignal) => Promise<string | null> {
  return async (signal: AbortSignal): Promise<string | null> => {
    if (signal.aborted) return null;

    const exerciseId = getExerciseId();

    // FIX F4 [важное]: enforce budgetMs BY CONSTRUCTION, not by trusting the
    // source to self-limit. Before this fix the adapter awaited the source
    // directly — a real hung source would only ever be bounded by the
    // COORDINATOR's own eval-timeout (evalTimeoutMs, default 10s, see
    // useShadowLoopCoordinator.ts DEFAULT_EVAL_TIMEOUT_MS), not the
    // owner-fixed 3000ms answer budget (audit/25 D3). `sourceCtrl` is a
    // SEPARATE AbortSignal handed to the source (not the caller's `signal`
    // itself) so the source is aborted the instant EITHER (a) our own
    // budgetMs timer wins the race, OR (b) the caller's `signal` aborts
    // first (coordinator eval-timeout / unmount) — the source is always
    // told to stop, never left running un-observed.
    const sourceCtrl = new AbortController();
    const onOuterAbort = () => sourceCtrl.abort();
    signal.addEventListener('abort', onOuterAbort, { once: true });

    let budgetTimer: ReturnType<typeof setTimeout> | null = null;
    const budgetTimeout = new Promise<AnswerOutcome>((resolve) => {
      budgetTimer = setTimeout(() => {
        sourceCtrl.abort();
        resolve({ status: 'timeout' });
      }, budgetMs);
    });

    let outcome: AnswerOutcome;
    try {
      outcome = await Promise.race([
        source.awaitAnswerByBoundary(exerciseId, budgetMs, sourceCtrl.signal),
        budgetTimeout,
      ]);
    } finally {
      // Whichever side won, clean up the other: clear our own timer so it
      // never fires past this call (no leak when the SOURCE resolves
      // first), and stop listening for an outer abort this invocation is
      // already done reacting to either way.
      if (budgetTimer != null) clearTimeout(budgetTimer);
      signal.removeEventListener('abort', onOuterAbort);
    }

    // FIX F2 [CONFIRMED]: error (and, per contract, no-response too) must
    // never collapse to null silently — contract §Таксономия: "error ...
    // НЕ молча". Diagnostic only, independent of the onOutcome/T3-T7 gate
    // below.
    if (outcome.status === 'error') {
      console.warn(`[shadow answer-seam] error: ${outcome.reason}`);
    } else if (outcome.status === 'no-response') {
      console.warn(`[shadow answer-seam] no-response: ${outcome.reason}`);
    }

    // FIX F3 [PLAUSIBLE]: gate BEFORE firing onOutcome — if the coordinator
    // already moved on (its own eval-timeout/unmount aborted `signal` while
    // we were racing), this outcome is stale and must not reach T3/T7 as if
    // it were live for the CURRENT eval.
    if (signal.aborted) return null;
    // WEB-SEAM: outcome render → T3/T7 — see AnswerSourceFinalizeLoopOptions
    // .onOutcome doc above. Fired for ALL 5 statuses (final included) so a
    // future consumer never has to special-case "final" out of the channel.
    // Carries `exerciseId` (FIX F3) so a future T3/T7 can identify/filter
    // for itself even without a loop-seq/epoch (not available at this seam).
    opts.onOutcome?.({ exerciseId, outcome });
    if (outcome.status === 'final') return outcome.text;
    return null;
  };
}
