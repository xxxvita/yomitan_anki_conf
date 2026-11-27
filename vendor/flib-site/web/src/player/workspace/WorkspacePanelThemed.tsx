import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Play, Pause, SkipBack, SkipForward, Rewind, FastForward,
  Mic, Headphones, Puzzle, Repeat, LogOut, // WEB-SEAM: dropped unused `X` import (noUnusedLocals is off in the desktop build, on here)
  ZoomIn, ZoomOut, VolumeX, Languages,
} from 'lucide-react';
import { useT } from './i18n-mini'; // WEB-SEAM
import { hasShadowingAccess, shadowLockedTitle } from '../shadow-access'; // Э6: Shadowing-гейт (не всем — тратит токены)
import { useSession } from '../../site/useSession'; // кабинет: перерисовать гейт, когда придёт снимок сессии
import { useVideoPlayerStore } from './video-player-store'; // WEB-SEAM
import type { WorkspacePanelProps } from './types';
import type { PlayerTheme } from './theme/player-theme'; // WEB-SEAM
import { formatTime } from './vtt-format'; // WEB-SEAM
import { playheadLeftPct } from './playhead';
import { packCuesIntoLanes } from './cue-packer';
import { clampCueEdges } from './cue-clamp';
import { clampRegionPct } from './region-clamp';
import { RunningMan } from './RunningMan';
import { buildRulerTicks } from './time-ruler';
import { PauseAtBControl } from './PauseAtBControl';
import { WaveformCanvas } from './WaveformCanvas';
import { detectSpeechSegments } from './detectSpeechSegments';
import { recordingRect, pickYouTrackRecording, recordingSpan } from './recording-rect';
import type { AudioTrackInfo, RecordingEntry, AudSegment } from './api-types'; // WEB-SEAM
import { TrackCombo, type TrackComboOption } from './TrackCombo';
import { groupOverlappingSegments, groupOverlappingByRange } from './aud-segments-grouping';
import { useTrackSelection } from './useTrackSelection';
import { rectToTracks } from './track-selection';
import { exerciseAbRange } from './exercise-workspace';
// WEB-SEAM (T6): resolveMovedExercise lifted verbatim in T1 (workspace/exercise-move.ts)
// — used as-is by the new body-move drag below, not re-implemented here.
import { resolveMovedExercise } from './exercise-move';
import type { TrackSelection } from './track-selection';
import type { MuteRegion } from './mute-regions';
import { RegionMenu, type RegionMenuState } from './RegionMenu';
// T8: ShadowChat's drag-dock mechanic is now lifted (ShadowCardLifted.tsx) —
// import the single source of truth for DOCKED_WIDTH instead of the stale
// local duplicate ("not lifted in P1" — no longer true since T3's ShadowCard
// + T8's drag-dock). Mirrors desktop: index.tsx:47 + this file's own :29
// import DOCKED_WIDTH from ShadowChat.tsx the same way.
// ТЗ №3 п.1: DOCKED_WIDTH + dockedWidth now live in the JSX-free shadow-card-
// size module (imported here directly instead of through the heavy React card).
import { dockedReserveWidth } from './shadow-card-size';
import { useUIStore } from './ui-store'; // WEB-SEAM
import type { WaveformMode } from './waveform-scale';

const WS_MIN_RANGE = 0.5;

// Playhead time tag — mm:ss.mmm to match designer Dusk spec (e.g. 00:17.142).
// formatTime() in vtt-parser only goes down to seconds, which is too coarse
// for a moving playhead.
function formatPlayheadTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
}

type DragTarget = 'left' | 'right' | 'pos' | null;

// Drag handle visual for SHADOW exercise resize (L / R edges). Sits inside
// the block at edge=0..6px, tall enough to be easy to grab even on a
// small block. `pointerEvents:'auto'` ensures it captures the mousedown
// before the block's onClick re-selects.
function resizeHandleStyle(side: 'left' | 'right'): React.CSSProperties {
  return {
    position: 'absolute',
    top: 0, bottom: 0,
    [side]: 0,
    width: 7,
    cursor: 'ew-resize',
    background: 'var(--accent-fg, #1A0A0C)',
    opacity: 0.85,
    boxShadow: side === 'left' ? '1px 0 0 var(--accent, #E0B341)' : '-1px 0 0 var(--accent, #E0B341)',
    zIndex: 5,
  };
}

// Track-number label (left gutter). `accent` lights up the circle for
// active/highlighted tracks (e.g. SUB while the user is mid-Shadow).
const TrackLabel: React.FC<{
  n: number; top: number; label: string; accent?: boolean;
  onClick?: () => void; title?: string; testid?: string;
  onContextMenu?: () => void;
  // When set, the label is an audio on/off toggle: 'on' shows the text
  // label (audible), 'off' shows a crossed-out speaker icon (muted).
  audioState?: 'on' | 'off';
}> = ({ n, top, label, accent, onClick, title, testid, audioState, onContextMenu }) => {
  const badgeAccent = accent || audioState === 'on';
  return (
    <div
      // data-no-gesture: a clickable label must NOT be seen by the timeline
      // bar's click-to-seek / rubber-band handlers — otherwise clicking it
      // seeks the playhead to the gutter's x (≈ time 0) and drops out of
      // the A-B loop. stopPropagation on click+mousedown is belt-and-braces.
      data-no-gesture={(onClick || onContextMenu) ? '' : undefined}
      onClick={onClick ? (e) => { e.stopPropagation(); onClick(); } : undefined}
      onMouseDown={onClick ? (e) => e.stopPropagation() : undefined}
      onContextMenu={onContextMenu ? (e) => { e.preventDefault(); e.stopPropagation(); onContextMenu(); } : undefined}
      title={title}
      data-testid={testid}
      style={{
        position: 'absolute', top, right: 0,
        display: 'flex', alignItems: 'center', gap: 4,
        height: 14,
        cursor: onClick ? 'pointer' : undefined,
        pointerEvents: (onClick || onContextMenu) ? 'auto' : undefined,
      }}
    >
      {audioState === 'off' ? (
        // Explicit-sized wrapper span (mirrors the on-state badge span). A bare
        // <svg> as the sole child of this width-less position:absolute flex div
        // collapses to zero width — invisible and unclickable. The fixed 14×14
        // span gives the toggle a guaranteed visible, clickable footprint;
        // `color` on the span feeds the icon's currentColor. --fg-dim is the
        // gutter's own (definitely-visible) text colour.
        <span style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 14, height: 14, flexShrink: 0,
          color: 'var(--fg-dim, #8a7855)',
        }}>
          <VolumeX size={13} />
        </span>
      ) : (
        <>
          <span style={{
            width: 14, height: 14, borderRadius: 99,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: badgeAccent ? 'var(--accent, #E0B341)' : 'transparent',
            color: badgeAccent ? 'var(--accent-fg, #1A0A0C)' : 'var(--fg-dim, #8a7855)',
            border: badgeAccent ? 'none' : '1px solid var(--border-strong, rgba(255,255,255,0.18))',
            fontSize: 8.5, fontWeight: 800,
          }}>{n}</span>
          <span>{label}</span>
        </>
      )}
    </div>
  );
};

function renderHandle(th: PlayerTheme, side: 'left' | 'right', active: boolean): React.ReactNode {
  const fill = active ? th.handles.colorActive : th.handles.color;
  const borderRadius = side === 'left' ? th.handles.borderRadiusLeft : th.handles.borderRadiusRight;

  if (th.handles.shape === 'chevron') {
    return (
      <div style={{
        width: 0, height: 0,
        borderTop: `${th.handles.height / 2}px solid transparent`,
        borderBottom: `${th.handles.height / 2}px solid transparent`,
        ...(side === 'left'
          ? { borderRight: `${th.handles.width + 2}px solid ${fill}` }
          : { borderLeft:  `${th.handles.width + 2}px solid ${fill}` }),
        filter: `drop-shadow(0 0 6px ${th.handles.color})`,
      }} />
    );
  }

  if (th.handles.shape === 'double-hairline') {
    const thickness = th.handles.hairlineThickness ?? 1;
    const gap = th.handles.hairlineGap ?? th.handles.width;
    return (
      <div style={{
        width: gap + thickness * 2, height: th.handles.height,
        display: 'flex', justifyContent: 'space-between',
        pointerEvents: 'none',
      }}>
        <div style={{ width: thickness, height: '100%', background: fill }} />
        <div style={{ width: thickness, height: '100%', background: fill }} />
      </div>
    );
  }

  if (th.handles.shape === 'wax-seal') {
    const label = side === 'left'
      ? (th.handles.sealLeftLabel ?? 'A')
      : (th.handles.sealRightLabel ?? 'B');
    const size = Math.max(th.handles.width, th.handles.height);
    return (
      <div style={{
        position: 'relative',
        width: size, height: size, borderRadius: '50%',
        // Radial sheen from top-left + darker base for a 3D button look.
        backgroundImage: `
          radial-gradient(circle at 32% 28%, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0.15) 18%, transparent 42%),
          radial-gradient(circle at 50% 100%, rgba(0,0,0,0.35) 0%, transparent 55%)
        `,
        backgroundColor: fill,
        color: th.handles.sealFg ?? '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'Georgia, "Playfair Display", serif', fontStyle: 'italic',
        fontSize: Math.round(size * 0.58), fontWeight: 700,
        boxShadow: active
          ? `0 3px 10px rgba(0,0,0,0.45), 0 0 0 1px rgba(0,0,0,0.15), inset 0 1.5px 1px rgba(255,255,255,0.35), inset 0 -2px 3px rgba(0,0,0,0.3)`
          : `0 2px 6px rgba(0,0,0,0.35), 0 0 0 1px rgba(0,0,0,0.15), inset 0 1.5px 1px rgba(255,255,255,0.35), inset 0 -2px 3px rgba(0,0,0,0.3)`,
        textShadow: '0 1px 1px rgba(0,0,0,0.4)',
        pointerEvents: 'none',
      }}>
        {label}
      </div>
    );
  }

  // 'bar' (default)
  return (
    <div style={{
      width: th.handles.width, height: th.handles.height,
      background: fill,
      borderRadius,
      boxShadow: active
        ? `0 0 14px ${th.handles.colorActive}`
        : `0 0 8px ${th.handles.color}`,
      transition: 'background 0.15s, box-shadow 0.15s',
      pointerEvents: 'none',
    }} />
  );
}

// Generic themed workspace panel. Every variant dispatches here with its
// own `theme` value from the registry.
export interface WorkspacePanelThemedProps extends WorkspacePanelProps {
  theme: PlayerTheme;
  /** Ф2 — play the covered tracks of the committed track selection. */
  onPlaySelection?: (sel: TrackSelection) => void;
  /** Ф3 — persisted mute regions for the current video+subtitle. */
  muteRegions?: MuteRegion[];
  /** Ф3 — create a mute region from the committed selection. */
  onCreateMuteRegion?: (sel: TrackSelection, cueIndex: number) => void;
  /** Ф3 — toggle a region's muted flag. */
  onToggleMuteRegion?: (id: string) => void;
  /** Ф3 — delete a region. */
  onDeleteMuteRegion?: (id: string) => void;
  /** Bug 2 Phase B (2026-05-27): right-click context menu on dub overlay
   *  segments. Caller is index.tsx — it confirms with the user and POSTs
   *  /api/v1/video/recordings/apply. We just relay the click. */
  onApplyDubOverlay?: (rec: RecordingEntry) => void;
  /** Bug 10 (2026-05-27) — AUD-track combobox: list of audio tracks
   *  the player knows about (embedded + dub overlays), the currently
   *  selected one, and a callback that drives the swap. The user
   *  controls what plays — no auto-switching. */
  audioTracks?: AudioTrackInfo[];
  currentAudioTrack?: number;
  onAudioTrackChange?: (index: number) => void;
  /** Bug 11 (2026-05-27) — YOU-track combobox: ALL recordings for the
   *  current video. The current selection is identified by
   *  youTrackRecordingId in the store; selection + deletion fire
   *  through these handlers. */
  recordingsForCombo?: RecordingEntry[];
  onSelectYouRecording?: (id: string) => void;
  onDeleteYouRecording?: (id: string, filename: string) => void;
  /** Фаза II (2026-05-27) — AUD segments per overlap-cluster combo. */
  audSegments?: AudSegment[];
  selectedAudSegmentId?: string | null;
  onSelectAudSegment?: (segmentId: string | null) => void;
  onDeleteAudSegment?: (segmentId: string) => void;
}

