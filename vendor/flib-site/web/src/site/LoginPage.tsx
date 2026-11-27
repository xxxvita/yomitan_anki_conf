// LoginPage.tsx — /login (спека кабинета 2026-11-17 §3.6, §3.7).
//
// Режим задаёт метка BFF в index.html (`<meta name="flib-cabinet">`, только при
// CABINET_ENABLED=1; ревью A5–A8 C-2a, C-3):
//  - метки нет — прежнее окно сразу, ровно как до кабинета (LegacyLoginPage),
//    без ожидания GET /api/session; если фоновый снимок всё же скажет
//    cabinet:true (вкладка открыта до включения флага), окно сменится новым
//    (ревью R1-L2);
//  - метка есть — новое окно входа СРАЗУ, снимка не ждём (ревью раунда 1
//    R1-M1): с читаемой cookie BFF сам отвечает 302 в кабинет ещё до SPA.
//    Фоновый снимок с живой сессией уводит в кабинет (`next`, если он /app или
//    /app/…, иначе /app). Старого окна при метке нет никогда. Сервер говорит
//    «кабинет выключен» — «Страница устарела — обновите её».
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { LoginModal } from './LoginModal'
import { LoginForm, type LoginNotice } from './LoginForm'
import { loadAccess } from './access'
import { useUserState } from './useUserState'
import { useSession } from './useSession'
import { cabinetMarked } from './session'
import { StaleNotice } from './cabinet/ServerDown'

const NEXT_MAX = 512

// safeNext — то же правило, что у BFF (session.go safeLoginNext): ровно /app
// или /app/…, без управляющих символов и обратной косой черты; иначе /app.
export function safeNext(next: string | null): string {
  if (!next || next.length > NEXT_MAX || (next !== '/app' && !next.startsWith('/app/'))) return '/app'
  for (const ch of next) {
    const c = ch.charCodeAt(0)
    if (c < 0x20 || c === 0x7f || ch === '\\') return '/app'
  }
  return next
}

export function LoginPage() {
  const s = useSession()
  const cabinet = cabinetMarked() || (s.status === 'ready' && s.cabinet)
  return cabinet ? <CabinetLoginPage /> : <LegacyLoginPage />
}

function CabinetLoginPage() {
  const s = useSession()
  const loc = useLocation()
  const navigate = useNavigate()
  const q = new URLSearchParams(loc.search)
  const next = safeNext(q.get('next'))

  if (s.status === 'off' || (s.status === 'ready' && !s.cabinet)) {
    return <div className="cab cab-login"><main className="page"><StaleNotice /></main></div>
  }
  if (s.status === 'ready' && s.authenticated) return <Navigate to={next} replace />

  // Отозванный и заменённый ключ (reason invalid — подтверждённый 401) —
  // один текст §3.3 «Этот ключ больше не действует…» (ревью M-1).
  const r = q.get('reason')
  const notice: LoginNotice = r === 'logout' ? 'logout' : r === 'revoked' || r === 'invalid' ? 'revoked' : null
  return <LoginForm notice={notice} onSuccess={() => navigate(next, { replace: true })} />
}

// LegacyLoginPage — прежнее окно (кабинет выключен). Закрыли с доступом —
// продолжаем в приложении (есть маршрут → /route, нет → /try); закрыли без
// доступа — назад на главную.
function LegacyLoginPage() {
  const navigate = useNavigate()
  const user = useUserState()

  function handleClose() {
    if (loadAccess()) {
      navigate(user === 'returning' ? '/route' : '/try', { replace: true })
    } else {
      navigate('/', { replace: true })
    }
  }

  return (
    <div className="site">
      <LoginModal onClose={handleClose} />
    </div>
  )
}
