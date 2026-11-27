import { useCallback, useEffect, useState } from 'react';
import type { TrackSelection } from './track-selection';

function isTextTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}

// useTrackSelection owns the «G»-held modifier state and the one committed
// track selection. «G» is a HOLD modifier (not a toggle) — repeated keydown
// auto-repeats are idempotent, so there is no flicker. The drag geometry
// lives in WorkspacePanelThemed; this hook is pure state.
export function useTrackSelection() {
  const [gHeld, setGHeld] = useState(false);
  const [selection, setSelection] = useState<TrackSelection | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'g' && e.key !== 'G') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTextTarget(e.target)) return;
      setGHeld(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'g' || e.key === 'G') setGHeld(false);
    };
    const onBlur = () => setGHeld(false);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  const clearSelection = useCallback(() => setSelection(null), []);

  return { gHeld, selection, setSelection, clearSelection };
}
