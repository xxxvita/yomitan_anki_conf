// route-lifecycle.ts — запуск очереди событий маршрута во вкладке (план B6).
//
// Только при метке маршрута в index.html (CABINET_ROUTE_ENABLED): без неё
// ничего не делает, и «Выход» остаётся прежним. С меткой:
//   • КАЖДЫЙ подтверждённый снимок активной сессии — `resume()` (не только переход:
//     продление ключа биллингом сообщения о входе не шлёт, и снимок может так и не
//     покинуть active — повторное ревью R-M3): очередь снова принимает и шлёт события
//     после «Выхода» и нового входа (closed) и после продления ключа, истёкшего с
//     403 (halted). Отказ 401/403 сам перечитывает сессию (outbox.ts, onAuthRefused);
//   • вышли (здесь или в другой вкладке) — `forget()`: буфер вкладки сброшен,
//     таймеры стоят, очередь ЗАКРЫТА до следующего входа — открытый в этой вкладке
//     плеер не воскрешает стёртые ключи (ревью C1);
//   • «Выход» этой вкладки — выгрузка ≤ 2 с до DELETE, после удачного выхода —
//     стирание ключей маршрута (session.ts → setLogoutHooks);
//   • коммит обмена или сброс в любой вкладке (`BroadcastChannel('flib-route')`)
//     снимает удержание `queue_full` и здесь (ревью L3).
import { getSession, isActiveSession, setLogoutHooks, subscribeSession } from '../../session'
import { getRouteOutbox } from './outbox'
import { cabinetRouteMarked } from './route-storage'

let started = false

export function startRouteRuntime(): void {
  if (started || !cabinetRouteMarked()) return
  started = true
  const box = getRouteOutbox()
  setLogoutHooks({ beforeLogout: () => box.logoutFlush(), afterLogout: () => box.eraseAfterLogout() })
  try {
    if (typeof BroadcastChannel === 'function') {
      const ch = new BroadcastChannel('flib-route')
      ch.onmessage = () => box.onExchangeCommitted()
    }
  } catch { /* канал недоступен — удержание снимет коммит этой вкладки */ }
  let stop: (() => void) | null = null
  const apply = () => {
    const s = getSession()
    if (isActiveSession(s)) {
      box.resume()
      if (!stop) stop = box.start()
      return
    }
    if (s.status === 'ready' && !s.authenticated) {
      stop?.()
      stop = null
      box.forget()
    }
  }
  subscribeSession(apply)
  apply()
}

export function __resetRouteRuntimeForTests(): void { started = false }
