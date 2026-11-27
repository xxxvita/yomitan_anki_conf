// RouteBlock: текст после apply зависит от годности прогона и числа учтённых слов (спека Р-9).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { RouteBlock, type ApplyUi } from './RouteBlock'

// Состояние маршрута: null — неизвестно, false — не начат, true — начат.
let routeStarted: boolean | null = null
vi.mock('../../route/use-route-state', () => ({
  useRouteState: () => ({ read: routeStarted === null ? null : { result: { ok: true, data: { started: routeStarted } } } }),
}))

afterEach(() => { cleanup(); vi.unstubAllGlobals(); routeStarted = null })

function show(state: ApplyUi, flags: string[]) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })))
  render(<MemoryRouter><RouteBlock lang="ru" state={state} flags={flags} onApply={() => {}} /></MemoryRouter>)
}
const DONE = 'Готово: маршрут учтёт эти слова при следующем подборе видео.'
const INEXACT = 'Результат неточный, поэтому маршрут его слова не использует.'
const FLOOR = 'Маршрут начнёт с самых простых слов.'

describe('RouteBlock: невалидные прогоны', () => {
  it('валидный: «Готово» и счётчик', () => {
    show({ k: 'done', counted: 3 }, [])
    expect(screen.getByText(DONE)).toBeTruthy()
    expect(screen.getByText('Учтено слов: 3')).toBeTruthy()
  })
  it('неточный (yeasayer/careless/no_audio), учтено 0: вместо «Готово» — неточный результат', () => {
    for (const f of ['yeasayer', 'careless', 'no_audio']) {
      cleanup()
      show({ k: 'done', counted: 0 }, [f])
      expect(screen.getByText(INEXACT)).toBeTruthy()
      expect(screen.queryByText(DONE)).toBeNull()
    }
  })
  it('floor, учтено 0, маршрут не начат: строка про самые простые слова, не «Готово» и не «неточный»', () => {
    routeStarted = false
    show({ k: 'done', counted: 0 }, ['floor'])
    expect(screen.getByText(FLOOR)).toBeTruthy()
    expect(screen.queryByText(DONE)).toBeNull()
    expect(screen.queryByText(INEXACT)).toBeNull()
  })
  it('floor, учтено 0, маршрут начат или неизвестен — «неточный» вместо обещания; floor + no_audio — тоже «неточный»', () => {
    for (const started of [true, null]) {
      cleanup(); routeStarted = started
      show({ k: 'done', counted: 0 }, ['floor'])
      expect(screen.getByText(INEXACT)).toBeTruthy()
      expect(screen.queryByText(FLOOR)).toBeNull()
    }
    cleanup(); routeStarted = false
    show({ k: 'done', counted: 0 }, ['floor', 'no_audio'])
    expect(screen.getByText(INEXACT)).toBeTruthy()
    expect(screen.queryByText(FLOOR)).toBeNull()
  })
  it('валидный, учтено 0: «Готово» не обещаем', () => {
    show({ k: 'done', counted: 0 }, [])
    expect(screen.queryByText(DONE)).toBeNull()
  })
  it('невалидный, но слова учтены (заменил слова прошлого теста) — «Готово» и число', () => {
    show({ k: 'done', counted: 5 }, ['floor'])
    expect(screen.getByText(DONE)).toBeTruthy()
    expect(screen.getByText('Учтено слов: 5')).toBeTruthy()
  })
  it('применён раньше, число неизвестно: неточный — «Результат неточный.» без обещаний; floor и валидный — ничего лишнего', () => {
    show({ k: 'idle' }, ['yeasayer'])
    expect(screen.getByText('Результат неточный.')).toBeTruthy()
    cleanup()
    show({ k: 'idle' }, ['floor'])
    expect(screen.queryByText('Результат неточный.')).toBeNull()
    expect(screen.queryByText(DONE)).toBeNull()
    cleanup()
    show({ k: 'idle' }, [])
    expect(screen.queryByText('Результат неточный.')).toBeNull()
  })
})
