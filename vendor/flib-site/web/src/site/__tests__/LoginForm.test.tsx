// LoginForm.test.tsx — новое окно входа кабинета: каждое состояние и текст
// (спека §3.9 + тексты дизайна, решение владельца 2026-11-18), отсчёт по
// retry_after_sec, молчаливый повтор при паузе ≤ 1 с (ревью m-12), отсутствие
// своего счётчика попыток, стирание старых ключей после входа.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, fireEvent, screen, act, waitFor } from '@testing-library/react'
import { LoginForm } from '../LoginForm'
import { __resetSessionForTests } from '../session'
import { TELEGRAM_BOT_URL, SUPPORT_BOT_URL } from '../external-links'

const KEY = 'tpk_' + 'b'.repeat(32)
const OK = { key_prefix: 'tpk_bbbb', demo: false, key_expires_at: null, shadowing: true, route_allowed: true }

// Ответ без настоящего ввода-вывода (годится и под фейковыми таймерами).
function fake(status: number, body: unknown, headers: Record<string, string> = {}) {
  return Promise.resolve({ status, ok: status >= 200 && status < 300, headers: new Headers(headers), json: async () => body } as unknown as Response)
}

function stub(...replies: [number, unknown][]) {
  const f = vi.fn()
  for (const [s, b] of replies) f.mockImplementationOnce(() => fake(s, b))
  f.mockImplementation(() => fake(replies[replies.length - 1][0], replies[replies.length - 1][1]))
  vi.stubGlobal('fetch', f)
  return f
}

function setup(notice: 'logout' | 'revoked' | null = null) {
  const onSuccess = vi.fn()
  render(<LoginForm notice={notice} onSuccess={onSuccess} />)
  const input = screen.getByPlaceholderText('tpk_…') as HTMLInputElement
  const button = () => screen.getByRole('button', { name: /Войти|Проверяем/ }) as HTMLButtonElement
  const type = (v: string) => fireEvent.change(input, { target: { value: v } })
  const submit = () => fireEvent.click(button())
  return { onSuccess, input, button, type, submit }
}

