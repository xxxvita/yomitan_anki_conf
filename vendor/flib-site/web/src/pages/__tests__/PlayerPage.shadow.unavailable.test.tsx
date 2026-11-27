// PlayerPage.shadow.unavailable.test.tsx — ТЗ №2 [ID:P-hotfix-quota-ux]:
// шов RealtimeAnswerSource.onUnavailable → setUnavailableNotice → ShadowCard
// баннер. Браузерный WS не отдаёт JS статус/тело провалившегося upgrade, поэтому
// quota_exhausted (429) доносится до юзера человекочитаемым баннером.
//
// Тот же приём, что PlayerPage.shadow.partial.test.tsx: мокаем selectAnswerSource,
// ЗАХВАТЫВАЯ переданный PlayerPage'ем onUnavailable (Fake его не зовёт), возвращая
// реальный FakeAnswerSource для остального пайплайна.
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
// Захват onUnavailable, переданного PlayerPage'ем в selectAnswerSource.
const unavailHolder = vi.hoisted(() => ({
  onUnavailable: null as ((info: { reason: 'quota_exhausted' | 'unavailable'; resetsAt?: string }) => void) | null,
}))

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

vi.mock('../../player/hooks/useShadowMicStream', () => ({
  useShadowMicStream: () => {},
}))

// Ключевой шов: захватываем onUnavailable, возвращаем реальный FakeAnswerSource.
vi.mock('../../player/workspace/realtime-answer-source', async (importActual) => {
  const actual = await importActual<typeof import('../../player/workspace/realtime-answer-source')>()
  const { FakeAnswerSource } = await import('../../player/workspace/answer-source')
  return {
    ...actual,
    selectAnswerSource: (opts: { onUnavailable?: (info: any) => void } = {}) => {
      unavailHolder.onUnavailable = opts.onUnavailable ?? null
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
  unavailHolder.onUnavailable = null
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

describe('PlayerPage — ТЗ №2 quota_exhausted баннер [ID:P-hotfix-quota-ux]', () => {
  it('onUnavailable(quota_exhausted) → баннер виден в карте; арм нового упражнения его гасит', async () => {
    const { getByTitle, getByTestId, queryByTestId } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await waitTwoAnimationFrames()
    // Источник (мок) подставлен → onUnavailable захвачен.
    await waitFor(() => { expect(unavailHolder.onUnavailable).toBeTruthy() })

    await armCue0(getByTitle)
    await waitFor(() => { expect(queryByTestId('shadow-card')).toBeTruthy() })

    // gate→dead: источник сигналит недоступность квоты → баннер появляется.
    act(() => { unavailHolder.onUnavailable!({ reason: 'quota_exhausted', resetsAt: '2026-08-01T00:00:00Z' }) })
    await waitFor(() => {
      const banner = within(getByTestId('shadow-card')).getByTestId('shadow-unavailable')
      expect(banner.textContent).toContain('приобретите дополнительные квоты')
    })
    expect(within(getByTestId('shadow-card')).getByTestId('shadow-unavailable-reset').textContent).toContain('Лимит обновится')

    // Разарм (Стоп) → карта скрыта; повторный арм НОВОГО упражнения → баннер сброшен.
    act(() => { fireEvent.click(getByTitle('Стоп Шадоуинг')) })
    await waitFor(() => { expect(queryByTestId('shadow-card')).toBeNull() })
    await armCue0(getByTitle)
    await waitFor(() => { expect(queryByTestId('shadow-card')).toBeTruthy() })
    expect(within(getByTestId('shadow-card')).queryByTestId('shadow-unavailable')).toBeNull()
  })

  it('onUnavailable(unavailable) → баннер временной недоступности (без даты)', async () => {
    const { getByTitle, getByTestId, queryByTestId } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await waitTwoAnimationFrames()
    await waitFor(() => { expect(unavailHolder.onUnavailable).toBeTruthy() })

    await armCue0(getByTitle)
    await waitFor(() => { expect(queryByTestId('shadow-card')).toBeTruthy() })

    act(() => { unavailHolder.onUnavailable!({ reason: 'unavailable' }) })
    await waitFor(() => {
      const banner = within(getByTestId('shadow-card')).getByTestId('shadow-unavailable')
      expect(banner.textContent).toContain('Сервис распознавания речи временно недоступен')
    })
    expect(within(getByTestId('shadow-card')).queryByTestId('shadow-unavailable-reset')).toBeNull()
  })
})
