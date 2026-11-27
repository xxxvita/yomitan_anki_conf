import React, { useState, useRef, useCallback } from 'react';

/** Max A-B loop B-pause, seconds. */
export const PAUSE_MAX = 2.5;
/** Mini-scale track width, px. */
const TRACK_WIDTH = 96;

/**
 * pxToPauseSeconds — map a drag offset (px from the mini-scale's left edge)
 * to a pause value in seconds, clamped to [0, PAUSE_MAX] and snapped to 0.1 s.
 */
export function pxToPauseSeconds(offsetX: number, trackWidthPx: number): number {
  if (trackWidthPx <= 0) return 0;
  const frac = Math.max(0, Math.min(1, offsetX / trackWidthPx));
  return Math.round(frac * PAUSE_MAX * 10) / 10;
}

export interface PauseAtBControlProps {
  /** Current pause held at point B, seconds (0 = no pause). */
  pauseAtEnd: number;
  /** Commit a new pause value (clamped/snapped). 0 clears the pause. */
  onChange: (seconds: number) => void;
  /** Active player-theme accent colour (e.g. the A-B handle colour). */
  accent: string;
  /** Active player-theme contrast colour for text drawn on `accent`. */
  accentFg: string;
}

/**
 * PauseAtBControl — on-timeline control for the A-B loop's "W" pause, shown
 * next to the B handle. Three states: a "+" button (pauseAtEnd 0), a
 * "W <n>s" pill (pauseAtEnd > 0), or a mini drag-scale while editing. All
 * colours come from the active player theme via `accent` / `accentFg`.
 */
export const PauseAtBControl: React.FC<PauseAtBControlProps> = ({ pauseAtEnd, onChange, accent, accentFg }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(pauseAtEnd);
  const trackRef = useRef<HTMLDivElement | null>(null);

  const openEditor = useCallback(() => { setDraft(pauseAtEnd); setEditing(true); }, [pauseAtEnd]);

  const applyFromEvent = useCallback((clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setDraft(pxToPauseSeconds(clientX - rect.left, rect.width));
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    try { (e.target as HTMLElement).setPointerCapture(e.pointerId); } catch { /* unsupported */ }
    applyFromEvent(e.clientX);
  }, [applyFromEvent]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (e.buttons === 0) return;
    applyFromEvent(e.clientX);
  }, [applyFromEvent]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    onChange(draft);
    setEditing(false);
  }, [draft, onChange]);

  // If the pointer interaction is cancelled (window blur, OS gesture), leave
  // editing mode so the control can never get stuck open.
  const onPointerCancel = useCallback(() => {
    setEditing(false);
  }, []);

  if (editing) {
    return (
      <div
        data-testid="pause-at-b-scale"
        ref={trackRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        style={{
          width: TRACK_WIDTH, height: 14, borderRadius: 7,
          background: `${accent}33`, border: `1px solid ${accent}`,
          position: 'relative', cursor: 'ew-resize', touchAction: 'none',
        }}
      >
        <div style={{
          position: 'absolute', top: 0, bottom: 0, left: 0,
          width: `${(draft / PAUSE_MAX) * 100}%`,
          background: accent, borderRadius: 7,
        }} />
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 9, fontWeight: 700, color: accent, whiteSpace: 'nowrap',
          mixBlendMode: 'difference',
        }}>
          {draft.toFixed(1)}с
        </div>
      </div>
    );
  }

  if (pauseAtEnd > 0) {
    return (
      <button
        data-testid="pause-at-b-pill"
        onClick={openEditor}
        title="A-B пауза — нажмите, чтобы изменить"
        style={{
          height: 14, padding: '0 6px', borderRadius: 7,
          background: accent, color: accentFg, border: 'none',
          fontSize: 9, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
        }}
      >
        W {pauseAtEnd.toFixed(1)}с
      </button>
    );
  }

  return (
    <button
      data-testid="pause-at-b-add"
      onClick={openEditor}
      title="Пауза в точке B"
      style={{
        width: 14, height: 14, borderRadius: 7,
        background: 'transparent', color: accent, border: `1px solid ${accent}`,
        fontSize: 10, lineHeight: 1, cursor: 'pointer', padding: 0,
      }}
    >
      +
    </button>
  );
};
