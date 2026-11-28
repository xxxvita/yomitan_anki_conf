// useShadowLoopCoordinator.ts — ЕДИНЫЙ ХОЗЯИН рантайма Shadowing-петли (task #1068, фаза G).
//
// Доделывает общий механизм Shadowing (P3b/c): упражнение = ОТРЕЗОК; при активации
// (useShadowAutoStart.onArm) workspace армится AB-петлёй по отрезку согласно настройкам
// (loopMode/pauseAtEnd); на границе петли — оценка (STT+LLM), которая ГЕЙТИТ рестарт:
// pass≥порога → advance (снять петлю, идти вперёд), иначе → restart (повторить).
//
// Дизайн (исполнять буквально): docs/superpowers/designs/2026-06-18-shadow-loop-runtime-handoff.md (★ v2).
// Чистые кирпичи готовы и оттестированы: exerciseWorkspaceParams (отрезок→params),
// reduceLoopOutcome (вердикт→advance/restart+waitMs), effectiveShadowSettings (резолв настроек).
// Хук — ТОНКАЯ оркестровка поверх них + [SHADOW-RT] лог-таксономия для трассировки.
//
// Ключевые инварианты (из ревью v2):
//   • grading-ness читается СИНХРОННО через ref (armedGradingRef) — currentTime у
//     loop-эффекта это React-state, обычный проп протух бы на тике границы (#3).
//   • НЕТ seek(A) между eval-start и resumeFromBoundary (advance без фантом-seek, #1/FM2).
//   • eval ВСЕГДА завершается resumeFromBoundary (вердикт/таймаут/ошибка → restart, #2/FM7);
//     AbortController-таймаут не даёт зависнуть.
//   • target оценки = по armedSegment (НЕ activeCueIndex на границе, #5b/FM3); ref-снимок.
//   • snapshot плеера на ПЕРВЫЙ arm прогона; restore когда впереди нет упражнения (#-restore).
//
// Speak (S2) наслаивается сверху через onOutcome (per-segment review) + onComplete
// (последний отрезок). Сам координатор — общий, не speak-gated.

import { useCallback, useEffect, useRef } from 'react';
// WEB-SEAM: import-path reprice only (T2 §3.1) — desktop's '../types' and
// '../utils/*' map onto T1's type-merged panel-types.ts and the T1 cp'd pure
// utils living in workspace/. '../components/AwaitingEvaluationOverlay' is
// UNCHANGED — web's components/ sits next to hooks/ exactly like desktop's,
// so the relative path already resolves (T-A already placed the file there).
import type { ShadowExerciseAnnotation, ShadowState } from '../workspace/panel-types';
import { exerciseWorkspaceParams } from '../workspace/exercise-workspace';
import { reduceLoopOutcome } from '../workspace/loop-outcome';
import { effectiveShadowSettings } from '../workspace/shadow-settings';
import { scoringProviderForCheck } from '../workspace/scoring-provider';
import type { EvaluationDecision } from '../components/AwaitingEvaluationOverlay';

/** Снимок workspace, достаточный для restoreWorkspace (плеер до прогона). */
export interface WorkspaceSnapshot {
  rangeStart: number;
  rangeEnd: number;
  viewStart: number;
  viewEnd: number;
  looping: boolean;
  pauseAtEnd: number;
  active: boolean;
}

/** Запрос оценки в координаторе (target по armedSegment, не дрейфующее замыкание). */
export interface EvaluateRequest {
  exerciseId: string;
  answer: string;
  target: string;
  // Ф3a (task #1068): снимок настроек скоринга на СТАРТЕ eval (edge #9 — смена
  // в popover в полёте применится со следующего цикла). Опциональны: обычный
  // Shadowing / legacy упражнения их не несут → сервер идёт стандартным путём.
  scoringProvider?: string;        // 'ollama' обрабатывает Ф3a; 'turmalin' — Ф3b
  useProviderForScoring?: boolean; // флаг-гейт LLM-скоринга (НЕ engines.check)
  promptText?: string;             // приоритетнее promptFile
  promptFile?: string;
}

/** Инъектируемая оценка: реальная — fetch /shadowing/finalize-attempt; тест — фейк. */
// WEB-SEAM: answer-seam (T-ANS) — later. This slice (T2) does not build a real
// fetch-based CoordinatorEvaluate for web; the caller (composition layer /
// smoke-gate task) injects a fake here. No production endpoint is called.
export type CoordinatorEvaluate = (
  req: EvaluateRequest,
  signal: AbortSignal,
) => Promise<EvaluationDecision>;

/** Событие [SHADOW-RT] — достаточно для трассировки начал/окончаний всех процессов. */
export interface ShadowRtEvent {
  event:
    | 'arm'
    | 'loop-boundary'
    | 'eval-start'
    | 'eval-end'
    | 'outcome'
    | 'wait'
    | 'advance'
    | 'restart'
    | 'hold'
    | 'deactivate'
    | 'restore'
    | 'complete';
  exId?: string | null;
  t?: number;
  [k: string]: unknown;
}

