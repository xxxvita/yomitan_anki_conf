// web/src/player/components/LeftRail.tsx — левое меню плеера v2 (дизайн
// владельца 2026-11-19 §4, docs/design/cabinet-2026-11-19/src/cab/cab-player.*).
//
// Меню 208 px, свёрнутое — 60 px (иконки с подсказкой title), «Свернуть» внизу;
// состояние помнится в localStorage (`flib:shell:railCollapsed`, тот же ключ, что
// у прежней рейки). Пункты:
//   • «Главная» — вошедшему при включённом кабинете на /app, гостю — как раньше на «/»;
//   • «Уведомления» — только вошедшему: бейдж непрочитанных и панель 320 px.
//     Сервера уведомлений нет — список выводится на клиенте (решение владельца
//     2026-11-19 п.2, site/cabinet/notifications.ts) из снимка сессии и
//     последнего удачного чтения состояния маршрута вкладки (своего запроса нет);
//   • «Улучшенные субтитры» — панель вместо прежнего окна: короткий текст, три
//     снимка приложения, «Скачать Flibooster».
// Панели — справа от меню; ≤ 1100 px — поверх содержимого; на телефоне — во весь
// экран. На телефоне (≤ 760 px) меню скрыто и выезжает по ☰ из верхней строки
// плеера (drawerOpen) с затемнением.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useSession } from '../../site/useSession'
import { cabinetMarked } from '../../site/session'
import { CabBrand, CabI } from '../../site/cabinet/cab-icons'
import { useLastRouteRead } from '../../site/cabinet/route/use-route-state'
import { learningDayOf, SITE_TRANSITION_MIN } from '../../site/cabinet/route/learning-day'
import { deriveNotifications, loadReadIds, markAllRead, type Notif } from '../../site/cabinet/notifications'
import shotYoutube from './app-shots/youtube.webp'
import shotShadowing from './app-shots/shadowing.webp'
import shotTranscript from './app-shots/transcript.webp'
import shotAudioBooth from './app-shots/audio-booth.webp'
import '../../site/cabinet/cabinet.css'
import './player-v2.css'

const RAIL_KEY = 'flib:shell:railCollapsed'
// Страница скачивания десктопного приложения Flibooster (улучшение субтитров
// живёт в приложении — голосовое ТЗ владельца 2026-07-16).
const FLIBOOSTER_DOWNLOAD_URL = '/download.html'

// Снимки приложения — те же, что на лендинге (internal/landing/assets/img,
// уменьшены в webp). Лежат в бандле SPA: путь /img/ BFF отдаёт лендингу.
const APP_SHOTS = [
  { src: shotShadowing, w: 1280, h: 670, alt: 'Плеер в приложении Flibooster: субтитры над видео и шкала реплик', caption: 'Плеер в приложении' },
  { src: shotTranscript, w: 1280, h: 655, alt: 'Раздел встречи с преподавателем в приложении Flibooster', caption: 'Раздел встречи с преподавателем' },
  { src: shotAudioBooth, w: 1200, h: 821, alt: 'Аудиокабинка в приложении Flibooster', caption: 'Аудиокабинка' },
  { src: shotYoutube, w: 1280, h: 617, alt: 'Избранные каналы Youtube в приложении Flibooster', caption: 'Избранные каналы Youtube' },
]

type Panel = 'notif' | 'subs'

export interface LeftRailProps {
  // drawerOpen — телефон: меню выехало по ☰ (верхняя строка плеера).
  drawerOpen?: boolean
  onDrawerClose?: () => void
}

