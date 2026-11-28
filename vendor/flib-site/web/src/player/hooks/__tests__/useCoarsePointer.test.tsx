import { describe, it, expect, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { prefersCoarsePointer, useCoarsePointer } from '../useCoarsePointer'

// Мини-мок MediaQueryList — jsdom НЕ реализует window.matchMedia вовсе
// (typeof === 'undefined', проверено вживую), поэтому каждый тест здесь
// монтирует свой собственный fake. Другие сьюты, ничего не мокающие,
// автоматически остаются на дефолтном (typeof undefined → false) пути —
// именно поэтому этот хук безопасен для десктопных тестов без единой правки.
function fakeMatchMedia(initialMatches: boolean) {
  let matches = initialMatches
  const listeners = new Set<() => void>()
  const mql = {
    get matches() { return matches },
    media: '(pointer: coarse)',
    addEventListener: (_: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
  } as unknown as MediaQueryList
  return {
    mql,
    matchMedia: vi.fn(() => mql),
    fire(next: boolean) { matches = next; listeners.forEach(cb => cb()) },
  }
}

describe('prefersCoarsePointer / useCoarsePointer', () => {
  afterEach(() => {
    // @ts-expect-error — тестовый стаб, удаляем между тестами
    delete window.matchMedia
  })

  it('prefersCoarsePointer falls back to false when matchMedia is unavailable (jsdom default = desktop-safe)', () => {
    expect(typeof window.matchMedia).toBe('undefined')
    expect(prefersCoarsePointer()).toBe(false)
  })

  it('prefersCoarsePointer reflects matchMedia(pointer:coarse).matches when available', () => {
    const { matchMedia } = fakeMatchMedia(true)
    window.matchMedia = matchMedia
    expect(prefersCoarsePointer()).toBe(true)
  })

  it('useCoarsePointer returns the initial match synchronously (no flash-of-desktop-layout on mobile)', () => {
    const { matchMedia } = fakeMatchMedia(true)
    window.matchMedia = matchMedia
    const { result } = renderHook(() => useCoarsePointer())
    expect(result.current).toBe(true)
  })

  it('useCoarsePointer reacts to a live pointer-type change event', () => {
    const { matchMedia, fire } = fakeMatchMedia(false)
    window.matchMedia = matchMedia
    const { result } = renderHook(() => useCoarsePointer())
    expect(result.current).toBe(false)
    act(() => fire(true))
    expect(result.current).toBe(true)
  })

  it('without matchMedia (desktop test default), the hook stays false — no crash', () => {
    const { result } = renderHook(() => useCoarsePointer())
    expect(result.current).toBe(false)
  })
})
