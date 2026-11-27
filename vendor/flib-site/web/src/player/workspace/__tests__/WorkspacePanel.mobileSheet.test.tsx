// WorkspacePanel.mobileSheet.test.tsx — [ID:P-mobile-ws]
// Полевой тест на проде вскрыл два бага в мобильной bottom-sheet-раскладке
// (см. WorkspacePanel.tsx doc у корневого div и app.css `.workspace-lift`):
//   BUG-1: инлайновый `position: 'relative'` на корневом `.workspace-lift`
//          БЕЗУСЛОВНО перебивал CSS-правило `position: absolute` под
//          `@media (pointer: coarse)` (инлайн-стиль всегда выигрывает у
//          любого CSS-правила вне зависимости от специфичности/медиа-запроса)
//          — панель оставалась В ПОТОКЕ и крала высоту у .player-stage.
//          jsdom не гоняет реальные @media-правила из app.css (CSS в этом
//          тестовом окружении не инжектится вовсе — vitest.config.ts не
//          включает `css: true`), поэтому здесь мы можем проверить только
//          то, что инлайн-стиль БОЛЬШЕ НЕ навязывает `position` (регрессия
//          именно в этом — конкретное значение absolute/relative уже решает
//          чистый CSS-каскад, вне охвата unit-теста).
//   BUG-2: открыть панель было чем (cb-ws-btn), закрыть — нечем ПРЯМО НА
//          панели (только через тот же далёкий тонкий бар). Добавлен
//          top-of-sheet close-аффорданс (`ws-sheet-close`), мобильный-only.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { WorkspacePanel } from '../WorkspacePanel'
import { makeFakeAdapter } from '../../../adapter/__tests__/fake'

beforeEach(() => {
  window.localStorage.clear()
  window.localStorage.setItem('flib:access', JSON.stringify({ shadowing: true, keyPrefix: 'tpk_test', checkedAt: new Date().toISOString() }))
})

function makeWs() {
  return {
    rangeStart: 0, rangeEnd: 0, looping: false, pauseAtEnd: 0, viewStart: 0, viewEnd: 60,
    setABLoop() {}, toggleABLoop() {}, onUserSeek() {}, setPauseAtEnd() {}, stopLoop() {},
    setView() {}, zoom() {}, fitToRange() {}, setRange() {}, _boundaryTickForTest() {}, countdownValue: null,
  } as any
}

describe('WorkspacePanel — мобильный bottom-sheet close-аффорданс (P-mobile-ws)', () => {
  it('BUG-1 регрессия: корневой .workspace-lift больше не навязывает inline position — CSS-каскад (app.css @media pointer:coarse) волен решать сам', () => {
    const adapter = makeFakeAdapter({ duration: 100, t: 0 })
    const { container } = render(
      <WorkspacePanel ws={makeWs()} cues={[]} adapter={adapter} activeIndex={-1} waveform={null}
        variant="refined" currentTime={0} playing={false} muted={false} mobile
      />
    )
    const lift = container.querySelector('.workspace-lift') as HTMLElement
    expect(lift).toBeTruthy()
    // Пусто — значит НЕТ инлайн-перебивки; раньше здесь было 'relative'
    // байт-в-байт вне зависимости от mobile, что и глушило мобильный CSS.
    expect(lift.style.position).toBe('')
  })

  it('mobile=true: close-аффорданс (ручка + "Свернуть") рендерится и зовёт onExit', () => {
    const onExit = vi.fn()
    const adapter = makeFakeAdapter({ duration: 100, t: 0 })
    const { getByTestId } = render(
      <WorkspacePanel ws={makeWs()} cues={[]} adapter={adapter} activeIndex={-1} waveform={null}
        variant="refined" currentTime={0} playing={false} muted={false} mobile onExit={onExit}
      />
    )
    const closeBtn = getByTestId('ws-sheet-close')
    expect(closeBtn).toBeTruthy()
    expect(closeBtn.querySelector('.ws-sheet-handle')).toBeTruthy()
    fireEvent.click(closeBtn)
    expect(onExit).toHaveBeenCalledTimes(1)
  })

  it('mobile не передан (десктопный путь по умолчанию): close-аффорданс НЕ рендерится — DOM байт-в-байт как до задачи', () => {
    const adapter = makeFakeAdapter({ duration: 100, t: 0 })
    const { queryByTestId } = render(
      <WorkspacePanel ws={makeWs()} cues={[]} adapter={adapter} activeIndex={-1} waveform={null}
        variant="refined" currentTime={0} playing={false} muted={false}
      />
    )
    expect(queryByTestId('ws-sheet-close')).toBeNull()
  })

  it('mobile={false} явно: тот же результат — не рендерится', () => {
    const adapter = makeFakeAdapter({ duration: 100, t: 0 })
    const { queryByTestId } = render(
      <WorkspacePanel ws={makeWs()} cues={[]} adapter={adapter} activeIndex={-1} waveform={null}
        variant="refined" currentTime={0} playing={false} muted={false} mobile={false}
      />
    )
    expect(queryByTestId('ws-sheet-close')).toBeNull()
  })
})
