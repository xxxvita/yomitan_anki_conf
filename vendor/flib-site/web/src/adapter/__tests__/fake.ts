// adapter/__tests__/fake.ts
import type { PlayerAdapter, PlayerEvent } from '../PlayerAdapter'

export interface FakeAdapter extends PlayerAdapter {
  _setTime(t: number): void   // двигает «истинное» время (эмуляция прихода нового polled)
  _setDuration(d: number): void // меняет длительность (эмуляция позднего duration-ready на live YouTube)
  _emit(evt: PlayerEvent, p?: unknown): void // вручную триггерит подписчиков события (эмуляция IFrame 'ready')
  _seekCount: number
  _spy?: (method: string) => void
}

export function makeFakeAdapter(init: { t?: number; duration?: number } = {}): FakeAdapter {
  let t = init.t ?? 0, dur = init.duration ?? 600, rate = 1, muted = false, vol = 100, paused = true
  let seekCount = 0
  const listeners: Record<string, ((p?: unknown) => void)[]> = {}
  const a: FakeAdapter = {
    _seekCount: 0,
    _setTime(nt) { t = nt },            // ВАЖНО: seek() НЕ двигает t сразу (poll-lag); двигает только _setTime
    _setDuration(d) { dur = d },
    _emit(evt, p) { (listeners[evt] ?? []).forEach(cb => cb(p)) },
    currentTime: () => t,
    duration: () => dur,
    paused: () => paused,
    rate: () => rate,
    muted: () => muted,
    volume: () => vol,
    buffering: () => false,
    loadedFraction: () => 1,
    isOurSeekInFlight: () => false,
    getAvailableRates: () => [0.25, 0.5, 0.75, 1, 1.5, 2],
    seek: (nt) => { a._spy?.(`seek:${nt}`); seekCount++; a._seekCount = seekCount; /* НЕ двигаем t — poll-lag */ },
    play: () => { a._spy?.('play'); paused = false },
    pause: () => { a._spy?.('pause'); paused = true },
    setRate: (r) => { rate = r },
    mute: () => { muted = true }, unmute: () => { muted = false }, setVolume: (v) => { vol = v },
    on: (evt: PlayerEvent, cb) => {
      (listeners[evt] ??= []).push(cb)
      return () => { listeners[evt] = (listeners[evt] ?? []).filter(l => l !== cb) }
    },
    destroy: () => {},
  }
  return a
}
