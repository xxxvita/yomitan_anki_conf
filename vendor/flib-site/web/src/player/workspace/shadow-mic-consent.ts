// shadow-mic-consent.ts — session-scoped microphone consent for shadowing
// autostart (owner decision 2026-07-10). A playhead-driven AUTOSTART arm must
// never silently open the mic: the first autostart-arm per browser session
// pops a one-shot "Начать практику с микрофоном?" prompt; once granted, the
// rest of the session is hands-free. A MANUAL arm (S / R / pill) is itself an
// explicit user action, so it grants consent directly (no prompt).
//
// This module is the PURE read/write seam (typed, storage-injectable) so the
// consent policy is unit-testable without mounting PlayerPage. Only 'granted'
// is ever PERSISTED (to sessionStorage — dies with the tab, so a new tab asks
// again). 'pending' (prompt visible) and 'declined' ("Не сейчас" — suppressed
// for THIS mount only) live purely in React state, never on disk.

/**
 * Full consent lifecycle as tracked in React state:
 *   • null      — nobody has been asked, no consent (dormant / fresh session)
 *   • 'pending' — an autostart-arm happened w/o prior consent → prompt is shown
 *   • 'granted' — consent given (manual arm, "Начать", or a prior-visit persist)
 *   • 'declined'— user hit "Не сейчас"; no prompt + no mic this SESSION, but the
 *                 arm/loop still runs. NOT persisted — a new tab asks again.
 */
export type MicConsent = 'granted' | 'pending' | 'declined' | null;

/** sessionStorage key. Value is the literal 'granted' when (and only when) set. */
export const MIC_CONSENT_KEY = 'flib:shadow:mic-consent';

const GRANTED = 'granted';

function pick(storage?: Storage): Storage | null {
  if (storage) return storage;
  // jsdom/prod both expose sessionStorage, but private-mode / disabled-storage
  // can make even the ACCESS throw — guard it, never let consent-read crash.
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
  } catch {
    return null;
  }
}

/**
 * Reads persisted session consent. ONLY the exact value 'granted' counts;
 * anything else (missing key, a stale/foreign value, or storage throwing) → null.
 * Fail-closed: a read failure never fabricates consent.
 */
export function readStoredMicConsent(storage?: Storage): 'granted' | null {
  const s = pick(storage);
  if (!s) return null;
  try {
    return s.getItem(MIC_CONSENT_KEY) === GRANTED ? GRANTED : null;
  } catch {
    return null;
  }
}

/**
 * Persists granted consent for the rest of the browser session. Best-effort:
 * if storage is unavailable/throws, the caller's React state still carries the
 * grant for the current mount (only cross-visit hands-free is lost).
 */
export function writeStoredMicConsent(storage?: Storage): void {
  const s = pick(storage);
  if (!s) return;
  try {
    s.setItem(MIC_CONSENT_KEY, GRANTED);
  } catch {
    /* storage disabled / quota — React state still holds consent this mount */
  }
}
