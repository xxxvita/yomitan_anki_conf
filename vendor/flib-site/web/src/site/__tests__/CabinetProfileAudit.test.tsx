// CabinetProfileAudit.test.tsx — регрессии аудита 14afa4c (D1–D13 + выжившие
// мутации): неоднозначные 429 и исходы письма, привязка к ключу сессии, срок
// ключа, перечитывание, согласие, доступность.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { CabinetLayout } from '../cabinet/CabinetLayout'
import { CabinetHome } from '../cabinet/CabinetHome'
import { CabinetProfile } from '../cabinet/CabinetProfile'
import { __resetSessionForTests, refreshSession } from '../session'
import { __resetProfileCacheForTests } from '../cabinet/profile-api'
import { setCabinetMarker } from './cabinet-marker'

const EXP = new Date(new Date().getFullYear(), 10, 24, 12).toISOString()
const sess = (prefix: string, extra: Record<string, unknown> = {}) => ({
  authenticated: true, state: 'active', cabinet: true, key_prefix: prefix, demo: false, key_expires_at: EXP, shadowing: true, route_allowed: true, ...extra,
})
const MAIL = 'secret@example.org'
const AMBIG = 'Не удалось убедиться, что письмо ушло. Проверьте почту через пару минут, прежде чем запрашивать снова.'

type R = { status: number; body?: unknown; retry?: string } | 'network'
interface Env { session: unknown; get: R[]; put?: R; email?: R[]; erase?: R[]; calls: { method: string; url: string; body: unknown }[] }

function install(env: Env) {
  const next = (q: R[] | undefined): R => {
    if (!q || q.length === 0) return { status: 404, body: { error: 'not_found' } }
    return q.length > 1 ? q.shift()! : q[0]
  }
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET'
    if (url === '/api/session') return new Response(JSON.stringify(env.session), { status: 200 })
    env.calls.push({ method, url, body: init.body ? JSON.parse(String(init.body)) : undefined })
    const r: R = url === '/api/me/profile' ? (method === 'GET' ? next(env.get) : (env.put ?? { status: 404 }))
      : url === '/api/me/profile/email' ? next(env.email) : url === '/api/me/erase-request' ? next(env.erase) : { status: 404, body: { error: 'not_found' } }
    if (r === 'network') throw new TypeError('offline')
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status, headers: { 'Content-Type': 'application/json', ...(r.retry ? { 'Retry-After': r.retry } : {}) } })
  }))
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

const contactA = { status: 200, body: { available: true, contact: { email_masked: 'a***@alice.example', email_verified: true, name: 'Алиса' }, pending: false } }
const noContact = { status: 200, body: { available: true, contact: null, pending: false } }
const unavailable = { status: 503, body: { error: 'contacts_unavailable' } }
const gets = (env: Env) => env.calls.filter(c => c.method === 'GET' && c.url === '/api/me/profile').length
const posts = (env: Env, url: string) => env.calls.filter(c => c.method !== 'GET' && c.url === url).length

async function openEmail(btn: string, label: string) {
  fireEvent.click(await screen.findByRole('button', { name: btn }))
  fireEvent.change(screen.getByLabelText(label), { target: { value: MAIL } })
}
const sendMail = () => fireEvent.click(screen.getByRole('button', { name: 'Отправить письмо' }))

