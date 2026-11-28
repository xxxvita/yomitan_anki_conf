// shadow-card-docked.test.tsx — ТЗ №3 п.5: while docked (shadowChatDock != null)
// the "ОЖИДАЕТСЯ" target panel is hidden (that space goes to the attempts feed in
// the narrow docked column). Also п.1: resize handles hidden while docked.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { useEffect } from 'react'
import { render } from '@testing-library/react'
import { ShadowCard } from '../ShadowCardLifted'
import { useVideoPlayerStore } from '../video-player-store'
import type { ShadowV1Api } from '../../hooks/useShadowV1'

function mkShadow(overrides: Partial<ShadowV1Api> = {}): ShadowV1Api {
  return {
    active: true, phase: 'idle', errorCode: null, remainingSec: 60,
    referenceText: 'hello world', cueIndex: 0, lastMarks: null, lastMatchPct: null,
    lastSpoken: null, capped: false, recordAudioUrl: null, analyserNode: null,
    shadowAttempts: {}, recordings: [],
    activate: vi.fn(), deactivate: vi.fn(), toggle: vi.fn(),
    startRecording: vi.fn(async () => {}), stopRecording: vi.fn(),
    dismissResult: vi.fn(), selectRecording: vi.fn(), deleteRecording: vi.fn(),
    ...overrides,
  }
}

function DockSetter({ dock }: { dock: 'left' | 'right' | null }) {
  const set = useVideoPlayerStore(s => s.setShadowChatDock)
  useEffect(() => { set(dock) }, [dock, set])
  return null
}

afterEach(() => {
  const { unmount } = render(<DockSetter dock={null} />); unmount()
  localStorage.removeItem('videoPlayer.shadowChatDock')
})

describe('ТЗ №3 п.5 — docked hides the "ОЖИДАЕТСЯ" target panel', () => {
  it('undocked (dock=null): target panel + resize handles are present', () => {
    const { getByTestId } = render(<ShadowCard shadow={mkShadow()} />)
    expect(getByTestId('shadow-target-panel')).toBeTruthy()
    expect(getByTestId('shadow-resize-nw')).toBeTruthy()
  })

  it('docked (dock="left"): the "ОЖИДАЕТСЯ" panel is NOT rendered', () => {
    const { getByTestId, queryByTestId } = render(
      <><DockSetter dock="left" /><ShadowCard shadow={mkShadow({ shadowAttempts: { '0': { attempts: [{ match_pct: 50 }] } } })} /></>,
    )
    expect(queryByTestId('shadow-target-panel')).toBeNull()
    // The feed still renders (it's where the reclaimed space went).
    expect(getByTestId('shadow-feed')).toBeTruthy()
  })

  it('docked: resize handles are hidden (card is pinned to the bar)', () => {
    const { queryByTestId } = render(<><DockSetter dock="right" /><ShadowCard shadow={mkShadow({ shadowAttempts: { '0': { attempts: [{ match_pct: 50 }] } } })} /></>)
    expect(queryByTestId('shadow-resize-nw')).toBeNull()
    expect(queryByTestId('shadow-resize-se')).toBeNull()
  })

  it('MED-11: docked + mode="custom" STILL renders the custom-text editor (not just the display)', () => {
    // ТЗ п.5 hides the "ОЖИДАЕТСЯ" DISPLAY while docked, but the custom textarea is
    // an EDITOR — the mode chip in the bar can enter custom mode while docked, so
    // hiding the textarea there would make the user edit blind.
    const custom = { advanceEnabled: true, advanceThreshold: 80, mode: 'custom' as const, loopMode: false }
    const { getByTestId } = render(
      <><DockSetter dock="left" /><ShadowCard shadow={mkShadow()} settings={custom} /></>,
    )
    expect(getByTestId('shadow-custom-textarea')).toBeTruthy()
  })

  it('MED-11: docked + mode="subtitle" hides the target panel entirely (display, no editor)', () => {
    const sub = { advanceEnabled: true, advanceThreshold: 80, mode: 'subtitle' as const, loopMode: false }
    const { queryByTestId } = render(
      <><DockSetter dock="left" /><ShadowCard shadow={mkShadow()} settings={sub} /></>,
    )
    expect(queryByTestId('shadow-target-panel')).toBeNull()
    expect(queryByTestId('shadow-custom-textarea')).toBeNull()
  })
})
