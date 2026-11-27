// player-telemetry.test.ts — чистая логика: только вперёд/назад-разделение
// rewind, repeat_on_same_line по КОНТЕНТ-хэшу строки, кламп watched_pct.
import { describe, it, expect } from 'vitest'
import {
  round2, watchedPct, createRewindTracker, watchProgressPayload,
  createAbLoopTracker, startCueHash, endCueHash, buildAbLoopPayload,
} from '../player-telemetry'
import { subLineHash } from '../../site/telemetry'

describe('round2 / watchedPct', () => {
  it('round2 keeps two decimals and coerces non-finite to 0', () => {
    expect(round2(12.3456)).toBe(12.35)
    expect(round2(NaN)).toBe(0)
    expect(round2(Infinity)).toBe(0)
  })
  it('watchedPct is 0 when duration is not ready', () => {
    expect(watchedPct(10, 0)).toBe(0)
    expect(watchedPct(10, NaN)).toBe(0)
    expect(watchedPct(10, -5)).toBe(0)
  })
  it('watchedPct is a clamped fraction', () => {
    expect(watchedPct(30, 120)).toBe(0.25)
    expect(watchedPct(130, 120)).toBe(1) // clamp: currentTime briefly > duration at the very end
    expect(watchedPct(0, 120)).toBe(0)
  })
})

describe('createRewindTracker', () => {
  it('emits nothing for a forward or no-op seek', () => {
    const track = createRewindTracker()
    expect(track({ fromTime: 10, toTime: 40 })).toBeNull() // forward
    expect(track({ fromTime: 10, toTime: 10 })).toBeNull() // no-op
  })

  it('emits a backward-seek payload with from/to and the line content hash', () => {
    const track = createRewindTracker()
    const p = track({ fromTime: 30, toTime: 10, videoId: 'v1', routeGoal: 'friends', lineText: 'A view from the bridge' })
    expect(p).not.toBeNull()
    expect(p!.from_time).toBe(30)
    expect(p!.to_time).toBe(10)
    expect(p!.timecode).toBe(30)
    expect(p!.video_id).toBe('v1')
    expect(p!.sub_line_hash).toBe(subLineHash('A view from the bridge'))
    expect(p!.repeat_on_same_line).toBe(false) // first time on this line
  })

  it('flags repeat_on_same_line only on consecutive rewinds of the SAME line', () => {
    const track = createRewindTracker()
    const line = 'the same difficult line'
    expect(track({ fromTime: 30, toTime: 10, lineText: line })!.repeat_on_same_line).toBe(false)
    expect(track({ fromTime: 30, toTime: 10, lineText: line })!.repeat_on_same_line).toBe(true)  // 2nd on same line
    expect(track({ fromTime: 50, toTime: 20, lineText: 'a different line' })!.repeat_on_same_line).toBe(false) // switched line
    expect(track({ fromTime: 50, toTime: 20, lineText: 'a different line' })!.repeat_on_same_line).toBe(true)  // repeat again
  })

  it('omits sub_line_hash when there is no subtitle line', () => {
    const track = createRewindTracker()
    const p = track({ fromTime: 30, toTime: 10, lineText: '   ' })
    expect(p!.sub_line_hash).toBeUndefined()
    expect(p!.repeat_on_same_line).toBe(false)
  })
})

describe('watchProgressPayload', () => {
  it('builds identical field shape for periodic vs final', () => {
    const base = { videoId: 'v1', routeGoal: 'friends', currentTime: 30, duration: 120 }
    const periodic = watchProgressPayload(base)
    const final = watchProgressPayload({ ...base, final: true })
    expect(periodic).toEqual({ video_id: 'v1', route_goal: 'friends', timecode: 30, current_time: 30, watched_pct: 0.25 })
    expect(final).toEqual({ ...periodic, final: true })
  })
})

// ---- ab_loop телеметрия ----

// Эпохи-миллисекунды в тестах длительности (ловушка ms→s): open/close задаём
// как реальные Date.now()-значения, ждём СЕКУНДЫ на выходе.
const T0 = 1_700_000_000_000

