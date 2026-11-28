// useShadowMicStream.test.ts — TDD tests for S3-10 (phase ii, LAST build
// task): mic→PCM→WS wiring into RealtimeAnswerSource. ALL tests run with a
// MOCK pipelineFactory (DI seam, mirrors shadow-recorder.test.ts) — jsdom has
// no getUserMedia and the barrier forbids a real mic/gateway in tests. The
// answerSource is a plain mock object (pushAudio/closeSession/dispose spies +
// a no-op awaitAnswerByBoundary to satisfy the `AnswerSource` type) — never a
// real RealtimeAnswerSource/WebSocket.
//
// 7 required cases (brief §Тесты) + 3 extra hardening cases (Pre-Write
// Protocol edge coverage: getUserMedia denial doesn't crash/retry-blocks
// forever; a fast unarm-during-open never leaks the resolved stream; the
// structural sink-guard is a real second gate, not decoration).
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useShadowMicStream } from '../useShadowMicStream'
import type { AudioPipeline } from '../../workspace/audio-pipeline'
import type { AnswerOutcome } from '../../workspace/answer-source'

function makeMockSink() {
  return {
    awaitAnswerByBoundary: vi.fn(async (): Promise<AnswerOutcome> => ({ status: 'timeout' })),
    pushAudio: vi.fn(),
    closeSession: vi.fn(),
    suspendSession: vi.fn(), // ТЗ №4 [ID:P-tz4-fix HIGH-2]: soft-pause seam
    dispose: vi.fn(),
  }
}

function makeMockPipeline(overrides?: Partial<AudioPipeline>): AudioPipeline {
  return {
    audioContext: {} as AudioContext,
    analyserNode: {} as AnalyserNode,
    stream: { getTracks: () => [] } as unknown as MediaStream,
    close: vi.fn(),
    ...overrides,
  }
}

// Flush the microtask queue inside `act` so a resolved/rejected pipeline
// factory promise's `.then`/`.catch` has run before the next assertion —
// mirrors the `await act(async () => { ...; await Promise.resolve() })`
// idiom already used across this repo's hook tests (useShadowV1.test.ts).
async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}

