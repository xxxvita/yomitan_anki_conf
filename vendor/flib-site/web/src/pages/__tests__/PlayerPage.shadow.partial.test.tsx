// PlayerPage.shadow.partial.test.tsx — Срез D фикс-волна [ID:P-CD-fix], аудит M4:
// шов проводки живого partial (RealtimeAnswerSource.onPartial → partialCbRef →
// acceptArmedPartial → setPartialText → ShadowCard dashed-блок) НЕ был покрыт ни
// одним интеграционным тестом — удаление присваивания partialCbRef.current
// (PlayerPage.tsx) или reset-эффектов оставляло сьюту зелёной.
//
// Основной integration-файл (PlayerPage.shadow.integration.test.tsx) НЕ мокает
// selectAnswerSource (там проверяется `answerSource instanceof FakeAnswerSource`),
// поэтому onPartial там некому эмитить (Fake его не зовёт). Здесь мокаем
// selectAnswerSource так, чтобы ЗАХВАТИТЬ переданный PlayerPage'ем onPartial и
// дёргать его вручную (тот же приём, что harness ловит onAnalyser у мик-хука),
// возвращая при этом реальный FakeAnswerSource для остального пайплайна (вердикт).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, waitFor, act, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PlayerPage } from '../PlayerPage'
import { type WorkspaceApi } from '../../player/hooks/useWorkspace'

const CUES = [
  { start: 0, end: 2, text_en: 'hello world', text_ru: 'привет мир' },
  { start: 2, end: 4, text_en: 'second cue', text_ru: 'вторая реплика' },
]

const mockAdapterHolder = vi.hoisted(() => ({ adapter: null as any }))
const wsWrap = vi.hoisted(() => ({ lastArgs: null as unknown[] | null, lastReturn: null as WorkspaceApi | null }))
const rtWrap = vi.hoisted(() => ({ lastArgs: null as any, lastReturn: null as any }))
// Захват onPartial, переданного PlayerPage'ем в selectAnswerSource — им же
// дёргаем interim вручную (Fake сам onPartial не зовёт).
const partialHolder = vi.hoisted(() => ({ onPartial: null as ((exId: string, text: string) => void) | null }))

vi.mock('../../adapter/IFrameAdapter', () => ({
  createIFrameAdapter: async () => {
    const { makeFakeAdapter } = await import('../../adapter/__tests__/fake')
    mockAdapterHolder.adapter = makeFakeAdapter({ duration: 120, t: 1 })
    return mockAdapterHolder.adapter
  },
}))

vi.mock('../../player/hooks/useWorkspace', async (importActual) => {
  const actual = await importActual<typeof import('../../player/hooks/useWorkspace')>()
  return {
    ...actual,
    useWorkspace: (...args: unknown[]) => {
      wsWrap.lastArgs = args
      const r = (actual.useWorkspace as (...a: unknown[]) => WorkspaceApi)(...args)
      wsWrap.lastReturn = r
      return r
    },
  }
})

vi.mock('../../player/hooks/useShadowRuntime', async (importActual) => {
  const actual = await importActual<typeof import('../../player/hooks/useShadowRuntime')>()
  return {
    ...actual,
    useShadowRuntime: (args: any) => {
      const r = actual.useShadowRuntime(args)
      rtWrap.lastArgs = args
      rtWrap.lastReturn = r
      return r
    },
  }
})

// Мик-хук — no-op (реалтайм off), карту он не касается.
vi.mock('../../player/hooks/useShadowMicStream', () => ({
  useShadowMicStream: () => {},
}))

// Ключевой шов M4: захватываем onPartial, возвращаем реальный FakeAnswerSource
// (чтобы вердикт/граница работали как обычно). isRealtimeAnswerEnabled/остальное — как есть.
vi.mock('../../player/workspace/realtime-answer-source', async (importActual) => {
  const actual = await importActual<typeof import('../../player/workspace/realtime-answer-source')>()
  const { FakeAnswerSource } = await import('../../player/workspace/answer-source')
  return {
    ...actual,
    selectAnswerSource: (opts: { onPartial?: (exId: string, text: string) => void } = {}) => {
      partialHolder.onPartial = opts.onPartial ?? null
      return new FakeAnswerSource()
    },
  }
})

