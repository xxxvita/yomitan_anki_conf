// RouteEndCard.tsx — карточка конца ролика в маршруте (спека 2026-11-17 §4.7,
// §4.12 элемент 11; план B9; макет `cab-route.jsx:334-361`). Вариант решает
// состояние, уже полученное плеером для гейта `rp`:
//   • 'next' — маршрутный режим подтверждён и `next_clip` есть: «Дальше в
//     маршруте» + `next_clip.title` (ЕДИНСТВЕННОЕ место, где показывается название
//     невыданного ролика; нет названия — «Следующий ролик») [Следующий ролик →]
//     [Посмотреть заново] [К маршруту];
//   • 'done' — подтверждён, `next_clip = null`: «На сегодня всё — до завтра»
//     [Посмотреть заново] [← К маршруту];
//   • 'back' — открыт со страницы маршрута не в маршрутном режиме (back=route,
//     rc, rx — дополнительное видео, или rp, не подтвердившийся): [Посмотреть заново]
//     [← К маршруту]; у rx «Следующий ролик» нет, название следующего не показывается.
// Гость без rp и back — карточки нет (её не монтирует PlayerPage).
import { Link } from 'react-router-dom'
import './route-end-card.css'

export type EndCardVariant = 'next' | 'done' | 'back'

export interface RouteEndCardProps {
  variant: EndCardVariant
  nextTitle?: string
  routeHref: string
  busy?: boolean
  /** Ролик прослушан (тот же признак, что у гейта субтитров): только подсветка кнопки, не доступность. */
  listened?: boolean
  onNext: () => void
  onReplay: () => void
}

export function RouteEndCard({ variant, nextTitle, routeHref, busy, listened, onNext, onReplay }: RouteEndCardProps) {
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation()
  return (
    <div className="route-end-card" data-testid="route-end-card" onClick={stop} onMouseDown={stop} onPointerDown={stop}>
      {variant === 'next' && (
        <>
          <span className="rec-mono">Дальше в маршруте</span>
          <h2>{nextTitle || 'Следующий ролик'}</h2>
          <div className="rec-row">
            <button type="button" className={listened ? 'rec-btn primary' : 'rec-btn'} disabled={busy} onClick={onNext}
              title={listened ? 'Ролик прослушан — перейти к следующему ролику' : 'Перейти к следующему ролику, не дослушав этот'}>Следующий ролик →</button>
            <button type="button" className="rec-btn" onClick={onReplay}>Посмотреть заново</button>
            <Link className="rec-btn" to={routeHref}>К маршруту</Link>
          </div>
        </>
      )}
      {variant === 'done' && (
        <>
          <span className="rec-mono ok">Ролик просмотрен</span>
          <h2>На сегодня всё — <em>до завтра</em></h2>
          <div className="rec-row">
            <button type="button" className="rec-btn" onClick={onReplay}>Посмотреть заново</button>
            <Link className="rec-btn primary" to={routeHref}>← К маршруту</Link>
          </div>
        </>
      )}
      {variant === 'back' && (
        <>
          <span className="rec-mono">Ролик просмотрен</span>
          <div className="rec-row">
            <button type="button" className="rec-btn" onClick={onReplay}>Посмотреть заново</button>
            <Link className="rec-btn primary" to={routeHref}>← К маршруту</Link>
          </div>
        </>
      )}
    </div>
  )
}
