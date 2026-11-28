// latest-started-wins + half-open [start,end)
export function findActiveCueIndex(cues: { start: number; end: number }[], t: number): number {
  let best = -1
  for (let i = 0; i < cues.length; i++) {
    if (t >= cues[i].start && t < cues[i].end) {
      if (best === -1 || cues[i].start > cues[best].start) best = i
    }
  }
  return best
}