describe('createAbLoopTracker', () => {
  const range = { rangeStart: 10, rangeEnd: 14, videoId: 'v1' }
  const active = (over = {}) => ({ active: true, ...range, now: T0, ...over })

  it('opens on active and returns null; closes on !active with exit_reason user', () => {
    const t = createAbLoopTracker()
    expect(t.noteState(active())).toBeNull()
    const ended = t.noteState({ active: false, ...range, now: T0 + 3000 })
    expect(ended).not.toBeNull()
    expect(ended!.exitReason).toBe('user')
    expect(ended!.repeatCount).toBe(0)
    expect(ended!.rangeStart).toBe(10)
    expect(ended!.rangeEnd).toBe(14)
    expect(ended!.durationS).toBe(3)
  })

  it('noteRestart increments only while a session is open (phantom guard)', () => {
    const t = createAbLoopTracker()
    t.noteRestart()                    // no open session → ignored
    t.noteState(active())
    t.noteRestart(); t.noteRestart(); t.noteRestart()
    const ended = t.noteState({ active: false, ...range, now: T0 + 1000 })
    expect(ended!.repeatCount).toBe(3)
    t.noteRestart()                    // after close → ignored (stale countdown)
    // reopen and confirm counter reset (not carrying the phantom)
    t.noteState(active({ now: T0 + 2000 }))
    const ended2 = t.noteState({ active: false, ...range, now: T0 + 3000 })
    expect(ended2!.repeatCount).toBe(0)
  })

  it('MEANINGFUL retarget flushes the old session and opens a fresh one', () => {
    const t = createAbLoopTracker()
    t.noteState(active())
    t.noteRestart(); t.noteRestart()   // 2 repeats → meaningful
    const ended = t.noteState({ active: true, rangeStart: 20, rangeEnd: 25, videoId: 'v1', now: T0 + 5000 })
    expect(ended).not.toBeNull()
    expect(ended!.rangeStart).toBe(10)  // OLD range
    expect(ended!.rangeEnd).toBe(14)
    expect(ended!.repeatCount).toBe(2)
    expect(ended!.exitReason).toBe('user')
    // new session started at the retarget; closing it spans from there, count 0
    const ended2 = t.noteState({ active: false, rangeStart: 20, rangeEnd: 25, videoId: 'v1', now: T0 + 7000 })
    expect(ended2!.rangeStart).toBe(20)
    expect(ended2!.repeatCount).toBe(0)
    expect(ended2!.durationS).toBe(2)   // from retarget (T0+5000) to close (T0+7000)
  })

  it('TRIVIAL retarget (0 repeats, <1s) is merged silently — no event, range updated', () => {
    const t = createAbLoopTracker()
    t.noteState(active())
    // drag storm: many sub-second, 0-repeat range changes → all merged
    expect(t.noteState({ active: true, rangeStart: 11, rangeEnd: 14, videoId: 'v1', now: T0 + 100 })).toBeNull()
    expect(t.noteState({ active: true, rangeStart: 12, rangeEnd: 14, videoId: 'v1', now: T0 + 200 })).toBeNull()
    expect(t.noteState({ active: true, rangeStart: 13, rangeEnd: 16, videoId: 'v1', now: T0 + 300 })).toBeNull()
    // final range wins; closing yields ONE session with the last range
    const ended = t.noteState({ active: false, rangeStart: 13, rangeEnd: 16, videoId: 'v1', now: T0 + 2000 })
    expect(ended!.rangeStart).toBe(13)
    expect(ended!.rangeEnd).toBe(16)
    // trivial retarget resets startedAt → drag time is EXCLUDED from duration_s:
    // measured from the last merge (T0+300) to close (T0+2000) = 1.7s, not 2s.
    expect(ended!.durationS).toBe(1.7)
  })

  it('sub-second 0-repeat DISABLE still emits (deliberate toggle B→B-off is a real event, unlike a drag)', () => {
    const t = createAbLoopTracker()
    t.noteState(active())
    const ended = t.noteState({ active: false, ...range, now: T0 + 200 }) // <1s, 0 repeats
    expect(ended).not.toBeNull()
    expect(ended!.repeatCount).toBe(0)
    expect(ended!.durationS).toBe(0.2)
  })

  it('videoId change while active closes as video_change and does NOT reopen', () => {
    const t = createAbLoopTracker()
    t.noteState(active())
    t.noteRestart()
    const ended = t.noteState({ active: true, rangeStart: 10, rangeEnd: 14, videoId: 'v2', now: T0 + 2000 })
    expect(ended!.exitReason).toBe('video_change')
    expect(ended!.videoId).toBe('v1')   // OLD video
    expect(ended!.repeatCount).toBe(1)
    // no reopen: a same-values call must NOT emit anything (nothing open)
    expect(t.noteState({ active: true, rangeStart: 10, rangeEnd: 14, videoId: 'v2', now: T0 + 2000 })).toBeNull()
    // but a subsequent close of the freshly-opened v2 session works
    const ended2 = t.noteState({ active: false, rangeStart: 10, rangeEnd: 14, videoId: 'v2', now: T0 + 4000 })
    expect(ended2!.videoId).toBe('v2')
  })

  it('idempotent: identical noteState returns null; the still-open session spans from the ORIGINAL open', () => {
    const t = createAbLoopTracker()
    t.noteState(active())
    expect(t.noteState(active({ now: T0 + 500 }))).toBeNull() // identical range → no-op (StrictMode)
    const ended = t.noteState({ active: false, ...range, now: T0 + 4000 })
    expect(ended!.durationS).toBe(4)  // from ORIGINAL open (T0), not reset by the idempotent call
  })

  it('noteTerminal on a meaningful session emits terminal and CLOSES (no reopen — no hidden-tab inflation)', () => {
    const t = createAbLoopTracker()
    t.noteState(active())
    t.noteRestart(); t.noteRestart()
    const term = t.noteTerminal({ now: T0 + 3000 })
    expect(term!.exitReason).toBe('terminal')
    expect(term!.repeatCount).toBe(2)
    expect(term!.durationS).toBe(3) // real loop time (open→terminal), NOT inflated
    // no reopen: later restarts ignored, a later close emits nothing...
    t.noteRestart()
    expect(t.noteState({ active: false, ...range, now: T0 + 5000 })).toBeNull()
    // ...and a much-later 2nd terminal does NOT emit a phantom 0-repeat huge-duration session
    expect(t.noteTerminal({ now: T0 + 1_000_000 })).toBeNull()
  })

  it('double noteTerminal in one teardown emits exactly ONE event', () => {
    const t = createAbLoopTracker()
    t.noteState(active())
    t.noteRestart()
    const first = t.noteTerminal({ now: T0 + 3000 })
    expect(first).not.toBeNull()
    // second terminal (pagehide right after visibilitychange): first already
    // closed the session (open=null), so the second short-circuits on nothing-open.
    const second = t.noteTerminal({ now: T0 + 3000 })
    expect(second).toBeNull()
  })

  it('TRIVIAL open session at terminal is DISCARDED and closed → no hidden-tab inflation on return', () => {
    const t = createAbLoopTracker()
    t.noteState(active())                                  // open, 0 repeats
    // alt-tab within 1s: trivial (0 repeats, <1s) → not emitted, but CLOSED.
    expect(t.noteTerminal({ now: T0 + 200 })).toBeNull()
    // returns 10 min later and disables: session is gone, so NO inflated-duration
    // event is produced (the whole hidden interval cannot leak into duration_s).
    expect(t.noteState({ active: false, ...range, now: T0 + 600_000 })).toBeNull()
  })

  it('noteTerminal with no open session returns null', () => {
    const t = createAbLoopTracker()
    expect(t.noteTerminal({ now: T0 })).toBeNull()
  })

  it('duration_s is SECONDS from epoch-ms input (unit trap)', () => {
    const t = createAbLoopTracker()
    t.noteState({ active: true, ...range, now: 1_700_000_000_000 })
    const ended = t.noteState({ active: false, ...range, now: 1_700_000_012_340 })
    expect(ended!.durationS).toBe(12.34)
  })

  it('degenerate range (rangeEnd<=rangeStart makes active false) opens no session', () => {
    const t = createAbLoopTracker()
    // caller computes active; a degenerate range means active:false by construction
    expect(t.noteState({ active: false, rangeStart: 10, rangeEnd: 10, videoId: 'v1', now: T0 })).toBeNull()
    expect(() => t.noteRestart()).not.toThrow() // no session, restart is a no-op
    expect(t.noteState({ active: false, rangeStart: 10, rangeEnd: 10, videoId: 'v1', now: T0 + 1000 })).toBeNull()
  })

  it('clock running backwards clamps duration_s to 0 (never negative in the log)', () => {
    const t = createAbLoopTracker()
    t.noteState(active({ now: T0 + 5000 }))
    const ended = t.noteState({ active: false, ...range, now: T0 }) // now < startedAt
    expect(ended!.durationS).toBe(0)
  })

  it('same-call !active AND videoId change → exit_reason user (disable wins branch order)', () => {
    const t = createAbLoopTracker()
    t.noteState(active())
    const ended = t.noteState({ active: false, rangeStart: 10, rangeEnd: 14, videoId: 'v2', now: T0 + 2000 })
    expect(ended!.exitReason).toBe('user')
    expect(ended!.videoId).toBe('v1')
  })

  it('SEQUENCE: open→3 restarts→retarget→2 restarts→disable→terminal yields exactly 2 events', () => {
    const t = createAbLoopTracker()
    const emitted: Array<{ repeatCount: number; exitReason: string }> = []
    const push = (e: ReturnType<typeof t.noteState>) => { if (e) emitted.push({ repeatCount: e.repeatCount, exitReason: e.exitReason }) }

    push(t.noteState(active()))                 // open
    t.noteRestart(); t.noteRestart(); t.noteRestart()
    push(t.noteState({ active: true, rangeStart: 30, rangeEnd: 34, videoId: 'v1', now: T0 + 4000 })) // retarget (meaningful) → emit 3
    t.noteRestart(); t.noteRestart()
    push(t.noteState({ active: false, rangeStart: 30, rangeEnd: 34, videoId: 'v1', now: T0 + 8000 })) // disable → emit 2
    push(t.noteTerminal({ now: T0 + 9000 }))    // nothing open → null

    expect(emitted).toEqual([
      { repeatCount: 3, exitReason: 'user' },
      { repeatCount: 2, exitReason: 'user' },
    ])
  })
})

