// useUserState.ts — состояние "новый / вернувшийся" посетитель.
//
// Порт прототипа: в temp/flib/app.jsx это был ручной toggle (setUser
// 'new'|'returning' кнопками state-toggle, дев-инструмент для показа
// дизайнеру обоих состояний). В проде переключателя нет — состояние
// выводится из наличия ключа localStorage 'flib:route' (маршрут, который
// Э2 будет туда класть целиком, см. docs/plan-2026-07-13-design-transfer.md
// «Архитектурные решения» п.4): есть маршрут → «вернувшийся», нет → «новый».
import { useEffect, useState } from 'react'

export type UserState = 'new' | 'returning'

const ROUTE_KEY = 'flib:route'

function readUserState(): UserState {
  try {
    return window.localStorage.getItem(ROUTE_KEY) !== null ? 'returning' : 'new'
  } catch {
    // localStorage недоступен (приватный режим, заблокированные cookies/storage
    // в некоторых браузерах бросают на любой доступ) — по умолчанию «новый».
    return 'new'
  }
}

export function useUserState(): UserState {
  const [user, setUser] = useState<UserState>(readUserState)

  useEffect(() => {
    // 'storage' стреляет только в других вкладках того же origin, но это
    // дёшево и держит шапку в согласии, если маршрут появился/пропал там.
    const onStorage = () => setUser(readUserState())
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  return user
}
