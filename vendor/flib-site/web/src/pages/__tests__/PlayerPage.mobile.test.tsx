// [ID:P-mobile] — реальный PlayerPage-монтаж (тот же mockAdapterHolder-паттерн,
// что PlayerPage.test.tsx использует для десктопных сценариев), только с
// matchMedia('(pointer: coarse)') замоканным на true — воспроизводит мобильную
// ветку раскладки: workspace свёрнут по умолчанию + bottom-sheet кнопка в
// тонком баре, вместо десктопной in-flow панели/полноширинного reopen.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PlayerPage } from '../PlayerPage'

const mockAdapterHolder = vi.hoisted(() => ({ adapter: null as any }))

vi.mock('../../adapter/IFrameAdapter', () => ({
  createIFrameAdapter: async () => {
    const { makeFakeAdapter } = await import('../../adapter/__tests__/fake')
    mockAdapterHolder.adapter = makeFakeAdapter({ duration: 120, t: 30 })
    return mockAdapterHolder.adapter
  },
}))

function stubCoarsePointer(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no net'))))
  window.localStorage.clear()
  window.localStorage.setItem('flib:access', JSON.stringify({ shadowing: true, keyPrefix: 'tpk_test', checkedAt: new Date().toISOString() }))
  mockAdapterHolder.adapter = null
})

