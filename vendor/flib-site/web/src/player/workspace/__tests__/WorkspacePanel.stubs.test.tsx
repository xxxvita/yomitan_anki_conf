// WorkspacePanel.stubs.test.tsx
// Seam test: proves the P1 stub-cuts are real (elements never render / are
// hidden), not just "we didn't wire the props so who knows". Two gates still
// hold, one is inverted by T4 (owner decision §1-2: the panel's transport
// row is now the MAIN transport, VideoControlsBar slimmed down to
// scrubber/time/mute/volume/rate/fullscreen — see WorkspacePanelThemed.tsx
// WEB-SEAM comment near the row):
//   1. dub combo — gated on `audSegments && audSegments.length > 0 &&
//      onSelectAudSegment`, all undefined from WorkspacePanel → absent from
//      the DOM entirely (not just visually hidden).
//   2. mute-selection buttons (Play selection / Mute selection) — gated on
//      `selection` state, which starts null and is only set by a G-drag
//      gesture we never perform here → absent from the DOM.
//   3. the transport row (prev/-5s/play/+5s/next/zoom/fit/pills/exit) —
//      T4: now visible (`display: 'flex'`) — it IS the transport in the
//      web build, VideoControlsBar no longer duplicates play/loop.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { WorkspacePanel } from '../WorkspacePanel'
import { makeFakeAdapter } from '../../../adapter/__tests__/fake'

// Э6 (Shadowing-гейт): пилюля «Шадоуинг» теперь disabled без flib:access —
// сидим доступ, второй тест ниже кликает 'Старт Шадоуинг' и ждёт onToggleShadow.
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

describe('WorkspacePanel — P1 stub cuts (seam)', () => {
  it('renders no dub combo / no selection buttons / transport row visible (T4)', () => {
    const adapter = makeFakeAdapter({ duration: 100, t: 0 })
    const { container, queryByTitle } = render(
      <WorkspacePanel ws={makeWs()} cues={[]} adapter={adapter} activeIndex={-1} waveform={null}
        variant="refined" currentTime={0} playing={false} muted={false} />
    )

    // Gate 1 — dub combo (AUD-track combobox): no audSegments passed → absent.
    expect(container.querySelector('[aria-label="Аудио-дорожка"]')).toBeNull()

    // Gate 2 — selection-driven buttons: no G-drag performed → `selection`
    // state stays null → these buttons never mount.
    expect(queryByTitle('Play selection')).toBeNull()
    expect(queryByTitle('Mute selection')).toBeNull()

    // Gate 3 — transport row: present AND visible (T4) — it is the main
    // transport in the web build now, not a hidden duplicate.
    const playBtn = container.querySelector('[data-tour="player-play"]')
    expect(playBtn).toBeTruthy()
    const transportRow = playBtn!.parentElement as HTMLElement
    expect(transportRow.style.display).toBe('flex')
  })

  it('T4: pills render in the (now visible) transport row and fire their callbacks on click', () => {
    // Memory CRIT: assert the callback fired, not a hit-tested visual effect —
    // fireEvent dispatches directly on the node, no CSS pointer-events involved.
    const onToggleLoop = vi.fn()
    const onToggleShadow = vi.fn()
    const onToggleDictation = vi.fn()
    const onStartPuzzle = vi.fn()
    const onExit = vi.fn()
    const adapter = makeFakeAdapter({ duration: 100, t: 0 })
    const { getByTitle } = render(
      <WorkspacePanel ws={makeWs()} cues={[]} adapter={adapter} activeIndex={-1} waveform={null}
        variant="refined" currentTime={0} playing={false} muted={false}
        onToggleLoop={onToggleLoop} onToggleShadow={onToggleShadow}
        onToggleDictation={onToggleDictation} onStartPuzzle={onStartPuzzle} onExit={onExit}
      />
    )

    fireEvent.click(getByTitle('Старт Шадоуинг'))
    expect(onToggleShadow).toHaveBeenCalledTimes(1)

    fireEvent.click(getByTitle('Старт Диктант'))
    expect(onToggleDictation).toHaveBeenCalledTimes(1)

    fireEvent.click(getByTitle('Пазлы (тренировка)'))
    expect(onStartPuzzle).toHaveBeenCalledTimes(1)

    fireEvent.click(getByTitle('A-B повтор: вкл'))
    expect(onToggleLoop).toHaveBeenCalledTimes(1)

    fireEvent.click(getByTitle('Закрыть'))
    expect(onExit).toHaveBeenCalledTimes(1)
  })
})
