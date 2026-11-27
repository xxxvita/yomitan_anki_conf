// WorkspacePanel.regionmenu.test.tsx (T5b)
// Right-click a mute region opens the RegionMenu (rendered via a portal into
// document.body — see the ФАКТЧЕК C1 note in WorkspacePanelThemed: the panel
// root has backdropFilter, which would otherwise anchor position:fixed to the
// panel instead of the viewport). Clicking "Удалить" calls
// onDeleteMuteRegion(id) and closes the menu.
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { WorkspacePanel } from '../WorkspacePanel'
import { makeFakeAdapter } from '../../../adapter/__tests__/fake'

function makeWs() {
  return {
    rangeStart: 0, rangeEnd: 0, looping: false, pauseAtEnd: 0, viewStart: 0, viewEnd: 60,
    setABLoop() {}, toggleABLoop() {}, onUserSeek() {}, setPauseAtEnd() {}, stopLoop() {},
    setView() {}, zoom() {}, fitToRange() {}, setRange() {}, _boundaryTickForTest() {}, countdownValue: null,
  } as any
}

describe('WorkspacePanel — RegionMenu right-click wiring (T5b)', () => {
  it('contextmenu on a mute region opens RegionMenu; delete calls onDeleteMuteRegion and closes', () => {
    const onDeleteMuteRegion = vi.fn()
    const adapter = makeFakeAdapter({ duration: 100 })
    const muteRegions = [
      { id: 'mr1', t1: 5, t2: 10, tracks: { you: false, aud: true }, muted: true, cueIndex: -1 },
    ]

    const { getByTestId, queryByTestId } = render(
      <WorkspacePanel
        ws={makeWs()} cues={[]} adapter={adapter} activeIndex={-1} waveform={null}
        variant="refined" currentTime={0} playing={false} muted={false}
        muteRegions={muteRegions} onDeleteMuteRegion={onDeleteMuteRegion}
      />
    )

    expect(queryByTestId('region-menu')).toBeNull()

    fireEvent.contextMenu(getByTestId('mute-region'), { clientX: 40, clientY: 60 })

    const menu = getByTestId('region-menu')
    expect(menu).toBeTruthy()

    fireEvent.click(getByTestId('region-menu-delete'))

    expect(onDeleteMuteRegion).toHaveBeenCalledWith('mr1')
    expect(queryByTestId('region-menu')).toBeNull()
  })

  it('portal: region-menu is a child of document.body, not of the workspace bar (T5-review finding 3)', () => {
    const adapter = makeFakeAdapter({ duration: 100 })
    const muteRegions = [
      { id: 'mr1', t1: 5, t2: 10, tracks: { you: false, aud: true }, muted: true, cueIndex: -1 },
    ]

    const { getByTestId, container } = render(
      <WorkspacePanel
        ws={makeWs()} cues={[]} adapter={adapter} activeIndex={-1} waveform={null}
        variant="refined" currentTime={0} playing={false} muted={false}
        muteRegions={muteRegions} onDeleteMuteRegion={() => {}}
      />
    )

    fireEvent.contextMenu(getByTestId('mute-region'), { clientX: 40, clientY: 60 })

    const menu = getByTestId('region-menu')
    // Rendered via createPortal(..., document.body) — must be a direct
    // structural descendant of body, and specifically NOT nested inside the
    // [data-workspace-bar] panel root (which has backdropFilter and would
    // otherwise anchor position:fixed to the panel, not the viewport).
    expect(menu.parentElement).toBe(document.body)
    expect(container.contains(menu)).toBe(false)
    expect(menu.closest('[data-workspace-bar]')).toBeNull()
  })

  it('ghost-menu fix: Delete-key on the selected region closes an open RegionMenu for it (T5-review finding 1)', () => {
    const onDeleteMuteRegion = vi.fn()
    const adapter = makeFakeAdapter({ duration: 100 })
    const muteRegions = [
      { id: 'mr1', t1: 5, t2: 10, tracks: { you: false, aud: true }, muted: true, cueIndex: -1 },
    ]

    const { getByTestId, queryByTestId } = render(
      <WorkspacePanel
        ws={makeWs()} cues={[]} adapter={adapter} activeIndex={-1} waveform={null}
        variant="refined" currentTime={0} playing={false} muted={false}
        muteRegions={muteRegions} onDeleteMuteRegion={onDeleteMuteRegion}
      />
    )

    // Right-click opens the menu AND selects the region (both driven off the
    // same onContextMenu handler).
    fireEvent.contextMenu(getByTestId('mute-region'), { clientX: 40, clientY: 60 })
    expect(getByTestId('region-menu')).toBeTruthy()

    // Delete key removes the region — the menu that was pointing at it must
    // not survive as a "ghost menu" referencing a now-deleted id.
    fireEvent.keyDown(document, { key: 'Delete' })

    expect(onDeleteMuteRegion).toHaveBeenCalledWith('mr1')
    expect(queryByTestId('region-menu')).toBeNull()
  })
})
