// web/src/player/hooks/__tests__/useWorkspace.loop.test.ts
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useWorkspace } from '../useWorkspace'
import { makeFakeAdapter } from '../../../adapter/__tests__/fake'

const cues = [{ start: 0, end: 2 }, { start: 2, end: 4 }]

describe('useWorkspace loops', () => {
  it('line-loop sets range to the single cue bounds, looping on', () => {
    const a = makeFakeAdapter({ t: 2.5 }) // внутри cue[1] → без seek
    const { result } = renderHook(() => useWorkspace(a, cues))
    act(() => result.current.toggleABLoop(1))
    expect(result.current.rangeStart).toBe(2)
    expect(result.current.rangeEnd).toBe(4)
    expect(result.current.looping).toBe(true)
    expect(a._seekCount).toBe(0) // playhead уже в cue → seek(A) не нужен
  })

  it('toggling the same line-loop again flips looping off, keeps range (bookmark)', () => {
    const a = makeFakeAdapter({ t: 2.5 })
    const { result } = renderHook(() => useWorkspace(a, cues))
    act(() => result.current.toggleABLoop(1))
    act(() => result.current.toggleABLoop(1))
    expect(result.current.looping).toBe(false)
    expect(result.current.rangeStart).toBe(2) // границы остаются закладкой
    expect(result.current.rangeEnd).toBe(4)
  })

  it('line-loop seeks to cue start when playhead is outside the cue', () => {
    const a = makeFakeAdapter({ t: 9 }) // вне cue[1]
    const { result } = renderHook(() => useWorkspace(a, cues))
    act(() => result.current.toggleABLoop(1))
    // fake.seek не двигает currentTime (poll-lag) → ассерт на spy/_seekCount
    expect(a._seekCount).toBe(1)
  })

  it('rewind-on-enable: setABLoop seeks to A when playhead is past B', () => {
    const a = makeFakeAdapter({ t: 9 }) // ≥ b(4)
    const spy: string[] = []; a._spy = (m) => spy.push(m)
    const { result } = renderHook(() => useWorkspace(a, cues))
    act(() => result.current.setABLoop(2, 4))
    expect(a._seekCount).toBe(1)
    expect(spy).toContain('seek:2')
  })

  it('setABLoop does NOT seek when playhead already inside [A,B]', () => {
    const a = makeFakeAdapter({ t: 2.5 })
    const { result } = renderHook(() => useWorkspace(a, cues))
    act(() => result.current.setABLoop(2, 4))
    expect(a._seekCount).toBe(0)
  })

  it('auto-disable only on user click-seek OUTSIDE [A,B]', () => {
    const a = makeFakeAdapter({ t: 2.5 })
    const { result } = renderHook(() => useWorkspace(a, cues))
    act(() => result.current.setABLoop(2, 4))
    act(() => result.current.onUserSeek(3)) // внутри → луп жив
    expect(result.current.looping).toBe(true)
    act(() => result.current.onUserSeek(10)) // вне → выключить
    expect(result.current.looping).toBe(false)
  })

  it('is inert with a null adapter (no throw, state still moves)', () => {
    const { result } = renderHook(() => useWorkspace(null, cues))
    act(() => result.current.toggleABLoop(1))
    expect(result.current.looping).toBe(true) // state двигается, адаптер не трогается
    act(() => result.current.setABLoop(2, 4))
    expect(result.current.rangeEnd).toBe(4)
  })

  it('ignores toggle for an out-of-range cue index (empty cues)', () => {
    const a = makeFakeAdapter({ t: 0 })
    const { result } = renderHook(() => useWorkspace(a, []))
    act(() => result.current.toggleABLoop(0))
    expect(result.current.looping).toBe(false)
    expect(a._seekCount).toBe(0)
  })
})

