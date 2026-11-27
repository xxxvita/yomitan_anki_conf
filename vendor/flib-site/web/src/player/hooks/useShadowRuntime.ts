// useShadowRuntime.ts — T2 WEB-SEAM composition layer.
//
// Wires the three verbatim-lifted desktop hooks (useAnnotations,
// useShadowLoopCoordinator; useShadowAutoStart is wired by a FUTURE caller —
// see below) to: T0's useWorkspace actuators (web/src/player/hooks/
// useWorkspace.ts), T-A's seam adapters (AnnotationStore via useAnnotations
// itself, LoopRecorder-shaped `recorder`), and T1's panel-types + cp'd pure
// utils (exercise-workspace/loop-outcome/shadow-settings/scoring-provider,
// consumed inside useShadowLoopCoordinator).
//
// S3-2-fix LOW: this header used to say "NOT wired into PlayerPage.tsx
// (production)" — stale as of S3-2, which mounted it. Corrected below.
//
// Mounted in PlayerPage.tsx as of S3-2, ALONGSIDE the still-shipped useShadowV1
// vertical slice (V1 keeps owning record/transcribe/diff; this runtime owns
// loops/arm/hold on a FakeAnswerSource). It is DORMANT there — no arm trigger
// is wired yet (S key = S3-6, autostart later), and structurally can't be
// armed yet anyway: useShadowAutoStart still needs a `shadowActive`/`activate`/
// `deactivate` triple that only a useShadow-equivalent can supply, and that
// hook was NOT lifted in T2 (coordinator/autostart/annotations don't import
// it — see task-T2-report.md). This file remains the tested integration
// surface for wiring that arm path in a later task.
//
// Forward-ref idiom (why `wsActuatorsRef` exists): useWorkspace's own
// onLoopBoundary/shouldPauseAtBoundary/onLoopRestart params must be supplied
// AT CONSTRUCTION TIME, but this hook's coordinator needs useWorkspace's
// actuators (restoreWorkspace/resumeFromBoundary/...) as ITS OWN inputs —
// a circular dependency. Desktop resolves this with stable ref-forwarding
// callbacks at the call site (index.tsx:1383-1392: `rearmRecordingRef` /
// `wsOnRearm`); this hook takes the same shape as a plain ref the CALLER
// populates right after constructing `ws`.
//
// T2-fix (audit LIGHT — ref-fill hardening): that populating effect at the
// call site MUST be a `useLayoutEffect`, never a passive `useEffect`. React
// flushes ALL layout effects for a commit before ANY passive effect from
// that same commit runs. If a future caller
// wires `onArm`/autostart to fire from ITS OWN passive effect (e.g. "video
// ready" → auto-arm the first exercise), a passive-effect ref-fill races it:
// on an unlucky ordering the autostart's passive effect could run BEFORE the
// ref-fill's passive effect, so `wsActuatorsRef.current` is still null when
// `onArm` calls into the wrappers below — but `onArm` (useShadowLoopCoordinator)
// has ALREADY mutated its own refs (runActiveRef/armedExerciseRef/snapshotRef)
// by the time it reaches the `restoreWorkspace(...)` call that no-ops. Net
// effect: the coordinator believes an exercise is armed, but the workspace
// never actually moved — a broken first arm that's invisible until the next
// coordinator call trips over the already-mutated state. `useLayoutEffect`
// closes the race because it always wins the ordering against ANY passive
// effect, including one that fires an immediate arm. The wrappers below also
// no longer no-op silently in the null-ref case — see the FIX2 comment at
// each one.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Cue as LiveCue } from './useSubtitles'
import type { ShadowExerciseAnnotation, ShadowMode, ShadowState } from '../workspace/panel-types'
import { toDesktopCues } from '../workspace/cue-shape-adapter'
import { guardedRestoreWorkspace, type GuardedRestoreParams } from '../workspace/restore-batch-guard'
import {
  finalizeLoopFromAnswerSource,
  DEFAULT_ANSWER_BUDGET_MS,
  type AnswerSource,
  type AnswerOutcomeEvent,
} from '../workspace/answer-source'
import { effectiveShadowSettings } from '../workspace/shadow-settings'
import { checkRuleOnLoopExit, type LoopRuleCtx, type RuleDecision } from '../workspace/loop-rule'
// T3: stale-outcome filter (carry T-ANS/F3) — see hold-render.ts doc.
import { filterAnswerOutcomeForRender } from '../workspace/hold-render'
// T4: cue-hit resolver (T1) — S на субтитре армит его диапазон. Web Cue уже
// имеет .start/.end, поэтому liveCues скармливаются findCueIndexAtTime как есть
// (структурное совпадение со `{start,end}`-спанами).
import { findCueIndexAtTime } from '../workspace/cue-hit'
// T4: EXERCISE_START_EPS — тот же ε, что у reduceShadowAutoStart, чтобы
// playhead-exit-снятие ЭФЕМЕРНОГО арма не срабатывало на недолёте seek(A) при
// рестарте петли (video рапортует currentTime на sub-frame < startTime).
import { EXERCISE_START_EPS } from './useShadowAutoStart'
import { useAnnotations } from './useAnnotations'
import {
  useShadowLoopCoordinator,
  type CoordinatorEvaluate,
  type ShadowRtEvent,
  type UseShadowLoopCoordinatorArgs,
  type WorkspaceSnapshot,
  type ShadowLoopCoordinator,
} from './useShadowLoopCoordinator'

/** Subset of T0's WorkspaceApi (useWorkspace.ts) the coordinator actually
 *  calls. `seek`/`pauseVideo` are passed separately (they come straight off
 *  the adapter, not off `ws`, on both desktop and web). */
export interface ShadowRuntimeWorkspaceActuators {
  restoreWorkspace: (p: GuardedRestoreParams) => void
  resumeFromBoundary: (action: 'advance' | 'restart') => void
  deactivateWorkspace: () => void
  countdownThenPlay: (pauseAtEndSec?: number) => void
  getWorkspaceSnapshot: () => WorkspaceSnapshot
}

const EMPTY_SNAPSHOT: WorkspaceSnapshot = {
  rangeStart: 0, rangeEnd: 0, viewStart: 0, viewEnd: 0, looping: false, pauseAtEnd: 0, active: false,
}

// T4-fix F1(a): зеркало координаторского LOOP_BOUNDARY_TRANSIENT_S
// (useShadowLoopCoordinator.ts :229 = 0.5s). Окно `[endTime, endTime+JUST_PAST_END_S)`
// для НЕПЕТЛЕВОГО grading-эфемерного, в котором lifecycle-teardown НЕ снимает арм —
// отдаём его G5 (useShadowLoopCoordinator.ts :676-699, скорит по концу непетлевого
// отрезка). Координаторский onLeave имеет justPastEnd-гард ТОЛЬКО для looping (:427-441);
// для непетлевого grading его нет → без этого окна teardown обгонял бы G5 и сносил
// армед-объект ДО оценки (F1 CRIT).
const JUST_PAST_END_S = 0.5

export interface UseShadowRuntimeArgs {
  videoId: string
  liveCues: LiveCue[]
  currentTime: number
  getCurrentTime: () => number
  getShadowState: () => ShadowState
  /**
   * T5 (D1 dual-write, MANUAL path — task-T5-brief.md §2 "ВСЕГДА"): commits
   * `{customText, mode}` into the caller-owned ShadowState so
   * `effectiveShadowSettings`'s no-exercise else-branch (shadow-settings.ts)
   * picks it up. Optional, same "future caller" status as `getShadowState`
   * itself (no ShadowState owner is wired into this hook on web yet — see
   * that field's doc/file-top note); `setCustomText` below no-ops safely via
   * `?.` when this is absent, so the ephemeral/persisted paths remain
   * independently testable without it.
   */
  setShadowState?: (patch: Partial<Pick<ShadowState, 'customText' | 'mode'>>) => void
  /** Populated by the caller AFTER constructing `useWorkspace(...)` — see
   *  forward-ref idiom note above. `null` before that (first render(s)). */
  wsActuatorsRef: React.RefObject<ShadowRuntimeWorkspaceActuators | null>
  seek: (t: number) => void
  pauseVideo: () => void
  /** WEB-SEAM: answer-seam (T-ANS) — later. Real impl = fetch; this slice's
   *  caller injects a fake (or a not-yet-exercised stub). NOTE: this is the
   *  SCORING seam (LLM/rules verdict on an already-known answer text) — a
   *  different concern from `answerSource` below (which is how the answer
   *  TEXT itself is obtained by the loop boundary). T-ANS builds/wires only
   *  the latter; `evaluate` stays a caller-injected fake until a real
   *  scoring endpoint task lands. */
  evaluate: CoordinatorEvaluate
  evalTimeoutMs?: number
  /**
   * Answer-seam (T-ANS, D3): how the coordinator learns the user's answer
   * by the end of A-B. Optional — when omitted, the coordinator takes its
   * synchronous legacy path (archiveShadowLoop buffer, unchanged). When
   * supplied, wired into `UseShadowLoopCoordinatorArgs.finalizeLoop` via
   * `finalizeLoopFromAnswerSource` (see answer-source.ts) — the coordinator
   * itself is NOT touched, this is purely an external prop injection.
   * Composition/tests inject `FakeAnswerSource`; the real Ф2 WS-streaming
   * implementation lands on this SAME prop later (separate task).
   */
  answerSource?: AnswerSource
  /** budgetMs passed to `answerSource.awaitAnswerByBoundary`. Fixed default
   *  3000ms (owner decision, audit/25 D3) — deliberately NOT derived from
   *  pauseAtEnd. Override only for tests exercising the timeout edge. */
  answerBudgetMs?: number
  /** WEB-SEAM: outcome render → T3/T7. Fired with `{exerciseId, outcome}`
   *  (FIX F3 — carries which exercise the outcome belongs to) for every
   *  finalizeLoop call the answerSource-backed adapter makes, EXCEPT when
   *  the eval's own AbortSignal was already aborted by the time the
   *  outcome settled (stale — see finalizeLoopFromAnswerSource's onOutcome
   *  doc) — the coordinator's own finalizeLoop return type collapses
   *  non-final statuses to `null`, so this callback is the only place the
   *  no-response/error/non-final/timeout distinction survives past this
   *  hook. NOT a render — just the attachment point for T3's hold-render
   *  and T7's notation, which read `event.outcome.reason`/
   *  `event.outcome.partial` to show *why* ("нет ответа" vs error vs
   *  partial-only). */
  onAnswerOutcome?: (event: AnswerOutcomeEvent) => void
  /** WEB-SEAM: onLoopRestart → recorder rearm (T2-carry a). Optional — no
   *  recorder is wired in production yet (no useShadow-equivalent exists on
   *  web); `start()` is T-A's LoopRecorder rearm primitive. */
  recorder?: { start(): void }
  /**
   * D2 seam (T-RULE): fired on every A-B loop-boundary exit of an armed
   * shadow exercise, with `checkRuleOnLoopExit`'s matrix-cell + form-stub
   * decision (loop-rule.ts). Purely observational — does NOT change what
   * the coordinator decides to do about the exit; see the `onLoopBoundary`
   * wrapper below for wiring. The future loop+threshold toggle UI task and
   * T4 (real shadowing-form flag) plug in HERE instead of re-deriving the
   * matrix cell or reaching into the coordinator's internals.
   */
  onRuleDecision?: (decision: RuleDecision, exerciseId: string) => void
  log?: (e: ShadowRtEvent) => void
}

