// Ссылка /player?t= при сохранённой петле A–B (flib:ws:<v>, looping:true): петля не стартует и не
// перематывает сама, пока t не «съеден»; t внутри [A,B) — петля работает как обычно.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PlayerPage } from '../PlayerPage'

const VIDEO_ID = 'abc123XYZ_1'
const h = vi.hoisted(() => ({ adapter: null as any }))
vi.mock('../../adapter/IFrameAdapter', () => ({
  createIFrameAdapter: async () => {
    const { makeFakeAdapter } = await import('../../adapter/__tests__/fake')
    h.adapter = makeFakeAdapter({ duration: 600, t: 100 })
    return h.adapter
  },
}))
vi.mock('../../player/hooks/useShadowMicStream', () => ({ useShadowMicStream: () => {} }))

const save = (rangeStart: number, rangeEnd: number) => localStorage.setItem(`flib:ws:${VIDEO_ID}`, JSON.stringify(
  { rangeStart, rangeEnd, viewStart: 0, viewEnd: 600, looping: true, pauseAtEnd: 0 }))
beforeEach(() => {
  localStorage.clear(); h.adapter = null
  vi.stubGlobal('fetch', vi.fn((url: unknown) => String(url).includes('/api/youtube/subtitles')
    ? Promise.resolve({ ok: true, status: 200, json: async () => ({ video_id: VIDEO_ID, source_language: 'en', cues: [] }) } as Response)
    : Promise.reject(new Error('unmocked'))))
})
const open = (q: string) => render(<MemoryRouter initialEntries={[`/player?v=${VIDEO_ID}${q}`]}><PlayerPage /></MemoryRouter>)
const run = async (q: string) => {
  open(q)
  await waitFor(() => expect(h.adapter).toBeTruthy())
  const calls: string[] = []; h.adapter._spy = (m: string) => calls.push(m)
  await act(async () => { await new Promise(r => setTimeout(r, 400)) })
  return calls
}

describe('сохранённая петля и старт из ссылки (страница)', () => {
  it('петля [10,20], t=100: без клика ни seek, ни play', async () => {
    save(10, 20)
    expect(await run('&t=100')).toEqual([])
  })
  it('петля [200,210], t=100: без клика пусто', async () => {
    save(200, 210)
    expect(await run('&t=100')).toEqual([])
  })
  it('контроль: без t та же петля при позиции 100 перематывает', async () => {
    save(10, 20)
    expect(await run('')).toContain('seek:10')
  })
  it('t внутри [95,105]: петля жива (на выходе за B — seek на A)', async () => {
    save(95, 105)
    open('&t=100')
    await waitFor(() => expect(h.adapter).toBeTruthy())
    const calls: string[] = []; h.adapter._spy = (m: string) => calls.push(m)
    await act(async () => { await new Promise(r => setTimeout(r, 200)) })
    expect(calls).toEqual([])
    act(() => { h.adapter._emit('state', 'playing'); h.adapter._setTime(106) })
    await waitFor(() => expect(calls).toContain('seek:95'))
  })
})
