// ExtensionPage.tsx — /extension, установка расширения Flib-club из магазинов.
//
// Edge и браузеры на Chromium ставят расширение из Chrome Web Store: своей
// карточки в магазине Edge пока нет. Firefox получает ссылку, как только в
// external-links.ts появится FIREFOX_ADDON_URL.
import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { BrandMark } from './BrandMark'
import { CHROME_WEB_STORE_URL, EXTENSION_SOURCE_URL, FIREFOX_ADDON_URL } from './external-links'

interface BrowserOption {
  id: string
  title: string
  desc: string
  url: string | null
  action: string
  primary: boolean
}

const BROWSERS: BrowserOption[] = [
  {
    id: 'chrome', title: 'Chrome', primary: true,
    desc: 'Откройте страницу в Chrome Web Store и нажмите «Установить».',
    url: CHROME_WEB_STORE_URL, action: 'Открыть в Chrome Web Store',
  },
  {
    id: 'firefox', title: 'Firefox', primary: false,
    desc: 'Расширение для Firefox проверяет Mozilla. Ссылка появится здесь.',
    url: FIREFOX_ADDON_URL, action: 'Открыть в магазине Firefox',
  },
  {
    id: 'edge', title: 'Edge', primary: false,
    desc: 'Установка идёт из Chrome Web Store. Edge попросит разрешить расширения из других магазинов — разрешите.',
    url: CHROME_WEB_STORE_URL, action: 'Открыть в Chrome Web Store',
  },
  {
    id: 'chromium', title: 'Яндекс Браузер, Opera, Brave, Vivaldi', primary: false,
    desc: 'Эти браузеры тоже ставят расширения из Chrome Web Store. Если появится запрос на разрешение — подтвердите.',
    url: CHROME_WEB_STORE_URL, action: 'Открыть в Chrome Web Store',
  },
]

const AFTER_INSTALL = [
  'Словари (около 180 МБ) скачаются сами при первом запуске.',
  'Наведите мышь на слово с зажатым Shift — появится карточка с переводом.',
  'Карточки в Anki работают через дополнение AnkiConnect или приложение Flibooster.',
  'Примеры из YouTube и фильмов работают с личным ключом.',
]

export function ExtensionPage() {
  // Ссылка в подвале открывает страницу через роутер: без сброса она откроется
  // с позицией прокрутки лендинга.
  useEffect(() => { window.scrollTo(0, 0) }, [])

  return (
    <div className="site">
      <div className="view">
        <div className="page">
          <div className="page-topbar">
            <BrandMark />
            <Link className="back-link" to="/">← на главную</Link>
          </div>

          <div className="fork-head">
            <div className="eyebrow">Расширение для браузера</div>
            <h1>Flib-club — словарь на любой странице</h1>
            <p>Перевод при наведении, примеры из живой речи и карточки Anki в один клик. Выберите свой браузер.</p>
          </div>

          <div className="fork-cards ext-cards">
            {BROWSERS.map(b => {
              const body = (
                <>
                  <h3>{b.title}</h3>
                  <p>{b.desc}</p>
                </>
              )
              const cardClass = `fork-card ${b.primary ? 'primary' : ''}`
              if (!b.url) {
                return (
                  <div key={b.id} className={`${cardClass} ext-card-pending`}>
                    {body}
                    <span className="fc-time">На проверке</span>
                  </div>
                )
              }
              return (
                <a key={b.id} className={cardClass} href={b.url} target="_blank" rel="noopener noreferrer">
                  {body}
                  <span className={`btn ${b.primary ? 'btn-amber' : 'btn-ghost'}`}>{b.action}</span>
                </a>
              )
            })}
          </div>

          <div className="ext-after">
            <h2>После установки</h2>
            <ul>
              {AFTER_INSTALL.map(line => <li key={line}>{line}</li>)}
            </ul>
            <a className="mono faint" href={EXTENSION_SOURCE_URL} target="_blank" rel="noopener noreferrer">
              Открытый код на GitHub
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
