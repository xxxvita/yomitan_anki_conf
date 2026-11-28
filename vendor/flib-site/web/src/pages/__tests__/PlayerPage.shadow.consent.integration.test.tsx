// PlayerPage.shadow.consent.integration.test.tsx — [ID:P-F-consent] proves the
// owner's 2026-07-10 decision end-to-end in the assembled PlayerPage: an
// AUTOSTART arm must NOT silently open the mic. The first autostart-arm per
// session shows a one-shot "Начать практику с микрофоном?" prompt; the arm/loop
// still run (hands-free UX intact) but useShadowMicStream is handed
// micConsentGranted=false until the user consents. Manual arm (S) grants
// directly (no prompt). "Не сейчас" declines for the session (sticky, React-only).
//
// Faked seams: IFrameAdapter → fake with _setTime; fetch → canned subtitles;
// realtime-answer-source → isRealtimeAnswerEnabled()=true (so the consent gate is
// LIVE) but selectAnswerSource forced to Fake (no WebSocket); useShadowMicStream
// → a SPY that records the args PlayerPage handed it (so we assert the
// micConsentGranted gate value without a real getUserMedia/pipeline).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { StrictMode } from 'react'
import { PlayerPage } from '../PlayerPage'
import type { ShadowExerciseAnnotation } from '../../player/workspace/panel-types'
import { MIC_CONSENT_KEY } from '../../player/workspace/shadow-mic-consent'

const CUES = [
  { start: 0, end: 2, text_en: 'hello world', text_ru: 'привет мир' },
  { start: 2, end: 4, text_en: 'second cue', text_ru: 'вторая реплика' },
]
const VIDEO_ID = 'abc123XYZ_1'
const EXERCISE_KEY = `flib:shadow-exercises:${VIDEO_ID}`

const mockAdapterHolder = vi.hoisted(() => ({ adapter: null as any }))
// Records the LAST args PlayerPage passed useShadowMicStream — micConsentGranted
// is the gate under test. The hook is a no-op spy (jsdom has no getUserMedia).
const micWrap = vi.hoisted(() => ({ lastArgs: null as any }))

vi.mock('../../adapter/IFrameAdapter', () => ({
  createIFrameAdapter: async () => {
    const { makeFakeAdapter } = await import('../../adapter/__tests__/fake')
    mockAdapterHolder.adapter = makeFakeAdapter({ duration: 120, t: 1 })
    return mockAdapterHolder.adapter
  },
}))

vi.mock('../../player/hooks/useShadowMicStream', () => ({
  useShadowMicStream: (args: any) => { micWrap.lastArgs = args },
}))

// Realtime ON so shadowRealtimeEnabled=true (the consent gate is live), but the
// answer source stays Fake (no real WebSocket in tests).
vi.mock('../../player/workspace/realtime-answer-source', async (importActual) => {
  const actual = await importActual<typeof import('../../player/workspace/realtime-answer-source')>()
  return {
    ...actual,
    isRealtimeAnswerEnabled: () => true,
    selectAnswerSource: (opts: any = {}) => actual.selectAnswerSource({ ...opts, forceFake: true }),
  }
})

function seedExercise(overrides: Partial<ShadowExerciseAnnotation> = {}): ShadowExerciseAnnotation {
  const ex: ShadowExerciseAnnotation = {
    id: 'ex-seed-1',
    startTime: 0,
    endTime: 2,
    anchorMode: 'time-range',
    settings: {
      loopMode: true, advanceEnabled: false, advanceThreshold: 80,
      mode: 'subtitle', saveAudio: false, engines: { asr: 'x', check: 'y', ocr: 'z' },
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
  localStorage.setItem(EXERCISE_KEY, JSON.stringify([ex]))
  return ex
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  // Э6 (Shadowing-гейт): хоткей S гейтится hasShadowingAccess так же, как
  // пилюля — без flib:access ручной S стал бы no-op и тест-сценарии consent
  // не запускались бы.
  localStorage.setItem('flib:access', JSON.stringify({ shadowing: true, keyPrefix: 'tpk_test', checkedAt: new Date().toISOString() }))
  mockAdapterHolder.adapter = null
  micWrap.lastArgs = null
  vi.stubGlobal('fetch', vi.fn((url: unknown) => {
    const u = String(url)
    if (u.includes('/api/youtube/subtitles')) {
      return Promise.resolve({
        ok: true, status: 200,
        json: async () => ({ video_id: VIDEO_ID, source_language: 'en', cues: CUES }),
      } as Response)
    }
    return Promise.reject(new Error(`unmocked fetch: ${u}`))
  }))
})

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
async function twoFrames() {
  await act(async () => { await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))) })
}
function renderPlayer(strict = false) {
  const tree = <MemoryRouter initialEntries={[`/player?v=${VIDEO_ID}`]}><PlayerPage /></MemoryRouter>
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree)
}

