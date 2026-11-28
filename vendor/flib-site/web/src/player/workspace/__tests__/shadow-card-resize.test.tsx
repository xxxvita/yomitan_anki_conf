// shadow-card-resize.test.tsx — ТЗ №3 п.1: corner-drag resize of the Shadowing
// card. Coordinate mechanic like shadow-card-drag-dock.test: getBoundingClient
// Rect is mocked so the pointer math is deterministic in jsdom.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { useEffect } from 'react'
import { render, fireEvent } from '@testing-library/react'
import { ShadowCard } from '../ShadowCardLifted'
import { useVideoPlayerStore } from '../video-player-store'
import type { ShadowV1Api } from '../../hooks/useShadowV1'

const SIZE_KEY = 'videoPlayer.shadowChatSize'
const CARD_RECT = { left: 800, top: 300, right: 1220, bottom: 620, width: 420, height: 320 }
function domRect(r: typeof CARD_RECT): DOMRect { return { ...r, x: r.left, y: r.top, toJSON: () => r } as DOMRect }

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

function ResetSize() {
  const setSize = useVideoPlayerStore(s => s.setShadowChatSize)
  const setFree = useVideoPlayerStore(s => s.setShadowChatFreePos)
  useEffect(() => { setSize(null); setFree(null) }, [setSize, setFree])
  return null
}

afterEach(() => {
  vi.restoreAllMocks()
  const { unmount } = render(<ResetSize />); unmount()
  localStorage.removeItem(SIZE_KEY)
})