export function LeftRail({ drawerOpen = false, onDrawerClose }: LeftRailProps = {}) {
  const navigate = useNavigate()
  // Снимок сессии кабинета (passive: запрос делает startSession в main.tsx).
  const session = useSession({ passive: true })
  const signedIn = cabinetMarked() && session.status === 'ready' && session.cabinet && session.authenticated
  const homeTarget = signedIn ? '/app' : '/'
  const [collapsed, setCollapsed] = useState<boolean>(
    () => { try { return localStorage.getItem(RAIL_KEY) === 'true' } catch { return false } },
  )
  const [panel, setPanel] = useState<Panel | null>(null)

  const routeRead = useLastRouteRead()
  const [readIds, setReadIds] = useState<Set<string>>(() => loadReadIds())
  const notifs: Notif[] = useMemo(
    () => (signedIn ? deriveNotifications({ session, read: routeRead, now: new Date(), today: learningDayOf(new Date(), SITE_TRANSITION_MIN) }) : []),
    [signedIn, session, routeRead],
  )
  const unread = notifs.filter(n => !readIds.has(n.id)).length

  const toggleCollapsed = useCallback(() => {
    setCollapsed((c) => { const n = !c; try { localStorage.setItem(RAIL_KEY, String(n)) } catch { /* хранилище недоступно */ } return n })
  }, [])
  const openPanel = (k: Panel) => { setPanel(p => (p === k ? null : k)); onDrawerClose?.() }

  // Escape закрывает панель (конвенция модалок проекта) и выехавшее меню.
  useEffect(() => {
    if (!panel && !drawerOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      setPanel(null)
      onDrawerClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [panel, drawerOpen, onDrawerClose])

  const items: Array<{ k: 'home' | Panel; id: string; label: string; Icon: typeof CabI.home; badge?: number; on: () => void }> = [
    { k: 'home', id: 'rail-home', label: 'Главная', Icon: CabI.home, on: () => { onDrawerClose?.(); navigate(homeTarget) } },
    ...(signedIn ? [{ k: 'notif' as const, id: 'rail-notifications', label: 'Уведомления', Icon: CabI.bell, badge: unread, on: () => openPanel('notif') }] : []),
    { k: 'subs', id: 'rail-pipeline', label: 'Улучшенные субтитры', Icon: CabI.cc, on: () => openPanel('subs') },
  ]
  const visiblePanel = panel === 'notif' && !signedIn ? null : panel

  return (
    <div className={'cab plv2' + (collapsed ? ' mini' : '')}>
      <aside className={'pl-rail' + (drawerOpen ? ' open' : '')} data-testid="left-rail" aria-label="Меню плеера">
        <div className="pl-brand">{collapsed ? <a className="brand" href="/" aria-label="FLIBOOSTER — главная страница" title="На главную страницу">F<b>B</b></a> : <CabBrand href="/" />}</div>
        <nav className="pl-nav">
          {items.map(({ k, id, label, Icon, badge, on }) => (
            <button key={id} type="button" data-testid={id} className={visiblePanel === k ? 'on' : ''}
              title={collapsed ? label : undefined} aria-label={label} onClick={on}>
              <span className="pl-ic"><Icon />{!!badge && badge > 0 && <i className="pl-badge">{badge}</i>}</span>
              <span className="pl-l">{label}</span>
            </button>
          ))}
        </nav>
        <button type="button" className="pl-collapse" onClick={toggleCollapsed} aria-label={collapsed ? 'Развернуть меню' : 'Свернуть меню'}>
          <CabI.left style={{ transform: collapsed ? 'rotate(180deg)' : 'none' }} /><span className="pl-l">Свернуть</span>
        </button>
      </aside>
      {drawerOpen && <div className="pl-scrim" onClick={() => onDrawerClose?.()} />}
      {visiblePanel && (
        <div className="pl-panel" data-testid={visiblePanel === 'notif' ? 'notifications-panel' : 'improve-subs-panel'}
          role="region" aria-label={visiblePanel === 'notif' ? 'Уведомления' : 'Улучшенные субтитры'}>
          <div className="pl-ph">
            <span className="serif">{visiblePanel === 'notif' ? 'Уведомления' : 'Улучшенные субтитры'}</span>
            <button type="button" className="btn sm icon" onClick={() => setPanel(null)} aria-label="Закрыть"><CabI.x /></button>
          </div>
          {visiblePanel === 'notif' && (notifs.length ? (
            <>
              <div className="nt-list">
                {notifs.map(n => (
                  <div key={n.id} className={'nt' + (readIds.has(n.id) ? '' : ' un')}>
                    <span className={'nt-k ' + n.kind}>{n.kind === 'day' ? <CabI.route /> : <CabI.clock />}</span>
                    <div className="nt-b">
                      <div className="nt-t">{n.title}</div>
                      <div className="nt-d">{n.desc}</div>
                      {n.kind === 'day'
                        ? <Link className="btn sm" to={n.action.href} onClick={() => setPanel(null)}>{n.action.label}</Link>
                        : <a className="btn sm" href={n.action.href}>{n.action.label}</a>}
                    </div>
                  </div>
                ))}
              </div>
              {unread > 0 && <button type="button" className="btn sm pl-readall" onClick={() => setReadIds(markAllRead(notifs))}>Отметить все прочитанными</button>}
            </>
          ) : (
            <div className="nt-empty">
              <CabI.bell />
              <p>Пока пусто.</p>
              <p className="mute">Здесь появятся готовый день маршрута и напоминание о сроке ключа.</p>
            </div>
          ))}
          {visiblePanel === 'subs' && (
            <div className="ps">
              <p>В программе Flibooster на ПК Вам доступно намного больше функций, чем это можно реализовать в Вашем браузере.</p>
              <ul className="ps-list">
                <li>С помощью специального модуля Вы сможете улучшить автоматические субтитры.</li>
                <li>Вы сможете проработать свои записанные в аудио и видео встречи с преподавателем в удобном кабинете.</li>
                <li>Расширить функционал программы, разработав свои модули с помощью ИИ или сами.</li>
                <li>Смотреть свою коллекцию видео с помощью нашего плеера, и прорабатывать навыки языка самостоятельно.</li>
                <li>В специальной «акустической» студии позаниматься запоминанием слов из Anki.</li>
              </ul>
              <p>Подробнее — на <a href={FLIBOOSTER_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer">странице скачивания</a>.</p>
              {/* Своего лайтбокса нет: клик открывает снимок целиком в новой вкладке. */}
              <ul className="ps-shots" aria-label="Как выглядит приложение Flibooster">
                {APP_SHOTS.map(s => (
                  <li key={s.src}>
                    <span className="ps-cap">{s.caption}</span>
                    <a href={s.src} target="_blank" rel="noopener noreferrer" title="Открыть снимок целиком">
                      <img src={s.src} alt={s.alt} width={s.w} height={s.h} loading="lazy" decoding="async" />
                    </a>
                  </li>
                ))}
              </ul>
              <a className="btn primary" href={FLIBOOSTER_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer">Скачать Flibooster</a>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
