// useShadowMicStream.ts — S3-10 (phase ii, LAST build task of the slice).
// Wires the REAL microphone (getUserMedia → PCM16, audio-pipeline.ts) into
// RealtimeAnswerSource.pushAudio(exerciseId, Int16Array). This file adds NO
// coordinator/useShadowRuntime/RealtimeAnswerSource logic — it only decides
// WHEN to open/close a pipeline and forwards chunks, exactly like
// shadow-recorder.ts wraps createAudioPipeline for the (retired) V1 flow.
//
// 🔑 МИК-ГЕЙТ: `armedSegmentId()`, NOT React `active` state (carry S3-2/
// S3-6b). PlayerPage.tsx's own ShadowState.active is re-synced from
// `runtime.armedSegmentId()` by a no-deps `useEffect` that runs AFTER each
// render (see PlayerPage.tsx's "activate-on-arm" comment) — there is a
// window (documented there as up to ~250ms, one render tick) where `active`
// is stale-true while the coordinator has ALREADY unarmed. Gating
// getUserMedia on that stale flag would open the mic for a plain
// non-shadowing user during that window. `armedSegmentId()` itself
// (useShadowLoopCoordinator.ts:702, `useCallback(() => armedExerciseRef
// .current?.id ?? null, [])`) has no such lag: it is a STABLE-IDENTITY,
// ref-backed getter the coordinator writes synchronously on arm/unarm. This
// hook calls THAT directly, never the `active` prop.
//
// Detection mechanism: because armedSegmentId is a getter, not React state,
// there is nothing to put in a dependency array to react to its changes.
// PlayerPage.tsx already solved this exact problem for the `active` sync —
// this hook copies that idiom: a no-deps effect re-checks
// armedSegmentId() + realtimeEnabled + timelineCollapsed on EVERY commit and
// diffs against the last-known exercise id. Cheap when nothing changed (an
// early-return), and PlayerPage re-renders on every video-clock tick
// (currentTime), so the effective latency matches the existing
// active-sync's documented bound.
//
// 🔒 S3-10-fix (double-review: 2 HIGH + 1 MED, all real mic-privacy leaks):
//   FIX #1 [HIGH — disarm-without-render]: the render-effect above only runs
//     when PlayerPage commits. The coordinator's apply()/exerciseAhead branch
//     (useShadowLoopCoordinator.ts:565) nulls the arm with NO setState, so on
//     pause the effect never re-runs and the mic stays open indefinitely. Fix:
//     a React-independent setInterval (MIC_ARM_POLL_MS) that runs ONLY while a
//     pipeline is open, re-reads armedSegmentId() and reconciles — bounding the
//     post-unarm mic tail to ~150ms regardless of renders. Zero cost for a
//     non-shadowing user (the interval exists only while the mic is live).
//   FIX #2 [HIGH — ABA orphan]: the open reservation used to compare the STRING
//     exId, so collapse→uncollapse of the SAME id during a pending getUserMedia
//     let two resolves both pass the guard → orphaned stream, tracks never
//     stopped. Fix: a monotonic openSeq token — each open captures a generation;
//     any later open/close bumps it, so a stale pending resolve closes its own
//     stream instead of overwriting pipelineRef.
//   FIX #3 [MED — retry-storm]: on getUserMedia denial the reservation was
//     released, so every subsequent commit re-prompted. Fix: one-shot-per-arm —
//     the denied exId is remembered and not retried until the arm changes.
//
// Lifecycle (brief §Жизненный цикл, carry S3-9 dispose + S3-7 privacy):
//   • armedSegmentId() null→id (realtime on, timeline open) → open pipeline,
//     stream chunks into pushAudio(id, ...).
//   • id→null (unarm) or id→otherId (exercise change) → close the OLD
//     pipeline + answerSource.closeSession(oldId) BEFORE anything else (a
//     stray in-flight open for the old id is superseded, never leaks).
//   • timelineCollapsed→true → treated as unarmed for mic purposes (privacy:
//     PlayerPage's own comment notes collapsing only unmounts the CARD, the
//     coordinator arm is left intact — but the mic release here is
//     unconditional on collapse, independent of that visual/arm state).
//   • unmount → close whatever pipeline is open + answerSource.dispose()
//     (closes every session the source still holds — mirrors S3-9's own
//     dispose() semantics; guarantees zero leaked mic streams on teardown).
//   • Fake-режим (realtimeEnabled=false, prod default) → a pipeline is NEVER
//     created, regardless of arm/collapse — Fake does not consume audio and
//     the barrier forbids opening a mic that streams nowhere useful.
//
// Type note: `AnswerSource` (the interface the coordinator consumes) only
// declares `awaitAnswerByBoundary` — pushAudio/closeSession/dispose are
// RealtimeAnswerSource-specific. Rather than importing that concrete class
// here (this file should not need to know about WS/tickets), `isAudioSink`
// structurally narrows via the 3 methods it actually needs. This doubles as
// a defensive second gate alongside `realtimeEnabled`: even if the flag and
// the concrete answerSource instance ever disagree, a FakeAnswerSource
// (which has none of these methods) can never be pushed into or disposed.
import { useEffect, useRef } from 'react';
import { createAudioPipeline, type AudioPipeline } from '../workspace/audio-pipeline';
import type { AnswerSource } from '../workspace/answer-source';

