// Cabinet.test.tsx — каркас кабинета (A8): охрана /app*, навигация (меню и
// нижняя панель), срок ключа и «Продлить», плашки демо/истёк, Главная-заготовка,
// «скоро», подвал только из external-links.ts, «Наверх», «Выход».
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { CabinetLayout, loginRedirect } from '../cabinet/CabinetLayout'
import { CabinetHome } from '../cabinet/CabinetHome'
import { CabinetSoon } from '../cabinet/CabinetSoon'
import { CabinetProfile } from '../cabinet/CabinetProfile'
import { __resetSessionForTests, startSession, getSession } from '../session'
import * as links from '../external-links'
import { setCabinetMarker } from './cabinet-marker'

const year = new Date().getFullYear()
const EXP = new Date(year, 10, 24, 12).toISOString()
const ACTIVE = { authenticated: true, state: 'active', cabinet: true, key_prefix: 'tpk_aaaa', demo: false, key_expires_at: EXP, shadowing: true, route_allowed: true }

function Where() {
  const l = useLocation()
  return <div data-testid="where">{l.pathname + l.search}</div>
}

type Reply = { status: number; body?: unknown } | 'network'

function bff(session: unknown, opts: { status?: number; del?: Reply; stickyCookie?: boolean } = {}) {
  // Как настоящий BFF: после DELETE 204 cookie нет — GET отвечает «не вошёл»
  // (cabinetLogout перечитывает снимок после 204, финальное ревью F-1).
  let loggedOut = false
  const f = vi.fn(async (url: string, init: RequestInit = {}) => {
    if (url === '/api/session' && init.method === 'DELETE') {
      const d = opts.del ?? { status: 204 }
      if (d === 'network') throw new TypeError('offline')
      if (d.status === 204 && !opts.stickyCookie) loggedOut = true
      return new Response(null, { status: d.status })
    }
    const body = loggedOut && url === '/api/session' ? { authenticated: false, cabinet: true } : session
    return new Response(JSON.stringify(body), { status: opts.status ?? 200, headers: { 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', f)
  return f
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/app" element={<CabinetLayout />}>
          <Route index element={<CabinetHome />} />
          <Route path="route" element={<CabinetSoon title="Маршрут" />} />
          <Route path="knowledge" element={<CabinetSoon title="Мои знания" />} />
          <Route path="profile" element={<CabinetProfile />} />
          <Route path="*" element={<Navigate to="/app" replace />} />
        </Route>
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('кабинет', () => {
  beforeEach(() => { localStorage.clear(); __resetSessionForTests(); setCabinetMarker(true); window.scrollTo = vi.fn() as unknown as typeof window.scrollTo })
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); __resetSessionForTests(); setCabinetMarker(false) })

  describe('охрана /app*', () => {
    it('без сессии → /login?next=<путь>', async () => {
      bff({ authenticated: false, cabinet: true })
      renderAt('/app/profile')
      expect((await screen.findByTestId('where')).textContent).toBe('/login?next=%2Fapp%2Fprofile')
    })

    it('отозванный ключ → /login?reason=revoked&next=…', async () => {
      bff({ authenticated: false, reason: 'revoked', cabinet: true })
      renderAt('/app')
      expect((await screen.findByTestId('where')).textContent).toBe('/login?reason=revoked&next=%2Fapp')
    })

    it('нет метки в index.html (флаг выключен) — /app пуст сразу, как на origin/main', () => {
      setCabinetMarker(false)
      const f = bff(ACTIVE)
      const { container } = renderAt('/app/profile')
      expect(container.innerHTML).toBe('')
      expect(screen.queryByTestId('where')).toBeNull()
      expect(f).not.toHaveBeenCalled()
    })

    it.each<[string, number, unknown]>([
      ['cabinet:false', 200, { authenticated: false, cabinet: false }],
      ['404 (нет SESSION_KEYS)', 404, { error: 'not_found' }],
    ])('метка есть, а сервер говорит «выключен» (%s) — «Страница устарела — обновите её» и «Обновить»', async (_n, status, body) => {
      bff(body, { status })
      renderAt('/app')
      expect(await screen.findByText('Страница устарела — обновите её')).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Обновить' })).toBeTruthy()
      expect(screen.queryByTestId('where')).toBeNull()
    })

    it('сбой проверки сессии: повторы 1, 2, 4 с, затем «Сервер не отвечает»; «Повторить» поднимает кабинет', async () => {
      vi.useFakeTimers()
      let up = false
      const f = vi.fn(async () => {
        if (!up) throw new TypeError('down')
        return new Response(JSON.stringify(ACTIVE), { status: 200 })
      })
      vi.stubGlobal('fetch', f)
      renderAt('/app')
      await act(async () => { await vi.advanceTimersByTimeAsync(10) })
      expect(screen.queryByText(/Сервер сейчас не отвечает/)).toBeNull()
      await act(async () => { await vi.advanceTimersByTimeAsync(7100) })
      expect(f).toHaveBeenCalledTimes(4)
      expect(screen.getByText(/Сервер сейчас не отвечает/)).toBeTruthy()
      up = true
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Повторить' })) })
      await act(async () => { await vi.advanceTimersByTimeAsync(10) })
      expect(screen.getByRole('heading', { name: 'Здравствуйте!' })).toBeTruthy()
    })

    it('неизвестный /app/* → Главная', async () => {
      bff(ACTIVE)
      renderAt('/app/nope')
      expect(await screen.findByRole('heading', { name: 'Здравствуйте!' })).toBeTruthy()
    })

    it('«Выход» в другой вкладке → /login?reason=logout', async () => {
      bff(ACTIVE)
      await act(async () => { await startSession() })
      renderAt('/app')
      await screen.findByRole('heading', { name: 'Здравствуйте!' })
      const other = new BroadcastChannel('flib-session')
      other.postMessage({ type: 'logout' })
      expect((await screen.findByTestId('where')).textContent).toBe('/login?reason=logout')
      other.close()
    })

    it('loginRedirect: self_logout → /login', () => {
      expect(loginRedirect({ ...getSession(), reason: 'self_logout' }, '/app')).toBe('/login')
    })
  })

  describe('навигация', () => {
    it('меню слева: 4 пункта и «Выход»; нижняя панель телефона: 4 пункта', async () => {
      bff(ACTIVE)
      renderAt('/app')
      const side = await screen.findByRole('navigation', { name: 'Кабинет' })
      expect(within(side).getAllByRole('link').map(a => a.textContent)).toEqual(['Главная', 'Маршрут', 'Мои знания', 'Профиль'])
      expect(screen.getAllByRole('button', { name: 'Выход' }).length).toBe(1)
      const tabs = screen.getByRole('navigation', { name: 'Кабинет — разделы' })
      expect(within(tabs).getAllByRole('link').map(a => a.textContent)).toEqual(['Главная', 'Маршрут', 'Знания', 'Профиль'])
      expect(within(side).getByRole('link', { name: 'Главная' }).className).toBe('on')
    })

    it('«Маршрут» и «Мои знания» — «скоро»; активный пункт подсвечен', async () => {
      bff(ACTIVE)
      renderAt('/app')
      const side = await screen.findByRole('navigation', { name: 'Кабинет' })
      fireEvent.click(within(side).getByRole('link', { name: 'Маршрут' }))
      expect(screen.getByRole('heading', { name: 'Скоро' })).toBeTruthy()
      expect(within(side).getByRole('link', { name: 'Маршрут' }).className).toBe('on')
      fireEvent.click(within(side).getByRole('link', { name: /Мои знания/ }))
      expect(screen.getByText('Мои знания', { selector: '.mono' })).toBeTruthy()
    })
  })

  // Владелец 2026-11-19: логотип FLIBOOSTER вверху меню ведёт на лендинг «/».
  // Лендинг отдаёт сервер (BFF), поэтому нужен ПОЛНЫЙ переход: обычная ссылка,
  // клик по которой роутер не перехватывает (preventDefault не вызывается).
  describe('логотип', () => {
    it('в меню слева — ссылка на «/» с полной загрузкой страницы', async () => {
      bff(ACTIVE)
      const { container } = renderAt('/app')
      await screen.findByRole('navigation', { name: 'Кабинет' })
      const side = container.querySelector('aside.side') as HTMLElement
      const logo = within(side).getByRole('link', { name: /FLIBOOSTER.*главная страница/i }) as HTMLAnchorElement
      expect(logo.getAttribute('href')).toBe('/')
      expect(logo.className).toContain('brand')
      expect(logo.textContent).toBe('FLIBOOSTER')
      expect(logo.querySelector('b')?.textContent).toBe('BOOSTER')
      // Не роутерный переход: клик не отменён — браузер уйдёт на сервер.
      expect(fireEvent.click(logo)).toBe(true)
      expect(screen.queryByTestId('where')).toBeNull()
    })

    it('логотип в верхней полосе (телефон) — та же ссылка', async () => {
      bff(ACTIVE)
      const { container } = renderAt('/app')
      await screen.findByRole('navigation', { name: 'Кабинет' })
      const tb = container.querySelector('.tb-brand') as HTMLElement
      const logo = within(tb).getByRole('link') as HTMLAnchorElement
      expect(logo.getAttribute('href')).toBe('/')
      expect(fireEvent.click(logo)).toBe(true)
    })
  })

  describe('срок ключа', () => {
    // До 24 ноября больше 7 дней: иначе вместо «Ключ активен до …» стоит плашка
    // «Ключ закончится через N дней» (навигация v2; её тесты — nav-v2.test.tsx).
    beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(year, 5, 1, 12)) })

    it('платный: «Ключ активен до 24 ноября» + вторичная «Продлить»', async () => {
      bff(ACTIVE)
      renderAt('/app')
      const line = await screen.findByText(/Ключ активен до/)
      expect(line.textContent).toBe('Ключ активен до 24 ноября')
      const renew = within(document.querySelector('.topbar') as HTMLElement).getByRole('link', { name: 'Продлить' })
      expect(renew.getAttribute('href')).toBe('/buy#renew')
      expect(renew.className).not.toContain('primary')
      expect(screen.queryByText(/Продлите/)).toBeNull()
    })

    it('демо: «Демо до 24 ноября» + основная «Продлить» и плашка на Главной', async () => {
      bff({ ...ACTIVE, demo: true })
      renderAt('/app')
      expect((await screen.findByText(/^Демо до$|Демо до/, { selector: '.keyline' })).textContent).toBe('Демо до 24 ноября· Продлите ключ — маршрут сохранится')
      const renew = within(document.querySelector('.topbar') as HTMLElement).getByRole('link', { name: 'Продлить' })
      expect(renew.className).toContain('primary')
      expect(screen.getByText('Демо до 24 ноября. Продлите ключ — маршрут сохранится.')).toBeTruthy()
    })

    it('бессрочный — без строки и без «Продлить»', async () => {
      bff({ ...ACTIVE, key_expires_at: null })
      renderAt('/app')
      await screen.findByRole('heading', { name: 'Здравствуйте!' })
      expect(document.querySelector('.topbar .keyline')).toBeNull()
      expect(screen.queryByRole('link', { name: 'Продлить' })).toBeNull()
    })

    it('state:unknown — срок по e из cookie', async () => {
      bff({ authenticated: true, state: 'unknown', cabinet: true, key_prefix: 'tpk_aaaa', demo: false, key_expires_at: EXP })
      renderAt('/app')
      expect((await screen.findByText(/Ключ активен до/)).textContent).toBe('Ключ активен до 24 ноября')
    })

    it.each([
      [false, 'Срок действия ключа закончился.'],
      [true, 'Продлите свой демо-ключ — маршрут сохранится.'],
    ])('истёк (демо=%s) — строка в шапке и плашка «%s» на каждой странице', async (demo, text) => {
      bff({ authenticated: true, state: 'expired', cabinet: true, key_prefix: 'tpk_aaaa', demo })
      renderAt('/app/route')
      expect(await screen.findByText(text)).toBeTruthy()
      expect(screen.getByText('Срок действия ключа закончился', { selector: '.keyline' })).toBeTruthy()
      expect(screen.queryByText(/Демо до/)).toBeNull()
    })
  })

  describe('Главная', () => {
    it('заготовка: «Здравствуйте!», «Сегодня в маршруте · скоро», новости с «Заготовка», «Достижения · скоро» без цифр', async () => {
      bff(ACTIVE)
      renderAt('/app')
      expect(await screen.findByRole('heading', { level: 1, name: 'Здравствуйте!' })).toBeTruthy()
      expect(screen.getByText('Сегодня в маршруте')).toBeTruthy()
      expect(screen.getByRole('link', { name: 'Перейти к маршруту' }).getAttribute('href')).toBe('/app/route')
      expect(screen.getByText('Новости и подсказки')).toBeTruthy()
      expect(screen.getAllByText('Заготовка').length).toBe(1) // подсказка про «Мои знания» уже не заготовка (раздел работает)
      const ach = screen.getByRole('region', { name: 'Достижения' })
      expect(ach.textContent).toBe('ДостиженияСкоро')
      expect(ach.querySelectorAll('.ach-card').length).toBe(0)
    })
  })

  describe('подвал', () => {
    it('ссылки только из external-links.ts', async () => {
      bff(ACTIVE)
      renderAt('/app')
      const foot = (await screen.findByText('Поддержка в Telegram')).closest('footer') as HTMLElement
      const allowed = new Set(Object.values(links).filter(v => typeof v === 'string'))
      const hrefs = Array.from(foot.querySelectorAll('a')).map(a => a.getAttribute('href'))
      expect(hrefs).toEqual([links.SUPPORT_BOT_URL, links.DOWNLOAD_PAGE_PATH, links.EXTENSION_PAGE_PATH, links.TELEGRAM_CHANNEL_URL])
      for (const h of hrefs) expect(allowed.has(h!)).toBe(true)
      expect(foot.textContent).toContain('Канал @flibclub')
    })
  })

  describe('«Наверх»', () => {
    it('появляется после 400 px прокрутки и плавно возвращает наверх', async () => {
      bff(ACTIVE)
      renderAt('/app')
      const btn = await screen.findByRole('button', { name: 'Наверх', hidden: true })
      expect(btn.className).not.toContain('show')
      Object.defineProperty(window, 'scrollY', { value: 900, configurable: true })
      await act(async () => { window.dispatchEvent(new Event('scroll')); await new Promise(r => requestAnimationFrame(() => r(null))) })
      expect(btn.className).toContain('show')
      fireEvent.click(btn)
      expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
      Object.defineProperty(window, 'scrollY', { value: 0, configurable: true })
    })
  })

  describe('«Выход»', () => {
    it('DELETE, старые ключи стёрты, снимок обнулён, переход на /login', async () => {
      localStorage.setItem('flib:tpk', 'tpk_' + 'a'.repeat(32))
      localStorage.setItem('flib:access', '{}')
      const f = bff(ACTIVE)
      renderAt('/app')
      fireEvent.click(await screen.findByRole('button', { name: 'Выход' }))
      expect((await screen.findByTestId('where')).textContent).toBe('/login')
      expect(f.mock.calls.some(([u, i]) => u === '/api/session' && (i as RequestInit)?.method === 'DELETE')).toBe(true)
      expect(localStorage.getItem('flib:tpk')).toBeNull()
      expect(localStorage.getItem('flib:access')).toBeNull()
      expect(getSession().authenticated).toBe(false)
    })

    it('cookie не уходит (сервер после повторов всё «вошёл») — «Не удалось выйти», остаёмся в кабинете', async () => {
      bff(ACTIVE, { stickyCookie: true })
      renderAt('/app')
      fireEvent.click(await screen.findByRole('button', { name: 'Выход' }))
      expect(await screen.findByText('Не удалось выйти. Попробуйте ещё раз')).toBeTruthy()
      expect(screen.getByRole('heading', { name: 'Здравствуйте!' })).toBeTruthy()
      expect(screen.queryByTestId('where')).toBeNull()
    })

    it('на телефоне — кнопка внизу «Профиля»', async () => {
      bff(ACTIVE)
      renderAt('/app/profile')
      await screen.findByRole('heading', { name: 'Профиль' })
      const out = document.querySelector('.prof-out') as HTMLButtonElement
      expect(out.textContent).toBe('Выход')
      fireEvent.click(out)
      expect((await screen.findByTestId('where')).textContent).toBe('/login')
    })

    it('DELETE ответил 404 (нет SESSION_KEYS) — «Выход» не удался, остаёмся, ключи стёрты', async () => {
      localStorage.setItem('flib:tpk', 'tpk_' + 'a'.repeat(32))
      bff(ACTIVE, { del: { status: 404 } })
      renderAt('/app')
      fireEvent.click(await screen.findByRole('button', { name: 'Выход' }))
      expect(await screen.findByText('Не удалось выйти. Попробуйте ещё раз')).toBeTruthy()
      expect(screen.getByRole('heading', { name: 'Здравствуйте!' })).toBeTruthy()
      expect(screen.queryByTestId('where')).toBeNull()
      expect(localStorage.getItem('flib:tpk')).toBeNull()
    })

    it('сбой DELETE — остаёмся, сообщение', async () => {
      bff(ACTIVE, { del: 'network' })
      renderAt('/app')
      fireEvent.click(await screen.findByRole('button', { name: 'Выход' }))
      expect(await screen.findByText('Не удалось выйти. Попробуйте ещё раз')).toBeTruthy()
    })
  })

  describe('Профиль', () => {
    it('строка «Ключ»: префикс, срок, «Продлить»', async () => {
      bff(ACTIVE)
      renderAt('/app/profile')
      expect(await screen.findByText('tpk_aaaa…')).toBeTruthy()
      expect(screen.getByText('до 24.11')).toBeTruthy()
    })

    it('демо — «демо до 24.11»', async () => {
      bff({ ...ACTIVE, demo: true })
      renderAt('/app/profile')
      expect(await screen.findByText('демо до 24.11')).toBeTruthy()
    })
  })
})
