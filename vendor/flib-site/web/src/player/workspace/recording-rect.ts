import type { RecordingEntry } from './api-types';

export interface ViewWindow { viewStart: number; viewEnd: number; }
export interface Rect { left: number; width: number; }

// recordingRect maps a recording's video-time span to left%/width% within the
// timeline view window. Returns null when fully off-screen. Both edges are
// clamped independently so a span that straddles the left bound keeps its
// true right edge.
export function recordingRect(
  rec: Pick<RecordingEntry, 'audio_start_sec' | 'audio_end_sec'>,
  view: ViewWindow,
  offset: number,
): Rect | null {
  const viewLen = view.viewEnd - view.viewStart;
  if (viewLen <= 0) return null;
  const start = rec.audio_start_sec + offset;
  const end = rec.audio_end_sec + offset;
  const l = ((start - view.viewStart) / viewLen) * 100;
  const r = ((end - view.viewStart) / viewLen) * 100;
  if (r < -5 || l > 105) return null;
  // WEB-SEAM: fb#6 — клип к видимой рамке [0,100], left ограничен сверху 100−minWidth,
  // чтобы YOU-combo не выходил за край плеера (десктоп имеет тот же −2..104 баг —
  // upstream позже). Правый край независим → left-straddling span сохраняет истинную ширину.
  const left = Math.min(Math.max(0, l), 100 - 0.3);
  const right = Math.min(100, r);
  const width = Math.max(0.3, right - left);
  return { left, width };
}

// pickYouTrackRecording resolves which single recording the YOU track shows.
// Manual recordings (kind: 'manual') are never eligible. When selectedId
// matches an eligible recording it wins; otherwise the latest eligible
// recording (last in append order) is returned. Returns null when there is
// nothing eligible to show.
export function pickYouTrackRecording(
  recs: RecordingEntry[],
  selectedId: string | null,
): RecordingEntry | null {
  const eligible = recs.filter(r => r.kind !== 'manual');
  if (eligible.length === 0) return null;
  if (selectedId) {
    const hit = eligible.find(r => r.id === selectedId);
    if (hit) return hit;
  }
  return eligible[eligible.length - 1];
}

// recordingSpan returns the timeline extent a recording actually occupies —
// anchored at its (reliable) audio_start_sec, extended by the real recorded
// length duration_sec. The tagged audio_end_sec is the A-B *window* and is
// unreliable (it disagrees with duration_sec when the B boundary was nudged
// mid-loop), so it is NOT used for the timeline extent.
export function recordingSpan(
  rec: Pick<RecordingEntry, 'audio_start_sec' | 'duration_sec'>,
): { audio_start_sec: number; audio_end_sec: number } {
  return {
    audio_start_sec: rec.audio_start_sec,
    audio_end_sec: rec.audio_start_sec + Math.max(0, rec.duration_sec),
  };
}

// findRecordingForSelection returns the recording whose audio span covers
// the video-time t — used by Ф2 to pick which YOU recording to play under a
// selection. The span is half-open: [audio_start_sec, audio_end_sec).
// Manual recordings are excluded; when several overlap, the latest (last in
// append order) wins. Returns null when none cover t.
export function findRecordingForSelection(
  recs: RecordingEntry[],
  t: number,
): RecordingEntry | null {
  let hit: RecordingEntry | null = null;
  for (const r of recs) {
    if (r.kind === 'manual') continue;
    const span = recordingSpan(r);
    if (t >= span.audio_start_sec && t < span.audio_end_sec) hit = r;
  }
  return hit;
}
