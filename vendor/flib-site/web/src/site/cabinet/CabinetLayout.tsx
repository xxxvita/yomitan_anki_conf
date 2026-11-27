// CabinetLayout.tsx — каркас кабинета /app* (спека 2026-11-17 §3.8; дизайн
// владельца docs/design/cabinet-2026-11-17, «Global shell»; DELTA п.2–3).
//
// Охрана: без сессии любой /app* уводит на /login?next=<путь>; «Выход» в
// другой вкладке — /login?reason=logout («Вы вышли из кабинета»), отозванный
// или заменённый ключ — /login?reason=revoked|invalid. Кабинет выключен (нет
// метки BFF в index.html) — /app не существует, как на origin/main: пусто
// сразу, без ожидания снимка (ревью C-3). Метка есть, а сервер говорит
// «выключен» — «Страница устарела — обновите её» с перезагрузкой.
//
// Компьютер: меню слева (Главная, Маршрут, Мои знания, Профиль; «Выход»
// внизу), справа вверху срок ключа и «Продлить». Телефон (≤ 760 px): нижняя
// панель из 4 пунктов, «Выход» — внизу «Профиля» (решение DELTA п.3 вместо
// бургера плана A8). Оба набора в разметке, нужный показывает CSS.
// Логотип FLIBOOSTER (меню слева и верхняя полоса телефона) — ссылка на
// лендинг «/» с полной загрузкой страницы (владелец 2026-11-19).
//
// Навигация v2 (дизайн 2026-11-19, docs/design/cabinet-2026-11-19 «Навигация
// v2»): активный пункт — полоса 3px, акцент, aria-current="page" (его ставит
// NavLink); у «Маршрута» — «k из M» дня из ОБЩЕГО чтения состояния вкладки
// (своего запроса меню не делает); на странице Маршрута слева в верхней строке
// «Доступно: более 6 000 материалов» — одно и то же для демо и полного ключа
// (решение владельца 2026-11-19 п.1); за 7 дней до конца полного ключа — плашка
// «Ключ закончится через N дней», «Продлить» становится основной.
import { useEffect, useState } from 'react'
import { Navigate, NavLink, Outlet, useLocation, useOutletContext } from 'react-router-dom'
import { CabBrand, CabI } from './cab-icons'
import { CabinetFooter } from './CabinetFooter'
import { ScrollTopButton } from './ScrollTopButton'
import { HeardCheckHost } from './route/heard-check/HeardCheckModal'
import { RENEW_HREF, untilLong } from './key-dates'
import { daysLabel, expirySoon, routeDayCount } from './nav-model'
import { cabinetRouteMarked } from './route/route-storage'
import { useLastRouteRead } from './route/use-route-state'
import { useSession } from '../useSession'
import { cabinetLogout, cabinetMarked, LOGIN_GIVE_UP_FAILURES, refreshSession, type SessionSnapshot } from '../session'
import { ServerDown, StaleNotice } from './ServerDown'
import './cabinet.css'

export interface CabinetCtx {
  session: SessionSnapshot
  logout: () => void
}

export function useCabinet(): CabinetCtx {
  return useOutletContext<CabinetCtx>()
}

const NAV = [
  { to: '/app', end: true, label: 'Главная', short: 'Главная', Icon: CabI.home },
  { to: '/app/route', end: false, label: 'Маршрут', short: 'Маршрут', Icon: CabI.route },
  { to: '/app/knowledge', end: false, label: 'Мои знания', short: 'Знания', Icon: CabI.book },
  { to: '/app/profile', end: false, label: 'Профиль', short: 'Профиль', Icon: CabI.user },
]

// loginRedirect — куда уводит охрана, когда сессии нет.
export function loginRedirect(s: SessionSnapshot, path: string): string {
  if (s.reason === 'self_logout') return '/login'
  if (s.reason === 'logout') return '/login?reason=logout'
  const q = new URLSearchParams()
  if (s.reason === 'revoked' || s.reason === 'invalid') q.set('reason', s.reason)
  q.set('next', path)
  return '/login?' + q.toString()
}

export function CabinetLayout() {
  return cabinetMarked() ? <CabinetShell /> : null
}

