// videoChat.integration.test.tsx — T1a end-to-end wiring, the same
// composition PlayerPage.tsx uses (SubtitleOverlay onWordClick → WordPopup →
// useVideoChat.requestExamples → VideoChatPanel), without mounting the whole
// (1400+ line) PlayerPage. Covers the acceptance list from the task:
// click a word → popup with 2 buttons; clicking "Примеры YouTube" fetches
// /api/examples?kind=youtube&word=...; a youtube item renders an i.ytimg.com
// card linking to /player?v=; 503 → "примеры скоро"; a film item renders
// text_en+timing and its "play" click doesn't throw.
import { useState } from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SubtitleOverlay } from '../components/SubtitleOverlay'
import { WordPopup, type WordPopupPosition } from '../components/WordPopup'
import { VideoChatPanel } from '../components/VideoChatPanel'
import { useVideoChat } from '../hooks/useVideoChat'
import type { Cue } from '../hooks/useSubtitles'
import type { ExamplesKind } from '../examples-api'

const cues: Cue[] = [{ start: 0, end: 2, text_en: 'I have controlled everything', text_ru: '' }]

// Harness — mirrors how PlayerPage.tsx wires the three pieces together
// (word-popup state lives next to the panel's own hook, same shape as the
// real integration described in the task).
function Harness() {
  const [popup, setPopup] = useState<{ word: string; position: WordPopupPosition } | null>(null)
  const videoChat = useVideoChat()
  return (
    <div>
      <SubtitleOverlay
        cues={cues}
        activeIndex={0}
        mode="l2"
        onWordClick={(word, rect) => setPopup({ word, position: { x: rect.left, y: rect.bottom } })}
      />
      {popup && (
        <WordPopup
          word={popup.word}
          position={popup.position}
          onExamples={(kind: ExamplesKind) => { videoChat.requestExamples(popup.word, kind); setPopup(null) }}
          onClose={() => setPopup(null)}
        />
      )}
      <VideoChatPanel
        open={videoChat.state.open}
        word={videoChat.state.word}
        status={videoChat.state.status}
        items={videoChat.state.items}
        errorMessage={videoChat.state.errorMessage}
        onClose={videoChat.close}
      />
    </div>
  )
}

function jsonResponse(status: number, body?: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

// clickWord — finds the [data-word] span whose (trimmed) text matches and
// clicks it. More robust than screen.getByText here: the span's own text
// node carries a trailing literal space ("controlled" + ' '), and using the
// same data-word contract the Yomitan extension scans keeps this test tied
// to the real DOM shape SubtitleOverlay renders, not to whitespace quirks.
function clickWord(container: HTMLElement, word: string) {
  const spans = Array.from(container.querySelectorAll('[data-word]'))
  const span = spans.find(el => el.textContent?.trim() === word)
  if (!span) throw new Error(`no [data-word] span with text ${JSON.stringify(word)} found`)
  fireEvent.click(span)
}

describe('T1a video-chat-examples integration', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('clicking a subtitle word opens a popup with the word and 2 example buttons', () => {
    const { container } = render(<Harness />)
    clickWord(container, 'controlled')
    expect(screen.getByTestId('word-popup-word').textContent).toBe('controlled')
    expect(screen.getByRole('button', { name: 'Примеры YouTube' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Учебные примеры из фильмов' })).toBeTruthy()
  })

  it('clicking "Примеры YouTube" fetches /api/examples?word=controlled&kind=youtube and renders a youtube card', async () => {
    const youtubeItem = {
      source: 'youtube', ref: 'BX_QNmuSNp8',
      start_ms: null, end_ms: null, text_en: null, text_ru: null, thumbnail_url: null,
    }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { word: 'controlled', items: [youtubeItem] }))
    vi.stubGlobal('fetch', fetchMock)
    const { container } = render(<Harness />)

    clickWord(container, 'controlled')
    fireEvent.click(screen.getByRole('button', { name: 'Примеры YouTube' }))

    expect(fetchMock).toHaveBeenCalledWith('/api/examples?word=controlled&kind=youtube')

    await waitFor(() => expect(screen.getByTestId('vcp-card-youtube')).toBeTruthy())
    const card = screen.getByTestId('vcp-card-youtube') as HTMLAnchorElement
    expect(card.getAttribute('href')).toBe('/player?v=BX_QNmuSNp8')
    const img = card.querySelector('img') as HTMLImageElement
    expect(img.src).toContain('i.ytimg.com/vi/BX_QNmuSNp8/mqdefault.jpg')
  })

  it('503 from the gateway (ручки ещё нет) renders "примеры скоро", not an error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(503)))
    const { container } = render(<Harness />)

    clickWord(container, 'controlled')
    fireEvent.click(screen.getByRole('button', { name: 'Учебные примеры из фильмов' }))

    await waitFor(() => expect(screen.getByTestId('vcp-not-ready')).toBeTruthy())
    expect(screen.getByTestId('vcp-not-ready').textContent).toBe('Примеры скоро')
    expect(screen.queryByTestId('vcp-error')).toBeNull()
  })

  it('a film item renders text_en + mm:ss timing, and clicking its card ("play") does not throw (T1b stub)', async () => {
    const filmItem = {
      source: 'film', ref: '10-cloverfield-lane-2016/scene-42',
      start_ms: 512340, end_ms: 517880, text_en: 'I had control over nothing.', text_ru: null, thumbnail_url: null,
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { word: 'controlled', items: [filmItem] })))
    const { container } = render(<Harness />)

    clickWord(container, 'controlled')
    fireEvent.click(screen.getByRole('button', { name: 'Учебные примеры из фильмов' }))

    await waitFor(() => expect(screen.getByTestId('vcp-card-film')).toBeTruthy())
    const card = screen.getByTestId('vcp-card-film')
    expect(card.textContent).toContain('I had control over nothing.')
    expect(card.textContent).toContain('8:32')
    expect(() => fireEvent.click(card)).not.toThrow()
  })
})
