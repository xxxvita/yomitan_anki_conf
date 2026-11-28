// track-selection.ts — pure model + geometry for the «G»-drag track selection.

export interface TrackBands {
  audTop: number; audH: number;   // AUD track Y-band (px, relative to the bar)
  youTop: number; youH: number;   // YOU track Y-band
  youVisible: boolean;            // YOU track is only present in some states
}

// One committed selection — a time range + the set of covered audio tracks.
export interface TrackSelection {
  t1: number;                     // video-time seconds (t1 < t2)
  t2: number;
  tracks: { you: boolean; aud: boolean };
}

// rectToTracks maps a selection rectangle's vertical span [rectTop, rectBottom]
// (px, relative to the bar) to the set of covered audio tracks. "Any touch":
// a track is covered if the rect overlaps its Y-band by even one pixel. The
// SUB track has no audio and is never part of a selection.
export function rectToTracks(
  rectTop: number,
  rectBottom: number,
  bands: TrackBands,
): { you: boolean; aud: boolean } {
  const lo = Math.min(rectTop, rectBottom);
  const hi = Math.max(rectTop, rectBottom);
  const touches = (bandTop: number, bandH: number) =>
    hi > bandTop && lo < bandTop + bandH;
  return {
    aud: touches(bands.audTop, bands.audH),
    you: bands.youVisible && touches(bands.youTop, bands.youH),
  };
}
