// web/src/player/workspace/panel-map.ts
import type { WorkspaceApi } from '../hooks/useWorkspace'
import type { WorkspaceState, Cue as PanelCue } from './panel-types'

type WebCue = { start: number; end: number; text: string }

export function toWorkspaceState(ws: WorkspaceApi): WorkspaceState {
  return {
    active: true,
    rangeStart: ws.rangeStart, rangeEnd: ws.rangeEnd,
    looping: ws.looping, pauseAtEnd: ws.pauseAtEnd,
    viewStart: ws.viewStart, viewEnd: ws.viewEnd,
  }
}
export function toPanelCues(cues: WebCue[]): PanelCue[] {
  return cues.map(c => ({ startTime: c.start, endTime: c.end, text: c.text }))
}
