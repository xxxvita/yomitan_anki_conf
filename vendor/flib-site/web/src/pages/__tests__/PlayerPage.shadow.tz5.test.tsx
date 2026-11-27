// PlayerPage.shadow.tz5.test.tsx — ТЗ №5 п.2 (попытки per-run) + п.3 (лента/B1
// keyed по armCue, не activeIndex). Использует ту же капчур-мок-обвязку, что
// PlayerPage.shadow.integration.test.tsx (адаптер/рекордер/useWorkspace/
// useShadowState/useShadowRuntime/useShadowMicStream — реальные, обёрнуты
// wrap-real спаями; jsdom-мок только для отсутствующих в среде швов).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, waitFor, act, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PlayerPage } from '../PlayerPage'
import type { WorkspaceApi } from '../../player/hooks/useWorkspace'
import type { ShadowAttemptStored } from '../../player/workspace/shadow-attempts'

const CUES = [
  { start: 0, end: 2, text_en: 'hello world', text_ru: 'привет мир' },
  { start: 2, end: 4, text_en: 'second cue', text_ru: 'вторая реплика' },
]

const mockAdapterHolder = vi.hoisted(() => ({ adapter: null as any }))
const wsWrap = vi.hoisted(() => ({ lastArgs: null as unknown[] | null, lastReturn: null as WorkspaceApi | null }))
const rtWrap = vi.hoisted(() => ({ lastArgs: null as any, lastReturn: null as any }))
const ssWrap = vi.hoisted(() => ({ lastReturn: null as any }))
const micStreamHolder = vi.hoisted(() => ({ onAnalyser: null as any }))

vi.mock('../../adapter/IFrameAdapter', () => ({
  createIFrameAdapter: async () => {
    const { makeFakeAdapter } = await import('../../adapter/__tests__/fake')
    mockAdapterHolder.adapter = makeFakeAdapter({ duration: 120, t: 1 })
    return mockAdapterHolder.adapter
  },
}))
vi.mock('../../player/workspace/shadow-recorder', () => ({
  ShadowRecorder: class { start() { return Promise.resolve() } stop() { const b = new ArrayBuffer(4); new Int16Array(b).set([1, -1]); return [b] } },
}))
vi.mock('../../player/hooks/useWorkspace', async (importActual) => {
  const actual = await importActual<typeof import('../../player/hooks/useWorkspace')>()
  return { ...actual, useWorkspace: (...args: unknown[]) => { wsWrap.lastArgs = args; const r = (actual.useWorkspace as any)(...args); wsWrap.lastReturn = r; return r } }
})
vi.mock('../../player/hooks/useShadowState', async (importActual) => {
  const actual = await importActual<typeof import('../../player/hooks/useShadowState')>()
  return { ...actual, useShadowState: (...args: unknown[]) => { const r = (actual.useShadowState as any)(...args); ssWrap.lastReturn = r; return r } }
})
vi.mock('../../player/hooks/useShadowRuntime', async (importActual) => {
  const actual = await importActual<typeof import('../../player/hooks/useShadowRuntime')>()
  return { ...actual, useShadowRuntime: (args: any) => { const r = actual.useShadowRuntime(args); rtWrap.lastArgs = args; rtWrap.lastReturn = r; return r } }
})
vi.mock('../../player/hooks/useShadowMicStream', () => ({
  useShadowMicStream: (opts: any) => { micStreamHolder.onAnalyser = opts.onAnalyser },
}))

const KEY_A = 'flib:shadow:abc123XYZ_1'
function readA(): ShadowAttemptStored[] { const raw = localStorage.getItem(KEY_A); return raw ? JSON.parse(raw) : [] }

beforeEach(() => {
  localStorage.clear()
  // Э6 (Shadowing-гейт): пилюля «Шадоуинг» теперь disabled без flib:access —
  // сидим доступ, чтобы армы этого теста (не про гейт) доходили до onToggleShadow.
  localStorage.setItem('flib:access', JSON.stringify({ shadowing: true, keyPrefix: 'tpk_test', checkedAt: new Date().toISOString() }))
  wsWrap.lastArgs = null; wsWrap.lastReturn = null; rtWrap.lastArgs = null; rtWrap.lastReturn = null; ssWrap.lastReturn = null
  vi.stubGlobal('fetch', vi.fn((url: unknown) => {
    const u = String(url)
    if (u.includes('/api/youtube/subtitles')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ video_id: 'abc123XYZ_1', source_language: 'en', cues: CUES }) } as Response)
    if (u.includes('/api/stt')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ text: 'hello world' }) } as Response)
    return Promise.reject(new Error(`unmocked ${u}`))
  }))
})

async function twoRaf() { await act(async () => { await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))) }) }
async function armPill(getByTitle: (t: string) => HTMLElement) { act(() => { fireEvent.click(getByTitle('Старт Шадоуинг')) }) }
function boundary() { act(() => { (wsWrap.lastArgs![4] as () => void)() }) }