describe('startCueHash / endCueHash', () => {
  // Contiguous cues (cue1.end === cue2.start) so the end-boundary off-by-one is LETHAL
  // to a `start<=t<end` mutation on the end lookup.
  const cues = [
    { start: 10, end: 14, text_en: 'A view from the bridge' },
    { start: 14, end: 18, text_en: 'the second line entirely' },
  ]
  it('line-loop (rangeStart=cue.start, rangeEnd=cue.end) hashes the SAME cue at both ends', () => {
    const sh = startCueHash(cues, 10)
    const eh = endCueHash(cues, 14)
    expect(sh).toBe(subLineHash('A view from the bridge'))
    expect(eh).toBe(subLineHash('A view from the bridge')) // NOT the next line
    expect(sh).toBe(eh)
  })
  it('multi-cue range hashes different lines at the two ends', () => {
    expect(startCueHash(cues, 10)).not.toBe(endCueHash(cues, 18))
  })
  it('returns undefined when no cue covers the time', () => {
    expect(startCueHash(cues, 100)).toBeUndefined()
    expect(endCueHash(cues, 0)).toBeUndefined()
  })
})

describe('buildAbLoopPayload', () => {
  const cues = [
    { start: 10, end: 14, text_en: 'first line here now' },
    { start: 14, end: 18, text_en: 'second different line' },
  ]
  const base = { videoId: 'v1', repeatCount: 3, durationS: 12.34, exitReason: 'user' as const }

  it('line-loop: sub_line_hash present, range_end_hash KEY ABSENT (not undefined-valued)', () => {
    const p = buildAbLoopPayload({ ...base, rangeStart: 10, rangeEnd: 14 }, 'v1', cues, 'friends')
    expect(p.sub_line_hash).toBe(subLineHash('first line here now'))
    expect('range_end_hash' in p).toBe(false)
    expect(p.repeat_count).toBe(3)
    expect(p.duration_s).toBe(12.34)
    expect(p.exit_reason).toBe('user')
    expect(p.range_start).toBe(10)
    expect(p.range_end).toBe(14)
    expect(p.route_goal).toBe('friends')
  })
  it('multi-cue: both hashes present and different', () => {
    const p = buildAbLoopPayload({ ...base, rangeStart: 10, rangeEnd: 18 }, 'v1', cues, undefined)
    expect(p.sub_line_hash).toBe(subLineHash('first line here now'))
    expect(p.range_end_hash).toBe(subLineHash('second different line'))
    expect(p.sub_line_hash).not.toBe(p.range_end_hash)
  })
  it('video_change (ended.videoId != current): both hash keys absent, event still built', () => {
    const p = buildAbLoopPayload({ ...base, rangeStart: 10, rangeEnd: 14, exitReason: 'video_change' }, 'v2', cues, undefined)
    expect('sub_line_hash' in p).toBe(false)
    expect('range_end_hash' in p).toBe(false)
    expect(p.video_id).toBe('v1')
    expect(p.repeat_count).toBe(3)
    expect(p.exit_reason).toBe('video_change')
  })
})
