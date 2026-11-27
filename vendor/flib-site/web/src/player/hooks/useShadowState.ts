// web/src/player/hooks/useShadowState.ts
// S3-1 (production-wiring slice 3): ShadowState-owner. useShadowRuntime (the
// coordinator) requires `getShadowState()` + `setShadowState(patch)` on its
// args (#5/#6, useShadowRuntime.ts:111,122) but nothing on web owned a
// canonical ShadowState yet (V1 kept its own ad-hoc state). This hook is that
// owner — a plain state hook, no UI, no coordinator wiring (that's a later
// task; see the wiring map §B/§C).
//
// Pattern (brief §3): useState for UI reactivity (`shadowState`) mirrored
// into a useRef in the render body (not a useEffect — an effect would lag one
// commit behind if a consumer read getShadowState() synchronously right after
// a setShadowState() call in the same tick). getShadowState() is a
// useCallback with an empty dep array reading `ref.current`, so its identity
// never changes across re-renders — safe for the coordinator to stash once
// (as useShadowRuntime.ts:321-322 already does: `useRef(args.getShadowState)`)
// without re-subscribing.
import { useCallback, useRef, useState } from 'react'
import type { ShadowState } from '../workspace/panel-types'

// Defaults verbatim from desktop canon INITIAL (useShadow.ts:15-28), minus
// the last-used-engines localStorage overlay that freshState() layers on top
// (loadLastUsedEngines()) — S3-1 brief §5 explicitly defers persistence of
// saveAudio/engines/etc. to a later phase, so this seeds the same hardcoded
// engine ids desktop falls back to before that overlay is applied.
const INITIAL_SHADOW_STATE: ShadowState = {
  active: false,
  recording: false,
  wsConnected: false,
  listeningPaused: false,
  partialText: '',
  committedSegments: [],
  attempts: [],
  currentLoopIndex: 0,
  loopMode: true,
  advanceEnabled: true,
  advanceThreshold: 80,
  mode: 'subtitle',
  customText: '',
  documentPath: '',
  bind: 'subStart',
  saveAudio: false,
  engines: { asr: 'whisper-local', check: 'llm-local', ocr: 'llm-local' },
}

export interface UseShadowStateApi {
  /** Reactive snapshot — read in render for UI (mode chip, customText field, bind segment). */
  shadowState: ShadowState
  /**
   * Stable-reference getter for coordinators/callbacks: always returns the
   * LATEST ShadowState without triggering (or requiring) a re-render
   * subscription. Matches useShadowRuntime's `getShadowState: () => ShadowState`.
   */
  getShadowState: () => ShadowState
  /**
   * Partial merge into the current state — untouched fields are preserved.
   * Matches useShadowRuntime's (narrower) `setShadowState?:
   * (patch: Partial<Pick<ShadowState, 'customText' | 'mode'>>) => void`.
   */
  setShadowState: (patch: Partial<ShadowState>) => void
}

export function useShadowState(): UseShadowStateApi {
  const [state, setState] = useState<ShadowState>(INITIAL_SHADOW_STATE)

  // Updated in the render body on every render (never inside an effect) so a
  // synchronous getShadowState() call right after setShadowState() — e.g. from
  // an event handler that both mutates and immediately reads back — never
  // observes a stale snapshot.
  const stateRef = useRef(state)
  stateRef.current = state

  const getShadowState = useCallback((): ShadowState => stateRef.current, [])

  const setShadowState = useCallback((patch: Partial<ShadowState>) => {
    setState(prev => ({ ...prev, ...patch }))
  }, [])

  return { shadowState: state, getShadowState, setShadowState }
}
