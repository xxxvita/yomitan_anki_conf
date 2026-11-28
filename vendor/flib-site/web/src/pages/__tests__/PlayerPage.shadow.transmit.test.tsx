// PlayerPage.shadow.transmit.test.tsx — ТЗ №4 фикс-волна MED-6 [ID:P-tz4-fix]:
// живая связка PlayerPage → useShadowMicStream по `transmitEnabled`. Мутация
// «transmitEnabled: true» (константа) в PlayerPage выживала бы всю юнит-сьюту
// (computeShadowTransmitEnabled тестируется изолированно, а его РЕЗУЛЬТАТ никто
// не проверял на реальном шве). Этот интеграц-тест ловит именно шов: capture-мок
// useShadowMicStream записывает аргумент transmitEnabled, а мы гоняем play/pause
// видео и грейдинговую границу и проверяем, что он реально меняется.
//
// Harness — паттерн PlayerPage.shadow.consent.integration.test.tsx: fake adapter,
// realtime ON (гейт живой) но answerSource форсится в Fake, mic-hook = spy.
// Consent пред-сидируется 'granted' в sessionStorage → hands-free, без промпта.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PlayerPage } from '../PlayerPage'
import type { ShadowExerciseAnnotation } from '../../player/workspace/panel-types'
import { MIC_CONSENT_KEY } from '../../player/workspace/shadow-mic-consent'
import { type WorkspaceApi } from '../../player/hooks/useWorkspace'

const CUES = [
  { start: 0, end: 2, text_en: 'hello world', text_ru: 'привет мир' },
  { start: 2, end: 4, text_en: 'second cue', text_ru: 'вторая реплика' },
]
const VIDEO_ID = 'abc123XYZ_1'
const EXERCISE_KEY = `flib:shadow-exercises:${VIDEO_ID}`

const mockAdapterHolder = vi.hoisted(() => ({ adapter: null as any }))
const micWrap = vi.hoisted(() => ({ lastArgs: null as any }))
const wsWrap = vi.hoisted(() => ({ lastArgs: null as unknown[] | null }))
const rtWrap = vi.hoisted(() => ({ lastReturn: null as any }))

vi.mock('../../adapter/IFrameAdapter', () => ({
  createIFrameAdapter: async () => {
    const { makeFakeAdapter } = await import('../../adapter/__tests__/fake')
    mockAdapterHolder.adapter = makeFakeAdapter({ duration: 120, t: 1 })
    return mockAdapterHolder.adapter
  },
}))

// Capture-мок: записываем ВСЕ аргументы (нас интересует transmitEnabled), no-op.
vi.mock('../../player/hooks/useShadowMicStream', () => ({
  useShadowMicStream: (args: any) => { micWrap.lastArgs = args },
}))

// Захватываем useWorkspace — 5-й аргумент (index 4) = onLoopBoundaryWrapped,
// им дёргаем грейдинговую границу вручную (тот же приём, что partial-тест).
vi.mock('../../player/hooks/useWorkspace', async (importActual) => {
  const actual = await importActual<typeof import('../../player/hooks/useWorkspace')>()
  return {
    ...actual,
    useWorkspace: (...args: unknown[]) => {
      wsWrap.lastArgs = args
      return (actual.useWorkspace as (...a: unknown[]) => WorkspaceApi)(...args)
    },
  }
})

vi.mock('../../player/hooks/useShadowRuntime', async (importActual) => {
  const actual = await importActual<typeof import('../../player/hooks/useShadowRuntime')>()
  return {
    ...actual,
    useShadowRuntime: (args: any) => {
      const r = actual.useShadowRuntime(args)
      rtWrap.lastReturn = r
      return r
    },
  }
})

// Realtime ON (гейт transmit живой) но источник — Fake (без WebSocket).
vi.mock('../../player/workspace/realtime-answer-source', async (importActual) => {
  const actual = await importActual<typeof import('../../player/workspace/realtime-answer-source')>()
  return {
    ...actual,
    isRealtimeAnswerEnabled: () => true,
    selectAnswerSource: (opts: any = {}) => actual.selectAnswerSource({ ...opts, forceFake: true }),
  }
})

