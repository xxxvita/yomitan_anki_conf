// PlayerPage.shadowHoldOverlay.test.tsx — S3-3: proves ShadowHoldOverlay is
// actually MOUNTED inside PlayerPage's PlayerRoot tree (video-overlay, sibling
// of CountdownOverlay) and that the runtime's 4 render-state fields
// (holding/evalOverlayVisible/verdictOutcome/verdictTargetSnapshot) really
// reach it through PlayerPage's own props — not just "wired per tsc".
//
// ShadowHoldOverlay's own render-branch logic (holding banner / eval spinner /
// verdict slot / freeze-glyphs) is ALREADY exhaustively covered at the unit
// level by ShadowHoldOverlay.test.tsx — this file does not re-litigate those
// branches. It only proves PlayerPage's wiring: (1) DORMANT (S3-2 initial
// state, no arm-path yet) renders NOTHING new for an ordinary user, (2)
// runtime.holding=true reaches the mounted overlay, (3) runtime.verdictOutcome
// reaches the mounted overlay, (4) both flow through the SAME runtime object
// PlayerPage reads from useShadowRuntime — a wrap-real mock (same technique as
// PlayerPage.shadow.integration.test.tsx's rtWrap) that returns the REAL
// runtime with only the 4 render-state fields overridden per test, so every
// other field (armRange, onLoopBoundary, isHeld, ...) stays the genuine
// production value and the rest of PlayerPage's wiring (useWorkspace etc.)
// keeps working exactly as in the un-mocked smoke tests.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PlayerPage } from '../PlayerPage'
import type { AnswerOutcomeEvent } from '../../player/workspace/answer-source'

const mockAdapterHolder = vi.hoisted(() => ({ adapter: null as any }))

vi.mock('../../adapter/IFrameAdapter', () => ({
  createIFrameAdapter: async () => {
    const { makeFakeAdapter } = await import('../../adapter/__tests__/fake')
    mockAdapterHolder.adapter = makeFakeAdapter({ duration: 120, t: 1 })
    return mockAdapterHolder.adapter
  },
}))

// Test-controlled overrides for the 4 render-state fields ShadowHoldOverlay
// consumes. Read at mock-call time (i.e. at render), so setting these BEFORE
// `render(...)` is enough — no need to drive the real coordinator through an
// arm/boundary sequence just to prove the plumbing.
const overlayState = vi.hoisted(() => ({
  holding: false,
  evalOverlayVisible: false,
  verdictOutcome: null as AnswerOutcomeEvent | null,
  verdictTargetSnapshot: null as string | null,
}))

vi.mock('../../player/hooks/useShadowRuntime', async (importActual) => {
  const actual = await importActual<typeof import('../../player/hooks/useShadowRuntime')>()
  return {
    ...actual,
    useShadowRuntime: (args: any) => {
      // Real hook runs unchanged (armRange/onLoopBoundary/isHeld/... all stay
      // genuine) — only the 4 render-state fields are swapped for the
      // test-controlled values, mirroring exactly what a future arm-path
      // (S3-6) would otherwise have to drive end-to-end.
      const r = actual.useShadowRuntime(args)
      return {
        ...r,
        holding: overlayState.holding,
        evalOverlayVisible: overlayState.evalOverlayVisible,
        verdictOutcome: overlayState.verdictOutcome,
        verdictTargetSnapshot: overlayState.verdictTargetSnapshot,
      }
    },
  }
})

beforeEach(() => {
  overlayState.holding = false
  overlayState.evalOverlayVisible = false
  overlayState.verdictOutcome = null
  overlayState.verdictTargetSnapshot = null
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no net'))))
  // Э6 (Shadowing-гейт): пилюля «Шадоуинг» теперь disabled + другой title
  // без flib:access — сидим доступ, тест ниже проверяет title 'Старт Шадоуинг'.
  window.localStorage.clear()
  window.localStorage.setItem('flib:access', JSON.stringify({ shadowing: true, keyPrefix: 'tpk_test', checkedAt: new Date().toISOString() }))
})

describe('PlayerPage — ShadowHoldOverlay mount wiring (S3-3)', () => {
  it('DORMANT (S3-2 initial runtime state, no arm-path yet): renders no hold banner, no eval spinner, no verdict slot — ordinary user sees nothing new', async () => {
    const { queryByTestId, queryByText } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })

    expect(queryByTestId('shadow-hold-state')).toBeNull()
    expect(queryByTestId('shadow-verdict-slot')).toBeNull()
    expect(queryByText('Анализ ответа…')).toBeNull()
  })

  it('runtime.holding=true reaches the mounted overlay (hold banner visible)', async () => {
    overlayState.holding = true
    const { getByTestId } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })

    expect(getByTestId('shadow-hold-state')).toBeTruthy()
  })

  it('runtime.evalOverlayVisible=true reaches the mounted overlay as ShadowHoldOverlay\'s evalVisible prop (Analyzing… spinner visible)', async () => {
    overlayState.evalOverlayVisible = true
    const { queryByText } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })

    expect(queryByText('Анализ ответа…')).toBeTruthy()
  })

  it('runtime.verdictOutcome reaches the mounted overlay (verdict slot renders)', async () => {
    overlayState.verdictOutcome = { exerciseId: 'ex1', outcome: { status: 'final', text: 'hi' } }
    const { getByTestId } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })

    expect(getByTestId('shadow-verdict-slot')).toBeTruthy()
  })

  it('runtime.verdictTargetSnapshot reaches the mounted overlay (real B1 notation grid renders, not the back-compat bare-status placeholder)', async () => {
    overlayState.verdictOutcome = { exerciseId: 'ex1', outcome: { status: 'final', text: 'I love coffee' } }
    overlayState.verdictTargetSnapshot = 'I like coffee'
    const { getByTestId } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })

    const slot = getByTestId('shadow-verdict-slot')
    expect(slot.querySelector('[data-testid="shadow-verdict-notation"]')).toBeTruthy()
  })

  // Срез A (п.1): the pill is revived as a live toggle — regression intent is
  // "no throw / no interference" from mounting the overlay alongside the pill,
  // and the card stays unmounted until something is armed.
  it('regression smoke: page mounts cleanly with the overlay alongside the revived Шадоуинг pill (no throw / no interference)', async () => {
    const { getByTitle, queryByTestId } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })

    expect(queryByTestId('shadow-card')).toBeNull()
    expect(getByTitle('Старт Шадоуинг')).toBeTruthy()
  })
})
