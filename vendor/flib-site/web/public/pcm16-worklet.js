// pcm16-worklet.js — PCM16 AudioWorkletProcessor, served as a STATIC file.
//
// WEB-SEAM: this used to be an inline template string in audio-pipeline.ts,
// loaded via a blob: URL (URL.createObjectURL + audioContext.audioWorklet.
// addModule(blobURL)). Prod CSP (main.go cspPolicy) sets
// `script-src 'self' https://www.youtube.com https://s.ytimg.com` — no `blob:`
// — so the browser refuses to execute the blob script and addModule() rejects
// with a SecurityError. That rejection was caught by useShadowV1's generic
// `catch { setErrorCode('mic_denied') }` around rec.start(), so a live user
// with mic permission GRANTED still saw "Нет доступа к микрофону". The desktop
// (Electron) build has no CSP at all, so the blob: URL loaded fine there —
// this is a pure web-only seam, not a shared bug. Fix: ship this processor as
// an ordinary static file under web/public/ (Vite copies public/ verbatim into
// the built dist/ root), so it's fetched from 'self' and CSP is happy. We do
// NOT relax the CSP (no `blob:` added to script-src) — that would silently
// re-open the same class of injection surface CSP exists to close.
//
// NOTE: this file now DIVERGES from the desktop lift — the original
// audio-pipeline.ts comment described the worklet source as a byte-identical
// lift. It no longer is: there is no template-string BUFFER_SIZE interpolation
// possible in a static file, so the buffer size travels at runtime via
// `options.processorOptions.bufferSize` (AudioWorkletNode constructor arg in
// audio-pipeline.ts), defaulting to 1600 (~100ms at 16kHz) if omitted.
class PCM16Processor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this._buffer = [];
    this._bufferSize = options?.processorOptions?.bufferSize ?? 1600;
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (let i = 0; i < input.length; i++) {
      this._buffer.push(input[i]);
    }
    while (this._buffer.length >= this._bufferSize) {
      const chunk = this._buffer.splice(0, this._bufferSize);
      const pcm16 = new Int16Array(chunk.length);
      for (let i = 0; i < chunk.length; i++) {
        pcm16[i] = Math.max(-32768, Math.min(32767, Math.round(chunk[i] * 32767)));
      }
      this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
    }
    return true;
  }
}
registerProcessor('pcm16-processor', PCM16Processor);