describe('useWorkspace onPlayCommand (Play-в-луп, фидбек №7)', () => {
  // Сценарий 1: playhead=0, A=10,B=20, looping=true → Play сикает к A и играет
  it('paused + looping + playhead before A → seeks to rangeStart, then plays', () => {
    const a = makeFakeAdapter({ t: 0 }) // paused=true по умолчанию
    const spy: string[] = []; a._spy = (m) => spy.push(m)
    const { result } = renderHook(() => useWorkspace(a, cues))
    act(() => result.current.setABLoop(10, 20)) // t=0 < 20 → setABLoop сам НЕ сикает (гард >= b)
    expect(a._seekCount).toBe(0) // изоляция: сик далее — только от onPlayCommand
    act(() => result.current.onPlayCommand())
    expect(a._seekCount).toBe(1)
    expect(spy).toContain('seek:10') // сик именно к A=rangeStart
    expect(spy).toContain('play')
    expect(spy.indexOf('seek:10')).toBeLessThan(spy.indexOf('play')) // сик ПЕРЕД play
    expect(a.paused()).toBe(false)
  })

  // Сценарий 2: playhead внутри [A,B] → сик НЕ вызван
  it('paused + looping + playhead inside [A,B] → plays without seeking', () => {
    const a = makeFakeAdapter({ t: 15 }) // внутри [10,20]
    const { result } = renderHook(() => useWorkspace(a, cues))
    act(() => result.current.setABLoop(10, 20))
    expect(a._seekCount).toBe(0)
    act(() => result.current.onPlayCommand())
    expect(a._seekCount).toBe(0) // внутри диапазона — сик не нужен
    expect(a.paused()).toBe(false)
  })

  // Сценарий 3: looping=false → сик НЕ вызван (обычный play с текущей позиции)
  // NB: даже если был диапазон, stopLoop отключает луп → onPlayCommand не применит его гард
  it('paused + NOT looping → plays from current position, no seek', () => {
    const a = makeFakeAdapter({ t: 0 })
    const { result } = renderHook(() => useWorkspace(a, cues))
    // явно установить AB-loop вне дефолтного диапазона
    act(() => result.current.setABLoop(10, 20)) // t=0 < 20 → setABLoop сам НЕ сикает
    expect(a._seekCount).toBe(0)
    // выключить луп
    act(() => result.current.stopLoop())
    // looping=false, и хотя playhead вне бывшего диапазона [10,20],
    // критерий s.looping && ... не пройдёт → сик не вызван
    act(() => result.current.onPlayCommand())
    expect(a._seekCount).toBe(0)
    expect(a.paused()).toBe(false)
  })

  // Сценарий 4: suspended=true → сик НЕ вызван даже при активном лупе вне диапазона
  it('paused + looping + playhead outside but enforcementSuspended → plays, no seek', () => {
    const a = makeFakeAdapter({ t: 0 }) // t=0 вне [10,20]
    const { result } = renderHook(() => useWorkspace(a, cues, '', true)) // enforcementSuspended=true
    act(() => result.current.setABLoop(10, 20)) // setABLoop гардом >= b не сикает
    expect(a._seekCount).toBe(0)
    act(() => result.current.onPlayCommand())
    expect(a._seekCount).toBe(0) // suspendedRef.current=true гасит сик
    expect(a.paused()).toBe(false)
  })

  // Сценарий 5: адаптер играет → pause, сик не вызван
  it('playing → pauses, never seeks', () => {
    const a = makeFakeAdapter({ t: 0 })
    a.play() // paused=false
    const { result } = renderHook(() => useWorkspace(a, cues))
    act(() => result.current.setABLoop(10, 20))
    expect(a._seekCount).toBe(0)
    act(() => result.current.onPlayCommand())
    expect(a.paused()).toBe(true) // pause-ветка
    expect(a._seekCount).toBe(0)
  })

  // Сценарий 6 (добавлено фактчеком, IMPORTANT): t === rangeStart РОВНО — граница
  // включена в «внутри», сика НЕТ. Критерий `t < rangeStart` ложен при равенстве.
  // Без этого теста граница A никогда не проверяется числом, только t=0/t=15.
  it('t === rangeStart exactly (boundary) → inside, no seek', () => {
    const a = makeFakeAdapter({ t: 10 }) // РОВНО A
    const { result } = renderHook(() => useWorkspace(a, cues))
    act(() => result.current.setABLoop(10, 20)) // t=10 < 20 → setABLoop сам не сикает
    expect(a._seekCount).toBe(0)
    act(() => result.current.onPlayCommand())
    expect(a._seekCount).toBe(0) // t===A не удовлетворяет t<rangeStart → "внутри"
    expect(a.paused()).toBe(false)
  })

  // Сценарий 7 (добавлено фактчеком, IMPORTANT): t === rangeEnd РОВНО — граница
  // считается «вне», сик ЕСТЬ. Критерий `t >= rangeEnd` истинен при равенстве.
  // NB: setABLoop сам сикает 1 раз (его гард `currentTime() >= bb` истинен при t=20).
  // onPlayCommand затем сикает второй раз (его гард `t >= rangeEnd` истинен → ищет A).
  // Итого: _seekCount должен быть ровно 2.
  it('t === rangeEnd exactly (boundary) → outside, seek happens', () => {
    const a = makeFakeAdapter({ t: 20 }) // РОВНО B
    const { result } = renderHook(() => useWorkspace(a, cues))
    act(() => result.current.setABLoop(10, 20)) // t=20 >= bb(20) → setABLoop сикает 1 раз
    expect(a._seekCount).toBe(1)
    act(() => result.current.onPlayCommand())
    expect(a._seekCount).toBe(2) // onPlayCommand сикает второй раз (t >= rangeEnd → "вне")
    expect(a.paused()).toBe(false)
  })
})