describe('Профиль: регрессии аудита', () => {
  beforeEach(() => { localStorage.clear(); __resetSessionForTests(); __resetProfileCacheForTests(); setCabinetMarker(true); window.scrollTo = vi.fn() as unknown as typeof window.scrollTo })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); __resetSessionForTests(); setCabinetMarker(false) })

  it('D1: заглушка 404 на GET (флаг маршрута/старый под) — минимальная страница, не ошибка', async () => {
    install({ session: sess('tpk_aaaa'), get: [{ status: 404, body: { error: 'not_found' } }], calls: [] })
    renderAt('/app/profile')
    expect(await screen.findByText('tpk_aaaa…')).toBeTruthy()
    await waitFor(() => expect(screen.queryByText('временно недоступно')).toBeNull())
    expect(screen.queryByText('Почта')).toBeNull()
  })

  it('D2: mail_unavailable + сбой перечитывания — текст «проверьте почту» виден, данные не стёрты', async () => {
    install({ session: sess('tpk_aaaa'), get: [contactA, unavailable], email: [{ status: 503, body: { error: 'mail_unavailable' } }], calls: [] })
    renderAt('/app/profile')
    await openEmail('Изменить', 'Новая почта')
    sendMail()
    expect(await screen.findByText(AMBIG)).toBeTruthy()
    expect(await screen.findByText(/Не удалось обновить/)).toBeTruthy()
    expect(screen.getByText('a***@alice.example')).toBeTruthy()
    expect(screen.queryByLabelText('Новая почта')).toBeNull() // форма закрыта
    expect(screen.queryAllByText('временно недоступно').length).toBe(0)
  })

  it('D3: 202 + сбой перечитывания — «Мы отправили письмо» остаётся', async () => {
    install({ session: sess('tpk_aaaa'), get: [contactA, unavailable], email: [{ status: 202, body: { pending_email_masked: 'n***@mail.ru' } }], calls: [] })
    renderAt('/app/profile')
    await openEmail('Изменить', 'Новая почта')
    sendMail()
    expect(await screen.findByText(/Мы отправили письмо на n\*\*\*@mail\.ru/)).toBeTruthy()
    await waitFor(() => expect(screen.queryByText(/Не удалось обновить/)).not.toBeNull())
    expect(screen.getByText(/Мы отправили письмо/)).toBeTruthy()
    expect(screen.getByText('a***@alice.example')).toBeTruthy()
  })

  it('D4: сеть при POST почты — неоднозначный текст, форма закрыта, перечитывание, без автоповтора', async () => {
    const env: Env = { session: sess('tpk_aaaa'), get: [contactA], email: ['network'], calls: [] }
    install(env)
    renderAt('/app/profile')
    await openEmail('Изменить', 'Новая почта')
    sendMail()
    expect(await screen.findByText(AMBIG)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Отправить письмо' })).toBeNull()
    await waitFor(() => expect(gets(env)).toBe(2))
    await new Promise(r => setTimeout(r, 60))
    expect(posts(env, '/api/me/profile/email')).toBe(1)
  })

  it.each([502, 504])('D5: %i при POST почты — тоже неоднозначно; ожидание показывается из перечитанного профиля', async (st) => {
    const pend = { status: 200, body: { available: true, contact: null, pending: true, pending_expires_at: '2026-11-21T10:00:00Z' } }
    const env: Env = { session: sess('tpk_aaaa'), get: [noContact, pend], email: [{ status: st, body: { error: 'gateway_unavailable' } }], calls: [] }
    install(env)
    renderAt('/app/profile')
    fireEvent.click(await screen.findByRole('button', { name: 'Указать почту' }))
    fireEvent.change(screen.getByLabelText('Почта'), { target: { value: MAIL } })
    fireEvent.click(screen.getByRole('checkbox'))
    sendMail()
    expect(await screen.findByText(AMBIG)).toBeTruthy()
    expect(await screen.findByText(/Ждём подтверждения адреса/)).toBeTruthy()
    expect(posts(env, '/api/me/profile/email')).toBe(1)
  })

  it('D6: смена ключа при открытой странице — чужие почта/имя исчезают, профиль перечитан под новым ключом', async () => {
    const env: Env = { session: sess('tpk_aaaa'), get: [contactA], calls: [] }
    install(env)
    renderAt('/app/profile')
    expect(await screen.findByText('a***@alice.example')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Изменить' })) // форма открыта под A
    fireEvent.change(screen.getByLabelText('Новая почта'), { target: { value: MAIL } })
    env.session = sess('tpk_bbbb')
    env.get = [noContact]
    await act(async () => { await refreshSession() })
    expect(await screen.findByText('tpk_bbbb…')).toBeTruthy()
    await waitFor(() => expect(screen.queryByText('a***@alice.example')).toBeNull())
    expect(screen.getByText('не указана')).toBeTruthy()
    expect(screen.queryByLabelText('Новая почта')).toBeNull()
    expect((screen.getByLabelText('Как к Вам обращаться') as HTMLInputElement).value).toBe('')
    expect(gets(env)).toBe(2)
  })

  it('D6b: Главная после смены ключа не держит имя прежнего', async () => {
    const env: Env = { session: sess('tpk_aaaa'), get: [contactA], calls: [] }
    install(env)
    renderAt('/app')
    expect(await screen.findByRole('heading', { level: 1, name: 'Здравствуйте, Алиса!' })).toBeTruthy()
    env.session = sess('tpk_bbbb')
    env.get = [noContact]
    await act(async () => { await refreshSession() })
    expect(await screen.findByRole('heading', { level: 1, name: 'Здравствуйте!' })).toBeTruthy()
  })

  it('поздний ответ прежнего ключа (перечитывание в полёте) не затирает данные нового', async () => {
    let releaseA: (r: Response) => void = () => undefined
    let n = 0
    const env = { session: sess('tpk_aaaa') as unknown }
    vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit = {}) => {
      if (url === '/api/session') return Promise.resolve(new Response(JSON.stringify(env.session), { status: 200 }))
      if (url === '/api/me/profile' && (init.method ?? 'GET') === 'GET') {
        n++
        if (n === 1) return new Promise<Response>(res => { releaseA = res })
        return Promise.resolve(new Response(JSON.stringify(noContact.body), { status: 200 }))
      }
      return Promise.resolve(new Response('{}', { status: 404 }))
    }))
    renderAt('/app/profile')
    await waitFor(() => expect(n).toBe(1))
    env.session = sess('tpk_bbbb')
    await act(async () => { await refreshSession() })
    expect(await screen.findByText('не указана')).toBeTruthy()
    await act(async () => { releaseA(new Response(JSON.stringify(contactA.body), { status: 200 })) })
    await new Promise(r => setTimeout(r, 40))
    expect(screen.queryByText('a***@alice.example')).toBeNull()
    expect(screen.getByText('не указана')).toBeTruthy()
  })

  it('D7: устаревшее «контакт есть» + 400 consent_required — профиль перечитан, галочка появилась, форма открыта', async () => {
    const env: Env = { session: sess('tpk_aaaa'), get: [contactA, noContact], email: [{ status: 400, body: { error: 'consent_required' } }], calls: [] }
    install(env)
    renderAt('/app/profile')
    await openEmail('Изменить', 'Новая почта')
    sendMail()
    expect(await screen.findByRole('checkbox')).toBeTruthy()
    expect(screen.getByText('Подтвердите согласие и отправьте ещё раз.')).toBeTruthy()
    expect((screen.getByLabelText('Почта') as HTMLInputElement).value).toBe(MAIL)
    expect(gets(env)).toBe(2)
  })

  it('имя: 409 contact_required — перечитано, форма почты открыта', async () => {
    const env: Env = { session: sess('tpk_aaaa'), get: [contactA, noContact], put: { status: 409, body: { error: 'contact_required' } }, calls: [] }
    install(env)
    renderAt('/app/profile')
    fireEvent.change(await screen.findByLabelText('Как к Вам обращаться'), { target: { value: 'Борис' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(await screen.findByText('Сначала укажите почту.')).toBeTruthy()
    expect(await screen.findByLabelText('Почта')).toBeTruthy()
  })

  it('D8: собственный бюджет записи BFF (write_budget, 12 с) на удалении — «через 12 с», без утверждения о доставке', async () => {
    install({ session: sess('tpk_aaaa'), get: [contactA], erase: [{ status: 429, body: { error: 'write_budget', retry_after_sec: 12 }, retry: '12' }], calls: [] })
    renderAt('/app/profile')
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить мои данные' }))
    fireEvent.click(screen.getByRole('button', { name: 'Отправить запрос' }))
    expect(await screen.findByText('Слишком много действий подряд. Попробуйте через 12 с')).toBeTruthy()
    expect(screen.queryByText(/Запрос уже отправлен/)).toBeNull()
  })

  it('D8b: write_budget и gateway_limited на почте — короткое ожидание, не «завтра»', async () => {
    install({ session: sess('tpk_aaaa'), get: [contactA], email: [{ status: 429, body: { error: 'write_budget', retry_after_sec: 12 } }], calls: [] })
    const a = renderAt('/app/profile')
    await openEmail('Изменить', 'Новая почта')
    sendMail()
    expect(await screen.findByText('Слишком много действий подряд. Попробуйте через 12 с')).toBeTruthy()
    a.unmount()
    install({ session: sess('tpk_aaaa'), get: [contactA], email: [{ status: 429, body: { error: 'gateway_limited', retry_after_sec: 90 } }], calls: [] })
    renderAt('/app/profile')
    await openEmail('Изменить', 'Новая почта')
    sendMail()
    expect(await screen.findByText('Слишком много действий подряд. Попробуйте через 2 мин')).toBeTruthy()
  })

  it('429 rate_limited шлюза на удалении (сутки) — не утверждает доставку', async () => {
    install({ session: sess('tpk_aaaa'), get: [contactA], erase: [{ status: 429, body: { error: 'rate_limited', retry_after_sec: 86400 }, retry: '86400' }], calls: [] })
    renderAt('/app/profile')
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить мои данные' }))
    fireEvent.click(screen.getByRole('button', { name: 'Отправить запрос' }))
    expect(await screen.findByText('Сегодня запрос уже принимался. Если поддержка не ответит — напишите в @FliboosterHelpUser_bot.')).toBeTruthy()
  })

  it('D9: ключ истёк (состояние) — «Срок действия ключа закончился» + «Продлить», без удаления, подсказка про поддержку', async () => {
    const env: Env = { session: sess('tpk_aaaa', { state: 'expired' }), get: [{ status: 403, body: { error: 'key_expired' } }], calls: [] }
    install(env)
    renderAt('/app/profile')
    expect(await screen.findByText('Срок действия ключа закончился')).toBeTruthy()
    expect(screen.getAllByRole('link', { name: 'Продлить' }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Удалить мои данные' })).toBeNull()
    expect(screen.getByText('Чтобы удалить данные, напишите в @FliboosterHelpUser_bot')).toBeTruthy()
    expect(screen.queryByText('временно недоступно')).toBeNull()
  })

  it('D9b: ключ активен в снимке, но 403 key_expired на чтении — то же', async () => {
    install({ session: sess('tpk_aaaa'), get: [{ status: 403, body: { error: 'key_expired' } }], calls: [] })
    renderAt('/app/profile')
    expect(await screen.findByText('Срок действия ключа закончился')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Удалить мои данные' })).toBeNull()
  })

  it('D10: согласие и введённое сбрасываются на «Отмена» → повторное открытие', async () => {
    install({ session: sess('tpk_aaaa'), get: [noContact], calls: [] })
    renderAt('/app/profile')
    fireEvent.click(await screen.findByRole('button', { name: 'Указать почту' }))
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.change(screen.getByLabelText('Почта'), { target: { value: MAIL } })
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    fireEvent.click(screen.getByRole('button', { name: 'Указать почту' }))
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false)
    expect((screen.getByLabelText('Почта') as HTMLInputElement).value).toBe('')
  })

  it('D11: пока ждём подтверждения — возврат на вкладку перечитывает (не чаще раза в 10 с)', async () => {
    const pend = { status: 200, body: { available: true, contact: null, pending: true, pending_expires_at: '2026-11-21T10:00:00Z' } }
    const env: Env = { session: sess('tpk_aaaa'), get: [pend], calls: [] }
    let now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    install(env)
    renderAt('/app/profile')
    expect(await screen.findByText(/Ждём подтверждения адреса до /)).toBeTruthy()
    env.get = [contactA]
    // слишком рано — подавлено
    act(() => { window.dispatchEvent(new Event('focus')) })
    await new Promise(r => setTimeout(r, 30))
    expect(gets(env)).toBe(1)
    now += 11_000
    act(() => { window.dispatchEvent(new Event('focus')) })
    expect(await screen.findByText('a***@alice.example')).toBeTruthy()
    expect(screen.queryByText(/Ждём подтверждения/)).toBeNull()
    // без ожидания — слушателей нет
    now += 11_000
    act(() => { window.dispatchEvent(new Event('focus')) })
    await new Promise(r => setTimeout(r, 30))
    expect(gets(env)).toBe(2)
  })

  it('D12: дата ожидания — форматированная; нечитаемая дата не оставляет висячего «до»', async () => {
    install({ session: sess('tpk_aaaa'), get: [{ status: 200, body: { available: true, contact: null, pending: true, pending_expires_at: '2026-11-21T10:00:00Z' } }], calls: [] })
    const a = renderAt('/app/profile')
    const ok = await screen.findByText(/Ждём подтверждения адреса до /)
    expect(ok.textContent).toMatch(/ноября/)
    a.unmount()
    install({ session: sess('tpk_aaaa'), get: [{ status: 200, body: { available: true, contact: null, pending: true, pending_expires_at: 'garbage' } }], calls: [] })
    renderAt('/app/profile')
    const el = await screen.findByText(/Ждём подтверждения адреса/)
    expect(el.textContent).toBe('Ждём подтверждения адреса')
  })

  it('D13: Главная при 401 профиля — обычное приветствие, сессия перечитана', async () => {
    const env: Env = { session: sess('tpk_aaaa'), get: [{ status: 401, body: { error: 'no_session' } }], calls: [] }
    install(env)
    renderAt('/app')
    expect(await screen.findByRole('heading', { level: 1, name: 'Здравствуйте!' })).toBeTruthy()
    await waitFor(() => expect(gets(env)).toBe(1))
  })

  it('Главная: available:false — обычное приветствие; имя кэшируется на 60 с (второй заход без запроса)', async () => {
    const env: Env = { session: sess('tpk_aaaa'), get: [{ status: 200, body: { available: false } }], calls: [] }
    install(env)
    const a = renderAt('/app')
    expect(await screen.findByRole('heading', { level: 1, name: 'Здравствуйте!' })).toBeTruthy()
    a.unmount()
    __resetProfileCacheForTests()
    const env2: Env = { session: sess('tpk_aaaa'), get: [contactA], calls: [] }
    install(env2)
    const b = renderAt('/app')
    expect(await screen.findByRole('heading', { level: 1, name: 'Здравствуйте, Алиса!' })).toBeTruthy()
    b.unmount()
    renderAt('/app')
    expect(await screen.findByRole('heading', { level: 1, name: 'Здравствуйте, Алиса!' })).toBeTruthy()
    expect(gets(env2)).toBe(1)
  })

  it('«не подтверждена» и подсказка про повторный ввод адреса', async () => {
    install({ session: sess('tpk_aaaa'), get: [{ status: 200, body: { available: true, contact: { email_masked: 'a***@alice.example', email_verified: false, name: null }, pending: false } }], calls: [] })
    renderAt('/app/profile')
    expect(await screen.findByText('не подтверждена')).toBeTruthy()
    expect(screen.getByText('Чтобы подтвердить, введите адрес ещё раз — мы пришлём письмо.')).toBeTruthy()
  })

  it('отправка формы без согласия (Enter) не шлёт запрос; причина блокировки объяснена', async () => {
    const env: Env = { session: sess('tpk_aaaa'), get: [noContact], calls: [] }
    install(env)
    renderAt('/app/profile')
    fireEvent.click(await screen.findByRole('button', { name: 'Указать почту' }))
    fireEvent.change(screen.getByLabelText('Почта'), { target: { value: MAIL } })
    expect(screen.getByText(/Поставьте галочку согласия — без неё письмо не отправится/)).toBeTruthy()
    fireEvent.submit(screen.getByLabelText('Почта').closest('form')!)
    await new Promise(r => setTimeout(r, 30))
    expect(posts(env, '/api/me/profile/email')).toBe(0)
  })

  it('сохранение имени и запрос удаления: повторный клик в полёте не даёт второго запроса', async () => {
    let releaseP: (r: Response) => void = () => undefined
    let releaseE: (r: Response) => void = () => undefined
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit = {}) => {
      const m = init.method ?? 'GET'
      if (url === '/api/session') return Promise.resolve(new Response(JSON.stringify(sess('tpk_aaaa')), { status: 200 }))
      if (url === '/api/me/profile' && m === 'GET') return Promise.resolve(new Response(JSON.stringify(contactA.body), { status: 200 }))
      calls.push(m + ' ' + url)
      if (url === '/api/me/profile') return new Promise<Response>(res => { releaseP = res })
      return new Promise<Response>(res => { releaseE = res })
    }))
    renderAt('/app/profile')
    fireEvent.change(await screen.findByLabelText('Как к Вам обращаться'), { target: { value: 'Борис' } })
    const save = screen.getByRole('button', { name: 'Сохранить' })
    fireEvent.click(save); fireEvent.click(save)
    await waitFor(() => expect((screen.getByRole('button', { name: 'Сохраняем…' }) as HTMLButtonElement).disabled).toBe(true))
    expect(calls.filter(c => c === 'PUT /api/me/profile').length).toBe(1)
    await act(async () => { releaseP(new Response(JSON.stringify({ name: 'Борис' }), { status: 200 })) })
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить мои данные' }))
    const send = screen.getByRole('button', { name: 'Отправить запрос' })
    fireEvent.click(send); fireEvent.click(send)
    await waitFor(() => expect((screen.getByRole('button', { name: 'Отправляем…' }) as HTMLButtonElement).disabled).toBe(true))
    expect(calls.filter(c => c === 'POST /api/me/erase-request').length).toBe(1)
    await act(async () => { releaseE(new Response(JSON.stringify({ requested: true }), { status: 202 })) })
  })

  it('a11y: фокус на поле открытой формы, подтверждение удаления — alertdialog, итог получает фокус', async () => {
    install({ session: sess('tpk_aaaa'), get: [contactA], erase: [{ status: 202, body: { requested: true } }], calls: [] })
    renderAt('/app/profile')
    fireEvent.click(await screen.findByRole('button', { name: 'Изменить' }))
    expect(document.activeElement).toBe(screen.getByLabelText('Новая почта'))
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    fireEvent.click(screen.getByRole('button', { name: 'Удалить мои данные' }))
    expect(screen.getByRole('alertdialog')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Отправить запрос' }))
    const done = await screen.findByText(/Запрос отправлен\./)
    await waitFor(() => expect(document.activeElement).toBe(done))
  })

  it('a11y: aria-invalid/aria-describedby на полях имени', async () => {
    install({ session: sess('tpk_aaaa'), get: [contactA], calls: [] })
    renderAt('/app/profile')
    const input = (await screen.findByLabelText('Как к Вам обращаться')) as HTMLInputElement
    fireEvent.change(input, { target: { value: '😀'.repeat(101) } })
    expect(input.getAttribute('aria-invalid')).toBe('true')
    const id = input.getAttribute('aria-describedby')!
    expect(document.getElementById(id)?.textContent).toContain('Не больше 100')
  })
})
