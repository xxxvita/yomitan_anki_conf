// cab-icons.tsx — линейные иконки кабинета 24×24, stroke 1.6 (дизайн владельца
// 2026-11-17, docs/design/cabinet-2026-11-17/src/cab/cab-kit.jsx, объект CabI).
// Перенесены только нужные; bell, cc и menu нарисованы по месту (в макете v2
// их пути не переданы).
import type { ReactNode, SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

function stroke(d: ReactNode) {
  return function Icon(p: IconProps) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...p}>{d}</svg>
    )
  }
}

export const CabI = {
  play: (p: IconProps) => <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" {...p}><path d="M7 4.5v15l13-7.5z" /></svg>,
  eye: stroke(<><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>),
  eyeOff: stroke(<><path d="M3 3l18 18" /><path d="M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.8 9.8 0 0 0 5.4-1.6" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>),
  home: stroke(<><path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10" /></>),
  route: stroke(<><circle cx="6" cy="19" r="2" /><circle cx="18" cy="5" r="2" /><path d="M8 19h8a3.5 3.5 0 0 0 0-7H8a3.5 3.5 0 0 1 0-7h8" /></>),
  book: stroke(<><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z" /><path d="M4 21V5" /><path d="M9 7h6" /></>),
  user: stroke(<><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></>),
  out: stroke(<><path d="M15 4h4v16h-4" /><path d="M10 8l-4 4 4 4" /><path d="M6 12h10" /></>),
  up: stroke(<><path d="M12 19V5" /><path d="M6 11l6-6 6 6" /></>),
  lock: stroke(<><rect x="5" y="11" width="14" height="10" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>),
  alert: stroke(<><circle cx="12" cy="12" r="9" /><path d="M12 7v6" /><path d="M12 16.5v.5" /></>),
  clock: stroke(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>),
  // маршрут (этап 2)
  left: stroke(<><path d="M19 12H5" /><path d="M11 6l-6 6 6 6" /></>),
  right: stroke(<><path d="M5 12h14" /><path d="M13 6l6 6-6 6" /></>),
  check: stroke(<path d="M5 12.5l4.5 4.5L19 7" />),
  swap: stroke(<><path d="M4 8h14l-3-3" /><path d="M20 16H6l3 3" /></>),
  like: stroke(<><path d="M7 11v9H4v-9z" /><path d="M7 11l4-7a2 2 0 0 1 2 2v4h6a2 2 0 0 1 2 2.3l-1.2 6A2 2 0 0 1 17.8 20H7" /></>),
  dislike: stroke(<><path d="M7 13V4H4v9z" /><path d="M7 13l4 7a2 2 0 0 0 2-2v-4h6a2 2 0 0 0 2-2.3l-1.2-6A2 2 0 0 0 17.8 4H7" /></>),
  search: stroke(<><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></>),
  chev: stroke(<path d="M6 9l6 6 6-6" />),
  cal: stroke(<><rect x="3" y="5" width="18" height="16" /><path d="M3 10h18M8 3v4M16 3v4" /></>),
  // навигация v2, старт маршрута v2, плеер v2 (дизайн 2026-11-19)
  film: stroke(<><rect x="3" y="4" width="18" height="16" /><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" /></>),
  x: stroke(<><path d="M6 6l12 12" /><path d="M18 6L6 18" /></>),
  upload: stroke(<><path d="M12 16V4" /><path d="M7 9l5-5 5 5" /><path d="M4 16v4h16v-4" /></>),
  bell: stroke(<><path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></>),
  cc: stroke(<><rect x="3" y="5" width="18" height="14" /><path d="M10.5 10.2a2.4 2.4 0 1 0 0 3.6M17 10.2a2.4 2.4 0 1 0 0 3.6" /></>),
  menu: stroke(<path d="M4 7h16M4 12h16M4 17h16" />),
  gear: stroke(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3.6 14H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10 3.6V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1.3z" /></>),
}

// CabBrand — логотип кабинета «FLIBOOSTER» с акцентным «BOOSTER» (как на лендинге).
// С href — ссылка (владелец 2026-11-19: логотип в кабинете ведёт на лендинг).
// Обычный <a>, НЕ роутерный Link: лендинг «/» отдаёт сервер (BFF), клиентский
// переход попал бы в HomePage и лишь потом перезагрузил страницу.
export function CabBrand({ href }: { href?: string } = {}) {
  if (href) {
    return <a className="brand" href={href} aria-label="FLIBOOSTER — главная страница" title="На главную страницу">FLI<b>BOOSTER</b></a>
  }
  return <div className="brand">FLI<b>BOOSTER</b></div>
}
