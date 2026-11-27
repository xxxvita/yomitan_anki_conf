// RouteMessages.tsx — служебные экраны страницы маршрута (спека 2026-11-17 §4.3):
// нет права, ключ истёк, временный сбой (отсчёт), отказ шлюза, маршрут кончился.
// Тексты — из таблицы §4.3 дословно.
import { useEffect, useState } from 'react'
import { CabI } from '../cab-icons'
import { RENEW_HREF } from '../key-dates'
import { SUPPORT_BOT_HANDLE, SUPPORT_BOT_URL } from '../../external-links'

export function SupportLink() {
  return <a href={SUPPORT_BOT_URL} target="_blank" rel="noreferrer">@{SUPPORT_BOT_HANDLE}</a>
}

export function NoRouteRight() {
  return (
    <div className="msg warn" role="status"><CabI.alert />
      <span>Маршрут недоступен для этого ключа. Напишите в поддержку: <SupportLink /></span>
    </div>
  )
}

export function KeyExpired({ demo }: { demo: boolean }) {
  return (
    <div className="demo-bar" role="status">
      <p>{demo ? 'Продлите свой демо-ключ — маршрут сохранится' : 'Срок действия ключа закончился'}</p>
      <a className="btn primary sm" href={RENEW_HREF}>Продлить</a>
    </div>
  )
}

// useCountdown — секунды до момента `until` (Date.now), тик раз в секунду.
export function useCountdown(until: number | null): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (until === null) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [until])
  return until === null ? 0 : Math.max(0, Math.ceil((until - now) / 1000))
}

export function TemporaryDown({ until }: { until: number | null }) {
  const left = useCountdown(until)
  return (
    <div className="msg warn" role="status"><CabI.clock />
      <span>Маршрут временно недоступен. Повторим через {Math.max(1, left)} с</span>
    </div>
  )
}

// Banned — 429 route_banned / rate_limited с ожиданием: «продолжим в HH:MM» (§7 19).
export function Banned({ until }: { until: number }) {
  const d = new Date(until)
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return (
    <div className="msg warn" role="status"><CabI.clock />
      <span>Слишком много действий с маршрутом, продолжим в {hhmm}</span>
    </div>
  )
}

export function GatewayRefused() {
  return (
    <div className="msg err" role="alert"><CabI.alert />
      <span><span>Маршрут временно недоступен, мы уже знаем о проблеме</span>. <span>Поддержка: <SupportLink /></span></span>
    </div>
  )
}

export function RouteOver({ reason, onRestart, busy }: { reason: string; onRestart: () => void; busy: boolean }) {
  return (
    <div className="done-card">
      <h2>{reason === 'goal' ? 'Цель маршрута достигнута' : 'Материал для этой цели закончился'}</h2>
      <button type="button" className="btn primary" disabled={busy} onClick={onRestart}>Начать новый маршрут</button>
    </div>
  )
}
