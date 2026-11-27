// A7 — mute-регионы веб-плеера по канону владельца.
//  • useMuteRegions: регионы на videoId, персист в localStorage через wire-форму
//    (regionToWire/wireToRegion — задел под будущий бэкенд-паритет).
//    applyRange = семантика хоткея M: регион с тем же [t1,t2] есть → toggle его
//    muted (повторный M = снять/вернуть), иначе создать.
//  • useMuteDriver: rAF-драйвер, edge-triggered пушит adapter.mute()/unmute()
//    по want = manualMuted || mutedTracksAt(t).aud. КРИТИЧНО: manualMuted —
//    отдельный «ручной интент», НЕ adapter.muted(); иначе записи драйвера
//    затрут ручной mute (десктоп-формула index.tsx:2843-2864).
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PlayerAdapter } from '../../adapter/PlayerAdapter'
import {
  mutedTracksAt, regionToWire, wireToRegion,
  type MuteRegion, type MuteRegionWire,
} from '../workspace/mute-regions'

const KEY = (videoId: string) => `flib:mute-regions:${videoId}`
const EPS = 0.05 // допуск совпадения диапазона для повторного M

function newId(): string { return `${Date.now()}-${Math.random().toString(16).slice(2, 6)}` }

function loadRegions(videoId: string): MuteRegion[] {
  if (!videoId) return []
  try {
    const raw = localStorage.getItem(KEY(videoId))
    if (!raw) return []
    const wire = JSON.parse(raw) as MuteRegionWire[]
    return Array.isArray(wire) ? wire.map(wireToRegion) : []
  } catch { return [] }
}

export interface MuteRegionsApi {
  muteRegions: MuteRegion[]
  addRegion(t1: number, t2: number, cueIndex?: number): void
  toggleRegion(id: string): void
  deleteRegion(id: string): void
  /** Хоткей M: toggle существующего региона с тем же диапазоном, иначе создать. */
  applyRange(t1: number, t2: number, cueIndex?: number): void
}

export function useMuteRegions(videoId: string): MuteRegionsApi {
  const [regions, setRegions] = useState<MuteRegion[]>(() => loadRegions(videoId))

  useEffect(() => { setRegions(loadRegions(videoId)) }, [videoId])

  const persist = useCallback((next: MuteRegion[]) => {
    if (!videoId) return
    try { localStorage.setItem(KEY(videoId), JSON.stringify(next.map(regionToWire))) }
    catch { /* quota / приватный режим — локальный state остаётся источником истины */ }
  }, [videoId])

  const commit = useCallback((fn: (prev: MuteRegion[]) => MuteRegion[]) => {
    setRegions(prev => { const next = fn(prev); persist(next); return next })
  }, [persist])

  const addRegion = useCallback((t1: number, t2: number, cueIndex = -1) => {
    commit(prev => [...prev, {
      id: newId(), t1: Math.min(t1, t2), t2: Math.max(t1, t2),
      tracks: { you: false, aud: true }, muted: true, cueIndex, // web = только AUD
    }])
  }, [commit])

  const toggleRegion = useCallback((id: string) => {
    commit(prev => prev.map(r => r.id === id ? { ...r, muted: !r.muted } : r))
  }, [commit])

  const deleteRegion = useCallback((id: string) => {
    commit(prev => prev.filter(r => r.id !== id))
  }, [commit])

  const applyRange = useCallback((t1: number, t2: number, cueIndex = -1) => {
    const a = Math.min(t1, t2), b = Math.max(t1, t2)
    if (b - a < 0.1) return // нет валидного [A,B]
    commit(prev => {
      const match = prev.find(r => Math.abs(r.t1 - a) < EPS && Math.abs(r.t2 - b) < EPS)
      if (match) return prev.map(r => r.id === match.id ? { ...r, muted: !r.muted } : r)
      return [...prev, { id: newId(), t1: a, t2: b, tracks: { you: false, aud: true }, muted: true, cueIndex }]
    })
  }, [commit])

  return { muteRegions: regions, addRegion, toggleRegion, deleteRegion, applyRange }
}

/**
 * useMuteDriver — rAF-драйвер мьюта. want = manualMuted || regionAud(currentTime).
 * Edge-triggered: пушим в адаптер ТОЛЬКО при смене want. Не читаем adapter.muted()
 * как интент (кроме первичного seed при монтировании/смене адаптера).
 */
export function useMuteDriver(
  adapter: PlayerAdapter | null,
  regions: MuteRegion[],
  manualMuted: boolean,
): { _tickForTest: () => void } {
  const latest = useRef({ regions, manualMuted })
  latest.current = { regions, manualMuted }
  const appliedRef = useRef<boolean | null>(null)

  const reconcile = useCallback(() => {
    if (!adapter) return
    const { regions, manualMuted } = latest.current
    const want = manualMuted || mutedTracksAt(adapter.currentTime(), regions).aud
    if (appliedRef.current === want) return // edge-triggered
    appliedRef.current = want
    if (want) adapter.mute(); else adapter.unmute()
  }, [adapter])

  useEffect(() => {
    if (!adapter) { appliedRef.current = null; return }
    appliedRef.current = adapter.muted() // seed — не драться с mute'ом до монтирования
    let raf = 0
    const tick = () => { reconcile(); raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [adapter, reconcile])

  return { _tickForTest: reconcile }
}
