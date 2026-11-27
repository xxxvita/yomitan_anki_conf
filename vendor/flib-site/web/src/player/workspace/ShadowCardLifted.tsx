// ShadowCardLifted.tsx — VISUAL LIFT of the desktop ShadowChat.tsx (anki_conf/
// electron/renderer/components/panels/VideoPlayerPanel/components/ShadowChat.tsx,
// 1356 lines — copied verbatim into this file first, then trimmed/wired below;
// see git history of this file for the raw copy commit if the WEB-CUT diff
// ever needs re-checking against the source).
//
// WHY THIS FILE EXISTS (live accept #1 post-mortem): the previous ShadowCard.tsx
// (T4) was built "in the spirit of" the desktop card instead of lifted from it —
// visual similarity measured ~0% (docs/audit/assets/17-etalon-desktop-shadow-card.png
// vs 17-actual-web-shadow-card.png). Owner's fix strategy: take the file whole,
// fix AFTER the move, not element-by-element reconstruction. This file is that
// fix — same dark floating chip, same "≡ SHADOW" header, same rec-strip anatomy
// (dot / timer / status pill / live oscillograph / Stop), same "ОЖИДАЕТСЯ"
// target panel, same dashed-answer block + attempts feed with diff+match% —
// using the SAME CSS-var theme tokens the desktop draws with (--panel/--fg/
// --accent/--danger/--ok/--warn/--border/--btn-bg/--mono-font/--ui-font/
// --caption-font-en/ru — already ported to web/src/player/theme/dusk.ts,
// contract documented at player-theme.ts:307-312).
//
// REVIEW ACCEPTANCE #1 fix pass (against manifest-checklist.md items 1-10):
// this pass closes 4 findings raised against the FIRST lift (which only got
// container/header/rec-strip/target-panel right) + a handful of minors.
//   F1 (checklist §5): target-panel reply text was 15px/inherited --ui-font;
//     desktop is 17px/500, fontFamily var(--caption-font-en|ru) BY INTERFACE
//     LANGUAGE (not content language — content here is always EN, but the
//     branch itself is kept for parity/future-proofing, same as desktop
//     targetPanel :818-836).
//   F2 (checklist §6): the dashed "answer" block (ShadowChat.tsx :862-883,
//     `partialBlock`) is now a PERMANENT fixture of the full layout — shows
//     the "Жду ваш ответ…"/"Listening…" placeholder in idle/recording/
//     transcribing, and the last attempt's raw spoken text once one exists
//     (desktop's `partialText` is a LIVE SSE stream we don't have in V1 —
//     WEB-SEAM: substitute `lastSpoken`, which is the closest analogue: "the
//     most recent thing the user said", not diff-coloured, matching desktop's
//     plain-italic partialBlock treatment exactly).
//   F3 (checklist §7): the standalone `data-testid="shadow-diff"` block that
//     used to render ONLY during phase==='result' is GONE — its diff+match%
//     now lives inside the newest attemptsFeed card (byte-identical
//     attemptCard/heardLine/pctTone/"Loop N" header from ShadowChat.tsx
//     :885-949), exactly like the desktop where diff lives in the feed, never
//     in a separate block. WEB-SEAM data-shape note: ShadowV1Api.shadowAttempts
//     (PanelAttempts, useShadowAttempts.ts) is INTENTIONALLY lossy — it only
//     carries match_pct + audio bounds per cue, no marks/text, because it's
//     persisted to localStorage and marks/text were never meant to survive a
//     reload (privacy/storage-lean choice, see shadow-attempts.ts header).
//     So only the LATEST attempt (still held in lastMarks/lastMatchPct/
//     lastSpoken state) can show a real word-diff + heard-line; older cards
//     in the feed render score-only ("Loop N" + match% badge, no diff — there
//     is no data to show one). Click-to-select only works for attempts that
//     still have a live `recordings[]` entry (same V1 constraint documented
//     in useShadowV1.ts finalize(): "no audio on reload").
//   F4 (checklist "Keyframes"): shadowPulse/shadowStatusWait now actually
//     exist (desktop ShadowChat.tsx :1171-1172, injected via a sibling
//     <style> tag) — the FIRST lift's WEB-CUT rationale ("not visible in a
//     still screenshot anyway") was wrong for an accept gate that also checks
//     the recording/idle *states*, not just one still. Wired to: rec-strip dot
//     (shadowPulse 1.4s while recording), dashed-block bullet (shadowPulse 1s,
//     unconditional, matches desktop), StatusBadge non-ok text (shadowStatusWait
//     1.2s ease-in-out).
//   MINORS: header padding 4px 4px 4px 10px (desktop :1042, was 6/8/6/12);
//     container background var(--panel, ...) FIRST in the fallback chain
//     (was var(--drawer-bg, var(--panel, ...)) — checklist §1 explicitly
//     calls out --drawer-bg as wrong here); Stop button background/border now
//     transparent + var(--danger-border, rgba(239,68,68,.35)) (desktop
//     stopBtn() :1190-1198).
//
// WEB-CUT (dropped from ShadowChat.tsx; line numbers = desktop source file):
//   // WEB-CUT: Engines popover (ASR/answer-check/OCR picker + "Анализ ответов" tab) — :33-351,1179-1181
//   // WEB-CUT: compact/flip layout + drag-to-dock + snap-zone rect polling — :23-31,491-695,744-1155,1264-1273,1344-1356
//   // WEB-CUT: anchor-drop bind-to-exercise row ("ПРИВЯЗКА") — :950-1036
//   // WEB-CUT: useManualRecorder (parallel voice-memo record button in rec strip) — :730-738
//   // WEB-CUT: settingsRow (subtitle/custom mode toggle, loop, auto-advance slider) — :754-816 (V1 has no auto-loop, no custom-text mode)
// WordChip (:125-163), pctTone (:165-169) and StatusBadge (:394-408) are lifted
// VERBATIM (byte-identical style objects/JSX) — do not paraphrase; diff against
// the desktop file if any of the three need to change. Oscillograph (:353-392)
// is VERBATIM too, restored live (analyserNode-driven) per this fix's brief —
// T4's earlier pass had cut it "for minimalism"; owner asked for it back.
// attemptCard/heardLine style objects (:885-949 helpers) are lifted VERBATIM.
//
// WEB-SEAM (wired to our contract instead of the desktop's):
//   // WEB-SEAM: props collapse to a single `shadow: ShadowV1Api` (useShadowV1.ts)
//   //   instead of ShadowChat's ~20 individual props/setters — same one-prop
//   //   shape the OLD ShadowCard.tsx already used (PlayerPage.tsx wires
//   //   `<ShadowCard shadow={shadow} />`, unchanged call site).
//   // WEB-SEAM: analyserNode — useShadowV1 additively exposes it (new field on
//   //   ShadowV1Api, sourced from ShadowRecorder.analyser()) so the Oscillograph
//   //   can stay live. This does NOT touch the CSP-hotfix catch-block/audio_init
//   //   mapping in useShadowV1.ts (fix/shadow-worklet-csp) — purely additive
//   //   lines next to it. See useShadowV1.ts WEB-SEAM comment at the same spot.
//   // WEB-SEAM: t()/useT()/useLocale() (web/src/player/i18n.ts) instead of the
//   //   desktop's inline makeStrings(lang) — same `player.shadow*` key
//   //   convention T4 started; this pass adds 2 more keys (shadowLoop,
//   //   shadowWaiting — verbatim values of desktop T.loop/T.listening).
//   // WEB-SEAM: rec-strip "Стоп" calls shadow.stopRecording() (finalizes the
//   //   CURRENT attempt) — desktop's Stop called the whole-card onDeactivate
//   //   because desktop sessions are continuous-listen (SSE partials); our V1
//   //   is discrete start/stop per attempt, so Stop = stopRecording, and the
//   //   header × is the only deactivate() path (same split the old
//   //   ShadowCard.tsx already had — unchanged).
//   // WEB-SEAM: timer shows shadow.remainingSec (count-DOWN from 60s, what the
//   //   hook actually tracks) instead of desktop's local count-UP elapsed timer
//   //   — same rec-strip slot, different number semantics, documented once here.
//   // WEB-SEAM: attemptsFeed selection reads/writes youTrackRecordingId via
//   //   useVideoPlayerStore (web/src/player/workspace/video-player-store.ts) —
//   //   same store useShadowV1.selectRecording already writes to; desktop reads
//   //   a prop (`youTrackRecordingId`) + calls `setYouTrackRecordingId` from a
//   //   parent-supplied setter instead of a store, otherwise identical contract.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Square, GripVertical, Pin, Subtitles, Image as ImageIcon, FileText } from 'lucide-react'
import { useT, useLocale } from '../i18n'
import type { WordMark, WordKind } from './word-matcher'
import type { ShadowV1Api } from '../hooks/useShadowV1'
import type { ShadowBind, ShadowMode, ShadowState } from './panel-types'
import { useVideoPlayerStore, type DockSide } from './video-player-store'
import { DOCKED_WIDTH, clampShadowSize, computeVisibleFeed, dockedReserveWidth, type ShadowSize } from './shadow-card-size'
// ТЗ №3 п.1: DOCKED_WIDTH now lives in the JSX-free shadow-card-size module so
// WorkspacePanelThemed can read the docked-inset width WITHOUT importing this
// heavy React component. Re-exported here so the existing importers
// (WorkspacePanelThemed, shadow-card-drag-dock.test) keep their import path.
export { DOCKED_WIDTH } from './shadow-card-size'

// ── T8 — drag-to-dock mechanics, lifted from ShadowChat.tsx :491-695 (state/
// detectSnap/handleHeaderMouseDown/global mousemove-mouseup/containerStyle) +
// :1344-1356 (snapHintStyle). This is the revival of the WEB-CUT this file's
// header calls out at "compact/flip layout + drag-to-dock + snap-zone rect
// polling — :23-31,491-695,744-1155,1264-1273,1344-1356": only the drag/dock/
// snap-zone THIRD of that cut is revived here (T8 brief + audit/28 class-5).
// The compact/flip layout half (:744-1155,1264-1273 — the alternate two-column
// JSX + 3D flip card) stays WEB-CUT — `compact` is still derived (parity with
// desktop's variable) but is not (yet) wired to a JSX swap; see the `compact`
// declaration below for why that's a deliberate, separately-scoped follow-up,
// not an oversight.
const DRAG_THRESHOLD = 6
const SNAP_ZONE_PX = 36
// ТЗ №3 п.2 — zero-scroll feed row-height estimates (jsdom runs no real layout,
// so the pixel budget is measured live via ResizeObserver and divided by these).
const FEED_ROW_H = 26   // one compact history one-liner ("повтор N · % · услышано")
const FEED_LATEST_H = 84 // the full B1 latest block reserved above the history

// VERBATIM from ShadowChat.tsx :1344-1356 (snapHintStyle) — dashed highlight
// rectangle shown at the bar's left/right edge while dragging, active===true
// when the pointer is currently inside that edge's snap zone.
function snapHintStyle(side: 'left' | 'right', barRect: DOMRect, active: boolean): React.CSSProperties {
  const left = side === 'left' ? barRect.left : barRect.right - DOCKED_WIDTH
  return {
    position: 'fixed', zIndex: 29, // WEB-SEAM: one below the card's zIndex:30 (desktop uses 11 under its own 12)
    left, top: barRect.top, width: DOCKED_WIDTH, height: barRect.height,
    background: active ? 'var(--accent, #4da6ff)' : 'transparent',
    opacity: active ? 0.18 : 0,
    border: '2px dashed var(--accent, #4da6ff)',
    borderColor: active ? 'var(--accent)' : 'transparent',
    transition: 'opacity 80ms linear, border-color 80ms linear',
    pointerEvents: 'none',
  }
}

// ТЗ №3 п.3 — WordChip (the OLD single-row V1 diff markup, ShadowChat.tsx
// :125-163) is GONE from this card: the latest attempt now renders the B1
// two-row ShadowVerdictNotation, and history rows are compact text one-liners.
// (WordChip is still available in the desktop source if the "chimera" line ever
// needs re-checking — see git history.) Owner: "старая нотация, которую признали
// неработоспособной".

