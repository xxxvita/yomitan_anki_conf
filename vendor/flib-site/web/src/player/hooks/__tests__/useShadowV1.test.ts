// useShadowV1.test.ts — T3 3c: state-machine idle→recording→transcribing→result|error.
// DI: fake recorder (start/stop) + fake postStt (no real getUserMedia/fetch in jsdom).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createElement, StrictMode } from 'react'
import { renderHook, act } from '@testing-library/react'
import { useShadowV1, type ShadowRecorderLike } from '../useShadowV1'
import type { Cue } from '../useSubtitles'
import type { WorkspaceApi } from '../useWorkspace'
import { makeFakeAdapter } from '../../../adapter/__tests__/fake'
import { useVideoPlayerStore } from '../../workspace/video-player-store'
import { AudioInitError } from '../../workspace/audio-pipeline'

const CUES: Cue[] = [
  { start: 0, end: 2, text_en: 'hello world', text_ru: 'привет мир' },
  { start: 2, end: 4, text_en: 'second cue', text_ru: 'вторая реплика' },
]

function mkWs(overrides: Partial<WorkspaceApi> = {}): WorkspaceApi {
  return {
    rangeStart: 0, rangeEnd: 0, looping: false, pauseAtEnd: 0, countdownValue: null,
    viewStart: 0, viewEnd: 10,
    setABLoop: vi.fn(), toggleABLoop: vi.fn(), onPlayCommand: vi.fn(), onUserSeek: vi.fn(),
    setPauseAtEnd: vi.fn(), stopLoop: vi.fn(), setView: vi.fn(), zoom: vi.fn(),
    fitToRange: vi.fn(), setRange: vi.fn(), _boundaryTickForTest: vi.fn(),
    countdownThenPlay: vi.fn(), resumeFromBoundary: vi.fn(), restoreWorkspace: vi.fn(),
    deactivateWorkspace: vi.fn(), getWorkspaceSnapshot: vi.fn(),
    ...overrides,
  }
}

// PCM16 samples that are non-empty so concatPcm16 doesn't yield an empty array
// (empty samples → no_speech before postStt is even attempted).
function fakeChunk(): ArrayBuffer {
  const buf = new ArrayBuffer(4)
  new Int16Array(buf).set([100, -100])
  return buf
}

function makeFakeRecorder(opts: { startThrows?: boolean; startThrowsAudioInit?: boolean } = {}) {
  let onCapCb: (() => void) | null = null
  const stopped = { called: false }
  const recorder: ShadowRecorderLike = {
    start: vi.fn(async () => {
      if (opts.startThrowsAudioInit) throw new AudioInitError('worklet failed')
      if (opts.startThrows) throw new Error('mic denied')
    }),
    stop: vi.fn(() => { stopped.called = true; return [fakeChunk()] }),
  }
  return {
    recorder,
    stopped,
    factory: (onCap: () => void) => { onCapCb = onCap; return recorder },
    triggerCap: () => onCapCb?.(),
  }
}

beforeEach(() => { localStorage.clear() })

