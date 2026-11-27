import { describe, it, expect } from 'vitest';
import { clampCueEdges } from '../cue-clamp';

describe('cue-clamp', () => {
  it('should clamp right edge when it exceeds 100', () => {
    const result = clampCueEdges(98, 10);
    expect(result.left).toBe(98);
    expect(result.width).toBe(2); // 100 - 98 = 2
  });

  it('should clamp left edge when it is below 0', () => {
    const result = clampCueEdges(-5, 20);
    expect(result.left).toBe(0);
    expect(result.width).toBe(15); // right is min(100, -5+20=15), so 15 - 0 = 15
  });

  it('should ensure minimum width of 0.3', () => {
    const result = clampCueEdges(50, 0.01);
    expect(result.width).toBe(0.3);
  });

  it('should handle normal case without clamping', () => {
    const result = clampCueEdges(20, 30);
    expect(result.left).toBe(20);
    expect(result.width).toBe(30);
  });

  it('should preserve left position when within bounds', () => {
    const result = clampCueEdges(10, 20);
    expect(result.left).toBe(10);
    expect(result.width).toBe(20);
  });

  it('should clamp left when it exceeds 100 (window 100..105 leaked past edge — fb#6)', () => {
    const result = clampCueEdges(103, 5);
    expect(result.left).toBe(99.7); // 100 − minWidth(0.3)
    expect(result.width).toBe(0.3);
  });

  it('should clamp left for a far-off-view right leak', () => {
    const result = clampCueEdges(150, 10);
    expect(result.left).toBe(99.7);
    expect(result.width).toBe(0.3);
  });

  it('should keep left exactly at the 99.7 cap boundary', () => {
    const result = clampCueEdges(99.7, 1);
    expect(result.left).toBe(99.7);
    expect(result.width).toBe(0.3); // right=min(100,100.7)=100 → 100−99.7=0.3
  });
});