function CabinetShell() {
  const s = useSession()
  const loc = useLocation()
  const [logoutFailed, setLogoutFailed] = useState(false)
  const routeRead = useLastRouteRead()

  // Новый раздел — с начала страницы (как в дизайне).
  useEffect(() => {
    try { window.scrollTo(0, 0) } catch { /* окружение без прокрутки */ }
  }, [loc.pathname])

  // Сбой проверки сессии повторяет сам модуль session.ts (1, 2, 4 с …);
  // после нескольких неудач — сообщение и «Повторить».
  if (s.status === 'loading') return <div className="cab" />
  if (s.status === 'error') {
    if (s.failures < LOGIN_GIVE_UP_FAILURES) return <div className="cab" />
    return <div className="cab"><main className="page"><ServerDown onRetry={() => { void refreshSession() }} /></main></div>
  }
  if (s.status === 'off' || !s.cabinet) {
    return <div className="cab"><main className="page"><StaleNotice /></main></div>
  }
  if (!s.authenticated) return <Navigate to={loginRedirect(s, loc.pathname + loc.search)} replace />

  // Выгрузка очереди событий маршрута и стирание ключей маршрута — внутри
  // cabinetLogout (хуки route-lifecycle.ts). Навигацию делает охрана: снимок
  // станет «вышел».
  const logout = () => {
    setLogoutFailed(false)
    void cabinetLogout().then(ok => { if (!ok) setLogoutFailed(true) })
  }
  const ctx: CabinetCtx = { session: s, logout }
  const routeOn = cabinetRouteMarked()
  const count = routeOn ? routeDayCount(routeRead) : null
  // Маршрут начат — по общему чтению состояния вкладки (без своего запроса).
  const routeStarted = routeOn && !!routeRead && routeRead.result.ok && !!routeRead.result.data.started
  const onRoutePage = routeOn && (loc.pathname === '/app/route' || loc.pathname.startsWith('/app/route/'))

  return (
    <div className="cab">
      <div className="shell">
        <aside className="side">
          <CabBrand href="/" />
          <nav className="nav" aria-label="Кабинет">
            {NAV.map(({ to, end, label, Icon }) => (
              <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? 'on' : '')}>
                <Icon />{label}
                {to === '/app/route' && count && <span className="nav-cnt">{count.k} из {count.m}</span>}
                {to === '/app/knowledge' && routeOn && <span className="nav-beta">Бета</span>}
              </NavLink>
            ))}
          </nav>
          <div className="nav bottom">
            <button type="button" onClick={logout}><CabI.out />Выход</button>
          </div>
        </aside>
        <div className="main">
          <header className="topbar">
            <div className="tb-brand"><CabBrand href="/" /></div>
            {onRoutePage && (
              <span className="avail">
                <CabI.film />
                {routeStarted
                  ? <b>Доступно более 3 200 000 материалов для рекомендаций</b>
                  : <>Доступно: <b>более 6 000 материалов</b></>}
              </span>
            )}
            <KeyLine s={s} />
          </header>
          <main className="page">
            {logoutFailed && (
              <div className="msg err" role="alert" style={{ marginBottom: 24 }}><CabI.alert /><span>Не удалось выйти. Попробуйте ещё раз</span></div>
            )}
            {s.state === 'expired' && <ExpiredBar demo={s.demo} />}
            <Outlet context={ctx} />
            <HeardCheckHost />
          </main>
          <CabinetFooter />
        </div>
      </div>
      <nav className="tabbar" aria-label="Кабинет — разделы">
        {NAV.map(({ to, end, short, Icon }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? 'on' : '')}>
            <Icon />{short}
            {to === '/app/route' && count && <span className="tab-cnt">{count.k}/{count.m}</span>}
          </NavLink>
        ))}
      </nav>
      <ScrollTopButton />
    </div>
  )
}

// KeyLine — справа вверху: «Ключ активен до …» / «Демо до … · Продлите ключ —
// маршрут сохранится» и «Продлить». Бессрочный (не демо) ключ — без строки и
// без «Продлить». Истёкший — «Срок действия ключа закончился» и основная
// «Продлить». Полный ключ за 7 дней до конца — плашка «Ключ закончится через N
// дней, дата» с точкой и основная «Продлить» (навигация v2). У демо строка
// своя всегда: он короткий, плашка стояла бы у него постоянно.
function KeyLine({ s }: { s: SessionSnapshot }) {
  if (s.state === 'expired') {
    return (
      <>
        <span className="keyline">Срок действия ключа закончился</span>
        <a className="btn sm primary" href={RENEW_HREF}>Продлить</a>
      </>
    )
  }
  const soon = s.demo ? null : expirySoon(s.keyExpiresAt)
  if (soon) {
    return (
      <>
        <span className="keyline soon"><span className="dot" /><span>Ключ закончится через <b>{daysLabel(soon.days)}</b><span className="soon-date">, {soon.until}</span></span></span>
        <a className="btn sm primary" href={RENEW_HREF}>Продлить</a>
      </>
    )
  }
  const until = untilLong(s.keyExpiresAt)
  if (!until && !s.demo) return null
  return (
    <>
      {until && (
        <span className={'keyline' + (s.demo ? ' demo' : '')}>
          {s.demo
            ? <>Демо до <b>{until}</b><span className="demo-note">· Продлите ключ — маршрут сохранится</span></>
            : <>Ключ активен до <b>{until}</b></>}
        </span>
      )}
      <a className={'btn sm' + (s.demo ? ' primary' : '')} href={RENEW_HREF}>Продлить</a>
    </>
  )
}

// ExpiredBar — плашка истёкшего ключа на всех страницах кабинета (§3.8,
// §4.10): демо — утверждённый текст про сохранение маршрута.
function ExpiredBar({ demo }: { demo: boolean }) {
  return (
    <div className="demo-bar" role="status">
      <p>{demo ? 'Продлите свой демо-ключ — маршрут сохранится.' : 'Срок действия ключа закончился.'}</p>
      <a className="btn primary sm" href={RENEW_HREF}>Продлить</a>
    </div>
  )
}
