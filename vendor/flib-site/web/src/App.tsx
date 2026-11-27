import { Routes, Route, Navigate } from 'react-router-dom'
import { cabinetMarked } from './site/session'
import { cabinetRouteMarked } from './site/cabinet/route/route-storage'
import { useSession } from './site/useSession'
import { HomePage } from './site/HomePage'
import { LoginPage } from './site/LoginPage'
import { ForkPage } from './site/ForkPage'
import { TryPage } from './site/TryPage'
import { ImportPage } from './site/ImportPage'
import { TestPage } from './site/test-page/TestPage'
import { RoutePage } from './site/RoutePage'
import { ExtensionPage } from './site/ExtensionPage'
import { ModulesPage } from './site/ModulesPage'
import { ModulesUploadPage } from './site/ModulesUploadPage'
import { BuyPage } from './site/BuyPage'
import { OrderRoute } from './site/OrderPage'
import { RenewPage } from './site/RenewPage'
import { StartPage } from './pages/StartPage'
import { PlayerPage } from './pages/PlayerPage'
import { DebugShadowCard } from './pages/DebugShadowCard'
import { CabinetLayout } from './site/cabinet/CabinetLayout'
import { CabinetHome } from './site/cabinet/CabinetHome'
import { KnowledgePage } from './site/cabinet/knowledge/KnowledgePage'
import { PlacementPage } from './site/cabinet/placement/PlacementPage'
import { CabinetProfile } from './site/cabinet/CabinetProfile'
import { CabinetRouteGate } from './site/cabinet/route/RoutePageCabinet'
import { CabinetLessonGate } from './site/cabinet/route/WordsLessonPage'

// LegacyTestRoute — гостевой `/test` (адаптивный онбординг-тест воронки) остаётся для гостей; вошедшего в
// кабинет уводим на `/app/test` (тест уровня кабинета, спека placement-test Р-7). Пока снимок сессии
// грузится при включённом кабинете — ничего не рисуем, чтобы не мигнуть старым тестом.
function LegacyTestRoute() {
  const s = useSession()
  if (!cabinetMarked() || !cabinetRouteMarked()) return <TestPage />
  if (s.status === 'loading') return null
  if (s.status === 'ready' && s.authenticated) return <Navigate to="/app/test" replace />
  return <TestPage />
}

// App — маршрутная таблица сайта, вынесена из main.tsx (которое дальше просто
// монтирует <App/> в <BrowserRouter>). Причина выноса: main.tsx делает
// createRoot(...).render(...) как side effect самого импорта — его нельзя
// смонтировать в тесте под MemoryRouter. App — чистый компонент, поэтому
// router-smoke-тесты (site/__tests__/routes.test.tsx) рендерят его напрямую.
export function App() {
  return (
    <Routes>
      {/* «/» — лендинг со шлюза, его отдаёт сервер (BFF). Здесь только
          клиентский переход на главную, см. HomePage.tsx. */}
      <Route path="/" element={<HomePage />} />
      <Route path="/login" element={<LoginPage />} />
      {/* StartPage переехала с / на /start в Э0 (design-transfer) — код не менялся */}
      <Route path="/start" element={<StartPage />} />
      {/* Воронка (Э1): /fork, /try, /import — рабочие экраны. /route — маршрут
          (Э2), рабочий экран. /test — адаптивный онбординг-тест (Э4). */}
      <Route path="/fork" element={<ForkPage />} />
      <Route path="/try" element={<TryPage />} />
      <Route path="/import" element={<ImportPage />} />
      <Route path="/test" element={<LegacyTestRoute />} />
      <Route path="/route" element={<RoutePage />} />
      <Route path="/player" element={<PlayerPage />} />
      <Route path="/extension" element={<ExtensionPage />} />
      <Route path="/modules" element={<ModulesPage />} />
      <Route path="/modules/upload" element={<ModulesUploadPage />} />
      {/* Покупка доступа: /buy — тарифы и оплата, /order/:id — сюда ЮKassa
          возвращает после оплаты, здесь показывается ключ. */}
      <Route path="/buy" element={<BuyPage />} />
      <Route path="/order/:id" element={<OrderRoute />} />
      {/* Ссылка продления из письма (/renew#t=<токен>): обмен токена на заказ.
          Маршрут есть всегда: без писем сюда никто не попадает. */}
      <Route path="/renew" element={<RenewPage />} />
      {/* Кабинет (спека 2026-11-17 §3.8): охрана и каркас — CabinetLayout.
          Кабинет выключен — пусто, как без этих маршрутов. «Маршрут» до PR-B
          — «скоро». */}
      <Route path="/app" element={<CabinetLayout />}>
        <Route index element={<CabinetHome />} />
        {/* Маршрут (этап 2): без метки flib-route — «скоро», как до PR-B. */}
        <Route path="route" element={<CabinetRouteGate />} />
        {/* Урок слов (Д2, план B10f): без метки flib-route — на /app, как до PR-B. */}
        <Route path="route/words" element={<CabinetLessonGate />} />
        <Route path="knowledge" element={<KnowledgePage />} />
        <Route path="test" element={<PlacementPage />} />
        <Route path="profile" element={<CabinetProfile />} />
        <Route path="*" element={<Navigate to="/app" replace />} />
      </Route>
      {/* DEV-ONLY visual-QA route (accept #1 gate): no screenshot/state-forcing
          harness existed in this repo before this fix (confirmed by grep — no
          playwright/storybook/debug page/query-param seam anywhere), so the
          desktop-vs-web ShadowCard comparison had been done by manually running
          a real recording round-trip and cropping a screenshot by hand
          (reproducibility gap). `import.meta.env.DEV` is statically replaced
          with the literal `false` by Vite in production builds, so Rollup's
          dead-code-elimination drops the <Route> below (and, since nothing
          else references it, DebugShadowCard's module graph too) from dist/. */}
      {import.meta.env.DEV && <Route path="/debug/shadow-card" element={<DebugShadowCard />} />}
    </Routes>
  )
}
