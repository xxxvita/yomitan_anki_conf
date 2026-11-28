// WEB-CUT: copied ONLY the formatTime() function body from desktop
// utils/vtt-parser.ts (task-1-brief.md Step 1) — the rest of that file
// (parseTime/parseVTT, Cue-typed) is not part of the panel's dependency
// surface and is intentionally left behind.
export function formatTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
