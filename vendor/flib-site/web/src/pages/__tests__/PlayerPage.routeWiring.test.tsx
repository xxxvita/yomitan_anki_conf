// PlayerPage.routeWiring.test.tsx — проводка плеера в события маршрута (повторное
// ревью партии 2, R-L8: мутанты PP17, PP20 выживали):
//   PP17 — line_translated только на исходе corpus или ok (§4.8), не на busy/ошибке;
//   PP20 — перемотка назад (ArrowLeft) доходит до onSeek → clip_replayed.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const h = vi.hoisted(() => ({
  cues: [] as { start: number; end: number; text_en: string; text_ru: string }[],
  adapter: null as any,
  onLineTranslated: [] as number[],
  onSeek: [] as Array<[number, number]>,
}))
vi.mock('../../player/hooks/useSubtitles', () => ({
  useSubtitles: () => ({ cues: h.cues, activeIndex: 0, status: 'ready', retrying: false, source: null }),
}))
vi.mock('../../adapter/IFrameAdapter', () => ({
  createIFrameAdapter: async () => {
    const { makeFakeAdapter } = await import('../../adapter/__tests__/fake')
    h.adapter = makeFakeAdapter({ duration: 120, t: 30 })
    return h.adapter
  },
}))
vi.mock('../../player/route-events/useRouteEvents', async (orig) => {
  const real = await orig<typeof import('../../player/route-events/useRouteEvents')>()
  return {
    ...real,
    useRouteEvents: () => ({
      onWordsRevealed: () => {}, onWordClick: () => {},
      onLineTranslated: (i: number) => { h.onLineTranslated.push(i) },
      onSeek: (from: number, to: number) => { h.onSeek.push([from, to]) },
      rate: () => false, counter: () => null, subsSource: 'server',
    }),
  }
})
const translateWindowMock = vi.fn()
vi.mock('../../player/translate-api', async (orig) => ({
  ...(await orig<typeof import('../../player/translate-api')>()),
  translateWindow: (...a: unknown[]) => translateWindowMock(...a),
}))

import { PlayerPage } from '../PlayerPage'

function mount() {
  return render(<MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>)
}
const capsules = (c: HTMLElement) => Array.from(c.querySelectorAll('button[aria-label="Перевести эту строку"]')) as HTMLButtonElement[]

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no net'))))
  window.localStorage.clear()
  window.localStorage.setItem('flib:subMode', 'l2')
  window.localStorage.setItem('flib:access', JSON.stringify({ shadowing: true, keyPrefix: 'tpk_test', checkedAt: new Date().toISOString() }))
  translateWindowMock.mockReset()
  h.cues = [{ start: 0, end: 2, text_en: 'Hello', text_ru: '' }]
  h.adapter = null
  h.onLineTranslated = []
  h.onSeek = []
})

describe('PlayerPage — проводка событий маршрута', () => {
  it('PP17: перевод строки с исходом busy line_translated не даёт', async () => {
    translateWindowMock.mockResolvedValue({ status: 'busy', retryAfterSec: 5, kind: '429' })
    const { container } = mount()
    await act(async () => { fireEvent.click(capsules(container)[0]) })
    await waitFor(() => expect(translateWindowMock).toHaveBeenCalledTimes(1))
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    expect(h.onLineTranslated).toEqual([])
  })

  it('PP17 (контроль): исход ok даёт line_translated этой строки', async () => {
    translateWindowMock.mockResolvedValue({ status: 'ok', source: 'local_mt', cues: [{ start: 0, end: 2, ru: 'Привет' }] })
    const { container } = mount()
    await act(async () => { fireEvent.click(capsules(container)[0]) })
    await waitFor(() => expect(h.onLineTranslated).toEqual([0]))
  })

  it('PP20: ArrowLeft (перемотка назад на 5 с) доходит до onSeek с позициями «откуда» и «куда»', async () => {
    mount()
    await waitFor(() => expect(h.adapter).toBeTruthy())
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    act(() => { fireEvent.keyDown(document, { key: 'ArrowLeft', code: 'ArrowLeft' }) })
    expect(h.onSeek.length).toBe(1)
    const [from, to] = h.onSeek[0]
    expect(from - to).toBeCloseTo(5, 3)
  })
})
