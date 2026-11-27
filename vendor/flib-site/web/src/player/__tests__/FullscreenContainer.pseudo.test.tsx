// [ID:P-mobile] — псевдо-фуллскрин фолбэк (iOS Chrome/Safari: div.requestFullscreen
// отсутствует или реджектится). См. FullscreenContainer.tsx top doc для полного
// разбора трёх состояний (off/native/pseudo). FullscreenContainer.test.tsx (соседний
// файл) остаётся НЕТРОНУТЫМ — покрывает нативный путь, этот файл добавляет
// сценарии ПОВЕРХ него, не переписывая существующее покрытие.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, act } from '@testing-library/react'
import { createRef } from 'react'
import { FullscreenContainer, type FullscreenHandle } from '../components/FullscreenContainer'

afterEach(() => {
  // @ts-expect-error — тестовый стаб между тестами
  delete HTMLElement.prototype.requestFullscreen
  vi.restoreAllMocks()
})

describe('FullscreenContainer — псевдо-фуллскрин (iOS фолбэк)', () => {
  it('requestFullscreen отсутствует на элементе → сразу псевдо-путь: класс fs-pseudo навешивается синхронно', () => {
    // @ts-expect-error — симулируем iOS-сборку без Fullscreen API на div вовсе
    delete HTMLElement.prototype.requestFullscreen
    const ref = createRef<FullscreenHandle>()
    const { getByTestId } = render(
      <FullscreenContainer ref={ref}><div data-testid="child" /></FullscreenContainer>
    )
    act(() => ref.current!.toggleFullscreen())
    const outer = getByTestId('fs-root')
    expect(outer.className.split(' ')).toContain('fs-pseudo')
    expect(ref.current!.isFullscreen).toBe(true)
  })

  it('Escape снимает псевдо-фуллскрин', () => {
    // @ts-expect-error
    delete HTMLElement.prototype.requestFullscreen
    const ref = createRef<FullscreenHandle>()
    const { getByTestId } = render(
      <FullscreenContainer ref={ref}><div data-testid="child" /></FullscreenContainer>
    )
    act(() => ref.current!.toggleFullscreen())
    expect(getByTestId('fs-root').className.split(' ')).toContain('fs-pseudo')
    act(() => { fireEvent.keyDown(window, { key: 'Escape' }) })
    expect(getByTestId('fs-root').className.split(' ')).not.toContain('fs-pseudo')
    expect(ref.current!.isFullscreen).toBe(false)
  })

  it('requestFullscreen существует, но промис реджектится (iOS WebKit) → фолбэк на псевдо', async () => {
    HTMLElement.prototype.requestFullscreen = vi.fn(() => Promise.reject(new Error('not supported')))
    const ref = createRef<FullscreenHandle>()
    const { getByTestId } = render(
      <FullscreenContainer ref={ref}><div data-testid="child" /></FullscreenContainer>
    )
    await act(async () => { ref.current!.toggleFullscreen(); await Promise.resolve(); await Promise.resolve() })
    expect(getByTestId('fs-root').className.split(' ')).toContain('fs-pseudo')
  })

  it('повторный toggle тогглит псевдо-режим (вкл → выкл через кнопку/хоткей, не только Escape)', () => {
    // @ts-expect-error
    delete HTMLElement.prototype.requestFullscreen
    const ref = createRef<FullscreenHandle>()
    const { getByTestId } = render(
      <FullscreenContainer ref={ref}><div data-testid="child" /></FullscreenContainer>
    )
    act(() => ref.current!.toggleFullscreen())
    expect(getByTestId('fs-root').className.split(' ')).toContain('fs-pseudo')
    act(() => ref.current!.toggleFullscreen())
    expect(getByTestId('fs-root').className.split(' ')).not.toContain('fs-pseudo')
    expect(ref.current!.isFullscreen).toBe(false)
  })

  it('popstate (Android back) снимает псевдо-фуллскрин', () => {
    // @ts-expect-error
    delete HTMLElement.prototype.requestFullscreen
    const pushSpy = vi.spyOn(window.history, 'pushState')
    const ref = createRef<FullscreenHandle>()
    const { getByTestId } = render(
      <FullscreenContainer ref={ref}><div data-testid="child" /></FullscreenContainer>
    )
    act(() => ref.current!.toggleFullscreen())
    expect(pushSpy).toHaveBeenCalled() // вход взвёл history-запись под back
    expect(getByTestId('fs-root').className.split(' ')).toContain('fs-pseudo')
    act(() => { window.dispatchEvent(new PopStateEvent('popstate')) })
    expect(getByTestId('fs-root').className.split(' ')).not.toContain('fs-pseudo')
  })

  it('нативный путь остаётся приоритетным, когда API реально поддержан (не регрессия к всегда-псевдо)', () => {
    const rfs = vi.fn(() => Promise.resolve())
    HTMLElement.prototype.requestFullscreen = rfs
    const ref = createRef<FullscreenHandle>()
    const { getByTestId } = render(
      <FullscreenContainer ref={ref}><div data-testid="child" /></FullscreenContainer>
    )
    act(() => ref.current!.toggleFullscreen())
    expect(rfs).toHaveBeenCalled()
    expect(getByTestId('fs-root').className.split(' ')).not.toContain('fs-pseudo') // нативный путь — без CSS-фолбэка
  })
})
