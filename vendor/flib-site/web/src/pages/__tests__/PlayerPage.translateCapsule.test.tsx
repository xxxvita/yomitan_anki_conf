// PlayerPage.translateCapsule.test.tsx — [ID:P-subtitle-translate-capsule]
// Интеграция обвязки капсулы в PlayerPage. Мокаем useSubtitles (даём cues +
// activeIndex) и translateWindow; шпионим track. Центральный анти-регресс:
// капсула показывает RU в l2 БЕЗ смены глобального режима (никакого
// subtitle_mode_change) и эмитит subtitle_line_reveal НА РЕЗОЛВЕ с result.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Мутабельный холдер cues/activeIndex — каждый тест задаёт свой набор.
const h = vi.hoisted(() => ({ cues: [] as { start: number; end: number; text_en: string; text_ru: string }[], activeIndex: 0 }))
vi.mock('../../player/hooks/useSubtitles', () => ({
  useSubtitles: () => ({ cues: h.cues, activeIndex: h.activeIndex, status: 'ready', retrying: false }),
}))

const translateWindowMock = vi.fn()
vi.mock('../../player/translate-api', async (orig) => ({
  ...(await orig<typeof import('../../player/translate-api')>()),
  translateWindow: (...a: unknown[]) => translateWindowMock(...a),
}))

const trackMock = vi.fn()
vi.mock('../../site/telemetry', async (orig) => ({
  ...(await orig<typeof import('../../site/telemetry')>()),
  track: (...a: unknown[]) => trackMock(...a),
}))

import { PlayerPage } from '../PlayerPage'

function mount() {
  return render(<MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>)
}
function capsules(c: HTMLElement) {
  return Array.from(c.querySelectorAll('button[aria-label="Перевести эту строку"]')) as HTMLButtonElement[]
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no net'))))
  window.localStorage.clear()
  window.localStorage.setItem('flib:subMode', 'l2') // старт в EN-only (сырая строка, не JSON)
  window.localStorage.setItem('flib:access', JSON.stringify({ shadowing: true, keyPrefix: 'tpk_test', checkedAt: new Date().toISOString() }))
  translateWindowMock.mockReset()
  trackMock.mockReset()
  h.cues = []
  h.activeIndex = 0
})

