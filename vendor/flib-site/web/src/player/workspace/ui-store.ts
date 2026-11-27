// web/src/player/workspace/ui-store.ts
// WEB-SEAM: replaces desktop zustand useUIStore (only waveformMode +
// cycleWaveformMode are read). Minimal external store, no zustand dep.
import { useSyncExternalStore } from 'react'
import type { WaveformMode } from './waveform-scale'

const ORDER: WaveformMode[] = ['view-linear', 'view-dB', 'clip-linear']
let state = { waveformMode: 'view-linear' as WaveformMode }
const subs = new Set<() => void>()
function emit() { for (const s of subs) s() }

// WEB-SEAM: brief's plan code declared a standalone getState() that was
// never called (only the useUIStore.getState property below is used) —
// dropped to satisfy noUnusedLocals (plan-review finding, task-1-brief.md).
function cycleWaveformMode() {
  const i = ORDER.indexOf(state.waveformMode)
  state = { waveformMode: ORDER[(i + 1) % ORDER.length] }
  emit()
}
function subscribe(cb: () => void) { subs.add(cb); return () => subs.delete(cb) }

type UIState = { waveformMode: WaveformMode; cycleWaveformMode: () => void }
function snapshot(): UIState { return { waveformMode: state.waveformMode, cycleWaveformMode } }

export function useUIStore<T>(selector: (s: UIState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(snapshot()), () => selector(snapshot()))
}
useUIStore.getState = () => ({ waveformMode: state.waveformMode, cycleWaveformMode })
