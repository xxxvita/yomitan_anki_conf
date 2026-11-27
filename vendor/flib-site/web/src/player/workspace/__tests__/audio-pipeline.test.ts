// audio-pipeline.test.ts — WEB-SEAM regression: AudioWorklet must load from a
// static file ('/pcm16-worklet.js'), never a blob: URL, because prod CSP
// (script-src, main.go) has no `blob:` and silently breaks mic recording for
// real users (owner-reported live bug). jsdom has no real Web Audio API, so
// AudioContext/AudioWorkletNode/getUserMedia are all mocked here — this test
// exists purely to pin down the addModule() call site + processorOptions
// contract, and the getUserMedia-vs-rest error boundary.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const BUFFER_SIZE = 1600 // must match audio-pipeline.ts SAMPLE_RATE/BUFFER_SIZE contract

describe('createAudioPipeline', () => {
  let addModuleMock: ReturnType<typeof vi.fn>
  let getUserMediaMock: ReturnType<typeof vi.fn>
  let stopTrackMock: ReturnType<typeof vi.fn>
  let createdWorkletOptions: Array<{ processorOptions?: { bufferSize?: number } } | undefined>

  beforeEach(() => {
    addModuleMock = vi.fn(async () => {})
    stopTrackMock = vi.fn()
    createdWorkletOptions = []
    const fakeStream = {
      getTracks: () => [{ stop: stopTrackMock }],
    }
    getUserMediaMock = vi.fn(async () => fakeStream)
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia: getUserMediaMock },
    })

    class FakeAnalyserNode {
      fftSize = 0
      connect() {}
      disconnect() {}
    }
    class FakeAudioWorkletNode {
      port = { onmessage: null as ((e: MessageEvent) => void) | null }
      constructor(public ctx: unknown, public name: string, public options?: { processorOptions?: { bufferSize?: number } }) {
        createdWorkletOptions.push(options)
      }
      connect() {}
      disconnect() {}
    }
    class FakeAudioContext {
      audioWorklet = { addModule: addModuleMock }
      destination = {}
      constructor(public opts?: { sampleRate?: number }) {}
      createMediaStreamSource() { return { connect() {}, disconnect() {} } }
      createAnalyser() { return new FakeAnalyserNode() }
      close() {}
    }
    vi.stubGlobal('AudioContext', FakeAudioContext)
    vi.stubGlobal('AudioWorkletNode', FakeAudioWorkletNode)
  })

  afterEach(() => { vi.unstubAllGlobals() })

  it('loads the worklet from the static file, never a blob: URL', async () => {
    const { createAudioPipeline } = await import('../audio-pipeline')
    await createAudioPipeline(() => {})
    expect(addModuleMock).toHaveBeenCalledTimes(1)
    expect(addModuleMock).toHaveBeenCalledWith('/pcm16-worklet.js')
  })

  it('passes bufferSize=1600 via processorOptions (no template-string interpolation anymore)', async () => {
    const { createAudioPipeline } = await import('../audio-pipeline')
    await createAudioPipeline(() => {})
    expect(createdWorkletOptions).toHaveLength(1)
    expect(createdWorkletOptions[0]?.processorOptions?.bufferSize).toBe(BUFFER_SIZE)
  })

  it('getUserMedia rejection propagates AS-IS (no wrapping) — useShadowV1 maps this to mic_denied', async () => {
    const deniedErr = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' })
    getUserMediaMock.mockRejectedValueOnce(deniedErr)
    const { createAudioPipeline } = await import('../audio-pipeline')
    await expect(createAudioPipeline(() => {})).rejects.toBe(deniedErr)
    expect(addModuleMock).not.toHaveBeenCalled()
  })

  it('addModule failure (CSP-blocked blob or any other post-getUserMedia error) is tagged AudioInitError, mic stream is stopped', async () => {
    addModuleMock.mockRejectedValueOnce(Object.assign(new Error('Refused to load'), { name: 'SecurityError' }))
    const { createAudioPipeline, AudioInitError } = await import('../audio-pipeline')
    await expect(createAudioPipeline(() => {})).rejects.toBeInstanceOf(AudioInitError)
    // Cleanup: the already-acquired mic stream must not leak (indicator would
    // stay on forever otherwise) even though the pipeline never finished setup.
    expect(stopTrackMock).toHaveBeenCalledTimes(1)
  })
})