export interface UseShadowLoopCoordinatorArgs {
  /**
   * Реактивный currentTime — нужен ТОЛЬКО для G5-эффекта (сторож конца отрезка
   * непетлевого grading-упражнения). Боевые синхронные чтения идут через
   * getCurrentTime() (ref), чтобы не ловить протухший проп на тике границы.
   */
  currentTime: number;
  // ── синхронные читатели (рефы/геттеры — НЕ протухают на тике границы) ──
  getCurrentTime: () => number;
  getExercises: () => ShadowExerciseAnnotation[];
  getShadowState: () => ShadowState;
  getWorkspaceSnapshot: () => WorkspaceSnapshot;

  // ── актуаторы workspace (из useWorkspace) ──
  restoreWorkspace: (p: {
    rangeStart: number;
    rangeEnd: number;
    viewStart: number;
    viewEnd: number;
    looping: boolean;
    pauseAtEnd?: number;
    trustExtent?: boolean;
  }) => void;
  resumeFromBoundary: (action: 'advance' | 'restart') => void;
  /** Закрыть workspace в нейтраль (когда прогон стартовал с неактивного плеера). */
  deactivateWorkspace: () => void;
  seek: (t: number) => void;
  /** Отсчёт 3·2·1 затем play — перед ПЕРВЫМ циклом упражнения. pauseAtEnd передаём
   *  ЯВНО (на arm ws.pauseAtEnd ещё стейл — restoreWorkspace async). */
  countdownThenPlay: (pauseAtEndSec?: number) => void;
  /** Заморозить видео на конце отрезка (G5: непетлевой grading — useWorkspace НЕ паузит). */
  pauseVideo: () => void;

  // ── архив попытки (из useShadow) — свежая попытка синхронно или null ──
  // WEB-SEAM: answer-seam (T-ANS) — later. Desktop sources this from useShadow
  // (NOT lifted in T2 — coordinator/autostart/annotations don't import it, see
  // task-T2-report.md). Web callers in this slice supply `() => null` (no
  // attempt text captured yet); `runEval` then scores '(empty)' against the
  // injected `evaluate` fake.
  archiveShadowLoop: (opts?: { deferScore?: boolean }) => { text: string; matchPct: number } | null;

  // ── оценка ──
  // WEB-SEAM: answer-seam (T-ANS) — later. `evaluate` is the injection point;
  // slice-1 wiring (T2) supplies no real implementation, only the seam.
  evaluate: CoordinatorEvaluate;
  evalTimeoutMs?: number;
  /**
   * Ф2 (task #1068): force-flush на границе петли. Возвращает АВТОРИТЕТНЫЙ текст
   * всей петли (HP FinalizeLoop цельным батчем / EL committed) или null при
   * timeout/ошибке/тишине. Координатор скорит ИМЕННО по нему, а не по
   * преждевременному archiveShadowLoop-буферу (лечит B1). Опционален: обычное /
   * legacy Shadowing его не несёт → координатор идёт прежним синхронным путём
   * (текст из archiveShadowLoop). signal прокидывается из eval-таймаута.
   */
  // Answer-seam (T-ANS, D3): wired — useShadowRuntime.ts now supplies this
  // from an `AnswerSource` (answer-source.ts's finalizeLoopFromAnswerSource
  // adapter, real Ф2-streaming implementation lands on this same slot
  // later) whenever the caller passes `answerSource`. Still optional: when
  // no answerSource is given, the coordinator takes its synchronous path
  // (:640ish below, `runEval(attempt?.text || '(empty)')`) via
  // archiveShadowLoop instead — this file itself is unchanged either way.
  finalizeLoop?: (signal: AbortSignal) => Promise<string | null>;
  /**
   * Ф2/C (task #1068): завести пустую строку-на-луп на старте лупа (useShadow.
   * beginLoopRow). Опц. — legacy без строки-на-луп не несёт.
   */
  beginLoopRow?: () => void;
  /**
   * Решение C (task #1068): финализировать строку лупа авторитетным текстом —
   * full-replace + word-diff (matchWordsDetailed) + оценка. Возвращает {text,
   * matchPct} (СИНХРОННО) или null при тишине/пустом тексте. Когда передан,
   * координатор ГЕЙТИТ advance по этому matchPct (единый источник числа и
   * подсветки), а серверный evaluate для force-flush-пути НЕ зовётся. Опц. —
   * legacy/обычное Shadowing идёт серверным evaluate.
   */
  finalizeRow?: (authoritativeText: string, targetText?: string) => { text: string; matchPct: number } | null;
  /** Текст-цель упражнения (конкатенация cue отрезка). */
  targetTextForExercise: (ex: ShadowExerciseAnnotation) => string;
  /** Идентификатор упражнения для finalize-attempt (hash#idx или example_id). */
  evalIdForExercise: (ex: ShadowExerciseAnnotation) => string;

  // ── опциональные хуки UI / speak (S2) ──
  onEvalStart?: () => void;
  onEvalEnd?: (d: EvaluationDecision | null) => void;
  /** Вердикт по armedSegment — speak слой делает review/Anki. */
  onOutcome?: (
    ex: ShadowExerciseAnnotation,
    outcome: { action: 'advance' | 'restart'; score: number | null },
  ) => void;
  /** Последний отрезок прогона пройден (advance + впереди нет упражнения). */
  onComplete?: () => void;

  log?: (e: ShadowRtEvent) => void;
}

