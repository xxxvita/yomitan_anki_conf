// useShadowV1 — vertical-slice shadowing state machine.
// idle → recording → transcribing → result | error. On stop: PCM→WAV→POST /api/stt
// → matchWordsDetailed(spoken, referenceText) → attempt. Bounds: resolveLoopBounds.
// referenceText/cueIndex — snapshot of the active cue AT RECORDING START (desktop
// parity: index.tsx:1502/1509/1527/1536 — activeCueText is read at activate; see
// T3 brief §0.1 for the byte-verified quote). Lesson #8: video clock ONLY via
// adapter.currentTime(), never Date.now().
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PlayerAdapter } from '../../adapter/PlayerAdapter'
import type { Cue as SubtitleCue } from './useSubtitles'
import type { WorkspaceApi } from './useWorkspace'
import { ShadowRecorder } from '../workspace/shadow-recorder'
import { AudioInitError } from '../workspace/audio-pipeline'
import { concatPcm16, encodeWav } from '../workspace/wav-encoder'
import { pcm16Peaks } from '../workspace/pcm16-peaks'
import { matchWordsDetailed, type WordMark } from '../workspace/word-matcher'
import { resolveLoopBounds } from '../workspace/loop-bounds'
import { useShadowAttempts } from './useShadowAttempts'
import type { ShadowAttemptStored, PanelAttempts } from '../workspace/shadow-attempts'
import type { RecordingEntry } from '../workspace/api-types'
import { useVideoPlayerStore } from '../workspace/video-player-store'

export type ShadowPhase = 'idle' | 'recording' | 'transcribing' | 'result' | 'error'
// audio_init (CSP hotfix, fix/shadow-worklet-csp): AudioWorklet setup failed
// AFTER getUserMedia already succeeded (e.g. CSP-blocked addModule) — distinct
// from mic_denied so the user isn't told "no mic access" when the mic is fine.
export type ShadowErrorCode = 'mic_denied' | 'too_large' | 'rate_limited' | 'gateway' | 'no_speech' | 'audio_init'

// DI seam: the only public surface useShadowV1 needs from a recorder. An interface
// (not the concrete ShadowRecorder class) on purpose — ShadowRecorder has private
// fields, so a duck-typed test fake could never structurally satisfy the class type.
// A real `new ShadowRecorder(onCap)` still satisfies this interface (its public
// members are a superset), so the default factory below needs no adapter shim.
export interface ShadowRecorderLike {
  start(): Promise<void>
  stop(): ArrayBuffer[]
  // WEB-SEAM (visual fix, fix/shadow-worklet-csp): optional so existing test
  // fakes (ShadowRecorderLike duck-types without it) keep compiling. The real
  // ShadowRecorder class already has this method (shadow-recorder.ts:37) — it
  // exposes the live AudioPipeline.analyserNode for the ShadowCard's
  // Oscillograph. Does NOT touch the AudioInitError/audio_init catch-block below.
  analyser?(): AnalyserNode | null
}

// DI seam for tests: swap createRecorder and postStt (jsdom has no getUserMedia / blob-POST).
export interface ShadowV1Deps {
  createRecorder?: (onCap: () => void) => ShadowRecorderLike
  postStt?: (wav: Blob, languageCode: string) => Promise<{ status: number; text: string }>
}

async function defaultPostStt(wav: Blob, languageCode: string): Promise<{ status: number; text: string }> {
  const fd = new FormData()
  fd.append('file', wav, 'shadow.wav')
  if (languageCode) fd.append('language_code', languageCode)
  const resp = await fetch('/api/stt', { method: 'POST', body: fd })
  if (!resp.ok) return { status: resp.status, text: '' }
  const json = await resp.json() as { text?: string }
  return { status: resp.status, text: (json.text ?? '').trim() }
}

export interface ShadowV1Api {
  active: boolean
  phase: ShadowPhase
  errorCode: ShadowErrorCode | null
  remainingSec: number
  referenceText: string
  cueIndex: number
  lastMarks: WordMark[] | null
  lastMatchPct: number | null
  lastSpoken: string | null
  capped: boolean
  recordAudioUrl: string | null
  // WEB-SEAM (visual fix, fix/shadow-worklet-csp): additive passthrough of the
  // active recorder's AnalyserNode, so ShadowCardLifted's Oscillograph stays
  // live (owner's ask — restoring what T4's earlier pass had cut). null outside
  // 'recording' phase (recorder is closed/absent).
  analyserNode: AnalyserNode | null
  shadowAttempts: PanelAttempts
  recordings: RecordingEntry[]
  activate(): void
  deactivate(): void
  toggle(): void
  startRecording(): Promise<void>
  stopRecording(): void
  dismissResult(): void
  selectRecording(id: string): void
  deleteRecording(id: string): void
}

