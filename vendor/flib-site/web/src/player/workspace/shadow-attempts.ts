// shadow-attempts.ts — WEB-SEAM port of index.tsx:2528-2546 (shadowAttemptsForPanel).
// Desktop merges all shadow.attempts into the bucket String(activeCueIndex) (its
// attempts are all for the current cue). Web generalization: a live attempt carries
// its own cue_index, so we merge each into its own bucket (superset-correct — desktop
// is the single-cue special case of this).
import type { WordMark } from './word-matcher'

export interface ShadowAttemptStored {
  id: string
  cue_index: number
  text: string
  marks: WordMark[]
  match_pct: number
  audio_start_sec: number
  audio_end_sec: number
  created_at: string
}

// ТЗ №3 п.3 — `text` (heard transcript) is now carried into the panel shape so
// the history feed can render "повтор N · % · услышано: {text}". OPTIONAL and
// additive: V1-persisted attempts (and the YOU-track consumer in types.ts that
// only reads match_pct/audio bounds) are unaffected — old localStorage entries
// simply have no `text` and render the score-only line.
export type PanelAttempts = Record<string, {
  attempts: { match_pct: number; audio_start_sec?: number; audio_end_sec?: number; text?: string }[]
}>

export function mergeShadowAttemptsForPanel(
  persisted: PanelAttempts | undefined,
  live: ShadowAttemptStored[],
): PanelAttempts {
  if (!live.length) return persisted ?? {}
  const merged: PanelAttempts = { ...(persisted ?? {}) }
  for (const a of live) {
    if (a.cue_index < 0) continue
    const key = String(a.cue_index)
    const existing = merged[key]?.attempts ?? []
    merged[key] = {
      attempts: [
        ...existing,
        { match_pct: a.match_pct, audio_start_sec: a.audio_start_sec, audio_end_sec: a.audio_end_sec, text: a.text },
      ],
    }
  }
  return merged
}
