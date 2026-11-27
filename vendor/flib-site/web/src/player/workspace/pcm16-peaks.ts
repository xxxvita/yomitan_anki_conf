// pcm16-peaks.ts — WEB-NEW: RMS-даунсемпл PCM16 → N нормализованных пиков для
// ленты YOU-трека. По смыслу зеркалит server-side extractAudioPCM (RMS/окно) —
// не лифт (серверный код Go/ffmpeg). Чистый.
export function pcm16Peaks(samples: Int16Array, buckets = 60): number[] {
  if (samples.length === 0 || buckets <= 0) return []
  const out = new Array<number>(buckets).fill(0)
  const per = Math.max(1, Math.floor(samples.length / buckets))
  for (let b = 0; b < buckets; b++) {
    const start = b * per
    const end = b === buckets - 1 ? samples.length : Math.min(samples.length, start + per)
    let sumSq = 0, n = 0
    for (let i = start; i < end; i++) { const v = samples[i] / 32768; sumSq += v * v; n++ }
    out[b] = n ? Math.sqrt(sumSq / n) : 0
  }
  const max = Math.max(...out, 1e-6)
  return out.map(v => v / max)
}
