import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { ShadowRecorder, SHADOW_CAP_MS } from '../shadow-recorder';
import type { AudioPipeline } from '../audio-pipeline';

// Helper to create mock AudioPipeline with required fields
function createMockPipeline(overrides?: Partial<AudioPipeline>): AudioPipeline {
  // In jsdom, AudioContext doesn't exist. Use mock objects instead.
  const mockAudioContext = {} as AudioContext;
  const mockAnalyserNode = {} as AnalyserNode;
  const mockStream = { getTracks: () => [] } as unknown as MediaStream;

  return {
    audioContext: mockAudioContext,
    analyserNode: mockAnalyserNode,
    stream: mockStream,
    close: vi.fn(),
    ...overrides,
  };
}

describe('ShadowRecorder', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts with inactive pipeline', () => {
    const recorder = new ShadowRecorder(() => {});
    expect(recorder.isActive()).toBe(false);
  });

  it('creates pipeline on start', async () => {
    const mockPipeline = createMockPipeline();
    const factory = vi.fn(async () => mockPipeline);

    const recorder = new ShadowRecorder(() => {}, factory);
    await recorder.start();

    expect(recorder.isActive()).toBe(true);
    expect(factory).toHaveBeenCalledOnce();
  });

  it('start is idempotent (repeated start on active recorder)', async () => {
    const mockPipeline = createMockPipeline();
    const factory = vi.fn(async () => mockPipeline);

    const recorder = new ShadowRecorder(() => {}, factory);
    await recorder.start();
    await recorder.start();

    // Factory should only be called once
    expect(factory).toHaveBeenCalledOnce();
    expect(recorder.isActive()).toBe(true);
  });

  it('collects chunks from pipeline callback', async () => {
    const chunks1 = new ArrayBuffer(10);
    const chunks2 = new ArrayBuffer(10);

    const mockPipeline = createMockPipeline();
    const factory = vi.fn(async (onChunk: (b: ArrayBuffer) => void) => {
      onChunk(chunks1);
      onChunk(chunks2);
      return mockPipeline;
    });

    const recorder = new ShadowRecorder(() => {}, factory);
    await recorder.start();

    const chunks = recorder.stop();
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toBe(chunks1);
    expect(chunks[1]).toBe(chunks2);
  });

  it('fires cap callback when maxMs elapses', async () => {
    const mockPipeline = createMockPipeline();
    const onCap = vi.fn();
    const factory = vi.fn(async () => mockPipeline);

    const recorder = new ShadowRecorder(onCap, factory, 60000);
    await recorder.start();

    vi.advanceTimersByTime(60000);

    expect(onCap).toHaveBeenCalledOnce();
  });

  it('cap timer can be cancelled by stop', async () => {
    const mockPipeline = createMockPipeline();
    const onCap = vi.fn();
    const factory = vi.fn(async () => mockPipeline);

    const recorder = new ShadowRecorder(onCap, factory, 60000);
    await recorder.start();

    // Stop before cap fires
    recorder.stop();

    // Advance timer beyond maxMs
    vi.advanceTimersByTime(60000);

    // Cap should NOT have fired
    expect(onCap).not.toHaveBeenCalled();
  });

  it('closes pipeline on stop', async () => {
    const mockPipeline = createMockPipeline();
    const factory = vi.fn(async () => mockPipeline);

    const recorder = new ShadowRecorder(() => {}, factory);
    await recorder.start();
    recorder.stop();

    expect(mockPipeline.close).toHaveBeenCalledOnce();
    expect(recorder.isActive()).toBe(false);
  });

  it('clears chunks after stop', async () => {
    const chunk = new ArrayBuffer(10);
    const mockPipeline = createMockPipeline();
    const factory = vi.fn(async (onChunk: (b: ArrayBuffer) => void) => {
      onChunk(chunk);
      return mockPipeline;
    });

    const recorder = new ShadowRecorder(() => {}, factory);
    await recorder.start();

    const chunks1 = recorder.stop();
    expect(chunks1.length).toBe(1);

    // Subsequent stop should return empty
    const chunks2 = recorder.stop();
    expect(chunks2.length).toBe(0);
  });

  it('analyser getter returns pipeline analyser or null', async () => {
    const mockAnalyser = {} as AnalyserNode;
    const mockPipeline = createMockPipeline({ analyserNode: mockAnalyser });
    const factory = vi.fn(async () => mockPipeline);

    const recorder = new ShadowRecorder(() => {}, factory);
    expect(recorder.analyser()).toBe(null);

    await recorder.start();
    expect(recorder.analyser()).toBe(mockAnalyser);

    recorder.stop();
    expect(recorder.analyser()).toBe(null);
  });

  it('uses custom maxMs from constructor', async () => {
    const mockPipeline = createMockPipeline();
    const onCap = vi.fn();
    const factory = vi.fn(async () => mockPipeline);
    const customMaxMs = 30000;

    const recorder = new ShadowRecorder(onCap, factory, customMaxMs);
    await recorder.start();

    vi.advanceTimersByTime(customMaxMs);

    expect(onCap).toHaveBeenCalledOnce();
  });

  it('default maxMs is SHADOW_CAP_MS (60s)', async () => {
    const mockPipeline = createMockPipeline();
    const onCap = vi.fn();
    const factory = vi.fn(async () => mockPipeline);

    const recorder = new ShadowRecorder(onCap, factory); // No maxMs
    await recorder.start();

    vi.advanceTimersByTime(SHADOW_CAP_MS);

    expect(onCap).toHaveBeenCalledOnce();
  });

  it('fable-audit MED-3: SHADOW_CAP_MS is pinned to the literal 60_000 (not self-referential)', () => {
    // The prior test above ("default maxMs is SHADOW_CAP_MS (60s)") advances fake
    // timers by SHADOW_CAP_MS itself, so it would still pass unchanged even if the
    // constant's value were mutated (e.g. to 6_000_000) — it's tautological. Pin
    // the literal here so a value regression is actually caught.
    expect(SHADOW_CAP_MS).toBe(60_000)
  })

  it('fable-audit MED-3: default recorder (no maxMs override) caps at exactly the literal 60_000ms, not before', async () => {
    const mockPipeline = createMockPipeline()
    const onCap = vi.fn()
    const factory = vi.fn(async () => mockPipeline)

    const recorder = new ShadowRecorder(onCap, factory) // no maxMs → default
    await recorder.start()

    vi.advanceTimersByTime(59_999)
    expect(onCap).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(onCap).toHaveBeenCalledOnce()
  })

  it('stop on inactive recorder is safe (no-op)', () => {
    const recorder = new ShadowRecorder(() => {});
    const chunks = recorder.stop();

    expect(chunks.length).toBe(0);
    expect(recorder.isActive()).toBe(false);
  });

  it('cap does not lose chunks: stop() after cap returns accumulated chunks', async () => {
    // HIGH: Verify that when cap fires, accumulated chunks remain available until stop()
    const chunk1 = new ArrayBuffer(10);
    const chunk2 = new ArrayBuffer(10);

    const mockPipeline = createMockPipeline();
    const factory = vi.fn(async (onChunk: (b: ArrayBuffer) => void) => {
      onChunk(chunk1);
      onChunk(chunk2);
      return mockPipeline;
    });

    const onCap = vi.fn();
    const recorder = new ShadowRecorder(onCap, factory, 60000);
    await recorder.start();

    // Advance timer to trigger cap
    vi.advanceTimersByTime(60000);
    expect(onCap).toHaveBeenCalledOnce();

    // After cap fires, chunks should still be available
    const chunks = recorder.stop();
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toBe(chunk1);
    expect(chunks[1]).toBe(chunk2);
  });
});