export type MicPipelineFactory = (onChunk: (data: ArrayBuffer) => void) => Promise<AudioPipeline>;

// FIX #1: how often the React-independent watchdog re-reads armedSegmentId()
// while a pipeline is live. Matches the render-effect's documented latency
// bound (~one active-sync tick); the interval exists ONLY while the mic is open.
const MIC_ARM_POLL_MS = 150;

/** Structural subset of RealtimeAnswerSource this hook needs. */
export interface AudioSink {
  pushAudio(exerciseId: string, pcm: Int16Array): void;
  closeSession(exerciseId: string): void;
  /** ТЗ №4 п.3 [ID:P-tz4-fix HIGH-2]: soft pause — stop the transport but KEEP
   *  the session record / ConnectGate / dead-state / latestFinal (unlike
   *  closeSession's full teardown). Called on the transmit-off (video-pause) path. */
  suspendSession(exerciseId: string): void;
  dispose(): void;
}

function isAudioSink(x: unknown): x is AudioSink {
  const o = x as Partial<AudioSink> | null | undefined;
  return !!o
    && typeof o.pushAudio === 'function'
    && typeof o.closeSession === 'function'
    && typeof o.suspendSession === 'function'
    && typeof o.dispose === 'function';
}

export interface UseShadowMicStreamArgs {
  /** LIVE, ref-backed getter — pass `runtime.armedSegmentId` (coordinator.armedSegmentId) verbatim. */
  armedSegmentId: () => string | null;
  /** The SAME answerSource instance PlayerPage feeds the coordinator (selectAnswerSource()). */
  answerSource: AnswerSource;
  /** Build-time dev-switch (isRealtimeAnswerEnabled()) — false (Fake, prod default) never opens a pipeline. */
  realtimeEnabled: boolean;
  /** T2/S3-7 privacy gate: timeline hidden → mic must not keep listening. */
  timelineCollapsed: boolean;
  /** Session-consent gate (owner decision 2026-07-10): an AUTOSTART arm must not
   *  silently open the mic. false → pipeline stays closed even while armed; the
   *  arm/loop still runs (PlayerPage shows the consent prompt). REQUIRED and
   *  fail-closed: a privacy gate must never default open — every caller decides
   *  explicitly (PlayerPage passes `consent === 'granted'`). */
  micConsentGranted: boolean;
  /** ТЗ №4 п.3: пауза видео = стоп аудио-стрима. false → пайплайн ПРИОСТАНОВЛЕН
   *  через suspendSession (мик-индикатор гаснет, токены не жжём; арм/петля
   *  координатора + WS-сессия/gate/latestFinal сохранены), true → reconcile
   *  переоткрывает мик (lazy-reopen). REQUIRED и fail-closed (как
   *  micConsentGranted): каждый caller решает явно. PlayerPage:
   *  `computeShadowTransmitEnabled({playing, analyzing, evalOverlayVisible})` —
   *  окно «граница→финал» (analyzing) и eval (evalOverlayVisible) НЕ рвут передачу
   *  (канон desktop listenHoldForFinal, index.tsx:1569); `holding` из формулы
   *  убран (HIGH-3 — hold-парк = вечный стрим). */
  transmitEnabled: boolean;
  /** DI seam for tests (jsdom has no getUserMedia) — mirrors ShadowRecorder's `pipelineFactory`. */
  pipelineFactory?: MicPipelineFactory;
  /** FIX (2026-07-07): surface the live mic AnalyserNode so the ShadowCard's
   *  Oscillograph (voice waveform — "видно что нас слушают") stays live. Called
   *  with the pipeline's analyser when the mic opens, and `null` when it closes. */
  onAnalyser?: (node: AnalyserNode | null) => void;
}

