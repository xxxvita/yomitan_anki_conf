// RouteStepBar.tsx — Э5 (план, docs/plan-2026-07-13-design-transfer.md):
// узкая полоса «шаг маршрута» в плеере + CTA «Отметить пройденным — дальше
// по маршруту». Дизайн-референс: над/под видео узкая полоса «шаг N
// маршрута» + внизу CTA (темп сознательно НЕ показываем — владелец, план
// «Открытые вопросы — ЗАКРЫТЫ» п.2, route-state.ts:9-12).
//
// feedback-2 п.1: подпись «После этого видео: +N слов» в CTA-ряду убрана —
// владелец («здесь не убрана дописал», транскрипт screencast3, 01:41–01:46):
// это был дубль числа, которое уже показано в rsb-info («+N слов» рядом с
// целью). Инфо-строка — единственный источник этого числа.
//
// САМОДОСТАТОЧНЫЙ компонент (минимально-инвазивное монтирование в хрупкий
// PlayerPage, план Э5): сам читает flib:route через loadRoute(), сам решает
// показываться ли — PlayerPage передаёт только stepId (из query route_step) и
// ничего не знает о модели маршрута. Нет маршрута / шаг не найден / шаг
// принадлежит ДРУГОМУ видео, чем открыто сейчас (`v` в URL) — рендерим null,
// плеер работает как обычный (без маршрута) — контракт задачи.
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { loadRoute, type RouteState } from '../../site/route-state'
// P-unplayable: markStepDone+saveRoute+navigate вынесены в advanceRouteStep
// (route-step-nav.ts) — UnplayableOverlay переиспользует тот же переход для
// своей кнопки «Пропустить шаг →», больше не дублируем логику в двух местах.
import { advanceRouteStep } from '../route-step-nav'
import { track } from '../../site/telemetry'
import './route-step-bar.css'

export function RouteStepBar({ stepId }: { stepId: string }) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const videoId = params.get('v') ?? ''
  const [route, setRoute] = useState<RouteState | null>(() => loadRoute())

  // CTA-переход на следующий шаг двигает `route_step`/`v` в URL БЕЗ ремаунта
  // PlayerPage (client-side navigate, тот же контейнер) — RouteStepBar
  // остаётся смонтированным между шагами, поэтому перечитываем localStorage
  // на каждую смену stepId, а не только один раз на mount.
  useEffect(() => {
    setRoute(loadRoute())
  }, [stepId])

  const step = route?.steps.find(s => s.id === stepId) ?? null

  if (!route || !step || step.videoId !== videoId) return null

  const idx = route.steps.findIndex(s => s.id === stepId)
  const n = idx + 1
  const total = route.steps.length

  function handleDone() {
    if (!route) return
    // step_completed (телеметрия): пользователь нажал «Отметить пройденным».
    // Только событие — НЕ трогаем localStorage-курсор (это делает advanceRouteStep).
    // «Пропустить шаг» из UnplayableOverlay идёт мимо этой кнопки и НЕ считается.
    track('step_completed', { video_id: videoId, route_goal: route.goalLabel, step_id: stepId, step_index: idx })
    const updated = advanceRouteStep(stepId, navigate)
    if (updated) setRoute(updated)
  }

  return (
    <div className="route-step-bar" role="region" aria-label="Шаг маршрута">
      <div className="rsb-info">
        Шаг {n} из {total} · {route.goalLabel}
        {step.newLemmas > 0 && <span className="rsb-lemmas"> · +{step.newLemmas} слов</span>}
      </div>
      {step.status === 'done' ? (
        <div className="rsb-cta-row">
          <span className="rsb-badge">✓ пройдено</span>
          <button type="button" className="rsb-link-btn" onClick={() => navigate('/route')}>
            К маршруту
          </button>
        </div>
      ) : (
        <div className="rsb-cta-row">
          <button type="button" className="rsb-cta" onClick={handleDone}>
            Отметить пройденным — дальше по маршруту →
          </button>
        </div>
      )}
    </div>
  )
}
