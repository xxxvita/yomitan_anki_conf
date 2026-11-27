// watch_progress: ссылка с t, ролик на странице не играл → не засчитываем t как просмотренное (как без t: 0).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PlayerPage } from '../PlayerPage'

const VIDEO_ID = 'abc123XYZ_1'
const h = vi.hoisted(() => ({ adapter: null as any, flush: [] as (() => void)[], events: [] as any[] }))
vi.mock('../../adapter/IFrameAdapter', () => ({
  createIFrameAdapter: async () => {
    const { makeFakeAdapter } = await import('../../adapter/__tests__/fake')
    h.adapter = makeFakeAdapter({ duration: 600, t: 100 })
    return h.adapter
  },
}))
vi.mock('../../player/hooks/useShadowMicStream', () => ({ useShadowMicStream: () => {} }))
vi.mock('../../site/telemetry', async (importActual) => {
  const actual = await importActual<typeof import('../../site/telemetry')>()
  return {
    ...actual,
    track: (name: string, payload: any) => { h.events.push({ name, payload }) },
    onTerminalFlush: (cb: () => void) => { h.flush.push(cb); return () => { h.flush = h.flush.filter(f => f !== cb) } },
  }
})

beforeEach(() => {
  localStorage.clear(); h.adapter = null; h.flush = []; h.events = []
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('unmocked'))))
})
const open = (q: string) => render(<MemoryRouter initialEntries={[`/player?v=${VIDEO_ID}${q}`]}><PlayerPage /></MemoryRouter>)
const finals = () => h.events.filter(e => e.name === 'watch_progress')
const flushAll = () => act(() => { h.flush.slice().forEach(f => f()) })

describe('watch_progress и старт из ссылки', () => {
  it('t не проигран: current_time = 0, не t', async () => {
    open('&t=100')
    await waitFor(() => expect(h.adapter).toBeTruthy())
    flushAll()
    expect(finals().length).toBeGreaterThan(0)
    expect(finals().every(e => e.payload.current_time === 0 && e.payload.watched_pct === 0)).toBe(true)
  })

  it('после первого playing — настоящая позиция', async () => {
    open('&t=100')
    await waitFor(() => expect(h.adapter).toBeTruthy())
    act(() => { h.adapter._emit('state', 'playing') })
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    flushAll()
    expect(finals().at(-1).payload.current_time).toBe(100)
  })
})
