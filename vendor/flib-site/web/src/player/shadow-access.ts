// shadow-access.ts — Shadowing UI-гейт (Э6, docs/plan-2026-07-13-design-transfer.md,
// «Архитектурные решения» п.6): Shadowing тратит токены ElevenLabs, поэтому
// доступен не всем — только ключам с капой elevenlabs_realtime.
//
// Двойное чтение (спека кабинета 2026-11-17 §3.6): сессия кабинета отвечает,
// ТОЛЬКО когда она активна (authenticated И state:"active") — тогда её поле
// shadowing. Во всех прочих случаях (нет сессии, state expired/unknown, ответа
// ещё нет, BFF без сессии — 404) — старый снимок flib:access, как до кабинета.
import { loadAccess } from '../site/access'
import { cabinetMarked, getSession, isActiveSession } from '../site/session'

// Подсказки запертой пилюли Shadowing. LEGACY — прежний текст, остаётся без
// метки кабинета (флаг выключен — сайт как до кабинета). С меткой текст
// выбирается по снимку сессии: на главной кабинета ключ не вводят, а у
// вошедшего пользователя дело не во входе, а в правах ключа.
export const SHADOW_LOCKED_LEGACY = 'Для выполнения упражнения Shadowing нужно ввести ключ на главной странице. Нажмите «Войти» и введите свой ключ.'
export const SHADOW_LOCKED_NOT_IN_KEY = 'Shadowing не входит в Ваш ключ.'
export const SHADOW_LOCKED_LOGIN = 'Войдите по ключу, чтобы открыть Shadowing.'
// Тот же текст, что в верхней полосе кабинета у истёкшего ключа.
export const SHADOW_LOCKED_EXPIRED = 'Срок действия ключа закончился.'
// Доступ не удалось проверить: шлюз недоступен или чтение сессии упало.
// «Войдите» тут не помогает — снимок перечитывается сам (session.ts).
export const SHADOW_LOCKED_UNAVAILABLE = 'Не удалось проверить доступ. Попробуйте позже.'

// shadowLockedTitle — подсказка пилюли, когда старт Shadowing заперт.
// - вошёл, ключ активен, права нет → «не входит в Ваш ключ»;
// - вошёл, ключ истёк → «срок закончился»;
// - вошёл, но состояние unknown (шлюз недоступен; так же refreshSession
//   сохраняет снимок вошедшего при сбое сети/5xx) → «не удалось проверить»;
// - первое чтение упало (status error, вошёл ли — неизвестно) → то же;
// - иначе (не вошёл, снимка ещё нет) → «Войдите по ключу».
export function shadowLockedTitle(): string {
  if (!cabinetMarked()) return SHADOW_LOCKED_LEGACY
  const s = getSession()
  if (isActiveSession(s)) return SHADOW_LOCKED_NOT_IN_KEY
  if (s.status === 'error') return SHADOW_LOCKED_UNAVAILABLE
  if (s.status === 'ready' && s.authenticated) {
    if (s.state === 'expired') return SHADOW_LOCKED_EXPIRED
    return SHADOW_LOCKED_UNAVAILABLE
  }
  return SHADOW_LOCKED_LOGIN
}

// hasShadowingAccess — дефолт ЗАПРЕЩЁН (решение владельца: "не всем"). Нет
// активной сессии и нет записи flib:access (или она битая, или shadowing
// !== true) → доступа нет.
export function hasShadowingAccess(): boolean {
  const s = getSession()
  if (isActiveSession(s)) return s.shadowing
  return loadAccess()?.shadowing === true
}