describe('PlayerPage — капсула перевода строки', () => {
  it('HTTP ok: RU показан в l2 БЕЗ смены режима, эмит subtitle_line_reveal result=ok mode=l2', async () => {
    h.cues = [{ start: 0, end: 2, text_en: 'Hello', text_ru: '' }] // без RU → HTTP-путь
    translateWindowMock.mockResolvedValue({ status: 'ok', source: 'local_mt', cues: [{ start: 0, end: 2, ru: 'Привет' }] })
    const { container } = mount()

    const caps = capsules(container)
    expect(caps.length).toBeGreaterThan(0) // плашка (l2, нет RU) показывает капсулу
    await act(async () => { fireEvent.click(caps[0]) })

    expect(translateWindowMock).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(container.textContent).toContain('Привет')) // RU раскрыт

    // Эмит на резолве с result=ok, mode на клике = l2, surface=plate.
    const reveal = trackMock.mock.calls.find(([e]) => e === 'subtitle_line_reveal')
    expect(reveal).toBeTruthy()
    expect(reveal![1]).toMatchObject({ result: 'ok', mode: 'l2', surface: 'plate' })
    // ЦЕНТРАЛЬНЫЙ анти-регресс: НЕ было смены глобального режима.
    expect(trackMock.mock.calls.some(([e]) => e === 'subtitle_mode_change')).toBe(false)
    // a11y: капсула размонтировалась → фокус перенесён на status-регион, НЕ на body.
    expect(document.activeElement).toBe(container.querySelector('[role="status"]'))
    expect(container.querySelector('[role="status"]')!.textContent).toContain('Привет')
  })

  it('corpus: строка с готовым text_ru в l2 → раскрытие БЕЗ HTTP, result=corpus', async () => {
    h.cues = [{ start: 0, end: 2, text_en: 'Hello', text_ru: 'Корпусный' }] // RU есть, но в l2 скрыт
    const { container } = mount()

    const caps = capsules(container)
    expect(caps.length).toBeGreaterThan(0)
    await act(async () => { fireEvent.click(caps[0]) })

    expect(translateWindowMock).not.toHaveBeenCalled() // corpus-путь HTTP не трогает
    await waitFor(() => expect(container.textContent).toContain('Корпусный'))
    const reveal = trackMock.mock.calls.find(([e]) => e === 'subtitle_line_reveal')
    expect(reveal![1]).toMatchObject({ result: 'corpus', mode: 'l2' })
    expect(trackMock.mock.calls.some(([e]) => e === 'subtitle_mode_change')).toBe(false)
  })

  it('ПИЛЮЛЯ flipMode:true — флипает режим (subtitle_mode_change) И НЕ эмитит subtitle_line_reveal', async () => {
    // Центральный обратный анти-регресс: пилюля должна СОХРАНИТЬ прежнее поведение.
    h.cues = [{ start: 0, end: 2, text_en: 'Hello', text_ru: '' }]
    translateWindowMock.mockResolvedValue({ status: 'ok', source: 'x', cues: [{ start: 0, end: 2, ru: 'Привет' }] })
    const { getByRole } = mount()
    // пилюля — кнопка с точным именем «Перевести» (капсула — «Перевести эту строку»).
    const pill = getByRole('button', { name: 'Перевести' })
    await act(async () => { fireEvent.click(pill) })

    expect(translateWindowMock).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(trackMock.mock.calls.some(([e]) => e === 'subtitle_mode_change')).toBe(true))
    // пилюля НЕ эмитит reveal-событие капсулы.
    expect(trackMock.mock.calls.some(([e]) => e === 'subtitle_line_reveal')).toBe(false)
  })

  it('null-путь: второй клик под клиентским локом → translateWindow один раз, эмит один', async () => {
    h.cues = [{ start: 0, end: 2, text_en: 'Hello', text_ru: '' }]
    // висящий промис — лок держится между двумя синхронными кликами.
    let resolveFn: (v: unknown) => void = () => {}
    translateWindowMock.mockReturnValue(new Promise((r) => { resolveFn = r }))
    const { container } = mount()
    const cap = capsules(container)[0]
    await act(async () => {
      fireEvent.click(cap) // ставит лок, промис висит
      fireEvent.click(cap) // лок держит → doTranslate→null → НЕ эмитит
      resolveFn({ status: 'ok', source: 'x', cues: [{ start: 0, end: 2, ru: 'Привет' }] })
    })
    expect(translateWindowMock).toHaveBeenCalledTimes(1) // single-flight
    await waitFor(() => expect(trackMock.mock.calls.filter(([e]) => e === 'subtitle_line_reveal').length).toBe(1))
  })

  it('busy(429): эмит result=busy, RU не показан', async () => {
    h.cues = [{ start: 0, end: 2, text_en: 'Hello', text_ru: '' }]
    translateWindowMock.mockResolvedValue({ status: 'busy', retryAfterSec: 5, kind: '429' })
    const { container } = mount()
    await act(async () => { fireEvent.click(capsules(container)[0]) })
    await waitFor(() => {
      const reveal = trackMock.mock.calls.find(([e]) => e === 'subtitle_line_reveal')
      expect(reveal![1]).toMatchObject({ result: 'busy' })
    })
    expect(container.textContent).not.toContain('Привет')
  })

  it('shouldReveal-wiring: ok БЕЗ перекрытия нажатой строки → RU НЕ раскрыт, но эмит result=ok', async () => {
    // Анти-регресс «пустая видимая плашка»: matched без индекса 0 (resp-cue не перекрывает 0-2).
    h.cues = [{ start: 0, end: 2, text_en: 'Hello', text_ru: '' }]
    translateWindowMock.mockResolvedValue({ status: 'ok', source: 'x', cues: [{ start: 100, end: 102, ru: 'Сосед' }] })
    const { container } = mount()
    await act(async () => { fireEvent.click(capsules(container)[0]) })
    await waitFor(() => expect(trackMock.mock.calls.some(([e]) => e === 'subtitle_line_reveal')).toBe(true))
    const reveal = trackMock.mock.calls.find(([e]) => e === 'subtitle_line_reveal')
    expect(reveal![1]).toMatchObject({ result: 'ok' })
    // RU НЕ раскрыт (shouldReveal=false: matched без нажатого индекса, text_ru пуст).
    expect(container.textContent).not.toContain('Сосед')
    expect(trackMock.mock.calls.some(([e]) => e === 'subtitle_mode_change')).toBe(false)
  })
})
