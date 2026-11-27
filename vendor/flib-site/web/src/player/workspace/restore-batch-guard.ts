// restore-batch-guard.ts — WEB-SEAM: batch-trap guard (T2-carry b).
//
// Hazard (⚠️ WATCH in task-T2-brief.md, desktop useWorkspace :502-504/:418-420
// — the SAME trap exists there too, never explicitly fixed upstream; the
// brief flags it as "don't repeat this"): useShadowLoopCoordinator's
// `apply()` (useShadowLoopCoordinator.ts :485-501) calls
// `resumeFromBoundary('advance')` — which, when a loop is actually active,
// synchronously sets `boundarySuppressRef.current = true` and flips
// `looping` true→false via `setLooping(false)` — and then, in the SAME
// synchronous call stack (still inside the same `apply()` invocation),
// `endRun` may call `restoreWorkspace({ looping: true, ... })` (when the run
// started with an already-active AB loop — snap.active — that still
// contains the current playhead — the C2 `insideSnap` gate).
//
// React 18's automatic batching collapses this true→false→true transition,
// all issued within one synchronous task, into a SINGLE commit whose
// *observed* value never actually changed across renders (true before, true
// after). useWorkspace's own cleanup effect —
// `useEffect(() => { if (!looping) boundarySuppressRef.current = false },
// [looping])` (useWorkspace.ts) — depends on `looping`'s committed value, so
// it never re-runs, and `boundarySuppressRef` is stuck `true` forever. The
// RESTORED loop's own boundary then silently never re-enforces again
// (reachBoundary's very first guard, `if (boundarySuppressRef.current)
// return`, short-circuits on every future tick) — exactly the "восстановленная
// петля тихо не enforce'ит границу" failure mode the brief warns about.
//
// Fix: defer any restoreWorkspace call that would reinstate `looping: true`
// to a fresh macrotask (`setTimeout(fn, 0)`). By the time that callback
// runs, the browser has already flushed the PRECEDING commit's passive
// effects — including the `[looping]` cleanup effect, which observed
// `looping` transition to `false` in that earlier, now-separate commit and
// cleared `boundarySuppressRef` — so the second commit (`looping: true`
// again) starts from a clean slate. A microtask (`queueMicrotask` /
// `Promise.resolve().then`) is NOT sufficient: React 18's automatic batching
// can still coalesce same-microtask-queue updates into a single commit.
//
// Restores that do NOT reinstate an active loop (`looping: false`, or no
// loop was active to begin with) have no trap to avoid and apply
// immediately — deferring them would only add a pointless tick of latency
// to the common "run just ends, nothing to restore" path.
//
// T2-fix (audit CONFIRMED, part a — staleness): the range/looping decision
// (`insideSnap`, computed by the CALLER against a snapshot of the playhead
// taken BEFORE this function was even invoked) is only valid for the instant
// it was computed. `setTimeout(fn, 0)` is a MACROtask, not a microtask — in a
// throttled/background tab (Chrome clamps background-tab timers to ≥1000ms)
// or under heavy main-thread contention, real wall-clock time can pass
// before this callback runs, during which the video keeps playing (or the
// user scrubs). If the playhead has since moved outside the range being
// restored, blindly applying `looping: true` here would immediately trip
// the FIRST boundary tick after the restore lands → seek(rangeStart) — the
// exact "resurrected loop yanks you back" symptom the C2 gate in endRun
// exists to prevent in the first place, just relocated one tick later. Fix:
// re-read the LIVE playhead (via the optional `getCurrentTime` — omitted by
// callers that can't supply one, e.g. tests exercising the pre-fix shape)
// right before applying, and downgrade to `looping: false` (passive
// bookmark — range restored, loop not re-armed) if it's no longer inside
// [rangeStart, rangeEnd).
//
// T2-fix (audit CONFIRMED, part b — cancellation): returns a cancel
// function so the caller (useShadowRuntime) can abort a still-pending
// deferred restore — on unmount (component torn down mid-defer would
// otherwise call into a dead workspace) and whenever a NEWER restore/arm
// supersedes this one (a stale restore firing after a fresh arm would stomp
// the new arm's just-applied range/looping).
export interface GuardedRestoreParams {
  rangeStart: number
  rangeEnd: number
  viewStart: number
  viewEnd: number
  looping: boolean
  pauseAtEnd?: number
  trustExtent?: boolean
}

export function guardedRestoreWorkspace(
  restoreWorkspace: (p: GuardedRestoreParams) => void,
  p: GuardedRestoreParams,
  getCurrentTime?: () => number,
): () => void {
  if (!p.looping) {
    restoreWorkspace(p)
    return () => {}
  }
  const timer = setTimeout(() => {
    if (getCurrentTime) {
      const ct = getCurrentTime()
      const stillInside = ct >= p.rangeStart && ct < p.rangeEnd
      if (!stillInside) {
        // Staleness: playhead drifted past the restored range while this sat
        // in the macrotask queue. Restore the range/view as a passive
        // bookmark but do NOT reinstate the loop — there's nothing left to
        // yank back to.
        restoreWorkspace({ ...p, looping: false })
        return
      }
    }
    restoreWorkspace(p)
  }, 0)
  return () => clearTimeout(timer)
}