export const WorkspacePanelThemed: React.FC<WorkspacePanelThemedProps> = ({
  theme: th,
  workspace, cues, currentTime, duration, videoElRef, muted, offset,
  getEffectiveStart, getEffectiveEnd,
  getTime, // WEB-SEAM: live time source for the rAF playhead loop (no <video> in web)
  onSetRange, onSetView, onZoom, onFitToRange, onToggleMute, onSeek,
  onPlayPause, playing, onExit, shadowActive, onToggleShadow, shadowAttempts,
  onTranslate, translatePlural, translateDisabled, translateTitle, onCueContextMenu, translateMenuOpen,
  panelRef, onCueClick,
  dictationActive, onToggleDictation,
  dictationAttempts, cueVisibility,
  onStartPuzzle, onToggleLoop, onSetLooping, onSetPauseAtEnd, onHandleClick,
  shadowExercises, onExerciseClick, onExerciseDelete, onExerciseUpdate,
  waveform,
  recordings,
  onPlaySelection,
  muteRegions,
  onCreateMuteRegion,
  onToggleMuteRegion,
  onDeleteMuteRegion,
  onApplyDubOverlay,
  // WEB-SEAM: audioTracks/currentAudioTrack/onAudioTrackChange/recordingsForCombo
  // are declared-but-unread in the desktop source too (desktop tsconfig has no
  // noUnusedLocals/noUnusedParameters); underscore-renamed here only to satisfy
  // the stricter web tsconfig — external prop names (API contract) unchanged.
  audioTracks: _audioTracks,
  currentAudioTrack: _currentAudioTrack,
  onAudioTrackChange: _onAudioTrackChange,
  recordingsForCombo: _recordingsForCombo,
  onSelectYouRecording,
  onDeleteYouRecording,
  audSegments,
  selectedAudSegmentId,
  onSelectAudSegment,
  onDeleteAudSegment,
  trainingInlinePanel, // ТЗ №3 п.4 — Shadowing settings row slot (bar, active-only)
}) => {
  const t = useT();
  // Снимок сессии кабинета приходит после первого рендера; подписка только
  // перерисовывает пилюлю Shadowing (гейт читает hasShadowingAccess()).
  useSession({ passive: true });
  const waveformMode = useUIStore((s) => s.waveformMode);
  const cycleWaveformMode = useUIStore((s) => s.cycleWaveformMode);
  const [wavePill, setWavePill] = useState<WaveformMode | null>(null);
  const wavePillTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const waveformModeLabel = (m: WaveformMode): string =>
    m === 'view-linear' ? t('player.waveformModeViewLinear')
    : m === 'view-dB'   ? t('player.waveformModeViewDb')
    :                     t('player.waveformModeClipLinear');

  const handleCycleWaveform = () => {
    cycleWaveformMode();
    const next = useUIStore.getState().waveformMode;
    setWavePill(next);
    if (wavePillTimer.current) clearTimeout(wavePillTimer.current);
    wavePillTimer.current = setTimeout(() => setWavePill(null), 1200);
  };

  useEffect(() => () => { if (wavePillTimer.current) clearTimeout(wavePillTimer.current); }, []);

  const shadowChatDock = useVideoPlayerStore(s => s.shadowChatDock);
  const shadowChatDockHint = useVideoPlayerStore(s => s.shadowChatDockHint);
  // ТЗ №3 п.1 — the docked-inset width follows the user's saved card width
  // (dockedWidth(size), fallback 420), so shrinking/growing the card reflows the
  // timeline by the SAME amount the card occupies.
  const shadowChatSize = useVideoPlayerStore(s => s.shadowChatSize);
  // ТЗ №5 п.1 — ЖИВОЙ размер во время resize-драга (emit-only). Резерв обязан
  // трекать ширину карты В РЕАЛЬНОМ ВРЕМЕНИ, а не только на pointerup — иначе
  // «меняю ширину, резерв не меняется». null (драга нет) → падаем на shadowChatSize.
  // Подписка УСЛОВНАЯ (адверсариал ТЗ-5 MED-1a): при free-float драге live-размер
  // бару не нужен (dw применяется только в доке) — селектор отдаёт null, Object.is
  // гасит ре-рендер 2890-строчного бара на каждый pointermove.
  const shadowChatSizeLive = useVideoPlayerStore(s => s.shadowChatDock ? s.shadowChatSizeLive : null);
  // P3a — YOU track lives at the bottom of the bar. Hidden by default
  // (no recordings yet); user can force-show it via the toggle button
  // emitted in the bottom transport area.
  const youTrackForceShown = useVideoPlayerStore(s => s.youTrackForceShown);
  const setYouTrackForceShown = useVideoPlayerStore(s => s.setYouTrackForceShown);
  const youTrackRecordingId = useVideoPlayerStore(s => s.youTrackRecordingId);
  const youAudible    = useVideoPlayerStore(s => s.youAudible);
  const setYouAudible = useVideoPlayerStore(s => s.setYouAudible);
  // YOU track is visible whenever there is content to show OR the user
  // explicitly forced it on. shadowAttempts entries (per-cue best matchPct)
  // count as content; once the user has a single attempt logged, the track
  // appears automatically. П4-A: per-recording waveform entries also count.
  const hasUserResponses = !!shadowAttempts && Object.values(shadowAttempts).some(e => e.attempts.length > 0);
  const hasRecordings = !!recordings && recordings.length > 0;
  const youTrackVisible = youTrackForceShown || hasUserResponses || hasRecordings;

  // Ф1 — «G»-gated track selection.
  const { gHeld, selection, setSelection, clearSelection } = useTrackSelection();
  // Raw client coords of the in-progress G-drag (null when no G-drag active).
  const gDragRef = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  // Live render state for the G-drag rubber-band overlay.
  const [gDragRect, setGDragRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  // Escape key clears a committed track selection (Ф1) — capture phase so
  // this runs before index.tsx's bubble-phase Escape handler that tears down
  // the whole workspace. When a selection IS committed we consume the event
  // entirely (stopImmediatePropagation + preventDefault) so the workspace
  // handler never sees it. When there is NO selection we do nothing and let
  // the event propagate normally.
  // We read `selection` via a ref so the stable handler never goes stale and
  // we never have to add/remove the listener on every selection change.
  const selectionRef = useRef(selection);
  useEffect(() => { selectionRef.current = selection; }, [selection]);

  // Ф3 — selected mute region (for Delete-key removal).
  const [selectedMuteRegionId, setSelectedMuteRegionId] = useState<string | null>(null);
  // T5 — right-click RegionMenu (Удалить / Вкл-выкл) state.
  const [regionMenu, setRegionMenu] = useState<RegionMenuState | null>(null);
  // T5-review fix (finding 2, Esc priority): mirrored in a ref so the
  // Escape-clear-selection listener below (registered once at mount) can
  // check "is a RegionMenu currently open" without re-subscribing itself on
  // every open/close, and without a stale closure.
  const regionMenuRef = useRef(regionMenu);
  useEffect(() => { regionMenuRef.current = regionMenu; }, [regionMenu]);
  // [ID:P-subtitle-translate] Fable M4: TranslateMenu живёт в PlayerPage — зеркалим
  // его открытость в ref, чтобы bar-Esc-listener ниже уступил ему так же, как RegionMenu.
  const translateMenuOpenRef = useRef(translateMenuOpen);
  useEffect(() => { translateMenuOpenRef.current = translateMenuOpen; }, [translateMenuOpen]);
  // M-b: stable identity so RegionMenu's own document-listener effect (keyed on
  // [state, onClose]) doesn't re-subscribe on every playhead-driven re-render
  // of this panel while the menu is open.
  const handleRegionMenuClose = useCallback(() => setRegionMenu(null), []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // T5-review fix (finding 2): this listener is registered once at mount
      // (document, capture phase), *before* RegionMenu's own Esc listener
      // (which only attaches while a menu is open — see RegionMenu.tsx). If
      // this handler swallowed Escape here via stopImmediatePropagation,
      // RegionMenu's later-registered listener on the same node would never
      // run and the menu would never close. Priority: an open RegionMenu owns
      // Esc — step aside and let the event continue to RegionMenu's listener,
      // which closes the menu. Only clear a track selection when no menu is
      // open.
      if (regionMenuRef.current || translateMenuOpenRef.current) return; // открытое меню владеет Esc
      if (!selectionRef.current) return; // no selection — let it bubble
      clearSelection();
      e.stopImmediatePropagation();
      e.preventDefault();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [clearSelection]);

  // Delete the selected mute region on the Delete key. Ignored while a text
  // field is focused so it never eats a backspace in the custom-text box.
  useEffect(() => {
    if (!selectedMuteRegionId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      onDeleteMuteRegion?.(selectedMuteRegionId);
      setSelectedMuteRegionId(null);
      // T5-review fix (finding 1, ghost menu): the Del hotkey deletes the
      // region but did not close an open RegionMenu still pointing at it,
      // leaving a "ghost menu" with a stale id on screen. Close it too, but
      // only if it was actually anchored on the region we just deleted —
      // functional update reads the latest `regionMenu` without adding it to
      // the effect's deps (which would force a re-subscribe of this listener
      // on every menu open/close and risk a stale-closure race otherwise).
      setRegionMenu(prev => (prev && prev.id === selectedMuteRegionId ? null : prev));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selectedMuteRegionId, onDeleteMuteRegion]);

  // P3 — selected exercise (for showing L/R resize handles). Click on the
  // SHADOW block selects it; clicking elsewhere clears (handled at the
  // panel-root onClick). Drag-state is local to the resize handler.
  const [selectedExerciseId, setSelectedExerciseId] = useState<string | null>(null);

  // Clear exercise selection when the user clicks anywhere outside a SHADOW
  // block. We intentionally use document-level mousedown (not React onClick)
  // so it catches clicks on the video, drawer, ShadowChat, etc. The drag
  // handles are inside `[data-shadow-exercise]` so their mousedown won't
  // clear selection.
  useEffect(() => {
    if (!selectedExerciseId) return;
    const onDown = (e: MouseEvent) => {
      const tgt = e.target as HTMLElement | null;
      if (tgt?.closest('[data-shadow-exercise]')) return;
      setSelectedExerciseId(null);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [selectedExerciseId]);
  // WEB-SEAM (T6): 'move' added to the edge union for body-drag (whole-
  // exercise reposition), alongside the pre-existing 'left'/'right' edge-resize.
  // `moved` engages past a 4px threshold (see onMove below) so a plain click
  // on the body still just selects, and dblclick still arms the A/B range —
  // mirrors desktop canon (WorkspacePanelThemed.tsx:380-385).
  const exerciseDragRef = useRef<{
    id: string; edge: 'left' | 'right' | 'move';
    startX: number; initStart: number; initEnd: number;
    barWidth: number; viewLenAtStart: number;
    moved?: boolean;
  } | null>(null);
  const [exerciseDragLive, setExerciseDragLive] = useState<{
    id: string; startTime: number; endTime: number;
  } | null>(null);
  // WEB-SEAM (T6): a real body-move drag ends with a synthetic native `click`
  // on the same element (mouseup target === mousedown target) — without this
  // guard that click would re-fire onExerciseClick/select right after every
  // drop. Set true in onUp once a move actually crossed the threshold; the
  // exercise's onClick below consumes-and-resets it. Mirrors desktop's F2 fix.
  const suppressExerciseClickRef = useRef(false);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const drag = exerciseDragRef.current;
      if (!drag) return;
      const dx = e.clientX - drag.startX;
      // WEB-SEAM (T6): body-drag only engages past a 4px threshold — plain
      // clicks/dblclicks on the body must keep selecting / arming A-B.
      if (drag.edge === 'move' && !drag.moved) {
        if (Math.abs(dx) < 4) return;
        drag.moved = true;
      }
      const dt = (dx / drag.barWidth) * drag.viewLenAtStart;
      const MIN_DURATION = 1.0;
      let nextStart = drag.initStart;
      let nextEnd = drag.initEnd;
      if (drag.edge === 'left') {
        nextStart = Math.min(drag.initEnd - MIN_DURATION, Math.max(0, drag.initStart + dt));
      } else if (drag.edge === 'right') {
        nextEnd = Math.max(drag.initStart + MIN_DURATION, Math.min(duration, drag.initEnd + dt));
      } else {
        // WEB-SEAM (T6): body-move — translate [startTime,endTime] together,
        // duration held fixed, clamped so the whole span stays in [0,duration].
        const len = drag.initEnd - drag.initStart;
        nextStart = Math.max(0, Math.min(Math.max(0, duration - len), drag.initStart + dt));
        nextEnd = nextStart + len;
      }
      setExerciseDragLive({ id: drag.id, startTime: nextStart, endTime: nextEnd });
    };
    const onUp = () => {
      const drag = exerciseDragRef.current;
      const live = exerciseDragLive;
      exerciseDragRef.current = null;
      if (drag && live && onExerciseUpdate) {
        if (drag.edge === 'move') {
          // Never crossed the 4px threshold — this was a click, not a move;
          // onClick handles selection on its own, nothing to persist here.
          if (drag.moved) {
            suppressExerciseClickRef.current = true;
            // A cue already owned by ANOTHER exercise is not a snap target —
            // resolveMovedExercise (lifted T1 helper) needs that occupied set.
            const occupied = new Set<number>(
              (shadowExercises ?? [])
                .filter(x => x.id !== drag.id && x.anchorMode === 'subtitle' && x.subIndex !== undefined)
                .map(x => x.subIndex as number),
            );
            const moved = resolveMovedExercise(live.startTime, live.endTime, cues, occupied);
            // WEB-SEAM (T6): on desktop this positionsCustomized+resolveConflicts
            // decision is made by the PAGE layer wrapping onExerciseUpdate
            // (index.tsx) — web has no such wiring yet for shadowExercises (see
            // progress notes: deferred to the PlayerPage-swap slice), so it is
            // pulled forward into this component for the move path only, per
            // T6 brief. Edge-resize below is left exactly as before (unchanged
            // 2-field patch, no opts) — untouched per "не сломать resize".
            onExerciseUpdate(drag.id, { ...moved, positionsCustomized: true }, { resolveConflicts: true });
          }
        } else {
          onExerciseUpdate(drag.id, {
            startTime: live.startTime,
            endTime: live.endTime,
          });
        }
      }
      setExerciseDragLive(null);
    };
    if (exerciseDragRef.current) {
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      return () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
    }
    return undefined;
  }, [exerciseDragLive, duration, onExerciseUpdate, cues, shadowExercises]);
  // Effective dock side for layout. The committed dock state survives across
  // shadowing sessions (so re-activating restores the previous side), but we
  // only *reserve* gutter space when the shadow panel is actually visible —
  // otherwise stopping shadowing would leave a perpetual empty stripe.
  // Mid-drag hint always wins (`shadowChatDockHint`) so the timeline previews
  // the post-drop layout while the user is still holding the mouse.
  const effectiveDock =
    shadowChatDockHint
    ?? (shadowActive ? shadowChatDock : null);
  const barRef = useRef<HTMLDivElement>(null);
  const [dragTarget, setDragTarget] = useState<DragTarget>(null);
  const [tooltip, setTooltip] = useState<{ text: string; pct: number } | null>(null);
  const panRef = useRef<{ startX: number; startViewStart: number; startViewEnd: number } | null>(null);
  const [rubberBand, setRubberBand] = useState<{ startX: number; currentX: number } | null>(null);
  const [barWidth, setBarWidth] = useState(0); // MED-9: now read to cap the dock reserve at ≤50% of the bar

  const { rangeStart, rangeEnd, viewStart, viewEnd } = workspace;
  const viewLen = Math.max(0.001, viewEnd - viewStart);
  const dur = duration || 60;

  useEffect(() => {
    // ТЗ №7 п.2 — measure the ROOT [data-workspace-bar] (phHostRef), NOT the
    // inner timeline div (barRef). The inner div is a flow child of the padded
    // root, so ITS clientWidth = rootW − dockReserve − paddingX — it SHRINKS by
    // the reserve itself (feedback loop). The docked card, meanwhile, sizes off
    // the root's full getBoundingClientRect().width. Feeding the two
    // dockedReserveWidth() calls DIFFERENT barWidths broke the ТЗ №4 invariant
    // "reserve == card width": for a wide card the reserve settled far narrower
    // (~360 vs card 720) and the card overlapped the transport row's play
    // cluster. Root.clientWidth (content + padding, ≈ border-box) stays constant
    // regardless of the reserve → reserve == card width again.
    const el = phHostRef.current;
    if (!el) return;
    const update = () => setBarWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Auto-recenter the visible window on the playhead ────────────────
  // When the user zooms in (e.g. to the [A,B] range or a custom view) and
  // playback runs past the right edge, the playhead clips against the
  // edge while the time tag keeps growing. The user has explicit
  // expectations: no smooth follow, just a sharp jump that re-centers
  // the playhead. Trigger when we're within 5% of either edge or have
  // already escaped the visible window.
  //
  // Refs throttle the jump — without them the jump itself nudges
  // currentTime → state → re-render in the same frame and the effect
  // fires twice. We compute the new view, store the resulting
  // [start, end] in a ref, and skip if the next observed values
  // already match.
  const lastJumpRef = useRef<{ start: number; end: number; t: number } | null>(null);
  useEffect(() => {
    if (!playing) return;
    const len = viewEnd - viewStart;
    if (!Number.isFinite(len) || len <= 0.5) return;
    const margin = len * 0.05;
    const outsideRight = currentTime > viewEnd - margin;
    const outsideLeft  = currentTime < viewStart + margin;
    if (!outsideRight && !outsideLeft) return;
    // Already jumped to a window that contains the same currentTime?
    const last = lastJumpRef.current;
    if (last && Math.abs(last.t - currentTime) < margin
              && currentTime > last.start + margin
              && currentTime < last.end - margin) {
      return;
    }
    const half = len / 2;
    const newStart = Math.max(0, Math.min(currentTime - half, dur - len));
    const newEnd   = newStart + len;
    lastJumpRef.current = { start: newStart, end: newEnd, t: currentTime };
    onSetView(newStart, newEnd);
  }, [currentTime, viewStart, viewEnd, playing, dur, onSetView]);

  // M2 — single source of truth for AUD / YOU track geometry.
  // Referenced in: handleUp G-branch, G-drag live overlay, committed-selection
  // overlay, and the P3a tracks block. All four sites use identical formulas.
  const trackBands = useMemo(() => {
    const audTop = th.bar.height + 6;
    const audH   = 30;
    const youTop = audTop + audH + 6;
    const youH   = 24;
    return { audTop, audH, youTop, youH };
  }, [th.bar.height]);

  // Pre-compute lane packing only when the theme uses free-stagger.
  const cueLanes = useMemo(() => {
    if (th.cueBlocks.offsetLevel !== 2) return null;
    return packCuesIntoLanes(cues, getEffectiveStart, getEffectiveEnd, offset, 3);
  }, [th.cueBlocks.offsetLevel, cues, getEffectiveStart, getEffectiveEnd, offset]);

  // Top time ruler ticks — only themes that enabled `timeRuler`.
  const rulerTicks = useMemo(() => {
    if (!th.timeRuler?.visible) return null;
    return buildRulerTicks(workspace.viewStart, workspace.viewEnd, th.timeRuler.minorTicks);
  }, [th.timeRuler?.visible, th.timeRuler?.minorTicks, workspace.viewStart, workspace.viewEnd]);

  // Currently-active cue (text overlaid inside the highlight for Atelier /
  // Blueprint). Computed locally to avoid threading another prop through.
  const activeCue = useMemo(() => {
    for (let i = 0; i < cues.length; i++) {
      const s = getEffectiveStart(i, cues[i].startTime) + offset;
      const e = getEffectiveEnd(i, cues[i].endTime) + offset;
      if (currentTime >= s && currentTime <= e) return cues[i];
    }
    return null;
  }, [cues, currentTime, offset, getEffectiveStart, getEffectiveEnd]);

  // Index of the cue whose timestamps cover currentTime, or the *upcoming*
  // cue when between two cues. Used by the bottom-bar nav buttons.
  const cueIdx = useMemo(() => {
    if (cues.length === 0) return -1;
    for (let i = 0; i < cues.length; i++) {
      const s = getEffectiveStart(i, cues[i].startTime) + offset;
      const e = getEffectiveEnd(i, cues[i].endTime) + offset;
      if (currentTime >= s && currentTime <= e) return i;
    }
    // Between cues — return the previous one (so "next" jumps forward).
    for (let i = cues.length - 1; i >= 0; i--) {
      const s = getEffectiveStart(i, cues[i].startTime) + offset;
      if (currentTime >= s) return i;
    }
    return -1;
  }, [cues, currentTime, offset, getEffectiveStart, getEffectiveEnd]);

  // Five nav buttons: prev cue / cue-start / play / cue-end / next cue.
  // All seek into the cue's effective (offset-adjusted) timestamps.
  const seekToCueStart = useCallback((idx: number) => {
    const c = cues[idx]; if (!c) return;
    onSeek(getEffectiveStart(idx, c.startTime) + offset);
  }, [cues, getEffectiveStart, offset, onSeek]);
  const seekToCueEnd = useCallback((idx: number) => {
    const c = cues[idx]; if (!c) return;
    onSeek(getEffectiveEnd(idx, c.endTime) + offset);
  }, [cues, getEffectiveEnd, offset, onSeek]);
  const onPrevCue = useCallback(() => {
    if (cueIdx > 0) seekToCueStart(cueIdx - 1);
    else if (cues.length > 0) seekToCueStart(0);
  }, [cueIdx, cues.length, seekToCueStart]);
  const onNextCue = useCallback(() => {
    if (cueIdx >= 0 && cueIdx < cues.length - 1) seekToCueStart(cueIdx + 1);
  }, [cueIdx, cues.length, seekToCueStart]);
  const onCueRewindStart = useCallback(() => {
    if (cueIdx >= 0) seekToCueStart(cueIdx);
  }, [cueIdx, seekToCueStart]);
  const onCueForwardEnd = useCallback(() => {
    if (cueIdx >= 0) seekToCueEnd(cueIdx);
  }, [cueIdx, seekToCueEnd]);
  // WEB-SEAM: both callbacks above are unread in the desktop source too
  // (kept for keyboard-shortcut parity per the comment below); silences
  // noUnusedLocals (stricter web tsconfig — desktop has no such check).
  void onCueRewindStart; void onCueForwardEnd;
  // Studio handoff transport: ±5 s buttons replace the cue-start / cue-end
  // jumps on the bottom bar (the cue-start / cue-end seekers stay alive for
  // keyboard shortcuts).
  const onRewind5 = useCallback(() => {
    onSeek(Math.max(0, currentTime - 5));
  }, [currentTime, onSeek]);
  const onForward5 = useCallback(() => {
    onSeek(Math.min(duration, currentTime + 5));
  }, [currentTime, duration, onSeek]);

  const timeToPct = useCallback((t: number) => ((t - viewStart) / viewLen) * 100, [viewStart, viewLen]);

  // П2 — speech groups derived from the waveform peaks (silence-bounded).
  const speechSegments = useMemo(
    () => (waveform ? detectSpeechSegments(waveform.peaks, waveform.windowMs) : []),
    [waveform],
  );

  const xToTime = useCallback((clientX: number): number => {
    if (!barRef.current) return 0;
    const rect = barRef.current.getBoundingClientRect();
    const pct = (clientX - rect.left) / rect.width;
    return viewStart + pct * viewLen;
  }, [viewStart, viewLen]);

  const clamp = (v: number) => Math.max(-5, Math.min(105, v));
  const startPct = clamp(timeToPct(rangeStart));
  const endPct = clamp(timeToPct(rangeEnd));
  // W1b: raw (unclamped) pct for the cull gates below — startPct/endPct above
  // are pre-clamped to [-5,105] for DISPLAY (handle stays visually pinned to
  // the bar edge while dragging), which made the old `>-10 && <110` cull gate
  // always true (clamped output never leaves [-5,105]) and let an out-of-view
  // handle render stuck at the edge instead of being culled.
  const startPctRaw = timeToPct(rangeStart);
  const endPctRaw = timeToPct(rangeEnd);
  // Playhead position follows the *actual* currentTime — clamped only to
  // the visible view, NOT to the workspace [rangeStart, rangeEnd] range.
  // A-B loop (workspace.looping) handles the snap-back at the right edge
  // separately; pinning the playhead to rangeEnd here was a UI bug —
  // when looping was off, the diamond got stuck at the B handle even
  // while currentTime/time-tag continued past the region.
  const playPct = Math.max(0, Math.min(100, timeToPct(currentTime)));
  const zoomLevel = dur / viewLen;

  // ── #26 smooth playhead ────────────────────────────────────────────────
  // All playhead elements read `left: var(--php)`. The variable is the single
  // source of truth for the playhead's horizontal position:
  //   • useLayoutEffect writes it from the React playPct on every render — this
  //     covers the paused / seek / initial / no-rAF (jsdom) cases and runs
  //     before paint, so there is no first-frame flash.
  //   • while playing, a rAF loop overrides it from the LIVE videoEl.currentTime
  //     at frame rate, so the playhead glides instead of stepping every ~250ms.
  // The % is still resolved against each element's own offset parent exactly as
  // before — only the value source changed, so positioning is behaviour-identical.
  const viewRef = useRef({ start: viewStart, len: viewLen });
  viewRef.current = { start: viewStart, len: viewLen };

  // Own host ref for the CSS var (panelRef may be a callback ref → no .current).
  // Merge our ref with the incoming panelRef on the root element.
  const phHostRef = useRef<HTMLDivElement | null>(null);
  const setRootRef = useCallback((el: HTMLDivElement | null) => {
    phHostRef.current = el;
    if (typeof panelRef === 'function') panelRef(el);
    else if (panelRef) (panelRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
  }, [panelRef]);

  // ALWAYS seed --php from the React playPct on every render (paused, seek,
  // initial mount, AND while playing). This GUARANTEES the playhead host has a
  // value, so the `left: var(--php, 0%)` elements never fall back to 0% (= time
  // zero). The rAF below overrides it with the live, frame-rate position while
  // playing; here we just guarantee a correct seed (≤16ms before the next rAF
  // frame, so the steppy value is never perceptible). Previously this skipped
  // while playing and handed --php entirely to the rAF — but if the panel root
  // was re-created (e.g. a Z close→open remount), the rAF's once-captured root
  // went stale and the LIVE playhead got no --php → stuck at 0%.
  useLayoutEffect(() => {
    phHostRef.current?.style.setProperty('--php', `${playPct}%`);
  }, [playPct]);

  useEffect(() => {
    if (!playing || typeof requestAnimationFrame !== 'function') return;
    let raf = 0;
    const tick = () => {
      const root = phHostRef.current;
      // WEB-SEAM: read live time from adapter via getTime (no <video> in web);
      // fall back to videoElRef for desktop parity.
      const nowT = getTime ? getTime() : videoElRef?.current?.currentTime;
      if (root && nowT != null) {
        const v = viewRef.current;
        root.style.setProperty('--php', `${playheadLeftPct(nowT, v.start, v.len)}%`);
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [playing, videoElRef, getTime]); // WEB-SEAM: getTime added to deps

  // Boundary-handle click detection. A pointerdown on a handle starts a
  // drag (existing behaviour) but if the user releases without moving
  // more than ~5px it counts as a *click* — used to reveal the Shift
  // inputs in the drawer.
  const handleDownPosRef = useRef<{ x: number; moved: boolean } | null>(null);

  const handlePointerDown = useCallback((target: DragTarget) => (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    setDragTarget(target);
    if (target === 'left' || target === 'right') {
      handleDownPosRef.current = { x: e.clientX, moved: false };
    }
  }, []);

  // Tracks whether pointerup just completed a drag/pan — lets the follow-up
  // click event (fired by the browser after a pointerup at ~same coords)
  // skip the cue-click fallback so a rubber-band doesn't both select AND
  // snap to a cue.
  const justDraggedRef = useRef(false);

  const handleBarPointerDown = useCallback((e: React.PointerEvent) => {
    const tgt = e.target as HTMLElement;
    // Real interactive controls always win — G+click on a <button> still
    // fires the button, not a selection drag.
    if (tgt.closest('button, input, select, textarea')) return;

    // «G»-drag — track selection (Ф1). Modal: overrides timeline-element
    // affordances so the user can rubber-band over cue blocks, recording
    // ribbons, and exercise handles without those elements swallowing the
    // event. Placed ABOVE the cue/handle/no-gesture guards intentionally.
    if (gHeld) {
      const r = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY };
      gDragRef.current = r;
      setGDragRect(r);
      return;
    }

    if (tgt.closest('[data-handle]')) return;
    if (tgt.closest('[data-cue]')) return;
    // Shadow-exercise blocks (Track 1 top stripe) own their own click
    // handler — let it run instead of starting a rubber-band / seek.
    if (tgt.closest('[data-shadow-exercise]')) return;
    // YOU-track ribbons opt out of the bar-level click-to-seek via
    // `data-no-gesture` so a click on a recorded response ribbon does nothing.
    if (tgt.closest('[data-no-gesture]')) return;

    // Minimal: plain click routes to the cue at cursor x (via click handler),
    // Shift+drag starts a rubber-band selection, middle-click pans.
    if (th.id === 'parchment') {
      if (e.shiftKey) {
        setRubberBand({ startX: e.clientX, currentX: e.clientX });
      } else if (e.button === 1) {
        panRef.current = { startX: e.clientX, startViewStart: viewStart, startViewEnd: viewEnd };
      }
      return; // plain click — deferred to handlePanelClick
    }

    if (e.shiftKey) {
      const t = xToTime(e.clientX);
      onSeek(Math.max(rangeStart, Math.min(rangeEnd, t)));
    } else if (e.button === 1) {
      panRef.current = { startX: e.clientX, startViewStart: viewStart, startViewEnd: viewEnd };
    } else {
      setRubberBand({ startX: e.clientX, currentX: e.clientX });
    }
  }, [gHeld, th.id, xToTime, rangeStart, rangeEnd, viewStart, viewEnd, onSeek]);

  // Panel-wide click (no drag): in Minimal variant, route to the cue at
  // the cursor's x-axis. In others it's a no-op (plain rubber-band release
  // without a drag was already a no-op there).
  // Also clears any committed track selection on a plain (non-«G») click.
  const handlePanelClick = useCallback((e: React.MouseEvent) => {
    const tgt = e.target as HTMLElement;
    // A click that originated on a control (the Play / Mute selection buttons,
    // any button/input, or a [data-no-gesture] element) must not be treated as
    // a "plain click on the bar" — it must NOT clear the selection or route a cue.
    if (tgt.closest('button, input, select, textarea, [data-no-gesture]')) return;
    // Plain (non-G) click on the bar clears a committed track selection (Ф1).
    if (selection && !gHeld) {
      clearSelection();
      // Fall through — parchment still needs cue routing below.
    }
    if (th.id !== 'parchment') return;
    if (justDraggedRef.current) return; // drag just finished — skip cue snap
    if (tgt.closest('[data-handle]')) return;
    if (tgt.closest('[data-cue]')) return;
    const t = xToTime(e.clientX);
    for (let i = 0; i < cues.length; i++) {
      const s = getEffectiveStart(i, cues[i].startTime) + offset;
      const en = getEffectiveEnd(i, cues[i].endTime) + offset;
      if (t >= s && t <= en) {
        // WEB-SEAM: 4th ctrlKey param — this fallback path is dead on the web
        // theme set (guarded by `th.id !== 'parchment'` above; web's active
        // theme is 'dusk'), fixed here "for the future" for parity with the
        // live call site below. ФАКТЧЕК M4.
        onCueClick?.(i, e.shiftKey, t, e.ctrlKey);
        return;
      }
    }
  }, [selection, gHeld, clearSelection, th.id, xToTime, cues, getEffectiveStart, getEffectiveEnd, offset, onCueClick]);

  useEffect(() => {
    if (!workspace.active) return;
    if (!dragTarget && !panRef.current && !rubberBand && !gDragRect) return;
    const handleMove = (e: PointerEvent) => {
      // «G»-drag live tracking (Ф1).
      if (gDragRef.current) {
        gDragRef.current = { ...gDragRef.current, x1: e.clientX, y1: e.clientY };
        setGDragRect(gDragRef.current);
        return;
      }
      if (rubberBand) {
        e.preventDefault();
        setRubberBand(prev => prev ? { ...prev, currentX: e.clientX } : null);
        return;
      }
      if (panRef.current) {
        e.preventDefault();
        if (!barRef.current) return;
        const rect = barRef.current.getBoundingClientRect();
        const dx = e.clientX - panRef.current.startX;
        const panViewLen = panRef.current.startViewEnd - panRef.current.startViewStart;
        const dt = -(dx / rect.width) * panViewLen;
        let s = panRef.current.startViewStart + dt;
        let en = panRef.current.startViewEnd + dt;
        if (s < 0) { en -= s; s = 0; }
        if (en > dur) { s -= en - dur; en = dur; }
        onSetView(Math.max(0, s), Math.max(0.5, en));
        return;
      }
      if (!dragTarget) return;
      e.preventDefault();
      // Track movement on boundary handles to distinguish click-vs-drag.
      if (dragTarget === 'left' || dragTarget === 'right') {
        if (handleDownPosRef.current && Math.abs(e.clientX - handleDownPosRef.current.x) > 5) {
          handleDownPosRef.current.moved = true;
        }
      }
      const t = xToTime(e.clientX);
      if (dragTarget === 'left') {
        const newStart = Math.max(0, Math.min(t, rangeEnd - WS_MIN_RANGE));
        onSetRange(newStart, rangeEnd);
        if (currentTime < newStart) onSeek(newStart);
        setTooltip({ text: formatTime(newStart), pct: Math.max(2, Math.min(98, timeToPct(newStart))) });
      } else if (dragTarget === 'right') {
        const newEnd = Math.min(dur, Math.max(t, rangeStart + WS_MIN_RANGE));
        onSetRange(rangeStart, newEnd);
        if (currentTime > newEnd) onSeek(newEnd);
        setTooltip({ text: formatTime(newEnd), pct: Math.max(2, Math.min(98, timeToPct(newEnd))) });
      } else if (dragTarget === 'pos') {
        // Playhead drag: clamp depends on the A-B loop state.
        //   • looping ON  → cannot leave [rangeStart, rangeEnd]
        //   • looping OFF → free over [0, duration]
        const lo = workspace.looping ? rangeStart : 0;
        const hi = workspace.looping ? rangeEnd : dur;
        const clamped = Math.max(lo, Math.min(hi, t));
        onSeek(clamped);
        setTooltip({ text: formatTime(clamped), pct: Math.max(2, Math.min(98, timeToPct(clamped))) });
      }
    };
    const handleUp = (e: PointerEvent) => {
      // «G»-drag commit (Ф1). Recompute geometry inside the effect closure
      // (audTop/audH/youTop/youH are declared in JSX scope, not visible here).
      if (gDragRef.current) {
        const d = gDragRef.current;
        gDragRef.current = null;
        setGDragRect(null);
        const bar = barRef.current?.getBoundingClientRect();
        if (bar && Math.abs(d.x1 - d.x0) > 3) {
          const tA = xToTime(Math.min(d.x0, d.x1));
          const tB = xToTime(Math.max(d.x0, d.x1));
          const yTop = Math.min(d.y0, d.y1) - bar.top;
          const yBot = Math.max(d.y0, d.y1) - bar.top;
          // M2: geometry from trackBands (single SoT — no longer hand-copied).
          const { audTop: _audTop, audH: _audH, youTop: _youTop, youH: _youH } = trackBands;
          const tracks = rectToTracks(yTop, yBot, {
            audTop: _audTop, audH: _audH,
            youTop: _youTop, youH: _youH,
            youVisible: youTrackVisible,
          });
          if (tracks.aud || tracks.you) {
            setSelection({ t1: tA, t2: tB, tracks });
          }
        }
        // I1: suppress the follow-up synthetic click (fires after pointerup on
        // parchment theme), mirroring exactly how the non-G drag path does it.
        justDraggedRef.current = true;
        setTimeout(() => { justDraggedRef.current = false; }, 120);
        return;
      }
      let didDrag = false;
      if (rubberBand) {
        const dx = Math.abs(rubberBand.currentX - rubberBand.startX);
        if (dx > 5) {
          didDrag = true;
          const t1 = xToTime(Math.min(rubberBand.startX, e.clientX));
          const t2 = xToTime(Math.max(rubberBand.startX, e.clientX));
          let minStart = Infinity, maxEnd = -Infinity;
          cues.forEach((cue, i) => {
            const cs = getEffectiveStart(i, cue.startTime) + offset;
            const ce = getEffectiveEnd(i, cue.endTime) + offset;
            if (ce > t1 && cs < t2) {
              if (cs < minStart) minStart = cs;
              if (ce > maxEnd) maxEnd = ce;
            }
          });
          if (minStart < Infinity && maxEnd > -Infinity) {
            // WEB-SEAM: desktop (WorkspacePanelThemed.tsx:859-861) does
            // onSetRange + onSeek(minStart) + onFitToRange on rubber-commit. Web drops
            // the seek+fit per owner decision #1 («ничего лишнего»): a selection sets
            // [A,B] only, never moves the camera or the playhead. This also removes the
            // «чужой активный cue» artifact (seek→A lit the cue whose start==A).
            onSetRange(minStart, maxEnd);
          }
        } else {
          // No drag → treat the rubber-band start as a *click* and seek
          // the playhead there. Skips for the Minimal variant which
          // already routes clicks to the cue under the cursor in
          // handlePanelClick (a different gesture).
          if (th.id !== 'parchment') {
            const seekT = Math.max(0, Math.min(dur, xToTime(e.clientX)));
            onSeek(seekT);
            // If the click lands outside [A, B] and looping is on, the
            // player would yo-yo back inside the region the next frame.
            // Auto-disable looping so the seek sticks. Per spec:
            // "если клик приводит к смене текущего местоположения и он
            // оказывается вне границ A и B, то состояние кнопки A-B нужно
            // менять на 'не нажата'".
            if (workspace.looping && (seekT < rangeStart || seekT > rangeEnd)) {
              onSetLooping?.(false);
            }
          }
        }
        setRubberBand(null);
      }
      if (panRef.current || dragTarget) didDrag = true;
      // Boundary handle click: dragTarget was 'left'|'right' but pointer
      // didn't move past the threshold → fire onHandleClick.
      if ((dragTarget === 'left' || dragTarget === 'right')
          && handleDownPosRef.current && !handleDownPosRef.current.moved) {
        onHandleClick?.();
      }
      handleDownPosRef.current = null;
      if (didDrag) {
        justDraggedRef.current = true;
        // Clear shortly after the follow-up click fires.
        setTimeout(() => { justDraggedRef.current = false; }, 120);
      }
      setDragTarget(null);
      panRef.current = null;
      setTooltip(null);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  });

  // WEB-SEAM: native non-passive wheel listener needs a stable function
  // identity (see the attach-effect below), but the handler's own logic
  // depends on viewStart/viewEnd/viewLen/xToTime/onSetView which change on
  // every pan/zoom. A ref-read pattern keeps handleWheel's identity fixed
  // (useCallback with an empty dep list) while still reading the latest
  // values — this is the minimal change needed so the listener isn't
  // removed+re-added on every render. Body logic is otherwise unchanged.
  const wheelStateRef = useRef({ viewStart, viewEnd, viewLen, xToTime, onSetView });
  wheelStateRef.current = { viewStart, viewEnd, viewLen, xToTime, onSetView };

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const { viewStart, viewEnd, viewLen, xToTime, onSetView } = wheelStateRef.current;
    if (e.ctrlKey) {
      const mouseTime = xToTime(e.clientX);
      const delta = -e.deltaY / 1000;
      onSetView(viewStart + delta * (mouseTime - viewStart), viewEnd + delta * (mouseTime - viewEnd));
    } else {
      const panAmount = viewLen * 0.1 * Math.sign(e.deltaY);
      onSetView(viewStart + panAmount, viewEnd + panAmount);
    }
  }, []);

  // WEB-SEAM: React onWheel is passive in a web build → preventDefault can't
  // stop browser Ctrl+page-zoom (no such bug in Electron). Attach the same
  // handler natively as non-passive on the panel root.
  useEffect(() => {
    const el = phHostRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  const visibilityMap = cueVisibility || {};

  if (!workspace.active) {
    // WEB-SEAM: гейт dev-логов — на живом сайте панель рендерится ~4Гц
    if (import.meta.env.DEV) {
      console.log('[PLAYER_THEME] WorkspacePanelThemed early-return (workspace inactive)', {
        themeId: th.id,
      });
    }
    return null;
  }
  // WEB-SEAM: гейт dev-логов — на живом сайте панель рендерится ~4Гц
  if (import.meta.env.DEV) {
    console.log('[PLAYER_THEME] WorkspacePanelThemed render', {
      themeId: th.id,
      cueCount: cues.length,
      barHeight: th.bar.height,
      tracks: { shadow: th.tracks.shadow.visible, dictation: th.tracks.dictation.visible, subtitles: th.tracks.subtitles.visible },
      cueVisibilityEntries: Object.keys(visibilityMap).length,
    });
  }

  const btnStyle: React.CSSProperties = {
    padding: '5px 10px', borderRadius: 6,
    border: `1px solid ${th.rightPanel.button.border}`,
    background: th.rightPanel.button.bg,
    color: th.rightPanel.button.fg,
    cursor: 'pointer', fontSize: 12,
    display: 'flex', alignItems: 'center', gap: 4,
    whiteSpace: 'nowrap',
  };

  // Per-theme bottom-control palette. Themes that supply a `bottomControls`
  // block (Atelier) win; everyone else uses Studio handoff CSS vars
  // (--btn-bg / --border / --accent / …) so the bottom bar inherits the
  // theme palette automatically.
  const bc = th.bottomControls;
  const navBtnStyle: React.CSSProperties = bc?.navButton ? {
    padding: 0,
    width: bc.navButton.size ?? 32,
    height: bc.navButton.size ?? 32,
    borderRadius: bc.navButton.radius ?? '50%',
    border: bc.navButton.border ?? '1px solid transparent',
    background: bc.navButton.background ?? 'transparent',
    color: bc.navButton.fg ?? th.rightPanel.button.fg,
    cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  } : {
    padding: 0, width: 32, height: 32, borderRadius: '50%',
    background: 'var(--btn-bg)', border: '1px solid var(--border)',
    color: 'var(--fg-dim)', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  };
  const navIconSize = bc?.navButton?.iconSize ?? 14;

  const playBtnStyle: React.CSSProperties = bc?.playButton ? {
    padding: 0,
    width: bc.playButton.size ?? 40,
    height: bc.playButton.size ?? 40,
    borderRadius: bc.playButton.radius ?? '50%',
    border: bc.playButton.border ?? 'none',
    background: bc.playButton.background ?? 'var(--accent)',
    color: bc.playButton.fg ?? 'var(--accent-fg)',
    boxShadow: bc.playButton.glow ?? 'none',
    cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  } : {
    padding: 0, width: 40, height: 40, borderRadius: '50%',
    background: 'var(--accent)', border: 'none',
    color: 'var(--accent-fg)', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  };
  const playIconSize = bc?.playButton?.iconSize ?? 16;

  const pillBtnStyle = (active: boolean): React.CSSProperties => bc?.pillButton ? {
    padding: bc.pillButton.padding ?? '5px 12px',
    borderRadius: bc.pillButton.radius ?? 6,
    border: `1px solid ${active && bc.pillButton.activeBorder ? bc.pillButton.activeBorder : (bc.pillButton.border ?? 'transparent')}`,
    background: active && bc.pillButton.activeBackground ? bc.pillButton.activeBackground : (bc.pillButton.background ?? 'transparent'),
    color: active && bc.pillButton.activeFg ? bc.pillButton.activeFg : (bc.pillButton.fg ?? th.rightPanel.button.fg),
    fontFamily: bc.pillButton.fontFamily ?? 'inherit',
    fontStyle: bc.pillButton.fontStyle ?? 'normal',
    fontWeight: bc.pillButton.fontWeight ?? 500,
    fontSize: 13,
    cursor: 'pointer',
    display: 'flex', alignItems: 'center', gap: 6,
    whiteSpace: 'nowrap',
  } : {
    padding: '6px 12px', borderRadius: 16, fontSize: 12, fontWeight: 600,
    background: active ? 'var(--seg-on)' : 'var(--btn-bg)',
    color: active ? 'var(--seg-on-fg, var(--accent-fg))' : 'var(--fg-dim)',
    border: `1px solid ${active ? 'var(--seg-on, var(--accent))' : 'var(--border)'}`,
    cursor: 'pointer',
    display: 'flex', alignItems: 'center', gap: 6,
    whiteSpace: 'nowrap',
  };

  const timeFont = bc?.time?.font ?? '12px var(--ui-font, ui-monospace), Menlo, monospace';
  const timeFg = bc?.time?.fg ?? 'var(--fg)';
  const timeMutedFg = bc?.time?.mutedFg ?? 'var(--fg-mute)';
  const timeSeparator = bc?.time?.separatorKey
    ? t(bc.time.separatorKey)
    : (bc?.time?.separator ?? '/');

  const exitLabel = bc?.exitButton?.labelKey
    ? t(bc.exitButton.labelKey)
    : (bc?.exitButton?.label ?? (t('player.exitLabel') || 'Закрыть'));
  const exitBtnStyle: React.CSSProperties = bc?.exitButton ? {
    ...(bc.pillButton ? pillBtnStyle(false) : btnStyle),
    background: bc.exitButton.background ?? 'var(--btn-bg)',
    border: `1px solid ${bc.exitButton.border ?? 'var(--danger-border, var(--border))'}`,
    color: bc.exitButton.fg ?? 'var(--danger)',
  } : {
    padding: '6px 12px', borderRadius: 16, fontSize: 12, fontWeight: 600,
    background: 'var(--btn-bg)',
    border: '1px solid var(--danger-border, var(--border))',
    color: 'var(--danger)',
    cursor: 'pointer',
    display: 'flex', alignItems: 'center', gap: 6,
    whiteSpace: 'nowrap',
  };

  const accent = th.handles.color;
  const shadowColor = th.tracks.shadow.color;
  void shadowColor; // WEB-SEAM: unread in the desktop source too; silences noUnusedLocals (stricter web tsconfig)
  const dictColor = th.tracks.dictation.color;

  const panelBgLayers: React.CSSProperties = th.panel.patternImage ? {
    backgroundImage: th.panel.patternImage,
    backgroundSize: th.panel.patternSize,
    backgroundColor: th.panel.background,
  } : {
    background: th.panel.background,
  };

  const frameInsetTop = th.outerFrame?.insetTop ?? 0;
  const frameInsetBottom = th.outerFrame?.insetBottom ?? 0;
  const highlightInset = th.bar.highlightInsetY ?? 0;

  // ShadowChat dock-aware paddings — reserve space on the side it occupies
  // so the timeline shifts away. The 8 px gutter keeps a sliver of breathing
  // room between the docked panel border and the cue ribbons. Honours both
  // the committed dock state and the live drag hint, so the bar previews
  // the future layout while the user is still holding the mouse.
  // ТЗ №4 п.1 — резерв считаем через ЕДИНЫЙ helper dockedReserveWidth(size,
  // barWidth), тот же, что задаёт ВИДИМУЮ ширину карты в доке (ShadowCardLifted
  // containerStyle). Оба используют один barWidth ([data-workspace-bar]) → reserve
  // ВСЕГДА == ширине карты, перекрытия таймлайна/транспорта нет. MED-9 кламп bar/2
  // теперь внутри helper'а; barWidth=0 (jsdom no-layout) → без клампа (raw).
  const dw = dockedReserveWidth(shadowChatSizeLive ?? shadowChatSize, barWidth);
  // ТЗ №8 п.1 — при dock-LEFT таймлайн-резерв = ширина карты (dw) + ГУТТЕР (38 =
  // 36px лейблы дорожек «1 SUB»/«2 AUD»/mute + 2px breathing, тот же -38, что у
  // самого гуттера). Гуттер живёт в полосе СРАЗУ за картой (его left вернулся к
  // -38, т.е. в reserved-band), а кью/волна/ТРАНСПОРТ начинаются ПОСЛЕ него.
  // Без +38 (ТЗ №6 п.4 двигал только сам гуттер на left:0) гуттер и первые кью
  // рисовались от ОДНОГО контент-края → кью ПОД лейблами (live-факт: card[216,936],
  // гуттер[936,972], кью с x=938). dock-RIGHT не трогаем: гуттер там на ЛЕВОМ
  // внешнем крае (-38), а карта справа — не пересекаются.
  const TRACK_GUTTER_RESERVE = 38;
  const dockReserve = effectiveDock
    ? { paddingLeft: effectiveDock === 'left' ? dw + TRACK_GUTTER_RESERVE : th.panel.paddingX,
        paddingRight: effectiveDock === 'right' ? dw : th.panel.paddingX }
    : { paddingLeft: th.panel.paddingX, paddingRight: th.panel.paddingX };

  return (
    <div ref={setRootRef}
      data-workspace-bar
      data-ab-start={workspace.rangeStart}
      data-ab-end={workspace.rangeEnd}
      // WEB-SEAM: moved to native non-passive listener (see effect above)
      onPointerDown={handleBarPointerDown}
      onClick={handlePanelClick}
      style={{
        position: 'relative', // WEB-SEAM: in-flow in web layout (desktop overlays video bottom)
        ...panelBgLayers,
        backdropFilter: th.panel.backdropBlur,
        padding: `${th.panel.paddingTop}px 0 ${th.panel.paddingBottom}px`,
        ...dockReserve,
        borderTop: th.panel.borderTop,
        zIndex: 5,
        display: 'flex', flexDirection: 'column', gap: th.panel.gap,
        animation: 'slideUp 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
        transition: 'padding-left 150ms ease-out, padding-right 150ms ease-out',
        touchAction: 'none', userSelect: 'none',
      }}>
      {/* Top time ruler (Blueprint / Atelier) */}
      {th.timeRuler?.visible && rulerTicks && (() => {
        const tr = th.timeRuler;
        return (
          <div style={{
            position: 'relative', height: tr.height,
            font: tr.font,
            color: tr.color,
            marginBottom: -2,
          }}>
            {rulerTicks.map((tk, i) => (
              <div key={i} style={{
                position: 'absolute', top: 0, bottom: 0,
                left: `${tk.pct}%`, transform: 'translateX(-50%)',
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                pointerEvents: 'none',
                opacity: tk.pct < -2 || tk.pct > 102 ? 0 : 1,
              }}>
                {tk.major && tk.label && (
                  <span style={{ fontSize: tr.labelSize, lineHeight: 1, whiteSpace: 'nowrap' }}>
                    {tk.label}
                  </span>
                )}
                <div style={{
                  width: 1,
                  height: tk.major ? 8 : 4,
                  background: tr.tickColor,
                  marginTop: tk.major ? 2 : 6,
                }} />
              </div>
            ))}
          </div>
        );
      })()}

      {/* Bar — gestures handled by the panel root so the full height is
          responsive. This div still hosts the interactive timeline layers.
          P3a — bar extended downward to host the AUD waveform track and the
          optional YOU (user voice) track from the Player Theme Preview
          design. Existing Track 1 (cues, attempts strips, dictation,
          subtitles) keeps its original positions so theme-specific tweaks
          stay valid. New tracks are pinned to fixed offsets below it. */}
      <div
        ref={barRef}
        style={{
          position: 'relative',
          // Track 1 (existing bar content) + gap + AUD 30 + (gap + YOU 24)?
          // The extra +4 reserves room for the track separators rendered
          // between SUB and AUD (and between AUD and YOU).
          height: th.bar.height + 6 + 30 + (youTrackVisible ? 6 + 24 : 0) + 4,
          cursor: dragTarget ? 'grabbing' : panRef.current ? 'grabbing' : 'pointer',
          background: 'transparent',
        }}
      >
        {/* Decorative outer frame (Blueprint / Atelier) */}
        {th.outerFrame && (
          <>
            <div style={{
              position: 'absolute',
              top: th.outerFrame.insetTop,
              bottom: th.outerFrame.insetBottom,
              left: 0, right: 0,
              border: th.outerFrame.border,
              borderRadius: th.outerFrame.borderRadius,
              pointerEvents: 'none',
              zIndex: 0,
            }} />
            {th.outerFrame.innerBorder && (
              <div style={{
                position: 'absolute',
                top: th.outerFrame.insetTop + (th.outerFrame.innerInset ?? 3),
                bottom: th.outerFrame.insetBottom + (th.outerFrame.innerInset ?? 3),
                left: (th.outerFrame.innerInset ?? 3),
                right: (th.outerFrame.innerInset ?? 3),
                borderTop: th.outerFrame.innerBorder,
                borderBottom: th.outerFrame.innerBorder,
                pointerEvents: 'none',
                zIndex: 0,
              }} />
            )}
          </>
        )}

        {/* Thin track background */}
        <div style={{
          position: 'absolute',
          top: `calc(50% + ${(frameInsetTop - frameInsetBottom) / 2}px)`,
          left: 0, right: 0,
          transform: 'translateY(-50%)',
          height: th.bar.trackHeight, background: th.bar.trackColor,
          borderRadius: Math.max(0, th.bar.trackHeight / 2),
        }} />

        {/* In-range highlight — Dusk turns this into a golden bookplate
            frame (border + radius from theme). Other variants use the
            wash-only legacy look. */}
        <div style={{
          position: 'absolute',
          top: frameInsetTop + highlightInset,
          bottom: frameInsetBottom + highlightInset,
          left: `${startPct}%`, width: `${Math.max(0, endPct - startPct)}%`,
          background: th.bar.highlightGradient,
          boxShadow: th.bar.highlightGlow,
          border: th.bar.highlightBorder ?? 'none',
          borderRadius: th.bar.highlightBorderRadius ?? 0,
          pointerEvents: 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'flex-start',
          overflow: 'hidden',
        }}>
          {/* Active cue text overlay (Atelier / Blueprint) */}
          {th.activeCueLabel && activeCue && (
            <div style={{
              font: th.activeCueLabel.font,
              color: th.activeCueLabel.color,
              padding: th.activeCueLabel.padding ?? '0 12px',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              width: '100%',
              pointerEvents: 'none',
            }}>
              {activeCue.text.replace(/<[^>]*>/g, ' ').trim()}
            </div>
          )}
        </div>

        {/* Shadow attempts strip on Track 1 — disabled. The user-response
            visualisation moved down to the YOU track (rendered with the
            other P3a tracks block) so the SUB track stays clean: top
            stripe = exercises, bottom stripe = subtitles, no overlap. */}

        {/* Track 1 separator — thin horizontal line between the exercise
            stripe (above) and the subtitle stripe (below). Sits exactly
            at the y where subtitles begin so neither side is clipped. */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            left: 0, right: 0,
            top: Math.max(9, th.tracks.subtitles.y - 1),
            height: 1,
            background: 'var(--border, rgba(255,255,255,0.10))',
            pointerEvents: 'none',
            zIndex: 1,
          }}
        />

        {/* Shadow exercise blocks (P3a) — persistent practice schemes
            bound to subtitles or time ranges. Top half of Track 1.
            Click selects (shows L/R drag handles); right-click deletes;
            handles drag to resize startTime / endTime. */}
        {shadowExercises && shadowExercises.map(ex => {
          // Subtitle-anchored exercises follow per-cue timing offsets so
          // they stay visually attached to their cue when the subtitle
          // shift changes; time-range exercises use raw time + global offset.
          const live = exerciseDragLive && exerciseDragLive.id === ex.id ? exerciseDragLive : null;
          const rawStart = live ? live.startTime : ex.startTime;
          const rawEnd   = live ? live.endTime   : ex.endTime;
          const effStart = ex.anchorMode === 'subtitle' && ex.subIndex !== undefined && !live
            ? getEffectiveStart(ex.subIndex, rawStart) + offset
            : rawStart + offset;
          const effEnd = ex.anchorMode === 'subtitle' && ex.subIndex !== undefined && !live
            ? getEffectiveEnd(ex.subIndex, rawEnd) + offset
            : rawEnd + offset;
          const l = timeToPct(effStart);
          const widthPct = ((effEnd - effStart) / viewLen) * 100;
          if (l + widthPct < -5 || l > 105) return null;
          // WEB-SEAM: fb#6 — shadow-блок клампится тем же clampCueEdges, что SUB/dictation
          // (был на старой -2..104 математике без верхней границы left → окно 100..105
          // висело за краем плеера, pointerEvents:'auto' → кликабельно). Оба края
          // независимо; сливер 0.3% всегда на канве. rightClamped больше не нужен.
          const { left: leftClamped, width: widthClamped } = clampCueEdges(l, widthPct);
          const selected = selectedExerciseId === ex.id;
          const blockColor = th.tracks.shadow.color;

          // L/R handle drag start. Captures bar geometry once at mousedown
          // so width/viewLen drift mid-drag (e.g. zoom) doesn't confuse
          // the px→time conversion.
          const startResize = (edge: 'left' | 'right') => (e: React.MouseEvent) => {
            if (!onExerciseUpdate) return;
            e.stopPropagation();
            e.preventDefault();
            const barEl = barRef.current;
            if (!barEl) return;
            const rect = barEl.getBoundingClientRect();
            exerciseDragRef.current = {
              id: ex.id, edge,
              startX: e.clientX,
              initStart: ex.startTime,
              initEnd: ex.endTime,
              barWidth: rect.width || 1,
              viewLenAtStart: viewLen,
            };
            setExerciseDragLive({ id: ex.id, startTime: ex.startTime, endTime: ex.endTime });
          };

          // WEB-SEAM (T6): body-move drag — mousedown on the BODY (not a
          // resize handle; handles stopPropagation on their own mousedown, so
          // this never fires when grabbing an edge) arms a 'move' drag. Below
          // the 4px threshold (checked in the mousemove effect above) it
          // stays a plain click/dblclick.
          return (
            <div
              key={`ex-${ex.id}`}
              data-shadow-exercise
              title={ex.anchorMode === 'subtitle'
                ? `Shadow · sub #${(ex.subIndex ?? 0) + 1} · ${ex.settings.advanceThreshold}%`
                : `Shadow · ${ex.startTime.toFixed(1)}s–${ex.endTime.toFixed(1)}s · ${ex.settings.advanceThreshold}%`}
              onMouseDown={(e) => {
                if (!onExerciseUpdate || e.button !== 0) return;
                const barEl = barRef.current;
                if (!barEl) return;
                e.preventDefault();
                // Stale suppression from a previous move whose mouseup landed
                // off the block (click never fired, flag never consumed) —
                // reset it at the start of every new interaction.
                suppressExerciseClickRef.current = false;
                const rect = barEl.getBoundingClientRect();
                exerciseDragRef.current = {
                  id: ex.id, edge: 'move',
                  startX: e.clientX,
                  initStart: ex.startTime,
                  initEnd: ex.endTime,
                  barWidth: rect.width || 1,
                  viewLenAtStart: viewLen,
                };
                setExerciseDragLive({ id: ex.id, startTime: ex.startTime, endTime: ex.endTime });
              }}
              onClick={(e) => {
                e.stopPropagation();
                // WEB-SEAM (T6): a click synthesized right after a body-move
                // drop is not a selection — swallow it once (see suppress-ref
                // comment above).
                if (suppressExerciseClickRef.current) {
                  suppressExerciseClickRef.current = false;
                  return;
                }
                setSelectedExerciseId(ex.id);
                onExerciseClick?.(ex.id);
              }}
              onDoubleClick={(e) => {
                // task #1068: двойной клик ставит A/B-петлю ровно по границам
                // упражнения (магнита нет — ручная установка A/B промахивалась на
                // ±0.1с → плейхед на рестарте выходил за регион, тест моргал).
                e.stopPropagation();
                const r = exerciseAbRange(ex);
                onSetRange(r.rangeStart, r.rangeEnd);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (onExerciseDelete && window.confirm('Удалить упражнение Shadowing?')) {
                  setSelectedExerciseId(curr => curr === ex.id ? null : curr);
                  onExerciseDelete(ex.id);
                }
              }}
              style={{
                position: 'absolute',
                // Top stripe of Track 1 — exercises live ABOVE subtitles, never
                // overlapping. Subtitles start at th.tracks.subtitles.y; the
                // exercise stripe gets the available space above (minus 1 px
                // for the visible separator). Min 10 px so the badge with the
                // S letter remains legible even on themes that pack subs high.
                top: 0,
                height: Math.max(10, th.tracks.subtitles.y - 1),
                left: `${leftClamped}%`,
                width: `${widthClamped}%`,
                // Unselected = subtle translucent fill, no outline (per
                // user request — borders only appear on click). The S
                // letter inside hints at the time range without competing
                // with subtitle ribbons below for visual weight.
                background: blockColor,
                border: selected ? `1.5px solid var(--accent-fg, #1A0A0C)` : 'none',
                borderRadius: 3,
                opacity: selected ? 1 : 0.45,
                // WEB-SEAM (T6): grab/grabbing hints the body is draggable
                // (parity with desktop) — plain 'pointer' when no update
                // handler is wired (drag is a no-op without onExerciseUpdate).
                cursor: onExerciseUpdate ? (live ? 'grabbing' : 'grab') : 'pointer',
                pointerEvents: 'auto',
                overflow: 'hidden',
                display: 'flex', alignItems: 'center', justifyContent: 'flex-start',
                padding: '0 6px',
                fontFamily: 'var(--mono-font, "IBM Plex Mono", ui-monospace, monospace)',
                fontSize: 9, fontWeight: 700, letterSpacing: .5,
                color: 'var(--accent-fg, #1A0A0C)',
                textTransform: 'uppercase',
                whiteSpace: 'nowrap',
                zIndex: selected ? 4 : 2,
                transition: live ? 'none' : 'opacity .12s linear, border-color .12s linear',
              }}
            >
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                S{live ? ` · ${(live.endTime - live.startTime).toFixed(1)}s` : ''}
              </span>
              {selected && (
                <>
                  <div
                    title="Drag left edge"
                    onMouseDown={startResize('left')}
                    onClick={(e) => e.stopPropagation()}
                    style={resizeHandleStyle('left')}
                  />
                  <div
                    title="Drag right edge"
                    onMouseDown={startResize('right')}
                    onClick={(e) => e.stopPropagation()}
                    style={resizeHandleStyle('right')}
                  />
                </>
              )}
            </div>
          );
        })}

        {/* Dictation lane */}
        {th.tracks.dictation.visible && dictationAttempts && Object.entries(dictationAttempts).map(([cueIdxStr, entry]) => {
          const cueIdx = parseInt(cueIdxStr);
          const cue = cues[cueIdx];
          if (!cue || !entry.attempts.length) return null;
          const effStart = getEffectiveStart(cueIdx, cue.startTime) + offset;
          const effEnd = getEffectiveEnd(cueIdx, cue.endTime) + offset;
          const l = timeToPct(effStart);
          const widthPct = ((effEnd - effStart) / viewLen) * 100;
          if (l + widthPct < -5 || l > 105) return null;
          const bestPct = Math.max(...entry.attempts.map(a => a.match_pct));
          // WEB-SEAM: cue-clamp.ts — независимый кламп левого/правого края
          const clamped = clampCueEdges(l, widthPct);
          return (
            <div
              key={`dc-${cueIdx}`}
              title={`Dictation cue ${cueIdx + 1}: best ${bestPct}%`}
              style={{
                position: 'absolute',
                top: th.tracks.dictation.y, height: th.tracks.dictation.height,
                left: `${clamped.left}%`,
                width: `${clamped.width}%`,
                background: dictColor,
                borderRadius: 2,
                opacity: 0.65, pointerEvents: 'none',
              }}
            />
          );
        })}

        {/* Dictation live marker */}
        {dictationActive && th.tracks.dictation.visible && (
          <div style={{
            position: 'absolute',
            top: th.tracks.dictation.y - 1, height: th.tracks.dictation.height + 2,
            left: 'var(--php, 0%)',
            width: 4, transform: 'translateX(-50%)',
            background: dictColor,
            boxShadow: `0 0 6px ${dictColor}`,
            borderRadius: 2,
            animation: 'wsReconnectPulse 1.2s ease-in-out infinite',
            pointerEvents: 'none',
          }} />
        )}

        {/* Subtitle/cue blocks */}
        {th.tracks.subtitles.visible && cues.map((cue, i) => {
          const effStart = getEffectiveStart(i, cue.startTime) + offset;
          const effEnd = getEffectiveEnd(i, cue.endTime) + offset;
          const l = timeToPct(effStart);
          const widthPct = ((effEnd - effStart) / viewLen) * 100;
          if (l + widthPct < -5 || l > 105) return null;
          const inRange = effStart >= rangeStart - 0.01 && effEnd <= rangeEnd + 0.01;
          const isActive = currentTime >= effStart && currentTime <= effEnd;
          let laneOffset = 0;
          if (th.cueBlocks.offsetLevel === 1) laneOffset = (i % 2) * (th.cueBlocks.height + 2);
          else if (th.cueBlocks.offsetLevel === 2 && cueLanes) laneOffset = cueLanes[i] * (th.cueBlocks.height + 2);
          const visState = visibilityMap[i];
          const staggerY = th.visibilityTiers.mode === 'stagger'
            ? (visState === 'show' ? (th.visibilityTiers.shownYOffset ?? 0)
              : visState === 'hide' ? (th.visibilityTiers.hiddenYOffset ?? 0)
              : 0)
            : 0;
          const opacity = th.visibilityTiers.mode === 'opacity'
            ? (visState === 'hide' ? th.visibilityTiers.hiddenOpacity : th.visibilityTiers.shownOpacity)
            : 1;
          const isUnderline = th.cueBlocks.height <= 2;
          // WEB-SEAM: cue-clamp.ts — независимый кламп левого/правого края
          const clamped = clampCueEdges(l, widthPct);
          return (
            <div
              key={i}
              data-cue
              onClick={(e) => { e.stopPropagation(); onCueClick?.(i, e.shiftKey, xToTime(e.clientX), e.ctrlKey); }}
              onContextMenu={onCueContextMenu ? (e) => { e.preventDefault(); e.stopPropagation(); onCueContextMenu(i, e.clientX, e.clientY); } : undefined}
              style={{
                position: 'absolute',
                top: th.tracks.subtitles.y - laneOffset + staggerY,
                height: th.cueBlocks.height,
                left: `${clamped.left}%`,
                width: `${clamped.width}%`,
                background: isUnderline ? 'transparent'
                  : isActive ? th.cueBlocks.bgActive
                  : inRange ? th.cueBlocks.bgInRange
                  : th.cueBlocks.bgIdle,
                border: isUnderline
                  ? 'none'
                  : `1px ${inRange || isActive ? 'solid' : th.cueBlocks.borderStyleIdle} ${
                      isActive ? th.cueBlocks.borderActive
                      : inRange ? th.cueBlocks.borderInRange
                      : th.cueBlocks.borderIdle
                    }`,
                borderBottom: isUnderline
                  ? `${Math.max(1, th.cueBlocks.height)}px solid ${
                      isActive ? th.cueBlocks.borderActive
                      : inRange ? th.cueBlocks.borderInRange
                      : th.cueBlocks.borderIdle
                    }`
                  : undefined,
                borderRadius: th.cueBlocks.borderRadius,
                fontSize: th.cueBlocks.fontSize,
                lineHeight: `${th.cueBlocks.height}px`,
                color: isActive ? (th.cueBlocks.textActive ?? '#fff')
                  : inRange ? (th.cueBlocks.textInRange ?? 'rgba(255,255,255,0.88)')
                  : (th.cueBlocks.textIdle ?? 'rgba(255,255,255,0.62)'),
                padding: th.cueBlocks.fontSize > 0 ? '0 4px' : 0,
                overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                pointerEvents: 'auto',
                cursor: 'pointer',
                transition: 'background 0.15s, opacity 0.15s, top 0.2s',
                opacity,
                boxShadow: th.cueBlocks.glossy
                  ? 'inset 0 1px 0 rgba(255,255,255,0.25), 0 2px 6px rgba(0,0,0,0.3)'
                  : undefined,
              }}
            >
              {th.cueBlocks.fontSize > 0 && widthPct > 3
                ? cue.text.replace(/<[^>]*>/g, ' ').trim().substring(0, 80)
                : ''}
            </div>
          );
        })}

        {/* Rubber-band overlay */}
        {rubberBand && barRef.current && Math.abs(rubberBand.currentX - rubberBand.startX) > 5 && (() => {
          const rect = barRef.current!.getBoundingClientRect();
          const leftPx = Math.min(rubberBand.startX, rubberBand.currentX) - rect.left;
          const widthPx = Math.abs(rubberBand.currentX - rubberBand.startX);
          return (
            <div style={{
              position: 'absolute', top: 0, bottom: 0,
              left: `${(leftPx / rect.width) * 100}%`,
              width: `${(widthPx / rect.width) * 100}%`,
              background: `${accent}33`,
              border: `1px solid ${accent}80`,
              borderRadius: 3,
              pointerEvents: 'none', zIndex: 3,
            }} />
          );
        })()}

        {/* ─── Ф1: G-drag live overlay (rubber-band + track highlights) ─── */}
        {gDragRect && barRef.current && (() => {
          const bar = barRef.current!.getBoundingClientRect();
          // Live drag geometry — bar-relative.
          const xLeft  = Math.min(gDragRect.x0, gDragRect.x1) - bar.left;
          const xRight = Math.max(gDragRect.x0, gDragRect.x1) - bar.left;
          const yTop   = Math.min(gDragRect.y0, gDragRect.y1) - bar.top;
          const yBot   = Math.max(gDragRect.y0, gDragRect.y1) - bar.top;
          const xW     = xRight - xLeft;
          const yH     = yBot - yTop;
          void yH; // WEB-SEAM: unread in the desktop source too; silences noUnusedLocals (stricter web tsconfig)
          // M2: geometry from trackBands (single SoT).
          const { audTop: _audTop, audH: _audH, youTop: _youTop, youH: _youH } = trackBands;
          const liveTracks = rectToTracks(yTop, yBot, {
            audTop: _audTop, audH: _audH,
            youTop: _youTop, youH: _youH,
            youVisible: youTrackVisible,
          });
          // Snap rubber-band vertically to full track height(s) when the drag
          // covers at least one track — mirrors the committed-selection formula.
          const snapToTracks = liveTracks.aud || liveTracks.you;
          const rbTop    = snapToTracks
            ? (liveTracks.aud ? _audTop : _youTop)
            : yTop;
          const rbBot    = snapToTracks
            ? (liveTracks.you ? _youTop + _youH : _audTop + _audH)
            : yBot;
          const rbH      = Math.max(snapToTracks ? 0 : 1, rbBot - rbTop);
          return (
            <>
              {/* M4: single xW > 3 guard wraps all three live-overlay children */}
              {xW > 3 && (
                <>
                  {/* Live rubber-band rectangle — snaps to full track height */}
                  <div style={{
                    position: 'absolute',
                    left: `${(xLeft / bar.width) * 100}%`,
                    width: `${(xW / bar.width) * 100}%`,
                    top: rbTop, height: rbH,
                    background: `color-mix(in srgb, var(--accent, ${accent}) 18%, transparent)`,
                    border: `1px dashed var(--accent, ${accent})`,
                    borderRadius: 3,
                    pointerEvents: 'none', zIndex: 8,
                  }} />
                  {/* AUD track highlight */}
                  {liveTracks.aud && (
                    <div style={{
                      position: 'absolute',
                      left: `${(xLeft / bar.width) * 100}%`,
                      width: `${(xW / bar.width) * 100}%`,
                      top: _audTop, height: _audH,
                      background: `color-mix(in srgb, var(--accent, ${accent}) 28%, transparent)`,
                      borderRadius: 2,
                      pointerEvents: 'none', zIndex: 7,
                    }} />
                  )}
                  {/* YOU track highlight */}
                  {liveTracks.you && (
                    <div style={{
                      position: 'absolute',
                      left: `${(xLeft / bar.width) * 100}%`,
                      width: `${(xW / bar.width) * 100}%`,
                      top: _youTop, height: _youH,
                      background: `color-mix(in srgb, var(--accent, ${accent}) 28%, transparent)`,
                      borderRadius: 2,
                      pointerEvents: 'none', zIndex: 7,
                    }} />
                  )}
                </>
              )}
            </>
          );
        })()}

        {/* ─── Ф1: Committed track selection overlay ─── */}
        {selection && (() => {
          // M2: geometry from trackBands (single SoT).
          const { audTop: _audTop, audH: _audH, youTop: _youTop, youH: _youH } = trackBands;
          // Time → horizontal position. I2: clamp both edges independently
          // (same pattern as shadow exercise blocks) so a selection that
          // scrolls partly off-view never produces a negative left or overflows.
          const selLeftRaw  = timeToPct(selection.t1);
          const selRightRaw = timeToPct(selection.t2);
          // WEB-SEAM: shared clamp — регион не рисуется за краем бара (fb#6, финал-ревью).
          const selClamped = clampRegionPct(selLeftRaw, selRightRaw);
          if (!selClamped) return null;
          const { left: selLeft, width: selW } = selClamped;
          // Vertical span: from top of first covered track to bottom of last.
          const trackTop  = selection.tracks.aud ? _audTop : _youTop;
          const trackBot  = selection.tracks.you ? _youTop + _youH : _audTop + _audH;
          const trackH    = Math.max(0, trackBot - trackTop);
          return (
            <div style={{
              position: 'absolute',
              left: `${selLeft}%`,
              width: `${selW}%`,
              top: trackTop,
              height: trackH,
              background: `color-mix(in srgb, var(--accent, ${accent}) 12%, transparent)`,
              border: `1px solid var(--accent, ${accent})`,
              borderRadius: 3,
              pointerEvents: 'none', zIndex: 6,
            }} />
          );
        })()}

        {/* ─── Ф3: Mute regions ─── */}
        {(muteRegions ?? []).map((mr) => {
          const { audTop, audH, youTop, youH } = trackBands;
          const lRaw = timeToPct(mr.t1);
          const rRaw = timeToPct(mr.t2);
          // WEB-SEAM: shared clamp — регион не рисуется за краем бара (fb#6, финал-ревью).
          const clamped = clampRegionPct(lRaw, rRaw);
          if (!clamped) return null;
          const { left, width } = clamped;
          const top = mr.tracks.aud ? audTop : youTop;
          const bot = mr.tracks.you ? youTop + youH : audTop + audH;
          const height = Math.max(0, bot - top);
          const selected = mr.id === selectedMuteRegionId;
          return (
            <div
              key={`mute-${mr.id}`}
              data-testid="mute-region"
              data-region-id={mr.id}
              data-no-gesture
              title={mr.muted ? 'Mute region — click to lift, Del to delete'
                              : 'Inert region — click to mute, Del to delete'}
              onClick={(e) => {
                e.stopPropagation();
                onToggleMuteRegion?.(mr.id);
                setSelectedMuteRegionId(mr.id);
              }}
              onContextMenu={(e) => {
                // WEB-SEAM: desktop mute regions have no right-click menu. Web adds a
                // custom RegionMenu (owner 3:53-4:19) — NOT window.confirm. Suppress the
                // native menu + bar-level gesture, then open the popup at the cursor.
                e.preventDefault();
                e.stopPropagation();
                setSelectedMuteRegionId(mr.id);
                setRegionMenu({ id: mr.id, x: e.clientX, y: e.clientY, muted: mr.muted });
              }}
              style={{
                position: 'absolute',
                left: `${left}%`, width: `${width}%`,
                top, height,
                background: mr.muted
                  ? // WEB-SEAM: hatched muted region (owner 11:13-11:49 «чёрное неестественно»).
                    // 45° repeating-linear-gradient on Dusk tokens over a softened tone,
                    // instead of the desktop's solid near-black.
                    `repeating-linear-gradient(45deg,
                       color-mix(in srgb, var(--fg-mute, #7A6248) 34%, transparent) 0 6px,
                       transparent 6px 12px),
                     color-mix(in srgb, #000 42%, transparent)`
                  : `color-mix(in srgb, var(--accent, ${accent}) 12%, transparent)`,
                border: selected
                  ? `1px solid var(--accent, ${accent})`
                  : `1px solid ${mr.muted ? 'rgba(0,0,0,0.55)' : `color-mix(in srgb, var(--accent, ${accent}) 45%, transparent)`}`,
                borderRadius: 3,
                cursor: 'pointer',
                pointerEvents: 'auto',
                zIndex: 7,
              }}
            />
          );
        })}

        {/* T5 — ФАКТЧЕК C1: the panel root has backdropFilter:blur(10px) (dusk.ts:247),
            which creates a containing block for position:fixed descendants — a
            non-portal RegionMenu would anchor to the panel, not the viewport.
            Render through a portal instead (precedent: TrackCombo.tsx:191). */}
        {createPortal(
          <RegionMenu
            state={regionMenu}
            onToggle={onToggleMuteRegion ?? (() => {})}
            onDelete={onDeleteMuteRegion ?? (() => {})}
            onClose={handleRegionMenuClose}
          />,
          // fullscreen: document.body is outside the fullscreen subtree, so a portal
          // straight to body is invisible while fullscreen is active. Target the
          // fullscreen element when present (falls back to body outside fullscreen —
          // jsdom's fullscreenElement is always null, so existing tests are unaffected).
          document.fullscreenElement ?? document.body,
        )}

        {/* ─── P3a tracks (AUD + optional YOU + left-gutter labels) ─── */}
        {(() => {
          // M2: geometry from trackBands (single SoT — no longer hand-copied).
          const { audTop, audH, youTop, youH } = trackBands;
          const sub1Top = th.bar.height / 2 - 11;    // mid of original bar = SUB label anchor
          // Track separators (thin horizontal lines between tracks)
          const sepColor = 'var(--border, rgba(255,255,255,0.10))';
          return (
            <>
              {/* Track separators (visual cue between SUB / AUD / YOU) */}
              <div style={{
                position: 'absolute', left: 0, right: 0, top: th.bar.height + 2,
                height: 1, background: sepColor, pointerEvents: 'none', zIndex: 1,
              }} />
              {youTrackVisible && (
                <div style={{
                  position: 'absolute', left: 0, right: 0, top: audTop + audH + 2,
                  height: 1, background: sepColor, pointerEvents: 'none', zIndex: 1,
                }} />
              )}

              {/* ── Track 2 · AUD (audio waveform + EN pill, locked to EN) ── */}
              <div
                title="Original audio (EN — locked for now)"
                style={{
                  position: 'absolute', left: 0, right: 0, top: audTop, height: audH,
                  border: `1px solid ${sepColor}`, borderRadius: 3,
                  background: 'color-mix(in srgb, var(--fg) 4%, transparent)',
                  overflow: 'hidden', pointerEvents: 'none', zIndex: 1,
                }}
              >
                {/* П2 — auto-detected speech groups, highlighted fade-to-fade.
                    Full-bleed (inset:0): same coordinate basis as the playhead /
                    cues / YOU track, so the bands line up with the waveform AND the
                    playhead. The track label lives in the -38px outer gutter, so
                    nothing occupies lane x=0. */}
                <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                  {speechSegments.map((seg, i) => {
                    const l = timeToPct(seg.startSec);
                    const r = timeToPct(seg.endSec);
                    if (r <= 0 || l >= 100) return null;
                    const left = Math.max(0, l);
                    const width = Math.min(100, r) - left;
                    if (width <= 0) return null;
                    return (
                      <div key={i} style={{
                        position: 'absolute', top: 0, bottom: 0,
                        left: `${left}%`, width: `${width}%`,
                        background: 'color-mix(in srgb, var(--accent, #E0B341) 16%, transparent)',
                        pointerEvents: 'none',
                      }} />
                    );
                  })}
                </div>
                {/* П2 — real audio waveform: mirrored fill, zoom-aware. */}
                {/* Full-bleed: same coordinate basis as the playhead (t=viewStart→
                    left edge, t=viewEnd→right edge). See waveform-alignment.test.ts. */}
                <div style={{ position: 'absolute', inset: 0 }}>
                  <WaveformCanvas
                    peaks={waveform?.peaks ?? []}
                    windowMs={waveform?.windowMs ?? 50}
                    viewStart={viewStart}
                    viewEnd={viewEnd}
                    mode={waveformMode}
                  />
                </div>
                {/* Фаза II (2026-05-27) — AUD-track combo per segment group.
                    Bug 13's A-B overlay is gone. Combo is rendered ONCE
                    per cluster of overlapping aud_segments, anchored to
                    that cluster's [start..end] range. Users without any
                    dubs see the original AUD track untouched. */}
                {audSegments && audSegments.length > 0 && onSelectAudSegment && (() => {
                  const groups = groupOverlappingSegments(audSegments);
                  return groups.map((g, _gi) => { // WEB-SEAM: index unread (deterministic key below uses sorted segment IDs instead); underscore silences noUnusedParameters
                    // WEB-SEAM: fb#6 — AUD-combo зажат в видимую рамку [0,100] (был -5..105 →
                    // combo-триггер вылезал за край плеера, pointerEvents:'auto' → кликабельно).
                    const lo = Math.max(0, Math.min(100, timeToPct(g.start)));
                    const hi = Math.max(0, Math.min(100, timeToPct(g.end)));
                    const w = Math.max(0, hi - lo);
                    if (w <= 0.5) return null;
                    const langs = Array.from(new Set(g.segments.map(s => (s.lang || '').toLowerCase())));
                    const selected = g.segments.find(s => s.id === selectedAudSegmentId);
                    // Deterministic key — sorted segment IDs. Stable across
                    // promotes / time shifts (a new segment added to the
                    // group changes the key — necessary so React rebuilds
                    // options, but won't gratuitously re-mount on
                    // re-sort/regroup of other groups).
                    const groupKey = g.segments.map(s => s.id).sort().join('-');
                    return (
                      <div key={`audseg-grp-${groupKey}`} style={{
                        position: 'absolute', left: `${lo}%`, width: `${w}%`,
                        top: 2, bottom: 2,
                        zIndex: 4,
                        pointerEvents: 'auto',
                      }}>
                        <TrackCombo
                          ariaLabel="Аудио-дорожка"
                          title={`Сегмент ${g.start.toFixed(1)}s–${g.end.toFixed(1)}s · языки: ${langs.join(', ').toUpperCase()}`}
                          selectedId={selected ? selected.id : '__original__'}
                          options={[
                            { id: '__original__', label: 'Original', sub: 'оригинальная дорожка' },
                            ...g.segments.map((s): TrackComboOption => ({
                              id: s.id,
                              label: `Dub · ${(s.lang || '??').toUpperCase()}`,
                              sub: `${s.start_sec.toFixed(1)}s – ${s.end_sec.toFixed(1)}s`,
                              deletable: true,
                            })),
                          ]}
                          onSelect={(id) => {
                            onSelectAudSegment(id === '__original__' ? null : id);
                          }}
                          onDelete={onDeleteAudSegment}
                          triggerLabel={(() => {
                            // Bug 15 (2026-05-27): trigger is now a transparent
                            // overlay — only the ▾ arrow stays visible so the
                            // waveform underneath is fully readable. Label
                            // sits right-justified next to the arrow.
                            const text = selected
                              ? `Dub · ${(selected.lang || '??').toUpperCase()}`
                              : 'Original';
                            return `${text}  ▾`;
                          })()}
                          triggerStyle={{
                            width: '100%', height: '100%',
                            padding: '0 6px',
                            background: 'transparent',
                            border: 'none',
                            borderRadius: 0,
                            color: 'var(--fg, #f3e2c6)',
                            fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
                            fontFamily: 'var(--mono-font, "IBM Plex Mono", ui-monospace, monospace)',
                            cursor: 'pointer',
                            display: 'inline-flex', alignItems: 'center',
                            justifyContent: 'flex-end',
                            gap: 4,
                            textShadow: '0 0 4px rgba(0,0,0,0.95), 0 1px 2px rgba(0,0,0,0.85)',
                            opacity: 0.9,
                          }}
                        />
                      </div>
                    );
                  });
                })()}
              </div>

              {wavePill && (
                <div
                  data-testid="waveform-mode-pill"
                  style={{
                    position: 'absolute', top: audTop - 2, right: 4,
                    padding: '1px 6px', borderRadius: 999,
                    fontSize: 9, fontWeight: 700, lineHeight: '14px',
                    background: 'var(--accent, #E0B341)',
                    color: 'var(--accent-fg, #1A0A0C)',
                    pointerEvents: 'none', zIndex: 6, whiteSpace: 'nowrap',
                  }}
                >
                  {waveformModeLabel(wavePill)}
                </div>
              )}

              {/* Bug 15 (2026-05-27) — Bug 13's YOU-track A-B combo
                  removed. It used to render full-width on [rangeStart..
                  rangeEnd] at zIndex 4, which physically covered the
                  per-cluster dub combos rendered below and stole all
                  pointer events. The cluster combo (each dub recording
                  at its own span) is the only correct UI now. */}

              {/* ── Track 3 · YOU — user voice responses ────────────────
                  Now hosts the brown match%-tinted ribbons that used to
                  overlay subtitles on Track 1. Each ribbon spans the time
                  range of the cue the response was attempted on (true
                  audio-window timing arrives with saveAudio in P3+).
                  Empty state shows the dashed placeholder + REC hint. */}
              {youTrackVisible && (
                <>
                  {/* Container — hairline frame so the track has shape
                      even when only a couple ribbons populate it. */}
                  <div
                    style={{
                      position: 'absolute', left: 0, right: 0, top: youTop, height: youH,
                      border: `1px solid var(--border, rgba(255,255,255,0.10))`,
                      borderRadius: 3,
                      background: 'color-mix(in srgb, var(--fg) 3%, transparent)',
                      pointerEvents: 'none', zIndex: 1,
                    }}
                  />
                  {/* YOU track — exactly one VOICE recording: the latest, or the
                      one the user picked by clicking a SHADOW answer card
                      (youTrackRecordingId). DUB recordings rendered separately
                      below (Bug 15) so every dub gets its own combo overlay
                      simultaneously. Manual recordings excluded. */}
                  {(() => {
                    const youRec = pickYouTrackRecording(recordings ?? [], youTrackRecordingId);
                    if (!youRec || youRec.kind === 'dub' || !youRec.peaks || youRec.peaks.length === 0) return null;
                    const rect = recordingRect(recordingSpan(youRec), { viewStart, viewEnd }, offset);
                    if (!rect) return null;
                    const windowMs = youRec.duration_sec > 0 && youRec.peaks.length > 0
                      ? (youRec.duration_sec * 1000) / youRec.peaks.length
                      : 50;
                    // Bug 15 (2026-05-27): this block is reached only for
                    // VOICE recordings — dub kind is skipped at the entry
                    // guard above and rendered by the simultaneous-dub
                    // cluster block below. No context-menu / dub branch
                    // needed here anymore.
                    return (
                      <div
                        key={`rec-wave-${youRec.id}`}
                        data-testid={`rec-wave-${youRec.id}`}
                        data-rec-id={youRec.id}
                        data-rec-kind={youRec.kind}
                        style={{
                          position: 'absolute',
                          top: youTop + (youH - (audH - 2)) / 2, height: audH - 2,
                          left: `${rect.left}%`,
                          width: `${rect.width}%`,
                          zIndex: 3,
                          pointerEvents: 'none',
                        }}
                      >
                        <WaveformCanvas
                          peaks={youRec.peaks}
                          windowMs={windowMs}
                          viewStart={0}
                          viewEnd={youRec.duration_sec}
                          color="var(--accent, #E0B341)"
                          mode={waveformMode}
                        />
                      </div>
                    );
                  })()}
                  {/* Bug 15 (2026-05-27) — all DUB recordings render
                      simultaneously. Overlapping recordings (e.g. RU+ES
                      on same cue) are clustered: ONE combo per cluster
                      with options for every language. Resolves the audit
                      HIGH-c: without clustering two combos at same
                      left/width would stack at zIndex 4 → the bottom
                      one becomes invisible and unclickable. */}
                  {(() => {
                    // Bug 15 follow-up (2026-05-27): hide dubs that are
                    // ALREADY promoted into the AUD timeline. After promote
                    // the dub lives on AUD; keeping it on YOU as well would
                    // confuse the user with two identical greens stacked
                    // on different tracks. Re-promote after delete remains
                    // possible because the blob stays in the recordings store.
                    const promotedRecIds = new Set((audSegments ?? []).map(s => s.source_recording_id).filter(Boolean));
                    const dubRecs = (recordings ?? []).filter(r =>
                      r.kind === 'dub' &&
                      r.peaks && r.peaks.length > 0 &&
                      !promotedRecIds.has(r.id)
                    );
                    if (!dubRecs.length) return null;
                    const dubGroups = groupOverlappingByRange(
                      dubRecs,
                      r => r.audio_start_sec,
                      r => r.audio_end_sec,
                    );
                    return dubGroups.map(grp => {
                      // Cluster's own viewport rect (min start, max end).
                      // Note: recordingRect reads snake_case fields directly
                      // off the entry (audio_start_sec, audio_end_sec) —
                      // not the camelCase used elsewhere in the codebase.
                      const rect = recordingRect(
                        { audio_start_sec: grp.start, audio_end_sec: grp.end } as RecordingEntry,
                        { viewStart, viewEnd }, offset,
                      );
                      if (!rect) return null;
                      const clusterKey = grp.items.map(r => r.id).sort().join('-');
                      // Trigger label: list of unique uppercase langs.
                      const langs = Array.from(new Set(grp.items.map(r => (r.lang || '??').toUpperCase())));
                      const labelLangs = langs.length <= 3 ? langs.join('+') : `${langs.length} LANGS`;
                      // User-facing model (2026-05-30): combo на YOU
                      // = выбор какой дубляж сейчас играет на этой
                      // дорожке. Опции — это сами дубляжи кластера
                      // («Дубляж 1 · RU», «Дубляж 2 · EN», ...). Действия
                      // «Перенести в AUD» / «Удалить» — inline-иконки на
                      // каждой строке, чтобы не дублировать опции по
                      // три на каждый dub.
                      // Сортировка стабильна по audio_start_sec, чтобы
                      // номера «1/2/3» не прыгали при ре-фетче.
                      const sortedRecs = [...grp.items].sort((a, b) =>
                        a.audio_start_sec - b.audio_start_sec ||
                        (a.created_at || '').localeCompare(b.created_at || '')
                      );
                      const options: TrackComboOption[] = sortedRecs.map((rec, i) => {
                        const lang = (rec.lang || '??').toUpperCase();
                        const range = `${rec.audio_start_sec.toFixed(1)}-${rec.audio_end_sec.toFixed(1)}s`;
                        return {
                          id: rec.id,
                          label: `Дубляж ${i + 1} · ${lang}`,
                          sub: range,
                          promotable: true,
                          deletable: true,
                        };
                      });
                      return (
                        <React.Fragment key={`dub-cluster-${clusterKey}`}>
                          {/* Waveforms for every dub in the cluster — stacked
                              with subtle vertical offset so user can tell
                              there's more than one if they overlap on the
                              same range. Topmost has full opacity. */}
                          {grp.items.map((rec, i) => {
                            const windowMs = rec.duration_sec > 0 && rec.peaks.length > 0
                              ? (rec.duration_sec * 1000) / rec.peaks.length
                              : 50;
                            const recRect = recordingRect(recordingSpan(rec), { viewStart, viewEnd }, offset);
                            if (!recRect) return null;
                            return (
                              <div
                                key={`wf-${rec.id}`}
                                data-rec-id={rec.id}
                                data-rec-kind="dub"
                                style={{
                                  position: 'absolute',
                                  top: youTop + 2 + (i * 1.5),
                                  height: Math.max(8, youH - 4 - (i * 1.5)),
                                  left: `${recRect.left}%`, width: `${recRect.width}%`,
                                  zIndex: 3,
                                  pointerEvents: 'none',
                                  opacity: i === 0 ? 1 : 0.65,
                                }}
                              >
                                <WaveformCanvas
                                  peaks={rec.peaks}
                                  windowMs={windowMs}
                                  viewStart={0}
                                  viewEnd={rec.duration_sec}
                                  color="var(--success, #6ABE6A)"
                                  mode={waveformMode}
                                />
                              </div>
                            );
                          })}
                          {/* Single combo on the cluster's outer bounds.
                              onContextMenu = быстрое promote первого dub'а
                              в кластере без открытия меню (для one-language
                              кластера это очевидное действие, для
                              multi-language — promote первого, остальные
                              из dropdown). Восстанавливает старый paтерн
                              из Bug 2 Phase B. */}
                          <div
                            onContextMenu={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              if (onApplyDubOverlay && grp.items[0]) {
                                onApplyDubOverlay(grp.items[0]);
                              }
                            }}
                            title="Левый клик: меню. Правый клик: быстро перенести в AUD."
                            style={{
                              position: 'absolute',
                              top: youTop + 2, height: youH - 4,
                              left: `${rect.left}%`, width: `${rect.width}%`,
                              zIndex: 4,
                              pointerEvents: 'auto',
                            }}
                          >
                            <TrackCombo
                              ariaLabel="Опции дубляжа"
                              title={`${langs.join(', ')} • ${grp.start.toFixed(1)}-${grp.end.toFixed(1)}s • клик: меню`}
                              selectedId={youTrackRecordingId}
                              options={options}
                              onSelect={(id) => {
                                // Selection = which dub to play on YOU.
                                if (onSelectYouRecording) onSelectYouRecording(id);
                              }}
                              onPromote={(id) => {
                                const rec = grp.items.find(r => r.id === id);
                                if (rec && onApplyDubOverlay) onApplyDubOverlay(rec);
                              }}
                              onDelete={(id) => {
                                const rec = grp.items.find(r => r.id === id);
                                if (rec && onDeleteYouRecording) onDeleteYouRecording(rec.id, rec.filename);
                              }}
                              triggerLabel={(() => {
                                // If user selected a dub in this cluster,
                                // reflect it in the trigger label. Otherwise
                                // fall back to language list.
                                const selectedIdx = sortedRecs.findIndex(r => r.id === youTrackRecordingId);
                                if (selectedIdx >= 0) {
                                  const r = sortedRecs[selectedIdx];
                                  return `Дубляж ${selectedIdx + 1} · ${(r.lang || '??').toUpperCase()}  ▾`;
                                }
                                return `${labelLangs}  ▾`;
                              })()}
                              triggerStyle={{
                                width: '100%', height: '100%',
                                padding: '0 6px',
                                background: 'transparent',
                                border: 'none',
                                color: 'var(--fg, #f3e2c6)',
                                fontSize: 9.5, fontWeight: 700, letterSpacing: 0.4,
                                fontFamily: 'var(--mono-font, "IBM Plex Mono", ui-monospace, monospace)',
                                cursor: 'pointer',
                                display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end',
                                gap: 4,
                                textShadow: '0 0 4px rgba(0,0,0,0.95), 0 1px 2px rgba(0,0,0,0.85)',
                                opacity: 0.9,
                              }}
                            />
                          </div>
                        </React.Fragment>
                      );
                    });
                  })()}
                  {/* Empty state — only when force-shown without any
                      recorded attempts yet. Hidden once data appears. */}
                  {!pickYouTrackRecording(recordings ?? [], youTrackRecordingId) && (
                    <div
                      style={{
                        position: 'absolute', left: 0, right: 0, top: youTop, height: youH,
                        background: 'repeating-linear-gradient(135deg, transparent 0 6px, color-mix(in srgb, var(--fg) 4%, transparent) 6px 7px)',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '0 8px',
                        fontFamily: 'var(--mono-font, "IBM Plex Mono", ui-monospace, monospace)',
                        fontSize: 9, color: 'var(--fg-dim, #8a7855)', letterSpacing: .5,
                        textTransform: 'uppercase', fontWeight: 600,
                        pointerEvents: 'none', zIndex: 1,
                      }}
                    >
                      <span>Tap ⏺ to record your voice over the current cue</span>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        color: 'var(--fg, #f3e2c6)', padding: '2px 8px', borderRadius: 99,
                        border: `1px solid var(--border-strong, rgba(255,255,255,0.18))`,
                        background: 'var(--btn-bg, rgba(0,0,0,0.30))',
                      }}>
                        <span style={{
                          width: 6, height: 6, borderRadius: 99,
                          background: '#D94545', boxShadow: '0 0 4px #D94545',
                        }} />
                        REC
                      </span>
                    </div>
                  )}
                </>
              )}

              {/* ── Left-gutter track-number labels (SUB/AUD/YOU + вкл/выкл дорожек) ── */}
              {/* ТЗ №8 п.1 [ID:P-tz8]: гуттер ВСЕГДА в левом внешнем band (-38). ТЗ №6
                  п.4 двигал его на left:0 при dock-left, НЕ расширяя резерв — но тогда
                  гуттер (content-left) и первые кью (тот же content-left) рисовались
                  друг на друге (live-факт оркестратора: гуттер[936,972], кью с x=938).
                  Теперь dock-left резерв = dw + 38 (см. dockReserve выше), поэтому band
                  -38 попадает РОВНО в полосу [card_right, card_right+36] — сразу за
                  картой, ПЕРЕД кью. Карта [barLeft, barLeft+dw], гуттер [barLeft+dw,
                  +36], кью с barLeft+dw+38. Ничего не перекрыто; транспорт сдвинут
                  тем же резервом (владелец ТЗ №8 п.4: «[карта][гуттер][лента от нуля]»). */}
              <div data-testid="track-label-gutter" style={{
                position: 'absolute', left: -38, top: 0, bottom: 0, width: 36,
                pointerEvents: 'none', zIndex: 5,
                fontFamily: 'var(--mono-font, "IBM Plex Mono", ui-monospace, monospace)',
                fontSize: 8.5, fontWeight: 700, letterSpacing: 1,
                color: 'var(--fg-dim, #8a7855)', textTransform: 'uppercase',
              }}>
                <TrackLabel n={1} top={sub1Top} label="SUB" accent />
                <TrackLabel
                  n={2}
                  top={audTop + audH / 2 - 7}
                  label="AUD"
                  audioState={muted ? 'off' : 'on'}
                  onClick={onToggleMute}
                  onContextMenu={handleCycleWaveform}
                  title={(muted
                    ? 'Звук видео выключен — клик: включить'
                    : 'Звук видео включён — клик: выключить')
                    + ' · ' + t('player.waveformHint', { mode: waveformModeLabel(waveformMode) })}
                  testid="aud-track-toggle"
                />
                {youTrackVisible && (
                  <TrackLabel
                    n={3}
                    top={youTop + youH / 2 - 7}
                    label="YOU"
                    audioState={youAudible ? 'on' : 'off'}
                    onClick={() => setYouAudible(!youAudible)}
                    title={youAudible
                      ? 'Запись слышна при воспроизведении — клик: выключить'
                      : 'Запись не слышна — клик: включить'}
                    testid="you-track-toggle"
                  />
                )}
              </div>

              {/* YOU-track force-toggle — visible only when the track itself
                  is rendered (has content) OR the user has force-shown it.
                  Without this guard the «○ YOU» pill leaked to the top-right
                  edge of the workspace bar even when there were no shadow
                  attempts to show, which read as a stray marker that did
                  not belong to any visible row. Now it lives only with its
                  own track; users still get back the dormant track via the
                  ShadowChat / drawer toggles. */}
              {youTrackVisible && (
                <button
                  onClick={(e) => { e.stopPropagation(); setYouTrackForceShown(!youTrackVisible); }}
                  title={youTrackVisible ? 'Hide YOU track' : 'Show YOU track'}
                  style={{
                    position: 'absolute', right: 2, top: -22, height: 18, padding: '0 6px',
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    background: 'var(--btn-bg, rgba(0,0,0,0.30))',
                    border: `1px solid ${sepColor}`,
                    borderRadius: 3,
                    color: 'var(--accent, #E0B341)',
                    fontFamily: 'var(--mono-font, "IBM Plex Mono", ui-monospace, monospace)',
                    fontSize: 8.5, fontWeight: 700, letterSpacing: .5,
                    cursor: 'pointer', zIndex: 6,
                  }}
                >
                  ◉ YOU
                </button>
              )}
            </>
          );
        })()}

        {/* Playhead */}
        {th.playhead.shape === 'circle' ? (
          <>
            <div style={{
              position: 'absolute', top: 0, bottom: 0,
              left: 'var(--php, 0%)',
              width: th.playhead.width,
              transform: `translateX(-${th.playhead.width / 2}px)`,
              background: th.playhead.color,
              boxShadow: th.playhead.glow,
              zIndex: 4, pointerEvents: 'none',
            }} />
            <div
              data-handle="pos"
              onPointerDown={handlePointerDown('pos')}
              style={{
                position: 'absolute', top: '50%',
                transform: 'translate(-50%, -50%)',
                left: 'var(--php, 0%)',
                width: 48, height: 48,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: dragTarget === 'pos' ? 'grabbing' : 'grab',
                zIndex: 5,
              }}
            >
              <div style={{
                width: th.playhead.handleSize, height: th.playhead.handleSize,
                background: th.playhead.color,
                border: th.playhead.handleBorder,
                borderRadius: '50%',
                boxShadow: th.playhead.glow,
                pointerEvents: 'none',
              }} />
            </div>
          </>
        ) : (
          <>
            {th.playhead.shape === 'needle' && (
              <>
                {/* Designer Dusk playhead (Player Handoff layout-v2:592):
                    a thin vertical line that extends ABOVE the highlight
                    frame (-22px), a 11×11 diamond pinned just above the
                    frame, and a small amber time-tag floating over them.
                    All three sit outside the tracks container so they read
                    as "current position above the bookplate". */}
                <div style={{
                  position: 'absolute', top: -22,
                  left: 'var(--php, 0%)',
                  // Rotation pivot needs to stay over the playhead line —
                  // shift left by half the *unrotated* width before rotating.
                  transform: 'translateX(-50%) rotate(45deg)',
                  width: 11, height: 11,
                  background: th.playhead.color,
                  boxShadow: `0 0 0 2px var(--surface, ${th.panel.background})`,
                  zIndex: 6, pointerEvents: 'none',
                }} />
                <div style={{
                  position: 'absolute',
                  // Raised to clear the rotated diamond's top corner
                  // (~y=-24 due to 45° rotation of the 11×11 square).
                  top: -44,
                  left: 'var(--php, 0%)',
                  transform: 'translateX(-50%)',
                  background: th.playhead.color,
                  color: 'var(--accent-fg, #fff)',
                  fontSize: 9.5, fontWeight: 700,
                  fontVariantNumeric: 'tabular-nums',
                  padding: '1px 6px', borderRadius: 3,
                  whiteSpace: 'nowrap',
                  zIndex: 6, pointerEvents: 'none',
                }}>
                  {formatPlayheadTime(currentTime)}
                </div>
              </>
            )}
            {th.playhead.shape === 'crosshair' && (
              <>
                {/* Running-man circle — centred on the frame's visual midline */}
                <div style={{
                  position: 'absolute',
                  top: `calc(${frameInsetTop}px + (100% - ${frameInsetTop + frameInsetBottom}px) / 2)`,
                  left: 'var(--php, 0%)',
                  transform: 'translate(-50%, -50%)',
                  width: 22, height: 22, borderRadius: '50%',
                  background: th.panel.background,
                  border: `${Math.max(1, th.playhead.width)}px solid ${th.playhead.color}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  zIndex: 6, pointerEvents: 'none',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
                }}>
                  {th.playhead.runningMan
                    ? <RunningMan running={playing} color={th.playhead.color} size={14} />
                    : <span style={{
                        display: 'block', width: 6, height: 6, borderRadius: '50%',
                        background: th.playhead.color,
                      }} />
                  }
                </div>
              </>
            )}
            {th.playhead.shape === 'ribbon' && !th.playheadCaps && (
              <>
                {/* Small flag tab at the top of the ribbon (legacy, when no
                    outerFrame/caps are configured). */}
                <div style={{
                  position: 'absolute', top: -8,
                  left: 'var(--php, 0%)',
                  transform: 'translateX(-50%)',
                  width: th.playhead.width + 10, height: 12,
                  background: th.playhead.color,
                  clipPath: 'polygon(0 0, 100% 0, 100% 70%, 50% 100%, 0 70%)',
                  filter: th.playhead.glow ? `drop-shadow(${th.playhead.glow})` : undefined,
                  zIndex: 6, pointerEvents: 'none',
                }} />
              </>
            )}
            <div style={{
              position: 'absolute',
              // Dusk's needle playhead extends above the tracks container so
              // it visually pierces the highlight frame's top edge — the
              // diamond and time-tag sit on this elevated stem.
              top: th.playhead.shape === 'needle' ? -16 : 0,
              bottom: 0,
              left: 'var(--php, 0%)',
              width: th.playhead.width,
              transform: `translateX(-${th.playhead.width / 2}px)`,
              background: th.playhead.color,
              boxShadow: th.playhead.glow,
              zIndex: 4, pointerEvents: 'none',
            }} />
            <div
              data-handle="pos"
              onPointerDown={handlePointerDown('pos')}
              style={{
                position: 'absolute', top: 0, bottom: 0,
                left: 'var(--php, 0%)',
                transform: 'translateX(-50%)',
                width: 14,
                cursor: dragTarget === 'pos' ? 'grabbing' : 'grab',
                zIndex: 5,
              }}
            />
          </>
        )}

        {/* Left/right handles. Dusk's handleAlign='top' drops them onto the
            top edge of the highlight frame — half above, half below — so
            they read as "wax seals" pinning the bookplate. Other variants
            keep the legacy vertical centering. */}
        {(() => {
          const handleAlignTop = th.bar.handleAlign === 'top';
          const handleSize = Math.max(th.handles.width, th.handles.height);
          // Place the handle's vertical centre exactly on the highlight's
          // top edge (which sits at `frameInsetTop + highlightInset` of the
          // tracks container).
          const handleTop = handleAlignTop
            ? (frameInsetTop + highlightInset - handleSize / 2)
            : 0;
          const wrapperVertical: React.CSSProperties = handleAlignTop
            ? { top: handleTop, height: handleSize }
            : { top: 0, bottom: 0 };
          return (
            <>
              {/* WEB-SEAM: cull палки вне вью (пред-зажатый pct делал гейт мёртвым; десктоп имеет тот же баг — upstream позже) */}
              {/* exempt: перетаскиваемая палка не culls — иначе «растворяется в руке» (финал-ревью M-1) */}
              {th.handles.shape !== 'hidden' && (dragTarget === 'left' || (startPctRaw >= 0 && startPctRaw <= 100)) && (
                <div
                  data-handle="left"
                  onPointerDown={handlePointerDown('left')}
                  style={{
                    position: 'absolute',
                    ...wrapperVertical,
                    transform: 'translateX(-50%)',
                    left: `${startPct}%`,
                    width: Math.max(24, th.handles.width + 18),
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: dragTarget === 'left' ? 'grabbing' : 'grab',
                    zIndex: 4,
                  }}
                >
                  {renderHandle(th, 'left', dragTarget === 'left')}
                </div>
              )}
              {/* WEB-SEAM: cull палки вне вью (пред-зажатый pct делал гейт мёртвым; десктоп имеет тот же баг — upstream позже) */}
              {/* exempt: перетаскиваемая палка не culls — иначе «растворяется в руке» (финал-ревью M-1) */}
              {th.handles.shape !== 'hidden' && (dragTarget === 'right' || (endPctRaw >= 0 && endPctRaw <= 100)) && (
                <div
                  data-handle="right"
                  onPointerDown={handlePointerDown('right')}
                  style={{
                    position: 'absolute',
                    ...wrapperVertical,
                    transform: 'translateX(-50%)',
                    left: `${endPct}%`,
                    width: Math.max(24, th.handles.width + 18),
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: dragTarget === 'right' ? 'grabbing' : 'grab',
                    zIndex: 4,
                  }}
                >
                  {renderHandle(th, 'right', dragTarget === 'right')}
                </div>
              )}
              {/* WEB-SEAM: cull палки вне вью (пред-зажатый pct делал гейт мёртвым; десктоп имеет тот же баг — upstream позже) */}
              {/* exempt: перетаскиваемая палка не culls — иначе «растворяется в руке» (финал-ревью M-1) */}
              {th.handles.shape !== 'hidden' && (dragTarget === 'right' || (endPctRaw >= 0 && endPctRaw <= 100)) && onSetPauseAtEnd && (
                <div
                  style={(() => {
                    const off = Math.max(24, th.handles.width + 18) / 2 + 4;
                    const base: React.CSSProperties = {
                      position: 'absolute',
                      top: handleTop, height: handleSize,
                      display: 'flex', alignItems: 'center',
                      zIndex: 4,
                    };
                    // Near the right edge, anchor the control's right side so
                    // the edit scale unfurls leftward and never overflows.
                    return endPct > 75
                      ? { ...base, right: `calc(${100 - endPct}% + ${off}px)` }
                      : { ...base, left: `calc(${endPct}% + ${off}px)` };
                  })()}
                >
                  <PauseAtBControl
                    pauseAtEnd={workspace.pauseAtEnd}
                    onChange={onSetPauseAtEnd}
                    accent={th.handles.color}
                    accentFg={th.handles.sealFg ?? th.handles.colorActive}
                  />
                </div>
              )}
            </>
          );
        })()}

        {/* Playhead decorative caps (Blueprint / Atelier) */}
        {th.playheadCaps?.top && th.playheadCaps.top.shape !== 'none' && (() => {
          const cap = th.playheadCaps.top!;
          const w = Math.round(cap.size * 1.2);
          const base: React.CSSProperties = {
            position: 'absolute',
            top: Math.max(0, (th.outerFrame?.insetTop ?? 0) - cap.size - 2),
            left: 'var(--php, 0%)',
            transform: 'translateX(-50%)',
            width: w, height: cap.size,
            zIndex: 7, pointerEvents: 'none',
          };
          if (cap.shape === 'ring') {
            return <div style={{ ...base, width: cap.size, borderRadius: '50%',
              border: `2px solid ${cap.color}`, background: 'transparent' }} />;
          }
          if (cap.shape === 'square') {
            return <div style={{ ...base, width: cap.size, background: cap.color, borderRadius: 1 }} />;
          }
          // 'plaque-top' — rectangle with downward V-notch pointing into the frame.
          return (
            <div style={{
              ...base,
              background: cap.color,
              // Top flat, sides straight, bottom has V cutout centred.
              clipPath: 'polygon(0 0, 100% 0, 100% 100%, 62% 100%, 50% 45%, 38% 100%, 0 100%)',
              filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.25))',
            }} />
          );
        })()}
        {th.playheadCaps?.bottom && th.playheadCaps.bottom.shape !== 'none' && (() => {
          const cap = th.playheadCaps.bottom!;
          const w = Math.round(cap.size * 1.2);
          const base: React.CSSProperties = {
            position: 'absolute',
            bottom: Math.max(0, (th.outerFrame?.insetBottom ?? 0) - cap.size - 2),
            left: 'var(--php, 0%)',
            transform: 'translateX(-50%)',
            width: w, height: cap.size,
            zIndex: 7, pointerEvents: 'none',
          };
          if (cap.shape === 'ring') {
            return <div style={{ ...base, width: cap.size, borderRadius: '50%',
              border: `2px solid ${cap.color}`, background: 'transparent' }} />;
          }
          if (cap.shape === 'square') {
            return <div style={{ ...base, width: cap.size, background: cap.color, borderRadius: 1 }} />;
          }
          // 'plaque-bottom' — mirror: V-notch at top, rectangle body below.
          return (
            <div style={{
              ...base,
              background: cap.color,
              clipPath: 'polygon(0 0, 38% 0, 50% 55%, 62% 0, 100% 0, 100% 100%, 0 100%)',
              filter: 'drop-shadow(0 -1px 1px rgba(0,0,0,0.25))',
            }} />
          );
        })()}

        {/* Drag tooltip */}
        {tooltip && (
          <div style={{
            position: 'absolute', top: -28,
            left: `${tooltip.pct}%`, transform: 'translateX(-50%)',
            padding: '3px 8px', borderRadius: 4,
            background: th.panel.tooltipBg ?? 'rgba(0,0,0,0.85)',
            color: th.panel.tooltipFg ?? accent,
            fontSize: 12, fontWeight: 600, fontFamily: 'monospace',
            fontVariantNumeric: 'tabular-nums',
            pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: 10,
          }}>
            {tooltip.text}
          </div>
        )}
      </div>

      {/* Time row — hidden for Minimal (too tight) and for themes that
          already surface time via the top ruler (Atelier / Blueprint). */}
      {th.bar.height > 30 && !th.timeRuler?.visible && (
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '0 4px', fontVariantNumeric: 'tabular-nums',
        }}>
          <span style={{ fontSize: 12, color: th.panel.timeRowMuted ?? '#aaa', minWidth: 48 }}>
            {formatTime(viewStart)}
          </span>
          <span style={{ fontSize: 14, color: th.panel.timeRowFg ?? '#fff', fontWeight: 600 }}>
            {formatTime(Math.max(rangeStart, Math.min(rangeEnd, currentTime)))}
          </span>
          <span style={{
            fontSize: 11, color: accent,
            background: `${accent}22`,
            padding: '2px 8px', borderRadius: 4,
          }}>
            {(rangeEnd - rangeStart).toFixed(1)}s
          </span>
          <span style={{ fontSize: 12, color: accent, fontWeight: 600, minWidth: 36, textAlign: 'center' }}>
            {zoomLevel.toFixed(1)}x
          </span>
          <span style={{ fontSize: 12, color: th.panel.timeRowMuted ?? '#aaa', minWidth: 48, textAlign: 'right' }}>
            {formatTime(viewEnd)}
          </span>
        </div>
      )}

      {/* Controls — Studio handoff layout (v1).
          Transport (prev / -5s / play / +5s / next) · zoom · time/cue ·
          mode pills (Shadowing / Dictation / Puzzles) · Exit.
          A-B button removed: loop is now driven by the timeline pin
          handles + the right-drawer "Region active" toggle. */}
      {/* WEB-SEAM (T4): транспорт-ряд ВИДЕН — главный транспорт «как десктоп» (решение
          владельца §1). VideoControlsBar похудел до скраббера/громкости/fullscreen.
          Дубль prev/-5/+5/next против хоткеев — осознанно (десктоп так же). */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        {/* Cue navigation: prev / -5s / play / +5s / next */}
        <button style={navBtnStyle} onClick={onPrevCue} title={t('player.prevCue')} disabled={cueIdx <= 0}>
          <SkipBack size={navIconSize} />
        </button>
        <button style={navBtnStyle} onClick={onRewind5} title={t('player.rewind5') || '−5 с'}>
          <Rewind size={navIconSize} />
        </button>
        <button
          data-tour="player-play"
          data-playing={playing ? 'true' : 'false'}
          style={playBtnStyle}
          onClick={onPlayPause}
          title={playing ? t('player.pause') || 'Пауза' : t('player.play') || 'Воспроизвести'}
        >
          {playing ? <Pause size={playIconSize} /> : <Play size={playIconSize} />}
        </button>
        <button style={navBtnStyle} onClick={onForward5} title={t('player.forward5') || '+5 с'}>
          <FastForward size={navIconSize} />
        </button>
        <button style={navBtnStyle} onClick={onNextCue} title={t('player.nextCue')} disabled={cueIdx < 0 || cueIdx >= cues.length - 1}>
          <SkipForward size={navIconSize} />
        </button>

        {/* Zoom — hidden in the Studio mockups but kept by user request,
            placed after next-cue to stay out of the main transport row. */}
        <button style={btnStyle} onClick={() => onZoom(0.7, (viewStart + viewEnd) / 2)} title="Zoom in">
          <ZoomIn size={12} />
        </button>
        <button style={btnStyle} onClick={() => onZoom(1.4, (viewStart + viewEnd) / 2)} title="Zoom out">
          <ZoomOut size={12} />
        </button>
        <button style={btnStyle} onClick={onFitToRange} title="Fit to range">Fit</button>

        {selection && (
          <>
            <button
              style={btnStyle}
              title="Play selection"
              onClick={() => { if (selection) onPlaySelection?.(selection); }}
            >
              <Play size={12} />
            </button>
            <button
              style={btnStyle}
              title="Mute selection"
              onClick={() => {
                if (!selection) return;
                // cue_index = the cue overlapping the selection midpoint, or -1.
                const mid = (selection.t1 + selection.t2) / 2;
                let cueIdx = -1;
                for (let i = 0; i < cues.length; i++) {
                  const cs = getEffectiveStart(i, cues[i].startTime) + offset;
                  const ce = getEffectiveEnd(i, cues[i].endTime) + offset;
                  if (mid >= cs && mid < ce) { cueIdx = i; break; }
                }
                onCreateMuteRegion?.(selection, cueIdx);
                clearSelection();
              }}
            >
              <VolumeX size={12} />
            </button>
          </>
        )}

        {/* Inline time read-out — themable separator ("/", "of", " — "). */}
        <span style={{
          font: timeFont,
          fontVariantNumeric: 'tabular-nums',
          color: timeFg,
          marginLeft: 4, whiteSpace: 'nowrap',
        }}>
          {formatTime(currentTime)}
          <span style={{ color: timeMutedFg, margin: '0 6px' }}>{timeSeparator}</span>
          <span style={{ color: timeMutedFg }}>{formatTime(duration)}</span>
        </span>

        <div style={{ flex: 1 }} />

        {/* ТЗ №3 п.4 — inline training panel (Shadowing settings row), between
            the transport spacer and the training pills. Present only while
            shadowing is active (the player passes it conditionally); absent
            otherwise, so the bar is byte-identical for a non-shadowing user. */}
        {trainingInlinePanel && (
          <div data-testid="training-inline-panel" style={{ display: 'flex', alignItems: 'center', marginRight: 4 }}>
            {trainingInlinePanel}
          </div>
        )}

        {/* Training pills: Шадоуинг · Диктант · Пазлы.
            Studio handoff: off-state = neutral (--btn-bg/--fg-dim), on-state =
            theme accent (--seg-on/--seg-on-fg). pillBtnStyle resolves both.
            S3-7-fix: the Шадоуинг pill now gates on `onToggleShadow` being
            present, same as onToggleDictation/onStartPuzzle right below — V1
            push-to-record is retired (S3-7) and no production caller wires a
            real toggle here anymore (activation moved to the runtime S-key
            arm), so an unconditionally-rendered pill was a permanently dead
            control (click → zero feedback, zero effect). Hidden entirely
            instead of merely disabled, for the same "absent from the DOM
            when unwired" contract the other two pills already have. */}
        {onToggleShadow && (() => {
          // Э6 (Shadowing-гейт, docs/plan-2026-07-13-design-transfer.md
          // «Архитектурные решения» п.6): фича тратит токены ElevenLabs →
          // доступна не всем. Дефолт ЗАПРЕЩЁН (владелец) — нет
          // flib:access/shadowing!==true → кнопка видна (фича не спрятана),
          // но disabled + подсказка, куда идти за доступом.
          // ГЕЙТИТСЯ ТОЛЬКО СТАРТ: при АКТИВНОЙ сессии кнопка живая всегда —
          // это «Стоп», и отзыв доступа (например «Выйти» в другой вкладке,
          // hasShadowingAccess() читается на каждый рендер) не должен запирать
          // пользователя в идущей записи с открытым микрофоном (аудит Э6,
          // CRIT: гейт stop-пути = DoS собственной сессии).
          const shadowAllowed = hasShadowingAccess();
          const startBlocked = !shadowAllowed && !shadowActive;
          // Подсказка запертой пилюли: без метки кабинета — прежний текст,
          // с меткой — по сессии (shadowLockedTitle).
          const title = startBlocked
            ? shadowLockedTitle()
            : (shadowActive ? 'Стоп Шадоуинг' : 'Старт Шадоуинг');
          return (
            <button
              style={{ ...pillBtnStyle(shadowActive), ...(startBlocked ? { opacity: 0.5, cursor: 'not-allowed' } : null) }}
              onClick={onToggleShadow}
              disabled={startBlocked}
              title={title}
            >
              <Mic size={13} /> {t('player.shadowLabel') || 'Шадоуинг'}{startBlocked && ' 🔒'}
            </button>
          );
        })()}
        {/* [ID:P-subtitle-translate] — пилюля «Перевести» рядом с Shadowing.
            Лейбл плюрализуется, когда выбрано несколько блоков (A-B диапазон).
            disabled = in-flight / Retry-After / нет выборки (title несёт причину). */}
        {onTranslate && (
          <button
            data-testid="translate-pill"
            style={{ ...pillBtnStyle(false), ...(translateDisabled ? { opacity: 0.5, cursor: 'not-allowed' } : null) }}
            onClick={onTranslate}
            disabled={translateDisabled}
            title={translateTitle || (translatePlural ? (t('player.translateLabelPlural') || 'Перевести блоки субтитров') : (t('player.translateLabel') || 'Перевести'))}
          >
            <Languages size={13} /> {translatePlural ? (t('player.translateLabelPlural') || 'Перевести блоки субтитров') : (t('player.translateLabel') || 'Перевести')}
          </button>
        )}
        {onToggleDictation && (
          <button
            data-tour="player-dictation"
            style={pillBtnStyle(dictationActive ?? false)}
            onClick={onToggleDictation}
            title={dictationActive ? 'Стоп Диктант' : 'Старт Диктант'}
          >
            <Headphones size={13} /> {t('player.dictationLabel') || 'Диктант'}
          </button>
        )}
        {onStartPuzzle && (
          <button
            data-tour="player-drill"
            style={pillBtnStyle(false)}
            onClick={onStartPuzzle}
            title={t('player.puzzleHint') || 'Пазлы (тренировка)'}
          >
            <Puzzle size={13} /> {t('player.puzzleLabel') || 'Пазлы'}
          </button>
        )}

        {/* A-B loop pill — when active, current cue repeats; when off,
            playhead advances to the next cue at the cue boundary. */}
        {onToggleLoop && (
          <button
            data-tour="player-loop"
            data-loop-active={workspace.looping ? 'true' : 'false'}
            style={pillBtnStyle(workspace.looping)}
            onClick={onToggleLoop}
            title={workspace.looping
              ? (t('player.loopOff') || 'A-B повтор: выкл')
              : (t('player.loopOn')  || 'A-B повтор: вкл')}
          >
            <Repeat size={13} /> {th.id === 'atelier' ? 'A — B' : 'A-B'}
          </button>
        )}

        {/* Exit */}
        <button style={exitBtnStyle} onClick={onExit} title={exitLabel}>
          <LogOut size={13} /> {exitLabel}
        </button>
      </div>
    </div>
  );
};
