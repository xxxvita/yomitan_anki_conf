// CabinetHome.tsx — Главная кабинета (спека §3.8, §4.12 «Главная»; дизайн
// «Главная»; решения владельца 2026-11-18): «Здравствуйте, <имя>!» — имя из
// профиля (нет имени или любой сбой — просто «Здравствуйте!»), плашка
// демо-ключа, «Сегодня в маршруте», «Новости и подсказки» с пометками
// «Заготовка», «Достижения» — заголовок с меткой «скоро», без цифр и карточек.
//
// «Сегодня в маршруте» (план B10e): при метке маршрута (`flib-route`) и активном
// ключе с правом маршрута — сводка дня из ОБЩЕГО запроса состояния вкладки (B7);
// иначе — заготовка этапа 0 («скоро», как до PR-B): ни одного запроса маршрута.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useCabinet } from './CabinetLayout'
import { RENEW_HREF, untilLong } from './key-dates'
import { cabinetRouteMarked } from './route/route-storage'
import { useRouteState } from './route/use-route-state'
import { buildDayModel } from './route/day-model'
import { localDayInputs } from './route/local-inputs'
import { homeSummary } from './route/home-model'
import { dayLabel } from './route/DayView'
import { learningDayOf, savedDayTransition } from './route/learning-day'
import { CabI } from './cab-icons'
import { PlacementHomeCard } from './PlacementHomeCard'
import { placementGate } from './placement-entry'
import './route/route.css'
import { plural } from '../plural'
import { cachedProfileName, profileApi, profileIdent, setProfileNameCache } from './profile-api'

// Имя из профиля для приветствия; любой сбой, выключенная ось, нет имени — null
// (обычное приветствие, без сообщений об ошибке). Привязано к ключу сессии (смена
// ключа не оставляет чужого имени) и кэшируется на 60 с на ключ.
function useProfileName(ident: string): string | null {
  const [st, setSt] = useState<{ ident: string; name: string | null } | null>(() => {
    const c = cachedProfileName(ident)
    return c ? { ident, name: c.name } : null
  })
  useEffect(() => {
    const c = cachedProfileName(ident)
    if (c) { setSt({ ident, name: c.name }); return }
    let alive = true
    void profileApi.get().then(r => {
      // Отрицательный исход («нет имени», ось выключена, сбой) тоже кэшируем на 60 с.
      const n = r.ok && r.data?.available === true ? r.data.contact?.name : null
      const name = typeof n === 'string' && n.trim() !== '' ? n.trim() : null
      setProfileNameCache(ident, name)
      if (alive) setSt({ ident, name })
    }).catch(() => undefined)
    return () => { alive = false }
  }, [ident])
  return st && st.ident === ident ? st.name : null
}

export function CabinetHome() {
  const { session: s } = useCabinet()
  const profileName = useProfileName(profileIdent(s))
  const until = untilLong(s.keyExpiresAt)
  const demoActive = s.demo && s.state !== 'expired'
  return (
    <>
      <div className="ph">
        <span className="mono">Главная</span>
        <h1 style={{ overflowWrap: 'anywhere' }}>{profileName ? `Здравствуйте, ${profileName}!` : 'Здравствуйте!'}</h1>
      </div>
      {demoActive && (
        <div className="demo-bar">
          <p>{until ? `Демо до ${until}. Продлите ключ — маршрут сохранится.` : 'Продлите свой демо-ключ — маршрут сохранится.'}</p>
          <a className="btn primary sm" href={RENEW_HREF}>Продлить</a>
        </div>
      )}
      {placementGate(s) && <PlacementHomeCard />}
      <div className="home-grid">
        {cabinetRouteMarked() && s.state === 'active' && s.routeAllowed ? <TodayInRoute /> : <TodaySoon />}
        <section className="panel news"><div className="panel-in">
          <div className="sec-h"><span className="mono">Новости и подсказки</span></div>
          <ul>
            <li><span className="stub">Заготовка</span><br />Нажмите на слово в субтитрах, чтобы увидеть перевод. Маршрут учтёт, что Вы переводили.</li>
            <li>Загрузите в «Мои знания» то, что уже понимаете, — рекомендации станут точнее.</li>
          </ul>
        </div></section>
      </div>
      <section className="ach" aria-label="Достижения">
        <div className="sec-h" style={{ marginBottom: 0 }}><span className="dot" /><span className="mono">Достижения</span><span className="tag acc">Скоро</span></div>
      </section>
    </>
  )
}

function TodaySoon() {
  return (
    <section className="panel today-card"><div className="panel-in">
      <div className="sec-h"><span className="dot" /><span className="mono">Сегодня в маршруте</span><span className="tag acc">Скоро</span></div>
      <div className="count">Маршрут по дням — <em>скоро</em></div>
      <Link className="btn" to="/app/route">Перейти к маршруту</Link>
    </div></section>
  )
}

// TodayInRoute — сводка дня (§4.12 «Главная»). Нет дня (маршрут не начат, «начат,
// дня нет», ответ ещё не пришёл или сбой) — только «Открыть маршрут».
function TodayInRoute() {
  const rs = useRouteState()
  const read = rs.read
  const st = read && read.result.ok ? read.result.data : null
  const head = (date?: string) => (
    <div className="sec-h"><span className="dot" /><span className="mono">{date ? `Сегодня в маршруте · ${dayLabel(date)}` : 'Сегодня в маршруте'}</span></div>
  )
  if (!st || !st.started || !st.day) {
    return (
      <section className="panel today-card" data-testid="home-today"><div className="panel-in">
        {head()}
        {!read && <span className="hero-wait" aria-busy="true"><span className="spin" /></span>}
        <Link className="btn" to="/app/route">Открыть маршрут</Link>
      </div></section>
    )
  }
  const model = buildDayModel(st, localDayInputs(st, read!.sent))
  const today = learningDayOf(new Date(), savedDayTransition())
  const sum = homeSummary(st, model, today)
  const n = sum.next
  return (
    <section className="panel today-card" data-testid="home-today"><div className="panel-in">
      {head(st.day.date)}
      <div className="count">{model.total} {plural(model.total, 'ролик', 'ролика', 'роликов')}, <em>{model.watchedCount} из {model.total}</em></div>
      <div className="segs" data-testid="home-segs">{sum.segs.map((g, i) => <i key={i} className={g} />)}</div>
      {n.kind === 'done' && <>
        <div className="up-next"><span className="t">На сегодня всё — до завтра.</span></div>
        <Link className="btn" to="/app/route">Открыть маршрут</Link>
      </>}
      {n.kind === 'clip' && <>
        <div className="up-next"><span className="mono">Дальше</span><span className="t">{n.title}</span></div>
        <Link className="btn primary" to={n.href}><CabI.play />Продолжить маршрут</Link>
      </>}
      {n.kind === 'lesson' && <>
        <div className="up-next"><span className="t">Дальше: урок слов</span></div>
        <Link className="btn primary" to={n.href}>Продолжить маршрут</Link>
      </>}
      {n.kind === 'next' && <>
        <div className="up-next"><span className="t">Дальше: следующий ролик</span></div>
        <Link className="btn primary" to={n.href}>Продолжить маршрут</Link>
      </>}
      {n.kind === 'new_day' && <Link className="btn primary" to="/app/route">Получить ролики на сегодня</Link>}
      {n.kind === 'start_day' && <Link className="btn primary" to="/app/route">Начать день</Link>}
    </div></section>
  )
}
