// Pick a "nice" tick interval (seconds) for the current view span, targeting
// roughly 6–9 major labels across the viewport. Returns values from a small
// pre-defined set so the jumps feel predictable as the user zooms.
const NICE_STEPS = [
  1, 2, 5, 10, 15, 30,
  60, 120, 300, 600, 900, 1800,
  3600, 7200,
];

export function pickTickInterval(viewLenSec: number, targetCount = 7): number {
  if (!isFinite(viewLenSec) || viewLenSec <= 0) return 1;
  const raw = viewLenSec / targetCount;
  for (const step of NICE_STEPS) {
    if (step >= raw) return step;
  }
  return NICE_STEPS[NICE_STEPS.length - 1];
}

export function formatRulerLabel(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m.toString().padStart(2, '0')}:${ss.toString().padStart(2, '0')}`;
}

export interface RulerTick {
  time: number;
  pct: number;
  major: boolean;
  label?: string;
}

export function buildRulerTicks(
  viewStart: number,
  viewEnd: number,
  minorTicks: number,
): RulerTick[] {
  const viewLen = Math.max(0.001, viewEnd - viewStart);
  const majorStep = pickTickInterval(viewLen);
  const minorStep = minorTicks > 1 ? majorStep / minorTicks : 0;
  const ticks: RulerTick[] = [];
  const firstMajor = Math.ceil(viewStart / majorStep) * majorStep;
  for (let t = firstMajor; t <= viewEnd + 0.001; t += majorStep) {
    ticks.push({
      time: t,
      pct: ((t - viewStart) / viewLen) * 100,
      major: true,
      label: formatRulerLabel(t),
    });
    if (minorStep > 0) {
      for (let i = 1; i < minorTicks; i++) {
        const mt = t + minorStep * i;
        if (mt >= viewEnd) break;
        ticks.push({
          time: mt,
          pct: ((mt - viewStart) / viewLen) * 100,
          major: false,
        });
      }
    }
  }
  return ticks;
}