// ─────────────────────────────────────────────────────────────────────────────
// ТЗ №5 п.2 — попытки per-run
// ─────────────────────────────────────────────────────────────────────────────
describe('PlayerPage — ТЗ №5 п.2: попытки per-run (сброс при входе в ран) [ID:P-tz5]', () => {
  it('вход в упражнение (арм) СТИРАЕТ «вечную» историю прошлых сессий — лента пуста, localStorage-бакет удалён', async () => {
    // Прошлая сессия оставила 10 попыток в localStorage — владелец: «только зашёл,
    // а у меня уже 10» — этого быть не должно.
    localStorage.setItem(KEY_A, JSON.stringify(Array.from({ length: 10 }, (_, i) => ({
      id: `old${i}`, cue_index: 0, text: `old ${i}`, marks: [], match_pct: 50,
      audio_start_sec: 0, audio_end_sec: 0, created_at: '2026-01-01T00:00:00.000Z',
    }))))
    const { getByTitle } = render(<MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>)
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await twoRaf()
    act(() => { ssWrap.lastReturn!.setShadowState({ loopMode: false }) })
    act(() => { wsWrap.lastReturn!.setRange(0, 0) })
    await armPill(getByTitle)
    // Вход в ран → clearAll: бакет стёрт.
    await waitFor(() => { expect(readA()).toHaveLength(0) })
    expect(localStorage.getItem(KEY_A)).toBeNull()
  })

  it('внутри рана попытки КОПЯТСЯ (петля restart — armedSegmentId не меняется), не сбрасываются', async () => {
    const { getByTitle } = render(<MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>)
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await twoRaf()
    act(() => { wsWrap.lastReturn!.setRange(0, 0) })
    await armPill(getByTitle) // loopMode default TRUE → low-match → restart, арм жив
    const armedId = rtWrap.lastReturn!.armedSegmentId()
    expect(armedId).not.toBeNull()

    boundary(); await waitFor(() => { expect(readA()).toHaveLength(1) })
    boundary(); await waitFor(() => { expect(readA()).toHaveLength(2) })
    boundary(); await waitFor(() => { expect(readA()).toHaveLength(3) })
    // armedSegmentId НЕ менялся весь ран → clearAll не срабатывал.
    expect(rtWrap.lastReturn!.armedSegmentId()).toBe(armedId)
  })

  it('выход и НОВЫЙ вход (re-arm) → лента снова ПУСТА (новый ран = новый armedSegmentId → clearAll)', async () => {
    const { getByTitle, queryByTestId } = render(<MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>)
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await twoRaf()
    act(() => { ssWrap.lastReturn!.setShadowState({ loopMode: false }) }) // hold → арм жив после fail
    act(() => { wsWrap.lastReturn!.setRange(0, 0) })
    await armPill(getByTitle)
    const firstArm = rtWrap.lastReturn!.armedSegmentId()
    boundary(); await waitFor(() => { expect(readA()).toHaveLength(1) })

    // Выход — крестик карты (deactivate → disarm).
    act(() => { fireEvent.click(within(queryByTestId('shadow-card')!).getByTestId('shadow-close')) })
    await waitFor(() => { expect(queryByTestId('shadow-card')).toBeNull() })

    // Новый вход — новый ephemeral арм (ДРУГОЙ id) → clearAll → лента пуста.
    act(() => { wsWrap.lastReturn!.setRange(0, 0) })
    await armPill(getByTitle)
    const secondArm = rtWrap.lastReturn!.armedSegmentId()
    expect(secondArm).not.toBe(firstArm) // реально новый ран
    await waitFor(() => { expect(readA()).toHaveLength(0) }) // прошлый ран сброшен
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// ТЗ №5 п.3 — лента/B1 keyed по armCue (не activeIndex)
// ─────────────────────────────────────────────────────────────────────────────
describe('PlayerPage — ТЗ №5 п.3: лента/B1 читает бакет armCue, не activeIndex [ID:P-tz5]', () => {
  it('playhead ВНЕ армленного cue (activeIndex=-1) — лента ВСЁ РАВНО растёт и «повтор N» монотонна (бакет armCue)', async () => {
    // Репро корня: арм A-B[0,10] c playhead t=5 (activeIndex=-1). Аккумулятор
    // пишет попытки в бакет armCue=0 (кламп H2). ДО фикса карта читала
    // activeIndex=-1 → бакет "-1" (пустой) → строки не появлялись, «повтор N»
    // скакал. ПОСЛЕ фикса cueIndex=armCue=0 → лента растёт корректно.
    const { getByTitle, getByTestId } = render(<MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>)
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await twoRaf()
    act(() => { mockAdapterHolder.adapter._setTime(5) }) // за последним cue [2,4) → activeIndex=-1
    await twoRaf()
    act(() => { wsWrap.lastReturn!.setABLoop(0, 10) }) // playhead t=5 внутри A-B → арм time-range
    await armPill(getByTitle)
    expect(rtWrap.lastReturn!.armedSegmentId()).not.toBeNull()

    const src = rtWrap.lastArgs!.answerSource
    src.forceOnce({ status: 'final', text: 'first attempt' })
    boundary(); await waitFor(() => { expect(readA()).toHaveLength(1) })
    src.forceOnce({ status: 'final', text: 'second attempt' })
    boundary(); await waitFor(() => { expect(readA()).toHaveLength(2) })

    // Попытки реально в бакете armCue=0 (не -1).
    expect(readA().every(a => a.cue_index === 0)).toBe(true)

    // Карта показывает ленту рана: latest-B1 (shadow-diff) + 1 историческая строка
    // «повтор 1». ДО фикса (cueIndex=activeIndex=-1) историч. строк было бы 0.
    const card = getByTestId('shadow-card')
    await waitFor(() => { expect(within(card).queryByTestId('shadow-diff')).toBeTruthy() })
    await waitFor(() => { expect(within(card).queryAllByTestId('shadow-history-row')).toHaveLength(1) })
    expect(within(card).getByTestId('shadow-diff').textContent).toContain('повтор 2')
    expect(within(card).getAllByTestId('shadow-history-row')[0].textContent).toContain('повтор 1')
  })
})