// ── VERBATIM from ShadowChat.tsx:165-169 (pctTone) ───────────────────────────
function pctTone(p: number): React.CSSProperties {
  if (p >= 95) return { background: 'var(--ok, #86D27A)',  color: 'var(--surface, #0a0a0a)', borderColor: 'var(--ok, #86D27A)' };
  if (p >= 80) return { background: 'var(--warn, #E0B341)', color: 'var(--surface, #0a0a0a)', borderColor: 'var(--warn, #E0B341)' };
  return         { background: 'var(--danger, #ef4444)',   color: 'var(--surface, #0a0a0a)', borderColor: 'var(--danger, #ef4444)' };
}

// ── VERBATIM from ShadowChat.tsx:394-408 (StatusBadge) — includes the
// shadowStatusWait pulse on non-ok text (accept #1 finding F4) ──────────────
const StatusBadge: React.FC<{ ok: boolean; text: string }> = ({ ok, text }) => {
  const bg = ok ? 'color-mix(in srgb, var(--ok) 18%, transparent)' : 'color-mix(in srgb, var(--warn) 18%, transparent)';
  const border = ok ? 'color-mix(in srgb, var(--ok) 55%, transparent)' : 'color-mix(in srgb, var(--warn) 55%, transparent)';
  const fg = ok ? 'var(--ok, #86D27A)' : 'var(--warn, #E0B341)';
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, letterSpacing: .2,
      padding: '3px 8px', borderRadius: 4,
      background: bg, color: fg, border: `1px solid ${border}`,
      whiteSpace: 'nowrap', flexShrink: 0, lineHeight: 1,
      animation: ok ? undefined : 'shadowStatusWait 1.2s ease-in-out infinite',
    }}>{text}</span>
  );
};

// ── VERBATIM from ShadowChat.tsx:353-392 (Oscillograph) — live FFT waveform,
// restored per this fix's brief (owner: keep it live, from analyserNode) ────
const Oscillograph: React.FC<{ analyserNode: AnalyserNode | null; recording: boolean }> = ({ analyserNode, recording }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  useEffect(() => {
    if (!recording || !analyserNode || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const draw = () => {
      const data = new Uint8Array(analyserNode.frequencyBinCount);
      analyserNode.getByteFrequencyData(data);
      const w = canvas.width, h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      // Use ok colour so the waveform reads as "live signal" (verbatim rationale).
      const fill = getComputedStyle(canvas).getPropertyValue('color') || '#86D27A';
      ctx.fillStyle = fill;
      const barW = w / data.length;
      for (let i = 0; i < data.length; i++) {
        const barH = (data[i] / 255) * h;
        ctx.fillRect(i * barW, h - barH, Math.max(barW - 0.5, 1), barH);
      }
      animRef.current = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(animRef.current);
  }, [recording, analyserNode]);
  return (
    <canvas
      ref={canvasRef}
      width={120}
      height={20}
      style={{
        // ТЗ №4 п.2 — ФИКС-размер 120×20; flex-grow ЗАПРЕЩЁН. Десктоп-канон
        // (ShadowChat.tsx:387) использует flex:1 — при ресайзе карты волна там
        // растягивалась по ширине (владелец Screenshot_20260710_182753). Осознанное
        // web-отклонение: рост карты отдаёт место таймеру/кнопкам/пустоте rec-strip,
        // а НЕ волне. flexGrow/flexShrink:0 + фикс width удерживают её 120px.
        flexGrow: 0, flexShrink: 0, width: 120, height: 20, color: 'var(--ok, #86D27A)',
        borderRadius: 3, background: 'transparent',
      }}
    />
  );
};

function formatMmSs(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = Math.max(0, totalSec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ── icon-strip button styles (ShadowChat.tsx stopBtn()/iconBtn() analogues) ──
function stopBtnStyle(): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 5,
    padding: '5px 10px', borderRadius: 5, flexShrink: 0,
    // MINOR (accept #1): transparent bg + var(--danger-border,...) border,
    // matching desktop stopBtn() :1190-1198 exactly (was a filled color-mix bg
    // + plain --danger border).
    background: 'transparent',
    border: '1px solid var(--danger-border, rgba(239,68,68,0.35))',
    color: 'var(--danger, #ef4444)',
    fontFamily: 'inherit', fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
  };
}
function recordBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 5,
    // Ф1 bug 4 fix: `marginLeft: 'auto'` used to shove this button flush against
    // the rec-strip's right edge, which is fine while OTHER content (timer/badge/
    // oscillograph) fills the middle during recording — but in idle (this
    // component's only other state before Ф3 lands settingsRow) the row has
    // nothing but [dot] ... [button], so auto-margin stretched a big visible gap
    // between them and the strip read as "half-empty". Desktop's own recStrip
    // (ShadowChat.tsx :703-752) never uses an auto-margin either — elements just
    // flow left-to-right with the shared gap:8. Dropping it packs dot+button
    // together, matching desktop's plain-flow convention.
    padding: '5px 12px', borderRadius: 5, flexShrink: 0,
    background: disabled ? 'var(--btn-bg, rgba(255,255,255,0.06))' : 'color-mix(in srgb, var(--accent) 18%, transparent)',
    border: `1px solid ${disabled ? 'var(--border, rgba(255,255,255,0.10))' : 'var(--accent, #60a5fa)'}`,
    color: disabled ? 'var(--fg-mute, #64748b)' : 'var(--accent, #60a5fa)',
    fontFamily: 'inherit', fontSize: 11.5, fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
  };
}
function againBtnStyle(): React.CSSProperties {
  return {
    alignSelf: 'flex-start', padding: '4px 10px', borderRadius: 5,
    background: 'var(--btn-bg, rgba(255,255,255,0.06))',
    border: '1px solid var(--border, rgba(255,255,255,0.10))',
    color: 'var(--fg-dim, #94a3b8)', fontFamily: 'inherit', fontSize: 11, cursor: 'pointer',
  };
}
// ── VERBATIM from ShadowChat.tsx :1221-1227 (sideBtn) — custom-mode side-button
// style used by the targetPanel. (iconChip moved out with settingsRow → ShadowSettingsRow.tsx, ТЗ №3 п.4.) ──
function sideBtn(): React.CSSProperties {
  return {
    width: 30, height: 30, padding: 0, display: 'inline-flex',
    alignItems: 'center', justifyContent: 'center',
    background: 'transparent',
    border: '1px solid var(--border, rgba(255,255,255,0.10))',
    borderRadius: 4, color: 'var(--fg-dim, #94a3b8)', cursor: 'pointer',
  };
}
// ── VERBATIM from ShadowChat.tsx :1228-1242 (attemptCard/heardLine helpers) ──
function attemptCardStyle(): React.CSSProperties {
  return {
    padding: '8px 10px',
    background: 'var(--btn-bg, rgba(0,0,0,0.25))',
    border: '1px solid var(--border, rgba(255,255,255,0.10))',
    borderRadius: 6, flexShrink: 0,
  };
}
function heardLineStyle(): React.CSSProperties {
  return {
    fontFamily: 'var(--mono-font, monospace)', fontSize: 11,
    color: 'var(--fg-mute, #64748b)', marginTop: 4, fontStyle: 'italic',
    overflowWrap: 'anywhere' as const,
  };
}

