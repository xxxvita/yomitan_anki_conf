// ShadowHoldOverlay.tsx — T3 (hold-render + class-3 lifecycle).
//
// Renders the two phases useShadowRuntime.ts's `hold`/eval render-state
// tracks, PLUS a marked placeholder point for T7's real verdict-notation
// card:
//   1. `holding` — the coordinator's own `hold` emit (loop OFF + fail +
//      auto-advance, video parked at B, arm alive, NO timer — see
//      useShadowLoopCoordinator.ts apply()'s else-branch). Shown as a plain
//      status line; NOT the full verdict card (T7's job).
//   2. `evalVisible` — the eval window (`eval-start`…`eval-end`) — reuses
//      AwaitingEvaluationOverlay (T-A lift) UNCHANGED, `decision` always
//      null here (T3 renders only the "Analyzing…" spinner state; the
//      completed-decision card view of that same component is T7's to
//      wire once the real verdict lands on this slot).
//   3. `verdictOutcome` — already stale-filtered by exerciseId
//      (useShadowRuntime.ts's handleAnswerOutcome / hold-render.ts) — T3
//      renders only a generic placeholder slot off of it (status text, no
//      pass/fail styling/score/word-diff — that IS T7's job).
//
// Open question flagged in the ТЗ (§9.3, "fade-out AwaitingEvaluationOverlay
// без framer-motion"): resolved here as "no held-mount" — `evalVisible`
// drives `visible` directly, and AwaitingEvaluationOverlay itself already
// returns null the instant `visible` goes false (see that file's :63). Its
// CSS transition therefore only ever animates the APPEAR edge, never a
// fade-OUT; deliberately not adding an artificial delayed-unmount here since
// no design asked for a visible fade-out and it would be extra state to keep
// in sync with holding/verdict transitions for no requested benefit.
import React, { useMemo, useRef } from 'react';
import { useLocale, useT } from '../i18n';
import { AwaitingEvaluationOverlay } from './AwaitingEvaluationOverlay';
import type { AnswerOutcomeEvent } from '../workspace/answer-source';
import { matchWordsDetailed } from '../workspace/word-matcher';
import { ShadowVerdictNotation, ShadowVerdictPartial } from '../workspace/ShadowCardLifted';

interface Props {
  /** useShadowRuntime().holding */
  holding: boolean;
  /** useShadowRuntime().evalOverlayVisible */
  evalVisible: boolean;
  /** useShadowRuntime().verdictOutcome — already stale-filtered. */
  verdictOutcome?: AnswerOutcomeEvent | null;
  /**
   * T7 (N2) — useShadowRuntime().verdictTargetSnapshot: the effective target
   * text ALREADY frozen (by useShadowRuntime, at the moment this outcome was
   * accepted) against which to compute the real B1 word-diff. OPTIONAL and
   * back-compat: omitted (the pre-T7 call shape, still used by
   * useShadowRuntime.hold-seam.test.ts / ShadowHoldOverlay.test.tsx's
   * existing cases) falls back to the T3 placeholder behaviour — the raw
   * `outcome.status` word, no notation — so none of those pre-existing
   * assertions change.
   */
  verdictTargetSnapshot?: string | null;
  /**
   * ТЗ №6 п.6 [ID:P-tz6] — «серая дрянь вне карточки». Когда карта Shadowing
   * ВИДИМА (armed && !collapsed), она сама рисует persistent-B1 в ленте
   * (ShadowCardLifted latest-блок). Этот же outcome, отрисованный ЕЩЁ И
   * над-видео-слотом здесь, был визуальным дублем ВНЕ карты (grey partial /
   * B1, «съезжал» — владелец, видео 23-39, 13:15). При `cardVisible` слот
   * НЕ рендерим — единственный источник разбора карта. Когда карта скрыта
   * (таймлайн свёрнут) слот остаётся (over-video — единственное место показа).
   * Дефолт false: standalone-юнит-тесты ShadowHoldOverlay рендерят слот как
   * раньше. holding-баннер и eval-оверлей от гейта НЕ зависят (они не дублируются
   * картой). */
  cardVisible?: boolean;
}

