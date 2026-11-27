// Подделка <audio> для тестов плеера и экранов: EventTarget с play/pause/load, ручное управление
// исходом (playing/error/тишина), журнал src. Ни один звук не играет — jsdom play() не реализует.
// ok — playing, затем ended (если до того не поставили на паузу и не сменили src); start — только playing
// (звук идёт и не кончается: прерывание посреди слова, стенд D2).
export type FakeMode = 'ok' | 'start' | 'error' | 'silent' | 'reject' | 'reject-other';

export class FakeAudio extends EventTarget {
  src = '';
  preload = '';
  paused = true;
  played: string[] = [];
  pauses = 0;
  loads = 0;
  constructor(private mode: () => FakeMode) { super(); }
  play(): Promise<void> {
    this.played.push(this.src);
    const m = this.mode();
    if (m === 'reject') return Promise.reject(new DOMException('play() requires a gesture', 'NotAllowedError'));
    if (m === 'reject-other') return Promise.reject(new DOMException('decode', 'EncodingError'));
    this.paused = false;
    const src = this.src;
    queueMicrotask(() => {
      if (m === 'ok' || m === 'start') this.dispatchEvent(new Event('playing'));
      if (m === 'error') this.dispatchEvent(new Event('error'));
      if (m === 'ok') queueMicrotask(() => { if (!this.paused && this.src === src) this.dispatchEvent(new Event('ended')); });
    });
    return Promise.resolve();
  }
  pause(): void { this.paused = true; this.pauses++; }
  load(): void { this.loads++; }
  removeAttribute(name: string): void { if (name === 'src') this.src = ''; }
}

/** Фабрика: все созданные элементы и общий режим (по src — свой: missing — 404 = error). */
export function fakeAudioFactory(opts: { mode?: FakeMode; missing?: (src: string) => boolean } = {}) {
  const els: FakeAudio[] = [];
  const state = { mode: opts.mode ?? 'ok' as FakeMode };
  const make = () => {
    const a: FakeAudio = new FakeAudio(() => (opts.missing?.(a.src) ? 'error' : state.mode));
    els.push(a);
    return a as unknown as HTMLAudioElement;
  };
  return { make, els, state, plays: () => els.flatMap((e) => e.played) };
}
