// video-player-store.size.test.tsx — ТЗ №3 п.1: shadowChatSize persistence.
// Same split-and-reset idiom as video-player-store.dock.test.tsx: the size (like
// the dock) survives reload via localStorage; a fresh module instance (vi.reset
// Modules) re-runs the read-on-init path. This is the mutation gate for
// "убери персист size → remount-тест red".
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render } from '@testing-library/react'
import { useEffect } from 'react'

const SIZE_KEY = 'videoPlayer.shadowChatSize'

beforeEach(() => {
  localStorage.removeItem(SIZE_KEY)
  vi.resetModules()
})

describe('ТЗ №3 — shadowChatSize persistence (localStorage)', () => {
  it('reads a persisted {w,h} on module init (survives remount/reload)', async () => {
    localStorage.setItem(SIZE_KEY, JSON.stringify({ w: 560, h: 420 }))
    const { useVideoPlayerStore } = await import('../video-player-store')
    let seen: unknown = 'unset'
    function Probe() { seen = useVideoPlayerStore(s => s.shadowChatSize); return null }
    render(<Probe />)
    expect(seen).toEqual({ w: 560, h: 420 })
  })

  it('setShadowChatSize writes through to localStorage; null removes the key', async () => {
    const { useVideoPlayerStore } = await import('../video-player-store')
    function Probe({ next }: { next: { w: number; h: number } | null }) {
      const set = useVideoPlayerStore(s => s.setShadowChatSize)
      useEffect(() => { set(next) }, [next, set])
      return null
    }
    const { rerender } = render(<Probe next={{ w: 500, h: 400 }} />)
    expect(JSON.parse(localStorage.getItem(SIZE_KEY)!)).toEqual({ w: 500, h: 400 })
    rerender(<Probe next={null} />)
    expect(localStorage.getItem(SIZE_KEY)).toBeNull()
  })

  it('ignores garbage / non-numeric persisted values (defensive parse)', async () => {
    localStorage.setItem(SIZE_KEY, '{"w":"big","h":null}')
    const { useVideoPlayerStore } = await import('../video-player-store')
    let seen: unknown = 'unset'
    function Probe() { seen = useVideoPlayerStore(s => s.shadowChatSize); return null }
    render(<Probe />)
    expect(seen).toBeNull()
  })

  it('LOW: clamps an undersized persisted {w,h} on READ (never a 5px card)', async () => {
    // A corrupt/hand-edited {w:5,h:5} must not render a 5px card — clamp on read
    // floors it to SHADOW_MIN_* (320×240) using the current viewport bounds.
    localStorage.setItem(SIZE_KEY, JSON.stringify({ w: 5, h: 5 }))
    const { useVideoPlayerStore } = await import('../video-player-store')
    let seen: unknown = 'unset'
    function Probe() { seen = useVideoPlayerStore(s => s.shadowChatSize); return null }
    render(<Probe />)
    expect(seen).toEqual({ w: 320, h: 240 })
  })
})
