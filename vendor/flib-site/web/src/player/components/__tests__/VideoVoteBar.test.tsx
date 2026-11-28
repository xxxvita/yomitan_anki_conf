// VideoVoteBar.test.tsx — feedback-2 п.3 + feedback-forms [ID:P-feedback-forms]:
// лайк (мгновенно), дизлайк (форма: шкала 0..10 + мультивыбор причин),
// "!"-флаг (textarea + мультивыбор причин добавляет строки). Покрываем:
// рендер трёх кнопок, мгновенная отправка лайка (с визуальной фиксацией
// выбора), дизлайк больше НЕ шлёт мгновенно — открывает форму; форма шлётся
// только после явного выбора балла шкалы (0 — валидное значение, не
// falsy-скип); мультивыбор причин (toggle) у обеих форм; флаг: кнопки
// причин добавляют свою строку в textarea, повторный клик убирает именно
// свою строку, не трогая ручной текст; формы дизлайка/флага
// взаимоисключающие; ошибки сети/не-2xx глотаются в console.warn (не
// бросают); клики не всплывают наружу (stopPropagation).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { VideoVoteBar } from '../VideoVoteBar'

function jsonResponse(ok: boolean, status = 204) {
  return { ok, status }
}

// Ровно та же последовательность причин, что во VideoVoteBar.tsx — тесты
// сверяют мультивыбор по тексту кнопки, порядок кнопок фиксирован задачей.
const DISLIKE_REASON_1 = 'Очень быстрый темп'
const DISLIKE_REASON_2 = 'Нет субтитров'
const FLAG_REASON_1 = 'Отсутствует звук'
const FLAG_REASON_2 = 'Видео нечёткое'

