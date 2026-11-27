// https-upgrade.ts — страница с меткой кабинета, открытая по http:// не на
// петле, уходит на тот же адрес по https ДО показа формы входа (финальное
// ревью PR-A F-2). На http вход не работает: браузер шлёт Origin http://, и
// сторож CSRF BFF отвечает 403 (окно сказало бы «сервер не отвечает»), а
// cookie __Host-/Secure на http не сохраняется. Петля (localhost, 127.0.0.1,
// [::1]) остаётся на http — локальная проверка A9. Без метки (кабинет
// выключен) ничего не меняется. Включить «Always Use HTTPS» в Cloudflare —
// отдельный шаг владельца.

import { cabinetMarked } from './session'

export interface LocationLike {
  protocol: string
  hostname: string
  host: string
  pathname: string
  search: string
  hash: string
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

// httpsUpgradeTarget — адрес https, куда уйти, или null, если уходить не надо.
export function httpsUpgradeTarget(loc: LocationLike, marked: boolean): string | null {
  if (!marked || loc.protocol !== 'http:') return null
  if (LOOPBACK.has(loc.hostname.toLowerCase())) return null
  return `https://${loc.host}${loc.pathname}${loc.search}${loc.hash}`
}

// redirectToHttpsIfNeeded — для main.tsx: true — ушли на https (страницу не
// рисовать), false — остаёмся.
export function redirectToHttpsIfNeeded(loc: LocationLike & { replace(url: string): void } = window.location): boolean {
  const target = httpsUpgradeTarget(loc, cabinetMarked())
  if (!target) return false
  loc.replace(target)
  return true
}
