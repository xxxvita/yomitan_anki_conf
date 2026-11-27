// wav-encoder.ts — WEB-NEW: минимальный RIFF/WAVE-контейнер над накопленным
// PCM16 mono @16kHz. НЕ лифт (десктоп стримит PCM16 по WS, файла WAV не собирает);
// ~40 строк, чистый. Формат подтверждён живым прогоном (шаг 0: 16kHz mono → HTTP 200).

const SAMPLE_RATE = 16000
const NUM_CHANNELS = 1
const BITS_PER_SAMPLE = 16

// concatPcm16 склеивает ArrayBuffer-чанки AudioWorklet'а (каждый — прогон
// little-endian Int16) в один Int16Array. Нечётный byteLength невозможен
// (worklet шлёт Int16Array.buffer), но floor защищает от битого хвоста.
export function concatPcm16(chunks: ArrayBuffer[]): Int16Array {
  let totalSamples = 0
  for (const c of chunks) totalSamples += Math.floor(c.byteLength / 2)
  const out = new Int16Array(totalSamples)
  let offset = 0
  for (const c of chunks) {
    const view = new Int16Array(c, 0, Math.floor(c.byteLength / 2))
    out.set(view, offset)
    offset += view.length
  }
  return out
}

// encodeWav оборачивает PCM16-сэмплы в 44-байтный RIFF/WAVE-хедер. Пишет payload
// через DataView.setInt16(..., true) — форс little-endian независимо от хоста.
export function encodeWav(samples: Int16Array, sampleRate = SAMPLE_RATE): Blob {
  const dataBytes = samples.length * 2
  const buffer = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(buffer)
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i))
  }
  const byteRate = sampleRate * NUM_CHANNELS * (BITS_PER_SAMPLE / 8)
  const blockAlign = NUM_CHANNELS * (BITS_PER_SAMPLE / 8)
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true) // ChunkSize = 36 + Subchunk2Size
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)            // Subchunk1Size (PCM)
  view.setUint16(20, 1, true)             // AudioFormat = 1 (PCM)
  view.setUint16(22, NUM_CHANNELS, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, BITS_PER_SAMPLE, true)
  writeStr(36, 'data')
  view.setUint32(40, dataBytes, true)     // Subchunk2Size
  let off = 44
  for (let i = 0; i < samples.length; i++, off += 2) view.setInt16(off, samples[i], true)
  return new Blob([buffer], { type: 'audio/wav' })
}