describe('useShadowMicStream', () => {
  it('(1) обычный юзер (armedSegmentId=null) → pipelineFactory/getUserMedia НЕ вызывается', async () => {
    const sink = makeMockSink()
    const factory = vi.fn(async () => makeMockPipeline())

    const { rerender } = renderHook(
      (props: { armed: string | null }) => useShadowMicStream({
        armedSegmentId: () => props.armed,
        answerSource: sink,
        realtimeEnabled: true,
        timelineCollapsed: false,
        micConsentGranted: true,
        transmitEnabled: true,
        pipelineFactory: factory,
      }),
      { initialProps: { armed: null as string | null } },
    )
    await flush()
    act(() => { rerender({ armed: null }) })
    await flush()

    expect(factory).not.toHaveBeenCalled()
    expect(sink.pushAudio).not.toHaveBeenCalled()
  })

  it('(2) арм (armedSegmentId→exId) в realtime → pipeline открыт, чанки → pushAudio(exId, Int16Array) верного формата', async () => {
    const sink = makeMockSink()
    const pipeline = makeMockPipeline()
    let capturedOnChunk: ((b: ArrayBuffer) => void) | null = null
    const factory = vi.fn(async (onChunk: (b: ArrayBuffer) => void) => {
      capturedOnChunk = onChunk
      return pipeline
    })

    const { rerender } = renderHook(
      (props: { armed: string | null }) => useShadowMicStream({
        armedSegmentId: () => props.armed,
        answerSource: sink,
        realtimeEnabled: true,
        timelineCollapsed: false,
        micConsentGranted: true,
        transmitEnabled: true,
        pipelineFactory: factory,
      }),
      { initialProps: { armed: null as string | null } },
    )
    await flush()
    act(() => { rerender({ armed: 'ex1' }) })
    await flush()

    expect(factory).toHaveBeenCalledTimes(1)
    expect(capturedOnChunk).not.toBeNull()

    const samples = new Int16Array([1, -2, 3, 32767, -32768])
    act(() => { capturedOnChunk!(samples.buffer) })

    expect(sink.pushAudio).toHaveBeenCalledTimes(1)
    const [exId, pcm] = sink.pushAudio.mock.calls[0] as [string, Int16Array]
    expect(exId).toBe('ex1')
    expect(pcm).toBeInstanceOf(Int16Array)
    expect(Array.from(pcm)).toEqual([1, -2, 3, 32767, -32768])
  })

  it('(3) разарм (→null) → pipeline остановлен + closeSession вызван (нет живого стрима)', async () => {
    const sink = makeMockSink()
    const pipeline = makeMockPipeline()
    const factory = vi.fn(async () => pipeline)

    const { rerender } = renderHook(
      (props: { armed: string | null }) => useShadowMicStream({
        armedSegmentId: () => props.armed,
        answerSource: sink,
        realtimeEnabled: true,
        timelineCollapsed: false,
        micConsentGranted: true,
        transmitEnabled: true,
        pipelineFactory: factory,
      }),
      { initialProps: { armed: 'ex1' as string | null } },
    )
    await flush()
    expect(factory).toHaveBeenCalledTimes(1)

    act(() => { rerender({ armed: null }) })
    await flush()

    expect(pipeline.close).toHaveBeenCalledTimes(1)
    expect(sink.closeSession).toHaveBeenCalledWith('ex1')
    expect(sink.dispose).not.toHaveBeenCalled() // unarm ≠ unmount — dispose is unmount-only
  })

  it('(3b) [Срез A п.6] onAnalyser — вызывается с pipeline.analyserNode на открытии мика и с null на закрытии пайплайна (unarm)', async () => {
    const sink = makeMockSink()
    const analyser = { id: 'analyser' } as unknown as AnalyserNode
    const pipeline = makeMockPipeline({ analyserNode: analyser })
    const factory = vi.fn(async () => pipeline)
    const onAnalyser = vi.fn()

    const { rerender } = renderHook(
      (props: { armed: string | null }) => useShadowMicStream({
        armedSegmentId: () => props.armed,
        answerSource: sink,
        realtimeEnabled: true,
        timelineCollapsed: false,
        micConsentGranted: true,
        transmitEnabled: true,
        pipelineFactory: factory,
        onAnalyser,
      }),
      { initialProps: { armed: 'ex1' as string | null } },
    )
    await flush()
    // мик открыт → карте передан живой AnalyserNode (осциллограф оживает).
    expect(onAnalyser).toHaveBeenCalledWith(analyser)

    onAnalyser.mockClear()
    act(() => { rerender({ armed: null }) })
    await flush()
    // мик закрыт → onAnalyser(null) (осциллограф гаснет, «нас больше не слушают»).
    expect(onAnalyser).toHaveBeenCalledWith(null)
  })

  it('(4) unmount → pipeline остановлен + dispose (carry S3-9)', async () => {
    const sink = makeMockSink()
    const pipeline = makeMockPipeline()
    const factory = vi.fn(async () => pipeline)

    const { unmount } = renderHook(
      () => useShadowMicStream({
        armedSegmentId: () => 'ex1',
        answerSource: sink,
        realtimeEnabled: true,
        timelineCollapsed: false,
        micConsentGranted: true,
        transmitEnabled: true,
        pipelineFactory: factory,
      }),
    )
    await flush()
    expect(factory).toHaveBeenCalledTimes(1)

    act(() => { unmount() })

    expect(pipeline.close).toHaveBeenCalledTimes(1)
    expect(sink.dispose).toHaveBeenCalledTimes(1)
  })

  it('(5) collapse таймлайна → мик остановлен (privacy), даже когда всё ещё armed', async () => {
    const sink = makeMockSink()
    const pipeline = makeMockPipeline()
    const factory = vi.fn(async () => pipeline)

    const { rerender } = renderHook(
      (props: { armed: string | null; collapsed: boolean }) => useShadowMicStream({
        armedSegmentId: () => props.armed,
        answerSource: sink,
        realtimeEnabled: true,
        timelineCollapsed: props.collapsed,
        micConsentGranted: true,
        transmitEnabled: true,
        pipelineFactory: factory,
      }),
      { initialProps: { armed: 'ex1' as string | null, collapsed: false } },
    )
    await flush()
    expect(factory).toHaveBeenCalledTimes(1)

    act(() => { rerender({ armed: 'ex1', collapsed: true }) })
    await flush()

    expect(pipeline.close).toHaveBeenCalledTimes(1)
    expect(sink.closeSession).toHaveBeenCalledWith('ex1')

    // Re-opening the timeline while still armed re-opens a FRESH pipeline —
    // privacy release on collapse is unconditional, arm is untouched.
    act(() => { rerender({ armed: 'ex1', collapsed: false }) })
    await flush()
    expect(factory).toHaveBeenCalledTimes(2)
  })

  it('(6) Fake-режим (realtimeEnabled=false) → pipeline НЕ создаётся, даже когда armed', async () => {
    const sink = makeMockSink()
    const factory = vi.fn(async () => makeMockPipeline())

    const { rerender } = renderHook(
      (props: { armed: string | null }) => useShadowMicStream({
        armedSegmentId: () => props.armed,
        answerSource: sink,
        realtimeEnabled: false,
        timelineCollapsed: false,
        micConsentGranted: true,
        transmitEnabled: true,
        pipelineFactory: factory,
      }),
      { initialProps: { armed: 'ex1' as string | null } },
    )
    await flush()
    act(() => { rerender({ armed: 'ex2' }) })
    await flush()

    expect(factory).not.toHaveBeenCalled()
    expect(sink.pushAudio).not.toHaveBeenCalled()
    expect(sink.closeSession).not.toHaveBeenCalled()
  })

  it('(7) смена exId (ex1→ex2 напрямую) → старая сессия закрыта, новая открыта', async () => {
    const sink = makeMockSink()
    const pipeline1 = makeMockPipeline()
    const pipeline2 = makeMockPipeline()
    const onChunks: Array<(b: ArrayBuffer) => void> = []
    let calls = 0
    const factory = vi.fn(async (onChunk: (b: ArrayBuffer) => void) => {
      onChunks.push(onChunk)
      calls += 1
      return calls === 1 ? pipeline1 : pipeline2
    })

    const { rerender } = renderHook(
      (props: { armed: string | null }) => useShadowMicStream({
        armedSegmentId: () => props.armed,
        answerSource: sink,
        realtimeEnabled: true,
        timelineCollapsed: false,
        micConsentGranted: true,
        transmitEnabled: true,
        pipelineFactory: factory,
      }),
      { initialProps: { armed: 'ex1' as string | null } },
    )
    await flush()
    expect(factory).toHaveBeenCalledTimes(1)

    act(() => { rerender({ armed: 'ex2' }) })
    await flush()

    expect(pipeline1.close).toHaveBeenCalledTimes(1)
    expect(sink.closeSession).toHaveBeenCalledWith('ex1')
    expect(factory).toHaveBeenCalledTimes(2)
    expect(pipeline2.close).not.toHaveBeenCalled()

    act(() => { rerender({ armed: 'ex2' }) })
    const samples = new Int16Array([7])
    // the onChunk captured on the SECOND open must push under 'ex2'
    expect(onChunks).toHaveLength(2)
    act(() => { onChunks[1](samples.buffer) })
    expect(sink.pushAudio).toHaveBeenCalledWith('ex2', expect.any(Int16Array))
  })

  it('(8) getUserMedia denial does not crash and releases the reservation so a later re-arm retries', async () => {
    const sink = makeMockSink()
    const pipeline = makeMockPipeline()
    let attempt = 0
    const factory = vi.fn(async () => {
      attempt += 1
      if (attempt === 1) throw Object.assign(new Error('denied'), { name: 'NotAllowedError' })
      return pipeline
    })

    const { rerender } = renderHook(
      (props: { armed: string | null }) => useShadowMicStream({
        armedSegmentId: () => props.armed,
        answerSource: sink,
        realtimeEnabled: true,
        timelineCollapsed: false,
        micConsentGranted: true,
        transmitEnabled: true,
        pipelineFactory: factory,
      }),
      { initialProps: { armed: 'ex1' as string | null } },
    )
    await flush()
    expect(factory).toHaveBeenCalledTimes(1)
    expect(sink.pushAudio).not.toHaveBeenCalled()

    // Unarm then re-arm the SAME id — must retry (reservation was released on denial).
    act(() => { rerender({ armed: null }) })
    await flush()
    act(() => { rerender({ armed: 'ex1' }) })
    await flush()

    expect(factory).toHaveBeenCalledTimes(2)
  })

  it('(9) fast unarm while getUserMedia is still pending → resolved pipeline is closed immediately, never leaks', async () => {
    const sink = makeMockSink()
    const pipeline = makeMockPipeline()
    let resolveFactory: ((p: AudioPipeline) => void) | null = null
    const factory = vi.fn(() => new Promise<AudioPipeline>((resolve) => { resolveFactory = resolve }))

    const { rerender } = renderHook(
      (props: { armed: string | null }) => useShadowMicStream({
        armedSegmentId: () => props.armed,
        answerSource: sink,
        realtimeEnabled: true,
        timelineCollapsed: false,
        micConsentGranted: true,
        transmitEnabled: true,
        pipelineFactory: factory,
      }),
      { initialProps: { armed: 'ex1' as string | null } },
    )
    await flush()
    expect(factory).toHaveBeenCalledTimes(1)

    // Unarm BEFORE the pipeline resolves. The exId was reserved SYNCHRONOUSLY
    // at open time (race guard), so the session tears down immediately —
    // closeSession('ex1') fires right away even though the mic pipeline
    // itself hasn't finished initializing yet.
    act(() => { rerender({ armed: null }) })
    await flush()
    expect(sink.closeSession).toHaveBeenCalledWith('ex1')
    expect(pipeline.close).not.toHaveBeenCalled() // pipeline hasn't resolved yet — nothing to close

    // Now the getUserMedia promise resolves late — the stream must be closed
    // on arrival (superseded), never stored/leaked, and never pushed into.
    await act(async () => { resolveFactory!(pipeline); await Promise.resolve(); await Promise.resolve() })

    expect(pipeline.close).toHaveBeenCalledTimes(1)
    expect(sink.pushAudio).not.toHaveBeenCalled()
  })

  it('(10) structural sink-guard is a real second gate: a non-sink answerSource never opens a pipeline even if realtimeEnabled were true', async () => {
    const fakeLikeAnswerSource = {
      awaitAnswerByBoundary: vi.fn(async (): Promise<AnswerOutcome> => ({ status: 'timeout' })),
      // no pushAudio/closeSession/dispose — structurally NOT an AudioSink (FakeAnswerSource shape)
    }
    const factory = vi.fn(async () => makeMockPipeline())

    const { rerender } = renderHook(
      (props: { armed: string | null }) => useShadowMicStream({
        armedSegmentId: () => props.armed,
        answerSource: fakeLikeAnswerSource,
        realtimeEnabled: true,
        timelineCollapsed: false,
        micConsentGranted: true,
        transmitEnabled: true,
        pipelineFactory: factory,
      }),
      { initialProps: { armed: 'ex1' as string | null } },
    )
    await flush()
    act(() => { rerender({ armed: 'ex1' }) })
    await flush()

    expect(factory).not.toHaveBeenCalled()
  })

  // ── S3-10-fix: two HIGH + one MED mic-privacy leaks from double review ──

  it('(11) [FIX #1] разарм БЕЗ ре-рендера → независимый poll закрывает мик + closeSession', async () => {
    // The coordinator's apply()/exerciseAhead path nulls the arm WITHOUT any
    // setState (useShadowLoopCoordinator.ts:565), so on pause PlayerPage never
    // re-renders → the no-deps render effect never re-runs. Only a
    // React-independent poll can catch the unarm and release the mic.
    // Pre-fix: with no poll, the pipeline stays open forever here (pipeline.close
    // count == 0, closeSession never called) → this test fails.
    vi.useFakeTimers()
    try {
      const sink = makeMockSink()
      const pipeline = makeMockPipeline()
      const factory = vi.fn(async () => pipeline)
      let armed: string | null = 'ex1'

      renderHook(() => useShadowMicStream({
        armedSegmentId: () => armed, // MUTABLE getter — flips WITHOUT a rerender()
        answerSource: sink,
        realtimeEnabled: true,
        timelineCollapsed: false,
        micConsentGranted: true,
        transmitEnabled: true,
        pipelineFactory: factory,
      }))
      // flush the initial open's factory promise (microtasks, not timers)
      await act(async () => { await Promise.resolve(); await Promise.resolve() })
      expect(factory).toHaveBeenCalledTimes(1)

      // Coordinator unarms with NO React render at all.
      armed = null

      // No rerender()/act-rerender — only the independent poll can react.
      await act(async () => { await vi.advanceTimersByTimeAsync(150) })

      expect(pipeline.close).toHaveBeenCalledTimes(1)
      expect(sink.closeSession).toHaveBeenCalledWith('ex1')
    } finally {
      vi.useRealTimers()
    }
  })

  it('(12) [FIX #2] ABA на СТРОКЕ exId (collapse→uncollapse тот же ex1 при pending getUserMedia) → осиротевший stream остановлен, один живой pipeline', async () => {
    // Two pending opens for the SAME string id. Pre-fix the resolve guard
    // compared openExIdRef (a string) which is equal for both → the first
    // pipeline gets stored, then the second overwrites pipelineRef WITHOUT
    // close() → orphaned stream, tracks never stopped. The monotonic seq token
    // makes the older open's late resolve stale → it must close its own stream.
    const sink = makeMockSink()
    const pipelineA = makeMockPipeline()
    const pipelineB = makeMockPipeline()
    const resolvers: Array<(p: AudioPipeline) => void> = []
    const factory = vi.fn(() => new Promise<AudioPipeline>((res) => { resolvers.push(res) }))

    const { rerender } = renderHook(
      (props: { collapsed: boolean }) => useShadowMicStream({
        armedSegmentId: () => 'ex1', // SAME id throughout — ABA is on the string
        answerSource: sink,
        realtimeEnabled: true,
        timelineCollapsed: props.collapsed,
        micConsentGranted: true,
        transmitEnabled: true,
        pipelineFactory: factory,
      }),
      { initialProps: { collapsed: false } },
    )
    await flush()
    expect(factory).toHaveBeenCalledTimes(1) // open #1 (ex1), still pending

    // A → B → A on the same id: collapse (mic-unarm) then uncollapse (re-arm ex1).
    act(() => { rerender({ collapsed: true }) })
    await flush()
    act(() => { rerender({ collapsed: false }) })
    await flush()
    expect(factory).toHaveBeenCalledTimes(2) // open #2 (ex1), still pending

    // Resolve BOTH opens — the stale (older) generation first.
    await act(async () => {
      resolvers[0](pipelineA) // superseded generation → must be closed, never stored
      resolvers[1](pipelineB) // current generation → the single live pipeline
      await Promise.resolve(); await Promise.resolve()
    })

    expect(pipelineA.close).toHaveBeenCalledTimes(1) // orphan stream stopped
    expect(pipelineB.close).not.toHaveBeenCalled()   // exactly one live pipeline
  })

  it('(13) [FIX #3] denial при живом арме → один-выстрел-на-арм (повторные коммиты НЕ ретраят getUserMedia)', async () => {
    // Pre-fix: catch released the reservation, so every subsequent commit (the
    // ~250ms playback loop) saw the null→ex1 transition again and re-prompted
    // getUserMedia — a permission-storm. One-shot marks the denied arm and
    // stops retrying until the arm changes.
    const sink = makeMockSink()
    const factory = vi.fn(async () => { throw Object.assign(new Error('denied'), { name: 'NotAllowedError' }) })

    const { rerender } = renderHook(() => useShadowMicStream({
      armedSegmentId: () => 'ex1', // arm stays ex1 across every commit
      answerSource: sink,
      realtimeEnabled: true,
      timelineCollapsed: false,
      micConsentGranted: true,
      transmitEnabled: true,
      pipelineFactory: factory,
    }))
    await flush()
    expect(factory).toHaveBeenCalledTimes(1) // one prompt

    // Simulate repeated PlayerPage commits (video-clock ticks) — arm unchanged.
    for (let i = 0; i < 5; i++) {
      act(() => { rerender() })
      await flush()
    }
    expect(factory).toHaveBeenCalledTimes(1) // STILL one — one-shot per arm
  })

  it('(14) [consent] armed + realtime + not collapsed but micConsentGranted=false → pipeline NOT opened', async () => {
    // Owner decision 2026-07-10: an autostart arm must not silently open the mic.
    // The consent arg is a fourth reconcile gate — false keeps the pipeline shut
    // even though every OTHER gate (arm/realtime/collapse) says "open".
    // MUTATION GATE: drop micConsentGranted from the reconcile `wantExId` gate
    // (useShadowMicStream.ts) and this goes red (factory would be called).
    const sink = makeMockSink()
    const factory = vi.fn(async () => makeMockPipeline())

    const { rerender } = renderHook(
      (props: { armed: string | null }) => useShadowMicStream({
        armedSegmentId: () => props.armed,
        answerSource: sink,
        realtimeEnabled: true,
        timelineCollapsed: false,
        micConsentGranted: false,
        transmitEnabled: true,
        pipelineFactory: factory,
      }),
      { initialProps: { armed: 'ex1' as string | null } },
    )
    await flush()
    act(() => { rerender({ armed: 'ex1' }) })
    await flush()

    expect(factory).not.toHaveBeenCalled()
    expect(sink.pushAudio).not.toHaveBeenCalled()
  })

  it('(15) [consent] false→true flip while armed → pipeline opens on the next commit', async () => {
    // User taps "Начать" → PlayerPage flips micConsentGranted true; the no-deps
    // render-effect reconcile opens the mic for the still-armed exercise.
    const sink = makeMockSink()
    const pipeline = makeMockPipeline()
    const factory = vi.fn(async () => pipeline)

    const { rerender } = renderHook(
      (props: { granted: boolean }) => useShadowMicStream({
        armedSegmentId: () => 'ex1',
        answerSource: sink,
        realtimeEnabled: true,
        timelineCollapsed: false,
        micConsentGranted: props.granted,
        transmitEnabled: true,
        pipelineFactory: factory,
      }),
      { initialProps: { granted: false } },
    )
    await flush()
    expect(factory).not.toHaveBeenCalled() // still gated shut

    act(() => { rerender({ granted: true }) }) // "Начать"
    await flush()
    expect(factory).toHaveBeenCalledTimes(1) // mic opens exactly once
  })

  it('(16) [consent] Fake-режим ignores consent: false stays closed regardless', async () => {
    // realtimeEnabled=false short-circuits before consent — a dormant/Fake user
    // never opens a pipeline no matter the consent value (belt-and-suspenders).
    const sink = makeMockSink()
    const factory = vi.fn(async () => makeMockPipeline())

    renderHook(() => useShadowMicStream({
      armedSegmentId: () => 'ex1',
      answerSource: sink,
      realtimeEnabled: false,
      timelineCollapsed: false,
      micConsentGranted: true,
      transmitEnabled: true,
      pipelineFactory: factory,
    }))
    await flush()
    expect(factory).not.toHaveBeenCalled()
  })

  // ── ТЗ №4 п.3: пауза видео = стоп аудио-стрима (transmitEnabled гейт) ──

  it('(17a) [ТЗ №4 HIGH-2] пауза (transmitEnabled true→false) при живом арме → pipeline закрыт + suspendSession (МЯГКО, НЕ closeSession), арм НЕ тронут', async () => {
    // Юзер жмёт паузу mid-петли → перестаём жечь токены. Пайплайн закрывается,
    // но WS-сессию гасим МЯГКО через suspendSession (HIGH-2): closeSession сделал
    // бы gates.delete + resolveAll + потерю latestFinal ⇒ dead-quota воскресала
    // бы на каждый pause/play. armedSegmentId() продолжает возвращать ex1 (хук НЕ
    // трогает координаторский арм: пауза≠разарм). dispose НЕ зовётся (не unmount).
    // МУТАЦИЯ: убрать transmitEnabled из reconcile-гейта → red (pipeline.close не
    // вызовется). МУТАЦИЯ-2: вернуть closeSession на transmit-пути → h2-a red.
    const sink = makeMockSink()
    const pipeline = makeMockPipeline()
    const factory = vi.fn(async () => pipeline)
    const armed = () => 'ex1' // арм НЕИЗМЕНЕН всю дорогу

    const { rerender } = renderHook(
      (props: { transmit: boolean }) => useShadowMicStream({
        armedSegmentId: armed,
        answerSource: sink,
        realtimeEnabled: true,
        timelineCollapsed: false,
        micConsentGranted: true,
        transmitEnabled: props.transmit,
        pipelineFactory: factory,
      }),
      { initialProps: { transmit: true } },
    )
    await flush()
    expect(factory).toHaveBeenCalledTimes(1) // играем → мик открыт

    act(() => { rerender({ transmit: false }) }) // ПАУЗА
    await flush()

    expect(pipeline.close).toHaveBeenCalledTimes(1)        // стрим прекращён
    expect(sink.suspendSession).toHaveBeenCalledWith('ex1') // МЯГКАЯ пауза WS-сессии
    expect(sink.closeSession).not.toHaveBeenCalled()        // НЕ жёсткое закрытие
    expect(sink.dispose).not.toHaveBeenCalled()             // пауза ≠ unmount
    expect(armed()).toBe('ex1')                             // арм координатора жив
  })

  it('(17b) [ТЗ №4] возобновление (transmitEnabled false→true, арм тот же) → reconcile ПЕРЕоткрывает пайплайн (consent уже granted, без промпта)', async () => {
    const sink = makeMockSink()
    const pipeline1 = makeMockPipeline()
    const pipeline2 = makeMockPipeline()
    let n = 0
    const factory = vi.fn(async () => { n += 1; return n === 1 ? pipeline1 : pipeline2 })

    const { rerender } = renderHook(
      (props: { transmit: boolean }) => useShadowMicStream({
        armedSegmentId: () => 'ex1',
        answerSource: sink,
        realtimeEnabled: true,
        timelineCollapsed: false,
        micConsentGranted: true, // consent уже дан — переоткрытие без промпта
        transmitEnabled: props.transmit,
        pipelineFactory: factory,
      }),
      { initialProps: { transmit: true } },
    )
    await flush()
    expect(factory).toHaveBeenCalledTimes(1)

    act(() => { rerender({ transmit: false }) }) // пауза
    await flush()
    expect(pipeline1.close).toHaveBeenCalledTimes(1)

    act(() => { rerender({ transmit: true }) })  // play
    await flush()
    expect(factory).toHaveBeenCalledTimes(2)      // свежий пайплайн переоткрыт
    expect(pipeline2.close).not.toHaveBeenCalled()
  })

  it('(17c) [ТЗ №4] transmitEnabled=false фейл-клоуз: НИКОГДА не открывает мик, даже когда всё остальное says open', async () => {
    // Симметрия с consent-гейтом (14): transmit — независимый reconcile-гейт.
    const sink = makeMockSink()
    const factory = vi.fn(async () => makeMockPipeline())

    const { rerender } = renderHook(
      (props: { armed: string | null }) => useShadowMicStream({
        armedSegmentId: () => props.armed,
        answerSource: sink,
        realtimeEnabled: true,
        timelineCollapsed: false,
        micConsentGranted: true,
        transmitEnabled: false, // пауза с самого начала
        pipelineFactory: factory,
      }),
      { initialProps: { armed: 'ex1' as string | null } },
    )
    await flush()
    act(() => { rerender({ armed: 'ex1' }) })
    await flush()

    expect(factory).not.toHaveBeenCalled()
    expect(sink.pushAudio).not.toHaveBeenCalled()
  })

  it('(18) [MED-5 ТЗ №4] denial one-shot ПЕРЕЖИВАЕТ pause/play (transmit false→true) — арм тот же → НЕ ре-промпт getUserMedia', async () => {
    // Баг: reset denial был завязан на wantExId. Пауза (transmit false) делает
    // wantExId=null (≠ deniedExId 'ex1') → denial сбрасывался → play (transmit
    // true) снова видел null→ex1 и РЕ-промптил getUserMedia на каждый pause/play.
    // Фикс: сброс denial только на смену АРМА (armedSegmentId), не транзиентных
    // гейтов. МУТАЦИЯ: вернуть сравнение с wantExId → factory вызвана 2 раза → red.
    const sink = makeMockSink()
    const factory = vi.fn(async () => { throw Object.assign(new Error('denied'), { name: 'NotAllowedError' }) })

    const { rerender } = renderHook(
      (props: { transmit: boolean }) => useShadowMicStream({
        armedSegmentId: () => 'ex1', // арм НЕИЗМЕНЕН
        answerSource: sink,
        realtimeEnabled: true,
        timelineCollapsed: false,
        micConsentGranted: true,
        transmitEnabled: props.transmit,
        pipelineFactory: factory,
      }),
      { initialProps: { transmit: true } },
    )
    await flush()
    expect(factory).toHaveBeenCalledTimes(1) // один промпт → denied, one-shot взведён

    act(() => { rerender({ transmit: false }) }) // пауза
    await flush()
    act(() => { rerender({ transmit: true }) })  // play — арм тот же ex1
    await flush()

    expect(factory).toHaveBeenCalledTimes(1) // one-shot пережил pause/play — НЕТ ре-промпта
  })

  it('(19) [MED-5 ТЗ №4] denial СБРАСЫВАЕТСЯ на реальной смене арма (ex1 denied → ex2) → ретрай', async () => {
    // Контроль к (18): сброс denial обязан случиться, когда АРМ реально сменился.
    const sink = makeMockSink()
    let n = 0
    const pipeline = makeMockPipeline()
    const factory = vi.fn(async () => {
      n += 1
      if (n === 1) throw Object.assign(new Error('denied'), { name: 'NotAllowedError' })
      return pipeline
    })

    const { rerender } = renderHook(
      (props: { armed: string }) => useShadowMicStream({
        armedSegmentId: () => props.armed,
        answerSource: sink,
        realtimeEnabled: true,
        timelineCollapsed: false,
        micConsentGranted: true,
        transmitEnabled: true,
        pipelineFactory: factory,
      }),
      { initialProps: { armed: 'ex1' } },
    )
    await flush()
    expect(factory).toHaveBeenCalledTimes(1) // ex1 denied

    act(() => { rerender({ armed: 'ex2' }) }) // арм сменился → denial неприменим
    await flush()
    expect(factory).toHaveBeenCalledTimes(2) // ретрай для ex2
  })
})
