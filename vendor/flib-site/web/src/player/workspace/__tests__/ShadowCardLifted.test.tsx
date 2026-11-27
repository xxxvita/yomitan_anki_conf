// ShadowCardLifted.test.tsx — visual-fix accept #1: RTL tests for the WEB-CUT
// full-only ShadowCard overlay, now VISUALLY lifted from the desktop
// ShadowChat.tsx (see file header for the WEB-CUT/WEB-SEAM manifest). All
// phase/kind/error/Close logic below is UNCHANGED from the T4 original —
// only the import path (component moved to ShadowCardLifted.tsx) and the
// `analyserNode` field (new additive ShadowV1Api member for the live
// Oscillograph) changed. Fake ShadowV1Api per phase (idle/recording/
// transcribing/result/error) — no real hook/adapter wiring needed, this
// component only renders `shadow` (ShadowV1Api).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { useEffect } from 'react'
import { render, fireEvent } from '@testing-library/react'
import { ShadowCard } from '../ShadowCardLifted'
import type { ShadowV1Api } from '../../hooks/useShadowV1'
import { setLocale } from '../../i18n'
import { useVideoPlayerStore } from '../video-player-store'
import type { RecordingEntry } from '../api-types'

// Test-only helper to reach into the module-level video-player-store (no
// direct setter export — same seam useShadowV1.selectRecording writes
// through). Used to assert the attempts-feed "selected" inset highlight
// (accept #1, finding F3) without re-implementing the store.
function SelectSetter({ id }: { id: string | null }) {
  const set = useVideoPlayerStore(s => s.setYouTrackRecordingId)
  useEffect(() => { set(id) }, [id, set])
  return null
}