function seedGradingExercise(): ShadowExerciseAnnotation {
  const ex: ShadowExerciseAnnotation = {
    id: 'ex-seed-1',
    startTime: 0,
    endTime: 2,
    anchorMode: 'time-range',
    settings: {
      loopMode: false, advanceEnabled: true, advanceThreshold: 80,
      mode: 'subtitle', saveAudio: false, engines: { asr: 'x', check: 'y', ocr: 'z' },
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
  localStorage.setItem(EXERCISE_KEY, JSON.stringify([ex]))
  return ex
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  sessionStorage.setItem(MIC_CONSENT_KEY, 'granted') // hands-free — no consent prompt
  mockAdapterHolder.adapter = null
  micWrap.lastArgs = null
  wsWrap.lastArgs = null
  rtWrap.lastReturn = null
  vi.stubGlobal('fetch', vi.fn((url: unknown) => {
    const u = String(url)
    if (u.includes('/api/youtube/subtitles')) {
      return Promise.resolve({
        ok: true, status: 200,
        json: async () => ({ video_id: VIDEO_ID, source_language: 'en', cues: CUES }),
      } as Response)
    }
    return Promise.reject(new Error(`unmocked fetch: ${u}`))
  }))
})

function play() { act(() => { mockAdapterHolder.adapter.play(); mockAdapterHolder.adapter._emit('state') }) }
function pause() { act(() => { mockAdapterHolder.adapter.pause(); mockAdapterHolder.adapter._emit('state') }) }

describe('[MED-6 P-tz4-fix] PlayerPage → useShadowMicStream transmitEnabled шов', () => {
  it('арм + play → transmitEnabled true; pause → false; play снова → true (мутация «константа true» → red на pause-ветке)', async () => {
    seedGradingExercise()
    const { queryByTestId } = render(
      <MemoryRouter initialEntries={[`/player?v=${VIDEO_ID}`]}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    // autostart armed the seeded exercise (playhead t=1 внутри 0-2) → карта видна.
    await waitFor(() => { expect(queryByTestId('shadow-card')).toBeTruthy() })
    await waitFor(() => { expect(micWrap.lastArgs).toBeTruthy() })

    // Адаптер стартует на паузе → transmit false (нечего стримить).
    expect(micWrap.lastArgs.transmitEnabled).toBe(false)

    play()
    expect(micWrap.lastArgs.transmitEnabled).toBe(true)  // играем → передаём

    pause()
    expect(micWrap.lastArgs.transmitEnabled).toBe(false) // ← КОНСТАНТА true умирает здесь

    play()
    expect(micWrap.lastArgs.transmitEnabled).toBe(true)  // возобновили
  })

  it('analyzing=true при paused → transmitEnabled true (грейдинговая граница держит передачу, хотя видео паузнуто)', async () => {
    seedGradingExercise()
    const { queryByTestId } = render(
      <MemoryRouter initialEntries={[`/player?v=${VIDEO_ID}`]}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await waitFor(() => { expect(queryByTestId('shadow-card')).toBeTruthy() })
    await waitFor(() => { expect(rtWrap.lastReturn?.armedSegmentId()).toBeTruthy() })
    await waitFor(() => { expect(wsWrap.lastArgs).toBeTruthy() })

    // Видео на паузе (transmit должен быть false БЕЗ analyzing).
    pause()
    expect(micWrap.lastArgs.transmitEnabled).toBe(false)

    // Дёргаем грейдинговую границу → coordinator.startEval выставляет
    // isEvalInFlight СИНХРОННО → обёртка ставит analyzing=true. Fake-источник
    // резолвит вердикт асинхронно (не в этом sync-акте), так что окно живо.
    act(() => { (wsWrap.lastArgs![4] as () => void)() })

    // Локализуем провал: граница реально запустила eval.
    expect(rtWrap.lastReturn.isEvalInFlight()).toBe(true)
    // analyzing=true при paused=true → передача ЖИВА (CRIT-1 окно граница→финал).
    expect(micWrap.lastArgs.transmitEnabled).toBe(true)
  })
})