beforeEach(() => {
  localStorage.clear()
  // Э6 (Shadowing-гейт): пилюля «Шадоуинг» теперь disabled без flib:access —
  // сидим доступ, чтобы клики этого теста (не про гейт) доходили до onToggleShadow.
  localStorage.setItem('flib:access', JSON.stringify({ shadowing: true, keyPrefix: 'tpk_test', checkedAt: new Date().toISOString() }))
  wsWrap.lastArgs = null
  wsWrap.lastReturn = null
  rtWrap.lastArgs = null
  rtWrap.lastReturn = null
  partialHolder.onPartial = null
  vi.stubGlobal('fetch', vi.fn((url: unknown) => {
    const u = String(url)
    if (u.includes('/api/youtube/subtitles')) {
      return Promise.resolve({
        ok: true, status: 200,
        json: async () => ({ video_id: 'abc123XYZ_1', source_language: 'en', cues: CUES }),
      } as Response)
    }
    return Promise.reject(new Error(`unmocked fetch: ${u}`))
  }))
})

async function waitTwoAnimationFrames() {
  await act(async () => {
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(null))))
  })
}

async function armCue0(getByTitle: (t: string) => HTMLElement) {
  act(() => { wsWrap.lastReturn!.setRange(0, 0) }) // escape default AB seed → branch 5 (cue)
  act(() => { fireEvent.click(getByTitle('Старт Шадоуинг')) })
}

describe('PlayerPage — Срез D шов живого partial (M4) [ID:P-CD-fix]', () => {
  it('onPartial армленного упражнения → текст в data-testid=shadow-partial; приход вердикта его сбрасывает', async () => {
    const { getByTitle, getByTestId } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await waitTwoAnimationFrames()
    // Реалтайм-источник (мок) реально подставлен → onPartial захвачен.
    await waitFor(() => { expect(partialHolder.onPartial).toBeTruthy() })

    // loopMode default TRUE — ниже-пороговый финал даёт restart (арм цел, карта
    // живёт для проверки reset partial по приходу вердикта).
    await armCue0(getByTitle)
    const armedId = rtWrap.lastReturn!.armedSegmentId() as string
    expect(armedId).toBeTruthy()

    // Эмитим interim для АРМЛЕННОГО упражнения → карта показывает его в dashed-блоке.
    act(() => { partialHolder.onPartial!(armedId, 'hello wor') })
    await waitFor(() => {
      expect(within(getByTestId('shadow-card')).getByTestId('shadow-partial').textContent).toContain('hello wor')
    })

    // Финал приходит → partialText сбрасывается (эффект по verdictOutcome), застывший
    // interim не перекрывает финальный lastSpoken.
    rtWrap.lastArgs!.answerSource.forceOnce({ status: 'final', text: 'hello there' })
    act(() => { (wsWrap.lastArgs![4] as () => void)() })
    await waitFor(() => { expect(rtWrap.lastReturn!.verdictOutcome).not.toBeNull() })
    await waitFor(() => {
      expect(within(getByTestId('shadow-card')).getByTestId('shadow-partial').textContent).not.toContain('hello wor')
    })
  })

  it('partial ЧУЖОГО (не армленного) упражнения игнорируется (acceptArmedPartial фильтр)', async () => {
    const { getByTitle, getByTestId } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await waitTwoAnimationFrames()
    await waitFor(() => { expect(partialHolder.onPartial).toBeTruthy() })
    await armCue0(getByTitle)

    // Партиал с ЧУЖИМ exerciseId — не текущая армленная сессия → отброшен.
    act(() => { partialHolder.onPartial!('some-other-exercise-id', 'stale phrase') })
    expect(within(getByTestId('shadow-card')).getByTestId('shadow-partial').textContent).not.toContain('stale phrase')
  })

  it('unarm (Стоп) сбрасывает partial — на следующем арме застывший interim не протекает', async () => {
    const { getByTitle, getByTestId, queryByTestId } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await waitTwoAnimationFrames()
    await waitFor(() => { expect(partialHolder.onPartial).toBeTruthy() })

    await armCue0(getByTitle)
    const armedId = rtWrap.lastReturn!.armedSegmentId() as string
    act(() => { partialHolder.onPartial!(armedId, 'leaky interim') })
    await waitFor(() => {
      expect(within(getByTestId('shadow-card')).getByTestId('shadow-partial').textContent).toContain('leaky interim')
    })

    // Разарм (Стоп) → эффект `!shadowState.active → setPartialText('')`.
    act(() => { fireEvent.click(getByTitle('Стоп Шадоуинг')) })
    await waitFor(() => { expect(queryByTestId('shadow-card')).toBeNull() })

    // Повторный арм — карта назад, но старый interim НЕ протёк (partial сброшен на разарме).
    await armCue0(getByTitle)
    await waitFor(() => { expect(queryByTestId('shadow-card')).toBeTruthy() })
    expect(within(getByTestId('shadow-card')).getByTestId('shadow-partial').textContent).not.toContain('leaky interim')
  })
})