export function useShadowMicStream(args: UseShadowMicStreamArgs): void {
  const { armedSegmentId, answerSource, realtimeEnabled, timelineCollapsed, micConsentGranted, transmitEnabled } = args;
  const factory = args.pipelineFactory ?? createAudioPipeline;
  const onAnalyserRef = useRef(args.onAnalyser); onAnalyserRef.current = args.onAnalyser;

  // Non-primitive args → refs (idiom: useShadowAutoStart.ts), so the no-deps
  // polling effect below always reads the LATEST closures without needing
  // them in a dependency array (which would defeat "no-deps").
  const answerSourceRef = useRef(answerSource); answerSourceRef.current = answerSource;
  const factoryRef = useRef(factory); factoryRef.current = factory;
  const armedSegmentIdRef = useRef(armedSegmentId); armedSegmentIdRef.current = armedSegmentId;
  // FIX #1: the poll's long-lived closure must read the LATEST primitives, so
  // realtimeEnabled/timelineCollapsed go through refs too (not the render
  // closure captured when the interval was created).
  const realtimeEnabledRef = useRef(realtimeEnabled); realtimeEnabledRef.current = realtimeEnabled;
  const timelineCollapsedRef = useRef(timelineCollapsed); timelineCollapsedRef.current = timelineCollapsed;
  // Consent gate through a ref for the same reason: the poll's long-lived closure
  // must read the LATEST value, and a false→true flip (user tapped "Начать") must
  // be picked up by the very next render-effect reconcile.
  const micConsentGrantedRef = useRef(micConsentGranted); micConsentGrantedRef.current = micConsentGranted;
  // ТЗ №4 п.3: transmit-гейт через ref — для паритета с остальными гейтами и
  // чтобы избежать stale-замыкания в долгоживущем FIX #1 poll. LOW-правка
  // [ID:P-tz4-fix]: в отличие от арма, transmitEnabled — RENDER-computed
  // (computeShadowTransmitEnabled от playerState.paused + runtime.analyzing/
  // evalOverlayVisible), поэтому ref НЕ бывает свежее последнего рендера, а poll
  // видит именно значение последнего рендера — это КОРРЕКТНО: юзерская пауза
  // всегда рендерит PlayerPage (usePlayerState 'state'-событие + 250мс-полл), так
  // что poll не пропустит transmit-переход (он покрывает только арм-разарм-без-
  // рендера, а это АРМ, не transmit).
  const transmitEnabledRef = useRef(transmitEnabled); transmitEnabledRef.current = transmitEnabled;

  // openExId: which exercise id currently OWNS a live/opening pipeline —
  // reserved synchronously the instant we decide to open, BEFORE the async
  // getUserMedia resolves. Closes the race where a fast re-arm/unarm during
  // an in-flight open would otherwise leave two pipelines alive or push
  // audio under the wrong (or a torn-down) exercise id.
  const openExIdRef = useRef<string | null>(null);
  // The sink CAPTURED at open time — closeSession/dispose for that session
  // always target the sink that actually opened it, even if `answerSource`
  // were ever swapped mid-session (defensive; PlayerPage keeps it stable).
  const openSinkRef = useRef<AudioSink | null>(null);
  const pipelineRef = useRef<AudioPipeline | null>(null);
  // FIX #2: monotonic generation token. Every open captures its value; every
  // open/close bumps it, so a stale pending getUserMedia resolve (ABA on the
  // same string id included) fails `openSeqRef.current === seq` and closes its
  // own stream instead of orphaning one.
  const openSeqRef = useRef(0);
  // FIX #3: the exId whose getUserMedia was denied — not retried until the arm
  // moves off it (one-shot-per-arm, kills the permission-prompt storm).
  const deniedExIdRef = useRef<string | null>(null);
  // FIX #1: interval handle for the React-independent arm watchdog. Non-null
  // ONLY while a pipeline is live.
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function stopPoll(): void {
    if (pollTimerRef.current != null) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }

  function startPoll(): void {
    if (pollTimerRef.current != null) return; // already watching
    pollTimerRef.current = setInterval(() => { reconcile(); }, MIC_ARM_POLL_MS);
  }

  function closeOpenPipeline(): void {
    openSeqRef.current++; // FIX #2: invalidate any still-pending open's resolve
    stopPoll();           // FIX #1: no live pipeline → stop the arm watchdog
    const exId = openExIdRef.current;
    const sink = openSinkRef.current;
    openExIdRef.current = null;
    openSinkRef.current = null;
    const p = pipelineRef.current;
    pipelineRef.current = null;
    if (p) p.close();
    onAnalyserRef.current?.(null); // waveform: mic closed
    if (exId != null) {
      // ТЗ №4 п.3 [ID:P-tz4-fix HIGH-2]: distinguish a SOFT pause (только
      // transmit ушёл в false — юзер нажал паузу видео) от ЖЁСТКОГО teardown
      // (разарм / collapse / смена exId). Пауза обязана звать suspendSession, а НЕ
      // closeSession: closeSession делает gates.delete + resolveAll + теряет
      // latestFinal ⇒ dead-quota воскресает на каждый pause/play, бэкофф
      // обнуляется, забуференный финал (S3-9) теряется. isPause = «всё ОТКРЫВАЮЩЕЕ
      // ещё true, погас ТОЛЬКО transmit, и арм тот же». Любое иное (арм сменился/
      // сброшен, collapse, consent) → жёсткое closeSession (полная чистка).
      const isPause = !transmitEnabledRef.current
        && realtimeEnabledRef.current
        && !timelineCollapsedRef.current
        && micConsentGrantedRef.current
        && armedSegmentIdRef.current() === exId;
      if (isPause) sink?.suspendSession(exId);
      else sink?.closeSession(exId);
    }
  }

  // Single transition-reconciler: called both from the no-deps render effect
  // (below) AND from the FIX #1 poll. Reads ONLY refs, so both call sites (and
  // any interval generation) behave identically. Idempotent via early returns.
  function reconcile(): void {
    const sink = isAudioSink(answerSourceRef.current) ? answerSourceRef.current : null;
    const armedNow = armedSegmentIdRef.current();
    const wantExId = realtimeEnabledRef.current && !timelineCollapsedRef.current
      && micConsentGrantedRef.current && transmitEnabledRef.current && sink
      ? armedNow
      : null;

    // FIX #3 + MED-5 [ID:P-tz4-fix]: reset the one-shot denial ONLY when the ARM
    // itself moved off the denied id (to null or a different id) — NOT when a
    // transient gate (transmit-pause / collapse / consent) makes wantExId null.
    // Keying the reset on wantExId re-armed getUserMedia on every pause/play
    // (pause → wantExId null ≠ deniedExId → reset → play re-prompts). armedNow is
    // the real arm, unaffected by those transient gates.
    if (deniedExIdRef.current != null && deniedExIdRef.current !== armedNow) {
      deniedExIdRef.current = null;
    }

    if (wantExId === openExIdRef.current) return; // no transition

    closeOpenPipeline(); // no-op if nothing was open (still bumps seq + stops poll)

    if (wantExId == null || !sink) return; // unarmed / collapsed / fake / no sink — stay closed

    if (deniedExIdRef.current === wantExId) return; // FIX #3: denied arm, one-shot until it changes

    const seq = openSeqRef.current;   // FIX #2: this open's generation
    openExIdRef.current = wantExId;   // reserve BEFORE the async open (race guard)
    openSinkRef.current = sink;
    startPoll();                      // FIX #1: begin the React-independent arm watchdog
    factoryRef.current((buf) => {
      // A stale chunk from a superseded/closed pipeline must never reach
      // pushAudio under the WRONG (or no) exercise id.
      if (openSeqRef.current !== seq) return;
      sink.pushAudio(wantExId, new Int16Array(buf));
    }).then((pipeline) => {
      if (openSeqRef.current !== seq) {
        // Superseded while getUserMedia was pending (unarm OR ABA re-open) —
        // close THIS stream, never store/leak it.
        pipeline.close();
        return;
      }
      pipelineRef.current = pipeline;
      onAnalyserRef.current?.(pipeline.analyserNode); // waveform: mic open
    }).catch(() => {
      // getUserMedia denied / AudioInitError. FIX #3: remember this arm so the
      // render/poll loop stops re-prompting until the arm changes. Nothing was
      // ever pushed for this id.
      if (openSeqRef.current === seq) {
        deniedExIdRef.current = wantExId;
        openExIdRef.current = null;
        openSinkRef.current = null;
        stopPoll();
      }
    });
  }

  // No-deps: re-checked after EVERY PlayerPage commit — mirrors the
  // `active`-sync effect in PlayerPage.tsx (same "armedSegmentId is not
  // React state" problem, same fix). The FIX #1 poll covers the pause/no-render
  // window this effect cannot.
  useEffect(() => {
    reconcile();
  });

  // Unmount → unconditional teardown (carry S3-9 dispose + S3-7 privacy):
  // stop whatever pipeline is open AND dispose the sink that owned it
  // (dispose() closes every session it still holds, not just this hook's
  // current one — matches RealtimeAnswerSource.dispose()'s own contract).
  useEffect(() => {
    return () => {
      stopPoll(); // FIX #1: tear down the arm watchdog before disposing the sink
      openSeqRef.current++; // FIX #2: invalidate any in-flight open on unmount
      const sink = openSinkRef.current ?? (isAudioSink(answerSourceRef.current) ? answerSourceRef.current : null);
      const p = pipelineRef.current;
      pipelineRef.current = null;
      openExIdRef.current = null;
      openSinkRef.current = null;
      if (p) p.close();
      sink?.dispose();
    };
  }, []);
}
