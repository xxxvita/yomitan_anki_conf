import { describe, it, expect } from 'vitest';
import { recordingRect } from '../recording-rect';

describe('recordingRect — clamp to visible frame (fb#6)', () => {
  const view = { viewStart: 0, viewEnd: 100 }; // 1s == 1%

  it('clamps left when the span starts past the right edge', () => {
    // start=103s → l=103%, end=110s → r=110%. Должен упереться в 99.7 / ширина 0.3.
    const rect = recordingRect({ audio_start_sec: 103, audio_end_sec: 110 }, view, 0);
    expect(rect).not.toBeNull();
    expect(rect!.left).toBe(99.7);
    expect(rect!.width).toBe(0.3);
  });

  it('clamps a left-straddling span to 0 without distorting the right edge', () => {
    // start=-10s → l=-10%, end=30s → r=30%. left→0, width→30.
    const rect = recordingRect({ audio_start_sec: -10, audio_end_sec: 30 }, view, 0);
    expect(rect).not.toBeNull();
    expect(rect!.left).toBe(0);
    expect(rect!.width).toBe(30);
  });

  it('caps the right edge at 100 for an over-wide span', () => {
    const rect = recordingRect({ audio_start_sec: 20, audio_end_sec: 130 }, view, 0);
    expect(rect).not.toBeNull();
    expect(rect!.left).toBe(20);
    expect(rect!.width).toBe(80); // right=min(100,130)=100 → 100−20
  });

  it('returns null when fully off-screen', () => {
    expect(recordingRect({ audio_start_sec: 200, audio_end_sec: 210 }, view, 0)).toBeNull();
  });
});