export const ShadowHoldOverlay: React.FC<Props> = ({ holding, evalVisible, verdictOutcome, verdictTargetSnapshot, cardVisible = false }) => {
  const lang = useLocale();
  const t = useT();
  const en = lang === 'en';

  // T7c (freeze-glyphs — "committed красит один раз... ретро-перекраска
  // ЗАПРЕЩЕНА"): compute the word-diff ONCE per exerciseId. The dependency
  // array is deliberately `[verdictOutcome?.exerciseId]` ONLY — not
  // `outcome.text`/`verdictTargetSnapshot` — so that once a given
  // exerciseId has been painted, a LATER re-render carrying a changed
  // `verdictTargetSnapshot` (or, hypothetically, a changed outcome.text for
  // the same id) can NEVER recolor it. `outcomeRef`/`snapshotRef` hold the
  // latest props so the memo body reads them fresh only on the ONE render
  // where exerciseId actually changes.
  const outcomeRef = useRef(verdictOutcome);
  outcomeRef.current = verdictOutcome;
  const snapshotRef = useRef(verdictTargetSnapshot);
  snapshotRef.current = verdictTargetSnapshot;
  const frozenNotation = useMemo(() => {
    const oc = outcomeRef.current;
    const snap = snapshotRef.current;
    if (!oc || oc.outcome.status !== 'final' || snap == null) return null;
    return matchWordsDetailed(oc.outcome.text, snap);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verdictOutcome?.exerciseId]);

  return (
    <>
      {holding && (
        <div
          data-testid="shadow-hold-state"
          style={{
            position: 'absolute',
            left: '50%',
            bottom: 24,
            transform: 'translateX(-50%)',
            padding: '8px 16px',
            borderRadius: 8,
            backgroundColor: 'rgba(20, 22, 28, 0.9)',
            color: '#f5f6f8',
            fontFamily: 'system-ui, sans-serif',
            fontSize: 13,
            zIndex: 80,
          }}
        >
          {en ? 'Paused — say the line again to continue' : 'Стоп — повторите фразу, чтобы продолжить'}
        </div>
      )}
      <AwaitingEvaluationOverlay visible={evalVisible} decision={null} />
      {/* T7c — real verdict card. `verdictOutcome` is already stale-filtered
          by exerciseId (hold-render.ts). Four branches:
            1. No `verdictTargetSnapshot` supplied at all — BACK-COMPAT with
               the pre-T7 placeholder contract (still exercised by
               useShadowRuntime.hold-seam.test.ts / this file's own T3
               tests, neither of which pass the new prop): render the bare
               `outcome.status` word, unchanged.
            2. `status === 'final'` with a snapshot — the real B1 notation
               (frozen once per exerciseId, see frozenNotation above). T7-fix
               (5-timeout, MED CONFIRMED): an EMPTY snapshot (no ref tokens
               to diff against — matchWordsDetailed's `marks: []`
               convention, see word-matcher.ts) falls through to the same
               explicit "no answer" placeholder as branch 3 below, instead
               of silently rendering an empty grid.
            3. `non-final` / `timeout` — freeze-glyphs PARTIAL state: plain
               grey text, no verdict colouring (the attempt hasn't
               committed to a scored diff). T7-fix (5-timeout, MED
               CONFIRMED): when there is no partial text at all (chiefly a
               bare `timeout` with no `partial` field — the answer-source
               contract allows that), an empty `ShadowVerdictPartial` left
               the slot visually blank with zero diagnosis. The answer-source
               invariant ("no outcome leaves the result unshown") demands a
               third, explicit "не знаем" diagnosis here — same family as
               no-response/error, not a silent empty line.
            4. `no-response` / `error` — a short localized diagnosis line
               (no word-diff to show for these outcomes). */}
      {verdictOutcome != null && !cardVisible && (
        // ТЗ №3 п.6 — BUG FIX: this slot used to be an UNPOSITIONED flow div.
        // ShadowHoldOverlay is mounted inside PlayerRoot (a position:relative
        // stage whose <video> is absolutely positioned), so an in-flow block
        // collapsed to the stage's top-left corner — the "Нет ответа" verdict
        // rendered in the page's upper-left instead of over the video
        // (Screenshot 155441). The `holding` banner above never had this bug
        // because it carries its own absolute centering; the verdict slot must
        // do the same so the B1 card lives over the video, as it did before.
        <div
          data-testid="shadow-verdict-slot"
          style={{
            position: 'absolute',
            left: '50%',
            bottom: 24,
            transform: 'translateX(-50%)',
            maxWidth: '90%',
            padding: '10px 16px',
            borderRadius: 10,
            backgroundColor: 'rgba(20, 22, 28, 0.92)',
            color: '#f5f6f8',
            boxShadow: '0 8px 28px rgba(0,0,0,0.5)',
            zIndex: 80,
          }}
        >
          {verdictTargetSnapshot == null ? (
            verdictOutcome.outcome.status
          ) : verdictOutcome.outcome.status === 'final' ? (
            frozenNotation && frozenNotation.marks.length > 0 ? (
              <ShadowVerdictNotation marks={frozenNotation.marks} />
            ) : (
              <span>{t('player.shadowVerdictNoAnswer')}</span>
            )
          ) : verdictOutcome.outcome.status === 'non-final' || verdictOutcome.outcome.status === 'timeout' ? (
            (verdictOutcome.outcome.partial ?? '').trim() !== '' ? (
              <ShadowVerdictPartial text={verdictOutcome.outcome.partial ?? ''} />
            ) : (
              <span>{t('player.shadowVerdictNoAnswer')}</span>
            )
          ) : verdictOutcome.outcome.status === 'no-response' ? (
            <span>{t('player.shadowVerdictNoResponse')}</span>
          ) : (
            <span>{t('player.shadowVerdictError')}</span>
          )}
        </div>
      )}
    </>
  );
};
