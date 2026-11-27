// cue-shape-adapter.test.ts — T2 WEB-SEAM #Cue: {start,end,text_en} →
// {startTime,endTime,text}. Covers the pure adapter AND the concrete failure
// it prevents (useAnnotations.getDefaultEndTime silently breaking on
// un-adapted live cues — task-T2-brief.md §Часть2.6).
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { toDesktopCue, toDesktopCues } from '../cue-shape-adapter';
import type { Cue as LiveCue } from '../../hooks/useSubtitles';
import { useAnnotations } from '../../hooks/useAnnotations';

describe('toDesktopCue / toDesktopCues', () => {
  it('maps {start,end,text_en,text_ru} → {startTime,endTime,text} (text = text_en)', () => {
    const live: LiveCue = { start: 1.5, end: 3.25, text_en: 'hello', text_ru: 'привет' };
    expect(toDesktopCue(live)).toEqual({ startTime: 1.5, endTime: 3.25, text: 'hello' });
  });

  it('maps an array preserving order', () => {
    const live: LiveCue[] = [
      { start: 0, end: 2, text_en: 'a', text_ru: 'а' },
      { start: 2, end: 4, text_en: 'b', text_ru: 'б' },
    ];
    expect(toDesktopCues(live)).toEqual([
      { startTime: 0, endTime: 2, text: 'a' },
      { startTime: 2, endTime: 4, text: 'b' },
    ]);
  });
});

describe('WEB-SEAM #Cue — without the adapter, getDefaultEndTime silently breaks', () => {
  it('un-adapted live cues (wrong field names) never match → addAnnotation always falls back to time+5', () => {
    // Deliberately feed useAnnotations RAW live-shaped cues (cast through
    // unknown, as if the adapter had been forgotten at a call site) — every
    // `time >= c.startTime` / `time < c.endTime` reads `undefined` and is
    // always false, so getDefaultEndTime can never snap to the cue and always
    // falls through to `time + 5`, regardless of `time` actually being inside
    // a live cue's [start,end).
    const rawLiveCues = [{ start: 0, end: 2, text_en: 'a', text_ru: 'а' }] as unknown as
      Parameters<typeof useAnnotations>[1];
    const { result } = renderHook(() => useAnnotations('/v/x.mp4', rawLiveCues, 0));
    let id = '';
    act(() => { id = result.current.addAnnotation(1, { type: 'text', x: 0, y: 0, width: 0.1, height: 0.1, color: '#fff', lineWidth: 1, opacity: 1 }); });
    const ann = result.current.project.annotations.find(a => a.id === id)!;
    expect(ann.endTime).toBe(1 + 5); // fallback — NOT the cue's real endTime (2)
  });

  it('WITH the adapter applied at the call site, getDefaultEndTime correctly snaps to the live cue end', () => {
    const liveCues: LiveCue[] = [{ start: 0, end: 2, text_en: 'a', text_ru: 'а' }];
    const { result } = renderHook(() => useAnnotations('/v/x.mp4', toDesktopCues(liveCues), 0));
    let id = '';
    act(() => { id = result.current.addAnnotation(1, { type: 'text', x: 0, y: 0, width: 0.1, height: 0.1, color: '#fff', lineWidth: 1, opacity: 1 }); });
    const ann = result.current.project.annotations.find(a => a.id === id)!;
    expect(ann.endTime).toBe(2); // snapped to the (adapted) cue's real endTime
  });
});
