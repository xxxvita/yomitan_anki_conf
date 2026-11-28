// SubtitleOverlay.suppressed.test.tsx — A7: plate hides while inside a mute region.
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { SubtitleOverlay } from '../components/SubtitleOverlay'
import { SubtitleL1Overlay } from '../components/SubtitleL1Overlay'
import type { Cue } from '../hooks/useSubtitles'

const cues: Cue[] = [
  { start: 0, end: 2, text_en: 'Hello', text_ru: 'Привет' },
]

describe('SubtitleOverlay (L2) — suppressed', () => {
  it('suppressed=true with an active cue renders nothing', () => {
    const { container } = render(<SubtitleOverlay cues={cues} activeIndex={0} mode="l2l1" suppressed />)
    expect(container.firstChild).toBeNull()
  })

  it('suppressed=false (default) with an active cue renders the plate', () => {
    const { container } = render(<SubtitleOverlay cues={cues} activeIndex={0} mode="l2l1" />)
    expect(container.textContent).toContain('Hello')
  })
})

describe('SubtitleL1Overlay (L1) — suppressed', () => {
  it('suppressed=true with an active cue renders nothing', () => {
    const { container } = render(<SubtitleL1Overlay cues={cues} activeIndex={0} mode="l2l1" suppressed />)
    expect(container.firstChild).toBeNull()
  })

  it('suppressed=false (default) with an active cue renders the plate', () => {
    const { container } = render(<SubtitleL1Overlay cues={cues} activeIndex={0} mode="l2l1" />)
    expect(container.textContent).toContain('Привет')
  })
})
