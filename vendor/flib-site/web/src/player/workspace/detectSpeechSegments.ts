export interface SpeechSegment {
  startSec: number;
  endSec: number;
}

export interface SegmentOpts {
  /** Normalized loudness below this counts as silence. */
  silenceThreshold: number;
  /**
   * Silence gaps shorter than this do not split a segment (ms). Rounded up to
   * the nearest whole window: the effective threshold is
   * ceil(minSilenceMs / windowMs) * windowMs.
   */
  minSilenceMs: number;
  /** Segments shorter than this are dropped (ms). */
  minSegmentMs: number;
}

export const DEFAULT_SEGMENT_OPTS: SegmentOpts = {
  silenceThreshold: 0.08,
  minSilenceMs: 350,
  minSegmentMs: 400,
};

/**
 * detectSpeechSegments — derive silence-bounded speech groups from a waveform
 * peaks array. A window is voiced when peaks[i] >= silenceThreshold; a segment
 * is a run of voiced windows where silent gaps shorter than minSilenceMs do not
 * split it; segments shorter than minSegmentMs are dropped.
 */
export function detectSpeechSegments(
  peaks: number[],
  windowMs: number,
  opts: SegmentOpts = DEFAULT_SEGMENT_OPTS,
): SpeechSegment[] {
  if (peaks.length === 0 || windowMs <= 0) return [];
  const winSec = windowMs / 1000;
  const minSilenceWins = Math.max(1, Math.ceil(opts.minSilenceMs / windowMs));

  const segments: SpeechSegment[] = [];
  let segStart = -1;   // window index where the open segment began
  let silenceRun = 0;  // consecutive silent windows since the last voiced one

  const closeSegment = (endWin: number) => {
    if (segStart < 0) return;
    const startSec = segStart * winSec;
    const endSec = endWin * winSec;
    if ((endSec - startSec) * 1000 >= opts.minSegmentMs) {
      segments.push({ startSec, endSec });
    }
    segStart = -1;
  };

  for (let i = 0; i < peaks.length; i++) {
    if (peaks[i] >= opts.silenceThreshold) {
      if (segStart < 0) segStart = i;
      silenceRun = 0;
    } else if (segStart >= 0) {
      silenceRun++;
      if (silenceRun >= minSilenceWins) {
        closeSegment(i - silenceRun + 1); // segment ends where the silence began
        silenceRun = 0;
      }
    }
  }
  closeSegment(peaks.length - silenceRun); // close a trailing open segment
  return segments;
}