export interface ShadowRuntime {
  annotations: ReturnType<typeof useAnnotations>
  /** → useWorkspace(..., onLoopBoundary, ...) */
  onLoopBoundary: () => void
  /** → useWorkspace(..., shouldPauseAtBoundary, ...) */
  shouldPauseAtBoundary: () => boolean
  /** → useWorkspace(..., onLoopRestart) — WEB-SEAM: onLoopRestart → recorder
   *  rearm (T2-carry a), see UseShadowRuntimeArgs.recorder. */
  onLoopRestart: () => void
  /** → a future useShadowAutoStart({ onArm }) once a useShadow-equivalent exists. */
  onArm: (ex: ShadowExerciseAnnotation) => void
  /** → a future useShadowAutoStart({ onLeave }). */
  onLeave: (armedId: string) => void
  /**
   * S3-7-fix (blocker) — explicit user-close (× on RuntimeShadowCard). NOT
   * the same actuator as `onLeave` (playhead-exit teardown) — see the
   * function's own doc (useShadowRuntime.ts body) for why `onLeave` alone
   * silently no-ops in the default in-range-loop case, and why this composes
   * `setArmedLooping` + `onLeave` instead of reaching into the coordinator.
   * Mirrors desktop canon's `deactivateShadow` (useShadow.ts's `deactivate`,
   * wired to ShadowChat's onDeactivate): an explicit, ungated close path,
   * distinct from seek-triggered onLeave. No-ops while `isEvalInFlight()`.
   */
  deactivate: () => void
  armedSegmentId: () => string | null
  setArmedLooping: (v: boolean) => void
  setArmedGrading: (v: boolean) => void
  isEvalInFlight: () => boolean
  /**
   * T3 (hold-render): true while the exercise's grading-hold (coordinator's
   * verbatim `hold` emit — useShadowLoopCoordinator.ts apply()'s else-branch,
   * loop OFF+fail+auto-advance) is active. React state — re-renders the
   * consumer; drives `holding` prop into ShadowHoldOverlay. Kept in sync
   * with `isHeld()` below (same underlying heldRef), cleared by class-3
   * lifecycle points (startEval/eval-start, setArmedGrading(false), onArm,
   * onLeave — see useShadowRuntime.ts body).
   */
  holding: boolean
  /** T3 (hold-render): true during the eval window (`eval-start`…`eval-end`)
   *  — feed straight into `<AwaitingEvaluationOverlay visible={...} />`. */
  evalOverlayVisible: boolean
  /**
   * T3 (hold-render, carry T-ANS/F3): the most recent AnswerOutcomeEvent for
   * the CURRENTLY armed/held exercise, already stale-filtered by exerciseId
   * (filterAnswerOutcomeForRender — hold-render.ts). `null` when there is
   * nothing to show or the last event belonged to a since-superseded
   * exercise. T7's real verdict-notation card reads this instead of
   * re-deriving the filter; T3 itself only renders a placeholder slot off
   * of it (ShadowHoldOverlay.tsx — `// T7: verdict card renders here`).
   */
  verdictOutcome: AnswerOutcomeEvent | null
  /**
   * T7 (N2 — "снапшоти target в момент committed"): the effective target
   * text this SAME `verdictOutcome` was actually spoken against, frozen at
   * the moment the outcome was accepted (handleAnswerOutcome) rather than
   * read live — a render layer must diff `verdictOutcome.outcome.text`
   * against THIS, never against a fresh `targetTextForExercise` call,
   * otherwise a target change after the attempt (new A-B/subtitle/
   * customText) would recolor an already-shown verdict against the wrong
   * reference. `null` in lockstep with `verdictOutcome` (loop-boundary/arm).
   */
  verdictTargetSnapshot: string | null
  /**
   * T3/T4 seam (B4-резюм): synchronous read of the SAME heldRef `holding`
   * mirrors as React state — T4's S-handler is meant to check this FIRST,
   * before its own armedSegmentId-guard: `if (isHeld()) resumeFromHold()`
   * (see task-T3-brief.md item 2 / T4 brief). Function getter (not state)
   * so it never reads stale — mirrors `isEvalInFlight()`'s shape above.
   */
  isHeld: () => boolean
  /**
   * T3/T4 seam (B4-резюм): if a hold is active, mirrors the coordinator's
   * OWN advance branch (useShadowLoopCoordinator.ts apply(): resumeFromBoundary
   * ('advance') then arm-cleanup) WITHOUT reaching into its internal refs —
   * reuses the coordinator's own `onLeave` actuator for the cleanup half
   * (safe here because a hold only ever occurs on the non-looping matrix
   * cell — armedLoopingRef is false — so onLeave's cleanup is unconditional,
   * no loop-transient window to dodge). No-op when nothing is held.
   */
  resumeFromHold: () => void
  /**
   * T4 — ordered S-handler (hands-free shadowing). useHotkeys прокидывает сюда
   * клавишу S; ВЕСЬ порядок ветвлений живёт тут (composition-слой), не в
   * useHotkeys. Порядок (гард B4/T3 первым):
   *   1. isHeld() && !isEvalInFlight()  → resumeFromHold()  (шов T3, ДО
   *      armedSegmentId-гарда — иначе hands-free тупик в hold).
   *   2. isHeld() (значит eval в полёте) → no-op (carry T3 FIX B).
   *   3. armedSegmentId() != null && !ephemeralArmRef → no-op (S НЕ перехватывает
   *      живое PERSISTED-упражнение; ephemeralArmRef различает автостарт от S).
   *   4. playhead ВНУТРИ активного A-B → armRange(A,B).
   *   5. вне A-B, НА субтитре (findCueIndexAtTime>=0) → armRange(cue.start,cue.end).
   *   6. иначе → no-op.
   */
  handleShadowKey: () => void
  /**
   * T4 — ЭФЕМЕРНЫЙ арм по готовому диапазону [start,end]. Создаёт транзиентное
   * range-упражнение (anchorMode:'time-range') из ТЕКУЩИХ настроек ShadowState,
   * НЕ пишет в annotations, кладёт в ephemeralArmRef и передаёт ТОТ ЖЕ объект в
   * coordinator.onArm (object-identity критична для T5). Публично — чтобы будущий
   * caller/тесты могли армить программно; handleShadowKey зовёт его же.
   */
  armRange: (start: number, end: number) => void
  /**
   * T4 — текущий ЭФЕМЕРНЫЙ арм (или null). ТОТ ЖЕ объект, что лежит в
   * coordinator.armedExerciseRef после armRange (одна ссылка, без клона). T5
   * мутирует `getEphemeralArm()!.settings` in-place — координатор увидит те же
   * поля (его effectiveShadowSettings/liveEx-резолв читают этот объект). Возвращает
   * null для PERSISTED-арма (автостарт) и после снятия эфемерного (lifecycle).
   */
  getEphemeralArm: () => ShadowExerciseAnnotation | null
  /**
   * T4-fix2 [F3-FORWARD] — ЕДИНЫЙ seek-chokepoint. Обёртка над adapter.seek: перед
   * реальным сиком СИНХРОННО снимает ЭФЕМЕРНЫЙ арм, если ЦЕЛЬ сика ВНЕ [start,end)
   * (user-escape) — ДО того как изменение currentTime дотянется до координаторского
   * G5, иначе G5 yank'нул бы юзера назад к B. Будущий caller (PlayerPage) ОБЯЗАН
   * развести ВСЕ user-сик-источники (useHotkeys/timeline/WorkspacePanel) через ЭТОТ
   * seek, а НЕ через adapter.seek напрямую (см. maybeReleaseEphemeralOnSeek doc).
   */
  seek: (t: number) => void
  /**
   * T5 (D1 + BL1-delivery) — commit a customText across all THREE delivery
   * paths reachable from this composition layer: `text: null` clears (→
   * mode:'subtitle' everywhere it touched). See setCustomText's own doc
   * (below, in the hook body) for the full per-path breakdown (manual state
   * dual-write / ephemeral in-place mutation with the T4 dead-object caveat /
   * persisted in-place mutation + updateShadowExercise persist, §4 variant a).
   * The right-click "Задать значение текста" menu (ShadowCardLifted.tsx) is
   * this function's intended caller; wiring that call site into a real
   * ShadowState owner is a later (T7/smoke-gate) integration task — this hook
   * only builds the tested contract.
   */
  setCustomText: (text: string | null) => void
}

