// Ссылка /player?t= внутри сохранённого шэдоинг-упражнения: пока t не «съеден», автостарт молчит
// (иначе play() без клика — пауза внутри региона только из-за открытия ссылки).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor, act, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PlayerPage } from '../PlayerPage'

const VIDEO_ID = 'abc123XYZ_1'
const h = vi.hoisted(() => ({ adapter: null as any, lastArgs: null as any, ssLast: null as any }))

vi.mock('../../adapter/IFrameAdapter', () => ({
  createIFrameAdapter: async () => {
    const { makeFakeAdapter } = await import('../../adapter/__tests__/fake')
    h.adapter = makeFakeAdapter({ duration: 600, t: 100 })
    return h.adapter
  },
}))
vi.mock('../../player/hooks/useShadowMicStream', () => ({ useShadowMicStream: () => {} }))
vi.mock('../../player/hooks/useShadowState', async (importActual) => {
  const actual = await importActual<typeof import('../../player/hooks/useShadowState')>()
  return { ...actual, useShadowState: (...a: unknown[]) => { const r = (actual.useShadowState as any)(...a); h.ssLast = r; return r } }
})
vi.mock('../../player/hooks/useShadowAutoStart', async (importActual) => {
  const actual = await importActual<typeof import('../../player/hooks/useShadowAutoStart')>()
  return { ...actual, useShadowAutoStart: (args: any) => { h.lastArgs = args; return actual.useShadowAutoStart(args) } }
})

function seed() {
  localStorage.setItem(`flib:shadow-exercises:${VIDEO_ID}`, JSON.stringify([{
    id: 'ex-1', startTime: 98, endTime: 104, anchorMode: 'time-range',
    settings: { loopMode: true, advanceEnabled: false, advanceThreshold: 80, mode: 'subtitle', saveAudio: false, engines: { asr: 'x', check: 'y', ocr: 'z' } },
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  }]))
}
beforeEach(() => {
  localStorage.clear(); h.adapter = null; h.lastArgs = null; h.ssLast = null
  vi.stubGlobal('fetch', vi.fn((url: unknown) => String(url).includes('/api/youtube/subtitles')
    ? Promise.resolve({ ok: true, status: 200, json: async () => ({ video_id: VIDEO_ID, source_language: 'en', cues: [] }) } as Response)
    : Promise.reject(new Error('unmocked'))))
})
const open = (q: string) => render(<MemoryRouter initialEntries={[`/player?v=${VIDEO_ID}${q}`]}><PlayerPage /></MemoryRouter>)
const ids = () => h.lastArgs.exercises.map((e: any) => e.id)

describe('автостарт шэдоинга и старт из ссылки', () => {
  it('t внутри упражнения: до play автостарт не получает упражнений, play() не зовётся', async () => {
    seed()
    open('&t=100')
    await waitFor(() => expect(h.adapter).toBeTruthy())
    const spy = vi.spyOn(h.adapter, 'play')
    await act(async () => { await new Promise(r => setTimeout(r, 400)) })
    expect(h.lastArgs.exercises).toEqual([])
    expect(h.ssLast.getShadowState().active).toBe(false)
    expect(spy).not.toHaveBeenCalled()
  })

  it('MED-A: retry до play не снимает гейт (упражнения по-прежнему []), второй retry — тоже', async () => {
    seed()
    open('&t=100')
    await waitFor(() => expect(h.adapter).toBeTruthy())
    for (let i = 0; i < 2; i++) {
      const prev = h.adapter
      act(() => { prev._emit('unplayable', { reason: 'botwall-suspect' }) })
      const btn = await screen.findByRole('button', { name: /Попробовать снова/ })
      act(() => { btn.click() })
      await waitFor(() => expect(h.adapter).not.toBe(prev))
      await act(async () => { await new Promise(r => setTimeout(r, 50)) })
      expect(h.lastArgs.exercises).toEqual([])
    }
  })

  it('после первого playing гейт снят: упражнение видно автостарту', async () => {
    seed()
    open('&t=100')
    await waitFor(() => expect(h.adapter).toBeTruthy())
    expect(h.lastArgs.exercises).toEqual([])
    act(() => { h.adapter._emit('state', 'playing') })
    await waitFor(() => expect(ids()).toEqual(['ex-1']))
  })

  it('наш seek тоже снимает гейт', async () => {
    seed()
    open('&t=100')
    await waitFor(() => expect(h.adapter).toBeTruthy())
    act(() => { h.adapter.seek(100) })
    await waitFor(() => expect(ids()).toEqual(['ex-1']))
  })

  it('без t автостарт как раньше: упражнение видно сразу', async () => {
    seed()
    open('')
    await waitFor(() => expect(h.adapter).toBeTruthy())
    await waitFor(() => expect(ids()).toEqual(['ex-1']))
  })

  it('маршрутная ссылка (rp) с t: t игнорируется, гейта нет', async () => {
    seed()
    open('&t=100&rp=1')
    await waitFor(() => expect(h.adapter).toBeTruthy())
    await waitFor(() => expect(ids()).toEqual(['ex-1']))
  })
})