// ── T9 — VERBATIM from ShadowChat.tsx :1243-1251 (bindBtn) — the non-compact
// segmented-control button style used by bindRowFull below. bindBtnV (the
// vertical variant for the compact bindRail, :1252-1261) is NOT lifted — this
// card's JSX never branches on `compact` yet (same deliberate deferral T8's
// header note documents for the compact layout swap as a whole).
function bindBtnStyle(on: boolean, off: boolean): React.CSSProperties {
  return {
    flex: 1, padding: '4px 6px', fontSize: 10,
    background: on ? (off ? 'var(--btn-active, rgba(255,255,255,0.10))' : 'color-mix(in srgb, var(--accent) 22%, transparent)') : 'transparent',
    border: 'none', borderRadius: 3,
    color: on ? (off ? 'var(--fg-dim, #94a3b8)' : 'var(--accent, #60a5fa)') : 'var(--fg-mute, #64748b)',
    cursor: 'pointer', fontFamily: 'var(--mono-font, monospace)', letterSpacing: .3,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// T7c — Нотация B1: два ряда (ЭТАЛОН/ВЫ) + лишнее снаружи сетки + 3
// диагноза + freeze-glyphs. Consilium synthesis (docs/consilium/2026-07-05-
// shadow-verdict-ux-stage1-synthesis.md) findings this directly answers:
//   #2 "химера-строка" — the OLD single-row WordChip feed (still used
//      UNCHANGED by the V1 ShadowCard attempts-feed below, per this task's
//      brief: only the SANCTIONED word-matcher-detailed.test revision is
//      authorized, so that feed's existing RTL contract is left intact) is
//      exactly the "chimera" the consilium flagged — spoken+ref words mixed
//      in one line, wrong+(expected) not visually separated. This new
//      component is the real fix: two ALIGNED rows, ref word on top, what
//      the user said (or an empty slot) underneath.
//   #1 "зачёркивание missing = инверсия смысла" — replaced with an empty
//      slot glyph (`····`), never a strikethrough (that reads as "delete
//      this", the opposite of "you skipped this").
// Consumer: ShadowHoldOverlay.tsx's real verdict slot (the T7-brief's named
// integration point — "заменяет плейсхолдер `// T7: verdict card`"), NOT
// wired into ShadowCard's V1 attempts-feed below (see this file's own
// concerns in task-T7-report.md for why that swap was deliberately NOT
// made this pass).
// ═══════════════════════════════════════════════════════════════════════

export type NotationDiagnosis = 'added' | 'misheard' | 'unknown';

export interface NotationColumn {
  /** ЭТАЛОН row — the reference word (or the substitution's `expected`). */
  ref: string;
  /** ВЫ row — what the user said, or `null` for an empty ("not said") slot. */
  you: string | null;
  kind: WordKind;
}

export interface NotationExtraGroup {
  /** Index of the column this group renders AFTER; -1 = before the first column. */
  afterColumn: number;
  words: string[];
  diagnosis: NotationDiagnosis;
}

export interface NotationResult {
  columns: NotationColumn[];
  extras: NotationExtraGroup[];
}

// Filler interjections — consilium/T7c brief: "филлеры «эээ/мм» — не
// слова". Dropped entirely from the notation (not shown as `extra`, not
// diagnosed) rather than fixed in the matcher itself — this is a rendering
// concern (word-matcher.ts's `extra` kind stays a faithful "spoken but not
// in ref" fact; deciding a specific extra token is disposable noise is
// this component's call, not the matcher's).
const FILLER_WORDS = new Set([
  'эээ', 'ээ', 'э', 'мм', 'ммм', 'гм', 'эм',
  'uh', 'um', 'uhh', 'umm', 'hmm', 'ah', 'er', 'erm',
]);

/**
 * T7c "три диагноза" — «вы добавили» / «возможно, ослышались» / не знаем.
 * `close` (≈, phonetic near-miss) is EXPLICITLY DEFERRED (task-T7-brief.md
 * §T7a: dissimilar-but-phonetically-close pairs never reach the matcher's
 * substitution branch at all — subScore routes them to missing+extra
 * instead — routing that would need aligner changes out of this task's
 * scope). Without that signal, the only evidence available at render time
 * is POSITIONAL adjacency to a missing/wrong/ending mark:
 *   - adjacent to a `missing` → the ASR may have misheard the missing ref
 *     word AS this extra word → "possibly misheard".
 *   - adjacent to a `wrong`/`ending` → ambiguous (could be a real addition
 *     right next to an unrelated mistake, or part of the same
 *     mis-hearing) → "unknown" (never louder than an actual error — per
 *     the brief's "сомнение не громче ошибки").
 *   - otherwise (neighbours are `ok`/boundary) → confidently "you added
 *     this".
 */
function diagnoseExtra(marks: WordMark[], idx: number): NotationDiagnosis {
  const prevKind = marks[idx - 1]?.kind;
  const nextKind = marks[idx + 1]?.kind;
  if (prevKind === 'missing' || nextKind === 'missing') return 'misheard';
  if (prevKind === 'wrong' || nextKind === 'wrong' || prevKind === 'ending' || nextKind === 'ending') return 'unknown';
  return 'added';
}

/**
 * Pure transform: `WordMark[]` (matcher output, ordered) → the two-row grid
 * shape + out-of-grid extras this component renders. Exported standalone
 * (no JSX) so the grid/extras/diagnosis LOGIC is unit-testable without RTL.
 */
// ТЗ №7 п.1 — worst-kind priority for a merged contraction column (missing >
// wrong > ending > ok): the raw contraction is only "green" if BOTH halves were
// said correctly; any half's error colours the whole column.
function notationKindRank(kind: WordKind): number {
  return kind === 'missing' ? 3 : kind === 'wrong' ? 2 : kind === 'ending' ? 1 : 0;
}

export function buildVerdictNotation(marks: WordMark[]): NotationResult {
  const columns: NotationColumn[] = [];
  const extras: NotationExtraGroup[] = [];
  let pending: { words: string[]; diagnosis: NotationDiagnosis } | null = null;
  // ТЗ №7 п.1 — merge state: the raw-word group of the LAST-pushed ref column
  // (undefined ⇒ last push wasn't a mergeable ref column). A contraction's two
  // scoring tokens (let/us) share a refWordIdx → they collapse into ONE column
  // showing the raw subtitle word (Let's). An extra between the halves breaks
  // the chain (lastMergeIdx reset) → they stay two columns (cosmetic).
  let lastMergeIdx: number | undefined = undefined;
  // spoken tokens accumulated into the current merged column (for the ВЫ row).
  let lastParts: (string | null)[] = [];
  const flush = () => {
    if (pending && pending.words.length > 0) {
      extras.push({ afterColumn: columns.length - 1, words: pending.words, diagnosis: pending.diagnosis });
    }
    pending = null;
  };

  marks.forEach((m, idx) => {
    if (m.kind === 'extra') {
      if (FILLER_WORDS.has(m.w.toLowerCase())) return; // filler — invisible, not even a word
      const diagnosis = diagnoseExtra(marks, idx);
      if (pending && pending.diagnosis === diagnosis) {
        pending.words.push(m.w);
      } else {
        flush();
        pending = { words: [m.w], diagnosis };
      }
      lastMergeIdx = undefined; // an extra severs contraction-half adjacency
      return;
    }
    flush();
    // ТЗ №7 п.1 — ЭТАЛОН row shows the RAW subtitle word (display) when present,
    // falling back to the normalized token. ВЫ row keeps showing the spoken word.
    const rawRef = m.display ?? ((m.kind === 'wrong' || m.kind === 'ending') ? (m.expected ?? m.w) : m.w);
    const spokenPart = m.kind === 'missing' ? null : m.w;

    if (m.refWordIdx != null && lastMergeIdx === m.refWordIdx && columns.length > 0) {
      // Fold this contraction half into the previous column.
      const col = columns[columns.length - 1];
      lastParts.push(spokenPart);
      if (notationKindRank(m.kind) > notationKindRank(col.kind)) col.kind = m.kind;
      const nonNull = lastParts.filter((p): p is string => p != null);
      // All-ok merge ⇒ show the raw contraction on the ВЫ row too (it matched);
      // otherwise show what was actually heard for the said halves (or empty).
      col.you = notationKindRank(col.kind) === 0 ? col.ref : (nonNull.length ? nonNull.join(' ') : null);
      return;
    }

    const col: NotationColumn = { ref: rawRef, you: spokenPart, kind: m.kind };
    columns.push(col);
    lastParts = [spokenPart];
    lastMergeIdx = m.refWordIdx;
  });
  flush();

  return { columns, extras };
}

function notationKindColor(kind: WordKind): string {
  if (kind === 'ending') return 'var(--warn, #E0B341)';
  if (kind === 'wrong') return 'var(--danger, #ef4444)';
  if (kind === 'missing') return 'var(--fg-mute, #64748b)';
  return 'var(--fg, #e2e8f0)';
}

/**
 * B1 committed verdict — two aligned rows (ЭТАЛОН/ВЫ) + out-of-grid extras.
 * Renders ONCE for a given `marks` snapshot (freeze-glyphs: the CALLER is
 * responsible for not re-invoking this with a recomputed `marks` for an
 * already-painted attempt — see ShadowHoldOverlay's `frozenNotation`
 * useMemo, which pins marks to the exerciseId that produced them).
 */
export const ShadowVerdictNotation: React.FC<{ marks: WordMark[] }> = ({ marks }) => {
  const t = useT();
  const { columns, extras } = buildVerdictNotation(marks);
  const extrasAfter = (col: number) => extras.filter(e => e.afterColumn === col);
  const diagLabel = (d: NotationDiagnosis) =>
    d === 'added' ? t('player.shadowVerdictAdded')
      : d === 'misheard' ? t('player.shadowVerdictMisheard')
        : t('player.shadowVerdictUnknown');

  const renderExtraGroup = (g: NotationExtraGroup, key: string) => (
    <div
      key={key}
      data-testid="shadow-verdict-extra"
      data-diagnosis={g.diagnosis}
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', margin: '0 3px' }}
    >
      {/* empty ref-row cell above the extra — "над ним пустая клетка эталона" */}
      <span style={{ fontSize: 12, lineHeight: '16px', color: 'transparent' }}>·</span>
      <span style={{
        fontSize: 11, fontStyle: 'italic', color: 'var(--fg-mute, #64748b)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, lineHeight: 1.3,
      }}>
        <span>{g.words.length > 1 ? `▸ +${g.words.length}` : `+${g.words[0]}`}</span>
        <span style={{ fontSize: 9, opacity: .75 }}>{diagLabel(g.diagnosis)}</span>
      </span>
    </div>
  );

  return (
    <div data-testid="shadow-verdict-notation" style={{ display: 'flex', alignItems: 'flex-end', flexWrap: 'wrap', gap: 2 }}>
      {extrasAfter(-1).map((g, i) => renderExtraGroup(g, `pre-${i}`))}
      {columns.map((c, i) => (
        <React.Fragment key={i}>
          <div data-testid="shadow-verdict-col" data-kind={c.kind} style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 18,
          }}>
            <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--fg-mute, #64748b)' }}>{c.ref}</span>
            <span style={{ fontSize: 14, fontWeight: 600, color: notationKindColor(c.kind) }}>
              {c.you ?? '····'}
            </span>
          </div>
          {extrasAfter(i).map((g, gi) => renderExtraGroup(g, `x-${i}-${gi}`))}
        </React.Fragment>
      ))}
    </div>
  );
};

/**
 * Freeze-glyphs PARTIAL state — "нейтральная СЕРАЯ строка... БЕЗ
 * вердикт-цвета". Used while an attempt hasn't committed yet (non-final/
 * timeout outcomes carrying a `partial` text) — deliberately NOT run
 * through the matcher at all (no word-level colouring exists until
 * commit), just the raw text in a single muted, italic line.
 */
export const ShadowVerdictPartial: React.FC<{ text: string }> = ({ text }) => (
  <div data-testid="shadow-verdict-partial" style={{
    color: 'var(--fg-mute, #64748b)', fontStyle: 'italic', opacity: .75, fontSize: 13,
    transition: 'opacity 160ms ease', // ≤200ms hand-off feel, symmetric with the commit repaint
  }}>{text}</div>
);

// One row of the attempts feed (F3). `marks`/`heard` are only non-null for the
// single row that represents the CURRENT lastMarks/lastMatchPct/lastSpoken
// state — see the file-header WEB-SEAM note on why older rows can only ever
// be score-only (PanelAttempts never retains marks/text).
interface FeedRow {
  key: string
  loopNo: number
  matchPct: number
  recordingId: string | null
  marks: WordMark[] | null
  heard: string | null
  /** ТЗ №3 п.3 — heard transcript for a history one-liner ("услышано: {text}"). */
  text: string | null
}

// ── T5 (D1) — right-click "customText" context menu ──────────────────────────
// Owner decision D1: NOT a persistent settingsRow field (WEB-CUT above lists
// settingsRow as dropped — "V1 has no auto-loop, no custom-text mode"). T5
// instead adds a right-click menu on the card, ALWAYS available regardless of
// whether a subtitle/referenceText is currently shown ("текст важнее
// субтитра" — task-T5-brief.md §1/§3). The menu itself is a small floating
// popover with an inline editor (textarea + Save), not a permanent frame —
// closes on backdrop click/right-click-elsewhere. `onSave`/`onClear` are
// PURE UI callbacks — this component does not know or care which of the
// three BL1 delivery paths (manual/ephemeral/persisted — see useShadowRuntime
// .setCustomText's own doc) the caller wires them to; that wiring is a later
// (T7/smoke-gate) integration task.
interface CustomTextMenuState {
  x: number
  y: number
  editing: boolean
}

function menuItemStyle(): React.CSSProperties {
  return {
    display: 'block', width: '100%', textAlign: 'left',
    background: 'transparent', border: 'none', color: 'var(--fg, #e2e8f0)',
    padding: '6px 8px', borderRadius: 5, cursor: 'pointer',
    fontFamily: 'inherit', fontSize: 13,
  };
}

const CustomTextMenu: React.FC<{
  state: CustomTextMenuState
  initialText: string
  onClose: () => void
  onStartEdit: () => void
  onSave: (text: string) => void
  onClear: () => void
}> = ({ state, initialText, onClose, onStartEdit, onSave, onClear }) => {
  const t = useT();
  const [draft, setDraft] = useState(initialText);

  return (
    <>
      {/* Backdrop — click (or right-click) elsewhere closes the menu without
          committing anything, same convention as any floating popover. */}
      <div
        data-testid="shadow-context-menu-backdrop"
        onClick={onClose}
        onContextMenu={(e) => { e.preventDefault(); onClose(); }}
        style={{ position: 'fixed', inset: 0, zIndex: 40 }}
      />
      <div
        data-testid="shadow-context-menu"
        style={{
          position: 'fixed', left: state.x, top: state.y, zIndex: 41,
          minWidth: 220,
          background: 'var(--panel, #16181d)', border: '1px solid var(--border, #334155)',
          borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
          padding: 6, display: 'flex', flexDirection: 'column', gap: 4,
          fontFamily: 'var(--ui-font, system-ui)', fontSize: 13, color: 'var(--fg, #e2e8f0)',
        }}
      >
        {!state.editing ? (
          <>
            {/* ALWAYS visible — no gate on referenceText/subtitle presence. */}
            <button
              data-testid="shadow-menu-set-customtext"
              onClick={onStartEdit}
              style={menuItemStyle()}
            >{t('player.shadowSetCustomText')}</button>
            <button
              data-testid="shadow-menu-clear-customtext"
              onClick={onClear}
              style={menuItemStyle()}
            >{t('player.shadowClearCustomText')}</button>
          </>
        ) : (
          // Inline editor — a small popover field, not a permanent frame
          // (brief §1: "маленькое поле/модал ИЗ меню, НЕ постоянный кадр").
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 4 }}>
            <textarea
              data-testid="shadow-customtext-input"
              value={draft}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t('player.shadowCustomTextPlaceholder')}
              rows={3}
              style={{
                resize: 'vertical', fontFamily: 'inherit', fontSize: 13,
                background: 'var(--btn-bg, rgba(0,0,0,0.25))', color: 'var(--fg, #e2e8f0)',
                border: '1px solid var(--border, rgba(255,255,255,0.10))', borderRadius: 5,
                padding: '6px 8px',
              }}
            />
            <button
              data-testid="shadow-customtext-save"
              onClick={() => onSave(draft)}
              style={{ ...menuItemStyle(), textAlign: 'center', fontWeight: 600 }}
            >{t('player.shadowCustomTextSave')}</button>
          </div>
        )}
      </div>
    </>
  );
};