export function useShadowRuntime(args: UseShadowRuntimeArgs): ShadowRuntime {
  // WEB-SEAM: cue-shape adapter — applied HERE, at the call site into
  // useAnnotations/useShadowLoopCoordinator (both expect desktop-shaped Cue).
  const desktopCues = useMemo(() => toDesktopCues(args.liveCues), [args.liveCues])

  const annotations = useAnnotations(args.videoId, desktopCues, args.currentTime)

  const recorderRef = useRef(args.recorder)
  recorderRef.current = args.recorder

  // D2 seam (T-RULE): live refs for pieces the onLoopBoundary wrapper below
  // needs without going stale between renders (same idiom as recorderRef
  // above), WITHOUT forcing the wrapper's own identity to churn every
  // render — useWorkspace keys an effect off onLoopBoundary's identity
  // (useWorkspace.ts), so recreating it every render would re-run that
  // effect needlessly.
  const getShadowStateRef = useRef(args.getShadowState)
  getShadowStateRef.current = args.getShadowState
  // T5: same live-ref idiom — setCustomText (below) reads the LATEST setter
  // without forcing its own identity to churn on every render.
  const setShadowStateRef = useRef(args.setShadowState)
  setShadowStateRef.current = args.setShadowState
  const onRuleDecisionRef = useRef(args.onRuleDecision)
  onRuleDecisionRef.current = args.onRuleDecision
  // D2 seam (T-RULE): resolved loop/advance settings snapshotted at the
  // MOST RECENT onArm — mirrors exactly what the coordinator itself
  // snapshots into armedLoopingRef/armedGradingRef at the same call (see
  // useShadowLoopCoordinator.ts onArm), since the coordinator does not
  // expose those refs externally and this task must not add a getter to
  // it. Known gap (documented, not a behaviour change): if a future toggle
  // task calls the coordinator's setArmedLooping/setArmedGrading mid-run,
  // THIS snapshot won't observe that live flip — only onArm refreshes it.
  // Not reachable today: no caller wires that toggle UI yet (separate,
  // later task per the T-RULE brief).
  const armedRuleCtxRef = useRef<LoopRuleCtx | null>(null)

  // Answer-seam (T-ANS): id of the exercise the coordinator most recently
  // armed. `finalizeLoop`'s signature (`(signal) => Promise<string|null>`)
  // carries no exerciseId — the coordinator never passes one in — so the
  // AnswerSource adapter below needs a way to read "which exercise is this
  // for" LAZILY, at call time (finalizeLoop is invoked asynchronously, well
  // after onArm ran). Set on every onArm (including re-arms of the same id,
  // harmless); never cleared on leave — finalizeLoop is only ever invoked
  // from inside startEval, which itself only runs while an exercise is
  // armed, so staleness cannot outlive a single eval cycle.
  const armedExerciseIdRef = useRef<string | null>(null)

  // T3 (hold-render + B4-резюм, class-3 lifecycle — audit/24): built ENTIRELY
  // in this composition layer. The worktree coordinator's hold-machinery was
  // read first per task-T3-brief.md's instruction ("ПЕРВЫМ ДЕЛОМ прочитай
  // РЕАЛЬНУЮ hold/resume-машинерию") — it emits `hold` (apply()'s else-
  // branch) verbatim but has NEITHER a `heldRef` NOR a `resumeFromHold` of
  // its own (checked directly against anki_conf-shadowing-fix's
  // useShadowLoopCoordinator.ts — identical to the lifted copy here); both
  // are net-new, built as a seam consuming the coordinator's own emits/
  // actuators, WITHOUT touching its body (see resumeFromHold below for the
  // one place that reuses `onLeave` instead of reimplementing cleanup).
  const heldRef = useRef(false) // синхронный источник истины (isHeld/resumeFromHold читают ЕГО)
  const heldExerciseIdRef = useRef<string | null>(null)
  const [holding, setHoldingState] = useState(false) // React state — только ре-рендер UI
  const [evalOverlayVisible, setEvalOverlayVisible] = useState(false)
  const [verdictOutcome, setVerdictOutcome] = useState<AnswerOutcomeEvent | null>(null)
  // T7 (N2 — "снапшоти target в момент committed"): the effective target
  // text `targetTextForExercise(lastArmedExerciseRef.current)` resolved to
  // AT THE MOMENT handleAnswerOutcome accepts an outcome — set in the SAME
  // handler, alongside `setVerdictOutcome`, so the two are ALWAYS a
  // consistent pair for a given render (never a race between "verdict
  // arrived" and "snapshot arrived a tick later"). A render layer
  // (ShadowHoldOverlay) computes its word-diff against THIS value, never
  // against a live `targetTextForExercise` call — if the loop has since
  // moved on (new A-B/subtitle/customText), this snapshot still reflects
  // what was actually on screen when the user spoke this attempt. Cleared
  // in lockstep with verdictOutcome (loop-boundary/arm, see handleLog).
  const [verdictTargetSnapshot, setVerdictTargetSnapshot] = useState<string | null>(null)
  // Forward-ref idiom (same as wsActuatorsRef elsewhere in this file):
  // handleAnswerOutcome (below) is built and wired into `finalizeLoop`
  // BEFORE `coordinator` exists (finalizeLoop feeds coordinatorArgs, which
  // constructs it) but needs `coordinator.armedSegmentId()` — the LIVE
  // source of truth for "is anything armed right now" (returns null once a
  // run has fully ended, unlike armedExerciseIdRef which is deliberately
  // never cleared — see that ref's own doc above). Populated right after
  // construction, read only inside the async callback (well after mount).
  const coordinatorRef = useRef<ShadowLoopCoordinator | null>(null)

  // T4 — ЭФЕМЕРНЫЙ арм (или null). ТОТ ЖЕ объект, что лежит в coordinator
  // .armedExerciseRef после armRange (одна ссылка, без клона — критично для T5).
  // Объявлен ЗДЕСЬ (а не рядом с armRange ниже), чтобы resumeFromHold (spec#1-fix)
  // мог обнулять его синхронно, не полагаясь на побочный ре-рендер lifecycle-эффекта.
  const ephemeralArmRef = useRef<ShadowExerciseAnnotation | null>(null)

  // T5 (§4 variant a, PERSISTED path) — the exact object reference passed to
  // THIS hook's own `onArm` wrapper (below), for ANY arm (ephemeral or
  // persisted — set unconditionally there). Needed because
  // `annotations.shadowExercises.find(armedId)` stops being a reliable way to
  // reach "the object the coordinator's armedExerciseRef holds" after the
  // FIRST setCustomText→updateShadowExercise call on a given arm cycle:
  // updateShadowExercise persists IMMUTABLY (splices a brand-new object into
  // the array), so a SECOND `.find()` inside the same cycle would return that
  // NEW (already-superseded, from the coordinator's point of view) object
  // instead of the one the coordinator is still holding — a second customText
  // edit would then land on a dead object no eval ever reads, exactly the
  // class of staleness bug BL1 describes for `updateShadowExercise` itself.
  // Caching the reference here at arm-time (once) and reusing it on every
  // subsequent setCustomText call sidesteps that: it is always the SAME
  // object the coordinator captured into its own armedExerciseRef, regardless
  // of how many times WE have since replaced the array entry.
  const lastArmedExerciseRef = useRef<ShadowExerciseAnnotation | null>(null)

  // F1(б)-fix / T4-fix2: live-ref на КОМПОЗИЦ-ОННЫЙ onLeave (тот, что чистит hold по
  // id + делегирует координаторскому onLeave). Нужен ДВУМ потребителям со стабильными
  // deps: lifecycle-эффекту (:838) и seek-observer'у (ниже). Объявлен ЗДЕСЬ, ВЫШЕ
  // самого onLeave — заполняется присваиванием после его определения (:627).
  const onLeaveRef = useRef<((armedId: string) => void) | null>(null)

  // ── T4-fix2 [F3-FORWARD] — ЭФЕМЕРНЫЙ seek-observer (СИНХРОННЫЙ escape при user-сике) ──
  //
  // ПРОБЛЕМА (адверсариал, форвард-половина F3): lifecycle tick-effect (:794) НЕ ловит
  // user-сик ВПЕРЁД за end. Координаторский G5 (useShadowLoopCoordinator.ts :676-699),
  // keyed на ТОМ ЖЕ args.currentTime, объявлен ВЫШЕ по телу (coordinator вызван :577) →
  // его эффект отрабатывает РАНЬШЕ tick-effect на одном коммите. На тике сика G5 видит
  // getCurrentTime>=endTime → pauseVideo + seek(end-0.1) + startEval (evalInFlight=true)
  // ПЕРВЫМ; когда затем бежит tick-effect, он (а) видит клампнутый t ВНУТРИ диапазона
  // (left=false), (б) упирается в eval-гейт → арм НЕ снимается → эфемерный+hold залипают,
  // юзера yank'нуло назад к B. Backward-сик (t<start) уже закрыт (G5 молчит при t<end).
  //
  // РЕШЕНИЕ: перехватываем сик СИНХРОННО, в момент вызова seek, ДО того как изменение
  // currentTime породит ре-рендер/эффекты (значит ДО G5-тика). Все user-сики
  // (useHotkeys arrow/ctrl-arrow, timeline/WorkspacePanel scrub) идут через ОДИН
  // chokepoint — adapter.seek; координаторские внутренние сики (G5-кламп end-0.1, onArm
  // seek к rangeStart) — через coordinatorArgs.seek. Обе точки указывают на observedSeek.
  // Единственный ДИСКРИМИНАТОР — ЦЕЛЬ сика: ВНЕ [start,end) = уход юзера (escape, решение
  // владельца); ВНУТРИ = внутренний кламп/рестарт/arm-seek → no-op. Флагов «internal
  // seek» НЕ нужно — цель их естественно разводит (G5 всегда клампит ВНУТРЬ, :695).
  const maybeReleaseEphemeralOnSeek = useCallback((target: number) => {
    const ex = ephemeralArmRef.current
    if (!ex) return // нет эфемерного (persisted-арм ведёт autostart-reducer) → обычный сик
    const c = coordinatorRef.current
    // eval-гейт (паритет F1/F2): во время активной оценки видео на паузе у B — user-сик
    // туда не идёт, а если и пришёл — не рвём eval мид-полётом. Сик всё равно исполнится.
    if (c?.isEvalInFlight()) return
    // ЦЕЛЬ ВНУТРИ [start,end) = внутренний кламп (G5 seek(end-0.1)) / рестарт (seek к
    // rangeStart) / arm-seek → НЕ уход. ЦЕЛЬ ВНЕ (вперёд t>=end ИЛИ назад t<start) =
    // user-escape. Дискриминатор по ЦЕЛИ (не по reported time) → EPS не нужен: цель
    // точна (G5-кламп = max(start,end-0.1) строго < end; seek(A) = ровно start).
    if (target >= ex.startTime && target < ex.endTime) return
    // Synchronous teardown ПЕРЕД возвратом из обёртки. Делегируем композиц-онному onLeave
    // (он чистит hold по id) → координаторскому onLeave (снимает арм / endRun-restore).
    // Ref обнуляем ТОЛЬКО если координатор РЕАЛЬНО снял арм (armedSegmentId сменился) —
    // паритет с tick-effect (:837): иначе ref/координатор рассинхрон, а §1.3-гард
    // handleShadowKey принял бы ещё-армленный эфемерный за persisted (S стал бы no-op).
    onLeaveRef.current?.(ex.id)
    if (c?.armedSegmentId() !== ex.id) ephemeralArmRef.current = null
  }, [])

  // Обёрнутый seek — ЕДИНЫЙ chokepoint. Сначала СИНХРОННЫЙ escape-перехват (снимет
  // эфемерный ДО G5-тика, если цель вне диапазона), затем реальный adapter.seek.
  // Возвращается из хука как `seek`: будущий caller (PlayerPage) ОБЯЗАН развести ВСЕ
  // user-сик-источники через НЕГО. useWorkspace-внутренние сики (loop-boundary seek(A),
  // restart seek(rangeStart)) идут через свой adapter.seek и НЕ наблюдаются — но все
  // целятся ВНУТРЬ диапазона, поэтому инертны для дискриминатора и без наблюдения.
  const observedSeek = useCallback((target: number) => {
    maybeReleaseEphemeralOnSeek(target)
    args.seek(target)
  }, [maybeReleaseEphemeralOnSeek, args.seek])

  const clearHold = useCallback(() => {
    heldRef.current = false
    heldExerciseIdRef.current = null
    setHoldingState(false)
  }, [])

  // T3: wraps the caller's own `log` — always forwarded unchanged (that
  // channel's own contract, e.g. tracing/tests, is untouched) — and drives
  // hold/eval render-state from the coordinator's VERBATIM emits. Class-3
  // (audit/24): 'eval-start' is the only observable proxy for "startEval
  // just ran" (the coordinator doesn't expose a separate hook for that
  // moment) — clearing the hold here is what stops a re-score (incl. one
  // that ends in a PASS verdict) from leaving a phantom hold armed for a
  // later resumeFromHold() to wrongly fire on. 'arm'/'deactivate' cover
  // onArm/onLeave via the log channel; the onArm/onLeave wrappers further
  // below ALSO clear directly (belt-and-suspenders — onArm's own
  // evalInFlightRef re-arm guard, useShadowLoopCoordinator.ts :336, returns
  // before emitting 'arm' at all in one specific re-entry case, though that
  // case cannot itself overlap with a hold — evalInFlightRef is always
  // false while held).
  //
  // T3-fix (FIX A [CRIT]): verdictOutcome used to be cleared on 'eval-start'
  // too. But in the answerSource path, 'eval-start' is emitted AFTER the
  // finalizeLoop flush resolves (useShadowLoopCoordinator.ts startEval's
  // `a.finalizeLoop(...).then(...)` branch, :607-641) — and
  // finalizeLoopFromAnswerSource's `onOutcome` (answer-source.ts :316,
  // wired to handleAnswerOutcome below) fires BEFORE that same promise
  // resolves. So 'eval-start' for THIS eval landed strictly after
  // handleAnswerOutcome had already set verdictOutcome for THIS SAME
  // attempt — clearing it there wiped the verdict the instant it appeared,
  // before any render could show it (the CRIT bug: verdictOutcome was
  // always null in practice). Fixed by moving the clear to the START of a
  // new attempt instead: 'loop-boundary' (emitted synchronously, BEFORE
  // startEval/finalizeLoop even begin — see useShadowLoopCoordinator.ts
  // onLoopBoundary :663 / G5 :697) and onArm (a brand new exercise/run).
  // Both fire strictly BEFORE this attempt's own outcome can arrive, so the
  // outcome that lands later in the SAME attempt survives until the NEXT
  // loop-boundary/arm, exactly long enough to render.
  const handleLog = useCallback((e: ShadowRtEvent) => {
    switch (e.event) {
      case 'hold':
        heldRef.current = true
        heldExerciseIdRef.current = e.exId ?? null
        setHoldingState(true)
        break
      case 'loop-boundary':
        // T3-fix (FIX A): new attempt starting — the PREVIOUS attempt's
        // verdict is no longer current. Must run before startEval/
        // finalizeLoop even begin (see doc above), so it can never race
        // this attempt's own outcome.
        setVerdictOutcome(null)
        // T7 (N2): the target snapshot belongs 1:1 to the verdict it was
        // taken for — clear it in lockstep so a NEW attempt never renders
        // against a stale snapshot from the PREVIOUS one.
        setVerdictTargetSnapshot(null)
        break
      case 'eval-start':
        clearHold()
        setEvalOverlayVisible(true)
        break
      case 'eval-end':
        setEvalOverlayVisible(false)
        break
      case 'arm':
        clearHold()
        setVerdictOutcome(null)
        setVerdictTargetSnapshot(null)
        break
      case 'deactivate':
      case 'advance':
      case 'restart':
      case 'complete':
        clearHold()
        break
      default:
        break
    }
    args.log?.(e)
  }, [args.log, clearHold])

  // T5 (BL1 mode-gate — task-T5-brief.md §2, desktop canon ShadowChat.tsx
  // ~:700 "effectiveTarget"): customText wins over the subtitle-derived text
  // when mode==='custom' and non-empty ("текст важнее субтитра"). Reads
  // `ex.settings` off the SAME object the coordinator holds in its own
  // armedExerciseRef snapshot (startEval calls `target =
  // a.targetTextForExercise(ex)` with that exact, un-cloned `ex` —
  // useShadowLoopCoordinator.ts :470) — NOT a fresh getExercises() lookup —
  // which is exactly what lets setCustomText's in-place mutation (ephemeral
  // AND persisted paths, below) reach the advance-gate with ZERO changes to
  // the coordinator file itself. Before T5 this function ignored
  // settings.mode/customText entirely (cue-concatenation only) — that gap is
  // what BL1 flagged as "one resolve point doesn't cover everything".
  //
  // T7 (moved up, unchanged body): now ALSO called from handleAnswerOutcome
  // below (N2 snapshot) — must be defined before that callback references
  // it (JS `const` TDZ; both live in the same function body).
  const targetTextForExercise = useCallback((ex: ShadowExerciseAnnotation) => {
    if (ex.settings.mode === 'custom' && ex.settings.customText && ex.settings.customText.trim() !== '') {
      return ex.settings.customText
    }
    return desktopCues
      .filter(c => c.startTime >= ex.startTime - 0.05 && c.endTime <= ex.endTime + 0.05)
      .map(c => c.text).join(' ')
  }, [desktopCues])

  // T3 (carry T-ANS/F3): filters a stale AnswerOutcomeEvent (belongs to an
  // exercise the loop has already moved on from — see hold-render.ts doc for
  // exactly which race this catches, distinct from the answer-seam's own
  // signal.aborted gate) BEFORE it becomes render state. The caller's own
  // `onAnswerOutcome` (if any) still receives EVERY event, filtered or not —
  // that channel's contract (logging/telemetry/whatever) is a separate
  // concern from this hook's render-state.
  const handleAnswerOutcome = useCallback((e: AnswerOutcomeEvent) => {
    const currentId = coordinatorRef.current?.armedSegmentId() ?? null
    const filtered = filterAnswerOutcomeForRender(e, currentId)
    if (filtered) {
      setVerdictOutcome(filtered)
      // T7 (N2): snapshot the effective target THIS attempt was actually
      // spoken against, synchronously, in the SAME handler that accepts the
      // outcome — `lastArmedExerciseRef.current` is guaranteed to still be
      // the exercise `filtered` belongs to (armedExerciseIdRef/
      // lastArmedExerciseRef are only ever reassigned by the NEXT onArm,
      // which also clears verdictOutcome first — see handleLog/onArm), so
      // there is no window where this reads a wrong/newer exercise.
      const armedEx = lastArmedExerciseRef.current
      setVerdictTargetSnapshot(armedEx ? targetTextForExercise(armedEx) : null)
    }
    args.onAnswerOutcome?.(e)
  }, [args.onAnswerOutcome, targetTextForExercise])

  // WEB-SEAM: onLoopRestart → recorder rearm (T2-carry a). Desktop canon:
  // onLoopRestart is wired to `rearmRecording` (index.tsx:1392/1402) — it
  // re-arms the MediaRecorder for the NEXT loop iteration so a second
  // attempt doesn't append onto attempt #1's stale row. `recorder.start()`
  // IS that rearm operation (T-A's LoopRecorder doc: "arms a new
  // MediaRecorder for the next loop iteration").
  const onLoopRestart = useCallback(() => {
    recorderRef.current?.start()
  }, [])

  // T2-fix (audit CONFIRMED part b — cancellation): tracks the cancel fn of
  // the LAST guarded (deferred) restoreWorkspace call, if any is still
  // pending. Cancelled (a) on unmount — a torn-down runtime must not call
  // into a dead workspace from a macrotask that outlives it; (b) whenever a
  // NEWER restoreWorkspace call comes in (trustExtent onArm OR another
  // guarded endRun) — a stale deferred restore firing after a fresher one
  // has already applied would stomp it.
  const pendingRestoreCancelRef = useRef<(() => void) | null>(null)
  const cancelPendingRestore = useCallback(() => {
    pendingRestoreCancelRef.current?.()
    pendingRestoreCancelRef.current = null
  }, [])
  useEffect(() => cancelPendingRestore, [cancelPendingRestore])

  const evalIdForExercise = useCallback((ex: ShadowExerciseAnnotation) =>
    `${args.videoId || 'unknown'}#${ex.subIndex ?? Math.round(ex.startTime)}`,
  [args.videoId])

  // Answer-seam (T-ANS, D3): when an AnswerSource is supplied, build the
  // coordinator's `finalizeLoop` slot from it via the adapter in
  // answer-source.ts. `getExerciseId` reads armedExerciseIdRef LAZILY (see
  // its doc above) rather than closing over a snapshot — finalizeLoop can be
  // (re)constructed every render (cheap closures), but the coordinator only
  // ever reads the LATEST one via its own argsRef, so no staleness risk.
  // Left `undefined` when no answerSource is given — the coordinator then
  // takes its untouched legacy path (archiveShadowLoop buffer, see below).
  const finalizeLoop = args.answerSource
    ? finalizeLoopFromAnswerSource(
        args.answerSource,
        () => {
          // FIX F6 [LOW]: this fallback firing means armedExerciseIdRef was
          // never set before finalizeLoop was invoked (invariant violation —
          // onArm always sets it first, see the ref's doc above). Silently
          // substituting videoId used to mis-attribute the answer to the
          // wrong exerciseId with no trace; warn instead so a real Ф2 source
          // (which correlates ASR sessions by exerciseId) doesn't silently
          // eat a mismatch.
          if (armedExerciseIdRef.current == null) {
            console.warn(
              '[useShadowRuntime] answer-seam: finalizeLoop invoked with no armed exerciseId — falling back to videoId',
              args.videoId,
            )
          }
          return armedExerciseIdRef.current ?? args.videoId
        },
        args.answerBudgetMs ?? DEFAULT_ANSWER_BUDGET_MS,
        // T3 (carry T-ANS/F3): filters stale outcomes before they become
        // render state; still forwards every event to args.onAnswerOutcome
        // untouched (see handleAnswerOutcome's own doc above).
        { onOutcome: handleAnswerOutcome },
      )
    : undefined

  const coordinatorArgs: UseShadowLoopCoordinatorArgs = {
    currentTime: args.currentTime,
    getCurrentTime: args.getCurrentTime,
    getExercises: () => annotations.shadowExercises,
    getShadowState: args.getShadowState,
    getWorkspaceSnapshot: () => args.wsActuatorsRef.current?.getWorkspaceSnapshot() ?? EMPTY_SNAPSHOT,
    restoreWorkspace: (p) => {
      const a = args.wsActuatorsRef.current
      // T2-fix (audit LIGHT — ref-fill hardening): was a silent `if (!a)
      // return`. By the time ANY restoreWorkspace call reaches here, the
      // coordinator (onArm or endRun) has already mutated its own internal
      // state (armedExerciseRef/runActiveRef/snapshotRef) — a swallowed call
      // here means that state is now out of sync with the real workspace
      // with no trace left behind. Surface it instead of hiding it.
      if (!a) {
        console.warn('[useShadowRuntime] restoreWorkspace called before wsActuatorsRef was populated — dropped', p)
        return
      }
      // Any new restoreWorkspace call (immediate arm OR another guarded
      // endRun) supersedes whatever guarded restore is still pending from a
      // PRIOR call — see cancelPendingRestore's doc comment above.
      cancelPendingRestore()
      if (p.trustExtent) {
        // useShadowLoopCoordinator has exactly two restoreWorkspace call
        // sites (onArm :339 and endRun :282) and `trustExtent: true` is set
        // ONLY by onArm — a fresh exercise arm is never preceded by
        // resumeFromBoundary('advance') in the same synchronous tick, so the
        // batch-trap hazard below doesn't apply here. Apply immediately —
        // deferring would needlessly delay every exercise arm by a tick.
        //
        // trustExtent is ALSO (ab)used here as the onArm-vs-endRun call-site
        // discriminator (see useShadowLoopCoordinator.ts onArm :371 comment)
        // — if a future change ever makes endRun pass trustExtent:true too,
        // this branch silently starts skipping the guard for endRun's
        // restore and the original batch-trap hazard comes back unnoticed.
        a.restoreWorkspace(p)
        return
      }
      // WEB-SEAM: batch-trap guard (T2-carry b) — endRun's restore call
      // (never sets trustExtent) CAN land in the same synchronous batch as a
      // preceding resumeFromBoundary('advance') — see restore-batch-guard.ts.
      // getCurrentTime is threaded through so the deferred callback re-checks
      // the LIVE playhead before reinstating `looping: true` (staleness fix,
      // audit CONFIRMED part a) instead of trusting the pre-defer snapshot.
      pendingRestoreCancelRef.current = guardedRestoreWorkspace(a.restoreWorkspace, p, args.getCurrentTime)
    },
    resumeFromBoundary: (action) => { args.wsActuatorsRef.current?.resumeFromBoundary(action) },
    deactivateWorkspace: () => { args.wsActuatorsRef.current?.deactivateWorkspace() },
    // T4-fix2: координатор сикает через ТОТ ЖЕ observedSeek — единый chokepoint. Его
    // сики (G5-кламп end-0.1 :695, onArm seek к rangeStart :391) целятся ВНУТРЬ
    // диапазона → observedSeek их не трогает (дискриминатор), просто исполняет.
    seek: observedSeek,
    countdownThenPlay: (s) => {
      const a = args.wsActuatorsRef.current
      // T2-fix (audit LIGHT — ref-fill hardening): see the restoreWorkspace
      // wrapper above for why this used to be a silent optional-chain no-op.
      if (!a) {
        console.warn('[useShadowRuntime] countdownThenPlay called before wsActuatorsRef was populated — dropped')
        return
      }
      a.countdownThenPlay(s)
    },
    pauseVideo: args.pauseVideo,
    // WEB-SEAM: archiveShadowLoop still has no useShadow-equivalent source
    // on web (not lifted — see task-T2-report.md); always null. Separate
    // concern from answer-seam (T-ANS) below: when `finalizeLoop` IS
    // supplied (answerSource given), the coordinator's startEval takes the
    // finalizeLoop branch and never reads this stub's return value — it's
    // still CALLED unconditionally (deferScore side-effect), just no longer
    // on the path that decides what to score. Only matters again once a
    // real useShadow-port lands (unrelated future task), so runEval's
    // '(empty)' fallback stays reachable only on the legacy (no answerSource)
    // path.
    archiveShadowLoop: () => null,
    evaluate: args.evaluate,
    evalTimeoutMs: args.evalTimeoutMs,
    // Answer-seam (T-ANS, D3): wired via the AnswerSource adapter above.
    // `undefined` when no answerSource is supplied — coordinator's legacy
    // synchronous path (archiveShadowLoop buffer) takes over unchanged.
    finalizeLoop,
    targetTextForExercise,
    evalIdForExercise,
    // T3: handleLog drives hold/eval render-state off the coordinator's
    // VERBATIM emits, then always forwards to args.log unchanged.
    log: handleLog,
  }

  const coordinator = useShadowLoopCoordinator(coordinatorArgs)
  // T3: populate the forward-ref (see coordinatorRef's doc above) — read
  // only inside handleAnswerOutcome's async callback, well after this render.
  coordinatorRef.current = coordinator

  // Answer-seam (T-ANS): record which exercise is armed BEFORE delegating
  // to the coordinator's own onArm, so `finalizeLoop`'s lazy
  // `getExerciseId()` above always reflects the exercise the coordinator is
  // currently evaluating (see armedExerciseIdRef's doc comment).
  const onArm = useCallback((ex: ShadowExerciseAnnotation) => {
    armedExerciseIdRef.current = ex.id
    // T5 (§4 variant a): cache the EXACT object handed to coordinator.onArm
    // below — see lastArmedExerciseRef's own doc for why setCustomText needs
    // this instead of re-deriving it from annotations.shadowExercises on
    // every call.
    lastArmedExerciseRef.current = ex
    // T3 (class-3, audit/24): any onArm — fresh exercise OR a re-arm of the
    // SAME id while held (segEndHandledRef resets to false on hold, so the
    // playhead re-entering the tail region can trigger exactly this) —
    // supersedes whatever was held; a stale hold surviving a re-arm is the
    // phantom-resume bug this fix closes. Direct clear here is
    // belt-and-suspenders with the 'arm' case in handleLog above (that one
    // is skipped by the coordinator's own evalInFlightRef re-arm guard in
    // one specific case, though that case can't itself overlap with a hold).
    clearHold()
    setVerdictOutcome(null)
    // D2 seam (T-RULE): snapshot the resolved loop/advance settings for the
    // NEWLY armed exercise, mirroring exactly the classification the
    // coordinator's own onArm derives into armedLoopingRef/armedGradingRef
    // (useShadowLoopCoordinator.ts) — see armedRuleCtxRef's doc above for
    // why this is a snapshot rather than a live read of the coordinator.
    const resolved = effectiveShadowSettings(ex, getShadowStateRef.current())
    armedRuleCtxRef.current = {
      loopMode: resolved.loopMode === true,
      advanceEnabled: resolved.advanceEnabled === true,
      advanceThreshold: resolved.advanceThreshold,
    }
    coordinator.onArm(ex)
  }, [coordinator, clearHold])

  // T3 (class-3, audit/24): onLeave wrapper — clears any hold that belonged
  // to the exercise actually being left (id match; a hold only ever exists
  // for the CURRENTLY armed exercise, so this is equivalent to an
  // unconditional clear in practice, but the guard avoids wiping an
  // unrelated hold if onLeave is ever called with a stale/foreign id — the
  // coordinator's own onLeave has its own `armedExerciseRef.current?.id !==
  // armedId` no-op guard for exactly that kind of stale call).
  const onLeave = useCallback((armedId: string) => {
    if (heldExerciseIdRef.current === armedId) clearHold()
    coordinator.onLeave(armedId)
  }, [coordinator, clearHold])
  // F1(б)-fix / T4-fix2: live-ref на onLeave, чтобы lifecycle-эффект И seek-observer
  // НЕ зависели от меняющейся идентичности onLeave (та churn'ится каждый рендер вместе
  // с coordinator). Оба зовут onLeaveRef.current — deps остаются стабильными. Сам ref
  // ОБЪЯВЛЕН ВЫШЕ (рядом с ephemeralArmRef) — seek-observer'у он нужен раньше по телу.
  onLeaveRef.current = onLeave

  // T3 (class-3, audit/24): setArmedGrading(false) while held must release
  // the hold — otherwise turning auto-advance OFF mid-hold leaves heldRef
  // true for a resumeFromHold() call that no longer has anything grading to
  // resume from (the coordinator's OWN setArmedGrading has no heldRef to
  // clear; this hook's is the only one that exists — see file-top doc).
  const setArmedGrading = useCallback((v: boolean) => {
    coordinator.setArmedGrading(v)
    if (!v) clearHold()
  }, [coordinator, clearHold])

  const isHeld = useCallback(() => heldRef.current, [])

  // T3/T4 seam (B4-резюм): see ShadowRuntime.resumeFromHold's doc above for
  // why `coordinator.onLeave` is the reused cleanup actuator instead of a
  // reimplementation.
  //
  // T3-fix (FIX B [HIGH]): heldRef stays true from the PREVIOUS hold across
  // the ~3s window between startEval setting evalInFlightRef=true
  // SYNCHRONOUSLY (useShadowLoopCoordinator.ts startEval :466) and
  // 'eval-start' finally clearing heldRef (handleLog above) — which, in the
  // answerSource path, only fires once finalizeLoop's flush resolves
  // (up to answerBudgetMs later). An S-press landing in that window used to
  // read a stale heldRef=true and fire resumeFromBoundary('advance') +
  // onLeave MID-eval#2 — advancing the workspace while a second scoring
  // attempt is still in flight, with the coordinator's OWN onLeave silently
  // no-op'd for the rest of that window (evalInFlightRef guard,
  // useShadowLoopCoordinator.ts onLeave :413) — i.e. a swallowed leave on
  // top of a spurious advance. Guarded on the coordinator's own LIVE
  // evalInFlightRef (isEvalInFlight — always on the coordinator's public
  // surface, ShadowLoopCoordinator interface) FIRST, before even consulting
  // heldRef: no-op the whole call while an eval owns the segment, held or
  // not. Not a coordinator change — this hook only reads its existing
  // getter.
  const resumeFromHold = useCallback(() => {
    if (coordinator.isEvalInFlight()) return // FIX B: eval in flight — no-op, not our turn
    if (!heldRef.current) return // item 3: no hold active → no-op
    const exId = heldExerciseIdRef.current
    clearHold()
    args.wsActuatorsRef.current?.resumeFromBoundary('advance')
    // C (design): S-skip from hold = skip, NOT session-complete; onLeave→
    // endRun(false) intentionally omits 'complete'. Revisit if a
    // complete-consumer needs it (needs coordinator method).
    if (exId != null) coordinator.onLeave(exId)
    // spec#1-fix: обнуляем ЭФЕМЕРНЫЙ арм СИНХРОННО здесь, а не полагаясь на
    // побочный ре-рендер lifecycle-эффекта (хрупко к будущей мемоизации
    // координатора). hold возникает только на армед-упражнении, а на web оно
    // всегда ЭФЕМЕРНОЕ (persisted-автостарт web-порт ещё не поставляет) — но
    // сверяем id на случай будущего persisted-hold, чтобы не снести чужой арм.
    if (exId != null && ephemeralArmRef.current?.id === exId) ephemeralArmRef.current = null
  }, [coordinator, clearHold])

  /**
   * S3-7-fix (blocker) — explicit user-close (RuntimeShadowCard's × / desktop
   * canon's ShadowChat onDeactivate → useShadow.ts's `deactivate`, useShadow.ts
   * :324) is NOT a loop-transient. The coordinator's OWN `onLeave`
   * (useShadowLoopCoordinator.ts, BYTE-IDENTICAL/untouched) intentionally
   * no-ops while the playhead sits inside the armed A-B range or just past its
   * end (`insideRegion`/`justPastEnd`, :427-441) — that gate exists to swallow
   * the loop's OWN seek(B)→seek(A) restart tick, not an explicit close click,
   * but it cannot distinguish the two from `armedId` alone. Since `loopMode`
   * defaults true (INITIAL_SHADOW_STATE) and the playhead is almost always
   * inside the armed range while looping, PlayerPage's old
   * `onClose => { const id = runtime.armedSegmentId(); if (id)
   * runtime.onLeave(id) }` was effectively a no-op in the default case — ×
   * did nothing (card stayed open, `active` stayed true).
   *
   * Composition, NOT a coordinator edit: `setArmedLooping` (F#3) is an
   * EXISTING public, live, ungated lever over `armedLoopingRef` — flipping it
   * to false BEFORE calling onLeave skips the `if (armedLoopingRef.current)`
   * block entirely, so onLeave falls straight to its unconditional tail
   * (clear armedExerciseRef/armedGradingRef/armedLoopingRef, emit
   * 'deactivate', endRun if nothing else is ahead — which itself calls
   * deactivateWorkspace()/restoreWorkspace(), stopping the loop in the common
   * "armed from idle" case this fix targets). No new gate, no new branch
   * added to the coordinator file — an existing public actuator is merely
   * composed in a different order, at this composition layer.
   *
   * No-ops while an eval owns the segment (`isEvalInFlight()`) — the SAME
   * invariant the coordinator's own onLeave enforces (evalInFlightRef guard),
   * and the one `isEvalInFlight`'s own doc above warns about verbatim
   * ("Обвязка useShadowAutoStart НЕ должна звать deactivateShadow в этом
   * окне — иначе мик/SSE/оверлей умирают мид-eval"): closing mid-eval is a
   * different, deliberately out-of-scope concern for this fix.
   */
  const deactivate = useCallback(() => {
    const id = coordinator.armedSegmentId()
    if (id == null) return // nothing armed — no-op
    if (coordinator.isEvalInFlight()) return // eval owns the segment — see doc above
    coordinator.setArmedLooping(false) // ungated lever: skips onLeave's loop-transient gate
    onLeave(id) // now falls through unconditionally to the coordinator's unarm/endRun tail
    // spec#1-fix parity (resumeFromHold, above): drop the ephemeral ref
    // synchronously too, instead of waiting for the lifecycle effect's next
    // args.currentTime tick to reconcile it (case (A) below).
    if (ephemeralArmRef.current?.id === id) ephemeralArmRef.current = null
  }, [coordinator, onLeave])

  // ── T4: hands-free S — ЭФЕМЕРНЫЙ арм + lifecycle ────────────────────────
  // ЭФЕМЕРНЫЙ арм = запуск shadowing «здесь и сейчас на готовом диапазоне», НЕ
  // создание persisted-упражнения. Живёт ТОЛЬКО в этом composition-слое; в
  // annotations НЕ пишется → autostart-редьюсер (tick.exercises) его не видит →
  // coordinator-onLeave сам НЕ фаернёт (G5 yank-back запарковал бы юзера к B из
  // любого места, audit/24). Значит снятие ведём мы, ЯВНО (lifecycle-эффект ниже).
  // ephemeralArmRef объявлен ВЫШЕ (рядом с coordinatorRef) — нужен resumeFromHold'у
  // для синхронного обнуления (spec#1-fix).
  // Монотонный счётчик id: КАЖДЫЙ арм получает уникальный id. Это гарантирует, что
  // coordinator.onArm НИКОГДА не уйдёт в ветку раннего выхода
  // `evalInFlight && armedExerciseRef.id === ex.id` (useShadowLoopCoordinator.ts
  // :336) — там он БЫ не записал наш объект в armedExerciseRef, и object-identity
  // (ephemeralArmRef.current === armedExerciseRef.current, критично для T5)
  // сломалась бы. Уникальный id ⇒ всегда полный re-arm ⇒ armedExerciseRef === ex.
  const ephemeralSeqRef = useRef(0)
  // Fresh-refs для event-driven handleShadowKey/armRange (без stale-замыкания и без
  // churn identity колбэков на ре-рендере — тот же идиом, что recorderRef выше).
  const liveCuesRef = useRef(args.liveCues); liveCuesRef.current = args.liveCues
  const getCurrentTimeT4Ref = useRef(args.getCurrentTime); getCurrentTimeT4Ref.current = args.getCurrentTime

  // T4 — ЭФЕМЕРНЫЙ арм по готовому [start,end]. Строит транзиентное range-упражнение
  // из ТЕКУЩИХ настроек ShadowState (hands-free уважает текущий loop/advance/engines),
  // кладёт в ephemeralArmRef и передаёт ТОТ ЖЕ объект в onArm.
  const armRange = useCallback((start: number, end: number) => {
    if (!(end > start)) return // невалидный диапазон — арма нет (паритет exerciseWorkspaceParams)
    const state = getShadowStateRef.current()
    const now = new Date().toISOString()
    const ex: ShadowExerciseAnnotation = {
      id: `ephemeral-${++ephemeralSeqRef.current}`,
      startTime: start,
      endTime: end,
      anchorMode: 'time-range', // «здесь и сейчас» — время-абсолютный слот, не subtitle-anchor
      settings: {
        loopMode: state.loopMode,
        advanceEnabled: state.advanceEnabled,
        advanceThreshold: state.advanceThreshold,
        mode: state.mode,
        customText: state.customText,
        saveAudio: state.saveAudio,
        engines: state.engines,
        documentPath: state.documentPath,
      },
      createdAt: now,
      updatedAt: now,
    }
    // §3.2 «новый S заменяет старый эфемерный»: НЕ зовём onLeave прежнего — это
    // сделало бы endRun→restoreWorkspace + ре-снимок ТЕКУЩЕГО (уже армленого)
    // workspace как «оригинала», затерев настоящий pre-shadow снимок. Полагаемся
    // на coordinator.onArm-supersede (он перезапишет armedExerciseRef новым
    // объектом; runActive остаётся true → оригинальный снимок цел). Просто
    // перезаписываем ref новым объектом.
    // T5: mutate ephemeralArmRef.current.settings in-place (same obj as coordinator armedExerciseRef)
    ephemeralArmRef.current = ex
    onArm(ex)
  }, [onArm])

  // T4 — ordered S-handler (см. ShadowRuntime.handleShadowKey doc для порядка).
  const handleShadowKey = useCallback(() => {
    // 1. resume-from-hold шов (T3/B4) — ПЕРВЫМ, ДО armedSegmentId-гарда, иначе
    //    hands-free тупик в hold (carry T3).
    if (heldRef.current && !coordinator.isEvalInFlight()) { resumeFromHold(); return }
    // 2. held ⇒ eval в полёте (шаг 1 не сработал) → no-op (carry T3 FIX B).
    if (heldRef.current) return
    // 2.5. F2-fix [HIGH]: eval в полёте БЕЗ hold (heldRef ещё false, но evalInFlight
    //      true — grading-эфемерный оценивается) → no-op. Без этого гейта не-held S
    //      проваливался в шаг 3 (armedSegmentId!=null && ephemeralArmRef set ⇒
    //      !ephemeral false ⇒ НЕ return) → armRange → re-arm с новым id → координатор
    //      убивал старый eval по id-сверке (:522/:523) → workspace оставался parked
    //      (restartingRef/parkedRef/15s-failsafe) → фантомный seek через 15с. Re-arm
    //      во время eval = запрещён; held-путь уже гейтит eval в шагах 1-2.
    if (coordinator.isEvalInFlight()) return
    // 3. живое PERSISTED-упражнение (автостарт) армлено → S не перехватывает.
    //    ephemeralArmRef различает автостарт (null) от нашего эфемерного (set) —
    //    armedSegmentId() ставится ЛЮБЫМ arm, поэтому им одним не различить.
    if (coordinator.armedSegmentId() != null && !ephemeralArmRef.current) return
    // 4/5/6. вычислить диапазон и armRange. t = adapter.currentTime() (живой).
    const t = getCurrentTimeT4Ref.current()
    const snap = args.wsActuatorsRef.current?.getWorkspaceSnapshot() ?? EMPTY_SNAPSHOT
    // 4. playhead ВНУТРИ активного A-B (rangeEnd>rangeStart) → армим весь A-B.
    if (snap.rangeEnd > snap.rangeStart && t >= snap.rangeStart && t < snap.rangeEnd) {
      armRange(snap.rangeStart, snap.rangeEnd)
      return
    }
    // 5. вне A-B, НА субтитре (cue-hit T1; web Cue уже {start,end}) → диапазон cue.
    const cues = liveCuesRef.current
    const idx = findCueIndexAtTime(t, cues)
    if (idx >= 0) { const c = cues[idx]; armRange(c.start, c.end); return }
    // 6. вне A-B, не на субтитре → no-op.
  }, [coordinator, resumeFromHold, armRange, args.wsActuatorsRef])

  const getEphemeralArm = useCallback(() => ephemeralArmRef.current, [])

  // ── T5 (D1 + BL1-delivery) — setCustomText: commit across ALL THREE paths ──
  //
  // task-T5-brief.md §2/§4: `effectiveShadowSettings(exercise, state)` (shadow-
  // settings.ts) is ONE resolve point that does NOT cover everything — with a
  // live exercise it reads ONLY exercise.settings (state ignored); without one
  // it reads state.customText. So, like the desktop advance-threshold slider
  // (dual-write state+exercise), THIS function writes every channel that can
  // currently be "the" source of truth for the exercise the user is looking
  // at:
  //
  //   1. ALWAYS — state dual-write (MANUAL path, no exercise armed at all):
  //      `effectiveShadowSettings`'s else-branch reads state.customText/mode
  //      directly, so this must land regardless of what's armed.
  //
  //   2. EPHEMERAL (T4 object-identity, the hands-free S path): armRange (see
  //      above) puts the SAME object into both `ephemeralArmRef.current` and
  //      the coordinator's own `armedExerciseRef` (via `coordinator.onArm(ex)`
  //      — no clone). Mutating `.settings` in place here means
  //      targetTextForExercise(ex)/effectiveShadowSettings(ex) — both read the
  //      coordinator's OWN ex snapshot (see targetTextForExercise's own doc
  //      above), not a fresh lookup — see the change immediately, with ZERO
  //      changes to useShadowLoopCoordinator.ts. CAVEAT (T4-carry, brief's own
  //      words): only when `armedSegmentId() === ephemeralArmRef.current.id` —
  //      in the advance-window `getEphemeralArm()`/`ephemeralArmRef` can be
  //      holding a DEAD object the coordinator has already moved past (see
  //      getEphemeralArm's own doc); mutating that stale object would be a
  //      silent no-op that never reaches anything live.
  //
  //   3. PERSISTED (§4 variant (a) — BL1-Q2's actual gap: `updateShadowExercise`
  //      replaces the array entry IMMUTABLY, but the coordinator's
  //      armedExerciseRef keeps the OLD snapshot, so `targetTextForExercise(ex)`
  //      would read stale data until the NEXT re-arm). The brief's variant (a)
  //      asks for "a getter that exposes the armed object, if the coordinator
  //      has one" — it does NOT (`ShadowLoopCoordinator` only exposes
  //      `armedSegmentId()`, an id — checked directly against the interface
  //      above and against useShadowLoopCoordinator.ts, no getter exists and
  //      none is added here). The equivalent WITHOUT a coordinator getter:
  //      `lastArmedExerciseRef` (declared above, populated by this hook's OWN
  //      `onArm` wrapper) caches the EXACT object `onArm`'s caller sourced from
  //      `annotations.shadowExercises` and handed to `coordinator.onArm(ex)`
  //      with no clone. Mutating THAT cached reference's `.settings` in place
  //      achieves the SAME effect a coordinator-side getter would, with the
  //      coordinator file untouched.
  //
  //      IMPORTANT (found while writing the integration test — NOT in the
  //      brief): the first version of this branch re-derived the object via
  //      `annotations.shadowExercises.find(armedId)` on every call instead of
  //      caching it. That works for exactly ONE setCustomText call per arm
  //      cycle — the immediate `updateShadowExercise` below splices a BRAND
  //      NEW object into the array (immutable-replace contract, unchanged),
  //      so a SECOND `.find()` in the SAME cycle returns that new (already
  //      superseded, from the coordinator's point of view) object instead of
  //      the one `armedExerciseRef` still holds — a second edit (e.g. edit →
  //      edit-again, or edit → clear) would land on a dead object no eval
  //      ever reads. Caching the reference ONCE at arm-time (lastArmedExerciseRef)
  //      and reusing it on every subsequent call sidesteps that entirely.
  //
  //      `updateShadowExercise` still persists immutably (existing store
  //      contract, unchanged) for durability across reloads/future re-arms —
  //      it swaps in a new object for FUTURE reads, but the in-place mutation
  //      already landed on the object the coordinator is STILL holding this
  //      cycle, so targetTextForExercise(ex) sees the change without waiting
  //      for a re-arm. No production caller arms a persisted exercise on web
  //      yet (autostart isn't wired — see this file's top doc), so today this
  //      path is only reachable via a caller that sources `ex` from
  //      `annotations.shadowExercises` and calls `onArm(ex)` directly (exactly
  //      what the test suite does) — but that IS the only sane way a future
  //      autostart caller would ever source an exercise for `onArm` either, so
  //      the identity assumption is not a test-only fiction.
  //
  // `text: null` (or empty/whitespace) clears → mode:'subtitle' in every
  // channel it touches, same as setting text does for 'custom'.
  const setCustomText = useCallback((text: string | null) => {
    const trimmed = text != null && text.trim() !== '' ? text : null
    const mode: ShadowMode = trimmed ? 'custom' : 'subtitle'

    // 1. ALWAYS.
    setShadowStateRef.current?.({ customText: trimmed ?? '', mode })

    const armedId = coordinatorRef.current?.armedSegmentId() ?? null
    const eph = ephemeralArmRef.current

    // 2. EPHEMERAL — only while it's still the one actually armed (caveat).
    if (eph && armedId === eph.id) {
      eph.settings.mode = mode
      eph.settings.customText = trimmed ?? undefined
      return
    }

    // 3. PERSISTED — armedId belongs to some OTHER (non-ephemeral) armed
    //    exercise: use the CACHED reference from arm-time (not a fresh array
    //    lookup — see the staleness note above), mutate in place, then
    //    persist immutably.
    if (armedId != null) {
      const armed = lastArmedExerciseRef.current
      if (armed && armed.id === armedId) {
        armed.settings.mode = mode
        armed.settings.customText = trimmed ?? undefined
        annotations.updateShadowExercise(armedId, { settings: { ...armed.settings } })
      }
    }
  }, [annotations])

  // T4 — ЭФЕМЕРНЫЙ LIFECYCLE (ЯВНЫЙ, §6.5 open-question).
  //
  // F1(б)-fix [CRIT] — ИНВАРИАНТ ДЕПОВ: эффект keyed СТРОГО на React-`args.currentTime`
  // — ТОТ ЖЕ 250мс-поллинг-тик (usePlayerState.ts:27-29), на который keyed и
  // координаторский G5 (:676-699). coordinator/onLeave читаются через СТАБИЛЬНЫЕ
  // рефы (coordinatorRef/onLeaveRef), а НЕ через deps — раньше в deps лежал целый
  // не-мемоизированный `coordinator`-литерал + меняющийся `onLeave`, из-за чего
  // эффект перезапускался на КАЖДЫЙ рендер (в т.ч. ASR-partial), читал ЖИВОЙ
  // getCurrentTime и при t>=endTime — ДО того как G5 (тоже на React-тике) успеет
  // выставить evalInFlight — звал onLeave → для НЕПЕТЛЕВОГО grading безусловный
  // teardown (justPastEnd-гард координатора :427 только для looping) → G5 видел
  // armedExerciseRef=null → оценки НЕ было. Теперь эффект тикает СИНХРОННО с G5
  // (один клок) и не реагирует на посторонний рендер. Порядок хуков гарантирует,
  // что G5 (объявлен в координаторе, вызванном ВЫШЕ по телу — :562) отрабатывает
  // РАНЬШЕ этого lifecycle-эффекта на одном и том же коммите (desktop: index.tsx:1623).
  //
  // Снятие эфемерного при ЛЮБОМ из:
  //   (A) reconcile — координатор ушёл вперёд/завершил (advance/complete/deactivate
  //       обнулили armedExerciseRef) → эфемерный устарел, чистим ref (case 3/4).
  //   (B) playhead-exit — ЗАМЕНА отсутствующего autostart-onLeave (case 1).
  // Новый S-арм (case 2) снятия тут НЕ требует: armRange перезаписывает ref, а
  // coordinator.onArm-supersede заменяет armedExerciseRef.
  useEffect(() => {
    const coordinator = coordinatorRef.current
    if (!coordinator) return
    const ex = ephemeralArmRef.current
    if (!ex) return
    // (A) координатор сам снял арм (advance/complete/deactivate) — ref устарел.
    if (coordinator.armedSegmentId() !== ex.id) { ephemeralArmRef.current = null; return }
    // (B) playhead-exit. Гейт eval: НЕ рвём во время активной оценки — иначе
    //     прервём eval. F3-fix [MED-HIGH]: `!heldRef` УБРАН из гейта. При ЛЕГИТ-hold
    //     playhead клампнут ВНУТРИ диапазона (G5 :695 seek(end-0.1)) → left=false и
    //     teardown НЕ триггерит сам по себе; `!heldRef` срабатывал ровно когда юзер
    //     СИКНУЛ ПРОЧЬ во время hold — а это случай, ТРЕБУЮЩИЙ teardown. Композиц-
    //     онный onLeave (:604-605) сам чистит hold по id.
    if (coordinator.isEvalInFlight()) return
    // Триггер эффекта — React-state args.currentTime (deps), но РЕШЕНИЕ о выходе
    // считаем по ЖИВОМУ getCurrentTime (как coordinator.onLeave внутри). Иначе
    // back-seek оставляет React-currentTime на миг ВЫШЕ живого времени → для
    // НЕПЕТЛЕВОГО эфемерного (у coordinator.onLeave нет justPastEnd-гарда) это
    // ложный «выход» и спурьёзный teardown только что созданного арма.
    const t = getCurrentTimeT4Ref.current()
    // «inside» с тем же ε, что reduceShadowAutoStart: seek(A) на рестарте петли
    // рапортует t на sub-frame < startTime — без ε это ложный «выход» → двойной
    // teardown/отсчёт (EXERCISE_START_EPS).
    //
    // F1(а)-fix [CRIT]: НЕ снимаем grading-эфемерный в justPastEnd-окне. Зеркалим
    // координаторский justPastEnd (:439) для НЕПЕТЛЕВОГО grading (у координаторского
    // onLeave такого гарда нет — :427 только для looping): если упражнение grading
    // (auto-advance, как классифицирует координатор :351-352) И
    // `endTime <= t < endTime+JUST_PAST_END_S` → НЕ звать onLeave, отдать G5 (он
    // оценит по концу отрезка). Снятие вперёд только когда playhead ЯВНО ушёл:
    // grading → t>=endTime+JUST_PAST_END_S; не-grading → сразу t>=endTime. Это
    // убирает гонку teardown↔G5 НЕЗАВИСИМО от того, чей клок быстрее.
    const resolved = effectiveShadowSettings(ex, getShadowStateRef.current())
    const grading = resolved.advanceEnabled === true && typeof resolved.advanceThreshold === 'number'
    const leftBack = t < ex.startTime - EXERCISE_START_EPS
    const leftAhead = grading ? t >= ex.endTime + JUST_PAST_END_S : t >= ex.endTime
    if (!leftBack && !leftAhead) return
    // Пробуем снять: coordinator.onLeave сам отсеет loop-boundary-транзиент
    // (justPastEnd 0.5s, useShadowLoopCoordinator.ts :439) и eval — реальный уход
    // юзера очистит арм. reconcile: null ref ТОЛЬКО если координатор ДЕЙСТВИТЕЛЬНО
    // снял (иначе транзиент → ref/coordinator рассинхрон, а §1.3-гард принял бы
    // эфемерный за persisted). Порядок: onLeave → сверить armedSegmentId → null.
    onLeaveRef.current?.(ex.id)
    if (coordinator.armedSegmentId() !== ex.id) ephemeralArmRef.current = null
  }, [args.currentTime])

  // D2 seam (T-RULE): fires checkRuleOnLoopExit for the CURRENTLY ARMED
  // exercise (armedRuleCtxRef, snapshotted in `onArm` above) BEFORE
  // delegating to the coordinator's real onLoopBoundary — which is called
  // unconditionally/unchanged right after. This seam only OBSERVES the
  // exit (matrix-cell + form-stub), it cannot and does not alter what the
  // coordinator decides to do about it (advance/restart/hold stays entirely
  // inside useShadowLoopCoordinator.ts, untouched).
  //
  // Guarded by `coordinator.armedSegmentId()` (a LIVE, coordinator-owned
  // truth about whether anything is armed right now) rather than trusting
  // armedRuleCtxRef alone: armedRuleCtxRef is never cleared on leave/endRun
  // (same rationale as armedExerciseIdRef above), so after a run ends a
  // stray onLoopBoundary call from an unrelated restored/ambient loop (see
  // useShadowRuntime.test.ts's batch-trap scenario) would otherwise fire a
  // decision for an exercise that is no longer armed. armedSegmentId()
  // returns null exactly when the coordinator itself has cleared the arm
  // (endRun), so this guard tracks the coordinator's real state.
  const onLoopBoundary = useCallback(() => {
    const armedId = coordinator.armedSegmentId()
    const ctx = armedRuleCtxRef.current
    if (armedId != null && ctx) {
      const decision = checkRuleOnLoopExit(ctx)
      onRuleDecisionRef.current?.(decision, armedId)
    }
    coordinator.onLoopBoundary()
  }, [coordinator.onLoopBoundary, coordinator.armedSegmentId])

  return {
    annotations,
    onLoopBoundary,
    shouldPauseAtBoundary: coordinator.shouldPauseAtBoundary,
    onLoopRestart,
    onArm,
    onLeave,
    deactivate,
    armedSegmentId: coordinator.armedSegmentId,
    setArmedLooping: coordinator.setArmedLooping,
    setArmedGrading,
    isEvalInFlight: coordinator.isEvalInFlight,
    holding,
    evalOverlayVisible,
    verdictOutcome,
    // T7 (N2): frozen target snapshot paired 1:1 with `verdictOutcome` — see
    // its own doc above (declared alongside verdictOutcome's useState).
    verdictTargetSnapshot,
    isHeld,
    resumeFromHold,
    handleShadowKey,
    armRange,
    getEphemeralArm,
    seek: observedSeek,
    setCustomText,
  }
}
