// use-video-titles.test.tsx — хук названий роликов без страницы: пачки, отказ от
// повторов, размонтирование, смена набора.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import { __resetVideoTitlesForTests, useVideoTitles } from '../use-video-titles'
import { __resetSessionForTests, __setSessionForTests } from '../../../session'
import { json } from './route-page-fakes'

const id = (n: number) => `vid${String(n).padStart(8, '0')}`
const A = id(1)
const B = id(2)

let reply: (ids: string[], n: number) => Response | Promise<Response>
let asked: string[][]
beforeEach(() => {
  __resetSessionForTests(); __resetVideoTitlesForTests()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  asked = []
  reply = () => json(200, { titles: {}, pending: [] })
  vi.stubGlobal('fetch', vi.fn(async (u: string) => {
    const ids = (new URL(u, 'https://x').searchParams.get('ids') ?? '').split(',')
    asked.push(ids)
    return reply(ids, asked.length)
  }))
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0) })
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

describe('useVideoTitles', () => {
  it('больше 50 id уходят двумя пачками (50 + остаток)', async () => {
    const ids = Array.from({ length: 60 }, (_, i) => id(i))
    renderHook(() => useVideoTitles(ids, true))
    await flush()
    expect(asked.map(a => a.length)).toEqual([50, 10])
  })

  it('невалидный id не спрашивается и не «грузится»', async () => {
    const { result } = renderHook(() => useVideoTitles(['short', A], true))
    await flush()
    expect(asked).toEqual([[A]])
    expect(result.current.loading('short')).toBe(false)
    expect(result.current.titleOf('short')).toBeNull()
  })

  it('размонтирование во время запроса: поздний ответ игнорируется, таймеров повтора нет', async () => {
    let release!: (r: Response) => void
    reply = () => new Promise<Response>(res => { release = res })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { unmount } = renderHook(() => useVideoTitles([A], true))
    await flush()
    unmount()
    await act(async () => { release(json(200, { titles: {}, pending: [A] })) })
    await tick(200_000)
    expect(asked).toHaveLength(1)
    expect(err).not.toHaveBeenCalled()
    err.mockRestore()
  })

  it('размонтирование во время ожидания повтора: таймер снят', async () => {
    reply = () => json(200, { titles: {}, pending: [A] })
    const { unmount } = renderHook(() => useVideoTitles([A], true))
    await flush()
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
    await tick(200_000)
    expect(asked).toHaveLength(1)
  })

  it('после неудачи повтора через 15 с «Загружаем…» гаснет; повтор через 65 с молча приносит название', async () => {
    reply = (ids, n) => (n < 4 ? json(200, { titles: {}, pending: ids }) : json(200, { titles: { [A]: 'Late' }, pending: [] }))
    const { result } = renderHook(() => useVideoTitles([A], true))
    await flush()
    expect(result.current.loading(A)).toBe(true)
    await tick(5_000)
    expect(result.current.loading(A)).toBe(true)
    await tick(15_000)
    expect(asked).toHaveLength(3)
    expect(result.current.loading(A)).toBe(false)
    expect(result.current.titleOf(A)).toBeNull()
    await tick(65_000)
    expect(asked).toHaveLength(4)
    expect(result.current.titleOf(A)).toBe('Late')
  })

  it('отказ после трёх повторов (5, 15, 65 с); смена набора спрашивает снова и показывает «грузится» без мигания', async () => {
    reply = () => json(200, { titles: {}, pending: [A] })
    const { result, rerender } = renderHook(({ ids }) => useVideoTitles(ids, true), { initialProps: { ids: [A] } })
    await flush()
    await tick(5_000)
    await tick(15_000)
    await tick(65_000)
    expect(asked).toHaveLength(4)
    expect(result.current.loading(A)).toBe(false)
    await tick(300_000)
    expect(asked).toHaveLength(4)
    rerender({ ids: [A, B] })
    await flush()
    expect(asked[4].sort()).toEqual([A, B])
    expect(result.current.loading(A)).toBe(true)
  })

  it('ответ не той формы (titles не объект, pending не массив, не объект) = повтор всей пачки', async () => {
    const bad: unknown[] = [null, 'x', [], { titles: [], pending: [] }, { titles: {}, pending: 'a' }, { titles: {} }]
    let i = 0
    reply = () => json(200, bad[i++ % bad.length])
    const { result } = renderHook(() => useVideoTitles([A], true))
    await flush()
    expect(asked).toHaveLength(1)
    expect(result.current.loading(A)).toBe(true)
    await tick(5_000)
    expect(asked).toHaveLength(2)
  })

  it('отклонённый fetch не оставляет «Загружаем…» навсегда', async () => {
    reply = () => Promise.reject(new TypeError('net'))
    const { result } = renderHook(() => useVideoTitles([A], true))
    await flush()
    await tick(5_000)
    await tick(15_000)
    await tick(65_000)
    expect(asked).toHaveLength(4)
    expect(result.current.loading(A)).toBe(false)
  })

  it('enabled=false: запросов нет, loading всегда false', async () => {
    const { result } = renderHook(() => useVideoTitles([A], false))
    await flush()
    expect(asked).toHaveLength(0)
    expect(result.current.loading(A)).toBe(false)
  })

  describe('смена сессии', () => {
    const X = id(7)
    let cur = ''
    const byWho = () => json(200, { titles: cur === 'tpk_aaaa' ? { [X]: 'A-title' } : {}, pending: [] })
    const login = (prefix: string) => act(() => {
      cur = prefix
      __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: prefix, routeAllowed: true, demo: false }, true)
    })
    const logout = () => act(() => { cur = ''; __setSessionForTests({ cabinet: true, authenticated: false }, true) })

    it('название ключа A не показывается ключу B после выхода и входа (без перезагрузки)', async () => {
      reply = byWho
      await login('tpk_aaaa')
      const { result } = renderHook(() => useVideoTitles([X], true))
      await flush()
      expect(result.current.titleOf(X)).toBe('A-title')
      const before = asked.length
      await logout()
      await login('tpk_bbbb')
      await flush()
      expect(asked.length).toBeGreaterThan(before) // B спросил сам
      expect(result.current.titleOf(X)).toBeNull()
    })

    it('поздний ответ A при смене сессии на месте не показывается под B', async () => {
      const held: Array<(r: Response) => void> = []
      reply = () => new Promise<Response>(res => { held.push(res) })
      await login('tpk_aaaa')
      const { result } = renderHook(() => useVideoTitles([X], true))
      await flush()
      await login('tpk_bbbb')
      await flush()
      expect(asked).toHaveLength(2)
      await act(async () => { held[0](json(200, { titles: { [X]: 'A-late' }, pending: [] })) })
      expect(result.current.titleOf(X)).toBeNull()
      await act(async () => { held[1](json(200, { titles: { [X]: 'B-title' }, pending: [] })) })
      expect(result.current.titleOf(X)).toBe('B-title')
    })

    it('промах под B не прячет название A: A спрашивает заново и получает своё', async () => {
      reply = byWho
      await login('tpk_aaaa')
      const { result } = renderHook(() => useVideoTitles([X], true))
      await flush()
      await logout()
      await login('tpk_bbbb')
      await flush()
      expect(result.current.titleOf(X)).toBeNull()
      await logout()
      await login('tpk_aaaa')
      await flush()
      expect(result.current.titleOf(X)).toBe('A-title')
    })

    it('вход другим ключом с тем же префиксом тоже очищает', async () => {
      reply = (_ids, n) => json(200, n === 1 ? { titles: { [X]: 'first' }, pending: [] } : { titles: {}, pending: [] })
      await login('tpk_same')
      const { result } = renderHook(() => useVideoTitles([X], true))
      await flush()
      expect(result.current.titleOf(X)).toBe('first')
      await login('tpk_same')
      await flush()
      expect(asked).toHaveLength(2)
      expect(result.current.titleOf(X)).toBeNull()
    })

    it('смена сессии снимает таймеры повторов прежней', async () => {
      reply = () => json(200, { titles: {}, pending: [X] })
      await login('tpk_aaaa')
      renderHook(() => useVideoTitles([X], true))
      await flush()
      expect(vi.getTimerCount()).toBe(1)
      await login('tpk_bbbb')
      await flush()
      expect(asked).toHaveLength(2) // новый спрос сразу, без ожидания таймера прежней сессии
      expect(vi.getTimerCount()).toBe(1) // только таймер новой
    })
  })
})
