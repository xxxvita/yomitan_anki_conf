import React, { useRef, useEffect, useState } from 'react';
import { visibleIndexRange, windowMaxPeak, normalizationBase, scalePeak, type WaveformMode } from './waveform-scale';

export interface WaveformCanvasProps {
  /** Full-video normalized loudness, 0..1, one value per windowMs. */
  peaks: number[];
  /** Milliseconds per peak. */
  windowMs: number;
  /** Visible window start, seconds. */
  viewStart: number;
  /** Visible window end, seconds. */
  viewEnd: number;
  /**
   * Draw colour for the waveform bars. Must be a concrete colour or a CSS
   * variable reference (e.g. `'var(--accent, #E0B341)'`). The value is set
   * as the canvas element's inline `color` style; the draw loop then reads it
   * back via `getComputedStyle(canvas).color`. Defaults to the `--fg-dim`
   * player-theme variable.
   */
  color?: string;
  /** Vertical-scale mode. Defaults to 'clip-linear' (legacy byte-identical look). */
  mode?: WaveformMode;
}

/**
 * WaveformCanvas — draws a studio-style mirrored filled waveform for the
 * visible [viewStart, viewEnd] window. Resamples `peaks` to device-pixel
 * columns (max per column) and fills symmetrically about the track's
 * horizontal centre. Redraws on peaks / view / container-size change.
 * Draw colour defaults to `--fg-dim` but is overridable via the `color` prop.
 */
export const WaveformCanvas: React.FC<WaveformCanvasProps> = ({
  peaks, windowMs, viewStart, viewEnd,
  color = 'var(--fg-dim, #8a7855)',
  mode = 'clip-linear',
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [sizeTick, setSizeTick] = useState(0);

  // Redraw when the container resizes.
  useEffect(() => {
    const parent = canvasRef.current?.parentElement;
    if (!parent || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setSizeTick(t => t + 1));
    ro.observe(parent);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    if (w <= 0 || h <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (peaks.length === 0 || windowMs <= 0 || viewEnd <= viewStart) return;

    // The --fg-dim CSS variable is resolved to a concrete colour by the
    // browser; the '' fallback below only fires in jsdom (no CSS-var resolution).
    const cssColor = getComputedStyle(canvas).color;
    ctx.fillStyle = cssColor && cssColor !== '' ? cssColor : '#8a7855';
    const mid = canvas.height / 2;
    const winSec = windowMs / 1000;
    const span = viewEnd - viewStart;
    const cols = canvas.width;
    // winMax over EXACTLY the drawn half-open range (shared with the loop bounds)
    // so an edge column can never exceed it and clip flat-topped.
    const [vI0, vI1] = visibleIndexRange(viewStart, viewEnd, windowMs, peaks.length);
    const base = normalizationBase(mode, windowMaxPeak(peaks, vI0, vI1));
    for (let x = 0; x < cols; x++) {
      const t0 = viewStart + (span * x) / cols;
      const t1 = viewStart + (span * (x + 1)) / cols;
      const i0 = Math.floor(t0 / winSec);
      const i1 = Math.max(i0 + 1, Math.ceil(t1 / winSec));
      let peak = 0;
      // Clamp the pooled range to [vI0, vI1) — the SAME range windowMaxPeak
      // scanned. Without this, a floating-point overshoot of viewEnd at an exact
      // window boundary lets the right-edge column pull in an index past vI1,
      // whose peak exceeds `base` and flat-tops the bar (spec §2.1, review-CRIT).
      // vI1 <= peaks.length already, so the explicit length guard is subsumed.
      for (let i = Math.max(vI0, i0); i < Math.min(i1, vI1); i++) {
        const v = peaks[i] > 1 ? 1 : peaks[i];
        if (v > peak) peak = v;
      }
      const half = scalePeak(peak, base, mode) * mid;
      if (half > 0) ctx.fillRect(x, mid - half, 1, half * 2);
    }
  }, [peaks, windowMs, viewStart, viewEnd, sizeTick, mode]);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: 'absolute', inset: 0, color }}
    />
  );
};
