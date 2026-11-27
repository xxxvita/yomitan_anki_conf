import { DEFAULT_SEGMENT_OPTS } from './detectSpeechSegments';

export type WaveformMode = 'view-linear' | 'view-dB' | 'clip-linear';

/** Cycle order AND the single source of truth for valid persisted values. */
export const WAVEFORM_MODES: readonly WaveformMode[] = ['view-linear', 'view-dB', 'clip-linear'];

/** Guards the per-view base against divide-by-near-zero (caps gain at ~25x). */
export const WAVEFORM_FLOOR = 0.04;
/** dB curve floor: vn=0 -> 0, vn=1 -> 1, mapped linearly over [DB_FLOOR, 0] dB. */
export const WAVEFORM_DB_FLOOR = -48;
/** Silence gate for view modes — the same threshold detectSpeechSegments uses. */
export const WAVEFORM_SILENCE = DEFAULT_SEGMENT_OPTS.silenceThreshold;

/**
 * Half-open [i0, i1) range of peak indices visible in [viewStart, viewEnd],
 * clamped to [0, peaksLen). Used for BOTH the windowMax scan and (implicitly)
 * the draw loop's column bounds, so winMax is taken over exactly the drawn
 * range — no flat-topping at the window edge.
 */
export function visibleIndexRange(
  viewStart: number, viewEnd: number, windowMs: number, peaksLen: number,
): [number, number] {
  if (peaksLen <= 0 || windowMs <= 0) return [0, 0];
  const winSec = windowMs / 1000;
  const i0 = Math.max(0, Math.floor(viewStart / winSec));
  const i1 = Math.min(peaksLen, Math.max(i0 + 1, Math.ceil(viewEnd / winSec)));
  return [i0, Math.max(i0, i1)];
}

/** Max peak (each clamped to <=1) over [i0, i1); 0 for an empty range. */
export function windowMaxPeak(peaks: number[], i0: number, i1: number): number {
  let m = 0;
  for (let i = Math.max(0, i0); i < i1 && i < peaks.length; i++) {
    const v = peaks[i] > 1 ? 1 : peaks[i];
    if (v > m) m = v;
  }
  return m;
}

/** Normalization base by mode: clip -> 1; view-* -> max(windowMax, FLOOR). */
export function normalizationBase(mode: WaveformMode, windowMax: number): number {
  if (mode === 'clip-linear') return 1;
  return Math.max(windowMax, WAVEFORM_FLOOR);
}

/**
 * Drawn fraction 0..1 for one resampled column peak.
 * - clip-linear: identity, NO silence gate (byte-identical to legacy).
 * - view-linear: silence-gate, then p/base.
 * - view-dB:     silence-gate, then dB curve of p/base over [DB_FLOOR, 0].
 */
export function scalePeak(peak: number, base: number, mode: WaveformMode): number {
  const p = peak > 1 ? 1 : (peak < 0 ? 0 : peak);
  if (mode === 'clip-linear') return p;
  if (p < WAVEFORM_SILENCE) return 0;
  const vn = base > 0 ? p / base : 0;
  if (mode === 'view-linear') return vn > 1 ? 1 : vn;
  // view-dB
  if (vn <= 0) return 0;
  const dB = 20 * Math.log10(vn);
  const v = (dB - WAVEFORM_DB_FLOOR) / (-WAVEFORM_DB_FLOOR);
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
