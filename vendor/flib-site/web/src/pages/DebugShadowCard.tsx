// DebugShadowCard.tsx — DEV-ONLY visual QA harness for the ShadowCard overlay
// (accept #1 gate: "render the card in a browser with mocked states, screenshot
// it, compare to the desktop etalon"). Mirrors exactly what
// ShadowCardLifted.test.tsx already does (render <ShadowCard shadow={fake} />
// with a hand-built ShadowV1Api) — same seam, just in a real browser instead of
// jsdom, so a human/reviewer can actually SEE it. Switch state via ?phase=
// query param: idle | recording | transcribing | result | error.
// Never shipped: gated by import.meta.env.DEV in main.tsx (route only
// registered in dev builds) and not linked from anywhere in the real app.
import { useSearchParams } from 'react-router-dom'
import { ShadowCard } from '../player/workspace/ShadowCardLifted'
import { usePlayerTheme } from '../player/theme/usePlayerTheme'
import type { ShadowV1Api, ShadowPhase, ShadowErrorCode } from '../player/hooks/useShadowV1'
import type { WordMark } from '../player/workspace/word-matcher'

// One example of each of the 4 WordMark kinds — the exact fixture shape the
// task asked for ("мок-состояния result с marks 4 kinds").
const FOUR_KIND_MARKS: WordMark[] = [
  { w: 'hello', kind: 'ok' },
  { w: 'word', kind: 'wrong', expected: 'world' },
  { w: 'there', kind: 'missing' },
  { w: 'yeah', kind: 'extra' },
]

function mkShadow(phase: ShadowPhase, errorCode: ShadowErrorCode | null): ShadowV1Api {
  return {
    active: true,
    phase,
    errorCode,
    remainingSec: phase === 'recording' ? 42 : 60,
    referenceText: 'Hello there, how are you doing today',
    cueIndex: 0,
    lastMarks: phase === 'result' ? FOUR_KIND_MARKS : null,
    lastMatchPct: phase === 'result' ? 62 : null,
    lastSpoken: phase === 'result' ? 'hello word yeah' : null,
    capped: false,
    recordAudioUrl: null,
    analyserNode: null,
    // Review-acceptance #1 fix pass (F3): fixture attempt history for the
    // 'result' state so the accept-gate screenshot actually shows the
    // attempts-feed with several cards, not just the single synthesized
    // latest one. Older entries are score-only (no recording joined — same as
    // a real page reload, see ShadowCardLifted.tsx WEB-SEAM note); the LAST
    // entry lines up with lastMatchPct/lastMarks below (the component slices
    // it off and renders it via the synthesized "latest" row instead).
    // Ф1 bug #1 fix accept-gate: bumped 3→6 entries so the screenshot actually
    // exercises the internal-scroll fix (card capped at 78vh, only the feed
    // scrolls) instead of a short list that would fit either way.
    shadowAttempts: phase === 'result'
      ? { '0': { attempts: [{ match_pct: 30 }, { match_pct: 45 }, { match_pct: 55 }, { match_pct: 68 }, { match_pct: 78 }, { match_pct: 62 }] } }
      : {},
    recordings: [],
    activate: () => {},
    deactivate: () => {},
    toggle: () => {},
    startRecording: async () => {},
    stopRecording: () => {},
    dismissResult: () => {},
    selectRecording: () => {},
    deleteRecording: () => {},
  }
}

export function DebugShadowCard() {
  const [params] = useSearchParams()
  const phase = (params.get('phase') as ShadowPhase) || 'result'
  const errorCode = (params.get('err') as ShadowErrorCode) || 'mic_denied'
  const { themeRef } = usePlayerTheme()
  const shadow = mkShadow(phase, phase === 'error' ? errorCode : null)

  return (
    <div
      ref={themeRef}
      data-dusk="site"
      style={{ position: 'relative', width: '100vw', height: '100vh', background: '#1a1310' }}
    >
      <ShadowCard shadow={shadow} />
    </div>
  )
}
