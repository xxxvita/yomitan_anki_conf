// cue-shape-adapter.ts — WEB-SEAM: cue-shape adapter (T2 §Часть2.6).
//
// useAnnotations/useShadowLoopCoordinator were lifted verbatim from desktop
// and expect the desktop-shaped Cue ({startTime,endTime,text} — T1's
// panel-types.ts, imported by both hooks after the T2 import-path reprice).
// Web's LIVE subtitle cues (useSubtitles.ts) have a different shape
// ({start,end,text_en,text_ru}). Without this adapter at the call site,
// useAnnotations.getDefaultEndTime (:90-98) silently breaks: every
// `time >= c.startTime` / `time < c.endTime` comparison reads `undefined`
// from a live web cue and is always false, so getDefaultEndTime never snaps
// to a cue boundary and always falls through to the `time + 5` fallback —
// no crash, no type error (structurally these are two different but
// still-plain objects), just silently wrong behaviour.
import type { Cue as LiveCue } from '../hooks/useSubtitles'
import type { Cue as DesktopCue } from './panel-types'

/** One live (web) subtitle cue → one desktop-shaped Cue. `text` = text_en
 *  (the lifted hooks only ever read cue.text, never text_ru). */
export function toDesktopCue(c: LiveCue): DesktopCue {
  return { startTime: c.start, endTime: c.end, text: c.text_en }
}

export function toDesktopCues(cues: LiveCue[]): DesktopCue[] {
  return cues.map(toDesktopCue)
}
