// profile-api.ts — клиент «Профиля» кабинета: /api/me/profile, /api/me/profile/email,
// /api/me/erase-request (BFF → /v1/me/* шлюза ключом пользователя из cookie).
// Почта и имя — персональные данные: живут только в состоянии компонента; ни в
// URL, ни в хранилищах браузера, ни в консоли. 401 сессии — как на других
// страницах кабинета: перечитать снимок, охрана уведёт на вход.
import { apiCall, type ApiError, type ApiResult } from './route/route-api'
import { refreshSession, type SessionSnapshot } from '../session'
import { SUPPORT_BOT_HANDLE } from '../external-links'

export const NAME_MAX_RUNES = 100
// Версия текста согласия, которую принял пользователь галочкой (время ставит шлюз).
export const PROFILE_CONSENT_VERSION = 'profile-v1'
// Текст — на согласовании у владельца; версия привязана к тексту (тест-сторож
// profile-api.consent.test.ts): правка текста без новой версии валит сборку.
export const PROFILE_CONSENT_TEXT = 'Даю согласие на обработку моей почты и имени, чтобы Flibooster писал мне по ключу и обращался по имени.'
// Записи профиля шлюз может держать до 60 с (письмо уходит синхронно).
export const WRITE_TIMEOUT_MS = 70_000

export interface ProfileContact { email_masked: string; email_verified: boolean; name: string | null }
export interface ProfileData {
  available: boolean
  contact?: ProfileContact | null
  pending?: boolean
  pending_expires_at?: string
}

// profileIdent — кто вошёл: данные профиля принадлежат ТОЛЬКО этому ключу.
export function profileIdent(s: Pick<SessionSnapshot, 'authenticated' | 'keyPrefix'>): string {
  return s.authenticated ? `in:${s.keyPrefix}` : 'out'
}

// Имя для приветствия Главной: на сессию и 60 с, без лишнего круга на каждый вход на Главную.
const NAME_TTL_MS = 60_000
let nameCache: { ident: string; name: string | null; at: number } | null = null
export function cachedProfileName(ident: string): { name: string | null } | null {
  return nameCache && nameCache.ident === ident && Date.now() - nameCache.at < NAME_TTL_MS ? { name: nameCache.name } : null
}
export function setProfileNameCache(ident: string, name: string | null): void {
  nameCache = { ident, name: name && name.trim() !== '' ? name.trim() : null, at: Date.now() }
}
export function __resetProfileCacheForTests(): void { nameCache = null }

export function runeLen(s: string): number { return Array.from(s).length }

function authGuard<T>(r: ApiResult<T>): ApiResult<T> {
  if (!r.ok && r.status === 401) void refreshSession().catch(() => undefined)
  return r
}

export const profileApi = {
  get: () => apiCall<ProfileData>('GET', '/api/me/profile').then(authGuard),
  saveName: (name: string) => apiCall<{ name: string }>('PUT', '/api/me/profile', { body: { name }, timeoutMs: WRITE_TIMEOUT_MS }).then(authGuard),
  changeEmail: (b: { email: string; name?: string; consent_version?: string }) =>
    apiCall<{ pending_email_masked?: string; unchanged?: boolean }>('POST', '/api/me/profile/email', { body: b, timeoutMs: WRITE_TIMEOUT_MS }).then(authGuard),
  erase: () => apiCall<{ requested: boolean }>('POST', '/api/me/erase-request', { body: {}, timeoutMs: WRITE_TIMEOUT_MS }).then(authGuard),
}

export const MAIL_AMBIGUOUS_TEXT =
  'Не удалось убедиться, что письмо ушло. Проверьте почту через пару минут, прежде чем запрашивать снова.'

// Исход отправки письма неоднозначен: письмо могло уйти (и записано в лимит).
// Форму не открываем заново и сами не повторяем.
// Любой 5xx (и обрыв связи) неоднозначен, КРОМЕ 503 с определённым кодом шлюза:
// там отказ случился до отправки.
const DEFINITE_503 = new Set(['busy', 'unavailable', 'contacts_unavailable', 'rate_limit_unavailable', 'gateway_unavailable'])
function ambiguous5xx(r: { status: number; code: string | null }, extraDefinite: string[] = []): boolean {
  if (r.status === 0) return true
  if (r.status < 500) return false
  return !(r.status === 503 && r.code !== null && DEFINITE_503.has(r.code) && !extraDefinite.includes(r.code))
}
export function isMailAmbiguous(r: { status: number; code: string | null }): boolean {
  return r.code === 'mail_unavailable' || ambiguous5xx(r)
}
export const ERASE_AMBIGUOUS_TEXT = `Не удалось убедиться, что запрос дошёл. Если поддержка не ответит — напишите в @${SUPPORT_BOT_HANDLE}.`
export function isEraseAmbiguous(r: { status: number; code: string | null }): boolean {
  return r.code === 'erase_unavailable' || ambiguous5xx(r)
}

function waitText(sec: number): string {
  return sec < 60 ? `${Math.max(1, Math.ceil(sec))} с` : `${Math.ceil(sec / 60)} мин`
}

// Русский текст отказа. Адрес и имя в тексте не повторяются.
export function profileErrorText(r: Pick<ApiError, 'code' | 'status' | 'retryAfterSec' | 'body'>, kind: 'email' | 'name' | 'erase'): string {
  const { code, status } = r
  if (kind === 'erase' && isEraseAmbiguous(r)) return ERASE_AMBIGUOUS_TEXT
  if (status === 0) return 'Нет связи с сервером. Попробуйте ещё раз.'
  const raw = r.retryAfterSec ?? (typeof r.body?.retry_after_sec === 'number' ? r.body.retry_after_sec : null)
  if (code === 'busy') return raw !== null ? `Сервис занят. Попробуйте через ${Math.max(1, Math.ceil(raw))} с.` : 'Сервис занят. Попробуйте через минуту.'
  switch (code) {
    case 'email_invalid': return 'Проверьте адрес почты: похоже, в нём ошибка.'
    case 'name_invalid': return 'Имя не подошло: оно должно быть не пустым и не длиннее 100 символов.'
    case 'consent_required':
    case 'consent_invalid': return 'Поставьте галочку согласия.'
    case 'contact_required': return 'Сначала укажите почту.'
    case 'daily_limit': return 'Сегодня письма временно не отправляются. Попробуйте завтра.'
    case 'mail_unavailable': return MAIL_AMBIGUOUS_TEXT
    case 'write_budget':
    case 'gateway_limited':
      return `Слишком много действий подряд. Попробуйте через ${waitText(raw ?? 30)}`
    case 'rate_limited':
      if (kind === 'erase') return `Сегодня запрос уже принимался. Если поддержка не ответит — напишите в @${SUPPORT_BOT_HANDLE}.`
      if (kind === 'name') return raw !== null && raw < 3600 ? `Слишком много сохранений. Попробуйте через ${waitText(raw)}` : 'Слишком много сохранений. Попробуйте через час.'
      if (raw !== null && raw < 3600) return `Слишком много запросов на смену почты. Попробуйте позже (через ${waitText(raw)})`
      return 'Слишком много запросов на смену почты. Попробуйте завтра.'
  }
  return 'Сейчас не получается. Попробуйте чуть позже.'
}
