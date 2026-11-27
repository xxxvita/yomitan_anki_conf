// usePuzzleCatalog.test.ts — ленивый загрузчик каталога (contract v2
// 2026-07-16 [ID:P-film-picker] §3.2): грузит GET /api/puzzle/catalog только
// когда active=true, кэширует в модульной переменной (не рефетчит на повторный
// монтаж/rerender), поверхностно пробрасывает ошибку сети.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { usePuzzleCatalog, resetPuzzleCatalogCache } from '../usePuzzleCatalog'

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body }
}

beforeEach(() => {
  resetPuzzleCatalogCache()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('usePuzzleCatalog', () => {
  it('active=false never calls fetch', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => usePuzzleCatalog(false))
    expect(result.current).toEqual({ items: [], loading: false, error: null })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('active=true fetches once and returns items', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      items: [{ slug: 'friends', title_en: 'Friends', title_ru: '', media_type: 2, seasons: 10, episodes: 236 }],
      total: 1,
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => usePuzzleCatalog(true))
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.items).toHaveLength(1)
    expect(result.current.error).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('a second mount after the first resolved does NOT refetch (module cache)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [{ slug: 'x', title_en: 'X', title_ru: '', media_type: 3, seasons: 0, episodes: 0 }], total: 1 }))
    vi.stubGlobal('fetch', fetchMock)

    const first = renderHook(() => usePuzzleCatalog(true))
    await waitFor(() => expect(first.result.current.loading).toBe(false))

    const second = renderHook(() => usePuzzleCatalog(true))
    expect(second.result.current.items).toHaveLength(1)
    expect(second.result.current.loading).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1) // не повторный поход в сеть
  })

  it('network error surfaces as `error`, items stay empty', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    const { result } = renderHook(() => usePuzzleCatalog(true))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('network down')
    expect(result.current.items).toEqual([])
  })

  it('non-ok response surfaces a human-readable error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, false, 502)))
    const { result } = renderHook(() => usePuzzleCatalog(true))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toMatch(/502/)
  })

  // front-аудит MED: пустой 200-ответ НЕ должен отравить кэш (иначе `[]` truthy →
  // guard навсегда блокирует рефетч) и ДОЛЖЕН поднять error → FilmPicker фолбэк.
  it('empty 200 response sets error (fallback trigger) and does NOT poison the cache', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [], total: 0 }))
    vi.stubGlobal('fetch', fetchMock)

    const first = renderHook(() => usePuzzleCatalog(true))
    await waitFor(() => expect(first.result.current.loading).toBe(false))
    expect(first.result.current.error).toBe('empty_catalog')
    expect(first.result.current.items).toEqual([])

    // Кэш НЕ отравлен пустотой — повторный монтаж снова бьёт в сеть (ретрай).
    const second = renderHook(() => usePuzzleCatalog(true))
    await waitFor(() => expect(second.result.current.loading).toBe(false))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