export interface ShadowLoopCoordinator {
  /** Передаётся в useWorkspace (10-й арг, ref-getter): grading-граница → пауза на B. */
  shouldPauseAtBoundary: () => boolean;
  /** Передаётся в useShadowAutoStart.onArm: упражнение активировано → армить петлю. */
  // WEB-SEAM: pre-warm hook (real connect() = late Ф2). Desktop has no explicit
  // pre-warm call inside THIS file either (it lives in useShadow, not lifted in
  // T2) — documented here, at the one place a future pre-warm-on-arm call would
  // attach, as a no-op placeholder. Ничего не открывать.
  onArm: (ex: ShadowExerciseAnnotation) => void;
  /** Передаётся в useShadowAutoStart.onLeave: упражнение покинуто (playhead вышел). */
  onLeave: (armedId: string) => void;
  /** Передаётся в useWorkspace.onLoopBoundary: граница петли → archive (+ eval если grading). */
  onLoopBoundary: () => void;
  /** Инспекция (тест/дебаг): id текущего армед-отрезка. */
  armedSegmentId: () => string | null;
  /** F#3: live-смена петли у армед-упражнения — синхронит armedLoopingRef
   *  (кнопка loop в ShadowChat). No-op если ничего не армлено. */
  setArmedLooping: (v: boolean) => void;
  /** Live-смена AUTO-ADVANCE у армед-упражнения — синхронит armedGradingRef.
   *  Без этого выключение автоперехода не освобождало HOLD. */
  setArmedGrading: (v: boolean) => void;
  /** Оценка в полёте (граница B). Обвязка useShadowAutoStart НЕ должна звать
   *  deactivateShadow в этом окне — иначе мик/SSE/оверлей умирают мид-eval. */
  isEvalInFlight: () => boolean;
}

// Eval-таймаут 10с (отчёт пользователя: при недоступной/долгой оценке цикл не
// должен висеть ~минуту). Передышка = max(время_оценки, pauseAtEnd) — формула в
// reduceLoopOutcome; таймаут лишь верхняя граница «времени оценки».
const DEFAULT_EVAL_TIMEOUT_MS = 10000;
// Координаторский eval-таймаут ОБЯЗАН срабатывать раньше restartFailsafe в
// useWorkspace — иначе failsafe сделает seek(A)+play, а evalInFlightRef залипнет
// true (HIGH-1). Кламп гарантирует, что finish→resumeFromBoundary (он же чистит
// useWorkspace-failsafe) случится первым.
const MAX_EVAL_TIMEOUT_MS = 10000;
// Окно транзиента петли (сек) вокруг точек A (startTime) и B (endTime): на
// границе плейхед либо у рестарта A (нативный loop сикнул B→A), либо на миг за
// endTime до сика. В пределах окна onLeave НЕ считает отрезок покинутым (иначе
// no-grade петля рвалась бы каждый цикл). Всё, что вне окон (плейхед ДО startTime
// или далеко за endTime), — реальный seek-away юзера → чистый сброс арма (баг #4).
// 0.5с с запасом покрывает overshoot на повышенной скорости, но меньше
// осознанного клика мимо упражнения.
const LOOP_BOUNDARY_TRANSIENT_S = 0.5;

