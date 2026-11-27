// Блок «Маршрут» под результатом (спека §4): слова принятого прогона уходят в профиль маршрута.
// working → done / failed («Повторить») / declined («Учесть слова теста»); кнопка к маршруту:
// «Выбрать цель и начать маршрут» (маршрут не начат) или «К маршруту».
import { Link } from 'react-router-dom'
import { useRouteState } from '../../route/use-route-state'
import { t, type Lang } from '../i18n'
import { isValidRun } from '../store'

export type ApplyUi =
  | { k: 'idle' }
  | { k: 'working' }
  | { k: 'done'; counted: number }
  | { k: 'failed' }
  | { k: 'declined' }

export function RouteBlock({ lang, state, flags = [], onApply }: { lang: Lang; state: ApplyUi; flags?: readonly string[]; onApply: (force: boolean) => void }) {
  const valid = isValidRun(flags)
  const floor = flags.includes('floor') && !flags.includes('no_audio')
  const rs = useRouteState()
  const st = rs.read && rs.read.result.ok ? rs.read.result.data : null
  // «Выбрать цель…» — только когда достоверно известно, что маршрут не начат; нет ответа — «К маршруту».
  const notStarted = !!st && !st.started
  return (
    <div className="pt-route" data-testid="pt-route">
      <div aria-live="polite">
        {state.k === 'working' && <p className="pt-muted">{t(lang, 'pt.route.working')}</p>}
        {state.k === 'done' && state.counted > 0 && (
          <>
            <p className="pt-ok">{t(lang, 'pt.route.done')}</p>
            {<p className="pt-muted">{t(lang, 'pt.route.counted', { n: state.counted })}</p>}
          </>
        )}
        {/* Неточный/пустой прогон без слов в профиле: маршрут его слова не использует (floor — свой текст). */}
        {state.k === 'done' && !valid && state.counted === 0 && (
          <p className="pt-muted">{t(lang, floor && notStarted ? 'pt.route.floor' : 'pt.route.inexact')}</p>
        )}
        {/* Применён раньше, число слов неизвестно: без обещаний. */}
        {state.k === 'idle' && !valid && !floor && <p className="pt-muted">{t(lang, 'pt.route.inexact_short')}</p>}
        {state.k === 'failed' && <p className="pt-warn">{t(lang, 'pt.route.failed')}</p>}
        {state.k === 'declined' && <p className="pt-warn">{t(lang, 'pt.route.declined')}</p>}
      </div>
      <div className="pt-actions">
        {state.k === 'failed' && <button type="button" className="pt-primary" onClick={() => onApply(false)}>{t(lang, 'pt.route.retry')}</button>}
        {state.k === 'declined' && <button type="button" className="pt-primary" onClick={() => onApply(true)}>{t(lang, 'pt.route.apply')}</button>}
        <Link className={'pt-linkbtn' + (state.k === 'failed' || state.k === 'declined' ? '' : ' pt-primary')} to="/app/route">{t(lang, notStarted ? 'pt.route.start' : 'pt.route.open')}</Link>
      </div>
    </div>
  )
}
