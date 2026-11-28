// [ID:P-mobile] — интеграция VideoControlsBar + useAutoHideControls, тот же
// wiring, что PlayerPage реально собирает (mobile/visible/onScrubbingChange/
// onToggleWorkspace). Полный PlayerPage слишком тяжёл для юнит-монтажа (адаптеры/
// роутинг/десятки хуков) — этот харнесс воспроизводит РОВНО контракт между
// хуком и баром, тот же приём, что Harness в VideoControlsBar.muteIntent.test.tsx.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, fireEvent, act } from '@testing-library/react'
import { useState } from 'react'
import { VideoControlsBar } from '../VideoControlsBar'
import { useAutoHideControls } from '../../hooks/useAutoHideControls'
import { makeFakeAdapter } from '../../../adapter/__tests__/fake'
import type { PlayerState } from '../../hooks/usePlayerState'

const st = (o: Partial<PlayerState> = {}): PlayerState => ({ paused: true, muted: false, volume: 100, rate: 1, buffering: false, duration: 100, currentTime: 0, ...o })

function Harness({ mobile }: { mobile: boolean }) {
  const autoHide = useAutoHideControls(mobile, 3000)
  const [wsOpen, setWsOpen] = useState(false)
  const a = makeFakeAdapter({ t: 0 })
  return (
    <div>
      {/* Тап по "видео" — тот же хэндлер, что PlayerRoot's onTapStage. ⚠ Это div, а
          настоящий тап по видео уходит внутрь <iframe> YouTube и сюда не доходит
          (ревью v2a R2-C1) — реальный путь показа баров (слой-ловушка stage-reveal)
          проверяют PlayerRoot.revealCatcher.test.tsx и PlayerPage.mobile.test.tsx. */}
      <div data-testid="stage-tap-zone" onPointerDown={() => { if (mobile) autoHide.show() }} />
      <VideoControlsBar
        adapter={a}
        state={st()}
        ws={{ onUserSeek: () => {} }}
        mobile={mobile}
        visible={autoHide.visible}
        onScrubbingChange={autoHide.setDragging}
        onToggleWorkspace={mobile ? () => setWsOpen(v => !v) : undefined}
        workspaceOpen={wsOpen}
      />
    </div>
  )
}

describe('VideoControlsBar — мобильный автоскрывающийся оверлей (P-mobile)', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('desktop (mobile=false): controls-bar никогда не получает cb-hidden, даже спустя долгое бездействие', () => {
    const { getByTestId } = render(<Harness mobile={false} />)
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(getByTestId('controls-bar').className.split(' ')).not.toContain('cb-hidden')
  })

  // Ревью v2a R1-C1: скрытый бар не должен ловить касания (inline pointerEvents:'auto'
  // перебивал .cb-hidden { pointer-events: none } — тап по форме оценки глушил звук).
  it('mobile: скрытый бар не ловит касания (pointer-events none), видимый — ловит', () => {
    const { getByTestId } = render(<Harness mobile />)
    expect(getByTestId('controls-bar').style.pointerEvents).toBe('auto')
    act(() => { vi.advanceTimersByTime(3000) })
    expect(getByTestId('controls-bar').style.pointerEvents).toBe('none')
    act(() => { fireEvent.pointerDown(getByTestId('stage-tap-zone')) })
    expect(getByTestId('controls-bar').style.pointerEvents).toBe('auto')
  })

  it('mobile: автоскрывается через ~3с бездействия', () => {
    const { getByTestId } = render(<Harness mobile />)
    expect(getByTestId('controls-bar').className.split(' ')).not.toContain('cb-hidden')
    act(() => { vi.advanceTimersByTime(3000) })
    expect(getByTestId('controls-bar').className.split(' ')).toContain('cb-hidden')
  })

  it('mobile: тап на видео (stage-tap-zone) показывает бар и перевзводит таймер', () => {
    const { getByTestId } = render(<Harness mobile />)
    act(() => { vi.advanceTimersByTime(3000) })
    expect(getByTestId('controls-bar').className.split(' ')).toContain('cb-hidden')
    act(() => { fireEvent.pointerDown(getByTestId('stage-tap-zone')) })
    expect(getByTestId('controls-bar').className.split(' ')).not.toContain('cb-hidden')
    act(() => { vi.advanceTimersByTime(2999) })
    expect(getByTestId('controls-bar').className.split(' ')).not.toContain('cb-hidden')
    act(() => { vi.advanceTimersByTime(1) })
    expect(getByTestId('controls-bar').className.split(' ')).toContain('cb-hidden')
  })

  it('mobile: драг сик-бара удерживает бар видимым дольше 3с, показ восстанавливает автоскрытие после отпускания', () => {
    const { getByTestId } = render(<Harness mobile />)
    const bar = getByTestId('seek-bar')
    bar.getBoundingClientRect = () => ({ left: 0, width: 100, top: 0, height: 6, right: 100, bottom: 6, x: 0, y: 0, toJSON() {} }) as DOMRect
    bar.setPointerCapture = vi.fn(); bar.releasePointerCapture = vi.fn()

    fireEvent.pointerDown(bar, { clientX: 10, pointerId: 1 })
    act(() => { vi.advanceTimersByTime(10_000) }) // далеко за пределами 3с — драг держит бар
    expect(getByTestId('controls-bar').className.split(' ')).not.toContain('cb-hidden')

    fireEvent.pointerUp(bar, { clientX: 80, pointerId: 1 })
    act(() => { vi.advanceTimersByTime(2999) })
    expect(getByTestId('controls-bar').className.split(' ')).not.toContain('cb-hidden')
    act(() => { vi.advanceTimersByTime(1) })
    expect(getByTestId('controls-bar').className.split(' ')).toContain('cb-hidden')
  })

  it('mobile: клик по кнопке в баре (mute) не гасит бар и не проваливается сквозь — тап-конфликт из брифа', () => {
    const { getByTestId } = render(<Harness mobile />)
    fireEvent.click(getByTestId('mute-btn')) // не должно бросить/уронить рендер
    expect(getByTestId('controls-bar').className.split(' ')).not.toContain('cb-hidden')
  })

  it('mobile: cb-ws-btn открывает bottom-sheet (workspaceOpen/aria-pressed toggles)', () => {
    const { getByTestId } = render(<Harness mobile />)
    const btn = getByTestId('cb-ws-btn')
    expect(btn.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(btn)
    expect(btn.getAttribute('aria-pressed')).toBe('true')
  })

  it('desktop: cb-ws-btn не рендерится вовсе (десктопный workspace — не bottom-sheet)', () => {
    const { queryByTestId } = render(<Harness mobile={false} />)
    expect(queryByTestId('cb-ws-btn')).toBeNull()
  })
})
