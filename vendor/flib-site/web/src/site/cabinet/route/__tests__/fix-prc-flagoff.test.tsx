// fix-prc-flagoff.test.tsx — PR-C, L1: при выключенном маршруте кабинета (нет метки
// flib-route) `/app/route/words` для вошедшего ведёт себя как на main до PR-B —
// перенаправление на `/app` (общий `*` кабинета), а не «Маршрут — скоро».
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../../test-page/math', () => ({
  priorFromSurvey: vi.fn(),
  AuralEngine: class { next() { return null }; answer() {}; done = true; result() { return null } },
  scoreDictSentence: vi.fn(), estimateDecoding: vi.fn(), scoreEISentence: vi.fn(), estimateEI: vi.fn(),
  synthesize: vi.fn(), topNWords: vi.fn(), DICTATION_SENTENCES: [], EI_SENTENCES: [], sentenceText: () => '', vocabSigmaFromCi90: () => 0,
}))

import { App } from '../../../../App'
import { __resetSessionForTests, __setSessionForTests } from '../../../session'
import { __resetRouteStateForTests } from '../use-route-state'
import { setCabinetMarker } from '../../../__tests__/cabinet-marker'
import { LocationProbe, setRouteMarker, json, st, lesson, und, del } from './route-page-fakes'

const URL_ = '/app/route/words?rw=' + encodeURIComponent('words::abcdef0123456789')

afterEach(() => { vi.unstubAllGlobals(); setCabinetMarker(false); setRouteMarker(false); __resetSessionForTests(); __resetRouteStateForTests() })

function mount(routeMarker: boolean) {
  __resetSessionForTests(); __resetRouteStateForTests()
  setCabinetMarker(true); setRouteMarker(routeMarker)
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn((u: string) => {
    calls.push(String(u))
    if (String(u).startsWith('/api/me/route/state')) return Promise.resolve(json(200, st([del(1, { played: true }), lesson('abcdef0123456789'), und()])))
    return Promise.reject(new Error('no net'))
  }))
  __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_abcd', routeAllowed: true, demo: false })
  render(<MemoryRouter initialEntries={[URL_]}><App /><LocationProbe /></MemoryRouter>)
  return calls
}

describe('L1: /app/route/words без метки маршрута', () => {
  it('вошедший — перенаправлен на /app, Главная кабинета, ни одного запроса маршрута', async () => {
    const calls = mount(false)
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/app'))
    expect(await screen.findByRole('heading', { name: 'Здравствуйте!' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Маршрут' })).toBeNull()
    expect(calls.filter(c => c.startsWith('/api/me/route'))).toEqual([])
  })

  it('контроль: с меткой маршрута — страница урока на месте', async () => {
    mount(true)
    await screen.findByTestId('lesson-meta')
    expect(screen.getByTestId('location').textContent).toBe(URL_)
  })
})
