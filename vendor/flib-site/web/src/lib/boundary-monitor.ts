// web/src/lib/boundary-monitor.ts
// Порт verbatim из electron/renderer/.../utils/boundary-monitor.ts.
// Чистое ядро предиктивной детекции прохода границы петли. Источник кадра
// (dtMs) на вебе — межкадровый интервал rAF-драйвера (poll clock-shim),
// в десктопе был requestVideoFrameCallback. Логика ядра не меняется.

export function predictBoundaryCross(
  cur: number,
  dtMs: number,
  rate: number,
  boundary: number,
  lookaheadFrames = 2,
): boolean {
  if (rate <= 0) return false
  const predicted = cur + (dtMs / 1000) * rate * lookaheadFrames
  return predicted >= boundary
}

const REARM_MARGIN = 0.25

export interface MonitorState {
  armed: boolean
  lastBoundary: number | null
}

export const initialMonitorState: MonitorState = { armed: false, lastBoundary: null }

export function boundaryMonitorStep(
  state: MonitorState,
  cur: number,
  dtMs: number,
  rate: number,
  boundary: number | null,
  lookaheadFrames = 2,
): { fire: boolean; state: MonitorState } {
  if (boundary == null) {
    return { fire: false, state: initialMonitorState }
  }
  let { armed, lastBoundary } = state
  if (boundary !== lastBoundary) {
    armed = true
    lastBoundary = boundary
  } else if (cur < boundary - REARM_MARGIN) {
    armed = true
  }
  if (!armed) {
    return { fire: false, state: { armed, lastBoundary } }
  }
  if (predictBoundaryCross(cur, dtMs, rate, boundary, lookaheadFrames)) {
    return { fire: true, state: { armed: false, lastBoundary } }
  }
  return { fire: false, state: { armed, lastBoundary } }
}

export interface BoundaryExercise {
  startTime: number
  endTime: number
}

export function nextEntryBoundary(exercises: BoundaryExercise[], cur: number): number | null {
  for (const e of exercises) {
    if (cur >= e.startTime && cur < e.endTime) return null
  }
  let best: number | null = null
  for (const e of exercises) {
    if (e.startTime > cur && (best === null || e.startTime < best)) best = e.startTime
  }
  return best
}
