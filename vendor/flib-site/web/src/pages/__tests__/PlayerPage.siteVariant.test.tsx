// PlayerPage.siteVariant.test.tsx — плеер по умолчанию передаёт рабочей панели вариант
// палитры 'site' (палитра основного сайта, 2026-11-25), а не 'refined'.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const h = vi.hoisted(() => ({ variants: [] as unknown[] }))
vi.mock('../../player/hooks/useSubtitles', () => ({
  useSubtitles: () => ({ cues: [{ start: 0, end: 2, text_en: 'Hello', text_ru: 'Привет' }], activeIndex: 0, status: 'ok', retrying: false, source: 'daemon_align' }),
}))
vi.mock('../../adapter/IFrameAdapter', () => ({
  createIFrameAdapter: async () => {
    const { makeFakeAdapter } = await import('../../adapter/__tests__/fake')
    return makeFakeAdapter({ duration: 120, t: 0 })
  },
}))
vi.mock('../../player/workspace/WorkspacePanel', () => ({
  WorkspacePanel: (p: { variant: unknown }) => { h.variants.push(p.variant); return null },
}))

import { PlayerPage } from '../PlayerPage'

beforeEach(() => {
  localStorage.clear(); h.variants.length = 0
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no net'))))
})
afterEach(() => { vi.unstubAllGlobals() })

describe('PlayerPage → WorkspacePanel', () => {
  it('вариант по умолчанию — site', async () => {
    render(<MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><Routes><Route path="/player" element={<PlayerPage />} /></Routes></MemoryRouter>)
    await waitFor(() => expect(h.variants.length).toBeGreaterThan(0))
    expect(new Set(h.variants)).toEqual(new Set(['site']))
  })
  it('сохранённый refined по-прежнему доходит до панели', async () => {
    localStorage.setItem('flib:dusk-variant', 'refined')
    render(<MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><Routes><Route path="/player" element={<PlayerPage />} /></Routes></MemoryRouter>)
    await waitFor(() => expect(h.variants.length).toBeGreaterThan(0))
    expect(new Set(h.variants)).toEqual(new Set(['refined']))
  })
})