function mkRecording(overrides: Partial<RecordingEntry> = {}): RecordingEntry {
  return {
    id: 'rec-x', cue_index: 0, audio_start_sec: 0, audio_end_sec: 1,
    kind: 'auto', duration_sec: 1, peaks: [], filename: '', created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function mkShadow(overrides: Partial<ShadowV1Api> = {}): ShadowV1Api {
  return {
    active: true,
    phase: 'idle',
    errorCode: null,
    remainingSec: 60,
    referenceText: 'hello world',
    cueIndex: 0,
    lastMarks: null,
    lastMatchPct: null,
    lastSpoken: null,
    capped: false,
    recordAudioUrl: null,
    analyserNode: null,
    shadowAttempts: {},
    recordings: [],
    activate: vi.fn(),
    deactivate: vi.fn(),
    toggle: vi.fn(),
    startRecording: vi.fn(async () => {}),
    stopRecording: vi.fn(),
    dismissResult: vi.fn(),
    selectRecording: vi.fn(),
    deleteRecording: vi.fn(),
    ...overrides,
  }
}

afterEach(() => {
  setLocale('ru')
  // Reset the module-level youTrackRecordingId store between tests (no direct
  // setter export — see SelectSetter above).
  const { unmount } = render(<SelectSetter id={null} />)
  unmount()
})

describe('ShadowCard', () => {
  // ── ТЗ №4 MED-8 [ID:P-tz4-fix]: rec-strip сжимаемость отдана «пустоте» ──
  it('MED-8: rec-strip содержит гибкий разделитель (flex:1 + minWidth:0) — сжимается пустота, а НЕ волна/кнопка, чтобы «Стоп» не клипался на узкой карте', () => {
    const shadow = mkShadow()
    const { getByTestId } = render(<ShadowCard shadow={shadow} handsFree />)
    const spacer = getByTestId('rec-strip-spacer') as HTMLElement
    // МУТАЦИЯ: убрать minWidth:0 → red (разделитель перестаёт сжиматься ниже
    // контента, «Стоп» выталкивается за правый край и клипается overflow:hidden).
    expect(spacer.style.minWidth).toBe('0')
    expect(spacer.style.flex).toContain('1')
  })

  it('idle phase with an active cue: reference text shown, Record enabled', () => {
    const shadow = mkShadow()
    const { getByTestId } = render(<ShadowCard shadow={shadow} />)
    expect(getByTestId('shadow-card').textContent).toContain('hello world')
    const recordBtn = getByTestId('shadow-record') as HTMLButtonElement
    expect(recordBtn.disabled).toBe(false)
    expect(recordBtn.textContent).toBe('Записать')
  })

  it('no active cue: referenceText empty → Record disabled + hint shown', () => {
    const shadow = mkShadow({ referenceText: '' })
    const { getByTestId, getByText } = render(<ShadowCard shadow={shadow} />)
    const recordBtn = getByTestId('shadow-record') as HTMLButtonElement
    expect(recordBtn.disabled).toBe(true)
    expect(getByText('Наведите курсор на реплику и нажмите запись')).toBeTruthy()
  })

  it('recording phase: rec-strip shows live status pill + mm:ss timer (visual lift, accept #1)', () => {
    const shadow = mkShadow({ phase: 'recording', remainingSec: 42 })
    const { getByText } = render(<ShadowCard shadow={shadow} />)
    expect(getByText('Говорите')).toBeTruthy() // StatusBadge, verbatim desktop text
    expect(getByText('0:42')).toBeTruthy() // rec-strip mm:ss timer
  })

  it('recording phase with a live analyserNode: Oscillograph canvas mounts without throwing', () => {
    const fakeAnalyser = {
      frequencyBinCount: 8,
      getByteFrequencyData: (arr: Uint8Array) => arr.fill(50),
    } as unknown as AnalyserNode
    const shadow = mkShadow({ phase: 'recording', analyserNode: fakeAnalyser })
    const { container } = render(<ShadowCard shadow={shadow} />)
    expect(container.querySelector('canvas')).toBeTruthy()
  })

  it('ТЗ №4 п.2: осциллограф ФИКС-размер 120×20, flex-grow запрещён (при широкой карте волна НЕ растёт)', () => {
    // Владелец Screenshot_20260710_182753: при ресайзе карты область звука
    // растягивалась по ширине (flex:1). Фикс: 120×20, лишнее место rec-strip
    // отдаётся таймеру/кнопкам/пустоте, НЕ волне.
    const fakeAnalyser = {
      frequencyBinCount: 8,
      getByteFrequencyData: (arr: Uint8Array) => arr.fill(50),
    } as unknown as AnalyserNode
    const shadow = mkShadow({ phase: 'recording', analyserNode: fakeAnalyser })
    const { container } = render(<ShadowCard shadow={shadow} />)
    const canvas = container.querySelector('canvas') as HTMLCanvasElement
    expect(canvas).toBeTruthy()
    expect(canvas.style.width).toBe('120px')  // фикс-ширина, не flex:1
    expect(canvas.style.flexGrow).toBe('0')    // рост запрещён
    expect(canvas.style.flexShrink).toBe('0')
  })

  it('recording phase: Stop button with countdown seconds, Record hidden', () => {
    const shadow = mkShadow({ phase: 'recording', remainingSec: 42 })
    const { getByTestId, queryByTestId } = render(<ShadowCard shadow={shadow} />)
    const stopBtn = getByTestId('shadow-stop')
    expect(stopBtn.textContent).toContain('42')
    expect(queryByTestId('shadow-record')).toBeNull()
    fireEvent.click(stopBtn)
    expect(shadow.stopRecording).toHaveBeenCalledTimes(1)
  })

  it('transcribing phase: Record button shows spinner label, disabled', () => {
    const shadow = mkShadow({ phase: 'transcribing' })
    const { getByTestId, getByText } = render(<ShadowCard shadow={shadow} />)
    const recordBtn = getByTestId('shadow-record') as HTMLButtonElement
    expect(recordBtn.disabled).toBe(true)
    expect(recordBtn.textContent).toBe('Распознаю…')
    expect(getByText('Анализ')).toBeTruthy() // StatusBadge, verbatim desktop text
  })

  it('result phase: latest attempt renders the B1 notation (ТЗ №3 п.3, replaces WordChip) + match% badge, "Again" dismisses', () => {
    const shadow = mkShadow({
      phase: 'result',
      lastMarks: [
        { w: 'hello', kind: 'ok' },
        { w: 'word', kind: 'wrong', expected: 'world' },
      ],
      lastMatchPct: 50,
      lastSpoken: 'hello word',
    })
    const { getByTestId, getByText } = render(<ShadowCard shadow={shadow} />)
    const diff = getByTestId('shadow-diff')
    // ТЗ №3 п.3 — latest is now the two-row B1 grid, NOT the old WordChip row.
    // If someone reverts to WordChip this data-testid disappears → red.
    expect(diff.querySelector('[data-testid="shadow-verdict-notation"]')).toBeTruthy()
    expect(diff.textContent).toContain('hello')
    expect(diff.textContent).toContain('word')  // what you said (ВЫ row)
    expect(diff.textContent).toContain('world') // expected (ЭТАЛОН row)
    expect(getByText('50%')).toBeTruthy()
    expect(getByText(/услышано/)).toBeTruthy()
    const againBtn = getByTestId('shadow-again')
    fireEvent.click(againBtn)
    expect(shadow.dismissResult).toHaveBeenCalledTimes(1)
  })

  it('match% badge colour follows pctTone thresholds (>=95 ok, >=80 warn, else danger)', () => {
    const high = mkShadow({ phase: 'result', lastMarks: [{ w: 'x', kind: 'ok' }], lastMatchPct: 97 })
    const mid = mkShadow({ phase: 'result', lastMarks: [{ w: 'x', kind: 'ok' }], lastMatchPct: 85 })
    const low = mkShadow({ phase: 'result', lastMarks: [{ w: 'x', kind: 'ok' }], lastMatchPct: 20 })

    const r1 = render(<ShadowCard shadow={high} />)
    expect(r1.getByText('97%').style.background).toContain('--ok')
    r1.unmount()

    const r2 = render(<ShadowCard shadow={mid} />)
    expect(r2.getByText('85%').style.background).toContain('--warn')
    r2.unmount()

    const r3 = render(<ShadowCard shadow={low} />)
    expect(r3.getByText('20%').style.background).toContain('--danger')
    r3.unmount()
  })

  it('B1 notation: kind=missing shows the ref word in an empty slot, kind=extra shows a leading "+" group', () => {
    const shadow = mkShadow({
      phase: 'result',
      lastMarks: [
        { w: 'skipped', kind: 'missing' },
        { w: 'bonus', kind: 'extra' },
      ],
      lastMatchPct: 0,
    })
    const { getByTestId } = render(<ShadowCard shadow={shadow} />)
    const diff = getByTestId('shadow-diff')
    expect(diff.textContent).toContain('skipped')
    expect(diff.textContent).toContain('+bonus')
  })

  it('error phase: human-readable ru text per errorCode, "Again" button present', () => {
    const shadow = mkShadow({ phase: 'error', errorCode: 'mic_denied' })
    const { getByTestId, getByText } = render(<ShadowCard shadow={shadow} />)
    expect(getByTestId('shadow-error').textContent).toBe('Нет доступа к микрофону')
    expect(getByTestId('shadow-again')).toBeTruthy()
    expect(getByText('Записать')).toBeTruthy() // record button still present alongside error
  })

  it('all 6 error codes map to distinct non-empty ru strings', () => {
    const codes: ShadowV1Api['errorCode'][] = ['mic_denied', 'too_large', 'rate_limited', 'gateway', 'no_speech', 'audio_init']
    const seen = new Set<string>()
    for (const code of codes) {
      const shadow = mkShadow({ phase: 'error', errorCode: code })
      const { getByTestId, unmount } = render(<ShadowCard shadow={shadow} />)
      const text = getByTestId('shadow-error').textContent || ''
      expect(text.length).toBeGreaterThan(0)
      seen.add(text)
      unmount()
    }
    expect(seen.size).toBe(codes.length)
  })

  it('capped notice shown when capped=true', () => {
    const shadow = mkShadow({ phase: 'result', capped: true, lastMarks: [{ w: 'x', kind: 'ok' }], lastMatchPct: 100 })
    const { getByText } = render(<ShadowCard shadow={shadow} />)
    expect(getByText('Достигнут лимит 60с — остановлено')).toBeTruthy()
  })

  it('recordAudioUrl set → <audio> element mounted with that src', () => {
    const shadow = mkShadow({ recordAudioUrl: 'blob:fake-url-123' })
    const { getByTestId } = render(<ShadowCard shadow={shadow} />)
    const audioEl = getByTestId('shadow-audio') as HTMLAudioElement
    expect(audioEl.tagName).toBe('AUDIO')
    expect(audioEl.getAttribute('src')).toBe('blob:fake-url-123')
  })

  it('no recordAudioUrl → no <audio> element rendered', () => {
    const shadow = mkShadow({ recordAudioUrl: null })
    const { queryByTestId } = render(<ShadowCard shadow={shadow} />)
    expect(queryByTestId('shadow-audio')).toBeNull()
  })

  it('Close button calls deactivate', () => {
    const shadow = mkShadow()
    const { getByTestId } = render(<ShadowCard shadow={shadow} />)
    fireEvent.click(getByTestId('shadow-close'))
    expect(shadow.deactivate).toHaveBeenCalledTimes(1)
  })

  it('locale en: record/stop/hint/error strings switch to English', () => {
    setLocale('en')
    const idle = mkShadow({ referenceText: '' })
    const r1 = render(<ShadowCard shadow={idle} />)
    expect(r1.getByText('Hover a cue and press record')).toBeTruthy()
    expect(r1.getByTestId('shadow-record').textContent).toBe('Record')
    r1.unmount()

    const errShadow = mkShadow({ phase: 'error', errorCode: 'gateway' })
    const r2 = render(<ShadowCard shadow={errShadow} />)
    expect(r2.getByTestId('shadow-error').textContent).toBe('Recognition error, try again')
    r2.unmount()
  })

  // ── Review-acceptance #1 fix pass (findings F1-F4, manifest-checklist.md) ──

  it('F1: target reply text uses 17px + caption-font (ru default, en on locale switch)', () => {
    const shadow = mkShadow()
    const r1 = render(<ShadowCard shadow={shadow} />)
    const target = r1.getByText('hello world')
    expect(target.style.fontSize).toBe('17px')
    expect(target.style.fontFamily).toContain('--caption-font-ru')
    r1.unmount()

    setLocale('en')
    const r2 = render(<ShadowCard shadow={shadow} />)
    expect(r2.getByText('hello world').style.fontFamily).toContain('--caption-font-en')
    r2.unmount()
  })

  it('F2: dashed answer block shows the waiting placeholder before any attempt exists', () => {
    const shadow = mkShadow()
    const { getByTestId } = render(<ShadowCard shadow={shadow} />)
    expect(getByTestId('shadow-partial').textContent).toContain('Жду Ваш ответ…')
  })

  it('F2: dashed answer block shows the last spoken text (plain, not diff) once a result exists', () => {
    const shadow = mkShadow({ phase: 'result', lastMarks: [{ w: 'hi', kind: 'ok' }], lastMatchPct: 100, lastSpoken: 'hi there' })
    const { getByTestId } = render(<ShadowCard shadow={shadow} />)
    expect(getByTestId('shadow-partial').textContent).toContain('hi there')
  })

  it('F2: dashed answer block reverts to the placeholder while a NEW recording is in flight (no live partial in V1)', () => {
    const shadow = mkShadow({ phase: 'recording', lastMarks: [{ w: 'hi', kind: 'ok' }], lastMatchPct: 100, lastSpoken: 'hi there' })
    const { getByTestId } = render(<ShadowCard shadow={shadow} />)
    expect(getByTestId('shadow-partial').textContent).toContain('Жду Ваш ответ…')
    expect(getByTestId('shadow-partial').textContent).not.toContain('hi there')
  })

  // ── Срез D: живой partial из RealtimeAnswerSource → dashed answer block ──

  it('D: partialText prop renders the live partial in the dashed answer block', () => {
    const shadow = mkShadow({ phase: 'recording' })
    const { getByTestId } = render(<ShadowCard shadow={shadow} partialText="the quick brown" />)
    expect(getByTestId('shadow-partial').textContent).toContain('the quick brown')
    expect(getByTestId('shadow-partial').textContent).not.toContain('Жду Ваш ответ…')
  })

  it('D: a live partialText wins over lastSpoken (streaming beats the previous answer)', () => {
    const shadow = mkShadow({ phase: 'recording', lastSpoken: 'old answer' })
    const { getByTestId } = render(<ShadowCard shadow={shadow} partialText="new live words" />)
    expect(getByTestId('shadow-partial').textContent).toContain('new live words')
    expect(getByTestId('shadow-partial').textContent).not.toContain('old answer')
  })

  it('D: Fake-mode / no partial (undefined or empty) → placeholder as before', () => {
    const shadow = mkShadow({ phase: 'recording' })
    const r1 = render(<ShadowCard shadow={shadow} />)
    expect(r1.getByTestId('shadow-partial').textContent).toContain('Жду Ваш ответ…')
    r1.unmount()
    const r2 = render(<ShadowCard shadow={shadow} partialText="" />)
    expect(r2.getByTestId('shadow-partial').textContent).toContain('Жду Ваш ответ…')
    r2.unmount()
  })

  it('F3: attempts feed with no attempts yet shows the grey italic empty state, no border', () => {
    const shadow = mkShadow()
    const { getByText } = render(<ShadowCard shadow={shadow} />)
    const empty = getByText('Жду Ваш ответ…', { selector: 'div' })
    expect(empty.style.fontStyle).toBe('italic')
    expect(empty.style.border).toBe('')
  })

  it('ТЗ №3 п.3: history attempts render as compact one-liners (повтор N · % · услышано), newest first, non-clickable', () => {
    const shadow = mkShadow({
      cueIndex: 2,
      // ТЗ №3 п.3 — text now carried through PanelAttempts → "услышано: {text}".
      shadowAttempts: { '2': { attempts: [
        { match_pct: 60, text: 'first try' },
        { match_pct: 75, text: 'second try' },
        { match_pct: 90, text: 'third try' },
      ] } },
    })
    const { getAllByTestId } = render(<ShadowCard shadow={shadow} />)
    const rows = getAllByTestId('shadow-history-row')
    expect(rows).toHaveLength(3)
    // Newest (loop 3, 90%) first.
    expect(rows[0].textContent).toContain('повтор 3')
    expect(rows[0].textContent).toContain('90%')
    expect(rows[0].textContent).toContain('услышано')
    expect(rows[0].textContent).toContain('third try')
    expect(rows[2].textContent).toContain('повтор 1')
    // Non-clickable (parity compromise — no per-attempt audio on web).
    expect(rows[0].onclick).toBeNull()
  })

  it('ТЗ №3 п.3: latest attempt (B1 block) IS clickable when it has a joined recording', () => {
    const recA = mkRecording({ id: 'rec-a', cue_index: 2, audio_start_sec: 0 })
    const shadow = mkShadow({
      cueIndex: 2,
      lastMarks: [{ w: 'hi', kind: 'ok' }],
      lastMatchPct: 100,
      lastSpoken: 'hi',
      recordings: [recA],
    })
    const { getByTestId } = render(<ShadowCard shadow={shadow} />)
    fireEvent.click(getByTestId('shadow-diff'))
    expect(shadow.selectRecording).toHaveBeenCalledWith('rec-a')
  })

  it('ТЗ №3 п.3: selected latest attempt (youTrackRecordingId match) gets the inset accent highlight', () => {
    const recA = mkRecording({ id: 'rec-a', cue_index: 0, audio_start_sec: 0 })
    const shadow = mkShadow({
      cueIndex: 0,
      lastMarks: [{ w: 'hi', kind: 'ok' }],
      lastMatchPct: 90,
      lastSpoken: 'hi',
      recordings: [recA],
    })
    const { getByTestId } = render(<><SelectSetter id="rec-a" /><ShadowCard shadow={shadow} /></>)
    expect((getByTestId('shadow-diff') as HTMLElement).style.boxShadow).toContain('inset 3px 0 0 var(--accent')
  })

  it('F4: shadowPulse and shadowStatusWait keyframes are present in an injected <style> tag', () => {
    const shadow = mkShadow()
    render(<ShadowCard shadow={shadow} />)
    const css = Array.from(document.querySelectorAll('style')).map(s => s.textContent).join('\n')
    expect(css).toContain('@keyframes shadowPulse')
    expect(css).toContain('@keyframes shadowStatusWait')
  })

  it('F4: rec-strip dot animates shadowPulse while recording (dashed-block bullet always pulses)', () => {
    const shadow = mkShadow({ phase: 'recording', remainingSec: 30 })
    const { container } = render(<ShadowCard shadow={shadow} />)
    // Rec dot is 7x7 (dashed-block bullet is 6x6) — disambiguate by width.
    const dot = container.querySelector('span[style*="width: 7px"]') as HTMLElement
    expect(dot.style.animation).toContain('shadowPulse 1.4s')
    const bullet = container.querySelector('span[style*="width: 6px"]') as HTMLElement
    expect(bullet.style.animation).toContain('shadowPulse 1s')
  })

  // ── Ф1 accept-feedback #8 fix pass (audit/18-live-feedback-shadowing-full.md §Ф1) ──

  it('Ф1 bug #1: the card caps its height (column flex) instead of growing unbounded — 6 attempts render without stretching the card; re-review Ф1 #1: cap is now min(78vh, calc(100vh - 240px)) so a short/low viewport cannot push the card off the top', () => {
    const attempts6 = Array.from({ length: 6 }, (_, i) => ({ match_pct: 50 + i }))
    const shadow = mkShadow({ cueIndex: 0, shadowAttempts: { '0': { attempts: attempts6 } } })
    const { getByTestId, getAllByText } = render(<ShadowCard shadow={shadow} />)

    const card = getByTestId('shadow-card')
    // Re-review Ф1 #1 (HIGH): a flat '78vh' overflows the TOP of the viewport
    // on short windows because this card anchors via `bottom: 220` — the cap
    // must ALSO bound the height by the anchor distance (100vh - 240px, where
    // 240 = the 220px bottom anchor + 20px margin), taking whichever is
    // smaller. If someone reverts to a flat '78vh' this assertion catches it.
    expect(card.style.maxHeight).toBe('min(78vh, calc(100vh - 240px))')
    expect(card.style.bottom).toBe('220px') // the anchor the 240px constant is derived from
    expect(card.style.display).toBe('flex')
    expect(card.style.flexDirection).toBe('column')

    // All 6 attempts actually render — the fix must make the FEED scroll
    // internally, not hide entries or grow the card past its cap.
    expect(getAllByText(/повтор \d/)).toHaveLength(6)
  })

  // NOTE (re-review Ф1 #3b — honesty rename): this is a STYLE-PIN test, not a
  // behavioural one. jsdom does not run real layout/paint, so it cannot observe
  // actual scrolling (scrollHeight/clientHeight overflow, wheel events, etc.) —
  // it only asserts that the inline/computed CSS properties an internal-scroll
  // layout REQUIRES (flex:1, min-height:0, overflow-y:auto on the feed; the
  // card's own maxHeight cap that makes those properties meaningful) are the
  // ones actually applied. A real "does it scroll" check needs a browser
  // (Playwright) or a jsdom-layout shim; that isn't done here — see the
  // scratchpad/shadow/f1-report.md screenshot for the manual low-viewport check.
  it('STYLE-PIN (ТЗ №3 п.2): the feed carries flex:1/min-height:0/overflow-y:HIDDEN (zero-scroll — the "+K ранних" collapse replaces scrolling), the outer card clips + is height-capped', () => {
    const attempts6 = Array.from({ length: 6 }, (_, i) => ({ match_pct: 50 + i }))
    const shadow = mkShadow({ cueIndex: 0, shadowAttempts: { '0': { attempts: attempts6 } } })
    const { getByTestId } = render(<ShadowCard shadow={shadow} />)

    const card = getByTestId('shadow-card')
    expect(card.style.overflow).toBe('hidden') // the OUTER card clips, doesn't scroll
    expect(card.style.maxHeight).toBe('min(78vh, calc(100vh - 240px))') // ties this test to fix #1's bound

    const feedEl = getByTestId('shadow-feed')
    const cs = getComputedStyle(feedEl)
    // ТЗ №3 п.2 — no scrollbar: overflow is HIDDEN (was 'auto'); the N/"+K"
    // computation, not scrolling, keeps content bounded.
    expect(cs.overflowY).toBe('hidden')
    expect(cs.minHeight).toBe('0')
    expect(cs.flexGrow).toBe('1')
  })

  it('Ф1 bug #3: recordAudioUrl stays stable across two consecutive .play() calls and an unrelated re-render (own recording keeps being replayable, same DOM node, same src)', async () => {
    const originalPlay = window.HTMLMediaElement.prototype.play
    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
    try {
      const shadow = mkShadow({
        phase: 'result', recordAudioUrl: 'blob:fake-url-123',
        lastMarks: [{ w: 'hi', kind: 'ok' }], lastMatchPct: 100, lastSpoken: 'hi',
      })
      const { getByTestId, rerender } = render(<ShadowCard shadow={shadow} />)
      const audioEl = getByTestId('shadow-audio') as HTMLAudioElement

      await audioEl.play()
      expect(audioEl.getAttribute('src')).toBe('blob:fake-url-123')

      // Second play right after the first — this is the reported bug: replay
      // must keep working, not silently drop/change the source.
      await audioEl.play()
      expect(audioEl.getAttribute('src')).toBe('blob:fake-url-123')

      // An unrelated parent re-render (e.g. a sibling state tick) must reuse
      // the SAME DOM node and leave src untouched — no remount churn.
      rerender(<ShadowCard shadow={{ ...shadow }} />)
      expect(getByTestId('shadow-audio')).toBe(audioEl)
      expect(getByTestId('shadow-audio').getAttribute('src')).toBe('blob:fake-url-123')
    } finally {
      window.HTMLMediaElement.prototype.play = originalPlay
    }
  })

  it('Ф1 bug 4: idle rec-strip packs the dot + Record button tightly (no auto-margin gap) instead of stretching them apart', () => {
    const shadow = mkShadow() // phase idle
    const { getByTestId } = render(<ShadowCard shadow={shadow} />)
    const recordBtn = getByTestId('shadow-record') as HTMLButtonElement
    expect(recordBtn.style.marginLeft).not.toBe('auto')
  })

  // ── T5 (D1) — right-click customText context menu ──────────────────────────
  describe('T5: right-click customText context menu (D1)', () => {
    it('right-click on the card opens the menu with "Задать значение текста" — ALWAYS visible, even with an active subtitle/referenceText', () => {
      const shadow = mkShadow({ referenceText: 'hello world' }) // subtitle present
      const { getByTestId, queryByTestId } = render(<ShadowCard shadow={shadow} />)
      expect(queryByTestId('shadow-context-menu')).toBeNull() // closed by default
      fireEvent.contextMenu(getByTestId('shadow-card'))
      expect(getByTestId('shadow-context-menu')).toBeTruthy()
      expect(getByTestId('shadow-menu-set-customtext').textContent).toBe('Задать значение текста')
      expect(getByTestId('shadow-menu-clear-customtext')).toBeTruthy()
    })

    it('menu item is visible with NO subtitle too (referenceText empty) — the entry point is never gated on subtitle presence', () => {
      const shadow = mkShadow({ referenceText: '' })
      const { getByTestId } = render(<ShadowCard shadow={shadow} />)
      fireEvent.contextMenu(getByTestId('shadow-card'))
      expect(getByTestId('shadow-menu-set-customtext')).toBeTruthy()
    })

    it('clicking "Задать значение текста" opens an inline editor (textarea + Save), NOT a permanent frame; Save commits via onSetCustomText', () => {
      const onSetCustomText = vi.fn()
      const shadow = mkShadow()
      const { getByTestId, queryByTestId } = render(
        <ShadowCard shadow={shadow} onSetCustomText={onSetCustomText} />,
      )
      fireEvent.contextMenu(getByTestId('shadow-card'))
      expect(queryByTestId('shadow-customtext-input')).toBeNull() // not shown until requested
      fireEvent.click(getByTestId('shadow-menu-set-customtext'))
      const input = getByTestId('shadow-customtext-input') as HTMLTextAreaElement
      fireEvent.change(input, { target: { value: 'my custom line' } })
      fireEvent.click(getByTestId('shadow-customtext-save'))
      expect(onSetCustomText).toHaveBeenCalledWith('my custom line')
      expect(queryByTestId('shadow-context-menu')).toBeNull() // menu closes after commit
    })

    it('Save with an empty/whitespace-only draft commits null (same as Clear)', () => {
      const onSetCustomText = vi.fn()
      const shadow = mkShadow()
      const { getByTestId } = render(<ShadowCard shadow={shadow} onSetCustomText={onSetCustomText} />)
      fireEvent.contextMenu(getByTestId('shadow-card'))
      fireEvent.click(getByTestId('shadow-menu-set-customtext'))
      const input = getByTestId('shadow-customtext-input') as HTMLTextAreaElement
      fireEvent.change(input, { target: { value: '   ' } })
      fireEvent.click(getByTestId('shadow-customtext-save'))
      expect(onSetCustomText).toHaveBeenCalledWith(null)
    })

    it('the editor seeds from the current customText prop (re-opening shows the existing value)', () => {
      const shadow = mkShadow()
      const { getByTestId } = render(<ShadowCard shadow={shadow} customText="existing text" />)
      fireEvent.contextMenu(getByTestId('shadow-card'))
      fireEvent.click(getByTestId('shadow-menu-set-customtext'))
      const input = getByTestId('shadow-customtext-input') as HTMLTextAreaElement
      expect(input.value).toBe('existing text')
    })

    it('clicking "Очистить текст" (clear item) commits null directly, without opening the editor', () => {
      const onSetCustomText = vi.fn()
      const shadow = mkShadow()
      const { getByTestId, queryByTestId } = render(
        <ShadowCard shadow={shadow} customText="existing text" onSetCustomText={onSetCustomText} />,
      )
      fireEvent.contextMenu(getByTestId('shadow-card'))
      fireEvent.click(getByTestId('shadow-menu-clear-customtext'))
      expect(onSetCustomText).toHaveBeenCalledWith(null)
      expect(queryByTestId('shadow-context-menu')).toBeNull()
      expect(queryByTestId('shadow-customtext-input')).toBeNull()
    })

    it('clicking the backdrop closes the menu without calling onSetCustomText', () => {
      const onSetCustomText = vi.fn()
      const shadow = mkShadow()
      const { getByTestId, queryByTestId } = render(
        <ShadowCard shadow={shadow} onSetCustomText={onSetCustomText} />,
      )
      fireEvent.contextMenu(getByTestId('shadow-card'))
      fireEvent.click(getByTestId('shadow-context-menu-backdrop'))
      expect(queryByTestId('shadow-context-menu')).toBeNull()
      expect(onSetCustomText).not.toHaveBeenCalled()
    })

    it('menu works with NO onSetCustomText wired (Save/Clear no-op instead of throwing) — production wiring is a later task', () => {
      const shadow = mkShadow()
      const { getByTestId } = render(<ShadowCard shadow={shadow} />)
      fireEvent.contextMenu(getByTestId('shadow-card'))
      expect(() => fireEvent.click(getByTestId('shadow-menu-clear-customtext'))).not.toThrow()
    })

    it('RTL (en locale): menu item labels switch to English', () => {
      setLocale('en')
      const shadow = mkShadow()
      const { getByTestId } = render(<ShadowCard shadow={shadow} />)
      fireEvent.contextMenu(getByTestId('shadow-card'))
      expect(getByTestId('shadow-menu-set-customtext').textContent).toBe('Set custom text')
      expect(getByTestId('shadow-menu-clear-customtext').textContent).toBe('Clear text')
      fireEvent.click(getByTestId('shadow-menu-set-customtext'))
      expect((getByTestId('shadow-customtext-input') as HTMLTextAreaElement).placeholder).toBe('Enter text to practice…')
      expect(getByTestId('shadow-customtext-save').textContent).toBe('Save')
    })
  })

  // ── Срез A (п.5): hands-free rec-strip ──────────────────────────────────────
  describe('Срез A: hands-free rec-strip (handsFree prop)', () => {
    it('handsFree + idle: НЕТ кнопки «Записать»; единственная кнопка rec-strip — «Стоп» → shadow.deactivate()', () => {
      const shadow = mkShadow({ phase: 'idle' })
      const { getByTestId, queryByTestId } = render(<ShadowCard shadow={shadow} handsFree />)
      expect(queryByTestId('shadow-record')).toBeNull()
      const stop = getByTestId('shadow-stop')
      expect(stop.textContent).toContain('Стоп')
      fireEvent.click(stop)
      expect(shadow.deactivate).toHaveBeenCalledTimes(1)
      expect(shadow.stopRecording).not.toHaveBeenCalled() // Стоп ≠ stopRecording в hands-free
    })

    it('handsFree + recording: «Записать» по-прежнему нет; «Стоп» → deactivate; таймер/бейдж «Говорите»/осциллограф видны', () => {
      const analyser = { frequencyBinCount: 4, getByteFrequencyData: (a: Uint8Array) => a.fill(10) } as unknown as AnalyserNode
      const shadow = mkShadow({ phase: 'recording', remainingSec: 5, analyserNode: analyser })
      const { getByTestId, getByText, queryByTestId, container } = render(<ShadowCard shadow={shadow} handsFree />)
      expect(queryByTestId('shadow-record')).toBeNull()
      expect(getByText('Говорите')).toBeTruthy()
      expect(getByText('0:05')).toBeTruthy() // M:SS elapsed
      expect(container.querySelector('canvas')).toBeTruthy() // осциллограф
      fireEvent.click(getByTestId('shadow-stop'))
      expect(shadow.deactivate).toHaveBeenCalledTimes(1)
    })

    it('handsFree=false (по умолчанию, standalone V1): прежнее поведение — idle показывает «Записать»', () => {
      const shadow = mkShadow({ phase: 'idle' })
      const { getByTestId, queryByTestId } = render(<ShadowCard shadow={shadow} />)
      expect(getByTestId('shadow-record')).toBeTruthy()
      expect(queryByTestId('shadow-stop')).toBeNull()
    })
  })

  // ── Срез B — settingsRow (mode/loop/АВТОПЕРЕХОД) + custom-режим targetPanel ──
  describe('Срез B — settings (row moved to the bar, ТЗ №3 п.4)', () => {
    const baseSettings = { advanceEnabled: true, advanceThreshold: 80, mode: 'subtitle' as const, loopMode: true }

    // ТЗ №3 п.4: the settings ROW (mode/loop/АВТОПЕРЕХОД + slider) no longer
    // renders inside the card — it moved to the workspace bar (its interaction
    // contract now lives in ShadowSettingsRow.test.tsx). The card must NOT
    // render the row even WHEN `settings` is supplied; `settings` only gates the
    // custom-mode targetPanel (tests below).
    it('ТЗ №3: карта НЕ рендерит shadow-settings-row даже с пропом settings (ушёл в бар)', () => {
      const shadow = mkShadow()
      const { queryByTestId } = render(<ShadowCard shadow={shadow} settings={baseSettings} />)
      expect(queryByTestId('shadow-settings-row')).toBeNull()
      expect(queryByTestId('shadow-advance-slider')).toBeNull()
      expect(queryByTestId('shadow-mode-toggle')).toBeNull()
      expect(queryByTestId('shadow-loop-toggle')).toBeNull()
    })

    it('mode=custom: targetPanel показывает textarea (значение customText) + «Вставить из субтитра», НЕ referenceText-строку', () => {
      const shadow = mkShadow({ referenceText: 'the subtitle text' })
      const onSetCustomText = vi.fn()
      const { getByTestId, queryByText } = render(
        <ShadowCard
          shadow={shadow}
          settings={{ ...baseSettings, mode: 'custom' }}
          customText={'my phrase'}
          onSetCustomText={onSetCustomText}
        />
      )
      const ta = getByTestId('shadow-custom-textarea') as HTMLTextAreaElement
      expect(ta.value).toBe('my phrase')
      // subtitle-строка НЕ рендерится в custom-режиме
      expect(queryByText('the subtitle text')).toBeNull()
      // печать → onSetCustomText(текст)
      fireEvent.change(ta, { target: { value: 'edited' } })
      expect(onSetCustomText).toHaveBeenCalledWith('edited')
      // «Вставить из текущего субтитра» → onSetCustomText(referenceText)
      fireEvent.click(getByTestId('shadow-custom-from-sub'))
      expect(onSetCustomText).toHaveBeenCalledWith('the subtitle text')
    })

    it('HIGH-2: textarea пишет через onCustomTextInput (приоритет над onSetCustomText), меню Clear — через onSetCustomText', () => {
      const shadow = mkShadow({ referenceText: 'the subtitle text' })
      const onCustomTextInput = vi.fn()
      const onSetCustomText = vi.fn()
      const { getByTestId } = render(
        <ShadowCard
          shadow={shadow}
          settings={{ ...baseSettings, mode: 'custom' }}
          customText={'phrase'}
          onCustomTextInput={onCustomTextInput}
          onSetCustomText={onSetCustomText}
        />
      )
      // Печать (в т.ч. очистка) идёт в onCustomTextInput (БЕЗ мод-флипа), НЕ в
      // onSetCustomText (тот флипает mode→subtitle на пустой строке).
      fireEvent.change(getByTestId('shadow-custom-textarea'), { target: { value: '' } })
      expect(onCustomTextInput).toHaveBeenCalledWith('')
      expect(onSetCustomText).not.toHaveBeenCalled()
      // Меню Clear по-прежнему через onSetCustomText (легит subtitle-флип).
      fireEvent.contextMenu(getByTestId('shadow-card'))
      fireEvent.click(getByTestId('shadow-menu-clear-customtext'))
      expect(onSetCustomText).toHaveBeenCalledWith(null)
    })

    it('mode=subtitle: targetPanel показывает referenceText, textarea отсутствует', () => {
      const shadow = mkShadow({ referenceText: 'the subtitle text' })
      const { getByText, queryByTestId } = render(
        <ShadowCard shadow={shadow} settings={baseSettings} />
      )
      expect(getByText('the subtitle text')).toBeTruthy()
      expect(queryByTestId('shadow-custom-textarea')).toBeNull()
    })
  })

  // ── ТЗ №2 [ID:P-hotfix-quota-ux] — баннер недоступности источника ────────────
  describe('unavailableNotice баннер (quota_exhausted / unavailable)', () => {
    it('reason quota_exhausted без resetsAt: показывает ru-текст лимита, без строки даты', () => {
      const shadow = mkShadow()
      const { getByTestId, queryByTestId } = render(
        <ShadowCard shadow={shadow} unavailableNotice={{ reason: 'quota_exhausted' }} />
      )
      const banner = getByTestId('shadow-unavailable')
      expect(banner.textContent).toContain('Лимит работы с Shadowing в этом месяце достиг предела')
      expect(banner.textContent).toContain('приобретите дополнительные квоты')
      expect(queryByTestId('shadow-unavailable-reset')).toBeNull()
    })

    it('reason quota_exhausted с валидным resetsAt: добавляет «Лимит обновится {дата}»', () => {
      const shadow = mkShadow()
      const { getByTestId } = render(
        <ShadowCard shadow={shadow} unavailableNotice={{ reason: 'quota_exhausted', resetsAt: '2026-08-01T00:00:00Z' }} />
      )
      const reset = getByTestId('shadow-unavailable-reset')
      expect(reset.textContent).toContain('Лимит обновится')
      // дата форматируется по ru-локали (месяц словом) — 2026 присутствует
      expect(reset.textContent).toContain('2026')
    })

    it('невалидный resetsAt: баннер есть, но строки даты нет (NaN-гард)', () => {
      const shadow = mkShadow()
      const { getByTestId, queryByTestId } = render(
        <ShadowCard shadow={shadow} unavailableNotice={{ reason: 'quota_exhausted', resetsAt: 'not-a-date' }} />
      )
      expect(getByTestId('shadow-unavailable')).toBeTruthy()
      expect(queryByTestId('shadow-unavailable-reset')).toBeNull()
    })

    it('reason unavailable: показывает ru-текст временной недоступности, без даты', () => {
      const shadow = mkShadow()
      const { getByTestId, queryByTestId } = render(
        <ShadowCard shadow={shadow} unavailableNotice={{ reason: 'unavailable', resetsAt: '2026-08-01T00:00:00Z' }} />
      )
      const banner = getByTestId('shadow-unavailable')
      expect(banner.textContent).toContain('Сервис распознавания речи временно недоступен')
      expect(queryByTestId('shadow-unavailable-reset')).toBeNull()
    })

    it('en-локаль: quota-баннер и строка даты на английском', () => {
      setLocale('en')
      const shadow = mkShadow()
      const { getByTestId } = render(
        <ShadowCard shadow={shadow} unavailableNotice={{ reason: 'quota_exhausted', resetsAt: '2026-08-01T00:00:00Z' }} />
      )
      expect(getByTestId('shadow-unavailable').textContent).toContain("this month's Shadowing usage limit")
      expect(getByTestId('shadow-unavailable-reset').textContent).toContain('Limit resets')
    })

    it('без unavailableNotice: баннер не рендерится (дефолт — обратная совместимость)', () => {
      const shadow = mkShadow()
      const { queryByTestId } = render(<ShadowCard shadow={shadow} />)
      expect(queryByTestId('shadow-unavailable')).toBeNull()
    })
  })
})
