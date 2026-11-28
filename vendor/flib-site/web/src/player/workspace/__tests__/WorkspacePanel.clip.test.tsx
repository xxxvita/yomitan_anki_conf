// WorkspacePanel.clip.test.tsx
// T1 (fb#6): элементы таймлайна не должны быть видимы/кликабельны за
// горизонтальными границами плеера. Структурный контракт клип-обёртки:
// вокруг data-workspace-bar есть контейнер с overflow-x:clip + overflow-y:visible
// (клип только по X, вертикальный выступ печатей/caps сохранён). Реальный клип
// пикселей проверяется live-шагом — jsdom не считает layout.
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { WorkspacePanel } from '../WorkspacePanel'
// Изменение после фактчека: путь был `../../adapter/__tests__/fake` (2 уровня
// вверх) — резолвится в несуществующий `src/player/adapter/__tests__/fake` и
// ломает импорт (BLOCKER, найден фактчеком). Реальный файл — `src/adapter/__tests__/fake.ts`,
// от `src/player/workspace/__tests__/` это 3 уровня вверх — так же, как во ВСЕХ
// 8 соседних тестах в этой папке (WorkspacePanel.handles.test.tsx и др.), потому
// исправлено на `../../../adapter/__tests__/fake`.
import { makeFakeAdapter } from '../../../adapter/__tests__/fake'

function makeWs(overrides: Partial<{ rangeStart: number; rangeEnd: number; viewStart: number; viewEnd: number }>) {
  return {
    rangeStart: 0, rangeEnd: 0, looping: false, pauseAtEnd: 0, viewStart: 0, viewEnd: 60,
    setABLoop() {}, toggleABLoop() {}, onUserSeek() {}, setPauseAtEnd() {}, stopLoop() {},
    setView() {}, zoom() {}, fitToRange() {}, setRange() {}, _boundaryTickForTest() {}, countdownValue: null,
    ...overrides,
  } as any
}

describe('WorkspacePanel — timeline clip container (T1 / fb#6)', () => {
  it('wraps the timeline in a clip container that clips X and keeps Y visible', () => {
    const adapter = makeFakeAdapter({ duration: 200, t: 0 })
    const ws = makeWs({ viewStart: 0, viewEnd: 60 })
    const { container } = render(
      <WorkspacePanel ws={ws} cues={[]} adapter={adapter} activeIndex={-1} waveform={null}
        variant="refined" currentTime={0} playing={false} muted={false} />
    )
    const bar = container.querySelector('[data-workspace-bar]') as HTMLElement
    expect(bar).not.toBeNull()
    // Клип-обёртка = прямой родитель data-workspace-bar (внутри .workspace-lift).
    const clip = bar.parentElement as HTMLElement
    expect(clip).not.toBeNull()
    expect(clip.getAttribute('data-timeline-clip')).toBe('')
    expect(clip.style.overflowX).toBe('clip')
    expect(clip.style.overflowY).toBe('visible')
    // Асимметричный трюк: панель не сдвигается (marginLeft компенсирует paddingLeft).
    expect(clip.style.marginLeft).toBe('-40px')
    expect(clip.style.paddingLeft).toBe('40px')
  })
})
