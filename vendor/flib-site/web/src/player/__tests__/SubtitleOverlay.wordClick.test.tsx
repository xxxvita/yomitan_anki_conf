// SubtitleOverlay.wordClick.test.tsx — T1a [ID:P-video-chat]: onWordClick
// (plain click, our own handler) is disjoint from Yomitan (Shift+hover,
// untouched — see SubtitleOverlay.test.tsx "no onClick handler" test, which
// renders WITHOUT this prop and must keep passing unmodified).
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { SubtitleOverlay, cleanWord } from '../components/SubtitleOverlay'
import type { Cue } from '../hooks/useSubtitles'

const cues: Cue[] = [
  { start: 0, end: 2, text_en: "I've controlled, amazing!", text_ru: 'Я контролировал, потрясающе!' },
]

describe('SubtitleOverlay onWordClick (T1a)', () => {
  it('does not attach onWordClick when the prop is not supplied (default unchanged)', () => {
    const { container } = render(<SubtitleOverlay cues={cues} activeIndex={0} mode="l2" />)
    const span = container.querySelectorAll('[data-word]')[1] as HTMLElement // "controlled,"
    // No throw / no-op click when the handler isn't wired — same as before this feature.
    expect(() => fireEvent.click(span)).not.toThrow()
  })

  it('plain click on a word calls onWordClick with the CLEANED word (punctuation stripped) and the element rect', () => {
    const onWordClick = vi.fn()
    const { container } = render(<SubtitleOverlay cues={cues} activeIndex={0} mode="l2" onWordClick={onWordClick} />)
    const span = container.querySelectorAll('[data-word]')[1] as HTMLElement // raw text "controlled,"
    fireEvent.click(span)
    expect(onWordClick).toHaveBeenCalledTimes(1)
    const [word, rect] = onWordClick.mock.calls[0]
    expect(word).toBe('controlled')
    // jsdom's getBoundingClientRect() returns a DOMRect-shaped plain object
    // (not always `instanceof DOMRect` across jsdom versions) — assert the
    // shape PlayerPage.tsx actually reads (left/bottom, WordPopup position),
    // not the exact constructor identity.
    expect(typeof rect.left).toBe('number')
    expect(typeof rect.bottom).toBe('number')
  })

  it("keeps internal apostrophes (contractions like I've) — only strips leading/trailing punctuation", () => {
    const onWordClick = vi.fn()
    const { container } = render(<SubtitleOverlay cues={cues} activeIndex={0} mode="l2" onWordClick={onWordClick} />)
    const span = container.querySelectorAll('[data-word]')[0] as HTMLElement // "I've"
    fireEvent.click(span)
    expect(onWordClick).toHaveBeenCalledWith("I've", expect.anything())
  })

  it('a click that resolves to an empty word after cleaning (pure punctuation) does not call onWordClick', () => {
    const onWordClick = vi.fn()
    const punctuationCues: Cue[] = [{ start: 0, end: 2, text_en: 'wait -- really?', text_ru: '' }]
    const { container } = render(<SubtitleOverlay cues={punctuationCues} activeIndex={0} mode="l2" onWordClick={onWordClick} />)
    const dashSpan = container.querySelectorAll('[data-word]')[1] as HTMLElement // "--"
    fireEvent.click(dashSpan)
    expect(onWordClick).not.toHaveBeenCalled()
  })

  it('word click does NOT bubble to a React onClick on an ancestor (stopPropagation) — same containment pattern as VideoVoteBar', () => {
    const onWordClick = vi.fn()
    const outerClick = vi.fn()
    // A React (JSX) onClick on a wrapper, not a raw addEventListener on the
    // plate itself: React's e.stopPropagation() only suppresses OTHER React
    // handlers up the synthetic-event tree, not arbitrary native listeners a
    // production ancestor never actually attaches directly to this DOM node —
    // this mirrors the real containment contract (VideoVoteBar.test.tsx
    // "clicks inside the bar do not bubble to an outer onClick").
    const { container } = render(
      <div onClick={outerClick}>
        <SubtitleOverlay cues={cues} activeIndex={0} mode="l2" onWordClick={onWordClick} />
      </div>,
    )
    const span = container.querySelectorAll('[data-word]')[1] as HTMLElement
    fireEvent.click(span)
    expect(onWordClick).toHaveBeenCalledTimes(1)
    expect(outerClick).not.toHaveBeenCalled()
  })
})

describe('cleanWord', () => {
  it('strips leading/trailing punctuation, keeps internal apostrophes', () => {
    expect(cleanWord('controlled.')).toBe('controlled')
    expect(cleanWord('«amazing»')).toBe('amazing')
    expect(cleanWord("don't")).toBe("don't")
    expect(cleanWord('--')).toBe('')
    expect(cleanWord('wait—')).toBe('wait')
  })
})
