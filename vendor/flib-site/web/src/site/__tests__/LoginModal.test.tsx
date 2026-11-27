// LoginModal.test.tsx — Э6, Shadowing-гейт: валидный ключ с капой/без,
// невалидный, сеть/5xx; фон/Esc закрывают, клик по карточке — нет.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, fireEvent, waitFor } from '@testing-library/react'
import { LoginModal } from '../LoginModal'

function stubFetch(response: { valid: boolean; shadowing?: boolean; key_prefix?: string }) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => response })))
}

describe('LoginModal', () => {
  beforeEach(() => { window.localStorage.clear() })

  it('valid key WITH capability → shows "✓ Shadowing доступен", saves flib:access + flib:tpk', async () => {
    stubFetch({ valid: true, shadowing: true, key_prefix: 'tpk_dead' })
    const onClose = vi.fn()
    const { getByPlaceholderText, getByText } = render(<LoginModal onClose={onClose} />)

    fireEvent.change(getByPlaceholderText('tpk_…'), { target: { value: 'tpk_deadbeefdeadbeefdeadbeefdeadbeef' } })
    fireEvent.click(getByText('Проверить'))

    await waitFor(() => expect(getByText('✓ Shadowing доступен')).toBeTruthy())
    expect(getByText('Готово')).toBeTruthy()
    expect(JSON.parse(window.localStorage.getItem('flib:access')!)).toMatchObject({ shadowing: true, keyPrefix: 'tpk_dead' })
    expect(window.localStorage.getItem('flib:tpk')).toBe('tpk_deadbeefdeadbeefdeadbeefdeadbeef')
  })

  it('valid key WITHOUT capability → shows the no-shadowing message, still saves flib:access', async () => {
    stubFetch({ valid: true, shadowing: false, key_prefix: 'tpk_cafe' })
    const { getByPlaceholderText, getByText } = render(<LoginModal onClose={vi.fn()} />)

    fireEvent.change(getByPlaceholderText('tpk_…'), { target: { value: 'tpk_cafecafecafecafecafecafecafecafe' } })
    fireEvent.click(getByText('Проверить'))

    await waitFor(() => expect(getByText('Ключ принят, но Shadowing недоступен этому ключу')).toBeTruthy())
    expect(JSON.parse(window.localStorage.getItem('flib:access')!)).toMatchObject({ shadowing: false, keyPrefix: 'tpk_cafe' })
  })

  it('invalid key → shows "Ключ не принят сервером", saves nothing', async () => {
    stubFetch({ valid: false })
    const { getByPlaceholderText, getByText } = render(<LoginModal onClose={vi.fn()} />)

    fireEvent.change(getByPlaceholderText('tpk_…'), { target: { value: 'tpk_00000000000000000000000000000000' } })
    fireEvent.click(getByText('Проверить'))

    await waitFor(() => expect(getByText('Ключ не принят сервером')).toBeTruthy())
    expect(window.localStorage.getItem('flib:access')).toBeNull()
  })

  it('network/5xx failure → shows a retry-worthy error message, not "невалидный ключ"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    const { getByPlaceholderText, getByText, queryByText } = render(<LoginModal onClose={vi.fn()} />)

    fireEvent.change(getByPlaceholderText('tpk_…'), { target: { value: 'tpk_deadbeefdeadbeefdeadbeefdeadbeef' } })
    fireEvent.click(getByText('Проверить'))

    await waitFor(() => expect(getByText('Не удалось проверить ключ — попробуйте ещё раз')).toBeTruthy())
    expect(queryByText('Ключ не принят сервером')).toBeNull()
  })

  it('Проверить is disabled until a non-empty key is entered', () => {
    const { getByText } = render(<LoginModal onClose={vi.fn()} />)
    expect((getByText('Проверить') as HTMLButtonElement).disabled).toBe(true)
  })

  it('clicking the backdrop calls onClose; clicking inside the card does not', () => {
    const onClose = vi.fn()
    render(<LoginModal onClose={onClose} />)
    // feedback-1 п.4: LoginModal рендерится через createPortal(...,
    // document.body) — content живёт вне RTL's `container` (сиблинг, не
    // потомок), поэтому ищем по document.body, а не container.querySelector.
    const card = document.body.querySelector('.login-modal') as HTMLElement
    fireEvent.click(card)
    expect(onClose).not.toHaveBeenCalled()

    const overlay = document.body.querySelector('.rs-overlay') as HTMLElement
    fireEvent.click(overlay)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Escape key calls onClose', () => {
    const onClose = vi.fn()
    render(<LoginModal onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  // [ID:P-demo-key] подсказка про бесплатный демо-ключ у Telegram-бота + канал.
  it('показывает подсказку про бесплатный демо-ключ со ссылками на бота и канал (новая вкладка, noopener)', () => {
    render(<LoginModal onClose={vi.fn()} />)
    // Портал → ищем по document.body (не RTL container).
    const body = document.body
    const bot = Array.from(body.querySelectorAll('a')).find(a => /демо-ключ у бота/i.test(a.textContent || '')) as HTMLAnchorElement
    const channel = Array.from(body.querySelectorAll('a')).find(a => /Telegram-канал/i.test(a.textContent || '')) as HTMLAnchorElement
    expect(bot).toBeTruthy()
    expect(bot.getAttribute('href')).toBe('https://t.me/flibclub_bot')
    expect(bot.getAttribute('target')).toBe('_blank')
    expect(bot.getAttribute('rel')).toContain('noopener')
    expect(channel).toBeTruthy()
    expect(channel.getAttribute('href')).toBe('https://t.me/flibclub')
    expect(channel.getAttribute('rel')).toContain('noopener')
    // Ссылки совпадают с подвалом (external-links.ts — единый источник).
    expect(body.textContent).toContain('Демо-ключ можно получить бесплатно')
  })

  // Путь к покупке (жалоба владельца 2026-11-17: «купить ничего нельзя»):
  // рядом с «Войти по ключу» — «Нет ключа? Купить» на /buy ТОГО ЖЕ хоста
  // (относительная ссылка: с flibooster.ru нельзя уводить на flib.club).
  it('рядом с «Войти по ключу» — «Нет ключа? Купить» на относительный /buy, демо-ключ в боте остаётся', () => {
    render(<LoginModal onClose={vi.fn()} />)
    const links = Array.from(document.body.querySelectorAll('a'))
    const buy = links.find(a => a.textContent === 'Нет ключа? Купить') as HTMLAnchorElement
    expect(buy).toBeTruthy()
    expect(buy.getAttribute('href')).toBe('/buy')
    expect(buy.getAttribute('target')).toBeNull()
    // Ссылка в шапке окна, рядом с заголовком «Войти по ключу».
    const head = document.body.querySelector('.login-modal .rs-head') as HTMLElement
    expect(head.textContent).toContain('Войти по ключу')
    expect(head.contains(buy)).toBe(true)
    // «Демо-ключ в боте» — как раньше.
    const bot = links.find(a => /демо-ключ у бота/i.test(a.textContent || '')) as HTMLAnchorElement
    expect(bot.getAttribute('href')).toBe('https://t.me/flibclub_bot')
  })

  // Решение владельца 2026-11-17: «Нет ключа?» в окне ровно один раз — у
  // ссылки на покупку; абзац про демо-ключ начинается сразу с сути.
  it('«Нет ключа?» встречается один раз; абзац про демо-ключ начинается с «Демо-ключ можно получить бесплатно»', () => {
    render(<LoginModal onClose={vi.fn()} />)
    const text = document.body.textContent || ''
    expect(text.split('Нет ключа?').length - 1).toBe(1)
    const demo = document.body.querySelector('.login-demo-text') as HTMLElement
    expect(demo.textContent).toBe(
      'Демо-ключ можно получить бесплатно у нашего Telegram-бота. Загляните и в наш канал — там новости и помощь.',
    )
  })

  // Ревью M5: первый Tab не должен перескакивать поле ключа — при открытии
  // окна фокус уже в поле, ссылка «Купить» на месте визуально.
  it('при открытии фокус в поле ключа', () => {
    render(<LoginModal onClose={vi.fn()} />)
    expect(document.activeElement).toBe(document.getElementById('login-key-input'))
  })

  // Кабинет 2026-11-17 §3.6 (N-I3): старое окно при успешной проверке стирает
  // cookie сессии (откат флага), но НЕ только что записанный flib:tpk.
  it('успешная проверка зовёт DELETE /api/session с X-Flib-Request и оставляет flib:tpk', async () => {
    const f = vi.fn(async (_url: string, init?: RequestInit) => (init?.method === 'DELETE'
      ? new Response(null, { status: 204 })
      : { ok: true, json: async () => ({ valid: true, shadowing: true, key_prefix: 'tpk_dead' }) }) as Response)
    vi.stubGlobal('fetch', f)
    const { getByPlaceholderText, getByText } = render(<LoginModal onClose={vi.fn()} />)
    fireEvent.change(getByPlaceholderText('tpk_…'), { target: { value: 'tpk_deadbeefdeadbeefdeadbeefdeadbeef' } })
    fireEvent.click(getByText('Проверить'))
    await waitFor(() => expect(f.mock.calls.some(([u, i]) => u === '/api/session' && i?.method === 'DELETE')).toBe(true))
    const del = f.mock.calls.find(([u, i]) => u === '/api/session' && i?.method === 'DELETE')!
    expect((del[1]!.headers as Record<string, string>)['X-Flib-Request']).toBe('1')
    expect(window.localStorage.getItem('flib:tpk')).toBe('tpk_deadbeefdeadbeefdeadbeefdeadbeef')
  })

  it('неверный ключ — DELETE /api/session не зовётся', async () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => ({ valid: false }) }) as unknown as Response)
    vi.stubGlobal('fetch', f)
    const { getByPlaceholderText, getByText } = render(<LoginModal onClose={vi.fn()} />)
    fireEvent.change(getByPlaceholderText('tpk_…'), { target: { value: 'tpk_00000000000000000000000000000000' } })
    fireEvent.click(getByText('Проверить'))
    await waitFor(() => expect(getByText('Ключ не принят сервером')).toBeTruthy())
    expect(f.mock.calls.some(c => (c as unknown[])[0] === '/api/session')).toBe(false)
  })

  it('ТЗ-баг «Войти»: рендерится порталом напрямую в document.body (не потомок RTL container) — фикс контейнера containing block от .site-header', () => {
    const { container } = render(<LoginModal onClose={vi.fn()} />)
    // .rs-overlay — НЕ потомок RTL container (значит не унаследует чужой
    // containing block от родителя, в котором его монтируют в проде,
    // например .site-header с backdrop-filter).
    expect(container.querySelector('.rs-overlay')).toBeNull()
    // Портал-обёртка — прямой ребёнок body, sibling у RTL container.
    const portalRoot = document.body.querySelector(':scope > .site')
    expect(portalRoot).toBeTruthy()
    expect(portalRoot?.querySelector('.rs-overlay')).toBeTruthy()
  })
})