describe('VideoVoteBar', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('renders like/dislike/flag buttons', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(true)))
    render(<VideoVoteBar videoId="abcdef123" />)
    expect(screen.getByRole('button', { name: 'Понравилось' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Не понравилось' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Обратить внимание и написать комментарий' })).toBeTruthy()
  })

  it('renders nothing when videoId is empty', () => {
    const { container } = render(<VideoVoteBar videoId="" />)
    expect(container.firstChild).toBeNull()
  })

  it('like click sends POST immediately with anon_id from ensureAnonId, video_id, verdict=like and fixes the selection visually', () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(true))
    vi.stubGlobal('fetch', fetchMock)
    render(<VideoVoteBar videoId="abcdef123" />)

    const likeBtn = screen.getByRole('button', { name: 'Понравилось' })
    fireEvent.click(likeBtn)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/feedback/video')
    expect(opts.method).toBe('POST')
    const body = JSON.parse(opts.body)
    expect(body.video_id).toBe('abcdef123')
    expect(body.verdict).toBe('like')
    expect(typeof body.anon_id).toBe('string')
    expect(body.anon_id.length).toBeGreaterThan(0)
    // anon_id должен совпадать с тем, что теперь лежит в localStorage (ensureAnonId).
    expect(window.localStorage.getItem('flib:anon')).toBe(body.anon_id)

    expect(likeBtn.className).toContain('is-active')
  })

  it('network failure is swallowed via console.warn, not thrown', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    render(<VideoVoteBar videoId="abcdef123" />)

    expect(() => fireEvent.click(screen.getByRole('button', { name: 'Понравилось' }))).not.toThrow()
    await waitFor(() => expect(warnSpy).toHaveBeenCalled())
  })

  it('clicks inside the bar do not bubble to an outer onClick (stopPropagation — must not interfere with the player)', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(true)))
    const outerClick = vi.fn()
    render(
      <div onClick={outerClick}>
        <VideoVoteBar videoId="abcdef123" />
      </div>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Понравилось' }))
    expect(outerClick).not.toHaveBeenCalled()
  })

  // --- 👎 дизлайк → форма (шкала 0..10 + мультивыбор причин) ---

  it('dislike click opens the scale+reasons form instead of sending immediately', () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(true))
    vi.stubGlobal('fetch', fetchMock)
    render(<VideoVoteBar videoId="abcdef123" />)

    fireEvent.click(screen.getByRole('button', { name: 'Не понравилось' }))

    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.getByText('Насколько это видео могло бы Вам подходить?')).toBeTruthy()
    expect(screen.getByText(DISLIKE_REASON_1)).toBeTruthy()
  })

  it('dislike form renders 11 discrete score buttons 0..10 with NOTHING preselected', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(true)))
    render(<VideoVoteBar videoId="abcdef123" />)

    fireEvent.click(screen.getByRole('button', { name: 'Не понравилось' }))
    const scaleBtns = screen.getAllByRole('radio')
    expect(scaleBtns).toHaveLength(11)
    // Ни одна кнопка не должна быть выбрана изначально (нет priming).
    for (const btn of scaleBtns) {
      expect(btn.getAttribute('aria-checked')).toBe('false')
    }
  })

  it('dislike submit is disabled until a score button is selected', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(true)))
    render(<VideoVoteBar videoId="abcdef123" />)

    fireEvent.click(screen.getByRole('button', { name: 'Не понравилось' }))
    const sendBtn = screen.getAllByRole('button', { name: 'Отправить' })[0] as HTMLButtonElement
    expect(sendBtn.disabled).toBe(true)

    fireEvent.click(screen.getByRole('radio', { name: '3 из 10' }))
    expect(sendBtn.disabled).toBe(false)
  })

  it('dislike score button 0 is a valid, non-skipped choice (not a falsy-skip bug)', () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(true))
    vi.stubGlobal('fetch', fetchMock)
    render(<VideoVoteBar videoId="abcdef123" />)

    fireEvent.click(screen.getByRole('button', { name: 'Не понравилось' }))
    const zeroBtn = screen.getByRole('radio', { name: '0 из 10' })
    fireEvent.click(zeroBtn)
    expect(zeroBtn.getAttribute('aria-checked')).toBe('true')

    const sendBtn = screen.getAllByRole('button', { name: 'Отправить' })[0] as HTMLButtonElement
    expect(sendBtn.disabled).toBe(false) // выбрал 0 — валидный выбор, не falsy-скип

    fireEvent.click(sendBtn)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.score).toBe(0)
  })

  it('dislike score selection can be changed: the latest clicked button wins', () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(true))
    vi.stubGlobal('fetch', fetchMock)
    render(<VideoVoteBar videoId="abcdef123" />)

    fireEvent.click(screen.getByRole('button', { name: 'Не понравилось' }))
    fireEvent.click(screen.getByRole('radio', { name: '2 из 10' }))
    fireEvent.click(screen.getByRole('radio', { name: '7 из 10' })) // передумал

    expect(screen.getByRole('radio', { name: '2 из 10' }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByRole('radio', { name: '7 из 10' }).getAttribute('aria-checked')).toBe('true')

    fireEvent.click(screen.getAllByRole('button', { name: 'Отправить' })[0])
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.score).toBe(7)
  })

  it('dislike reasons multi-select toggles on/off', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(true)))
    render(<VideoVoteBar videoId="abcdef123" />)

    fireEvent.click(screen.getByRole('button', { name: 'Не понравилось' }))
    const reasonBtn = screen.getByRole('button', { name: DISLIKE_REASON_1 })
    expect(reasonBtn.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(reasonBtn)
    expect(reasonBtn.getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(reasonBtn)
    expect(reasonBtn.getAttribute('aria-pressed')).toBe('false')
  })

  it('dislike submit sends verdict=dislike with score, reasons and a composed human-readable comment; resets and closes the form; fixes the visual selection', () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(true))
    vi.stubGlobal('fetch', fetchMock)
    render(<VideoVoteBar videoId="abcdef123" />)

    const dislikeBtn = screen.getByRole('button', { name: 'Не понравилось' })
    fireEvent.click(dislikeBtn)
    fireEvent.click(screen.getByRole('radio', { name: '3 из 10' }))
    fireEvent.click(screen.getByRole('button', { name: DISLIKE_REASON_1 }))
    fireEvent.click(screen.getByRole('button', { name: DISLIKE_REASON_2 }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Отправить' })[0])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.verdict).toBe('dislike')
    expect(body.score).toBe(3)
    expect(body.reasons).toEqual([DISLIKE_REASON_1, DISLIKE_REASON_2])
    expect(body.comment).toContain('3/10')
    expect(body.comment).toContain(DISLIKE_REASON_1)
    expect(body.comment).toContain(DISLIKE_REASON_2)

    // Форма закрылась, визуальный выбор зафиксирован на дизлайке.
    expect(screen.queryByText('Насколько это видео могло бы Вам подходить?')).toBeNull()
    expect(dislikeBtn.className).toContain('is-active')
  })

  it('opening the flag form closes an open dislike form and vice versa (mutually exclusive)', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(true)))
    render(<VideoVoteBar videoId="abcdef123" />)

    fireEvent.click(screen.getByRole('button', { name: 'Не понравилось' }))
    expect(screen.getByText('Насколько это видео могло бы Вам подходить?')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Обратить внимание и написать комментарий' }))
    expect(screen.queryByText('Насколько это видео могло бы Вам подходить?')).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Комментарий' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Не понравилось' }))
    expect(screen.getByText('Насколько это видео могло бы Вам подходить?')).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: 'Комментарий' })).toBeNull()
  })

  it('non-2xx response on dislike submit is swallowed via console.warn, not thrown', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(false, 429)))
    render(<VideoVoteBar videoId="abcdef123" />)

    fireEvent.click(screen.getByRole('button', { name: 'Не понравилось' }))
    fireEvent.click(screen.getByRole('radio', { name: '7 из 10' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Отправить' })[0])
    await waitFor(() => expect(warnSpy).toHaveBeenCalled())
  })

  // --- ❗ флаг → кнопки-причины + большая textarea ---

  it('"!" opens a form with a textarea (not a single-line input) and reason buttons; submit is a no-op while empty', () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(true))
    vi.stubGlobal('fetch', fetchMock)
    render(<VideoVoteBar videoId="abcdef123" />)

    fireEvent.click(screen.getByRole('button', { name: 'Обратить внимание и написать комментарий' }))
    const textarea = screen.getByRole('textbox', { name: 'Комментарий' })
    expect(textarea.tagName).toBe('TEXTAREA')
    expect(screen.getByText(FLAG_REASON_1)).toBeTruthy()

    const sendBtn = screen.getByRole('button', { name: 'Отправить' }) as HTMLButtonElement
    expect(sendBtn.disabled).toBe(true)
    fireEvent.click(sendBtn)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('"!" with a manually typed comment sends verdict=flag with the comment, then closes the form and clears the input', () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(true))
    vi.stubGlobal('fetch', fetchMock)
    render(<VideoVoteBar videoId="abcdef123" />)

    fireEvent.click(screen.getByRole('button', { name: 'Обратить внимание и написать комментарий' }))
    const textarea = screen.getByRole('textbox', { name: 'Комментарий' })
    fireEvent.change(textarea, { target: { value: '  тут ошибка в переводе  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.verdict).toBe('flag')
    expect(body.comment).toBe('тут ошибка в переводе') // trimmed
    expect(body.reasons).toBeUndefined() // ни одна кнопка-причина не выбрана

    // Форма закрылась.
    expect(screen.queryByRole('textbox', { name: 'Комментарий' })).toBeNull()
  })

  it('flag reason button appends its text as a new line into the textarea; clicking it again removes only that line', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(true)))
    render(<VideoVoteBar videoId="abcdef123" />)

    fireEvent.click(screen.getByRole('button', { name: 'Обратить внимание и написать комментарий' }))
    const textarea = screen.getByRole('textbox', { name: 'Комментарий' }) as HTMLTextAreaElement

    fireEvent.click(screen.getByRole('button', { name: FLAG_REASON_1 }))
    expect(textarea.value).toContain(FLAG_REASON_1)

    // Пользователь дописывает руками.
    fireEvent.change(textarea, { target: { value: `${textarea.value}\nещё и вот это` } })

    // Повторный клик по той же кнопке — снимает ТОЛЬКО свою строку, ручной текст остаётся.
    fireEvent.click(screen.getByRole('button', { name: FLAG_REASON_1 }))
    expect(textarea.value).not.toContain(FLAG_REASON_1)
    expect(textarea.value).toContain('ещё и вот это')
  })

  it('flag submit sends reasons=[selected reason texts] together with the comment', () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(true))
    vi.stubGlobal('fetch', fetchMock)
    render(<VideoVoteBar videoId="abcdef123" />)

    fireEvent.click(screen.getByRole('button', { name: 'Обратить внимание и написать комментарий' }))
    fireEvent.click(screen.getByRole('button', { name: FLAG_REASON_1 }))
    fireEvent.click(screen.getByRole('button', { name: FLAG_REASON_2 }))
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.verdict).toBe('flag')
    expect(body.reasons).toEqual([FLAG_REASON_1, FLAG_REASON_2])
    expect(body.comment).toContain(FLAG_REASON_1)
    expect(body.comment).toContain(FLAG_REASON_2)
    expect(body.score).toBeUndefined() // score — контракт только формы дизлайка
  })

  it('dislike button shows the active fill while its form is open, before submit (mirrors the flag button)', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(true)))
    render(<VideoVoteBar videoId="abcdef123" />)

    const dislikeBtn = screen.getByRole('button', { name: 'Не понравилось' })
    expect(dislikeBtn.className).not.toContain('is-active')

    fireEvent.click(dislikeBtn)
    expect(dislikeBtn.className).toContain('is-active') // форма открыта, но ещё не отправлена
  })

  it('auto-appended reason lines never push the flag comment past the 500-char server limit', () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(true))
    vi.stubGlobal('fetch', fetchMock)
    render(<VideoVoteBar videoId="abcdef123" />)

    fireEvent.click(screen.getByRole('button', { name: 'Обратить внимание и написать комментарий' }))
    const textarea = screen.getByRole('textbox', { name: 'Комментарий' }) as HTMLTextAreaElement
    // Почти заполняем textarea вручную (маxLength у HTML-атрибута ограничивает
    // только клавиатурный ввод, не программную установку value кнопками).
    fireEvent.change(textarea, { target: { value: 'x'.repeat(490) } })
    fireEvent.click(screen.getByRole('button', { name: 'Отсутствует звук' }))

    expect(textarea.value.length).toBeLessThanOrEqual(500)

    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }))
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.comment.length).toBeLessThanOrEqual(500)
  })

  it('non-2xx response on flag submit is swallowed via console.warn, not thrown', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(false, 429)))
    render(<VideoVoteBar videoId="abcdef123" />)

    fireEvent.click(screen.getByRole('button', { name: 'Обратить внимание и написать комментарий' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Комментарий' }), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }))
    await waitFor(() => expect(warnSpy).toHaveBeenCalled())
  })
})
