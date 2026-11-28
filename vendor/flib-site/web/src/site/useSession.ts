// useSession.ts — снимок сессии кабинета для React (site/session.ts).
// Подписка на общий снимок модуля: обновление в одной точке (вход, выход,
// канал вкладок, возврат на вкладку) перерисовывает всех читателей.
//
// passive: только подписка, без запроса — для плеера, где снимок нужен лишь
// затем, чтобы гейт Shadowing перерисовался, когда ответ придёт (запрос делает
// startSession в main.tsx).
import { useEffect, useSyncExternalStore } from 'react'
import { ensureSession, getSession, subscribeSession, type SessionSnapshot } from './session'

export function useSession(opts: { passive?: boolean } = {}): SessionSnapshot {
  const s = useSyncExternalStore(subscribeSession, getSession, getSession)
  const passive = opts.passive === true
  useEffect(() => {
    if (!passive && s.status === 'loading') void ensureSession()
  }, [s.status, passive])
  return s
}
