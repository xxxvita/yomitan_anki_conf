// shadow-recorder.ts — WEB-NEW: обёртка над лифтнутым createAudioPipeline
// (AudioWorklet PCM16). Накапливает ArrayBuffer-чанки, отдаёт их на stop().
// Жёсткий cap 60с (паттерн cap-таймера из loop-recorder.ts) → onCap-колбэк.
// РЕШЕНИЕ (отклонение от loop-recorder «discard»): на cap НЕ выбрасываем клип,
// а вызываем onCap → вызывающий делает штатный stop()+транскрипт (клип ~1.9MB <
// 4MB server-cap, выбрасывать речь пользователя — плохой UX; abuse-backstop =
// server 4MB/семафор). См. §T3 обработку cap. Флаг для владельца на живом тесте.
// DI: pipelineFactory заменяем в тестах (getUserMedia недоступен в jsdom).
import { createAudioPipeline, type AudioPipeline } from './audio-pipeline'

export const SHADOW_CAP_MS = 60_000

type PipelineFactory = (onChunk: (b: ArrayBuffer) => void) => Promise<AudioPipeline>

export class ShadowRecorder {
  private pipeline: AudioPipeline | null = null
  private chunks: ArrayBuffer[] = []
  private capTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private onCap: () => void,
    private factory: PipelineFactory = createAudioPipeline,
    private maxMs: number = SHADOW_CAP_MS,
  ) {}

  isActive(): boolean { return this.pipeline !== null }

  // start — идемпотентно (урок №2): повторный start при активной записи = no-op.
  async start(): Promise<void> {
    if (this.pipeline) return
    this.chunks = []
    this.pipeline = await this.factory((b) => { this.chunks.push(b) })
    this.capTimer = setTimeout(() => { this.capTimer = null; this.onCap() }, this.maxMs)
  }

  // analyser — для осциллографа/индикатора (опционально в UI).
  analyser(): AnalyserNode | null { return this.pipeline?.analyserNode ?? null }

  // stop — закрывает pipeline, возвращает накопленные PCM-чанки. Отменяет cap.
  stop(): ArrayBuffer[] {
    if (this.capTimer != null) { clearTimeout(this.capTimer); this.capTimer = null }
    const p = this.pipeline
    this.pipeline = null
    if (p) p.close()
    const out = this.chunks
    this.chunks = []
    return out
  }
}