describe('PlayerPage — мобильная раскладка (matchMedia pointer:coarse → true)', () => {
  it('workspace свёрнут ПО УМОЛЧАНИЮ на мобиле (никакого [data-workspace-bar] на первом рендере), но кнопка bottom-sheet в тонком баре есть', async () => {
    stubCoarsePointer(true)
    const { container, getByTestId } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })

    expect(container.querySelector('[data-workspace-bar]')).toBeNull()
    expect(getByTestId('cb-ws-btn')).toBeTruthy()
    expect(getByTestId('cb-ws-btn').getAttribute('aria-pressed')).toBe('false')
  })

  it('desktop (matchMedia coarse=false, как в остальных сьютах): workspace открыт по умолчанию, cb-ws-btn отсутствует — регрессии нет', async () => {
    stubCoarsePointer(false)
    const { container, queryByTestId } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })

    expect(container.querySelector('[data-workspace-bar]')).toBeTruthy()
    expect(queryByTestId('cb-ws-btn')).toBeNull()
  })

  it('cb-ws-btn открывает workspace как bottom-sheet (тот же timelineCollapsed стейт, что Exit/Z/timeline-reopen)', async () => {
    stubCoarsePointer(true)
    const { container, getByTestId } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })

    fireEvent.click(getByTestId('cb-ws-btn'))
    expect(container.querySelector('[data-workspace-bar]')).toBeTruthy()
    expect(getByTestId('cb-ws-btn').getAttribute('aria-pressed')).toBe('true')
    // десктопная полноширинная "▸ Таймлайн"-полоса на мобиле не рендерится
    // повторно рядом с открытой панелью (нет двух независимых триггеров).
    expect(container.querySelector('[data-testid="timeline-reopen"]')).toBeNull()

    fireEvent.click(getByTestId('cb-ws-btn'))
    expect(container.querySelector('[data-workspace-bar]')).toBeNull()
    expect(getByTestId('cb-ws-btn').getAttribute('aria-pressed')).toBe('false')
  })

  it('controls-bar рендерится с mobile-пропом (data-testid стабилен) и video-topbar остаётся в DOM (не отнимает функциональность, только раскладку)', async () => {
    stubCoarsePointer(true)
    const { getByTestId } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })

    expect(getByTestId('controls-bar')).toBeTruthy()
    expect(getByTestId('video-topbar')).toBeTruthy()
    // субтитр-режим сегменты всё ещё доступны/кликабельны на мобиле (Задача 3
    // требует НЕ отнимать высоту, но не требует прятать функциональность).
    fireEvent.click(getByTestId('sub-mode-en'))
    expect(getByTestId('sub-mode-en').getAttribute('aria-pressed')).toBe('true')
  })

  it('тап по .player-stage (видео) не бросает — onTapStage подключён без адаптера/реальных таймеров, просто проверяем отсутствие краша при pointerdown на сцене', async () => {
    stubCoarsePointer(true)
    const { container } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    const stage = container.querySelector('.player-stage') as HTMLElement
    expect(stage).toBeTruthy()
    expect(() => fireEvent.pointerDown(stage)).not.toThrow()
  })

  // [ID:P-mobile-ws]: полевой тест на проде — открыть workspace было чем
  // (cb-ws-btn), закрыть ПРЯМО НА панели было нечем (владелец: "кнопки
  // убрать нашу панельку нет"). Сквозной тест через реальный PlayerPage:
  // открываем тонким баром, закрываем close-аффордансом самой панели,
  // проверяем что оба пути сходятся в ОДНО состояние (timelineCollapsed).
  it('ws-sheet-close (сама панель) сворачивает workspace тем же состоянием, что cb-ws-btn', async () => {
    stubCoarsePointer(true)
    const { container, getByTestId } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })

    // Открыть тонким баром.
    fireEvent.click(getByTestId('cb-ws-btn'))
    expect(container.querySelector('[data-workspace-bar]')).toBeTruthy()
    const closeBtn = getByTestId('ws-sheet-close')
    expect(closeBtn).toBeTruthy()

    // Закрыть С САМОЙ панели (не тонким баром) — ОДНО и то же состояние.
    fireEvent.click(closeBtn)
    expect(container.querySelector('[data-workspace-bar]')).toBeNull()
    expect(getByTestId('cb-ws-btn').getAttribute('aria-pressed')).toBe('false')
    // Панель размонтирована вместе с собой — reopen идёт снова через тонкий бар.
    expect(container.querySelector('[data-testid="ws-sheet-close"]')).toBeNull()
  })

  // Ревью v2a R2-C1: тап по видео с настоящим <iframe> до .player-stage не доходит,
  // и автоскрытые бары было не вернуть. Пока бары скрыты — над видео слой-ловушка;
  // тап по НЕМУ (а не по заглушке) показывает оба бара и ничего больше не делает.
  it('бары скрылись → слой-ловушка; тап по нему показывает оба бара без побочных эффектов (seek/play/pause/mute/лист/fullscreen)', async () => {
    stubCoarsePointer(true)
    const rfs = vi.fn(() => Promise.resolve())
    const origRfs = HTMLElement.prototype.requestFullscreen
    HTMLElement.prototype.requestFullscreen = rfs as unknown as typeof origRfs
    try {
      const { container, getByTestId, queryByTestId } = render(
        <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
      )
      await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
      const a = mockAdapterHolder.adapter
      const calls: string[] = []
      a._spy = (m: string) => calls.push(m)
      const mutedBefore = a.muted()

      // Бары видимы — слоя нет (тапы идут в YouTube/контролы как раньше).
      expect(queryByTestId('stage-reveal')).toBeNull()
      // Автоскрытие (~3 с) → слой появился.
      await waitFor(() => {
        expect(getByTestId('controls-bar').className.split(' ')).toContain('cb-hidden')
        expect(getByTestId('video-topbar').className.split(' ')).toContain('vtb-hidden')
        expect(queryByTestId('stage-reveal')).toBeTruthy()
      }, { timeout: 5000 })

      const catcher = getByTestId('stage-reveal')
      fireEvent.pointerDown(catcher)
      // Касание ещё идёт — слой обязан дожить до click, иначе click уйдёт на кнопку бара.
      expect(queryByTestId('stage-reveal')).toBe(catcher)
      fireEvent.pointerUp(catcher)
      fireEvent.click(catcher)

      expect(getByTestId('controls-bar').className.split(' ')).not.toContain('cb-hidden')
      expect(getByTestId('video-topbar').className.split(' ')).not.toContain('vtb-hidden')
      expect(queryByTestId('stage-reveal')).toBeNull()
      expect(calls).toEqual([])                       // ни seek, ни play, ни pause
      expect(a.muted()).toBe(mutedBefore)              // звук не тронут
      expect(container.querySelector('[data-workspace-bar]')).toBeNull() // лист не открыт
      expect(rfs).not.toHaveBeenCalled()               // fullscreen не включён
      expect(container.querySelector('.fs-root')!.className).not.toContain('fs-pseudo')

      // Таймер перевзведён: бары снова гаснут, слой возвращается.
      await waitFor(() => { expect(queryByTestId('stage-reveal')).toBeTruthy() }, { timeout: 5000 })
    } finally {
      HTMLElement.prototype.requestFullscreen = origRfs
    }
  }, 20_000)

  it('desktop (coarse=false): бары не скрываются, слоя-ловушки нет никогда', async () => {
    stubCoarsePointer(false)
    const { getByTestId, queryByTestId } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await new Promise(r => setTimeout(r, 3500))
    expect(getByTestId('controls-bar').className.split(' ')).not.toContain('cb-hidden')
    expect(queryByTestId('stage-reveal')).toBeNull()
  }, 20_000)

  it('desktop (matchMedia coarse=false): ws-sheet-close НИКОГДА не рендерится, даже когда workspace открыт по умолчанию — десктоп-путь не задет', async () => {
    stubCoarsePointer(false)
    const { container, queryByTestId } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })

    expect(container.querySelector('[data-workspace-bar]')).toBeTruthy() // открыт по умолчанию (десктоп-канон)
    expect(queryByTestId('ws-sheet-close')).toBeNull()
  })
})
