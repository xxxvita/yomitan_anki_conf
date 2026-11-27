// Сохранённая петля A–B + старт из ссылки (?t=): петля не должна сама стартовать/перематывать,
// пока t не «съеден». Тот же смысл, что у onUserSeek: t вне [A,B) → луп выключен, диапазон цел.
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useWorkspace } from '../useWorkspace'
import { makeFakeAdapter } from '../../../adapter/__tests__/fake'

const cues = [{ start: 0, end: 2 }]
beforeEach(() => { localStorage.clear() })
const save = (o: object = {}) => localStorage.setItem('flib:ws:vid', JSON.stringify({
  rangeStart: 10, rangeEnd: 20, viewStart: 0, viewEnd: 600, looping: true, pauseAtEnd: 2, ...o }))
const open = (linkStart: number | undefined, duration = 600, t = 0) => {
  const a = makeFakeAdapter({ duration, t })
  const r = renderHook(() => useWorkspace(a, cues, 'vid', false, undefined, undefined, undefined, linkStart))
  return { a, ...r }
}

describe('useWorkspace: сохранённая петля и t из ссылки', () => {
  it('t после B: диапазон восстановлен, looping=false', () => {
    save()
    const { result } = open(100)
    expect(result.current.rangeStart).toBe(10); expect(result.current.rangeEnd).toBe(20)
    expect(result.current.pauseAtEnd).toBe(2)
    expect(result.current.looping).toBe(false)
  })
  it('t до A: looping=false', () => {
    save({ rangeStart: 200, rangeEnd: 210 })
    expect(open(100).result.current.looping).toBe(false)
  })
  it('t == B (полуинтервал [A,B)): looping=false', () => {
    save()
    expect(open(20).result.current.looping).toBe(false)
  })
  it('t == A: внутри, петля сохранена', () => {
    save()
    expect(open(10).result.current.looping).toBe(true)
  })
  it('t внутри [A,B): петля сохранена', () => {
    save({ rangeStart: 95, rangeEnd: 105 })
    expect(open(100).result.current.looping).toBe(true)
  })
  it('без t: как раньше (looping=true)', () => {
    save()
    expect(open(undefined).result.current.looping).toBe(true)
  })
  it('t ≥ длительности (старт будет с 0): как раньше', () => {
    save()
    expect(open(600, 600).result.current.looping).toBe(true)
    expect(open(900, 600).result.current.looping).toBe(true)
  })
  it('сохранённый looping=false остаётся false при любом t', () => {
    save({ looping: false })
    expect(open(15).result.current.looping).toBe(false)
  })
  it('нет сохранённого состояния: дефолтный сид, looping=false', () => {
    const { result } = open(100)
    expect(result.current.looping).toBe(false); expect(result.current.rangeEnd).toBe(6)
  })
  it('t читается через ref: смена linkStart после восстановления ничего не пересеивает', () => {
    save()
    const a = makeFakeAdapter({ duration: 600 })
    const { result, rerender } = renderHook(({ ls }: { ls?: number }) =>
      useWorkspace(a, cues, 'vid', false, undefined, undefined, undefined, ls), { initialProps: { ls: 100 as number | undefined } })
    expect(result.current.looping).toBe(false)
    act(() => { result.current.setABLoop(10, 20) })
    rerender({ ls: undefined })
    expect(result.current.looping).toBe(true)
  })
  it('rAF-монитор: при t после B ни seek, ни play без клика', async () => {
    save()
    const { a } = open(100, 600, 100)
    const calls: string[] = []; a._spy = (m) => calls.push(m)
    await act(async () => { await new Promise(r => setTimeout(r, 150)) })
    expect(calls).toEqual([])
  })
  it('контроль: без t та же петля при времени после B перематывает на A', async () => {
    save()
    const { a } = open(undefined, 600, 100)
    const calls: string[] = []; a._spy = (m) => calls.push(m)
    await act(async () => { await new Promise(r => setTimeout(r, 150)) })
    expect(calls).toContain('seek:10')
  })
})
