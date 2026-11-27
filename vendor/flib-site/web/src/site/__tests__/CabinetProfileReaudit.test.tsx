// CabinetProfileReaudit.test.tsx — регрессии повторного аудита (N1, L1–L7)
// : неоднозначные 429 и исходы письма, привязка к ключу сессии, срок
// ключа, перечитывание, согласие, доступность.
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
const gets = (env: Env) => env.calls.filter(c => c.method === 'GET' && c.url === '/api/me/profile').length

async function openEmail(btn: string, label: string) {
  fireEvent.click(await screen.findByRole('button', { name: btn }))
  fireEvent.change(screen.getByLabelText(label), { target: { value: MAIL } })
}
const sendMail = () => fireEvent.click(screen.getByRole('button', { name: 'Отправить письмо' }))


const ERASE_AMBIG = 'Не удалось убедиться, что запрос дошёл. Если поддержка не ответит — напишите в @FliboosterHelpUser_bot.'

describe('Profile re-audit', () => {
  beforeEach(() => { localStorage.clear(); __resetSessionForTests(); __resetProfileCacheForTests(); setCabinetMarker(true); window.scrollTo = vi.fn() as unknown as typeof window.scrollTo })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); __resetSessionForTests(); setCabinetMarker(false) })

  it('N1: истёкший снимок + ось выключена — GET был, минимальная страница без строк', async () => {
    const env: Env = { session: sess('tpk_aaaa', { state: 'expired' }), get: [{ status: 404, body: { error: 'not_found' } }], calls: [] }
    install(env); renderAt('/app/profile')
    await screen.findByText('tpk_aaaa…')
    await waitFor(() => expect(gets(env)).toBe(1))
    await new Promise(r => setTimeout(r, 30))
    expect(screen.queryByText('недоступно, пока ключ не продлён')).toBeNull()
    expect(screen.queryByText(/Чтобы удалить данные/)).toBeNull()
  })

  it('N1b: истёкший снимок + available:false — то же', async () => {
    const env: Env = { session: sess('tpk_aaaa', { state: 'expired' }), get: [{ status: 200, body: { available: false } }], calls: [] }
    install(env); renderAt('/app/profile')
    await screen.findByText('tpk_aaaa…')
    await waitFor(() => expect(gets(env)).toBe(1))
    await new Promise(r => setTimeout(r, 30))
    expect(screen.queryByText('недоступно, пока ключ не продлён')).toBeNull()
    expect(screen.queryByText(/Чтобы удалить данные/)).toBeNull()
  })

  it('N1c: истёкший снимок + 403 key_expired — строки «недоступно, пока ключ не продлён» и подсказка', async () => {
    const env: Env = { session: sess('tpk_aaaa', { state: 'expired' }), get: [{ status: 403, body: { error: 'key_expired' } }], calls: [] }
    install(env); renderAt('/app/profile')
    expect(await screen.findByText('недоступно, пока ключ не продлён')).toBeTruthy()
    expect(screen.getByText(/Чтобы удалить данные/)).toBeTruthy()
  })

  for (const [st, body] of [[500, {}], [520, {}], [524, {}], [502, {}], [504, {}], [503, { error: 'mail_unavailable' }]] as const) {
    it(`L1: email ${st} ${JSON.stringify(body)} неоднозначно — форма закрыта, перечитано`, async () => {
      const env: Env = { session: sess('tpk_aaaa'), get: [contactA], email: [{ status: st, body }], calls: [] }
      install(env); renderAt('/app/profile')
      await openEmail('Изменить', 'Новая почта'); sendMail()
      expect(await screen.findByText(AMBIG)).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Отправить письмо' })).toBeNull()
      await waitFor(() => expect(gets(env)).toBe(2))
    })
  }
  it('L1: network error неоднозначна', async () => {
    const env: Env = { session: sess('tpk_aaaa'), get: [contactA], email: ['network'], calls: [] }
    install(env); renderAt('/app/profile')
    await openEmail('Изменить', 'Новая почта'); sendMail()
    expect(await screen.findByText(AMBIG)).toBeTruthy()
  })
  for (const code of ['busy', 'unavailable', 'contacts_unavailable', 'rate_limit_unavailable', 'gateway_unavailable']) {
    it(`L1: email 503 ${code} определённо — форма открыта`, async () => {
      const env: Env = { session: sess('tpk_aaaa'), get: [contactA], email: [{ status: 503, body: { error: code } }], calls: [] }
      install(env); renderAt('/app/profile')
      await openEmail('Изменить', 'Новая почта'); sendMail()
      await screen.findByRole('alert')
      expect(screen.queryByText(AMBIG)).toBeNull()
      expect(screen.getByRole('button', { name: 'Отправить письмо' })).toBeTruthy()
    })
  }

  for (const [st, body] of [[503, { error: 'erase_unavailable' }], [502, {}], [504, {}], [500, {}], [520, {}]] as const) {
    it(`L2: erase ${st} неоднозначно`, async () => {
      const env: Env = { session: sess('tpk_aaaa'), get: [contactA], erase: [{ status: st, body }], calls: [] }
      install(env); renderAt('/app/profile')
      fireEvent.click(await screen.findByRole('button', { name: 'Удалить мои данные' }))
      fireEvent.click(screen.getByRole('button', { name: 'Отправить запрос' }))
      expect(await screen.findByText(ERASE_AMBIG)).toBeTruthy()
    })
  }
  it('L2: erase network error', async () => {
    const env: Env = { session: sess('tpk_aaaa'), get: [contactA], erase: ['network'], calls: [] }
    install(env); renderAt('/app/profile')
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить мои данные' }))
    fireEvent.click(screen.getByRole('button', { name: 'Отправить запрос' }))
    expect(await screen.findByText(ERASE_AMBIG)).toBeTruthy()
  })

  it('L3: 503 busy — «Сервис занят», с Retry-After и без', async () => {
    const env: Env = { session: sess('tpk_aaaa'), get: [contactA], put: { status: 503, body: { error: 'busy' } }, calls: [] }
    install(env); renderAt('/app/profile')
    fireEvent.change(await screen.findByLabelText('Как к Вам обращаться'), { target: { value: 'Боб' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(await screen.findByText('Сервис занят. Попробуйте через минуту.')).toBeTruthy()
    env.put = { status: 503, body: { error: 'busy' }, retry: '7' }
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(await screen.findByText('Сервис занят. Попробуйте через 7 с.')).toBeTruthy()
  })

  it('L4: email rate_limited 1800 — без «подряд»; write_budget — «подряд»', async () => {
    const env: Env = { session: sess('tpk_aaaa'), get: [contactA], email: [
      { status: 429, body: { error: 'rate_limited', retry_after_sec: 1800 }, retry: '1800' },
      { status: 429, body: { error: 'write_budget', retry_after_sec: 20 }, retry: '20' }], calls: [] }
    install(env); renderAt('/app/profile')
    await openEmail('Изменить', 'Новая почта'); sendMail()
    const t = await screen.findByText(/Слишком много запросов на смену почты/)
    expect(t.textContent).toBe('Слишком много запросов на смену почты. Попробуйте позже (через 30 мин)')
    expect(t.textContent).not.toMatch(/подряд/)
    sendMail()
    expect(await screen.findByText(/Слишком много действий подряд/)).toBeTruthy()
  })

  it('L4: erase rate_limited с малым Retry-After — суточный текст, не «подряд»', async () => {
    const env: Env = { session: sess('tpk_aaaa'), get: [contactA], erase: [{ status: 429, body: { error: 'rate_limited', retry_after_sec: 600 }, retry: '600' }], calls: [] }
    install(env); renderAt('/app/profile')
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить мои данные' }))
    fireEvent.click(screen.getByRole('button', { name: 'Отправить запрос' }))
    expect(await screen.findByText(/Сегодня запрос уже принимался/)).toBeTruthy()
  })

  it('L5: consent_required + перечитывание упало — галочка требуется локально', async () => {
    const env: Env = { session: sess('tpk_aaaa'), get: [contactA, { status: 503, body: { error: 'contacts_unavailable' } }], email: [{ status: 400, body: { error: 'consent_required' } }, { status: 202, body: { pending_email_masked: 'x***@y.z' } }], calls: [] }
    install(env); renderAt('/app/profile')
    await openEmail('Изменить', 'Новая почта'); sendMail()
    await screen.findByText('Подтвердите согласие и отправьте ещё раз.')
    await waitFor(() => expect(gets(env)).toBe(2))
    const cb = await screen.findByRole('checkbox')
    expect((screen.getByRole('button', { name: 'Отправить письмо' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(cb)
    sendMail()
    await screen.findByText(/Мы отправили письмо/)
    const b = env.calls.filter(c => c.url === '/api/me/profile/email')[1].body as Record<string, unknown>
    expect(b.consent_version).toBe('profile-v1')
  })

  it('L7: первичный GET упал — строка «Удалить мои данные» есть и работает', async () => {
    const env: Env = { session: sess('tpk_aaaa'), get: [{ status: 503, body: { error: 'contacts_unavailable' } }], erase: [{ status: 202, body: { requested: true } }], calls: [] }
    install(env); renderAt('/app/profile')
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить мои данные' }))
    fireEvent.click(screen.getByRole('button', { name: 'Отправить запрос' }))
    expect(await screen.findByText(/Запрос отправлен/)).toBeTruthy()
  })

  it('L6: Home кэширует отсутствие имени и выключенную ось на 60 с', async () => {
    for (const g of [{ status: 200, body: { available: false } }, noContact, { status: 503, body: { error: 'unavailable' } }]) {
      __resetProfileCacheForTests()
      const env: Env = { session: sess('tpk_aaaa'), get: [g], calls: [] }
      install(env)
      const a = renderAt('/app'); await screen.findByRole('heading', { level: 1, name: 'Здравствуйте!' }); await waitFor(() => expect(gets(env)).toBe(1)); await new Promise(r => setTimeout(r, 30)); a.unmount()
      const b = renderAt('/app'); await screen.findByRole('heading', { level: 1, name: 'Здравствуйте!' }); await new Promise(r => setTimeout(r, 30)); b.unmount()
      expect(gets(env)).toBe(1)
    }
  })
})
