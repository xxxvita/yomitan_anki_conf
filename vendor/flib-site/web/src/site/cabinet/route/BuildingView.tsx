// BuildingView.tsx — состояние «Подбор» (спека 2026-11-17 §4.3; вид — дизайн
// владельца 2026-11-19 §3b «Подбираем ролики»): полоса 4px, процент и «осталось
// около N минут» — оценка по прошедшему времени против 2 минут, до готовности
// никогда не 100 %; четыре шага по статусу задания обмена (waiting — шаг 2,
// claimed / processing — шаг 3, done — шаг 4); плашка «Первый подбор может
// занять до 2 минут…». Шаги и эта плашка — только у ПЕРВОГО подбора (дня ещё
// нет); у следующих — утверждённый текст спеки «Подбираем рекомендации на
// сегодня…» без шагов «первого дня».
// Зависший обмен (§4.6 п.6: старше 10 мин) — «Подобрать заново»; ожидание по
// Retry-After — отсчёт (§4.6 п.5).
import { useEffect, useRef, useState } from 'react'
import type { ExchangePhase } from './exchange-machine'
import { Banned, TemporaryDown } from './RouteMessages'
import { CabI } from '../cab-icons'
import { minutesLeftLabel, pickProgress, pickStep, PICK_STEPS } from './start-model'
import './route-start.css'

export const FIRST_PICK_NOTE = 'Первый подбор может занять до 2 минут. Страницу можно закрыть — маршрут будет ждать здесь.'
export const PICK_NOTE = 'Подбираем рекомендации на сегодня. Страницу можно закрыть — маршрут сохранится'

export interface BuildingViewProps {
  phase: ExchangePhase | null
  stuck: boolean
  onRestart: () => void
  // first — первый подбор маршрута (дня ещё нет).
  first?: boolean
  // status — статус задания обмена (опрос или active_exchange состояния).
  status?: string | null
  // since — когда начался подбор (created_at активного обмена), мс; нет — с показа экрана.
  since?: number | null
}

export function BuildingView({ phase, stuck, onRestart, first = false, status = null, since = null }: BuildingViewProps) {
  const mounted = useRef(Date.now())
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const start = since !== null && Number.isFinite(since) ? Math.min(since, mounted.current) : mounted.current
  const { pct, minutesLeft } = pickProgress(now - start)
  const step = pickStep(status)
  return (
    <div className="pk" data-testid="route-building">
      <h1 className="serif">Подбираем <em>ролики</em></h1>
      <div className="pk-bar" role="progressbar" aria-label="Подбор роликов" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <i style={{ width: `${pct}%` }} />
      </div>
      <div className="pk-meta"><span>{pct}%</span><span>{minutesLeftLabel(minutesLeft)}</span></div>
      {first && (
        <ol className="pk-steps">
          {PICK_STEPS.map((t, i) => (
            <li key={t} className={i < step ? 'done' : i === step ? 'cur' : ''} aria-current={i === step ? 'step' : undefined}>
              {i < step ? <CabI.check /> : i === step ? <span className="spin2" /> : <i />}
              {t}
            </li>
          ))}
        </ol>
      )}
      <div className="pk-note"><CabI.clock /><span>{first ? FIRST_PICK_NOTE : PICK_NOTE}</span></div>
      {phase?.kind === 'cooldown' && <CooldownLine phase={phase} />}
      {stuck && <div><button type="button" className="btn primary" onClick={onRestart}>Подобрать заново</button></div>}
    </div>
  )
}

export function CooldownLine({ phase }: { phase: Extract<ExchangePhase, { kind: 'cooldown' }> }) {
  // «продолжим в HH:MM» — только бан маршрута (§7 случай 19); прочее — отсчёт (§4.6 п.5).
  if (phase.code === 'route_banned') return <Banned until={phase.until} />
  return <TemporaryDown until={phase.until} />
}
