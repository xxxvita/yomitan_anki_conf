// video-player-store.dock.test.ts — T8: shadowChatDock persistence. Desktop's
// own store (electron/renderer/store/video-player-store.ts :164-178) persists
// shadowChatDock to localStorage but keeps shadowChatFreePos/shadowChatDockHint
// in-memory only; the web store (video-player-store.ts) now mirrors that split
// exactly (same key string 'videoPlayer.shadowChatDock', WEB-SEAM: shared
// convention, not a shared storage origin). This file isolates the persistence
// layer from ShadowCardLifted's drag mechanic (covered separately in
// shadow-card-drag-dock.test.tsx) — `vi.resetModules()` + a fresh dynamic
// import is the only way to exercise the module's read-on-init path, since a
// plain re-render of an already-imported module never re-runs its top-level
// IIFE.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render } from '@testing-library/react'
import { useEffect } from 'react'

const DOCK_KEY = 'videoPlayer.shadowChatDock'

beforeEach(() => {
  localStorage.removeItem(DOCK_KEY)
  // Force a fresh module instance per test so the top-level readPersistedDock()
  // IIFE re-runs against whatever localStorage state THIS test sets up —
  // without this, the dynamic import()s below would all resolve to the same
  // cached singleton after the first test in this file imports it.
  vi.resetModules()
})

describe('T8 — shadowChatDock persistence (localStorage, like desktop)', () => {
  it('reads a persisted "left"/"right" value on module init', async () => {
    localStorage.setItem(DOCK_KEY, 'right')
    const { useVideoPlayerStore } = await import('../video-player-store')

    let seen: string | null = 'unset'
    function Probe() {
      const dock = useVideoPlayerStore(s => s.shadowChatDock)
      seen = dock
      return null
    }
    render(<Probe />)
    expect(seen).toBe('right')
  })

  // ТЗ №8 п.2 — LIVE-факт оркестратора: LS videoPlayer.shadowChatDock='"left"'
  // (JSON-кавычки) → карта после reload рендерилась FLOAT, т.к. readPersistedDock
  // сверял raw-строку `"left"` (5 символов с кавычками) с 'left' → null. Десктопный
  // zustand-persist (и любая ручная инъекция через JSON.stringify) пишет значение
  // в кавычках; наш собственный сеттер — голой строкой. Читатель обязан принять ОБА.
  it('ТЗ №8 п.2 — reads a JSON-quoted persisted value (\'"left"\') as a dock side', async () => {
    localStorage.setItem(DOCK_KEY, '"left"') // JSON.stringify('left')
    const { useVideoPlayerStore } = await import('../video-player-store')

    let seen: string | null = 'unset'
    function Probe() {
      const dock = useVideoPlayerStore(s => s.shadowChatDock)
      seen = dock
      return null
    }
    render(<Probe />)
    expect(seen).toBe('left')
  })

  it('ТЗ №8 п.2 — reads a JSON-quoted "right" too', async () => {
    localStorage.setItem(DOCK_KEY, '"right"')
    const { useVideoPlayerStore } = await import('../video-player-store')
    let seen: string | null = 'unset'
    function Probe() { seen = useVideoPlayerStore(s => s.shadowChatDock); return null }
    render(<Probe />)
    expect(seen).toBe('right')
  })

  it('ignores a garbage persisted value (defensive parse, matches desktop\'s v === "left" || v === "right" guard)', async () => {
    localStorage.setItem(DOCK_KEY, 'up') // not a valid DockSide
    const { useVideoPlayerStore } = await import('../video-player-store')

    let seen: string | null = 'unset'
    function Probe() {
      const dock = useVideoPlayerStore(s => s.shadowChatDock)
      seen = dock
      return null
    }
    render(<Probe />)
    expect(seen).toBeNull()
  })

  it('ТЗ №8 п.2 — a JSON-quoted GARBAGE value (\'"up"\') is still rejected → null (tolerant parse must not over-accept)', async () => {
    localStorage.setItem(DOCK_KEY, '"up"')
    const { useVideoPlayerStore } = await import('../video-player-store')
    let seen: string | null = 'unset'
    function Probe() { seen = useVideoPlayerStore(s => s.shadowChatDock); return null }
    render(<Probe />)
    expect(seen).toBeNull()
  })

  it('setShadowChatDock("left") writes through to localStorage; setShadowChatDock(null) removes the key', async () => {
    const { useVideoPlayerStore } = await import('../video-player-store')

    function Probe({ next }: { next: 'left' | null }) {
      const set = useVideoPlayerStore(s => s.setShadowChatDock)
      useEffect(() => { set(next) }, [next, set])
      return null
    }
    const { rerender } = render(<Probe next="left" />)
    expect(localStorage.getItem(DOCK_KEY)).toBe('left')

    rerender(<Probe next={null} />)
    expect(localStorage.getItem(DOCK_KEY)).toBeNull()
  })

  it('shadowChatFreePos and shadowChatDockHint are NOT persisted (in-memory only, same as desktop)', async () => {
    const { useVideoPlayerStore } = await import('../video-player-store')

    function Probe() {
      const setFreePos = useVideoPlayerStore(s => s.setShadowChatFreePos)
      const setHint = useVideoPlayerStore(s => s.setShadowChatDockHint)
      useEffect(() => { setFreePos({ x: 12, y: 34 }); setHint('left') }, [setFreePos, setHint])
      return null
    }
    render(<Probe />)
    // Neither field has a storage key at all — nothing new appears alongside
    // (or instead of) the dock key.
    expect(localStorage.getItem('videoPlayer.shadowChatFreePos')).toBeNull()
    expect(localStorage.getItem('videoPlayer.shadowChatDockHint')).toBeNull()
  })
})
