export interface LoopBounds { start: number; end: number; }

// resolveLoopBounds picks the timeline bounds for tagging a shadowing
// recording / attempt. It prefers the live A-B loop range — that is the
// segment the user actually practised — and falls back to playhead samples
// only when the range is unavailable or degenerate (end <= start). The old
// playhead-sample scheme drifts under A-B looping: archiveLoop fires on every
// B-crossing and the start marker becomes a stale "previous B".
export function resolveLoopBounds(
  loopRange: LoopBounds | null | undefined,
  fallbackStart: number | undefined,
  fallbackEnd: number | undefined,
): LoopBounds {
  if (loopRange && loopRange.end > loopRange.start) {
    return { start: loopRange.start, end: loopRange.end };
  }
  return { start: fallbackStart ?? 0, end: fallbackEnd ?? 0 };
}
