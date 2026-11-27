// RouteStepBar.test.tsx — Э5 (план, docs/plan-2026-07-13-design-transfer.md).
// Самодостаточный компонент: читает flib:route сам (loadRoute), пропс — только
// stepId. Покрываем: рендер инфо-строки, null-guards (нет маршрута/шага/videoId
// не совпадает с `v`), CTA двигает статусы в localStorage + навигация на
// следующий video-шаг, words-следующий → /route, последний шаг → /route,
// done-шаг → бейдж вместо CTA.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { RouteStepBar } from '../RouteStepBar'
import { saveRoute, loadRoute, type RouteState, type RouteStep } from '../../../site/route-state'

const navigateMock = vi.fn()
vi.mock('react-router-dom', async importOriginal => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => navigateMock }
})

function step(overrides: Partial<RouteStep> = {}): RouteStep {
  return {
    id: 'r1',
    kind: 'video',
    videoId: 'vid00000001',
    title: 'Step',
    source: 'Source',
    durationSec: 300,
    newLemmas: 8,
    words: [],
    status: 'current',
    ...overrides,
  }
}

function seedRoute(steps: RouteStep[], extra: Partial<RouteState> = {}): RouteState {
  const route: RouteState = {
    v: 1,
    goalLabel: 'Friends без субтитров',
    steps,
    createdAt: new Date().toISOString(),
    settings: { profile: 'balance' },
    revealedBatches: 1,
    ...extra,
  }
  saveRoute(route)
  return route
}

function renderBar(stepId: string, videoParam = 'vid00000001', entry?: string) {
  return render(
    <MemoryRouter initialEntries={[entry ?? `/player?v=${videoParam}&route_step=${stepId}`]}>
      <Routes>
        <Route path="/player" element={<RouteStepBar stepId={stepId} />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('RouteStepBar', () => {
  beforeEach(() => {
    window.localStorage.clear()
    navigateMock.mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders step position, goal label and +N lemmas', () => {
    seedRoute([
      step({ id: 'r1', status: 'done' }),
      step({ id: 'r2', status: 'current', newLemmas: 12, title: 'Step2' }),
      step({ id: 'r3', status: 'next', title: 'Step3' }),
    ])
    renderBar('r2')
    const region = screen.getByRole('region', { name: 'Шаг маршрута' })
    expect(region.textContent).toContain('Шаг 2 из 3')
    expect(region.textContent).toContain('Friends без субтитров')
    expect(region.textContent).toContain('+12 слов')
  })

  it('renders nothing when no route exists', () => {
    const { container } = renderBar('r1')
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when step id is not found in the route', () => {
    seedRoute([step({ id: 'r1' })])
    const { container } = renderBar('does-not-exist')
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when the step videoId does not match the current v param', () => {
    seedRoute([step({ id: 'r1', videoId: 'vid00000001' })])
    const { container } = renderBar('r1', 'someOtherVideoId')
    expect(container.firstChild).toBeNull()
  })

  it('CTA marks the step done, persists to localStorage, and navigates to the next video step', () => {
    seedRoute([
      step({ id: 'r1', status: 'current', videoId: 'vid00000001' }),
      step({ id: 'r2', status: 'next', videoId: 'vid00000002', title: 'Step2' }),
    ])
    renderBar('r1')
    fireEvent.click(screen.getByRole('button', { name: /Отметить пройденным/ }))

    const stored = loadRoute()
    expect(stored?.steps.find(s => s.id === 'r1')?.status).toBe('done')
    expect(stored?.steps.find(s => s.id === 'r2')?.status).toBe('current')
    expect(navigateMock).toHaveBeenCalledWith('/player?v=vid00000002&route_step=r2')
  })

  it('CTA on the second-to-last step, next step kind=words → navigates to /route', () => {
    seedRoute([
      step({ id: 'r1', status: 'current', videoId: 'vid00000001' }),
      step({ id: 'r2', kind: 'words', videoId: null, status: 'next', words: ['cat', 'dog'], title: 'w' }),
    ])
    renderBar('r1')
    fireEvent.click(screen.getByRole('button', { name: /Отметить пройденным/ }))

    const stored = loadRoute()
    expect(stored?.steps.find(s => s.id === 'r1')?.status).toBe('done')
    expect(navigateMock).toHaveBeenCalledWith('/route')
  })

  it('CTA on the last step of the route → navigates to /route', () => {
    seedRoute([step({ id: 'r1', status: 'current', videoId: 'vid00000001' })])
    renderBar('r1')
    fireEvent.click(screen.getByRole('button', { name: /Отметить пройденным/ }))

    const stored = loadRoute()
    expect(stored?.steps.find(s => s.id === 'r1')?.status).toBe('done')
    expect(navigateMock).toHaveBeenCalledWith('/route')
  })

  it('a step already done renders a badge and a link back to the route instead of the CTA', () => {
    seedRoute([step({ id: 'r1', status: 'done', videoId: 'vid00000001' })])
    renderBar('r1')
    expect(screen.getByText(/пройдено/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Отметить пройденным/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'К маршруту' }))
    expect(navigateMock).toHaveBeenCalledWith('/route')
  })

  it('no "+N слов" caption when newLemmas is 0', () => {
    seedRoute([step({ id: 'r1', status: 'current', newLemmas: 0 })])
    renderBar('r1')
    expect(screen.queryByText(/слов/)).toBeNull()
  })

  // feedback-2 п.1: владелец («здесь не убрана дописал», транскрипт
  // screencast3, 01:41–01:46) — «+N слов» показывалось дважды: в rsb-info и в
  // CTA-ряду отдельной подписью «После этого видео: +N слов». Подпись убрана —
  // "+N слов" встречается РОВНО один раз во всём баре.
  it('shows the "+N слов" count exactly once — no duplicate caption in the CTA row', () => {
    seedRoute([step({ id: 'r1', status: 'current', newLemmas: 8 })])
    renderBar('r1')
    const region = screen.getByRole('region', { name: 'Шаг маршрута' })
    const matches = region.textContent?.match(/\+8\s*слов/g) ?? []
    expect(matches).toHaveLength(1)
    expect(screen.queryByText(/После этого видео/)).toBeNull()
  })
})
