import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import './fonts.css'
import './dusk-tokens.css'
import './app.css'
import './site/site-fonts'
import './site/site-theme.css'
import { applyBrandTitle } from './site/brand'
import { startSession } from './site/session'
import { redirectToHttpsIfNeeded } from './site/https-upgrade'
import { startRouteRuntime } from './site/cabinet/route/route-lifecycle'

// Кабинет включён, а страница открыта по http:// (не петля) — сразу на https,
// ничего не показывая: на http вход не работает (финальное ревью F-2).
if (!redirectToHttpsIfNeeded()) {
  // Вкладка на flibooster.ru — «Flibooster — …» (index.html держит flib.club).
  applyBrandTitle()

  // Снимок сессии кабинета, канал вкладок и перенос старого ключа (спека
  // 2026-11-17 §3.6). Не ждём: страницы читают снимок по подписке.
  void startSession()
  // Очередь событий маршрута кабинета — только при метке маршрута в index.html.
  startRouteRuntime()

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  )
}
