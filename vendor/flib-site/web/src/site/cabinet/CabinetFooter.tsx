// CabinetFooter.tsx — подвал на всех страницах кабинета (спека §3.8, дизайн).
// Все адреса — только из external-links.ts.
import { Link } from 'react-router-dom'
import {
  DOWNLOAD_PAGE_PATH, EXTENSION_PAGE_PATH, SUPPORT_BOT_URL, TELEGRAM_CHANNEL_HANDLE, TELEGRAM_CHANNEL_URL,
} from '../external-links'

export function CabinetFooter() {
  return (
    <footer className="foot">
      <span className="mono">Flibooster</span>
      <a href={SUPPORT_BOT_URL} target="_blank" rel="noopener noreferrer">Поддержка в Telegram</a>
      {/* /download.html отдаёт лендинг шлюза — полный переход, не SPA. */}
      <a href={DOWNLOAD_PAGE_PATH}>Скачать Flibooster</a>
      <Link to={EXTENSION_PAGE_PATH}>Расширение для браузера</Link>
      <a href={TELEGRAM_CHANNEL_URL} target="_blank" rel="noopener noreferrer">Канал @{TELEGRAM_CHANNEL_HANDLE}</a>
    </footer>
  )
}
