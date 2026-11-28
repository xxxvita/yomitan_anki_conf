// access.ts — Shadowing-гейт (Э6, docs/plan-2026-07-13-design-transfer.md,
// «Архитектурные решения» п.6): состояние доступа ключа, закешированное с
// бэка (`POST /api/access` → internal/bff/access.go → gateway
// `GET /v1/me/access`). Персистится в localStorage — избавляет от повторного
// сетевого похода на каждый рендер шапки/кнопки Шадоуинг в плеере
// (web/src/player/shadow-access.ts читает тот же ключ независимо, без
// общего state-менеджера между /site и /player деревьями).
//
// САМ КЛЮЧ (flib:tpk) хранится ОТДЕЛЬНО от access-снапшота. Он не нужен для
// рендера (только keyPrefix нужен) — держим его ради будущего перевода WS
// shadowing-стрима с сервисного ключа на ключ пользователя (план, Э6:
// "перевод WS на ключ пользователя — follow-up, НЕ делать сейчас"); когда
// это будет сделано, WS-хук достанет ключ отсюда, а не будет просить
// пользователя вводить его заново.
const ACCESS_KEY = 'flib:access'
const TPK_KEY = 'flib:tpk'

export interface AccessState {
  shadowing: boolean
  keyPrefix: string
  checkedAt: string
}

export function saveAccess(state: AccessState): void {
  try {
    window.localStorage.setItem(ACCESS_KEY, JSON.stringify(state))
  } catch {
    // localStorage недоступен (приватный режим/заблокированное хранилище) —
    // не роняем UI; следующий loadAccess() просто не найдёт запись
    // (fail-closed: см. shadow-access.ts — дефолт без записи = доступа нет).
  }
}

// loadAccess — валидирует форму, а не просто "JSON распарсился" (тот же
// принцип, что pointA.ts loadPointA): чужая схема/мусор в этом ключе не
// должны притвориться валидным access-снапшотом и включить Shadowing по
// ошибке.
export function loadAccess(): AccessState | null {
  try {
    const raw = window.localStorage.getItem(ACCESS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (
      parsed &&
      typeof parsed.shadowing === 'boolean' &&
      typeof parsed.keyPrefix === 'string' &&
      typeof parsed.checkedAt === 'string'
    ) {
      return parsed as AccessState
    }
    return null
  } catch {
    return null
  }
}

export function clearAccess(): void {
  try {
    window.localStorage.removeItem(ACCESS_KEY)
    window.localStorage.removeItem(TPK_KEY)
  } catch {
    // no-op — см. комментарий в saveAccess.
  }
}

// loadKey — сохранённый после успешного «Войти» ключ пользователя (или null).
// Формат проверяется тем же шаблоном, что и на бэке: мусор в localStorage
// не должен уходить в запрос.
export function loadKey(): string | null {
  try {
    const raw = window.localStorage.getItem(TPK_KEY)
    return raw && /^tpk_[0-9a-f]{32}$/.test(raw) ? raw : null
  } catch {
    return null
  }
}

function saveKey(key: string): void {
  try {
    window.localStorage.setItem(TPK_KEY, key)
  } catch {
    // no-op
  }
}

export interface CheckAccessResult {
  /** true — бэк ответил (200), независимо от valid. false — сетевая/5xx ошибка (см. error). */
  ok: boolean
  valid: boolean
  shadowing: boolean
  keyPrefix: string
  error?: string
}

// checkAccess — POST /api/access {key} (см. internal/bff/access.go). При
// valid=true сохраняет и access-снапшот, и сырой ключ (см. комментарий у
// TPK_KEY выше). Сетевая/5xx ошибка НЕ трогает уже сохранённое состояние —
// UI (LoginModal) сам решает, что показать при ok:false, старый чип в шапке
// не гаснет из-за временного сбоя бэка.
export async function checkAccess(key: string): Promise<CheckAccessResult> {
  let resp: Response
  try {
    resp = await fetch('/api/access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
    })
  } catch {
    return { ok: false, valid: false, shadowing: false, keyPrefix: '', error: 'network' }
  }
  if (!resp.ok) {
    // 400 (bad format) или 502 (gateway_unavailable) — не "невалидный
    // ключ", а "не смогли проверить" (штатный невалидный ключ — это 200
    // {valid:false} на самом /api/access).
    return { ok: false, valid: false, shadowing: false, keyPrefix: '', error: `http_${resp.status}` }
  }
  let body: { valid?: boolean; shadowing?: boolean; key_prefix?: string }
  try {
    body = await resp.json()
  } catch {
    return { ok: false, valid: false, shadowing: false, keyPrefix: '', error: 'bad_response' }
  }
  const valid = body.valid === true
  const shadowing = body.shadowing === true
  const keyPrefix = body.key_prefix ?? ''
  if (valid) {
    saveAccess({ shadowing, keyPrefix, checkedAt: new Date().toISOString() })
    saveKey(key)
  }
  return { ok: true, valid, shadowing, keyPrefix }
}
