// PCM16 audio capture pipeline for ElevenLabs speech-to-text
// Uses AudioWorklet for low-latency processing
//
// WEB-SEAM (CSP hotfix, fix/shadow-worklet-csp): the AudioWorklet processor
// used to be an inline template string loaded via a blob: URL
// (URL.createObjectURL + audioContext.audioWorklet.addModule(blobURL)). Prod
// CSP (main.go cspPolicy) sets `script-src 'self' https://www.youtube.com
// https://s.ytimg.com` — no `blob:` — so addModule() rejected with a
// SecurityError for every real user, and the generic catch in useShadowV1's
// startRecording mapped ANY rec.start() failure to 'mic_denied', hiding the
// true cause behind a wrong, misleading message ("Нет доступа к микрофону"
// while permission was actually granted). Electron (desktop) ships with no
// CSP at all, so the blob: URL loaded there without issue — this bug is
// web-only. Fix (2 parts):
//   1. The processor now lives at web/public/pcm16-worklet.js, a static file
//      Vite copies verbatim into dist/ root, so it loads from 'self' — no CSP
//      relaxation (blob: is deliberately NOT added to script-src).
//   2. getUserMedia() failures propagate AS-IS (their DOMException name is
//      whatever the browser gives — NotAllowedError/NotFoundError/
//      NotReadableError/etc.) so useShadowV1 keeps mapping them to
//      'mic_denied'. Everything after that point (AudioContext, addModule,
//      AudioWorkletNode wiring) is wrapped and re-thrown as AudioInitError —
//      useShadowV1 maps THAT to the new 'audio_init' code. This is more
//      robust than sniffing err.name (addModule's CSP rejection can itself
//      be a SecurityError, which would otherwise collide with a genuine
//      getUserMedia SecurityError) — the boundary is structural, not
//      name-based.
const SAMPLE_RATE = 16000;
const BUFFER_SIZE = 1600; // ~100ms at 16kHz — passed to the worklet via processorOptions

// Tagged error for any failure AFTER getUserMedia has already succeeded
// (AudioContext construction, addModule, AudioWorkletNode wiring). Kept
// distinct from getUserMedia's own DOMException so useShadowV1 can tell the
// two failure classes apart without relying on ambiguous err.name values.
export class AudioInitError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AudioInitError';
  }
}

export interface AudioPipeline {
  audioContext: AudioContext;
  analyserNode: AnalyserNode;
  stream: MediaStream;
  close: () => void;
}

// onChunk receives raw PCM16 ArrayBuffer
export async function createAudioPipeline(
  onChunk: (data: ArrayBuffer) => void,
): Promise<AudioPipeline> {
  // getUserMedia errors are NOT caught here — they propagate verbatim so the
  // caller (useShadowV1) can map them to 'mic_denied'.
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      sampleRate: SAMPLE_RATE,
    },
  });

  try {
    const audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);

    // Static file under web/public/ (served under '/', satisfies script-src 'self').
    await audioContext.audioWorklet.addModule('/pcm16-worklet.js');

    const worklet = new AudioWorkletNode(audioContext, 'pcm16-processor', {
      processorOptions: { bufferSize: BUFFER_SIZE },
    });
    worklet.port.onmessage = (e) => onChunk(e.data as ArrayBuffer);
    analyser.connect(worklet);
    worklet.connect(audioContext.destination); // needed for worklet to process

    return {
      audioContext,
      analyserNode: analyser,
      stream,
      close: () => {
        worklet.disconnect();
        analyser.disconnect();
        source.disconnect();
        stream.getTracks().forEach(t => t.stop());
        audioContext.close();
      },
    };
  } catch (err) {
    // Mic was already granted and opened — don't leak it just because
    // AudioWorklet setup failed (e.g. CSP-blocked addModule).
    stream.getTracks().forEach(t => t.stop());
    throw new AudioInitError('audio pipeline init failed', { cause: err });
  }
}
