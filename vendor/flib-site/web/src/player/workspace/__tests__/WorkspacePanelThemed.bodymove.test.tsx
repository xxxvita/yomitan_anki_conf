// WorkspacePanelThemed.bodymove.test.tsx — T6 seam test: body-move drag on a
// shadow-exercise block (mousedown on the BODY, not an edge-resize handle) —
// [startTime,endTime] translate together, then on mouseup resolveMovedExercise
// (T1-lifted helper) decides snap-to-subtitle vs free time-range, and the
// result is forwarded through onExerciseUpdate with positionsCustomized:true +
// {resolveConflicts:true} (T6 brief). Renders WorkspacePanelThemed DIRECTLY
// (not through the WorkspacePanel wrapper) — WorkspacePanel does not forward
// shadowExercises/onExercise* yet (that page-wiring is explicitly deferred to
// the PlayerPage-swap slice, see progress notes), so this is the only seam in
// scope for T6 that can exercise the drag with real DOM events.
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { WorkspacePanelThemed } from '../WorkspacePanelThemed';
import { buildDuskPlayerTheme } from '../theme/dusk';
import type { WorkspacePanelThemedProps } from '../WorkspacePanelThemed';
import type { ShadowExerciseAnnotation } from '../panel-types';

function makeExercise(overrides: Partial<ShadowExerciseAnnotation> = {}): ShadowExerciseAnnotation {
  return {
    id: 'ex1',
    startTime: 0,
    endTime: 2,
    anchorMode: 'time-range',
    settings: {
      loopMode: false,
      advanceEnabled: false,
      advanceThreshold: 80,
      mode: 'subtitle',
      saveAudio: false,
      engines: { asr: 'x', check: 'y', ocr: 'z' },
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function baseProps(overrides: Partial<WorkspacePanelThemedProps> = {}): WorkspacePanelThemedProps {
  return {
    theme: buildDuskPlayerTheme('refined' as any),
    workspace: { active: true, rangeStart: 0, rangeEnd: 0, looping: false, pauseAtEnd: 0, viewStart: 0, viewEnd: 20 },
    cues: [
      { startTime: 5, endTime: 8, text: 'a' },
      { startTime: 10, endTime: 13, text: 'b' },
    ],
    currentTime: 0,
    duration: 20,
    muted: false,
    offset: 0,
    getEffectiveStart: (_i, s) => s,
    getEffectiveEnd: (_i, e) => e,
    onSetRange: vi.fn(),
    onSetView: vi.fn(),
    onZoom: vi.fn(),
    onFitToRange: vi.fn(),
    onToggleMute: vi.fn(),
    onSeek: vi.fn(),
    onPlayPause: vi.fn(),
    playing: false,
    onExit: vi.fn(),
    shadowActive: false,
    onToggleShadow: vi.fn(),
    ...overrides,
  } as WorkspacePanelThemedProps;
}

describe('WorkspacePanelThemed — body-move drag (T6)', () => {
  it('dragging the body onto a free subtitle snaps to it and calls onExerciseUpdate with resolveConflicts:true', () => {
    const rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 1000, height: 60, right: 1000, bottom: 60, x: 0, y: 0,
      toJSON() { return {} },
    } as DOMRect);
    const onExerciseUpdate = vi.fn();
    const onExerciseClick = vi.fn();

    try {
      const { container } = render(
        <WorkspacePanelThemed
          {...baseProps({
            shadowExercises: [makeExercise()],
            onExerciseUpdate,
            onExerciseClick,
          })}
        />
      );
      const body = container.querySelector('[data-shadow-exercise]') as HTMLElement;
      expect(body).toBeTruthy();

      // view [0,20] over a 1000px bar → 50px/sec. Move dx=500px → dt=10s:
      // exercise [0,2] → [10,12], midpoint 11 → inside cue #1 [10,13] → snap.
      fireEvent.mouseDown(body, { button: 0, clientX: 0, clientY: 0 });
      fireEvent.mouseMove(window, { clientX: 500, clientY: 0 });
      fireEvent.mouseUp(window);

      expect(onExerciseUpdate).toHaveBeenCalledTimes(1);
      expect(onExerciseUpdate).toHaveBeenCalledWith(
        'ex1',
        { startTime: 10, endTime: 13, anchorMode: 'subtitle', subIndex: 1, positionsCustomized: true },
        { resolveConflicts: true },
      );
      // A real move must not also fire the click-select path.
      expect(onExerciseClick).not.toHaveBeenCalled();
    } finally {
      rectSpy.mockRestore();
    }
  });

  it('dragging the body into a gap (no cue at the midpoint) stays a free time-range', () => {
    const rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 1000, height: 60, right: 1000, bottom: 60, x: 0, y: 0,
      toJSON() { return {} },
    } as DOMRect);
    const onExerciseUpdate = vi.fn();

    try {
      const { container } = render(
        <WorkspacePanelThemed
          {...baseProps({ shadowExercises: [makeExercise()], onExerciseUpdate })}
        />
      );
      const body = container.querySelector('[data-shadow-exercise]') as HTMLElement;

      // dx=150px → dt=3s: exercise [0,2] → [3,5], midpoint 4 → gap between
      // cue #0 [5,8] and nothing before it → time-range, not a snap.
      fireEvent.mouseDown(body, { button: 0, clientX: 0, clientY: 0 });
      fireEvent.mouseMove(window, { clientX: 150, clientY: 0 });
      fireEvent.mouseUp(window);

      expect(onExerciseUpdate).toHaveBeenCalledWith(
        'ex1',
        { startTime: 3, endTime: 5, anchorMode: 'time-range', subIndex: undefined, positionsCustomized: true },
        { resolveConflicts: true },
      );
    } finally {
      rectSpy.mockRestore();
    }
  });

  it('does NOT snap onto a cue already owned by another exercise', () => {
    const rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 1000, height: 60, right: 1000, bottom: 60, x: 0, y: 0,
      toJSON() { return {} },
    } as DOMRect);
    const onExerciseUpdate = vi.fn();

    try {
      const other = makeExercise({ id: 'ex-other', anchorMode: 'subtitle', subIndex: 1, startTime: 10, endTime: 13 });
      const moving = makeExercise({ id: 'ex1' });
      const { container } = render(
        <WorkspacePanelThemed
          {...baseProps({ shadowExercises: [moving, other], onExerciseUpdate })}
        />
      );
      // Two exercise blocks render — the moving one is the first (`ex1`) in
      // document order (array order preserved by the .map render).
      const bodies = container.querySelectorAll('[data-shadow-exercise]');
      const body = bodies[0] as HTMLElement;

      fireEvent.mouseDown(body, { button: 0, clientX: 0, clientY: 0 });
      fireEvent.mouseMove(window, { clientX: 500, clientY: 0 }); // same drag as test 1 → midpoint 11
      fireEvent.mouseUp(window);

      // cue #1 is occupied by `ex-other` → moving exercise stays time-range
      // at its dragged position instead of snapping onto the taken cue.
      expect(onExerciseUpdate).toHaveBeenCalledWith(
        'ex1',
        { startTime: 10, endTime: 12, anchorMode: 'time-range', subIndex: undefined, positionsCustomized: true },
        { resolveConflicts: true },
      );
    } finally {
      rectSpy.mockRestore();
    }
  });

  it('a plain click (no movement past the 4px threshold) selects instead of moving', () => {
    const rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 1000, height: 60, right: 1000, bottom: 60, x: 0, y: 0,
      toJSON() { return {} },
    } as DOMRect);
    const onExerciseUpdate = vi.fn();
    const onExerciseClick = vi.fn();

    try {
      const { container } = render(
        <WorkspacePanelThemed
          {...baseProps({ shadowExercises: [makeExercise()], onExerciseUpdate, onExerciseClick })}
        />
      );
      const body = container.querySelector('[data-shadow-exercise]') as HTMLElement;

      fireEvent.mouseDown(body, { button: 0, clientX: 100, clientY: 0 });
      fireEvent.mouseMove(window, { clientX: 102, clientY: 0 }); // 2px < 4px threshold
      fireEvent.mouseUp(window);
      fireEvent.click(body);

      expect(onExerciseUpdate).not.toHaveBeenCalled();
      expect(onExerciseClick).toHaveBeenCalledWith('ex1');
    } finally {
      rectSpy.mockRestore();
    }
  });

  it('edge-resize is unchanged by body-move: dragging the right handle still patches only startTime/endTime, no opts', () => {
    const rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 1000, height: 60, right: 1000, bottom: 60, x: 0, y: 0,
      toJSON() { return {} },
    } as DOMRect);
    const onExerciseUpdate = vi.fn();
    const onExerciseClick = vi.fn();

    try {
      const ex = makeExercise({ startTime: 0, endTime: 4 });
      const { container } = render(
        <WorkspacePanelThemed
          {...baseProps({ shadowExercises: [ex], onExerciseUpdate, onExerciseClick })}
        />
      );
      const body = container.querySelector('[data-shadow-exercise]') as HTMLElement;
      // Select first (resize handles only render once selected) — a plain
      // click, well under the move threshold.
      fireEvent.mouseDown(body, { button: 0, clientX: 0, clientY: 0 });
      fireEvent.mouseUp(window);
      fireEvent.click(body);
      expect(onExerciseClick).toHaveBeenCalledWith('ex1');

      const rightHandle = container.querySelector('[title="Drag right edge"]') as HTMLElement;
      expect(rightHandle).toBeTruthy();

      fireEvent.mouseDown(rightHandle, { button: 0, clientX: 0, clientY: 0 });
      fireEvent.mouseMove(window, { clientX: 100, clientY: 0 }); // dt=2s → endTime 4→6
      fireEvent.mouseUp(window);

      expect(onExerciseUpdate).toHaveBeenCalledTimes(1);
      expect(onExerciseUpdate).toHaveBeenCalledWith('ex1', { startTime: 0, endTime: 6 });
    } finally {
      rectSpy.mockRestore();
    }
  });
});
