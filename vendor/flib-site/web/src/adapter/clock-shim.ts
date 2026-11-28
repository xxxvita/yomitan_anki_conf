// clock-shim.ts
export interface ClockShimOpts {
  nowMs?: () => number            // wall-clock, инъектируется в тестах
  seekInFlight?: () => boolean    // истина в окне нашего seekTo — устаревшим поллам не верим
  freezeConfirmPolls?: number     // согласованных поллов для подтверждения легитимного джампа (default 2)
}
export interface ClockShim {
  tick(polled: number, state: 'playing' | 'paused' | 'buffering' | 'ended'): void
  now(): number
  resyncHard(t: number): void
  setRate(r: number): void
  isFrozen(): boolean
}

const BACK_EPS = 0.25   // допустимый мелкий откат (jitter)
const FWD_MAX  = 2.0    // скачок больше = подозрительный (реклама / нативный seek)

export function createClockShim(opts: ClockShimOpts = {}): ClockShim {
  const nowMs = opts.nowMs ?? (() => performance.now())
  const seekInFlight = opts.seekInFlight ?? (() => false)
  const confirmPolls = opts.freezeConfirmPolls ?? 2

  let initialized = false
  let anchorT = 0
  let anchorWall = nowMs()
  let rate = 1
  let frozen = false
  let playing = false                          // интерполируем ТОЛЬКО пока видео реально играет
  let candT = 0, candWall = 0, divergent = 0   // кандидат на ре-базлайн

  // now() ползёт по стенным часам ТОЛЬКО в состоянии playing. Иначе (пауза / cued /
  // unstarted / buffering) время замирает на anchorT — иначе на паузе playhead
  // уезжает вперёд между 150ms-поллами и прыгает обратно на ре-якоре (пила).
  function nowInterp(): number {
    if (!initialized || frozen || !playing) return anchorT
    return anchorT + ((nowMs() - anchorWall) / 1000) * rate
  }
  function setAnchor(t: number) {
    anchorT = t; anchorWall = nowMs(); frozen = false; divergent = 0; candWall = 0; initialized = true
  }

  return {
    setRate(r) { if (r > 0) { anchorT = nowInterp(); anchorWall = nowMs(); rate = r } }, // H2: ре-якорь на новой скорости
    tick(polled, state) {
      const wasPlaying = playing
      playing = state === 'playing'                          // gate интерполяции: только playing двигает now()
      if (!initialized) { setAnchor(polled); return }        // C1: первый полл всегда якорь
      if (seekInFlight()) return                             // H3: устаревшим поллам не верим (держим resyncHard-цель)
      if (!playing) { setAnchor(polled); return }            // пауза/cued/buffering → якорь, интерполяция заморожена
      if (!wasPlaying) { setAnchor(polled); return }         // пауза→playing: чистый ре-якорь (без delta через простой)
      const delta = polled - nowInterp()
      const nearZero = polled <= 0.2 && Math.abs(delta) <= 0.5
      if (nearZero || (delta <= FWD_MAX && delta >= -BACK_EPS)) { setAnchor(polled); return } // норма
      // дивергентный полл: реклама ИЛИ легитимный нативный seek/переход по главам
      if (candWall !== 0) {
        const expected = candT + ((nowMs() - candWall) / 1000) * rate
        if (Math.abs(polled - expected) <= FWD_MAX) {        // позиция нормально поехала от кандидата
          if (++divergent >= confirmPolls) { setAnchor(polled); return }  // H1: подтверждён → ре-базлайн
        } else { divergent = 1 }                             // снова эрратично → реклама, сброс
      } else { divergent = 1 }
      candT = polled; candWall = nowMs(); frozen = true       // заморозка до подтверждения
    },
    now() { return nowInterp() },
    resyncHard(t) { setAnchor(t) },
    isFrozen() { return frozen },
  }
}