export function useShadowLoopCoordinator(
  args: UseShadowLoopCoordinatorArgs,
): ShadowLoopCoordinator {
  // Стэшим аргументы в реф — координатор синхронен на границе, нельзя ловить
  // протухшие замыкания (currentTime у loop-эффекта это React-state).
  const argsRef = useRef(args);
  argsRef.current = args;

  // ── состояние прогона (рефы, не state — читаются синхронно на границе) ──
  const runActiveRef = useRef(false); // прогон идёт, snapshot держим
  const snapshotRef = useRef<WorkspaceSnapshot | null>(null);
  const armedExerciseRef = useRef<ShadowExerciseAnnotation | null>(null);
  const armedGradingRef = useRef(false); // текущий отрезок — grading (порог+advance)
  const armedLoopingRef = useRef(false); // текущий отрезок петлевой (loopMode) — СИНХРОННО,
  //   а не через ws.looping (React-state протух бы на 1 commit после re-arm — HIGH-4).
  //   Им разводятся G5 (непетлевой) и onLoopBoundary (петлевой), и B-фрейм-транзиент onLeave.
  const evalInFlightRef = useRef(false); // eval по armedSegment в полёте
  // Ф2: эпоха петли (монотонная) — маркер «финал именно ЭТОЙ петли». Инкремент на
  // старте каждого eval (startEval). Финал/apply протухшей эпохи дропается — защита
  // от reopen-гонки EL и поздно приехавшего флаша прошлой итерации (edge#4).
  // (Наблюдаемый Analyzing-под-стейт поверх reduceFinalization — задача Ф3-UI.)
  const loopSeqRef = useRef(0);
  const segEndHandledRef = useRef(false); // G5 one-shot: конец непетлевого отрезка отскорен
  const waitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null); // передышка waitMs до apply
  const mountedRef = useRef(true); // защита от apply/finish после размонтирования

  const clearWaitTimer = useCallback(() => {
    if (waitTimerRef.current != null) {
      clearTimeout(waitTimerRef.current);
      waitTimerRef.current = null;
    }
  }, []);

  // Cleanup: гасим отложенный apply, чтобы он не дёрнул resume на мёртвом хуке.
  // ВАЖНО: mountedRef.current=true в ТЕЛЕ (на mount/remount), иначе dev StrictMode
  // (mount→unmount→remount) после первого cleanup оставляет false НАВСЕГДА → apply
  // всегда отсекается guard'ом `if(!mountedRef.current) return` → resume не зовётся,
  // петля залипает на B. Был критический баг live-теста.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (waitTimerRef.current != null) clearTimeout(waitTimerRef.current);
      waitTimerRef.current = null;
    };
  }, []);

  const emit = useCallback((e: ShadowRtEvent) => {
    argsRef.current.log?.(e);
  }, []);

  // Есть ли впереди (или перекрывает) другое упражнение — для решения restore.
  // endTime>currentTime ловит и предстоящие, и текущее перекрытие.
  const exerciseAhead = useCallback((currentTime: number, exceptId: string): boolean => {
    return argsRef.current
      .getExercises()
      .some(e => e.id !== exceptId && e.endTime > currentTime);
  }, []);

  // Завершить прогон: restore snapshot (если был), опц. complete, сброс рефов.
  // Идемпотентно — runActiveRef-гард против двойного restore.
  const endRun = useCallback((emitComplete: boolean) => {
    if (!runActiveRef.current) return;
    const snap = snapshotRef.current;
    if (snap) {
      // Прогон стартовал с НЕактивного плеера → вернуть в нейтраль (а НЕ restore,
      // который форсит active+looping=true с крошечным range → фантомная граница).
      // Стартовал с активного AB → восстановить ровно его.
      if (snap.active) {
        // C2 (аудит 2026-07-06): слепое восстановление looping=true, когда
        // плейхед уже ЗА пределами старого A/B, немедленно триггерит
        // timeupdate-boundary → seek(старый A) — «воскресшая петля» (симптом
        // «повтор снят, AB нет, а меня возвращает в A»). Петлю восстанавливаем
        // только если плейхед внутри восстанавливаемого диапазона; сами
        // A/B-маркеры возвращаем как пассивную закладку в любом случае.
        const ct = argsRef.current.getCurrentTime();
        const insideSnap = ct >= snap.rangeStart && ct < snap.rangeEnd;
        argsRef.current.restoreWorkspace({
          rangeStart: snap.rangeStart,
          rangeEnd: snap.rangeEnd,
          viewStart: snap.viewStart,
          viewEnd: snap.viewEnd,
          looping: snap.looping && insideSnap,
          pauseAtEnd: snap.pauseAtEnd,
        });
      } else {
        argsRef.current.deactivateWorkspace();
      }
      emit({ event: 'restore', exId: armedExerciseRef.current?.id ?? null });
    }
    if (emitComplete) emit({ event: 'complete', exId: armedExerciseRef.current?.id ?? null });
    runActiveRef.current = false;
    snapshotRef.current = null;
    armedExerciseRef.current = null;
    armedGradingRef.current = false;
    armedLoopingRef.current = false;
  }, [emit]);

  // ── onArm: упражнение активировано → завести AB-петлю по его отрезку ──
  const onArm = useCallback((ex: ShadowExerciseAnnotation) => {
    const a = argsRef.current;
    // Кламп-тик G5 (CRIT-1): на границе B autostart в ОДНОМ тике успевает
    // решить «покинул» (t ≥ endTime), а после seek(endTime-0.1) — «вошёл
    // снова» → re-arm ТОГО ЖЕ упражнения посреди оценки. Такой re-arm сбросил
    // бы evalInFlight/segEndHandled и потёр снимок арма — игнорируем.
    if (evalInFlightRef.current && armedExerciseRef.current?.id === ex.id) return;
    // Новый arm отменяет любую отложенную обработку прошлого eval: гасим wait-таймер
    // и снимаем evalInFlight, иначе stale-apply дёрнет resume на чужом отрезке, а
    // залипший evalInFlight подавил бы будущий onLeave (HIGH-2).
    clearWaitTimer();
    evalInFlightRef.current = false;
    segEndHandledRef.current = false; // новый arm → конец отрезка снова можно скорить (G5)
    // Snapshot плеера на ПЕРВЫЙ arm прогона (re-arm на restart не перезаписывает).
    if (!runActiveRef.current) {
      snapshotRef.current = a.getWorkspaceSnapshot();
      runActiveRef.current = true;
    }
    const prevArmedId = armedExerciseRef.current?.id ?? null; // для детекта ПЕРВОГО arm упр.
    const resolved = effectiveShadowSettings(ex, a.getShadowState());
    armedExerciseRef.current = ex;
    armedGradingRef.current =
      resolved.advanceEnabled === true && typeof resolved.advanceThreshold === 'number';
    armedLoopingRef.current = resolved.loopMode === true; // синхронно (HIGH-4)
    const ct = a.getCurrentTime();
    const params = exerciseWorkspaceParams(
      ex,
      { loopMode: resolved.loopMode, pauseAtEnd: resolved.pauseAtEnd },
      ct,
    );
    if (!params) return; // невалидный отрезок (end<=start) — арминга нет
    // Вид (зум) НЕ трогаем — оставляем текущий (Fit на весь ролик), чтобы все
    // упражнения оставались видны на одном экране (Issue 1). Армим только AB-диапазон
    // под отрезок упражнения. seek-если-вне сохраняется (петля с начала отрезка).
    const curView = a.getWorkspaceSnapshot();
    a.restoreWorkspace({
      rangeStart: params.rangeStart,
      rangeEnd: params.rangeEnd,
      viewStart: curView.viewStart,
      viewEnd: curView.viewEnd,
      looping: params.looping,
      pauseAtEnd: params.pauseAtEnd,
      // Пак-склейка рапортует флакающую <video>.duration (~5с вместо 26) на
      // загрузке. Без trustExtent restoreWorkspace схлопнул бы A-B и зум к ней
      // (баг: вид/петля сжимались к ~5с). Экстент упражнения/вида валиден.
      //
      // T2-fix (audit MINOR — trustExtent discriminator): the web WEB-SEAM
      // bridge (useShadowRuntime.ts, coordinatorArgs.restoreWorkspace) uses
      // `trustExtent` for a SECOND purpose beyond the duration-clamp above —
      // it's ALSO the onArm-vs-endRun call-site discriminator that decides
      // whether the batch-trap guard (restore-batch-guard.ts) applies at
      // all: onArm (here) sets it and is applied immediately/unguarded;
      // endRun (:304 below) never sets it and always goes through the
      // guard. If endRun ever starts passing `trustExtent: true` for some
      // future reason (e.g. a duration-clamp fix ported from here), the
      // bridge will silently start skipping the guard for endRun's restore
      // too — the original batch-trap hazard (stuck boundarySuppressRef,
      // "restored loop's border never re-enforces") comes back with no
      // signal that it did.
      trustExtent: true,
    });
    if (params.seekTo !== null) a.seek(params.seekTo);
    emit({
      event: 'arm',
      exId: ex.id,
      t: ct,
      range: [params.rangeStart, params.rangeEnd],
      looping: params.looping,
      pauseAtEnd: params.pauseAtEnd,
      grading: armedGradingRef.current,
      seek: params.seekTo,
    });
    // ПЕРВЫЙ arm упражнения (не re-arm того же) → отсчёт 3·2·1 перед первой попыткой
    // (task #1068: «перед каждым циклом, включая первый»). pauseAtEnd=0 → play сразу.
    // Re-arm того же упражнения (jsdom-артефакт перелёта/рестарта) НЕ переотсчитывает —
    // отсчёт повтора делает resumeFromBoundary('restart').
    if (prevArmedId !== ex.id) a.countdownThenPlay(resolved.pauseAtEnd);
  }, [emit, clearWaitTimer]);

  // ── onLeave: playhead покинул упражнение (по reducer'у автостарта) ──
  // ВО ВРЕМЯ eval (evalInFlight) — игнор: плейхед стоит на B, отрезок ещё «наш»,
  // resume сам разрулит переход (advance→вперёд / restart→назад в отрезок).
  const onLeave = useCallback((armedId: string) => {
    if (evalInFlightRef.current) return; // eval владеет отрезком
    // advance уже мог обработать и обнулить armedExercise — стале-онлив игнорим.
    if (armedExerciseRef.current?.id !== armedId) return;
    const ex = armedExerciseRef.current;
    const ct = argsRef.current.getCurrentTime();
    // Петлевой отрезок: ранний выход ТОЛЬКО для B-фрейм-транзиента — плейхед на
    // миг за endTime на границе петли, нативный loop тут же сикнет назад к A
    // (иначе no-grade петля рвалась бы каждый цикл: deactivate(B)→reactivate(A),
    // мик стоп/старт). Реальный seek-away юзера (плейхед ДО startTime либо далеко
    // за endTime, вне окна транзиента) обязан очистить арм → следующий вход =
    // ЧИСТЫЙ заход (onArm даст отсчёт + новый /shadow/start). Без этого повторный
    // заход в то же упражнение шёл БЕЗ отсчёта (prevArmedId === ex.id) — баг #4.
    // Для grading-петли evalInFlight-гард выше и так покрывает границу; этот гард
    // защищает no-grade петлю. Для НЕПЕТЛЕВОГО (G5) armedLooping=false → не ловит.
    if (armedLoopingRef.current) {
      // Транзиент петли (НЕ реальный уход): 'deactivate' прилетает от СТЕЙЛ
      // React-state currentTime редьюсера (он завис на endTime во время eval/
      // рестарта), тогда как ЖИВОЙ getCurrentTime уже вернулся в петлю. Держим арм,
      // если живой плейхед:
      //  (а) ВНУТРИ [startTime,endTime) — рестарт сделал seek(A)+play, плейхед уже
      //      проиграл вперёд (на pauseAtEnd=0 это ~startTime+1..2с, за узким окном —
      //      из-за этого узкое окно давало двойной отсчёт, live 2026-06-21);
      //  (б) на миг за endTime (B-фрейм до нативного сика к A на no-grade петле).
      // Реальный seek-away юзера лендит плейхед ВНЕ обоих (ДО startTime либо далеко
      // за endTime) → не транзиент → чистим арм (чистый повторный заход, баг #4).
      const insideRegion = ct >= ex.startTime && ct < ex.endTime;
      const justPastEnd = ct >= ex.endTime && ct < ex.endTime + LOOP_BOUNDARY_TRANSIENT_S;
      if (insideRegion || justPastEnd) return;
    }
    armedExerciseRef.current = null;
    armedGradingRef.current = false;
    armedLoopingRef.current = false;
    emit({ event: 'deactivate', exId: armedId, t: ct });
    // Впереди нет упражнения → прогон окончен, вернуть плеер (без complete:
    // это ручной/линейный выход, а не прохождение последнего отрезка).
    if (!exerciseAhead(ct, armedId)) endRun(false);
  }, [emit, exerciseAhead, endRun]);

  // ── startEval: общая eval-машинерия (петлевой boundary И непетлевой G5) ──
  // Вызывающий уже: проверил grading+active+ex, заархивировал попытку, заморозил
  // видео (useWorkspace на петле / pauseVideo на G5) и эмитнул loop-boundary.
  // startEval: eval (AbortController-таймаут) → reduceLoopOutcome → resumeFromBoundary.
  const startEval = useCallback((
    ex: ShadowExerciseAnnotation,
    attempt: { text: string; matchPct: number } | null,
  ) => {
    const a = argsRef.current;
    // Live-настройки (per-cue порог/флаги): armedExerciseRef держит СНИМОК
    // упражнения с момента arm, а слайдер AUTO-ADVANCE пишет новый порог в
    // annotations (updateShadowExercise). Перечитываем актуальное упражнение по
    // id на границе, иначе advance-гейт сравнивал бы по СТАРОМУ порогу (баг:
    // выставил 50%, набрал 56% → рестарт, т.к. снимок ещё 80).
    const liveEx = a.getExercises().find(e => e.id === ex.id) ?? ex;
    evalInFlightRef.current = true; // СИНХРОННО — до того как autostart-эффект тикнет onLeave
    a.onEvalStart?.();
    // Ф2: открыть эпоху этой петли (Analyzing держится до финала/таймаута).
    const seq = (loopSeqRef.current += 1);
    const target = a.targetTextForExercise(ex);
    const evalId = a.evalIdForExercise(ex);

    // Ф3a: снимок настроек скоринга на старте eval (edge #9). providerPrompts
    // ключуются по engines.check-литералу (как сохраняет Ф2), а scoringProvider
    // — серверное имя через маппер. Обычное Shadowing → флаг отсутствует.
    const startSettings = effectiveShadowSettings(liveEx, a.getShadowState());
    const check = startSettings.engines?.check ?? '';
    const scoringProvider = scoringProviderForCheck(check);
    const useProviderForScoring = startSettings.useProviderForScoring === true;
    const prompt = startSettings.providerPrompts?.[check];
    const promptText = prompt?.text ?? '';
    const promptFile = prompt?.file ?? '';

    const ctrl = new AbortController();
    const startMs = Date.now();
    let settled = false;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

    const finish = (d: EvaluationDecision | null) => {
      if (settled) return;
      settled = true;
      if (timeoutTimer != null) clearTimeout(timeoutTimer);
      const elapsed = Date.now() - startMs;
      const resolved = effectiveShadowSettings(liveEx, a.getShadowState());
      const score = typeof d?.score === 'number' ? d.score : null;
      emit({
        event: 'eval-end',
        exId: ex.id,
        decision: d?.decision ?? 'timeout',
        score,
        elapsedMs: elapsed,
      });
      a.onEvalEnd?.(d);
      const outcome = reduceLoopOutcome({
        decision: d?.decision ?? 'timeout',
        score,
        advanceEnabled: resolved.advanceEnabled,
        advanceThreshold: resolved.advanceThreshold,
        pauseAtEndSec: resolved.pauseAtEnd,
        evalElapsedMs: elapsed,
      });
      emit({ event: 'outcome', exId: ex.id, action: outcome.action, waitMs: outcome.waitMs });
      a.onOutcome?.(ex, { action: outcome.action, score });

      const apply = () => {
        // Stale-guard: за async-окно eval (промис finalize-attempt) упражнение могло
        // смениться (новый onArm) или хук размонтироваться. Тогда resume/endRun дёрнули
        // бы чужой/мёртвый workspace и затёрли свежий арм — отсекаем.
        if (!mountedRef.current) return;
        // Ф2 epoch-guard: поздно приехавший флаш/вердикт прошлой петли (та же ex
        // после restart→re-arm) не должен резюмить текущую — сверяем эпоху (edge#4).
        if (seq !== loopSeqRef.current) return;
        if (armedExerciseRef.current?.id !== ex.id || !runActiveRef.current) return;
        evalInFlightRef.current = false;
        if (outcome.action === 'advance') {
          // Снять петлю и идти ВПЕРЁД от B (resume НЕ сикает A — инвариант FM2).
          emit({ event: 'advance', exId: ex.id });
          a.resumeFromBoundary('advance');
          // Отрезок пройден и покинут вперёд: лог deactivate здесь (autostart-onLeave
          // во время eval был проигнорен и больше не фаернёт — shadow уже снят на B).
          emit({ event: 'deactivate', exId: ex.id, t: a.getCurrentTime() });
          const last = !exerciseAhead(a.getCurrentTime(), ex.id);
          if (last) {
            // endRun читает armedExerciseRef=ex → restore/complete с верным exId,
            // затем сам обнуляет рефы. Не обнуляем ДО него (иначе exId:null в логе).
            endRun(true);
          } else {
            armedExerciseRef.current = null;
            armedGradingRef.current = false;
            armedLoopingRef.current = false;
          }
        } else if (armedLoopingRef.current) {
          // Повторить петлю: resume сикает A + play; остаёмся армлены на ex.
          emit({ event: 'restart', exId: ex.id });
          a.resumeFromBoundary('restart');
        } else {
          // HOLD (Fable-анализ 2026-07-06): повтор СНЯТ + автопереход — неудача/
          // тишина не имеет права НИ сикать назад, НИ пропускать вперёд («мы
          // должны пропустить пользователя только если он правильно сказал
          // субтитр»). Видео уже на паузе у B (кламп в G5), арм и UI живы.
          // segEndHandled сбрасываем: повторный заезд в конец отрезка скорится
          // заново (после клампа плейхед < endTime → G5 не перефаерит сам).
          // Yank-back-гард (проверка d0b4973b, MED-HIGH): если юзер сикнул
          // ПРОЧЬ во время оценки (deactivate/onLeave были проглочены eval-
          // гардами), hold не имеет права возвращать его — стейл-арм с
          // сброшенным segEndHandled заставил бы G5 запарковать плейхед назад
          // к B из любого места ролика. Вне отрезка → leave-cleanup.
          const ct = a.getCurrentTime();
          const inside = ct >= ex.startTime && ct < ex.endTime + LOOP_BOUNDARY_TRANSIENT_S;
          if (!inside) {
            emit({ event: 'deactivate', exId: ex.id, t: ct });
            if (!exerciseAhead(ct, ex.id)) {
              endRun(false);
            } else {
              armedExerciseRef.current = null;
              armedGradingRef.current = false;
              armedLoopingRef.current = false;
            }
          } else {
            emit({ event: 'hold', exId: ex.id });
            segEndHandledRef.current = false;
          }
        }
      };

      // Резюмируем СРАЗУ после вердикта: передышка-отсчёт 3·2·1 перенесена в
      // useWorkspace (resume('restart') / countdownThenPlay) — модель «петля →
      // анализ(off) → отсчёт → петля» последовательна, а не max(eval,pause).
      apply();
    };

    const evalTimeout = Math.min(
      a.evalTimeoutMs ?? DEFAULT_EVAL_TIMEOUT_MS,
      MAX_EVAL_TIMEOUT_MS, // цепочка: сервер 8с < клиент 10с < useWorkspace 15с-failsafe
    );
    timeoutTimer = setTimeout(() => {
      ctrl.abort();
      finish(null); // таймаут → restart (FM7: не зависать; AC6/edge#9: не ложный 0%)
    }, evalTimeout);

    // runEval: эмит eval-start + скоринг по answer. Общий хвост для обоих путей.
    const runEval = (answer: string) => {
      emit({ event: 'eval-start', exId: ex.id, target: target.length });
      a.evaluate(
        { exerciseId: evalId, answer, target, scoringProvider, useProviderForScoring, promptText, promptFile },
        ctrl.signal,
      )
        .then(d => finish(d))
        .catch(() => finish(null)); // сеть/ошибка → restart
    };

    if (a.finalizeLoop) {
      // Ф2: force-flush ПЕРВЫМ шагом — дождаться авторитетного финала ВСЕЙ петли,
      // и только потом скорить по нему (а не по преждевременному буфере, B1).
      // eval-start эмиттится после прихода финала. Окно ожидания = тот же
      // evalTimeout («Analyzing» ~10с) — таймаут уже разрулит finish(null).
      a.finalizeLoop(ctrl.signal)
        .then((finalText) => {
          if (settled) return; // bounded-таймаут уже завершил (graceful restart)
          if (seq !== loopSeqRef.current) return; // эпоха протухла — финал не наш
          if (a.finalizeRow) {
            // Решение C: finalizeLoopRow считает word-diff + % по авторитетному
            // тексту (единый источник числа и подсветки) и финализирует строку-на-
            // луп. Гейтим по нему, серверный evaluate для этого пути НЕ зовём.
            // target упражнения передаём ЯВНО (Fable-анализ B): finalizeLoopRow
            // скорил по живому activeCueText, который на границе B пуст/чужой —
            // отсюда ложные «0% попадания» при верном ответе; инвариант #5b/FM3
            // (target по armedSegment) обязан работать и в этом пути.
            const row = a.finalizeRow(finalText ?? '', target);
            if (row == null) {
              // Тишина/пустой финал → pending-строка убрана, graceful repeat
              // (edge#1/#8), НЕ ложный 0%.
              emit({ event: 'eval-start', exId: ex.id, target: target.length, flushed: true });
              finish(null);
              return;
            }
            const thr = startSettings.advanceThreshold;
            const decision = typeof thr === 'number' && row.matchPct >= thr ? 'pass' : 'retry';
            emit({ event: 'eval-start', exId: ex.id, target: target.length });
            finish({ decision, score: row.matchPct } as EvaluationDecision);
            return;
          }
          // Legacy/обычное Shadowing: серверный скоринг по авторитетному тексту.
          // Тишина/ошибка/пустой финал → graceful repeat (edge#1/#8), НЕ ложный
          // 0%: эмитим eval-start (Analyzing закрылся) и идём в timeout-исход.
          if (finalText == null || finalText.trim() === '') {
            emit({ event: 'eval-start', exId: ex.id, target: target.length, flushed: true });
            finish(null);
            return;
          }
          runEval(finalText);
        })
        .catch(() => { if (!settled) finish(null); }); // флаш упал → graceful restart
    } else {
      // Обычное / legacy Shadowing: синхронный путь по archive-буферу (без изменений).
      runEval(attempt?.text || '(empty)');
    }
  }, [emit, exerciseAhead, endRun]);

  // ── onLoopBoundary: граница ПЕТЛИ (вызывает useWorkspace СИНХРОННО на B) ──
  // archive ВСЕГДА; если grading — запустить eval (он же позовёт resume).
  // НЕ grading → return, useWorkspace делает нативный seek(A)+рестарт.
  const onLoopBoundary = useCallback(() => {
    const a = argsRef.current;
    const ex = armedExerciseRef.current;
    const grading = armedGradingRef.current;
    // deferScore (решение C): grading-петля с finalizeRow → строку финализирует
    // finalizeLoopRow авторитетным текстом, не committedSegments-превью. Включаем
    // только когда eval реально запустится (grading+active+ex), иначе archive идёт
    // legacy-путём (committedSegments-строка), без зарезервированной строки-на-луп.
    const willEval = grading && a.getShadowState().active && !!ex;
    const attempt = a.archiveShadowLoop({ deferScore: willEval && !!a.finalizeRow });
    emit({ event: 'loop-boundary', exId: ex?.id ?? null, t: a.getCurrentTime(), grading });
    if (!grading) return; // петля без оценки — нативный рестарт в useWorkspace
    if (!a.getShadowState().active) return; // shadow не активен — оценивать нечего
    if (!ex) return;
    startEval(ex, attempt);
  }, [emit, startEval]);

  // ── G5: скоринг по КОНЦУ непетлевого grading-отрезка (матрица loopMode=false+порог) ──
  // useWorkspace boundary-эффект фаерит ТОЛЬКО при ws.looping; для непетлевого
  // упражнения границы нет — плейхед просто переезжает конец. Сторож: дошли до
  // ex.endTime при active && !looping → заморозить, archive, eval ОДИН раз (как
  // петлевой boundary, но pause делаем сами). Авто-advance ≥порога сохраняется без
  // петли; fail → resume('restart') сикает A для одного переигрывания.
  useEffect(() => {
    const a = argsRef.current;
    const ex = armedExerciseRef.current;
    if (!ex) return;
    if (!armedGradingRef.current) return;          // скорим только grading-упражнения
    if (evalInFlightRef.current) return;           // уже оцениваем
    if (segEndHandledRef.current) return;          // one-shot на этот arm
    if (armedLoopingRef.current) return;           // петлевой кейс — это onLoopBoundary, не G5
    //   (СИНХРОННЫЙ ref, не ws.looping: тот протух бы на 1 commit после re-arm и в окне
    //    смены петлевого↔непетлевого упражнения дал бы двойной путь/пропуск — HIGH-4)
    if (!a.getShadowState().active) return;
    if (a.getCurrentTime() < ex.endTime) return;   // ещё не доехали до конца отрезка
    segEndHandledRef.current = true;
    a.pauseVideo();                                 // useWorkspace не паузит непетлевой — паузим сами
    // CRIT-1 (Fable-анализ 2026-07-06): кламп плейхеда ВНУТРЬ отрезка (паритет
    // с петлевым путём useWorkspace Issue 3a). Без клампа autostart-редьюсер на
    // том же тике видит currentTime ≥ endTime → 'deactivate' → shadow умирает
    // МИД-EVAL: оверлей исчезает на границе B, мик/SSE убиты, activeCue уезжает
    // (пустой refText → ложные «0% попадания»).
    a.seek(Math.max(ex.startTime, ex.endTime - 0.1));
    const attempt = a.archiveShadowLoop({ deferScore: !!a.finalizeRow }); // C: строку финализирует finalizeRow
    emit({ event: 'loop-boundary', exId: ex.id, t: a.getCurrentTime(), grading: true, segmentEnd: true });
    startEval(ex, attempt);
  }, [args.currentTime, emit, startEval]);

  const shouldPauseAtBoundary = useCallback(() => armedGradingRef.current, []);
  const armedSegmentId = useCallback(() => armedExerciseRef.current?.id ?? null, []);

  // F#3 (task #1068): live-смена петли у АРМЕД-упражнения (кнопка loop в ShadowChat).
  // Реальную петлю гонит workspace.looping (вызывающий сам зовёт setLooping). Но
  // armedLoopingRef — синхронный снимок loopMode с момента arm, на него завязаны
  // гарды onLeave (B-фрейм) и G5 (скоринг по концу при !loop). Без синхронизации
  // отжатие петли оставило бы armedLoopingRef=true → onLeave рано выйдет
  // (runActiveRef залипнет, stale snapshot) и G5 не сработал бы при loop OFF + adv.
  const setArmedLooping = useCallback((v: boolean) => {
    if (!armedExerciseRef.current) return; // нет армед-отрезка — нечего менять
    armedLoopingRef.current = v;
  }, []);

  // Аналог setArmedLooping для тумблера AUTO-ADVANCE (проверка d0b4973b, MED):
  // armedGradingRef — снимок на arm; без live-синка выключение автоперехода не
  // освобождало HOLD (fail → снова hold, юзер заперт). OFF при hold → G5 больше
  // не скорит конец, play проходит отрезок насквозь, onLeave чистит арм.
  const setArmedGrading = useCallback((v: boolean) => {
    if (!armedExerciseRef.current) return;
    armedGradingRef.current = v;
  }, []);

  const isEvalInFlight = useCallback(() => evalInFlightRef.current, []);

  return { shouldPauseAtBoundary, onArm, onLeave, onLoopBoundary, armedSegmentId, setArmedLooping, setArmedGrading, isEvalInFlight };
}