describe('[P-F-consent] session mic-consent for autostart', () => {
  // 1 — autostart arm without consent: arm+card happen, mic stays SHUT, prompt shown.
  it('autostart-arm without consent → card visible, micConsentGranted=false, prompt shown', async () => {
    seedExercise()
    const { queryByTestId } = renderPlayer()
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })

    // The arm/loop still run (hands-free UX intact) — card mounts.
    await waitFor(() => { expect(queryByTestId('shadow-card')).toBeTruthy() })
    // The prompt is up …
    await waitFor(() => { expect(queryByTestId('shadow-mic-consent')).toBeTruthy() })
    // … and the mic hook was told consent is NOT granted → pipeline stays closed.
    expect(micWrap.lastArgs.micConsentGranted).toBe(false)
    expect(micWrap.lastArgs.realtimeEnabled).toBe(true)
  })

  // 2 — "Начать": grants → mic gate opens, prompt gone, sessionStorage persisted.
  it('"Начать" → micConsentGranted flips true, prompt disappears, sessionStorage granted', async () => {
    seedExercise()
    const { queryByTestId, getByTestId } = renderPlayer()
    await waitFor(() => { expect(queryByTestId('shadow-mic-consent')).toBeTruthy() })

    fireEvent.click(getByTestId('shadow-mic-consent-accept'))

    await waitFor(() => { expect(queryByTestId('shadow-mic-consent')).toBeNull() })
    expect(micWrap.lastArgs.micConsentGranted).toBe(true) // reconcile now opens the mic
    expect(sessionStorage.getItem(MIC_CONSENT_KEY)).toBe('granted')
    // Card still there — granting does NOT tear the arm down.
    expect(queryByTestId('shadow-card')).toBeTruthy()
  })

  // 3 — "Не сейчас": declines → deactivate + suppress. Re-entering the region
  //     RE-ARMS (region logic) but stays mic-shut and does NOT re-prompt (declined
  //     is sticky for the session; a fresh tab would ask again).
  it('"Не сейчас" → deactivate + no re-prompt this session; re-entry re-arms mic-shut, no prompt', async () => {
    seedExercise() // [0,2], playhead t=1
    const { queryByTestId, getByTestId } = renderPlayer()
    await waitFor(() => { expect(queryByTestId('shadow-mic-consent')).toBeTruthy() })

    fireEvent.click(getByTestId('shadow-mic-consent-dismiss'))

    // Deactivated: card + prompt gone, nothing persisted (declined is React-only).
    await waitFor(() => { expect(queryByTestId('shadow-card')).toBeNull() })
    expect(queryByTestId('shadow-mic-consent')).toBeNull()
    expect(sessionStorage.getItem(MIC_CONSENT_KEY)).toBeNull()

    // Still inside [0,2) → suppressed, no re-arm (card stays gone).
    act(() => { mockAdapterHolder.adapter._setTime(1.5) })
    await act(async () => { await sleep(320) })
    expect(queryByTestId('shadow-card')).toBeNull()

    // Leave the region → suppression lifts …
    act(() => { mockAdapterHolder.adapter._setTime(3) })
    await act(async () => { await sleep(320) })
    // … re-enter → region logic RE-ARMS (card back), but 'declined' is sticky:
    // NO prompt, and the mic gate stays false.
    act(() => { mockAdapterHolder.adapter._setTime(1) })
    await waitFor(() => { expect(queryByTestId('shadow-card')).toBeTruthy() }, { timeout: 2000 })
    expect(queryByTestId('shadow-mic-consent')).toBeNull()
    expect(micWrap.lastArgs.micConsentGranted).toBe(false)
  })

  // 4 — manual S when unasked → grants directly (no prompt), mic gate opens.
  it('manual S (unasked) → grant without prompt, micConsentGranted=true', async () => {
    // No persisted exercise → autostart never fires; the ONLY arm is the manual S.
    renderPlayer()
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await twoFrames()
    expect(micWrap.lastArgs.micConsentGranted).toBe(false) // nothing granted yet

    // S over the active cue [0,2) at t=1 → manual arm → implicit consent.
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS' })) })

    await waitFor(() => { expect(micWrap.lastArgs.micConsentGranted).toBe(true) })
    expect(sessionStorage.getItem(MIC_CONSENT_KEY)).toBe('granted')
    // No prompt was ever shown for a manual arm.
    expect(document.querySelector('[data-testid="shadow-mic-consent"]')).toBeNull()
  })

  // 5 — sessionStorage='granted' at mount → autostart is fully hands-free, no prompt.
  it('sessionStorage granted at mount → autostart hands-free, no prompt', async () => {
    sessionStorage.setItem(MIC_CONSENT_KEY, 'granted')
    seedExercise()
    const { queryByTestId } = renderPlayer()
    await waitFor(() => { expect(queryByTestId('shadow-card')).toBeTruthy() })

    expect(queryByTestId('shadow-mic-consent')).toBeNull()
    expect(micWrap.lastArgs.micConsentGranted).toBe(true)
  })

  // 6 — StrictMode: double-mounted autostart still shows exactly the prompt state,
  //     no crash, mic-shut.
  it('StrictMode: autostart-arm without consent is stable (prompt shown, mic-shut, no crash)', async () => {
    seedExercise()
    const { queryByTestId } = renderPlayer(true)
    await waitFor(() => { expect(queryByTestId('shadow-mic-consent')).toBeTruthy() })
    expect(micWrap.lastArgs.micConsentGranted).toBe(false)
  })
})

// Fake-режим (realtime OFF, the DEFAULT test env) never prompts — proven in the
// sibling PlayerPage.shadow.autostart.integration.test.tsx (realtime off there),
// which arms via autostart yet renders no shadow-mic-consent prompt.
