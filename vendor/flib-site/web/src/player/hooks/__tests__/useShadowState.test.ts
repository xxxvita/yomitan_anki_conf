// web/src/player/hooks/__tests__/useShadowState.test.ts
// S3-1: ShadowState-owner hook — defaults, merge-patch, stable getter
// reference, UI reactivity. Canon defaults cross-checked against desktop
// useShadow.ts:15-28 INITIAL (minus the last-used-engines overlay, deferred
// per brief §5).
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useShadowState } from '../useShadowState'

describe('useShadowState defaults', () => {
  it('seeds the canonical desktop defaults', () => {
    const { result } = renderHook(() => useShadowState())
    expect(result.current.shadowState).toEqual({
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
    })
  })

  it('getShadowState() returns the same defaults as the reactive snapshot', () => {
    const { result } = renderHook(() => useShadowState())
    expect(result.current.getShadowState()).toEqual(result.current.shadowState)
  })
})

describe('useShadowState.setShadowState', () => {
  it('applies a patch and getShadowState() reflects it', () => {
    const { result } = renderHook(() => useShadowState())
    act(() => {
      result.current.setShadowState({ mode: 'custom', customText: 'x' })
    })
    expect(result.current.getShadowState().mode).toBe('custom')
    expect(result.current.getShadowState().customText).toBe('x')
  })

  it('merges — a partial patch does not clobber untouched fields', () => {
    const { result } = renderHook(() => useShadowState())
    act(() => {
      result.current.setShadowState({ customText: 'hello' })
    })
    const s = result.current.getShadowState()
    expect(s.customText).toBe('hello')
    // Untouched fields survive the patch verbatim.
    expect(s.mode).toBe('subtitle')
    expect(s.loopMode).toBe(true)
    expect(s.advanceThreshold).toBe(80)
    expect(s.bind).toBe('subStart')
    expect(s.engines).toEqual({ asr: 'whisper-local', check: 'llm-local', ocr: 'llm-local' })
  })

  it('two sequential patches each merge on top of the previous state', () => {
    const { result } = renderHook(() => useShadowState())
    act(() => { result.current.setShadowState({ bind: 'now' }) })
    act(() => { result.current.setShadowState({ advanceEnabled: false }) })
    const s = result.current.getShadowState()
    expect(s.bind).toBe('now')
    expect(s.advanceEnabled).toBe(false)
    expect(s.mode).toBe('subtitle') // still untouched
  })

  it('updates the reactive shadowState snapshot for UI consumers', () => {
    const { result } = renderHook(() => useShadowState())
    act(() => {
      result.current.setShadowState({ mode: 'custom' })
    })
    expect(result.current.shadowState.mode).toBe('custom')
  })
})

describe('useShadowState.getShadowState reference stability', () => {
  it('the getShadowState function identity is stable across re-renders (no state change)', () => {
    const { result, rerender } = renderHook(() => useShadowState())
    const first = result.current.getShadowState
    rerender()
    expect(result.current.getShadowState).toBe(first)
  })

  it('the getShadowState function identity stays stable even across a state-changing re-render', () => {
    const { result } = renderHook(() => useShadowState())
    const first = result.current.getShadowState
    act(() => { result.current.setShadowState({ mode: 'custom' }) })
    expect(result.current.getShadowState).toBe(first)
  })

  it('a getShadowState reference captured before a patch still returns the LATEST state after it (no stale closure)', () => {
    const { result } = renderHook(() => useShadowState())
    const captured = result.current.getShadowState
    act(() => { result.current.setShadowState({ customText: 'captured-then-patched' }) })
    expect(captured().customText).toBe('captured-then-patched')
  })
})
