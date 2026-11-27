// CabinetProfile.test.tsx — «Профиль» кабинета: почта (изменить с письмом на
// новый адрес), имя, удаление данных, выключенная ось и сбои.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { CabinetLayout } from '../cabinet/CabinetLayout'
import { CabinetHome } from '../cabinet/CabinetHome'
import { CabinetProfile } from '../cabinet/CabinetProfile'
import { __resetSessionForTests } from '../session'
import { __resetProfileCacheForTests } from '../cabinet/profile-api'
import { setCabinetMarker } from './cabinet-marker'

const EXP = new Date(new Date().getFullYear(), 10, 24, 12).toISOString()
const ACTIVE = { authenticated: true, state: 'active', cabinet: true, key_prefix: 'tpk_aaaa', demo: false, key_expires_at: EXP, shadowing: true, route_allowed: true }
const MAIL = 'secret@example.org'

type R = { status: number; body?: unknown } | 'network'
interface Calls { method: string; url: string; body: unknown }

function setup(routes: { get?: R; put?: R; email?: R; erase?: R }) {
  const calls: Calls[] = []
  const f = vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET'
    if (url === '/api/session') return new Response(JSON.stringify(ACTIVE), { status: 200, headers: { 'Content-Type': 'application/json' } })
    calls.push({ method, url, body: init.body ? JSON.parse(String(init.body)) : undefined })
    const pick = url === '/api/me/profile' ? (method === 'GET' ? routes.get : routes.put)
      : url === '/api/me/profile/email' ? routes.email : url === '/api/me/erase-request' ? routes.erase : undefined
    const r: R = pick ?? { status: 404, body: { error: 'not_found' } }
    if (r === 'network') throw new TypeError('offline')
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status, headers: { 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', f)
  return { calls, f }
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/app" element={<CabinetLayout />}>
          <Route index element={<CabinetHome />} />
          <Route path="profile" element={<CabinetProfile />} />
        </Route>
        <Route path="*" element={<div data-testid="where">login</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

const withContact = (extra: Record<string, unknown> = {}) => ({
  status: 200,
  body: { available: true, contact: { email_masked: 's***@example.org', email_verified: true, name: 'Аня' }, pending: false, ...extra },
})
const noContact = (pending = false) => ({ status: 200, body: { available: true, contact: null, pending, ...(pending ? { pending_expires_at: '2026-11-21T10:00:00Z' } : {}) } })

describe('Профиль кабинета', () => {
  beforeEach(() => { localStorage.clear(); __resetSessionForTests(); __resetProfileCacheForTests(); setCabinetMarker(true); window.scrollTo = vi.fn() as unknown as typeof window.scrollTo })
  afterEach(() => { vi.unstubAllGlobals(); __resetSessionForTests(); setCabinetMarker(false) })

  it('ось шлюза выключена — прежняя страница: только «Ключ» и «Выход», без ошибок', async () => {
    setup({ get: { status: 200, body: { available: false } } })
    renderAt('/app/profile')
    expect(await screen.findByText('tpk_aaaa…')).toBeTruthy()
    await waitFor(() => expect(screen.queryByText('Почта')).toBeNull())
    expect(screen.queryByText('Удалить мои данные')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(document.querySelector('.prof-out')).toBeTruthy()
  })

  it('чтение 503 — «временно недоступно», ключ остаётся', async () => {
    setup({ get: { status: 503, body: { error: 'contacts_unavailable' } } })
    renderAt('/app/profile')
    expect((await screen.findAllByText('временно недоступно')).length).toBe(2)
    expect(screen.getByText('tpk_aaaa…')).toBeTruthy()
  })

  it('показывает маску, «подтверждена» и имя', async () => {
    setup({ get: withContact() })
    renderAt('/app/profile')
    expect(await screen.findByText('s***@example.org')).toBeTruthy()
    expect(screen.getByText('подтверждена')).toBeTruthy()
    expect((screen.getByLabelText('Как к Вам обращаться') as HTMLInputElement).value).toBe('Аня')
  })

  it('смена почты: письмо отправлено, текст с маской, 24 часа', async () => {
    const { calls } = setup({ get: withContact(), email: { status: 202, body: { pending_email_masked: 'n***@mail.ru' } } })
    renderAt('/app/profile')
    fireEvent.click(await screen.findByRole('button', { name: 'Изменить' }))
    expect(screen.queryByText(/Даю согласие на обработку/)).toBeNull() // у ключа с контактом согласия нет
    fireEvent.change(screen.getByLabelText('Новая почта'), { target: { value: ` ${MAIL} ` } })
    fireEvent.click(screen.getByRole('button', { name: 'Отправить письмо' }))
    expect(await screen.findByText(/Мы отправили письмо на n\*\*\*@mail\.ru\. Откройте ссылку из письма, чтобы подтвердить адрес\. Ссылка действует 24 часа\./)).toBeTruthy()
    const post = calls.find(c => c.url === '/api/me/profile/email')
    expect(post?.body).toEqual({ email: MAIL })
  })

  it('ключ без контакта: согласие обязательно, имя и consent_version уходят', async () => {
    const { calls } = setup({ get: noContact(), email: { status: 202, body: { pending_email_masked: 'n***@mail.ru' } } })
    renderAt('/app/profile')
    fireEvent.click(await screen.findByRole('button', { name: 'Указать почту' }))
    fireEvent.change(screen.getByLabelText('Почта'), { target: { value: MAIL } })
    fireEvent.change(screen.getByLabelText('Как к Вам обращаться (необязательно)'), { target: { value: 'Аня' } })
    const send = screen.getByRole('button', { name: 'Отправить письмо' }) as HTMLButtonElement
    expect(send.disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox'))
    expect(send.disabled).toBe(false)
    fireEvent.click(send)
    await screen.findByText(/Мы отправили письмо/)
    expect(calls.find(c => c.url === '/api/me/profile/email')?.body).toEqual({ email: MAIL, name: 'Аня', consent_version: 'profile-v1' })
  })

  it('первый адрес ждёт подтверждения: ожидание и пояснение у имени', async () => {
    setup({ get: noContact(true) })
    renderAt('/app/profile')
    expect(await screen.findByText(/Ждём подтверждения адреса до /)).toBeTruthy()
    expect(screen.getByText('Имя появится после подтверждения почты.')).toBeTruthy()
    expect((screen.getByLabelText('Как к Вам обращаться') as HTMLInputElement).disabled).toBe(true)
  })

  it('ожидает новый адрес при подтверждённом старом', async () => {
    setup({ get: withContact({ pending: true, pending_expires_at: '2026-11-21T10:00:00Z' }) })
    renderAt('/app/profile')
    expect(await screen.findByText(/Ждём подтверждения нового адреса до /)).toBeTruthy()
    expect(screen.getByText('s***@example.org')).toBeTruthy()
  })

  it('«этот адрес уже подтверждён»', async () => {
    setup({ get: withContact(), email: { status: 200, body: { unchanged: true } } })
    renderAt('/app/profile')
    fireEvent.click(await screen.findByRole('button', { name: 'Изменить' }))
    fireEvent.change(screen.getByLabelText('Новая почта'), { target: { value: MAIL } })
    fireEvent.click(screen.getByRole('button', { name: 'Отправить письмо' }))
    expect(await screen.findByText('Этот адрес уже подтверждён.')).toBeTruthy()
  })

  it.each([
    [503, 'mail_unavailable', 'Не удалось убедиться, что письмо ушло. Проверьте почту через пару минут, прежде чем запрашивать снова.'],
    [429, 'rate_limited', 'Слишком много запросов на смену почты. Попробуйте завтра.'],
    [429, 'daily_limit', 'Сегодня письма временно не отправляются. Попробуйте завтра.'],
    [400, 'email_invalid', 'Проверьте адрес почты: похоже, в нём ошибка.'],
  ])('почта: %i %s → текст', async (status, code, text) => {
    setup({ get: withContact(), email: { status, body: { error: code } } })
    renderAt('/app/profile')
    fireEvent.click(await screen.findByRole('button', { name: 'Изменить' }))
    fireEvent.change(screen.getByLabelText('Новая почта'), { target: { value: MAIL } })
    fireEvent.click(screen.getByRole('button', { name: 'Отправить письмо' }))
    expect(await screen.findByText(text)).toBeTruthy()
    expect(document.body.textContent).not.toContain(MAIL)
  })

  it('двойной клик не шлёт два запроса, кнопка заблокирована в полёте', async () => {
    let release: (r: Response) => void = () => undefined
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit = {}) => {
      if (url === '/api/session') return Promise.resolve(new Response(JSON.stringify(ACTIVE), { status: 200 }))
      if (url === '/api/me/profile' && (init.method ?? 'GET') === 'GET') return Promise.resolve(new Response(JSON.stringify(withContact().body), { status: 200 }))
      calls.push(url)
      return new Promise<Response>(res => { release = res })
    }))
    renderAt('/app/profile')
    fireEvent.click(await screen.findByRole('button', { name: 'Изменить' }))
    fireEvent.change(screen.getByLabelText('Новая почта'), { target: { value: MAIL } })
    const btn = screen.getByRole('button', { name: 'Отправить письмо' }) as HTMLButtonElement
    fireEvent.click(btn)
    fireEvent.click(btn)
    await waitFor(() => expect((screen.getByRole('button', { name: 'Отправляем…' }) as HTMLButtonElement).disabled).toBe(true))
    expect(calls.filter(u => u === '/api/me/profile/email').length).toBe(1)
    release(new Response(JSON.stringify({ pending_email_masked: 'n***@mail.ru' }), { status: 202 }))
    await screen.findByText(/Мы отправили письмо/)
  })

  it('имя: сохранить, «Сохранено»; contact_required; длинное имя блокируется подсказкой', async () => {
    const { calls } = setup({ get: withContact(), put: { status: 200, body: { name: 'Борис' } } })
    renderAt('/app/profile')
    const input = (await screen.findByLabelText('Как к Вам обращаться')) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Борис 😀' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(await screen.findByText('Сохранено')).toBeTruthy()
    expect(calls.find(c => c.method === 'PUT')?.body).toEqual({ name: 'Борис 😀' })
    fireEvent.change(input, { target: { value: '😀'.repeat(101) } })
    expect(screen.getByText('Не больше 100 символов.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Сохранить' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(input, { target: { value: '😀'.repeat(100) } })
    expect((screen.getByRole('button', { name: 'Сохранить' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('имя: 409 contact_required и 400 name_invalid', async () => {
    setup({ get: withContact(), put: { status: 409, body: { error: 'contact_required' } } })
    renderAt('/app/profile')
    fireEvent.change(await screen.findByLabelText('Как к Вам обращаться'), { target: { value: 'Борис' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(await screen.findByText('Сначала укажите почту.')).toBeTruthy()
  })

  it('удаление данных: подтверждение на странице, отмена, отправка, 429', async () => {
    const { calls } = setup({ get: withContact(), erase: { status: 202, body: { requested: true } } })
    renderAt('/app/profile')
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить мои данные' }))
    expect(screen.getByText('Мы удалим Вашу почту, имя и привязку Telegram. Ключ и маршрут останутся. Отправить запрос?')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    expect(calls.some(c => c.url === '/api/me/erase-request')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Удалить мои данные' }))
    fireEvent.click(screen.getByRole('button', { name: 'Отправить запрос' }))
    expect(await screen.findByText('Запрос отправлен. Поддержка удалит данные и сообщит в @FliboosterHelpUser_bot, если понадобится уточнение.')).toBeTruthy()
    expect(calls.filter(c => c.url === '/api/me/erase-request').length).toBe(1)
  })

  it('удаление: 429 → текст без утверждения о доставке', async () => {
    setup({ get: withContact(), erase: { status: 429, body: { error: 'rate_limited' } } })
    renderAt('/app/profile')
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить мои данные' }))
    fireEvent.click(screen.getByRole('button', { name: 'Отправить запрос' }))
    expect(await screen.findByText('Сегодня запрос уже принимался. Если поддержка не ответит — напишите в @FliboosterHelpUser_bot.')).toBeTruthy()
  })

  it('401 при записи — снимок сессии перечитывается (охрана уведёт на вход)', async () => {
    const { f } = setup({ get: withContact(), erase: { status: 401, body: { error: 'no_session' } } })
    renderAt('/app/profile')
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить мои данные' }))
    const before = f.mock.calls.filter(c => c[0] === '/api/session').length
    fireEvent.click(screen.getByRole('button', { name: 'Отправить запрос' }))
    await waitFor(() => expect(f.mock.calls.filter(c => c[0] === '/api/session').length).toBeGreaterThan(before))
  })

  it('404 на записи (ось выключилась) — страница сворачивается в минимальную', async () => {
    setup({ get: withContact(), erase: { status: 404, body: { error: 'profile_unavailable' } } })
    renderAt('/app/profile')
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить мои данные' }))
    fireEvent.click(screen.getByRole('button', { name: 'Отправить запрос' }))
    await waitFor(() => expect(screen.queryByText('Почта')).toBeNull())
    expect(screen.getByText('tpk_aaaa…')).toBeTruthy()
  })

  it('Главная: «Здравствуйте, Аня!» при имени; без имени и при сбое — обычное', async () => {
    setup({ get: withContact() })
    const a = renderAt('/app')
    expect(await screen.findByRole('heading', { level: 1, name: 'Здравствуйте, Аня!' })).toBeTruthy()
    a.unmount()
    __resetProfileCacheForTests()
    setup({ get: { status: 503, body: { error: 'unavailable' } } })
    renderAt('/app')
    expect(await screen.findByRole('heading', { level: 1, name: 'Здравствуйте!' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