export const ShadowCard: React.FC<{
  shadow: ShadowV1Api
  /**
   * Срез A (п.5) — hands-free rec-strip. При true кнопка «Записать»
   * (V1 push-to-record) НЕ рендерится вообще; вместо неё в rec-strip живёт
   * только «Стоп» → `shadow.deactivate()` (десктоп-канон ShadowChat.tsx
   * :744-750, где Стоп === onDeactivate, а не stopRecording). V1 push-to-record
   * «окончательно мёртв» (owner CONCERN #1) — на вебе активация/деактивация
   * hands-free (пилюля/S/R = toggle, арм по субтитру/AB). По умолчанию false —
   * оставляет прежнее V1-поведение (Записать/стоп-запись) для standalone
   * V1-тестов карты, которые handsFree не передают. */
  handsFree?: boolean
  /** T5 (D1): current customText value (from ShadowState/exercise), if any —
   *  seeds the inline editor when the menu re-opens. `null`/absent = unset. */
  customText?: string | null
  /**
   * T5 (D1 + BL1-delivery): commit (`text`) or clear (`null`) a customText
   * value from the right-click menu. Optional — no production caller wires
   * this into a real setter yet (this card still renders `shadow: ShadowV1Api`,
   * a DIFFERENT — currently shipped — hook than the useShadowRuntime/
   * useShadowLoopCoordinator system T2-T4 built `setCustomText` on; wiring the
   * two together is a later integration task, see file's WEB-SEAM notes and
   * task-T5-brief.md's own "наследуется химерой в T7" framing). The menu
   * itself is fully functional and ALWAYS rendered regardless of this prop's
   * presence — omitting it just makes Save/Clear no-ops.
   */
  onSetCustomText?: (text: string | null) => void
  /**
   * HIGH-2 (fix-wave среза B) — ОТДЕЛЬНЫЙ путь для textarea-ввода custom-текста.
   * `onSetCustomText` (=runtime.setCustomText) на пустой строке ставит
   * mode:'subtitle' (легитимно для right-click-меню «Clear»), но textarea гейтится
   * `settings.mode==='custom'` — тот же мод-флип синхронно размонтировал бы поле,
   * когда юзер просто стирает текст. Этот колбэк пишет customText БЕЗ смены mode
   * (state + арм-доставка, как desktop useShadow.ts:622 state-only setCustomText).
   * Фолбэк на `onSetCustomText`, если не передан (обратная совместимость со
   * standalone-V1/DebugShadowCard-тестами, которые проп не передают). */
  onCustomTextInput?: (text: string) => void
  /**
   * T9 (bind-panel "ПРИВЯЗКА", lift ShadowChat.tsx :951-998 `bindRowFull`) —
   * the 3 real persist-callback names (ShadowChat.tsx :469-478 + desktop
   * index.tsx :4460-4499): clicking the segmented control persists the
   * shadow exercise into the SAME annotations store drawing-tool exercises
   * live in (T2 useAnnotations — deleteShadowExercise / addShadowExercise +
   * bindToCue / bindShadowExerciseAtTime equivalents). Optional — same
   * "no production caller wires this yet" status as `onSetCustomText` above:
   * PlayerPage.tsx does not yet pass `useAnnotations`/`cues`/`ws` into this
   * card, so wiring these three into real CRUD is a later integration task.
   * Omitting them just makes the bind buttons a local-only toggle.
   */
  onBindOff?: () => void
  onBindToSubtitle?: () => void
  onBindToTime?: () => void
  /** Parent-computed timecode next to the segmented control (desktop
   *  index.tsx :4494-4498: formatTime(currentTime) for 'now',
   *  formatTime(cue.startTime) for 'subStart', '' for 'off'/no target).
   *  Not computed in here — this card has no currentTime/cue prop. */
  bindTC?: string
  /**
   * F2 (ShadowChat.tsx :443-446, props doc) — anchor-grip pointer-drag on
   * the bind row releases with a raw [0,1] fraction of barRect's width;
   * this component does NOT convert it to a time itself — the CALLER maps
   * it via `dropTimeFromFraction(fraction, viewStart, viewEnd)` (./drop-time,
   * lifted verbatim alongside this task). [BL2, audit/28]: the timeline bar
   * renders the VIEW WINDOW, not the whole clip — `fraction * duration`
   * breaks as soon as the user has zoomed (viewStart>0), landing the
   * exercise at the wrong absolute time.
   */
  onAnchorDrop?: (fraction: number) => void
  /**
   * Same shape/status as `useShadowRuntime.ts`'s own `setShadowState` prop
   * (:122, "no ShadowState owner is wired into this hook on web yet") —
   * this card's bind segmented-control selection has no external owner
   * either yet. `handleBind` calls this in addition to the 3 persist
   * callbacks above, mirroring desktop's `setBind(next)` (ShadowChat.tsx
   * :470) firing alongside the `onBindOff`/`onBindToSubtitle`/`onBindToTime`
   * persist call on every click.
   */
  setShadowState?: (patch: Partial<Pick<ShadowState, 'bind'>>) => void
  /**
   * Срез A (L-6) — сид локального `bind`-стейта сегмент-контрола ПРИВЯЗКА при
   * (ре)монтировании. Дефолт 'off' сохраняет прежнее поведение для standalone
   * V1-тестов/DebugShadowCard (которые проп не передают). Живой caller
   * (PlayerPage) передаёт shadowState.bind (INITIAL_SHADOW_STATE.bind='subStart'),
   * чтобы после remount подсветка отражала реальное состояние, а не врала 'off'.
   */
  initialBind?: ShadowBind
  /**
   * ТЗ №3 п.4 — settingsRow УШЁЛ из карты в бар (ShadowSettingsRow, рендерит
   * WorkspacePanelThemed). `settings` ПРОП ОСТАЁТСЯ, но теперь ТОЛЬКО гейтит
   * custom-режим targetPanel ниже (`settings?.mode === 'custom'` → textarea
   * вместо строки «ОЖИДАЕТСЯ»). Снимок ShadowState-полей, значения только для
   * отрисовки. Дефолт (проп не передан) сохраняет DebugShadowCard/standalone-V1
   * без изменений.
   * OWNER DECISION #12 (documented, not a bug): the settings row lives in the
   * workspace bar (ShadowSettingsRow) and the card unmounts when the timeline is
   * collapsed (PlayerPage `!timelineCollapsed` gate), so settings are deliberately
   * unreachable while collapsed — collapsing is "leave shadowing", not "keep it
   * armed but hidden". */
  settings?: {
    advanceEnabled: boolean
    advanceThreshold: number
    mode: ShadowMode
    loopMode: boolean
  }
  /** ТЗ №3 п.4 — типы сохранены (владелец: «оставь тип»), но карта их больше НЕ
   *  рендерит: тумблер/слайдер/режим/повтор живут в ShadowSettingsRow (бар).
   *  PlayerPage теперь передаёт их туда, а не в карту. */
  onAdvanceEnabledChange?: (enabled: boolean) => void
  onAdvanceThresholdChange?: (threshold: number) => void
  onModeChange?: (mode: ShadowMode) => void
  onLoopModeChange?: (loopMode: boolean) => void
  /**
   * Срез D — живой partial из RealtimeAnswerSource. Когда непустой, dashed answer
   * block показывает его (курсив, пульс-точка) ВМЕСТО плейсхолдера/прошлого ответа
   * (десктоп-канон ShadowChat.tsx:862-883, `partialText || «Жду ваш ответ…»`).
   * `null`/`undefined`/`''` = нет живого партиала (Fake-режим или между попытками) →
   * прежний фолбэк (плейсхолдер / lastSpoken). Дефолт сохраняет standalone-V1/
   * DebugShadowCard без изменений (проп не передают). */
  partialText?: string | null
  /**
   * ТЗ №2 [ID:P-hotfix-quota-ux] — баннер недоступности источника распознавания.
   * Браузерный WebSocket не отдаёт JS статус/тело провалившегося upgrade, поэтому
   * RealtimeAnswerSource.onUnavailable (переход gate→dead) прокидывается сюда
   * PlayerPage'ем как человекочитаемое уведомление. reason 'quota_exhausted' →
   * лимит месяца (+дата обновления из resetsAt, если есть); 'unavailable' →
   * сервис временно недоступен. `null`/`undefined` = всё в порядке, баннер скрыт.
   * Дефолт сохраняет standalone-V1/DebugShadowCard без изменений (проп не передают). */
  unavailableNotice?: { reason: 'quota_exhausted' | 'unavailable'; resetsAt?: string } | null
}> = ({
  shadow, handsFree = false, customText = null, onSetCustomText, onCustomTextInput,
  onBindOff, onBindToSubtitle, onBindToTime, bindTC = '', onAnchorDrop, setShadowState,
  initialBind = 'off',
  settings, // ТЗ №3 п.4: only gates the custom-mode targetPanel now (row moved to bar)
  partialText = null,
  unavailableNotice = null,
}) => {
  const t = useT()
  const lang = useLocale()
  const {
    phase, errorCode, remainingSec, referenceText, cueIndex, lastMarks, lastMatchPct,
    lastSpoken, capped, recordAudioUrl, analyserNode, shadowAttempts, recordings,
    startRecording, stopRecording, dismissResult, deactivate, selectRecording,
  } = shadow
  const youTrackRecordingId = useVideoPlayerStore(s => s.youTrackRecordingId)

  // ── T9 — bind segmented-control state ("выкл"/"к субтитру"/"сейчас"),
  // VERBATIM handler shape from ShadowChat.tsx :469-478 (`handleBind`). No
  // external ShadowState owner is wired into this card yet (see
  // `setShadowState` prop's own doc above) — tracked locally, same role as
  // desktop's `shadow.bind` field for the segmented control's highlight.
  const [bind, setBind] = useState<ShadowBind>(initialBind)
  const handleBind = useCallback((next: ShadowBind) => {
    setBind(next)
    setShadowState?.({ bind: next })
    // Tell the parent to persist / clear the exercise. Each click on the
    // bind segmented control is a user-driven save event (verbatim comment,
    // ShadowChat.tsx :471-474).
    if (next === 'off') onBindOff?.()
    else if (next === 'subStart') onBindToSubtitle?.()
    else if (next === 'now') onBindToTime?.()
  }, [setShadowState, onBindOff, onBindToSubtitle, onBindToTime])
  // F2 — anchor grip pointer-drag state (ShadowChat.tsx :564-565).
  const [anchorDragging, setAnchorDragging] = useState(false)

  // ── T8 drag-to-dock — WEB-SEAM: dock/freePos/dockHint come from the web
  // video-player-store (module-level useSyncExternalStore) instead of
  // desktop's zustand slice; same field names/shapes (DockSide, {x,y}|null).
  const dock = useVideoPlayerStore(s => s.shadowChatDock)
  const setDock = useVideoPlayerStore(s => s.setShadowChatDock)
  const freePos = useVideoPlayerStore(s => s.shadowChatFreePos)
  const setFreePos = useVideoPlayerStore(s => s.setShadowChatFreePos)
  const setDockHint = useVideoPlayerStore(s => s.setShadowChatDockHint)
  // ТЗ №3 п.1 — persisted resize {w,h}; used for the card's free-float size AND
  // (via dockedWidth) the timeline's docked inset in WorkspacePanelThemed.
  const size = useVideoPlayerStore(s => s.shadowChatSize)
  const setSize = useVideoPlayerStore(s => s.setShadowChatSize)

  const containerRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)

  // ── ТЗ №3 п.1 — corner resize (top-left + bottom-right). The card is anchored
  // bottom-right, so the NW handle grows it up/left and the SE handle grows it
  // down/right; both write a clamped {w,h} to the store (persisted). Pointer math
  // is corner-relative: NW moves the top-left while the anchor stays put, so a
  // leftward/upward drag INCREASES size (dx/dy negated); SE is the plain case.
  const resizeRef = useRef<
    { corner: 'nw' | 'se'; startX: number; startY: number; startW: number; startH: number
      startFreeX: number | null; startFreeY: number | null; live: ShadowSize | null } | null
  >(null)
  // MED-7 — LIVE size during a resize drag. ТЗ №5 п.1: moved from local state into
  // the store (emit-only field shadowChatSizeLive, NO localStorage) so BOTH the
  // card (visual grow) AND the timeline reserve (WorkspacePanelThemed) read the
  // SAME live value → the bottom-panel inset TRACKS the drag in real time, not
  // just on pointerup («меняю ширину — резерв не меняется»). Persist to
  // shadowChatSize happens ONCE on pointerup (localStorage-storm still avoided).
  const liveResize = useVideoPlayerStore(s => s.shadowChatSizeLive)
  const setLiveResize = useVideoPlayerStore(s => s.setShadowChatSizeLive)
  const onResizeDown = useCallback((corner: 'nw' | 'se') => (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault(); e.stopPropagation()
    const el = containerRef.current
    const rect = el ? el.getBoundingClientRect() : null
    const startW = size?.w ?? (rect ? rect.width : DOCKED_WIDTH)
    const startH = size?.h ?? (rect ? rect.height : 320)
    resizeRef.current = {
      corner, startX: e.clientX, startY: e.clientY, startW, startH,
      // MED-6: snapshot the free-float anchor so an NW drag can compensate it.
      startFreeX: freePos?.x ?? null, startFreeY: freePos?.y ?? null, live: null,
    }
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId) } catch { /* jsdom/unsupported */ }
  }, [size, freePos])
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const r = resizeRef.current
      if (!r) return
      const dx = e.clientX - r.startX
      const dy = e.clientY - r.startY
      // NW handle: anchor is bottom-right → dragging the top-left corner
      // outward (up/left, negative dx/dy) must GROW the box.
      const w = r.corner === 'nw' ? r.startW - dx : r.startW + dx
      const h = r.corner === 'nw' ? r.startH - dy : r.startH + dy
      const vw = typeof window !== 'undefined' ? window.innerWidth : 1920
      const vh = typeof window !== 'undefined' ? window.innerHeight : 1080
      const next = clampShadowSize(w, h, vw, vh)
      // MED-7: local live-size only (no persist mid-drag).
      r.live = next
      setLiveResize(next)
      // MED-6: in freePos mode the anchor is top-LEFT, so an unmodified NW drag
      // would grow the box DOWN-RIGHT and the corner would run away from the
      // cursor. Shift the anchor by the raw delta so the bottom-right stays pinned
      // and the NW handle tracks the pointer. (Pristine bottom-right anchor grows
      // up/left correctly on its own — no compensation there, hence the guard.)
      if (r.corner === 'nw' && r.startFreeX != null && r.startFreeY != null) {
        setFreePos({ x: r.startFreeX + dx, y: r.startFreeY + dy })
      }
    }
    const onUp = () => {
      const r = resizeRef.current
      resizeRef.current = null
      if (r && r.live) setSize(r.live) // MED-7: single persist+emit at gesture end
      setLiveResize(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    // LOW: a pointercancel (OS gesture takeover / capture loss) ends the drag the
    // same way as pointerup — otherwise resizeRef would stay armed and the next
    // stray pointermove would resume resizing.
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      // ТЗ №5 п.1: unmount mid-drag must not leave a stale live-size inflating the
      // reserve (store field is a singleton, outlives this card).
      if (resizeRef.current) { resizeRef.current = null; setLiveResize(null) }
    }
  }, [setSize, setFreePos, setLiveResize])

  // Bar rect tracking — VERBATIM from ShadowChat.tsx :517-562. Needed because
  // the workspace bar mounts on demand (WorkspacePanel only renders it while
  // !timelineCollapsed) — polling at 250ms is what hooks up the snap zone
  // once the bar appears/disappears later. WEB-SEAM: same `[data-workspace-
  // bar]` selector target as desktop; on web it's WorkspacePanelThemed.tsx's
  // root div (already carries the attribute, ported at T2/T-RULE).
  const [barRect, setBarRect] = useState<DOMRect | null>(null)
  const barRectRef = useRef<DOMRect | null>(null)
  useEffect(() => {
    let observed: HTMLElement | null = null
    let ro: ResizeObserver | null = null
    const commit = (next: DOMRect | null) => {
      const prev = barRectRef.current
      const same = !!prev && !!next
        && Math.abs(prev.left - next.left) <= 0.5
        && Math.abs(prev.top - next.top) <= 0.5
        && Math.abs(prev.width - next.width) <= 0.5
        && Math.abs(prev.height - next.height) <= 0.5
      if (same) return
      if (!prev && !next) return
      barRectRef.current = next
      setBarRect(next)
    }
    const update = () => {
      const target = document.querySelector<HTMLElement>('[data-workspace-bar]')
      if (!target) {
        if (observed) { ro?.disconnect(); observed = null }
        commit(null)
        return
      }
      if (target !== observed) {
        ro?.disconnect()
        ro = new ResizeObserver(() => commit(target.getBoundingClientRect()))
        ro.observe(target)
        observed = target
      }
      commit(target.getBoundingClientRect())
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    const id = window.setInterval(update, 250)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
      window.clearInterval(id)
    }
  }, [])

  const dragRef = useRef<{ startX: number; startY: number; started: boolean; initX: number; initY: number } | null>(null)
  const [livePos, setLivePos] = useState<{ x: number; y: number } | null>(null)
  const [snapHint, setSnapHint] = useState<DockSide>(null)
  // ТЗ №8 п.3 — драг НИКОГДА не деактивирует shadowing. Заголовок берёт
  // pointer-capture (ТЗ №6 п.5), и браузер после дропа синтезирует `click`, который
  // по capture-пути попадает на крестик × (data-testid=shadow-close, onClick=
  // deactivate) ВНУТРИ заголовка → карта unmount, пилюля off (live-репро
  // оркестратора: header-drag → дроп над видео → shadowing off). Флаг взводится на
  // pointerup РЕАЛЬНОГО драга (started) и гасит следующий click в capture-фазе
  // контейнера карты — до того, как он дойдёт до onClick крестика. Клик БЕЗ
  // предшествующего драга (осознанное закрытие ×) не тронут.
  const suppressClickRef = useRef(false)

  // Snap-zone height = exactly the workspace bar. VERBATIM from
  // ShadowChat.tsx :574-583.
  const detectSnap = useCallback((clientX: number, clientY: number): DockSide => {
    if (!barRect) return null
    const inVerticalRange = clientY >= barRect.top && clientY <= barRect.bottom
    if (!inVerticalRange) return null
    if (Math.abs(clientX - barRect.left) <= SNAP_ZONE_PX) return 'left'
    if (Math.abs(clientX - barRect.right) <= SNAP_ZONE_PX) return 'right'
    if (clientX > barRect.left && clientX < barRect.left + DOCKED_WIDTH * 0.7) return 'left'
    if (clientX < barRect.right && clientX > barRect.right - DOCKED_WIDTH * 0.7) return 'right'
    return null
  }, [barRect])

  // ТЗ №6 п.5 [ID:P-tz6] — POINTER-версия (было VERBATIM mouse из ShadowChat.tsx
  // :585-595). Быстрый undock-драг «залипал»: карта позиционируется window-
  // mousemove/mouseup, но когда курсор при рывке уходил ЗА пределы окна, window
  // эти события не получал → pointerup не обрабатывался, карта застревала («не
  // понимает, что я отпустил» — владелец, видео 23-39, 7:23–8:20). Фикс:
  // setPointerCapture на заголовке — захваченные pointer-события доставляются в
  // элемент (и всплывают до window) ДАЖЕ когда указатель вне окна. jsdom capture
  // не реализует → try/catch (тот же приём, что resize/anchor-grip выше).
  const handleHeaderPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return
    const el = containerRef.current
    if (!el) return
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* jsdom/unsupported */ }
    const rect = el.getBoundingClientRect()
    dragRef.current = {
      startX: e.clientX, startY: e.clientY,
      started: false,
      initX: rect.left, initY: rect.top,
    }
  }, [])

  // Global pointermove/pointerup (ТЗ №6 п.5: было mousemove/mouseup). С capture на
  // заголовке эти события приходят даже за пределами окна, всплывая до window.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return
      const dx = e.clientX - drag.startX
      const dy = e.clientY - drag.startY
      if (!drag.started) {
        if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return
        drag.started = true
        setDragging(true)
        setLivePos({ x: drag.initX, y: drag.initY })
        return
      }
      const nx = drag.initX + dx
      const ny = drag.initY + dy
      setLivePos({ x: nx, y: ny })
      const snap = detectSnap(e.clientX, e.clientY)
      setSnapHint(snap)
      setDockHint(snap)
    }
    const onUp = (e: PointerEvent) => {
      const drag = dragRef.current
      dragRef.current = null
      if (!drag?.started) { setDragging(false); return }
      setDragging(false)
      // ТЗ №8 п.3 — это был РЕАЛЬНЫЙ драг: подавить синтетический post-drag click
      // (браузер шлёт его после pointer-capture-дропа; по capture-пути он бьёт по
      // крестику × внутри заголовка → deactivate). Флаг снимет onClickCapture
      // контейнера на приходе этого click; safety-таймаут — если click не придёт
      // (иначе следующий осознанный клик × был бы съеден).
      suppressClickRef.current = true
      window.setTimeout(() => { suppressClickRef.current = false }, 400)
      const snap = detectSnap(e.clientX, e.clientY)
      setSnapHint(null)
      setDockHint(null)
      if (snap) {
        setDock(snap)
        setLivePos(null)
      } else {
        setDock(null)
        if (livePos) setFreePos(livePos)
        setLivePos(null)
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    // pointercancel (OS/gesture takeover, capture loss) завершает драг как pointerup —
    // иначе dragRef остался бы взведён и следующий pointermove продолжил бы драг.
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [detectSnap, livePos, setDock, setFreePos, setDockHint])

  // Choose layout: docked = compact (3 zones + vertical bind rail on desktop).
  // WEB-SEAM / deliberate scope cut (see file-header note above the T8 block):
  // desktop's compact branch swaps in a whole alternate two-column + 3D-flip
  // JSX tree (ShadowChat.tsx :744-1155,1264-1273) — explicitly WEB-CUT from
  // this file and NOT reintroduced by T8 (out of this task's scope: T8 is the
  // drag/dock/inset mechanic, not the compact visual redesign). `compact` is
  // still derived here (byte-parity with desktop's own variable, and a real
  // hook for whoever picks up the compact-layout follow-up) but this card's
  // JSX below is unconditional — it does not branch on it yet.
  const compact = dock !== null
  void compact

  // Resolved container style per mode — VERBATIM shape from ShadowChat.tsx
  // :646-695, WEB-SEAM only in the final (pristine) fallback branch: desktop
  // always falls back to a hardcoded lower-left free-float; this card instead
  // preserves its PRE-EXISTING anchor (right:12/bottom:220 + the Ф1 two-part
  // maxHeight cap, see the JSX below) until the user's first real drag writes
  // a freePos — so the 705-test baseline (none of which ever drag) renders
  // byte-identical to before T8.
  const containerStyle = useMemo<React.CSSProperties>(() => {
    // ТЗ №3 п.1 — the card's width follows the user's saved resize (fallback
    // 420); `dw` also drives the docked-right left-offset so the card lines up
    // with the inset WorkspacePanelThemed reserves. size===null → dw=420, so the
    // pre-ТЗ-3 test baseline (drag-dock/accept-#1/Ф1, none of which set a size)
    // renders byte-identical.
    // MED-7: prefer the live drag size (local) over the persisted store size so
    // the card visibly grows while dragging, before the pointerup persist lands.
    const effSize = liveResize ?? size
    const dw = effSize?.w ?? DOCKED_WIDTH
    const base: React.CSSProperties = {
      position: 'fixed', zIndex: 30,
      width: dw,
      background: 'var(--panel, rgba(15,15,20,0.92))',
      border: '1px solid var(--border, #334155)',
      borderRadius: 10, fontFamily: 'var(--ui-font, system-ui)', color: 'var(--fg, #e2e8f0)',
      overflow: 'hidden', backdropFilter: 'blur(6px)',
      boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
      display: 'flex', flexDirection: 'column',
    }
    if (dragging && livePos) {
      return {
        ...base,
        left: livePos.x, top: livePos.y,
        maxHeight: '70vh',
        opacity: 0.92,
        cursor: 'grabbing',
      }
    }
    // ТЗ №4 п.1 — в доке ВИДИМАЯ ширина карты обязана совпадать с таймлайн-
    // резервом (WorkspacePanelThemed dockReserve), иначе широкая карта (size.w >
    // bar/2) перекрывает таймлайн/транспорт. ЕДИНЫЙ источник истины —
    // dockedReserveWidth(effSize, barRect.width): та же формула, тот же barWidth
    // ([data-workspace-bar]), что у резерва. (В free-float карта остаётся на raw
    // effSize.w — там нет привязки к бару.)
    // LOW-note [ID:P-tz4-fix]: карта меряет бар через getBoundingClientRect().width
    // (fractional), а WorkspacePanelThemed-резерв — через clientWidth (округлён до
    // целого, БЕЗ border/scrollbar). Расхождение ≤2px (субпиксель + бордюр) —
    // сознательно НЕ выравниваем: floor(bar/2) в dockedReserveWidth и так гасит
    // дробную часть, а 1-2px визуально неотличимы. НЕ баг, оставлено намеренно.
    if (dock === 'left' && barRect) {
      const dockedW = dockedReserveWidth(effSize, barRect.width)
      return {
        ...base,
        width: dockedW,
        left: barRect.left, top: barRect.top,
        height: barRect.height,
        borderRadius: 0,
        borderRight: '1px solid var(--border-strong, rgba(255,255,255,0.18))',
      }
    }
    if (dock === 'right' && barRect) {
      const dockedW = dockedReserveWidth(effSize, barRect.width)
      return {
        ...base,
        width: dockedW,
        left: barRect.right - dockedW, top: barRect.top,
        height: barRect.height,
        borderRadius: 0,
        borderLeft: '1px solid var(--border-strong, rgba(255,255,255,0.18))',
      }
    }
    if (freePos) {
      // WEB-SEAM: user has dragged the card out to a free-float spot at least
      // once — render at the remembered viewport position (fixed, same
      // coordinate space the drag mousemove handler above uses). A saved height
      // (ТЗ №3 п.1) pins the box; otherwise the 78vh cap keeps it on-screen.
      return {
        ...base,
        left: freePos.x, top: freePos.y,
        ...(effSize?.h ? { height: effSize.h } : {}),
        maxHeight: '78vh',
      }
    }
    // Pristine default (freePos never set) — byte-identical to this file's
    // pre-T8 anchor, so the existing accept-#1/Ф1 test suite is untouched
    // (size===null there). A saved height pins the box top-anchor-aware.
    return {
      ...base,
      position: 'absolute',
      right: 12, bottom: 220,
      ...(effSize?.h ? { height: effSize.h } : {}),
      maxHeight: 'min(78vh, calc(100vh - 240px))',
    }
  }, [dock, barRect, dragging, livePos, freePos, size, liveResize])

  // T5 (D1) — right-click context menu state (position + editing sub-state).
  // `null` = closed. ALWAYS openable via onContextMenu on the card container
  // below, regardless of phase/referenceText — "текст важнее субтитра" means
  // the ENTRY POINT (the menu item) is never gated on subtitle presence, not
  // that the customText itself silently overrides recording/error UI.
  const [customTextMenu, setCustomTextMenu] = useState<CustomTextMenuState | null>(null)
  const handleCardContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    setCustomTextMenu({ x: e.clientX, y: e.clientY, editing: false })
  }

  const errText = errorCode ? t(`player.shadowErr.${errorCode}`) : ''
  const recording = phase === 'recording'
  const transcribing = phase === 'transcribing'
  const captionFont = lang === 'ru' ? 'var(--caption-font-ru, var(--ui-font, system-ui))' : 'var(--caption-font-en, var(--ui-font, system-ui))'

  // ── F3: attempts feed rows (byte-faithful "Loop N" / pctTone / heardLine) ──
  // Historical rows come straight from shadowAttempts (score-only, per-cue).
  // The newest row (if one exists) is synthesized from lastMarks/lastMatchPct/
  // lastSpoken instead — that's the ONLY place a full diff is still available
  // (see header note). recordingId is joined positionally against `recordings`
  // filtered to this cue, oldest→newest — recordings only ever holds entries
  // added THIS session (V1 has no persisted audio across reloads), so it is
  // always the tail of the per-cue attempt history, never a prefix.
  const cueKey = String(cueIndex)
  const scored = shadowAttempts[cueKey]?.attempts ?? []
  const hasLatest = lastMarks != null
  const historyScored = hasLatest ? scored.slice(0, -1) : scored
  const liveRecordingsForCue = recordings.filter(r => r.cue_index === cueIndex)
  const latestRec = hasLatest ? (liveRecordingsForCue[liveRecordingsForCue.length - 1] ?? null) : null
  const historicalLiveRecordings = hasLatest ? liveRecordingsForCue.slice(0, -1) : liveRecordingsForCue
  const historicalOffset = historyScored.length - historicalLiveRecordings.length

  // ТЗ №3 п.3 — history one-liners carry the heard `text` (now threaded through
  // PanelAttempts, shadow-attempts.ts) so they render "повтор N · % · услышано:
  // {text}". Newest-first; the latest attempt (with a full B1 diff) is a
  // SEPARATE block above, not part of the history list.
  const historyRows: FeedRow[] = historyScored.map((s, i) => {
    const liveIdx = i - historicalOffset
    const rec = liveIdx >= 0 ? historicalLiveRecordings[liveIdx] : null
    return {
      key: rec?.id ?? `hist-${cueKey}-${i}`,
      loopNo: i + 1,
      matchPct: s.match_pct,
      recordingId: rec?.id ?? null,
      marks: null,
      heard: null,
      text: s.text ?? null,
    }
  })
  const historyNewestFirst = [...historyRows].reverse()
  const latestRow: FeedRow | null = hasLatest ? {
    key: latestRec?.id ?? `latest-${cueKey}`,
    loopNo: historyRows.length + 1,
    matchPct: lastMatchPct ?? 0,
    recordingId: latestRec?.id ?? null,
    marks: lastMarks,
    heard: lastSpoken,
    text: lastSpoken,
  } : null

  // ТЗ №3 п.2 — zero-scroll: measure the feed container and cap how many history
  // one-liners render (the rest collapse into a single "+K ранних" line). Height
  // starts at +Infinity ("unmeasured" → show all) so the pre-ТЗ-3 tests, which
  // render in jsdom (no real layout → getBoundingClientRect height 0), keep
  // seeing every attempt; only a REAL positive measurement (browser, or a test
  // that mocks getBoundingClientRect) triggers collapse.
  // HIGH-1 fix: the feed div exists ONLY while hasAnyFeed. The previous
  // `useLayoutEffect(…, [])` attached the measurement once at mount — when the
  // feed was still absent (el===null → early return) it never re-ran, so feedH
  // stayed +Infinity forever, EVERY row rendered, overflow:hidden clipped the
  // bottom, and "+K ранних" never appeared on the main arm-with-attempts path. A
  // CALLBACK ref re-attaches the ResizeObserver the instant the feed element
  // mounts/unmounts, so the first arm that produces attempts is measured.
  const [feedH, setFeedH] = useState<number>(Number.POSITIVE_INFINITY)
  const feedRoRef = useRef<ResizeObserver | null>(null)
  const feedRef = useCallback((el: HTMLDivElement | null) => {
    feedRoRef.current?.disconnect(); feedRoRef.current = null
    if (!el) return
    const measure = () => {
      const h = el.getBoundingClientRect().height
      if (h > 0) setFeedH(h) // ignore the jsdom/no-layout 0 → stays "show all"
    }
    measure()
    const ro = new ResizeObserver(measure); ro.observe(el)
    feedRoRef.current = ro
  }, [])
  // MED-10: the latest B1 block's height is MEASURED, not a fixed FEED_LATEST_H
  // guess — a long "услышано" reply + flexWrap notation can push it to 150-250px,
  // and an under-count of the reserved height inflates N and clips the feed bottom
  // invisibly. FEED_LATEST_H stays the primary fallback until a real measurement
  // lands (jsdom height 0 → keep the constant).
  const [latestH, setLatestH] = useState<number>(FEED_LATEST_H)
  const latestRoRef = useRef<ResizeObserver | null>(null)
  const latestRef = useCallback((el: HTMLDivElement | null) => {
    latestRoRef.current?.disconnect(); latestRoRef.current = null
    if (!el) { setLatestH(FEED_LATEST_H); return }
    const measure = () => {
      const h = el.getBoundingClientRect().height
      if (h > 0) setLatestH(h)
    }
    measure()
    const ro = new ResizeObserver(measure); ro.observe(el)
    latestRoRef.current = ro
  }, [])
  const { visibleHistory, hiddenEarly } = computeVisibleFeed(
    historyNewestFirst.length, feedH, FEED_ROW_H, hasLatest ? latestH : 0,
  )
  const shownHistory = historyNewestFirst.slice(0, visibleHistory)
  const hasAnyFeed = hasLatest || historyNewestFirst.length > 0

  // F2: dashed "answer" block content — placeholder while there's nothing to
  // show yet or a fresh recording is in flight, otherwise the last spoken
  // text (plain, not diff-coloured — diff lives in the feed card, F3).
  // Срез D: живой partialText (когда непустой) БЬЁТ и плейсхолдер, и lastSpoken —
  // это то, что реально слышит ASR ПРЯМО СЕЙЧАС (десктоп-канон ShadowChat:862-883).
  // PlayerPage сбрасывает partialText на границе/вердикте/разоружении, так что
  // после финала он пуст → фолбэк на lastSpoken.
  const livePartial = partialText && partialText.trim() !== '' ? partialText : null
  const dashedText = livePartial ?? ((recording || transcribing) ? null : (lastSpoken || null))

  // ── ТЗ №2 [ID:P-hotfix-quota-ux] — баннер недоступности источника ────────────
  // reason 'quota_exhausted' → лимит месяца (+«Лимит обновится {дата}», если
  // resetsAt валиден); 'unavailable' → временная недоступность. Дата
  // форматируется по интерфейс-локали; невалидный/пустой resetsAt → без даты.
  const unavailBody = unavailableNotice
    ? (unavailableNotice.reason === 'quota_exhausted'
        ? t('player.shadowUnavailQuota')
        : t('player.shadowUnavailService'))
    : null
  let unavailReset: string | null = null
  if (unavailableNotice?.reason === 'quota_exhausted' && unavailableNotice.resetsAt) {
    const d = new Date(unavailableNotice.resetsAt)
    if (!Number.isNaN(d.getTime())) {
      const date = d.toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US',
        { year: 'numeric', month: 'long', day: 'numeric' })
      unavailReset = t('player.shadowUnavailQuotaReset', { date })
    }
  }

  return (
    <>
    {/* T8: snap-zone hints during drag — VERBATIM from ShadowChat.tsx :1092-1098. */}
    {dragging && barRect && (
      <>
        <div style={snapHintStyle('left', barRect, snapHint === 'left')} />
        <div style={snapHintStyle('right', barRect, snapHint === 'right')} />
      </>
    )}
    <div
      ref={containerRef}
      // T8: containerStyle now carries the drag/dock/free-float positioning
      // (computed above, useMemo) instead of a single hardcoded style object —
      // the "WEB-CUT: drag-to-dock + snap-zone stripped" note this replaced
      // is now stale (this is the T8 revival); the pristine (freePos===null)
      // branch of containerStyle is byte-identical to what used to be here.
      style={containerStyle}
      data-testid="shadow-card"
      // ТЗ №8 п.3 — capture-фаза: гасим синтетический post-drag click ДО того, как
      // он всплывёт до onClick крестика × (deactivate). stopPropagation в capture
      // отменяет bubble-onClick любого потомка (× / любой кнопки карты). Клик без
      // предшествующего драга (suppressClickRef=false) проходит как обычно.
      onClickCapture={(e) => {
        if (suppressClickRef.current) {
          suppressClickRef.current = false
          e.stopPropagation()
          e.preventDefault()
        }
      }}
      // T5 (D1): right-click ANYWHERE on the card → customText menu, ALWAYS
      // available (subtitle-mode or not — see task-T5-brief.md §1/§3).
      onContextMenu={handleCardContextMenu}
    >
      {/* ── header: "≡ SHADOW" label + close (visual from ShadowChat.tsx:1038-1083;
          T8 revives the drag handle desktop calls `dragHeader` — mousedown here
          arms the global mousemove/mouseup drag machinery above). ── */}
      <div
        onPointerDown={handleHeaderPointerDown}
        style={{
          // MINOR (accept #1): 4px 4px 4px 10px, byte-identical to desktop
          // dragHeader :1042 (was 6px 8px 6px 12px).
          padding: '4px 4px 4px 10px',
          fontSize: 9.5, fontWeight: 600, letterSpacing: .5, textTransform: 'uppercase',
          color: 'var(--fg-mute, #666)',
          borderBottom: '1px solid var(--border, rgba(255,255,255,0.08))',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6,
          cursor: dragging ? 'grabbing' : 'grab', userSelect: 'none',
        }}>
        <span>≡ {t('player.shadowLabel')}</span>
        <button
          onClick={deactivate}
          title={t('player.shadowClose')}
          aria-label={t('player.shadowClose')}
          data-testid="shadow-close"
          style={{
            background: 'transparent', border: 'none', color: 'var(--fg-mute, #888)',
            cursor: 'pointer', fontSize: 13, padding: '0 4px', lineHeight: 1,
          }}
        >×</button>
      </div>

      {/* Ф1 bug 1 fix: this wrapper must itself be a shrinkable flex ITEM (flex:1 +
          minHeight:0) inside the now-maxHeight-capped card above — otherwise the
          attempts feed's flex:1/minHeight:0/overflowY:'auto' below has no bounded
          space to fill and never actually scrolls (desktop canon ShadowChat.tsx
          non-compact wrapper :1143-1146 is the same flex:1/minHeight:0 shape). */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 12, flex: 1, minHeight: 0 }}>
        {/* ── rec strip (visual from ShadowChat.tsx:703-752, minus Save/manual-record/gear) ── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
          background: 'var(--btn-bg, rgba(0,0,0,0.25))',
          border: '1px solid var(--border, rgba(255,255,255,0.10))',
          borderRadius: 6, flexShrink: 0,
        }}>
          <span style={{
            width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
            background: 'var(--danger, #ef4444)',
            boxShadow: '0 0 8px var(--danger, #ef4444)',
            // F4: shadowPulse 1.4s while recording (desktop recStrip :714).
            animation: recording ? 'shadowPulse 1.4s infinite' : 'none',
            opacity: recording ? 1 : 0.35,
          }} />
          {recording && (
            <span style={{
              fontFamily: 'var(--mono-font, "IBM Plex Mono", monospace)',
              fontSize: 11, color: 'var(--fg, #e2e8f0)', fontVariantNumeric: 'tabular-nums',
            }}>{formatMmSs(remainingSec)}</span>
          )}
          {recording && <StatusBadge ok text={t('player.shadowSpeak')} />}
          {transcribing && <StatusBadge ok={false} text={t('player.shadowAnalyzing')} />}
          {recording && <Oscillograph analyserNode={analyserNode} recording={recording} />}
          {/* ТЗ №4 MED-8 [ID:P-tz4-fix]: гибкий разделитель забирает «пустоту»
              rec-strip — растит «Стоп» к правому краю И отдаёт сжимаемость СЕБЕ
              (flex:1 + minWidth:0), а НЕ волне (120 фикс, flexShrink:0) и НЕ
              кнопке (flexShrink:0). На узкой карте схлопывается именно пустота,
              поэтому «Стоп» не клипается. */}
          <div data-testid="rec-strip-spacer" style={{ flex: 1, minWidth: 0 }} />
          {handsFree ? (
            // Срез A (п.5) — hands-free: НЕТ кнопки «Записать». Единственная
            // кнопка rec-strip — «Стоп» → shadow.deactivate() (десктоп-канон
            // ShadowChat.tsx :744-750: Стоп === onDeactivate). Толкатель, всегда
            // виден (спикер армлен ⇒ карта смонтирована); визуальные
            // индикаторы (точка/таймер/бейдж/осциллограф) выше по-прежнему
            // гейтятся recording/transcribing.
            <button onClick={deactivate} data-testid="shadow-stop" style={stopBtnStyle()}>
              <Square size={10} fill="currentColor" /> {t('player.shadowStop')}
            </button>
          ) : recording ? (
            <button onClick={stopRecording} data-testid="shadow-stop" style={stopBtnStyle()}>
              <Square size={10} fill="currentColor" /> {t('player.shadowStop')} · {remainingSec}s
            </button>
          ) : (
            <button
              onClick={() => { void startRecording() }}
              disabled={!referenceText || transcribing}
              data-testid="shadow-record"
              style={recordBtnStyle(!referenceText || transcribing)}
            >
              {transcribing ? t('player.shadowTranscribing') : t('player.shadowRecord')}
            </button>
          )}
        </div>

        {/* ── ТЗ №3 п.4: settingsRow MOVED OUT of the card into the workspace bar
            (ShadowSettingsRow.tsx, rendered by WorkspacePanelThemed between the
            transport and the training pills, only while shadow is active). The
            `settings` prop still arrives here but ONLY gates the custom-mode
            targetPanel below (mode subtitle↔custom); the card no longer renders
            the row itself — that vertical space now belongs to the feed. ── */}

        {/* ── target panel "ОЖИДАЕТСЯ" (visual from ShadowChat.tsx:818-836,
            subtitle-mode slice). ТЗ №3 п.5: the DISPLAY ("ОЖИДАЕТСЯ" line) is
            hidden while docked (that space goes to the attempts feed in the narrow
            column). MED-11: but the custom-mode TEXTAREA is an EDITOR, not a
            display — the mode chip in the bar can put the exercise into custom mode
            while docked, so if settings.mode==='custom' the panel (textarea) must
            still render even docked, otherwise the user edits blind. ── */}
        {(dock == null || settings?.mode === 'custom') && (
        <div data-testid="shadow-target-panel" style={{
          padding: '10px 12px', flexShrink: 0,
          background: 'color-mix(in srgb, var(--accent) 6%, transparent)',
          border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
          borderRadius: 6,
        }}>
          <div style={{
            fontFamily: 'var(--mono-font, monospace)', fontSize: 9, letterSpacing: 1,
            color: 'var(--fg-mute, #64748b)', marginBottom: 4, textTransform: 'uppercase',
          }}>{t('player.shadowExpected')}</div>
          {settings?.mode === 'custom' ? (
            // ── Срез B: custom-режим (VERBATIM from ShadowChat.tsx :838-857) —
            // textarea (пишет через onSetCustomText = runtime.setCustomText, канал
            // a внутри него: setShadowState({customText,mode})) + «Вставить из
            // текущего субтитра» (onSetCustomText(referenceText)) + disabled-заглушки
            // OCR/Файл (нет бэкенда на вебе, как в каноне). ──
            <div style={{ display: 'flex', gap: 6, marginTop: 4, alignItems: 'stretch' }}>
              <textarea
                data-testid="shadow-custom-textarea"
                value={customText ?? ''}
                // HIGH-2: textarea-путь БЕЗ мод-флипа (onCustomTextInput), фолбэк на
                // onSetCustomText для standalone-тестов, которые новый проп не передают.
                onChange={e => (onCustomTextInput ?? onSetCustomText)?.(e.target.value)}
                placeholder={t('player.shadowCustomPlaceholder')}
                style={{
                  flex: 1, minHeight: 78, resize: 'none', padding: '8px 10px',
                  background: 'var(--input-bg, rgba(0,0,0,0.4))',
                  border: '1px solid var(--border, rgba(255,255,255,0.10))',
                  borderRadius: 4, color: 'var(--fg, #f8fafc)',
                  fontSize: 15, lineHeight: 1.3, outline: 'none',
                  fontFamily: captionFont,
                }}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <button
                  data-testid="shadow-custom-from-sub"
                  onClick={() => onSetCustomText?.(referenceText)}
                  title={t('player.shadowFromSub')}
                  style={sideBtn()}
                ><Subtitles size={14} /></button>
                <button title={t('player.shadowOcr')} style={sideBtn()} disabled><ImageIcon size={14} /></button>
                <button title={t('player.shadowFile')} style={sideBtn()} disabled><FileText size={14} /></button>
              </div>
            </div>
          ) : (
            <div style={{
              // F1: 17px/500 + lang-aware caption-font (desktop targetPanel :832-834),
              // was 15px inheriting --ui-font.
              fontSize: 17, fontWeight: 500, color: 'var(--fg, #f8fafc)',
              lineHeight: 1.3, letterSpacing: '-.005em',
              fontFamily: captionFont,
              opacity: referenceText ? 1 : 0.6,
            }}>{referenceText || t('player.shadowNoCue')}</div>
          )}
        </div>
        )}

        {/* ── F2: dashed "answer" block (visual from ShadowChat.tsx:862-883)
            — PERMANENT fixture of the full layout, not result-gated. Shows the
            placeholder until there's something to show, then the last spoken
            text (plain italic, not diff-coloured — diff lives in the feed). ── */}
        <div data-testid="shadow-partial" style={{
          display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 10px',
          background: 'color-mix(in srgb, var(--accent) 8%, transparent)',
          border: '1px dashed color-mix(in srgb, var(--accent) 35%, transparent)',
          borderRadius: 6,
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: 'var(--accent, #60a5fa)',
            // F4: shadowPulse 1s, unconditional (desktop partialBlock bullet :873).
            animation: 'shadowPulse 1s infinite',
            flexShrink: 0, marginTop: 7,
          }} />
          <span style={{
            flex: 1, minWidth: 0, fontSize: 14, color: 'var(--fg, #ddd)', fontStyle: 'italic',
            opacity: .85, lineHeight: 1.4,
            overflowWrap: 'anywhere', wordBreak: 'break-word',
            fontFamily: captionFont,
          }}>{dashedText || t('player.shadowWaiting')}</span>
        </div>

        {/* ── ТЗ №2 [ID:P-hotfix-quota-ux]: баннер недоступности источника —
            НАД лентой вердиктов, стиль tone-danger как shadow-error-строка ниже.
            Показ только при unavailableNotice (quota_exhausted/unavailable). ── */}
        {unavailBody && (
          <div data-testid="shadow-unavailable" style={{
            color: 'var(--danger-fg, #fca5a5)', fontSize: 12.5,
            padding: '8px 10px', borderRadius: 6, flexShrink: 0,
            background: 'rgba(220,38,38,0.14)', border: '1px solid rgba(220,38,38,0.55)',
            lineHeight: 1.4,
          }}>
            <div>{unavailBody}</div>
            {unavailReset && (
              <div data-testid="shadow-unavailable-reset" style={{ marginTop: 4, opacity: .85 }}>{unavailReset}</div>
            )}
          </div>
        )}

        {/* ── ТЗ №3 п.2/п.3: zero-scroll attempts feed. The latest attempt is a
            full B1 two-row notation block (ShadowVerdictNotation) + "услышано";
            older attempts are compact one-liners ("повтор N · % · услышано:
            {text}", ellipsis). The feed container is height-measured (feedRef)
            and only the last N-1 history rows render, the rest collapse into a
            single "+K ранних" line — NO scrollbar (overflow hidden), NO
            horizontal overflow (notation wraps, one-liners ellipsis). ── */}
        {!hasAnyFeed ? (
          // ТЗ №6 п.3 [ID:P-tz6]: пустой плейсхолдер ТЯНЕТСЯ (flex:1), как и feed
          // ниже — иначе при пустой ленте всё паковалось к верху и bind-row
          // «болтался» в центре/сверху. Растяжка съедает свободную высоту → ряд
          // ПРИВЯЗКА прижат к низу карты ВСЕГДА (владелец, видео 23-39, 0:09–0:45).
          <div data-testid="shadow-feed-empty" style={{ flex: 1, minHeight: 0, fontSize: 12, color: 'var(--fg-mute, #555)', fontStyle: 'italic', padding: 4 }}>
            {t('player.shadowWaiting')}
          </div>
        ) : (
          <div ref={feedRef} data-testid="shadow-feed" style={{
            flex: 1, minHeight: 0, overflowY: 'hidden', overflowX: 'hidden',
            display: 'flex', flexDirection: 'column', gap: 8,
          }}>
            {/* Latest — full B1 notation, replaces the old WordChip single row. */}
            {latestRow && (() => {
              const selected = latestRow.recordingId != null && latestRow.recordingId === youTrackRecordingId
              return (
                <div
                  ref={latestRef}
                  data-testid="shadow-diff"
                  onClick={() => { if (latestRow.recordingId) selectRecording(latestRow.recordingId) }}
                  style={{
                    ...attemptCardStyle(),
                    cursor: latestRow.recordingId ? 'pointer' : 'default',
                    ...(selected ? { boxShadow: 'inset 3px 0 0 var(--accent, #E0B341)' } : {}),
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                    <span style={{
                      fontFamily: 'var(--mono-font, monospace)', fontSize: 9.5,
                      color: 'var(--fg-mute, #64748b)', letterSpacing: .4, textTransform: 'uppercase',
                    }}>{t('player.shadowLoop')} {latestRow.loopNo}</span>
                    <span style={{
                      fontFamily: 'var(--mono-font, monospace)', fontSize: 10, fontWeight: 600,
                      padding: '1px 6px', borderRadius: 4, border: '1px solid',
                      ...pctTone(latestRow.matchPct),
                    }}>{latestRow.matchPct}%</span>
                  </div>
                  {latestRow.marks && <ShadowVerdictNotation marks={latestRow.marks} />}
                  {latestRow.heard && (
                    <div style={heardLineStyle()}>{t('player.shadowHeard')}: {latestRow.heard}</div>
                  )}
                </div>
              )
            })()}

            {/* History — compact one-liners (ellipsis, non-clickable). pct is a
                CLEAN "{n}%" span (no separator glued in) so integration tests can
                `getByText('50%')` and pctTone colouring stays per-badge. */}
            {shownHistory.map(row => (
              <div key={row.key} data-testid="shadow-history-row" style={{
                display: 'flex', alignItems: 'baseline', gap: 4, flexShrink: 0,
                fontFamily: 'var(--mono-font, monospace)', fontSize: 11,
                color: 'var(--fg-mute, #64748b)',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                padding: '2px 4px',
              }}>
                <span style={{ flexShrink: 0, textTransform: 'uppercase', letterSpacing: .4 }}>
                  {t('player.shadowLoop')} {row.loopNo}
                </span>
                <span style={{ flexShrink: 0 }}>·</span>
                <span style={{ flexShrink: 0, color: pctTone(row.matchPct).background as string }}>{row.matchPct}%</span>
                {row.text && (
                  <>
                    <span style={{ flexShrink: 0 }}>·</span>
                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', fontStyle: 'italic' }}>
                      {t('player.shadowHeard')}: {row.text}
                    </span>
                  </>
                )}
              </div>
            ))}

            {/* "+K ранних" — the collapsed older attempts (ТЗ №3 п.2). */}
            {hiddenEarly > 0 && (
              <div data-testid="shadow-feed-more" style={{
                flexShrink: 0, fontSize: 10.5, fontStyle: 'italic',
                color: 'var(--fg-mute, #555)', padding: '2px 4px',
              }}>{t('player.shadowEarlier', { count: hiddenEarly })}</div>
            )}
          </div>
        )}

        {/* error */}
        {phase === 'error' && (
          <div data-testid="shadow-error" style={{
            color: 'var(--danger-fg, #fca5a5)', fontSize: 12.5,
            padding: '8px 10px', borderRadius: 6,
            background: 'rgba(220,38,38,0.14)', border: '1px solid rgba(220,38,38,0.55)',
          }}>{errText}</div>
        )}

        {capped && (
          <div style={{ color: 'var(--warn, #E0B341)', fontSize: 11.5 }}>{t('player.shadowCapped')}</div>
        )}

        {recordAudioUrl && (
          <audio controls src={recordAudioUrl} data-testid="shadow-audio" style={{ width: '100%' }} />
        )}

        {/* Срез A (M-2): в hands-free-режиме ряд «Ещё раз» (dismissResult) —
            МЁРТВЫЙ (V1 push-to-record ретайрнут; resume в hands-free = S/пилюля),
            поэтому не рендерится. Для standalone V1-карты (handsFree=false)
            поведение прежнее. */}
        {!handsFree && (phase === 'result' || phase === 'error') && (
          <button onClick={dismissResult} data-testid="shadow-again" style={againBtnStyle()}>
            {t('player.shadowAgain')}
          </button>
        )}

        {/* ── T9: bind-panel "ПРИВЯЗКА" (visual + gesture lifted VERBATIM from
            ShadowChat.tsx :951-998, `bindRowFull`) — anchor-grip pointer-drag
            releases a raw fraction via `onAnchorDrop` (F2, ShadowChat.tsx
            :443-446/:958-969); `handleBind` persists via
            onBindOff/onBindToSubtitle/onBindToTime (real names, ShadowChat.tsx
            :469-478 + desktop index.tsx :4460-4499). Desktop's `speakActive`
            gate (:951, hides this row during the pronunciation/speak test)
            has no web equivalent yet — speak-mode is out of this wholelift
            slice's scope — so this row always renders. `bindRail` (the
            compact vertical variant, ShadowChat.tsx :1000-1036) stays
            WEB-CUT: `compact` never branches this card's JSX (same
            deliberate deferral T8's header note documents for the whole
            compact-layout swap). ──
            ТЗ №6 п.7 [ID:P-tz6]: в доке (inset) «подвал» ПРИВЯЗКА СКРЫТ — узкая
            докнутая карта отдаёт всю высоту ленте повторов, чтобы B1 был виден
            («пользователь ОБЯЗАН видеть то, что наговорил», видео 23-39, 10:21–11:10).
            Как и панель «ОЖИДАЕТСЯ» (гейт dock==null выше), bind-row живёт только в
            free-float/pristine. Персист-настройка привязки доступна в undocked-режиме. */}
        {dock == null && (
        <div data-testid="shadow-bind-row" style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '5px 6px 5px 4px',
          background: 'var(--btn-bg, rgba(0,0,0,0.25))',
          border: '1px solid var(--border, rgba(255,255,255,0.10))',
          borderRadius: 6, flexShrink: 0,
        }}>
          <span
            data-testid="shadow-bind-anchor-grip"
            // WEB-SEAM: setPointerCapture/releasePointerCapture wrapped in
            // try/catch — jsdom (this project's test env) does not implement
            // either, and real browsers vary; same guard PauseAtBControl.tsx
            // already uses for the identical gesture (":unsupported"). The
            // desktop source calls these unguarded (Electron/Chromium always
            // has them) — this is an environment-availability seam, not a
            // change to the drag/drop MECHANIC itself (frac math below is
            // byte-identical to ShadowChat.tsx :964-969).
            onPointerDown={(e) => {
              e.preventDefault()
              try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* unsupported */ }
              setAnchorDragging(true)
            }}
            onPointerUp={(e) => {
              if (!anchorDragging) return
              try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* already released / unsupported */ }
              setAnchorDragging(false)
              if (onAnchorDrop && barRect &&
                  e.clientX >= barRect.left && e.clientX <= barRect.right &&
                  e.clientY >= barRect.top && e.clientY <= barRect.bottom) {
                const frac = Math.min(1, Math.max(0, (e.clientX - barRect.left) / barRect.width))
                onAnchorDrop(frac)
              }
            }}
            onPointerCancel={(e) => { try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* already released / unsupported */ } setAnchorDragging(false) }}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 14, height: 22, color: 'var(--fg-mute, #64748b)', cursor: 'grab',
              flexShrink: 0,
            }} title={t('player.shadowDragHint')}><GripVertical size={12} /></span>
          <Pin size={11} style={{ color: 'var(--fg-mute, #64748b)' }} />
          <span style={{
            fontFamily: 'var(--mono-font, monospace)', fontSize: 9, letterSpacing: .6,
            textTransform: 'uppercase', color: 'var(--fg-mute, #64748b)',
          }}>{t('player.shadowBindLbl')}</span>
          <div style={{
            display: 'flex', flex: 1, padding: 2,
            background: 'var(--surface, rgba(0,0,0,0.4))',
            border: '1px solid var(--border, rgba(255,255,255,0.10))',
            borderRadius: 4,
          }}>
            <button data-testid="shadow-bind-off" onClick={() => handleBind('off')}      style={bindBtnStyle(bind === 'off',      true)}>{t('player.shadowBindOff')}</button>
            <button data-testid="shadow-bind-sub" onClick={() => handleBind('subStart')} style={bindBtnStyle(bind === 'subStart', false)}>{t('player.shadowBindSub')}</button>
            <button data-testid="shadow-bind-now" onClick={() => handleBind('now')}      style={bindBtnStyle(bind === 'now',      false)}>{t('player.shadowBindNow')}</button>
          </div>
          <span style={{
            fontFamily: 'var(--mono-font, monospace)', fontSize: 10,
            color: 'var(--fg-dim, #94a3b8)', minWidth: 42, textAlign: 'right',
            opacity: bind === 'off' ? 0.35 : 1,
          }}>{bindTC || '—'}</span>
        </div>
        )}
      </div>

      {/* ── ТЗ №3 п.1: corner resize handles (12×12, nwse-resize) — LAST children
          so the header stays `firstElementChild` (drag-dock test contract). NW
          grows the card up/left, SE down/right; both persist {w,h}. OWNER DECISION
          #8 (documented, not a bug): resize is intentionally hidden while docked —
          the card is pinned to the bar and its width is driven by the dock inset,
          so a free resize there is meaningless. ── */}
      {dock == null && (
        <>
          <span
            data-testid="shadow-resize-nw"
            onPointerDown={onResizeDown('nw')}
            style={{
              position: 'absolute', top: 0, left: 0, width: 12, height: 12,
              cursor: 'nwse-resize', zIndex: 2,
            }}
          />
          <span
            data-testid="shadow-resize-se"
            onPointerDown={onResizeDown('se')}
            style={{
              position: 'absolute', bottom: 0, right: 0, width: 12, height: 12,
              cursor: 'nwse-resize', zIndex: 2,
            }}
          />
        </>
      )}
    </div>

    {/* T5 (D1): right-click customText menu — ALWAYS constructible (not
        gated on phase/referenceText), closes on backdrop click/right-click
        or after Save/Clear commits. */}
    {customTextMenu && (
      <CustomTextMenu
        state={customTextMenu}
        initialText={customText ?? ''}
        onClose={() => setCustomTextMenu(null)}
        onStartEdit={() => setCustomTextMenu(m => m ? { ...m, editing: true } : m)}
        onSave={(text) => {
          const trimmed = text.trim()
          onSetCustomText?.(trimmed === '' ? null : text)
          setCustomTextMenu(null)
        }}
        onClear={() => {
          onSetCustomText?.(null)
          setCustomTextMenu(null)
        }}
      />
    )}

    {/* F4: Keyframes injected once, byte-identical to ShadowChat.tsx :1170-1173. */}
    <style>{`
        @keyframes shadowPulse { 0%,100%{opacity:1} 50%{opacity:.4} }
        @keyframes shadowStatusWait { 0%,100%{opacity:1} 50%{opacity:.55} }
      `}</style>
    </>
  )
}
