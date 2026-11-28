// VideoChatPanel.test.tsx — T1a «Чат: Видео» карточки (docs/contract-2026-
// 07-15-examples-by-word.md): youtube-карточка рабочая (i.ytimg.com превью +
// /player?v= ссылка), film-карточка — заглушка до T1b (text_en+тайминг,
// play не падает, зовёт onFilmPlay вместо реального стрима).
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { VideoChatPanel } from '../VideoChatPanel'
import type { ExampleItem } from '../../examples-api'

const youtubeItem: ExampleItem = {
  source: 'youtube', ref: 'BX_QNmuSNp8',
  start_ms: null, end_ms: null, text_en: null, text_ru: null, thumbnail_url: null,
}

const filmItem: ExampleItem = {
  source: 'film', ref: '10-cloverfield-lane-2016/scene-42',
  start_ms: 512340, end_ms: 517880, text_en: 'I had control over nothing.', text_ru: null, thumbnail_url: null,
}

describe('VideoChatPanel', () => {
  it('idle status shows a hint, no cards', () => {
    render(<VideoChatPanel open word={null} status="idle" items={[]} errorMessage={null} onClose={vi.fn()} />)
    expect(screen.getByTestId('vcp-idle')).toBeTruthy()
    expect(screen.queryByTestId('vcp-cards')).toBeNull()
  })

  it('loading status shows a spinner', () => {
    render(<VideoChatPanel open word="controlled" status="loading" items={[]} errorMessage={null} onClose={vi.fn()} />)
    expect(screen.getByTestId('vcp-spinner')).toBeTruthy()
    expect(screen.getByTestId('vcp-message').textContent).toContain('controlled')
  })

  it('not_ready status shows "примеры скоро", not an error', () => {
    render(<VideoChatPanel open word="controlled" status="not_ready" items={[]} errorMessage={null} onClose={vi.fn()} />)
    expect(screen.getByTestId('vcp-not-ready').textContent).toBe('Примеры скоро')
  })

  it('error status shows the error message', () => {
    render(<VideoChatPanel open word="controlled" status="error" items={[]} errorMessage="Сеть недоступна, попробуйте ещё раз" onClose={vi.fn()} />)
    expect(screen.getByTestId('vcp-error').textContent).toBe('Сеть недоступна, попробуйте ещё раз')
  })

  it('ok status with items renders one card per item, message includes the word', () => {
    render(
      <VideoChatPanel open word="controlled" status="ok" items={[youtubeItem, filmItem]} errorMessage={null} onClose={vi.fn()} />,
    )
    expect(screen.getByTestId('vcp-message').textContent).toBe('Нашёл примеры со словом «controlled»')
    // Anchored regex: /vcp-card-/ alone also matches the nested
    // "vcp-card-time" timestamp testid inside the film card — only count the
    // 2 CARD ROOTS (youtube link + film button), not their children.
    expect(screen.getAllByTestId(/^vcp-card-(youtube|film)$/).length).toBe(2)
  })

  it('ok status with zero items shows "ничего не нашлось"', () => {
    render(<VideoChatPanel open word="xyzzy" status="ok" items={[]} errorMessage={null} onClose={vi.fn()} />)
    expect(screen.getByTestId('vcp-no-results')).toBeTruthy()
  })

  it('youtube card: i.ytimg.com preview + link to /player?v=<ref>, opens in a new tab', () => {
    render(<VideoChatPanel open word="controlled" status="ok" items={[youtubeItem]} errorMessage={null} onClose={vi.fn()} />)
    const card = screen.getByTestId('vcp-card-youtube') as HTMLAnchorElement
    expect(card.getAttribute('href')).toBe('/player?v=BX_QNmuSNp8')
    expect(card.target).toBe('_blank')
    const img = card.querySelector('img') as HTMLImageElement
    expect(img.src).toContain('i.ytimg.com/vi/BX_QNmuSNp8/mqdefault.jpg')
  })

  it('film card: renders text_en and mm:ss timestamp, clicking it calls onFilmPlay WITHOUT throwing (T1b stub)', () => {
    const onFilmPlay = vi.fn()
    render(
      <VideoChatPanel open word="control" status="ok" items={[filmItem]} errorMessage={null} onClose={vi.fn()} onFilmPlay={onFilmPlay} />,
    )
    const card = screen.getByTestId('vcp-card-film')
    expect(card.textContent).toContain('I had control over nothing.')
    expect(screen.getByTestId('vcp-card-time').textContent).toBe('8:32') // 512340ms → 8m32s
    expect(() => fireEvent.click(card)).not.toThrow()
    expect(onFilmPlay).toHaveBeenCalledWith(filmItem)
  })

  it('film card without onFilmPlay still does not throw on click (defensive optional prop)', () => {
    render(<VideoChatPanel open word="control" status="ok" items={[filmItem]} errorMessage={null} onClose={vi.fn()} />)
    expect(() => fireEvent.click(screen.getByTestId('vcp-card-film'))).not.toThrow()
  })

  it('clicking the close button calls onClose', () => {
    const onClose = vi.fn()
    render(<VideoChatPanel open word={null} status="idle" items={[]} errorMessage={null} onClose={onClose} />)
    fireEvent.click(screen.getByTestId('vcp-close'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closed panel (open=false) is aria-hidden', () => {
    render(<VideoChatPanel open={false} word={null} status="idle" items={[]} errorMessage={null} onClose={vi.fn()} />)
    expect(screen.getByTestId('video-chat-panel').getAttribute('aria-hidden')).toBe('true')
  })
})
