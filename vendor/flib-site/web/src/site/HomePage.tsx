// HomePage.tsx — маршрут «/» в SPA.
//
// С 2026-11-08 главная flib.club — лендинг (решение владельца). Его отдаёт
// сервер: BFF проксирует «/» на шлюз (internal/bff/landing.go), поэтому при
// обычной загрузке страницы SPA на «/» не попадает вовсе. Сюда приходит только
// КЛИЕНТСКИЙ переход на «/» — BrandMark, «← на главную», сброс маршрута:
// React Router на сервер не ходит, и без полной загрузки пользователь увидел
// бы пустой экран.
//
// Петля исключена построением: если SPA САМА была загружена на «/» (сервер
// отдал её вместо лендинга — dev-сервер Vite или неверная сборка), уходить на
// «/» снова бессмысленно, вместо этого показываем ссылку.
import { useEffect } from 'react'

const INITIAL_PATH = typeof window !== 'undefined' ? window.location.pathname : '/'

export function HomePage({
  initialPath = INITIAL_PATH,
  reload = () => window.location.replace('/'),
}: { initialPath?: string; reload?: () => void }) {
  const servedAsSPA = initialPath === '/'

  useEffect(() => {
    if (!servedAsSPA) reload()
  }, [servedAsSPA, reload])

  if (!servedAsSPA) return null
  return (
    <div className="site">
      <div className="view">
        <div className="page page-narrow">
          <h1>Flibooster</h1>
          <p><a href="https://info.flib.club/">Открыть главную страницу</a></p>
        </div>
      </div>
    </div>
  )
}