describe('useShadowV1', () => {
  it('happy path: activate → start → stop → result with marks/matchPct, attempt+recording stored', async () => {
    const adapter = makeFakeAdapter({ t: 0 })
    const fake = makeFakeRecorder()
    const postStt = vi.fn(async () => ({ status: 200, text: 'hello world' }))
    const ws = mkWs()

    const { result } = renderHook(() =>
      useShadowV1(adapter, 'vidA', CUES, 0, ws, { createRecorder: fake.factory, postStt }))

    act(() => { result.current.activate() })
    await act(async () => { await result.current.startRecording() })
    expect(result.current.phase).toBe('recording')

    adapter._setTime(2)
    await act(async () => { result.current.stopRecording(); await Promise.resolve(); await Promise.resolve() })

    expect(result.current.phase).toBe('result')
    expect(result.current.lastMatchPct).toBe(100)
    expect(result.current.lastMarks?.length).toBeGreaterThan(0)
    expect(result.current.lastSpoken).toBe('hello world')
    expect(result.current.shadowAttempts['0'].attempts).toHaveLength(1)
    expect(result.current.recordings).toHaveLength(1)
    expect(result.current.recordings[0].peaks.length).toBeGreaterThan(0)
  })

  it('bounds: with an active ws range (end>start), recording spans the range, not the snapshot/currentTime', async () => {
    const adapter = makeFakeAdapter({ t: 5 })
    const fake = makeFakeRecorder()
    const postStt = vi.fn(async () => ({ status: 200, text: 'hello world' }))
    const ws = mkWs({ rangeStart: 10, rangeEnd: 20 })

    const { result } = renderHook(() =>
      useShadowV1(adapter, 'vidA', CUES, 0, ws, { createRecorder: fake.factory, postStt }))
    await act(async () => { await result.current.startRecording() })
    adapter._setTime(6)
    await act(async () => { result.current.stopRecording(); await Promise.resolve(); await Promise.resolve() })

    expect(result.current.recordings[0].audio_start_sec).toBe(10)
    expect(result.current.recordings[0].audio_end_sec).toBe(20)
  })

  it('bounds: without a range, uses snapshot start..currentTime at stop', async () => {
    const adapter = makeFakeAdapter({ t: 3 })
    const fake = makeFakeRecorder()
    const postStt = vi.fn(async () => ({ status: 200, text: 'hello world' }))
    const ws = mkWs() // rangeEnd(0) <= rangeStart(0) → no active range

    const { result } = renderHook(() =>
      useShadowV1(adapter, 'vidA', CUES, 0, ws, { createRecorder: fake.factory, postStt }))
    await act(async () => { await result.current.startRecording() }) // snapshot start = 3
    adapter._setTime(7)
    await act(async () => { result.current.stopRecording(); await Promise.resolve(); await Promise.resolve() })

    expect(result.current.recordings[0].audio_start_sec).toBe(3)
    expect(result.current.recordings[0].audio_end_sec).toBe(7)
  })

  it('fable-audit MED-1: endSec is snapshotted at stopRecording (sync), NOT re-read after the postStt await — video time moving during STT latency must not leak into audio_end_sec', async () => {
    const adapter = makeFakeAdapter({ t: 0 })
    const fake = makeFakeRecorder()
    let resolvePostStt: ((v: { status: number; text: string }) => void) | null = null
    const postStt = vi.fn(() => new Promise<{ status: number; text: string }>(resolve => { resolvePostStt = resolve }))
    const ws = mkWs() // no active range → falls back to snapshot start..endSec

    const { result } = renderHook(() =>
      useShadowV1(adapter, 'vidA', CUES, 0, ws, { createRecorder: fake.factory, postStt }))
    await act(async () => { await result.current.startRecording() }) // snapshot start = 0

    // Stop the recording at t=2 (the TRUE boundary of the attempt) ...
    adapter._setTime(2)
    act(() => { result.current.stopRecording() })
    expect(result.current.phase).toBe('transcribing')

    // ...then, WHILE the STT request is still in flight (simulating ~1.5s of real
    // network latency), the video keeps playing and moves well past the boundary.
    adapter._setTime(9)

    await act(async () => {
      resolvePostStt?.({ status: 200, text: 'hello world' })
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    })

    expect(result.current.phase).toBe('result')
    // Must be 2 (time at stop), NOT 9 (time when postStt happened to resolve).
    expect(result.current.recordings[0].audio_end_sec).toBe(2)
  })

  it('413 → errorCode too_large, phase error', async () => {
    const adapter = makeFakeAdapter()
    const fake = makeFakeRecorder()
    const postStt = vi.fn(async () => ({ status: 413, text: '' }))
    const { result } = renderHook(() =>
      useShadowV1(adapter, 'vidA', CUES, 0, mkWs(), { createRecorder: fake.factory, postStt }))
    await act(async () => { await result.current.startRecording() })
    await act(async () => { result.current.stopRecording(); await Promise.resolve(); await Promise.resolve() })
    expect(result.current.phase).toBe('error')
    expect(result.current.errorCode).toBe('too_large')
  })

  it('429 → errorCode rate_limited, phase error', async () => {
    const adapter = makeFakeAdapter()
    const fake = makeFakeRecorder()
    const postStt = vi.fn(async () => ({ status: 429, text: '' }))
    const { result } = renderHook(() =>
      useShadowV1(adapter, 'vidA', CUES, 0, mkWs(), { createRecorder: fake.factory, postStt }))
    await act(async () => { await result.current.startRecording() })
    await act(async () => { result.current.stopRecording(); await Promise.resolve(); await Promise.resolve() })
    expect(result.current.phase).toBe('error')
    expect(result.current.errorCode).toBe('rate_limited')
  })

  it('postStt throws (network/gateway) → errorCode gateway, phase error', async () => {
    const adapter = makeFakeAdapter()
    const fake = makeFakeRecorder()
    const postStt = vi.fn(async () => { throw new Error('network down') })
    const { result } = renderHook(() =>
      useShadowV1(adapter, 'vidA', CUES, 0, mkWs(), { createRecorder: fake.factory, postStt }))
    await act(async () => { await result.current.startRecording() })
    await act(async () => { result.current.stopRecording(); await Promise.resolve(); await Promise.resolve() })
    expect(result.current.phase).toBe('error')
    expect(result.current.errorCode).toBe('gateway')
  })

  it('empty transcription text → errorCode no_speech, phase error', async () => {
    const adapter = makeFakeAdapter()
    const fake = makeFakeRecorder()
    const postStt = vi.fn(async () => ({ status: 200, text: '' }))
    const { result } = renderHook(() =>
      useShadowV1(adapter, 'vidA', CUES, 0, mkWs(), { createRecorder: fake.factory, postStt }))
    await act(async () => { await result.current.startRecording() })
    await act(async () => { result.current.stopRecording(); await Promise.resolve(); await Promise.resolve() })
    expect(result.current.phase).toBe('error')
    expect(result.current.errorCode).toBe('no_speech')
  })

  it('cueIndex<0 at startRecording → error no_speech, recorder never created', async () => {
    const adapter = makeFakeAdapter()
    const fake = makeFakeRecorder()
    const postStt = vi.fn(async () => ({ status: 200, text: 'x' }))
    const { result } = renderHook(() =>
      useShadowV1(adapter, 'vidA', CUES, -1, mkWs(), { createRecorder: fake.factory, postStt }))
    await act(async () => { await result.current.startRecording() })
    expect(result.current.phase).toBe('error')
    expect(result.current.errorCode).toBe('no_speech')
    expect(fake.recorder.start).not.toHaveBeenCalled()
  })

  it('cap fires onCap → capped=true and finalize runs (recorder.stop was invoked)', async () => {
    const adapter = makeFakeAdapter()
    const fake = makeFakeRecorder()
    const postStt = vi.fn(async () => ({ status: 200, text: 'hello world' }))
    const { result } = renderHook(() =>
      useShadowV1(adapter, 'vidA', CUES, 0, mkWs(), { createRecorder: fake.factory, postStt }))
    await act(async () => { await result.current.startRecording() })

    await act(async () => { fake.triggerCap(); await Promise.resolve(); await Promise.resolve() })

    expect(result.current.capped).toBe(true)
    expect(fake.stopped.called).toBe(true)
    expect(result.current.phase).toBe('result')
  })

  it('mic denied (recorder.start rejects) → errorCode mic_denied', async () => {
    const adapter = makeFakeAdapter()
    const fake = makeFakeRecorder({ startThrows: true })
    const postStt = vi.fn(async () => ({ status: 200, text: 'x' }))
    const { result } = renderHook(() =>
      useShadowV1(adapter, 'vidA', CUES, 0, mkWs(), { createRecorder: fake.factory, postStt }))
    await act(async () => { await result.current.startRecording() })
    expect(result.current.phase).toBe('error')
    expect(result.current.errorCode).toBe('mic_denied')
  })

  it('audio init failure (recorder.start rejects with AudioInitError, e.g. CSP-blocked AudioWorklet) → errorCode audio_init, NOT mic_denied', async () => {
    const adapter = makeFakeAdapter()
    const fake = makeFakeRecorder({ startThrowsAudioInit: true })
    const postStt = vi.fn(async () => ({ status: 200, text: 'x' }))
    const { result } = renderHook(() =>
      useShadowV1(adapter, 'vidA', CUES, 0, mkWs(), { createRecorder: fake.factory, postStt }))
    await act(async () => { await result.current.startRecording() })
    expect(result.current.phase).toBe('error')
    expect(result.current.errorCode).toBe('audio_init')
  })

  it('deactivate during recording stops the recorder and resets to idle', async () => {
    const adapter = makeFakeAdapter()
    const fake = makeFakeRecorder()
    const postStt = vi.fn(async () => ({ status: 200, text: 'x' }))
    const { result } = renderHook(() =>
      useShadowV1(adapter, 'vidA', CUES, 0, mkWs(), { createRecorder: fake.factory, postStt }))
    act(() => { result.current.activate() })
    await act(async () => { await result.current.startRecording() })
    expect(result.current.phase).toBe('recording')

    act(() => { result.current.deactivate() })
    expect(fake.recorder.stop).toHaveBeenCalled()
    expect(result.current.active).toBe(false)
    expect(result.current.phase).toBe('idle')
  })

  it('repeated startRecording while already recording is a no-op (idempotent)', async () => {
    const adapter = makeFakeAdapter()
    const fake = makeFakeRecorder()
    const postStt = vi.fn(async () => ({ status: 200, text: 'x' }))
    const { result } = renderHook(() =>
      useShadowV1(adapter, 'vidA', CUES, 0, mkWs(), { createRecorder: fake.factory, postStt }))
    await act(async () => { await result.current.startRecording() })
    await act(async () => { await result.current.startRecording() })
    expect(fake.recorder.start).toHaveBeenCalledTimes(1)
  })

  it('selectRecording writes the id into the shared video-player-store (YOU track selection)', async () => {
    const adapter = makeFakeAdapter()
    const fake = makeFakeRecorder()
    const postStt = vi.fn(async () => ({ status: 200, text: 'hello world' }))
    const { result } = renderHook(() =>
      useShadowV1(adapter, 'vidA', CUES, 0, mkWs(), { createRecorder: fake.factory, postStt }))
    await act(async () => { await result.current.startRecording() })
    await act(async () => { result.current.stopRecording(); await Promise.resolve(); await Promise.resolve() })
    const id = result.current.recordings[0].id

    act(() => { result.current.selectRecording(id) })
    const { result: storeResult } = renderHook(() => useVideoPlayerStore(s => s.youTrackRecordingId))
    expect(storeResult.current).toBe(id)
  })

  it('T3 review #1: deactivate during transcribing invalidates the pending finalize (generation guard) — postStt resolves AFTER deactivate: phase stays idle, attempt not persisted, no blob-URL minted for the stale result', async () => {
    const adapter = makeFakeAdapter()
    const fake = makeFakeRecorder()
    let resolvePostStt: ((v: { status: number; text: string }) => void) | null = null
    const postStt = vi.fn(() => new Promise<{ status: number; text: string }>(resolve => { resolvePostStt = resolve }))
    const { result } = renderHook(() =>
      useShadowV1(adapter, 'vidA', CUES, 0, mkWs(), { createRecorder: fake.factory, postStt }))

    act(() => { result.current.activate() })
    await act(async () => { await result.current.startRecording() })
    expect(result.current.phase).toBe('recording')

    // stop() → finalize() enters 'transcribing' and suspends on the (unresolved) postStt.
    act(() => { result.current.stopRecording() })
    expect(result.current.phase).toBe('transcribing')

    const createCallsBefore = vi.mocked(URL.createObjectURL).mock.calls.length

    // Deactivate WHILE transcribing — recorderRef is already null (stopRecording
    // cleared it), so without the generation guard this in-flight finalize would
    // still land its result after the fact.
    act(() => { result.current.deactivate() })
    expect(result.current.active).toBe(false)
    expect(result.current.phase).toBe('idle')

    // Now the stale postStt resolves successfully.
    await act(async () => {
      resolvePostStt?.({ status: 200, text: 'hello world' })
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    })

    expect(result.current.phase).toBe('idle') // must NOT flip to 'result' (or 'error')
    expect(result.current.shadowAttempts['0']?.attempts ?? []).toHaveLength(0) // not persisted
    expect(result.current.recordings).toHaveLength(0) // no RecordingEntry appended
    // No orphan blob URL minted for the discarded result.
    expect(vi.mocked(URL.createObjectURL).mock.calls.length).toBe(createCallsBefore)
  })

  it('T3 review #1: deactivate during transcribing also swallows a late postStt failure (413) without flipping to error', async () => {
    const adapter = makeFakeAdapter()
    const fake = makeFakeRecorder()
    let rejectPostStt: ((v: { status: number; text: string }) => void) | null = null
    const postStt = vi.fn(() => new Promise<{ status: number; text: string }>(resolve => { rejectPostStt = resolve }))
    const { result } = renderHook(() =>
      useShadowV1(adapter, 'vidA', CUES, 0, mkWs(), { createRecorder: fake.factory, postStt }))

    await act(async () => { await result.current.startRecording() })
    act(() => { result.current.stopRecording() })
    expect(result.current.phase).toBe('transcribing')

    act(() => { result.current.deactivate() })
    expect(result.current.phase).toBe('idle')

    await act(async () => {
      rejectPostStt?.({ status: 413, text: '' })
      await Promise.resolve(); await Promise.resolve()
    })

    expect(result.current.phase).toBe('idle') // must NOT flip to 'error'
    expect(result.current.errorCode).toBeNull()
  })

  it('T3 review #2 (regression): rerender with a different activeIndex/referenceText BETWEEN startRecording and stopRecording must NOT change the stored attempt — snapshot is taken at recording START, not at stop', async () => {
    const adapter = makeFakeAdapter()
    const fake = makeFakeRecorder()
    const postStt = vi.fn(async () => ({ status: 200, text: 'hello world' }))
    const ws = mkWs()

    const { result, rerender } = renderHook(
      (props: { activeIndex: number; cues: Cue[] }) =>
        useShadowV1(adapter, 'vidA', props.cues, props.activeIndex, ws, { createRecorder: fake.factory, postStt }),
      { initialProps: { activeIndex: 0, cues: CUES } },
    )

    // Snapshot taken here: cueIndex=0, refText='hello world'.
    await act(async () => { await result.current.startRecording() })
    expect(result.current.phase).toBe('recording')

    // Active cue changes mid-recording (user scrubbed to the next line) — the "now"
    // getters must reflect it (they're for UI before a NEW recording starts)...
    const CUES2: Cue[] = [
      { start: 0, end: 2, text_en: 'hello world', text_ru: 'привет мир' },
      { start: 2, end: 4, text_en: 'totally different text', text_ru: 'вторая реплика' },
    ]
    rerender({ activeIndex: 1, cues: CUES2 })
    expect(result.current.referenceText).toBe('totally different text')
    expect(result.current.cueIndex).toBe(1)
    expect(result.current.phase).toBe('recording') // unaffected by the rerender

    await act(async () => { result.current.stopRecording(); await Promise.resolve(); await Promise.resolve() })

    // ...but the STORED attempt must carry the snapshot from recording START (cue 0),
    // matched against the OLD reference text ('hello world' vs spoken 'hello world' → 100%).
    expect(result.current.recordings[0].cue_index).toBe(0)
    expect(result.current.lastMatchPct).toBe(100)
    expect(result.current.shadowAttempts['0'].attempts).toHaveLength(1)
    expect(result.current.shadowAttempts['1']).toBeUndefined()
  })

  it('T3 review #3: unmount revokes the current recordAudioUrl (no leaked blob URL)', async () => {
    const adapter = makeFakeAdapter()
    const fake = makeFakeRecorder()
    const postStt = vi.fn(async () => ({ status: 200, text: 'hello world' }))
    const { result, unmount } = renderHook(() =>
      useShadowV1(adapter, 'vidA', CUES, 0, mkWs(), { createRecorder: fake.factory, postStt }))

    await act(async () => { await result.current.startRecording() })
    await act(async () => { result.current.stopRecording(); await Promise.resolve(); await Promise.resolve() })
    const url = result.current.recordAudioUrl
    expect(url).toBeTruthy()

    const revokeSpy = vi.mocked(URL.revokeObjectURL)
    revokeSpy.mockClear()

    unmount()

    expect(revokeSpy).toHaveBeenCalledWith(url)
  })

  it('T3 review #3: unmount with no recording ever made does not call revokeObjectURL', () => {
    const adapter = makeFakeAdapter()
    const fake = makeFakeRecorder()
    const postStt = vi.fn(async () => ({ status: 200, text: 'hello world' }))
    const { unmount } = renderHook(() =>
      useShadowV1(adapter, 'vidA', CUES, 0, mkWs(), { createRecorder: fake.factory, postStt }))

    const revokeSpy = vi.mocked(URL.revokeObjectURL)
    revokeSpy.mockClear()

    unmount()

    expect(revokeSpy).not.toHaveBeenCalled()
  })

  it('T5 review finding #4: videoId change while active resets it (deactivate) — active flips false, phase idle', async () => {
    const adapter = makeFakeAdapter()
    const fake = makeFakeRecorder()
    const postStt = vi.fn(async () => ({ status: 200, text: 'hello world' }))

    const { result, rerender } = renderHook(
      (props: { videoId: string }) =>
        useShadowV1(adapter, props.videoId, CUES, 0, mkWs(), { createRecorder: fake.factory, postStt }),
      { initialProps: { videoId: 'vidA' } },
    )

    act(() => { result.current.activate() })
    await act(async () => { await result.current.startRecording() })
    expect(result.current.active).toBe(true)
    expect(result.current.phase).toBe('recording')

    // User navigates to a different video mid-recording.
    rerender({ videoId: 'vidB' })

    expect(result.current.active).toBe(false)
    expect(result.current.phase).toBe('idle')
    expect(fake.recorder.stop).toHaveBeenCalled()
  })

  it('T5 review finding #4: videoId change while NOT active is a no-op (idle stays idle, active stays false)', () => {
    const adapter = makeFakeAdapter()
    const fake = makeFakeRecorder()
    const postStt = vi.fn(async () => ({ status: 200, text: 'x' }))

    const { result, rerender } = renderHook(
      (props: { videoId: string }) =>
        useShadowV1(adapter, props.videoId, CUES, 0, mkWs(), { createRecorder: fake.factory, postStt }),
      { initialProps: { videoId: 'vidA' } },
    )

    rerender({ videoId: 'vidB' })

    expect(result.current.active).toBe(false)
    expect(result.current.phase).toBe('idle')
    expect(fake.recorder.stop).not.toHaveBeenCalled()
  })

  // ── Ф1 accept-feedback #8 fix pass (audit/18-live-feedback-shadowing-full.md §Ф1) ──

  it('Ф1 bug #2: startRecording from phase=result works after the AB-loop boundary pauses (activeIndex flips to -1) — root cause: reachBoundary() pauses AT rangeEnd===cue.end, and findActiveCueIndex is half-open [start,end), so referenceText/cueIndex must fall back to the just-recorded cue instead of blanking out', async () => {
    const adapter = makeFakeAdapter({ t: 0 })
    const fake = makeFakeRecorder()
    const postStt = vi.fn(async () => ({ status: 200, text: 'hello world' }))
    const ws = mkWs()

    const { result, rerender } = renderHook(
      (props: { activeIndex: number }) =>
        useShadowV1(adapter, 'vidA', CUES, props.activeIndex, ws, { createRecorder: fake.factory, postStt }),
      { initialProps: { activeIndex: 0 } },
    )

    await act(async () => { await result.current.startRecording() })
    adapter._setTime(2)
    await act(async () => { result.current.stopRecording(); await Promise.resolve(); await Promise.resolve() })
    expect(result.current.phase).toBe('result')

    // Simulates useSubtitles' rAF tick recomputing activeIndex=-1 once the AB
    // loop's boundary-pause lands currentTime at/after the cue's exclusive end.
    rerender({ activeIndex: -1 })
    expect(result.current.referenceText).toBe('hello world') // fallback, not blank
    expect(result.current.cueIndex).toBe(0)

    // "Записать" must work without requiring dismissResult first.
    await act(async () => { await result.current.startRecording() })
    expect(result.current.phase).toBe('recording')
    expect(fake.recorder.start).toHaveBeenCalledTimes(2)

    adapter._setTime(4)
    await act(async () => { result.current.stopRecording(); await Promise.resolve(); await Promise.resolve() })
    expect(result.current.phase).toBe('result')
    // The first result moved into history; this is attempt #2 for the same cue.
    expect(result.current.shadowAttempts['0'].attempts).toHaveLength(2)
  })

  it('Ф1 bug #2: the fallback stops applying once the result is dismissed (phase idle) — referenceText/cueIndex go back to blank while no live cue is active', async () => {
    const adapter = makeFakeAdapter({ t: 0 })
    const fake = makeFakeRecorder()
    const postStt = vi.fn(async () => ({ status: 200, text: 'hello world' }))
    const { result, rerender } = renderHook(
      (props: { activeIndex: number }) =>
        useShadowV1(adapter, 'vidA', CUES, props.activeIndex, mkWs(), { createRecorder: fake.factory, postStt }),
      { initialProps: { activeIndex: 0 } },
    )
    await act(async () => { await result.current.startRecording() })
    await act(async () => { result.current.stopRecording(); await Promise.resolve(); await Promise.resolve() })
    rerender({ activeIndex: -1 })
    expect(result.current.referenceText).toBe('hello world')

    act(() => { result.current.dismissResult() })
    expect(result.current.phase).toBe('idle')
    expect(result.current.referenceText).toBe('')
    expect(result.current.cueIndex).toBe(-1)
  })

  it('Ф1 bug #2: a live cue still wins over the fallback (user scrubbed onto a real different cue while sitting in result)', async () => {
    const adapter = makeFakeAdapter({ t: 0 })
    const fake = makeFakeRecorder()
    const postStt = vi.fn(async () => ({ status: 200, text: 'hello world' }))
    const { result, rerender } = renderHook(
      (props: { activeIndex: number }) =>
        useShadowV1(adapter, 'vidA', CUES, props.activeIndex, mkWs(), { createRecorder: fake.factory, postStt }),
      { initialProps: { activeIndex: 0 } },
    )
    await act(async () => { await result.current.startRecording() })
    await act(async () => { result.current.stopRecording(); await Promise.resolve(); await Promise.resolve() })
    expect(result.current.phase).toBe('result')

    rerender({ activeIndex: 1 }) // a genuinely different, valid cue
    expect(result.current.referenceText).toBe('second cue')
    expect(result.current.cueIndex).toBe(1)
  })

  // ── Ре-ревью Ф1, находка #2 (гэп-гард фолбэка) ──

  it('re-review Ф1 #2: scrubbing into a FAR inter-cue gap after a result must NOT resurrect the stale fallback (adapter.currentTime() far outside the snapshot range) — Record stays blocked (no_speech), referenceText/cueIndex stay blank', async () => {
    const adapter = makeFakeAdapter({ t: 0 })
    const fake = makeFakeRecorder()
    const postStt = vi.fn(async () => ({ status: 200, text: 'hello world' }))
    const { result, rerender } = renderHook(
      (props: { activeIndex: number }) =>
        useShadowV1(adapter, 'vidA', CUES, props.activeIndex, mkWs(), { createRecorder: fake.factory, postStt }),
      { initialProps: { activeIndex: 0 } },
    )

    await act(async () => { await result.current.startRecording() }) // snapshot start=0
    adapter._setTime(2)
    await act(async () => { result.current.stopRecording(); await Promise.resolve(); await Promise.resolve() })
    expect(result.current.phase).toBe('result') // snapshot range: [0, 2]

    // User scrubs into an unrelated GAP far from the recorded segment (live
    // cue -1, not the boundary-pause the bug-2 fix targeted) — e.g. jumps to 50s.
    adapter._setTime(50)
    rerender({ activeIndex: -1 })

    expect(result.current.referenceText).toBe('') // guard blocks the stale fallback
    expect(result.current.cueIndex).toBe(-1)

    await act(async () => { await result.current.startRecording() })
    expect(result.current.phase).toBe('error')
    expect(result.current.errorCode).toBe('no_speech')
    expect(fake.recorder.start).toHaveBeenCalledTimes(1) // second attempt never reached recorder.start
  })

  it('re-review Ф1 #2: scrubbing to the EDGE of the just-recorded range (within 0.75s tolerance) still lets the fallback apply — same boundary-pause shape bug-2 already fixed', async () => {
    const adapter = makeFakeAdapter({ t: 0 })
    const fake = makeFakeRecorder()
    const postStt = vi.fn(async () => ({ status: 200, text: 'hello world' }))
    const { result, rerender } = renderHook(
      (props: { activeIndex: number }) =>
        useShadowV1(adapter, 'vidA', CUES, props.activeIndex, mkWs(), { createRecorder: fake.factory, postStt }),
      { initialProps: { activeIndex: 0 } },
    )

    await act(async () => { await result.current.startRecording() }) // snapshot start=0
    adapter._setTime(2)
    await act(async () => { result.current.stopRecording(); await Promise.resolve(); await Promise.resolve() })
    expect(result.current.phase).toBe('result') // snapshot range: [0, 2]

    // Boundary-pause imprecision settles just past the recorded end (well
    // within the 0.75s tolerance) — findActiveCueIndex flips to -1.
    adapter._setTime(2.5)
    rerender({ activeIndex: -1 })

    expect(result.current.referenceText).toBe('hello world') // fallback still applies
    expect(result.current.cueIndex).toBe(0)

    await act(async () => { await result.current.startRecording() })
    expect(result.current.phase).toBe('recording')
    expect(fake.recorder.start).toHaveBeenCalledTimes(2)
  })

  it('Ф1 bug #3: recordAudioUrl lifecycle is exactly-once per attempt under React.StrictMode — createObjectURL fires once per finalize, the PRIOR url is revoked exactly once when superseded, and never before (root cause: the old inline setState-updater mint/revoke was impure and double-invoked under StrictMode; re-review Ф1 #3a: this test used to render WITHOUT StrictMode, so it never actually exercised the double-invoke path it claims to guard against — the `wrapper` below makes React 18 dev-mode invoke state-updater functions twice, same as a real app boot; mutate the effect back into an impure setState-updater and this test fails, see git history of this commit for the mutation transcript)', async () => {
    const adapter = makeFakeAdapter()
    const fake = makeFakeRecorder()
    const postStt = vi.fn(async () => ({ status: 200, text: 'hello world' }))
    const { result } = renderHook(() =>
      useShadowV1(adapter, 'vidA', CUES, 0, mkWs(), { createRecorder: fake.factory, postStt }),
      { wrapper: ({ children }) => createElement(StrictMode, null, children) })

    const createSpy = vi.mocked(URL.createObjectURL)
    const revokeSpy = vi.mocked(URL.revokeObjectURL)
    createSpy.mockClear(); revokeSpy.mockClear()

    await act(async () => { await result.current.startRecording() })
    await act(async () => { result.current.stopRecording(); await Promise.resolve(); await Promise.resolve() })
    const url1 = result.current.recordAudioUrl
    expect(url1).toBeTruthy()
    expect(createSpy).toHaveBeenCalledTimes(1)
    expect(revokeSpy).not.toHaveBeenCalled() // nothing to supersede yet

    await act(async () => { await result.current.startRecording() })
    await act(async () => { result.current.stopRecording(); await Promise.resolve(); await Promise.resolve() })
    const url2 = result.current.recordAudioUrl
    expect(url2).toBeTruthy()
    expect(url2).not.toBe(url1)
    expect(createSpy).toHaveBeenCalledTimes(2)
    expect(revokeSpy).toHaveBeenCalledTimes(1)
    expect(revokeSpy).toHaveBeenCalledWith(url1) // exactly the superseded one, not url2
  })

  it('deleteRecording removes the entry from recordings and from shadowAttempts', async () => {
    const adapter = makeFakeAdapter()
    const fake = makeFakeRecorder()
    const postStt = vi.fn(async () => ({ status: 200, text: 'hello world' }))
    const { result } = renderHook(() =>
      useShadowV1(adapter, 'vidB', CUES, 0, mkWs(), { createRecorder: fake.factory, postStt }))
    await act(async () => { await result.current.startRecording() })
    await act(async () => { result.current.stopRecording(); await Promise.resolve(); await Promise.resolve() })
    const id = result.current.recordings[0].id
    expect(result.current.shadowAttempts['0'].attempts).toHaveLength(1)

    act(() => { result.current.deleteRecording(id) })
    expect(result.current.recordings).toHaveLength(0)
    expect(result.current.shadowAttempts['0']?.attempts ?? []).toHaveLength(0)
  })
})
