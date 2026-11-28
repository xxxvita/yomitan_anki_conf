// mute-regions.ts — renderer model + pure helpers for Ф3 mute regions.

// Renderer-side mute region. `tracks` is an object (mirrors TrackSelection);
// the wire/Go shape uses a string array — see MuteRegionWire + converters.
export interface MuteRegion {
  id: string;
  t1: number;
  t2: number;
  tracks: { you: boolean; aud: boolean };
  muted: boolean;        // toggle; false = inert region
  cueIndex: number;      // overlapped cue, or -1
}

// Wire shape — matches the Go MuteRegion JSON.
export interface MuteRegionWire {
  id: string;
  t1: number;
  t2: number;
  tracks: string[];      // subset of {"you","aud"}
  muted: boolean;
  cue_index: number;
}

export function wireToRegion(w: MuteRegionWire): MuteRegion {
  return {
    id: w.id, t1: w.t1, t2: w.t2,
    tracks: { you: w.tracks.includes('you'), aud: w.tracks.includes('aud') },
    muted: w.muted, cueIndex: w.cue_index,
  };
}

export function regionToWire(r: MuteRegion): MuteRegionWire {
  const tracks: string[] = [];
  if (r.tracks.you) tracks.push('you');
  if (r.tracks.aud) tracks.push('aud');
  return { id: r.id, t1: r.t1, t2: r.t2, tracks, muted: r.muted, cue_index: r.cueIndex };
}

// mutedTracksAt returns which audio tracks are silenced at playhead time t —
// the union of tracks of every ACTIVE (muted) region whose [t1,t2) covers t.
export function mutedTracksAt(
  t: number,
  regions: MuteRegion[],
): { you: boolean; aud: boolean } {
  let you = false, aud = false;
  for (const r of regions) {
    if (!r.muted) continue;
    if (t >= r.t1 && t < r.t2) {
      if (r.tracks.you) you = true;
      if (r.tracks.aud) aud = true;
    }
  }
  return { you, aud };
}