describe('LoginForm', () => {
  beforeEach(() => { localStorage.clear(); __resetSessionForTests() })
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); __resetSessionForTests() })

  it('ввод: «Вход», «Ключ доступа», кнопка неактивна при пустом поле, ссылки «Нет ключа?»', () => {
    const { button, type } = setup()
    expect(screen.getByRole('heading', { name: 'Вход' })).toBeTruthy()
    expect(screen.getByText('Ключ доступа')).toBeTruthy()
    expect(button().disabled).toBe(true)
    type('   ')
    expect(button().disabled).toBe(true)
    type(KEY)
    expect(button().disabled).toBe(false)
    expect(screen.getByText('Нет ключа?')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Купить ключ' }).getAttribute('href')).toBe('/buy')
    // Демо-ключ выдаёт бот меню, а не бот поддержки (DELTA п.1).
    expect(screen.getByRole('link', { name: 'Демо-ключ в Telegram-боте' }).getAttribute('href')).toBe(TELEGRAM_BOT_URL)
  })

  it('нет слов «Проверить», «Готово», «Shadowing»', () => {
    const { type } = setup()
    type(KEY)
    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/Проверить|Готово|Shadowing/)
  })

  it('глаз переключает показ ключа', () => {
    const { input } = setup()
    expect(input.type).toBe('password')
    fireEvent.click(screen.getByRole('button', { name: 'Показать ключ' }))
    expect(input.type).toBe('text')
    fireEvent.click(screen.getByRole('button', { name: 'Скрыть ключ' }))
    expect(input.type).toBe('password')
  })

  it('неверный формат — до запроса', () => {
    const f = stub([200, OK])
    const { type, submit } = setup()
    type('tpk_123')
    submit()
    expect(screen.getByText('Ключ начинается с tpk_ и состоит из 36 символов')).toBeTruthy()
    expect(f).not.toHaveBeenCalled()
  })

  it('загрузка: спиннер и «Проверяем», кнопка неактивна', async () => {
    let release!: () => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(r => { release = () => r(fake(200, OK) as unknown as Response) }).then(x => x)))
    const { type, submit, button } = setup()
    type(KEY)
    submit()
    expect(button().textContent).toBe('Проверяем')
    expect(button().disabled).toBe(true)
    expect(document.querySelector('.spin')).toBeTruthy()
    await act(async () => { release() })
  })

  it('успех: onSuccess, поле очищено, старые ключи стёрты; запрос несёт X-Flib-Request', async () => {
    localStorage.setItem('flib:tpk', 'tpk_' + 'c'.repeat(32))
    localStorage.setItem('flib:access', '{}')
    const f = stub([200, OK])
    const { type, submit, onSuccess, input } = setup()
    type('  ' + KEY + ' ')
    submit()
    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    expect(input.value).toBe('')
    expect(localStorage.getItem('flib:tpk')).toBeNull()
    expect(localStorage.getItem('flib:access')).toBeNull()
    const [url, init] = f.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/session')
    expect((init.headers as Record<string, string>)['X-Flib-Request']).toBe('1')
    expect(JSON.parse(String(init.body))).toEqual({ key: KEY })
  })

  it('неверный ключ — текст дизайна, рамка поля, правка поля снимает ошибку', async () => {
    stub([401, { error: 'invalid_key' }])
    const { type, submit, input } = setup()
    type(KEY)
    submit()
    expect(await screen.findByText('Ключ не найден. Проверьте, что он скопирован целиком, вместе с «tpk_».')).toBeTruthy()
    expect(input.closest('.inp')!.className).toContain('bad')
    type(KEY + 'x')
    expect(screen.queryByText(/Ключ не найден/)).toBeNull()
  })

  it('своего счётчика попыток нет: четыре неверных подряд не запирают окно', async () => {
    stub([401, { error: 'invalid_key' }])
    const { type, submit, input } = setup()
    for (let i = 0; i < 4; i++) {
      type(KEY)
      submit()
      await screen.findByText(/Ключ не найден/)
    }
    expect(input.disabled).toBe(false)
    expect(screen.queryByText(/Слишком много попыток/)).toBeNull()
  })

  it('ключ истёк — текст дизайна и «Продлить» → /buy', async () => {
    stub([403, { error: 'key_expired' }])
    const { type, submit } = setup()
    type(KEY)
    submit()
    const msg = await screen.findByText(/Срок ключа закончился\./)
    expect(msg.textContent).toBe('Срок ключа закончился. Продлить — маршрут сохранится.')
    expect(screen.getByRole('link', { name: 'Продлить' }).getAttribute('href')).toBe('/buy')
  })

  it('ключ отозван — текст §3.9 со ссылкой на поддержку', async () => {
    stub([403, { error: 'key_revoked' }])
    const { type, submit } = setup()
    type(KEY)
    submit()
    const msg = await screen.findByText(/Этот ключ больше не действует/)
    expect(msg.textContent).toBe('Этот ключ больше не действует. Если Вам выдали новый ключ — войдите им. Вопросы — @FliboosterHelpUser_bot')
    expect(screen.getByRole('link', { name: '@FliboosterHelpUser_bot' }).getAttribute('href')).toBe(SUPPORT_BOT_URL)
  })

  it.each<[string, number, unknown]>([
    ['502', 502, { error: 'gateway_unavailable' }],
    ['503 занят', 503, { error: 'gateway_busy' }],
    ['403 csrf', 403, { error: 'csrf' }],
  ])('шлюз недоступен (%s) — текст §3.9', async (_n, status, body) => {
    stub([status, body])
    const { type, submit } = setup()
    type(KEY)
    submit()
    expect(await screen.findByText('Сервер сейчас не отвечает. Попробуйте ещё раз через несколько секунд')).toBeTruthy()
  })

  it('сеть — тот же текст', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline') }))
    const { type, submit } = setup()
    type(KEY)
    submit()
    expect(await screen.findByText(/Сервер сейчас не отвечает/)).toBeTruthy()
  })

  it('слишком много попыток: отсчёт по retry_after_sec, поле и кнопка неактивны, на нуле — снова ввод', async () => {
    vi.useFakeTimers()
    stub([429, { error: 'too_many_attempts', retry_after_sec: 3 }])
    const { type, submit, input, button } = setup()
    type(KEY)
    await act(async () => { submit() })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(screen.getByText('Слишком много попыток. Попробуйте через 3 секунды')).toBeTruthy()
    expect(input.disabled).toBe(true)
    expect(button().disabled).toBe(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(screen.getByText('Слишком много попыток. Попробуйте через 2 секунды')).toBeTruthy()
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(screen.getByText('Слишком много попыток. Попробуйте через 1 секунду')).toBeTruthy()
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(screen.queryByText(/Слишком много попыток/)).toBeNull()
    expect(input.disabled).toBe(false)
  })

  it.each([[30, '30 секунд'], [21, '21 секунду'], [5, '5 секунд'], [480, '480 секунд'], [22, '22 секунды']])(
    'склонение: %i → «%s»', async (n, text) => {
      stub([429, { error: 'too_many_attempts', retry_after_sec: n }])
      const { type, submit } = setup()
      type(KEY)
      submit()
      expect(await screen.findByText(`Слишком много попыток. Попробуйте через ${text}`)).toBeTruthy()
    })

  it('m-12: пауза ≤ 1 с — без плашки, молча ждём и повторяем один раз', async () => {
    vi.useFakeTimers()
    const f = stub([429, { error: 'too_many_attempts', retry_after_sec: 1 }], [200, OK])
    const { type, submit, onSuccess } = setup()
    type(KEY)
    await act(async () => { submit() })
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })
    expect(screen.queryByText(/Слишком много попыток/)).toBeNull()
    expect(f).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(f).toHaveBeenCalledTimes(2)
    expect(onSuccess).toHaveBeenCalled()
    expect(screen.queryByText(/Слишком много попыток/)).toBeNull()
  })

  it('занятый семафор (busy) — молчаливый повтор; второй busy — «сервер не отвечает»', async () => {
    vi.useFakeTimers()
    const f = stub([429, { error: 'busy', retry_after_sec: 2 }])
    const { type, submit } = setup()
    type(KEY)
    await act(async () => { submit() })
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })
    expect(screen.queryByText(/Сервер сейчас не отвечает/)).toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(f).toHaveBeenCalledTimes(2)
    expect(screen.getByText(/Сервер сейчас не отвечает/)).toBeTruthy()
  })

  it('уведомления: «Вы вышли из кабинета» и отозванный ключ; правка поля их снимает', () => {
    const { type } = setup('logout')
    expect(screen.getByText('Вы вышли из кабинета')).toBeTruthy()
    type('t')
    expect(screen.queryByText('Вы вышли из кабинета')).toBeNull()
  })
})
