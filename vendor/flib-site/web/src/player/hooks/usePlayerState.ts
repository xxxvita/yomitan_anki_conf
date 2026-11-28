// usePlayerState — реактивная обёртка над PlayerAdapter для контрол-бара.
// state/volume/ready — по событиям адаптера; currentTime троттлится до ~250мс
// (дисплей + заливка бара; гладкий playhead будет на таймлайне B4, не тут).
import { useEffect, useState } from 'react'
import type { PlayerAdapter } from '../../adapter/PlayerAdapter'

export interface PlayerState {
  paused: boolean; muted: boolean; volume: number; rate: number
  buffering: boolean; duration: number; currentTime: number
}

const INITIAL: PlayerState = { paused: true, muted: false, volume: 100, rate: 1, buffering: false, duration: 0, currentTime: 0 }

export function usePlayerState(adapter: PlayerAdapter | null): PlayerState {
  const [s, setS] = useState<PlayerState>(INITIAL)
  useEffect(() => {
    if (!adapter) { setS(INITIAL); return }
    const sync = () => setS(prev => ({
      ...prev,
      paused: adapter.paused(), muted: adapter.muted(), volume: adapter.volume(),
      rate: adapter.rate(), buffering: adapter.buffering(), duration: adapter.duration(),
    }))
    sync()
    const offState = adapter.on('state', sync)
    const offVol = adapter.on('volume', sync)
    const offReady = adapter.on('ready', sync)               // duration появляется на ready
    const id = setInterval(() => {
      const t = adapter.currentTime()
      setS(prev => (prev.currentTime === t ? prev : { ...prev, currentTime: t }))
    }, 250)
    return () => { offState(); offVol(); offReady(); clearInterval(id) }
  }, [adapter])
  return s
}
