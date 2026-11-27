// BrandMark.tsx — логотип-домой, доступен на всех .site-экранах.
//
// Порт temp/flib/parts.jsx:100-115. В прототипе это был div с onClick/
// role="link"/ручным keydown-обработчиком (workaround вокруг того, что
// window.* нет нормального роутера). Здесь есть react-router — просто
// <Link to="/">, ведёт себя как ссылка "из коробки" (Enter/клик/middle-click/
// открыть в новой вкладке), без ручного confirm() из прототипа.
//
// Подпись — бренд по домену (siteBrand, решение владельца 2026-11-17):
// «Flibooster» на flibooster.ru, «flib.club» на остальных.
import { Link } from 'react-router-dom'
import { siteBrand } from './brand'

interface BrandMarkProps {
  /** Компактный вариант — только значок, без подписи бренда. */
  quiet?: boolean
  /** Фиксированная подпись вместо бренда по домену (страница покупки: «FLIBOOSTER»). */
  label?: string
}

export function BrandMark({ quiet = false, label }: BrandMarkProps) {
  return (
    <Link className={`brandmark${quiet ? ' quiet' : ''}`} to="/" title="На главную">
      <div className="logo">F</div>
      {!quiet && <span className="nm">{label ?? siteBrand()}</span>}
    </Link>
  )
}