describe('ТЗ №3 п.1 — card resize handles', () => {
  it('renders NW + SE resize handles (nwse-resize) while undocked', () => {
    const { getByTestId } = render(<ShadowCard shadow={mkShadow()} />)
    expect(getByTestId('shadow-resize-nw').style.cursor).toBe('nwse-resize')
    expect(getByTestId('shadow-resize-se').style.cursor).toBe('nwse-resize')
  })

  it('SE drag grows the card and persists {w,h} (survives a remount)', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(domRect(CARD_RECT))
    const { getByTestId, unmount } = render(<ShadowCard shadow={mkShadow()} />)
    const se = getByTestId('shadow-resize-se')

    // startW/H = 420/320 (from the mocked rect); +120/+80 → 540×400.
    fireEvent.pointerDown(se, { clientX: 1220, clientY: 620, button: 0 })
    fireEvent.pointerMove(window, { clientX: 1340, clientY: 700 })
    fireEvent.pointerUp(window, { clientX: 1340, clientY: 700 })

    expect(getByTestId('shadow-card').style.width).toBe('540px')
    expect(JSON.parse(localStorage.getItem(SIZE_KEY)!)).toEqual({ w: 540, h: 400 })

    // Remount → the persisted width is restored (store-backed).
    unmount()
    const { getByTestId: get2 } = render(<ShadowCard shadow={mkShadow()} />)
    expect(get2('shadow-card').style.width).toBe('540px')
  })

  it('NW drag (anchor bottom-right) grows the card when dragged up/left', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(domRect(CARD_RECT))
    const { getByTestId } = render(<ShadowCard shadow={mkShadow()} />)
    const nw = getByTestId('shadow-resize-nw')
    // NW negates the delta: dragging up/left (negative dx/dy) INCREASES size.
    fireEvent.pointerDown(nw, { clientX: 800, clientY: 300, button: 0 })
    fireEvent.pointerMove(window, { clientX: 750, clientY: 260 }) // dx=-50, dy=-40
    fireEvent.pointerUp(window, { clientX: 750, clientY: 260 })
    expect(getByTestId('shadow-card').style.width).toBe('470px') // 420 - (-50)
    expect(JSON.parse(localStorage.getItem(SIZE_KEY)!)).toEqual({ w: 470, h: 360 })
  })

  it('min-clamp: shrinking below 320×240 clamps to the floor', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(domRect(CARD_RECT))
    const { getByTestId } = render(<ShadowCard shadow={mkShadow()} />)
    const se = getByTestId('shadow-resize-se')
    fireEvent.pointerDown(se, { clientX: 1220, clientY: 620, button: 0 })
    fireEvent.pointerMove(window, { clientX: 600, clientY: 100 }) // huge negative → below floor
    fireEvent.pointerUp(window, { clientX: 600, clientY: 100 })
    expect(JSON.parse(localStorage.getItem(SIZE_KEY)!)).toEqual({ w: 320, h: 240 })
  })

  it('MED-7: a resize drag does NOT write localStorage per pointermove (persist once, on up)', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(domRect(CARD_RECT))
    const setItem = vi.spyOn(localStorage, 'setItem')
    const { getByTestId } = render(<ShadowCard shadow={mkShadow()} />)
    const se = getByTestId('shadow-resize-se')
    const sizeWrites = () => setItem.mock.calls.filter(c => c[0] === SIZE_KEY).length

    fireEvent.pointerDown(se, { clientX: 1220, clientY: 620, button: 0 })
    fireEvent.pointerMove(window, { clientX: 1260, clientY: 660 })
    fireEvent.pointerMove(window, { clientX: 1300, clientY: 690 })
    fireEvent.pointerMove(window, { clientX: 1340, clientY: 700 })
    // mid-drag: NOT a single SIZE_KEY write yet (live size is local state)…
    expect(sizeWrites()).toBe(0)
    // …but the card visibly grew (live size drives the width).
    expect(getByTestId('shadow-card').style.width).toBe('540px')

    fireEvent.pointerUp(window, { clientX: 1340, clientY: 700 })
    // exactly one persist at gesture end.
    expect(sizeWrites()).toBe(1)
    expect(JSON.parse(localStorage.getItem(SIZE_KEY)!)).toEqual({ w: 540, h: 400 })
  })

  it('MED-6: in freePos an NW drag compensates the anchor (handle tracks the cursor)', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(domRect(CARD_RECT))
    let freePos: { x: number; y: number } | null = null
    function FreeSetup() {
      const setFree = useVideoPlayerStore(s => s.setShadowChatFreePos)
      freePos = useVideoPlayerStore(s => s.shadowChatFreePos)
      useEffect(() => { setFree({ x: 500, y: 200 }) }, [setFree])
      return null
    }
    const { getByTestId } = render(<><FreeSetup /><ShadowCard shadow={mkShadow()} /></>)
    const nw = getByTestId('shadow-resize-nw')
    fireEvent.pointerDown(nw, { clientX: 800, clientY: 300, button: 0 })
    fireEvent.pointerMove(window, { clientX: 750, clientY: 260 }) // dx=-50, dy=-40
    fireEvent.pointerUp(window, { clientX: 750, clientY: 260 })
    // width grew (470) AND the anchor shifted up/left by the same delta so the
    // bottom-right stayed pinned and the NW handle followed the cursor.
    expect(getByTestId('shadow-card').style.width).toBe('470px')
    expect(freePos).toEqual({ x: 450, y: 160 }) // {500-50, 200-40}
  })

  it('LOW: pointercancel ends the resize drag like pointerup', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(domRect(CARD_RECT))
    const { getByTestId } = render(<ShadowCard shadow={mkShadow()} />)
    const se = getByTestId('shadow-resize-se')
    fireEvent.pointerDown(se, { clientX: 1220, clientY: 620, button: 0 })
    fireEvent.pointerMove(window, { clientX: 1340, clientY: 700 }) // → 540×400
    fireEvent.pointerCancel(window, { clientX: 1340, clientY: 700 })
    expect(JSON.parse(localStorage.getItem(SIZE_KEY)!)).toEqual({ w: 540, h: 400 })
    // disarmed: a further stray move must not resume resizing.
    fireEvent.pointerMove(window, { clientX: 1400, clientY: 800 })
    expect(getByTestId('shadow-card').style.width).toBe('540px')
  })
})
