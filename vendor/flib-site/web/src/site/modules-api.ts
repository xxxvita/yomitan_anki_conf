// modules-api.ts — клиент BFF /api/modules (internal/bff/modules.go).
// Ключ пользователя уходит только в теле POST, в URL его нет.
//
// Двойное чтение (спека кабинета 2026-11-17 §3.6): ModulesAuth — либо ключ
// старого окна (flib:tpk) в теле, как раньше, либо 'session' — POST {} с
// заголовками сторожа CSRF, BFF берёт ключ из cookie сессии; null — аноним.
import { CSRF_HEADERS } from './session'

export type ModulesAuth = { key: string } | 'session' | null

export interface ModuleAssetRef { url: string; sha256: string; mime: string }

export interface ModuleVersion {
  version: string
  platform: string
  size?: number
  changelog?: string
  yanked?: boolean
  icon?: ModuleAssetRef | null
  cover?: ModuleAssetRef | null
}

export interface CatalogModule {
  id: string
  name: string
  publisher: string
  access: string
  accessible: boolean
  description: string
  versions: ModuleVersion[]
}

export type CatalogResult =
  | { kind: 'ok'; modules: CatalogModule[] }
  | { kind: 'off' }
  | { kind: 'invalid_key' }
  | { kind: 'rate_limited'; retryAfterSec: number }
  | { kind: 'error' }

function post(url: string, auth: Exclude<ModulesAuth, null>, signal?: AbortSignal): Promise<Response> {
  if (auth === 'session') {
    return fetch(url, {
      signal,
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...CSRF_HEADERS },
      body: '{}',
    })
  }
  return fetch(url, {
    signal,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: auth.key }),
  })
}

export async function fetchCatalog(auth: ModulesAuth, signal?: AbortSignal): Promise<CatalogResult> {
  let resp: Response
  try {
    resp = auth ? await post('/api/modules', auth, signal) : await fetch('/api/modules', { signal })
  } catch {
    return { kind: 'error' }
  }
  if (resp.status === 429) return { kind: 'rate_limited', retryAfterSec: Number(resp.headers.get('Retry-After')) || 0 }
  if (resp.status === 401 || resp.status === 403) return { kind: 'invalid_key' }
  if (resp.status === 404) return { kind: 'off' }
  if (!resp.ok) return { kind: 'error' }
  try {
    const body = await resp.json()
    if (body.store === 'off') return { kind: 'off' }
    return { kind: 'ok', modules: Array.isArray(body.modules) ? body.modules : [] }
  } catch {
    return { kind: 'error' }
  }
}

// Иконки с ключом идут по одной (на бэке min-gap), 429 ждём и повторяем.
// Очередь общая, но каждая задача несёт свой signal: при размонтировании
// страницы оставшиеся задачи пропускаются, паузы прерываются.
let iconChain: Promise<unknown> = Promise.resolve()
export const ICON_GAP_MS = 1100

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal.aborted) return resolve()
    const t = setTimeout(done, ms)
    function done() { clearTimeout(t); signal.removeEventListener('abort', done); resolve() }
    signal.addEventListener('abort', done)
  })
}

export function fetchKeyedIcon(url: string, auth: Exclude<ModulesAuth, null>, signal: AbortSignal): Promise<string | null> {
  const run = async (): Promise<string | null> => {
    for (let attempt = 0; attempt < 3 && !signal.aborted; attempt++) {
      try {
        const resp = await post(url, auth, signal)
        if (resp.status === 429) {
          await sleep(Math.max(1, Number(resp.headers.get('Retry-After')) || 1) * 1000, signal)
          continue
        }
        if (!resp.ok) return null
        const blob = await resp.blob()
        return signal.aborted ? null : URL.createObjectURL(blob)
      } catch {
        return null
      }
    }
    return null
  }
  const next = iconChain
    .then(run, run)
    .then(async v => { await sleep(ICON_GAP_MS, signal); return v })
  iconChain = next
  return next
}

export function downloadHref(id: string, version: string, platform: string): string {
  const q = new URLSearchParams({ id, version, platform })
  return `/api/modules/download?${q.toString()}`
}

// startDownload: аноним — переход на GET (BFF ответит 302); с ключом/сессией — POST и
// переход по адресу R2 из JSON. Возвращает код ошибки или null.
export async function startDownload(auth: ModulesAuth, id: string, version: string, platform: string): Promise<string | null> {
  const href = downloadHref(id, version, platform)
  if (!auth) {
    window.location.assign(href)
    return null
  }
  try {
    const resp = await post(href, auth)
    const body = await resp.json().catch(() => ({}))
    if (resp.ok && typeof body.url === 'string') {
      window.location.assign(body.url)
      return null
    }
    return typeof body.error === 'string' ? body.error : `http_${resp.status}`
  } catch {
    return 'network'
  }
}