export function useShadowV1(
  adapter: PlayerAdapter | null,
  videoId: string,
  cues: SubtitleCue[],
  activeIndex: number,
  ws: WorkspaceApi,
  deps: ShadowV1Deps = {},
): ShadowV1Api {
  const attempts = useShadowAttempts(videoId)
  const setYouTrackRecordingId = useVideoPlayerStore(s => s.setYouTrackRecordingId)

  const [active, setActive] = useState(false)
  const [phase, setPhase] = useState<ShadowPhase>('idle')
  const [errorCode, setErrorCode] = useState<ShadowErrorCode | null>(null)
  const [remainingSec, setRemainingSec] = useState(60)
  const [capped, setCapped] = useState(false)
  const [lastMarks, setLastMarks] = useState<WordMark[] | null>(null)
  const [lastMatchPct, setLastMatchPct] = useState<number | null>(null)
  const [lastSpoken, setLastSpoken] = useState<string | null>(null)
  const [recordAudioUrl, setRecordAudioUrl] = useState<string | null>(null)
  // Ф1 accept-feedback #8, bug 3 ("Заново не послушаешь" — own recording won't
  // replay): the raw wav Blob for the LATEST attempt. recordAudioUrl itself is
  // now derived from this via a dedicated effect below (not minted inline inside
  // a setState updater — see that effect's comment for why).
  const [lastWav, setLastWav] = useState<Blob | null>(null)
  // WEB-SEAM (visual fix): live AnalyserNode passthrough — see ShadowV1Api.analyserNode above.
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null)

  // In-memory blob Map (id→Blob) — NOT persisted (V1). RecordingEntry meta lives
  // in separate state so the YOU track can render without holding onto blobs.
  const blobsRef = useRef<Map<string, Blob>>(new Map())
  const [recordings, setRecordings] = useState<RecordingEntry[]>([])

  // Snapshot of reference/cue/start — taken at the moment recording starts.
  // endSec is filled in later, synchronously in stopRecording (see there) — it
  // is NOT known yet at startRecording time, hence the 0 default (harmless:
  // cueIndex stays -1 until a real snapshot exists, and canFallbackToLastAttempt
  // below gates on cueIndex >= 0 first).
  const snapRef = useRef<{ refText: string; cueIndex: number; startSec: number; endSec: number }>({ refText: '', cueIndex: -1, startSec: 0, endSec: 0 })
  const recorderRef = useRef<ShadowRecorderLike | null>(null)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // T3 review finding #1: deactivate() during 'transcribing' must invalidate any
  // ALREADY IN-FLIGHT finalize() (recorderRef is already null by then — stopRecording
  // cleared it before awaiting postStt — so deactivate has nothing left to .stop()).
  // Without this, a late postStt resolve still applies its result (phase→'result',
  // attempts.add, blob-URL) after the user has already deactivated. genRef is a
  // monotonic generation token: finalize snapshots it on entry, deactivate bumps it,
  // finalize re-checks it before applying ANY result (setPhase/attempts.add/blob-URL).
  const genRef = useRef(0)

  const postStt = deps.postStt ?? defaultPostStt

  // referenceText/cueIndex "now" (for UI before recording starts) — the raw active
  // cue (desktop parity: cues[activeCueIndex].text; web text slot = text_en).
  const liveReferenceText = cues[activeIndex]?.text_en ?? ''
  const liveCueIndex = activeIndex

  // Ф1 accept-feedback #8, bug 2 ("Записать не работает" after a result, 0%-кейс):
  // root cause is useWorkspace.ts's reachBoundary() — it calls adapter.pause()
  // exactly AT rangeEnd, and for a subtitle-bound AB loop rangeEnd === the cue's
  // own `end` (useWorkspace.ts toggleABLoop). active-cue.ts's findActiveCueIndex
  // is a HALF-OPEN [start,end) match, so the instant playback pauses at that
  // boundary, `activeIndex` flips to -1 and referenceText/cueIndex go blank —
  // precisely while finalize() (above) is landing the user in phase==='result'
  // (or 'error'). Without a fallback, startRecording()'s own guard below
  // (`cueIndex < 0 || !referenceText`) then refuses to start a NEW attempt on
  // the exact line the user just recorded, and the disabled Record button
  // (ShadowCardLifted.tsx reads `referenceText`) looks broken too. Fall back to
  // snapRef (the cue that WAS being recorded, snapshotted in startRecording
  // below) whenever the live cue is unavailable AND we're sitting in
  // result/error with a valid snapshot from that attempt — live values still
  // win whenever they're actually present (e.g. the user has scrubbed onto a
  // different real cue), and the fallback stops applying the moment the user
  // moves on (dismissResult → phase 'idle' → canFallbackToLastAttempt false).
  // Ре-ревью Ф1, находка #2 (MED — фолбэк бага-2 шире корня): the guard above
  // used to fire on cueIndex/phase alone, so it ALSO kicked in when the user
  // scrubbed into an inter-replica GAP (findActiveCueIndex returns -1 between
  // two cues, not just at the boundary the bug-2 fix targeted) — reference
  // text from a long-finished attempt would then resurface for a completely
  // unrelated point in the video. Require the CURRENT playback position to
  // still be near the snapshot's own recorded range too: [start-0.75, end+0.75]
  // (0.75s tolerance for the same boundary-pause imprecision bug-2's fix
  // already relies on). adapter can be null (tests / no adapter wired yet) —
  // treat that as "unknown position", which must NOT fall back silently.
  const nowSec = adapter?.currentTime() ?? null
  const GAP_TOLERANCE_SEC = 0.75
  const nearSnapshotRange = nowSec != null &&
    nowSec >= snapRef.current.startSec - GAP_TOLERANCE_SEC &&
    nowSec <= snapRef.current.endSec + GAP_TOLERANCE_SEC
  const canFallbackToLastAttempt = (phase === 'result' || phase === 'error') && snapRef.current.cueIndex >= 0 && nearSnapshotRange
  const referenceText = liveReferenceText || (canFallbackToLastAttempt ? snapRef.current.refText : '')
  const cueIndex = liveCueIndex >= 0 ? liveCueIndex : (canFallbackToLastAttempt ? snapRef.current.cueIndex : -1)

  const clearTick = useCallback(() => {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null }
  }, [])

  const finalize = useCallback(async (chunks: ArrayBuffer[], endSec: number) => {
    // Snapshot the generation BEFORE the only await point in this function. If
    // deactivate() runs while we're suspended on postStt, it bumps genRef — the
    // check right after the await catches that and drops this result entirely
    // (no setPhase, no attempts.add, no blob-URL ever minted for it).
    const myGen = genRef.current
    setPhase('transcribing')
    const samples = concatPcm16(chunks)
    if (samples.length === 0) { setErrorCode('no_speech'); setPhase('error'); return }
    const wav = encodeWav(samples)
    const lang = 'en' // L2 target (english shadowing); subtitle-language wiring lands in V2
    let res: { status: number; text: string }
    try { res = await postStt(wav, lang) }
    catch { if (genRef.current === myGen) { setErrorCode('gateway'); setPhase('error') }; return }
    // Deactivated while we were awaiting postStt — this result is stale, drop it
    // silently. Nothing has been applied yet (no setPhase/attempts.add/blob-URL
    // past this point), so there is nothing to revoke or roll back.
    if (genRef.current !== myGen) return
    if (res.status === 413) { setErrorCode('too_large'); setPhase('error'); return }
    if (res.status === 429) { setErrorCode('rate_limited'); setPhase('error'); return }
    if (res.status !== 200) { setErrorCode('gateway'); setPhase('error'); return }
    const spoken = res.text
    if (!spoken) { setErrorCode('no_speech'); setPhase('error'); return }
    const { refText, cueIndex: ci, startSec } = snapRef.current
    // endSec arrives as a PARAMETER, snapshotted synchronously in stopRecording
    // BEFORE this function's await postStt — see fable-audit MED-1 fix below.
    const { marks, matchPct } = matchWordsDetailed(spoken, refText)
    const loopRange = ws.rangeEnd > ws.rangeStart ? { start: ws.rangeStart, end: ws.rangeEnd } : null
    const bounds = resolveLoopBounds(loopRange, startSec, endSec)
    const id = `${Date.now()}-${Math.random().toString(16).slice(2, 6)}`
    const created = new Date().toISOString()
    const stored: ShadowAttemptStored = {
      id, cue_index: ci, text: spoken, marks, match_pct: matchPct,
      audio_start_sec: bounds.start, audio_end_sec: bounds.end, created_at: created,
    }
    attempts.add(stored)
    // blob + RecordingEntry (in-session only — no audio on reload, V1). Reuses the
    // WAV already encoded for the STT upload rather than re-encoding the samples.
    blobsRef.current.set(id, wav)
    setLastWav(wav)
    const peaks = pcm16Peaks(samples)
    setRecordings(prev => [...prev, {
      id, cue_index: ci, audio_start_sec: bounds.start, audio_end_sec: bounds.end,
      kind: 'auto', duration_sec: Math.max(0, bounds.end - bounds.start),
      peaks, filename: '', created_at: created,
    }])
    setLastMarks(marks); setLastMatchPct(matchPct); setLastSpoken(spoken)
    setPhase('result')
  }, [ws, attempts, postStt])

  const stopRecording = useCallback(() => {
    clearTick()
    const rec = recorderRef.current
    recorderRef.current = null
    setAnalyserNode(null)
    if (!rec) return
    // fable-audit MED-1: endSec MUST be read here — synchronously, before
    // finalize's `await postStt` — not inside finalize after the await. STT
    // round-trip latency (~1.5s live) elapses while the video keeps playing;
    // reading adapter.currentTime() after the await over-counts that latency
    // onto audio_end_sec, inflating the attempt/YOU-track duration. Desktop
    // canon takes attempt time bounds at archive/record boundaries (index.tsx
    // :1530-1532), i.e. at the moment recording actually stops — this snapshot
    // sits right next to the existing referenceText/cueIndex/startSec snapshot
    // convention (taken at recording START in startRecording, above).
    const endSec = adapter?.currentTime() ?? snapRef.current.startSec
    // Ре-ревью Ф1, находка #2: stash endSec back onto the snapshot so
    // canFallbackToLastAttempt (below) can gate on the recorded [start,end]
    // range, not just cueIndex. Read snapRef.current.startSec is unaffected —
    // this only adds the field finalize's endSec already computed.
    snapRef.current = { ...snapRef.current, endSec }
    const chunks = rec.stop()
    void finalize(chunks, endSec)
  }, [clearTick, finalize, adapter])

  const startRecording = useCallback(async () => {
    if (phase === 'recording' || phase === 'transcribing') return
    if (cueIndex < 0 || !referenceText) { setErrorCode('no_speech'); setPhase('error'); return }
    setErrorCode(null); setCapped(false); setLastMarks(null); setLastMatchPct(null); setLastSpoken(null)
    // Snapshot reference/cue/start. endSec is a placeholder here (mirrors
    // startSec) — it is only meaningful once stopRecording overwrites it with
    // the real recording end, which always happens before phase can reach
    // 'result'/'error' (the only phases canFallbackToLastAttempt cares about).
    const nowSec = adapter?.currentTime() ?? 0
    snapRef.current = { refText: referenceText, cueIndex, startSec: nowSec, endSec: nowSec }
    const factory = deps.createRecorder ?? ((onCap) => new ShadowRecorder(onCap))
    const rec = factory(() => { setCapped(true); stopRecording() }) // cap → normal stop+transcribe (see shadow-recorder RATIONALE)
    try { await rec.start() }
    catch (err) {
      // AudioInitError = getUserMedia succeeded but AudioWorklet setup failed
      // afterwards (e.g. CSP-blocked addModule — see audio-pipeline.ts).
      // Anything else is treated as a getUserMedia-class failure (permission
      // denied, no device, device busy, etc.) → mic_denied, as before.
      if (err instanceof AudioInitError) { setErrorCode('audio_init'); setPhase('error'); return }
      setErrorCode('mic_denied'); setPhase('error'); return
    }
    recorderRef.current = rec
    setAnalyserNode(rec.analyser?.() ?? null)
    setRemainingSec(60); setPhase('recording')
    const startedAt = Date.now()
    tickRef.current = setInterval(() => {
      const left = Math.max(0, 60 - Math.floor((Date.now() - startedAt) / 1000))
      setRemainingSec(left)
    }, 250)
  }, [phase, cueIndex, referenceText, adapter, deps, stopRecording])

  const dismissResult = useCallback(() => { setPhase('idle'); setErrorCode(null); setCapped(false) }, [])

  const activate = useCallback(() => { setActive(true) }, [])
  const deactivate = useCallback(() => {
    // Stop an in-flight recording, quiesce state (lesson #14: isolation, no reset()).
    clearTick()
    // Invalidate any finalize() already in flight (phase==='transcribing': recorderRef
    // is already null there, so rec.stop() below is a no-op for it — see genRef above).
    genRef.current += 1
    const rec = recorderRef.current; recorderRef.current = null
    setAnalyserNode(null)
    if (rec) rec.stop()
    setActive(false); setPhase('idle'); setErrorCode(null); setCapped(false)
  }, [clearTick])
  const toggle = useCallback(() => { active ? deactivate() : activate() }, [active, activate, deactivate])

  // T5-review fix (finding #4): a videoId change while shadowing is active
  // must reset it. Without this, an in-flight recording/snapshot from the OLD
  // video (referenceText/cueIndex/snapRef captured against the previous cues)
  // silently keeps running against the new video — the mic stays live with
  // no reference text that matches what's on screen anymore. deactivate()
  // already stops the recorder and bumps the T3 generation-guard, so a
  // straightforward edge-detect on videoId is enough; useShadowAttempts
  // (called above) already resets its own persisted/live state on the same
  // videoId change, this just extends that to the activation/recording state
  // that lives in this hook.
  const prevVideoIdRef = useRef(videoId)
  useEffect(() => {
    if (prevVideoIdRef.current === videoId) return
    prevVideoIdRef.current = videoId
    if (active) deactivate()
  }, [videoId, active, deactivate])

  const selectRecording = useCallback((id: string) => { setYouTrackRecordingId(id) }, [setYouTrackRecordingId])
  const deleteRecording = useCallback((id: string) => {
    blobsRef.current.delete(id)
    setRecordings(prev => prev.filter(r => r.id !== id))
    attempts.remove(id)
  }, [attempts])

  // T3 review finding #3 (superseded by the Ф1 bug-3 fix below): recordAudioUrl
  // is a minted blob: URL that must be revoked exactly once, whether it's
  // replaced by a newer attempt OR the hook unmounts while one is still set
  // (e.g. user navigates away right after a result) — otherwise it leaks for
  // the lifetime of the document.
  //
  // Ф1 accept-feedback #8, bug 3 ("Заново не послушаешь" — own recording won't
  // replay): this used to be TWO effects — one mirroring recordAudioUrl into a
  // ref, one revoking on unmount — PLUS the actual mint/revoke pair living
  // inside finalize()'s `setRecordAudioUrl(prev => { revoke(prev); return
  // createObjectURL(wav) })` functional updater. That updater is an IMPURE side
  // effect (URL.createObjectURL/revokeObjectURL have observable effects beyond
  // the returned value) run from inside a state-updater callback — React 18
  // StrictMode deliberately invokes updater functions TWICE in dev specifically
  // to catch this: each finalize() minted a SECOND, untracked blob URL that was
  // never revoked (a genuine per-attempt leak), while whichever invocation
  // React happened to keep became the "real" one. Moving mint+revoke into a
  // plain effect keyed on the wav Blob itself makes the lifecycle exactly-once
  // per real commit: the effect's own cleanup fires on EITHER "superseded by a
  // newer attempt" (dep changes) or "hook unmounts" (component teardown) — one
  // canonical place instead of three, and no more impure-updater double-mint.
  useEffect(() => {
    if (!lastWav) return
    const url = URL.createObjectURL(lastWav)
    setRecordAudioUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [lastWav])

  const shadowAttempts = attempts.forPanel

  return useMemo<ShadowV1Api>(() => ({
    active, phase, errorCode, remainingSec, referenceText, cueIndex,
    lastMarks, lastMatchPct, lastSpoken, capped, recordAudioUrl, analyserNode,
    shadowAttempts, recordings,
    activate, deactivate, toggle, startRecording, stopRecording, dismissResult,
    selectRecording, deleteRecording,
  }), [active, phase, errorCode, remainingSec, referenceText, cueIndex, lastMarks,
       lastMatchPct, lastSpoken, capped, recordAudioUrl, analyserNode, shadowAttempts, recordings,
       activate, deactivate, toggle, startRecording, stopRecording, dismissResult,
       selectRecording, deleteRecording])
}
