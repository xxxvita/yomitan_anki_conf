// catalog-api.ts — клиент каталога тайтлов BFF (`/api/me/catalog/titles`, спека
// 2026-11-19 §7.2). Ключа здесь нет: сессия — cookie. Чтение, CSRF не нужен.
//
// `429 busy` (± `Retry-After: 1`) — не ошибка для пользователя: молча повтор через
// Retry-After (нет — 1 с), не больше BUSY_RETRIES раз; после этого вызывающий
// получает обычный ApiError.
import { apiCall, type ApiDeps, type ApiResult } from '../route/route-api'

export type TitleType = 'series' | 'film' | 'cartoon'

/** Карточка списка (§7.2): без уровня, без популярности, без слов. */
export interface TitleCard {
  slug: string
  type: TitleType | string
  title_en: string
  title_ru?: string
  year?: number
  age_limit?: number
  imdb_id?: string
  tempo_bucket?: 'slow' | 'normal' | 'fast' | string
  goal_ok: boolean
}

export interface TitlePace { slow_below: number; fast_from: number }

export interface TitleListResp {
  snapshot: string
  total: number
  tempo_median_wpm?: number
  pace: TitlePace
  items: TitleCard[]
}

export interface TitleSlugsResp { snapshot: string; items: TitleCard[] }

export interface WordCount { word: string; count: number }
export interface PhraseCount { text: string; count: number }
export interface TitleGroup { group: number; forms: number; more: number; share: number; top?: WordCount[] }

/** Подробная карточка: `free_forms` наружу не уходит, страница берёт готовое `more`. */
export interface TitleDetailItem extends TitleCard {
  director?: string
  groups: TitleGroup[]
  phrases?: { n: number; top: PhraseCount[] }
  tempo?: { wpm: number; source: string }
}

export interface TitleDetailResp {
  snapshot: string
  tempo_median_wpm?: number
  pace: TitlePace
  item: TitleDetailItem
}

export interface ListParams {
  type?: string
  pace?: string
  year_from?: number
  year_to?: number
  q?: string
  sort?: 'popular' | 'new'
  limit?: number
  offset?: number
  snapshot?: string
}

export interface CatalogOpts {
  deps?: ApiDeps
  /** Пауза перед повтором `429` (тесты подставляют мгновенную). */
  sleep?: (ms: number) => Promise<void>
}

const BUSY_RETRIES = 3
const BUSY_DEFAULT_SEC = 1
const BUSY_MAX_SEC = 5

const realSleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

async function withBusyRetry<T>(call: () => Promise<ApiResult<T>>, o: CatalogOpts): Promise<ApiResult<T>> {
  const sleep = o.sleep ?? realSleep
  let r = await call()
  for (let i = 0; i < BUSY_RETRIES && !r.ok && r.status === 429; i++) {
    const sec = Math.min(BUSY_MAX_SEC, r.retryAfterSec && r.retryAfterSec > 0 ? r.retryAfterSec : BUSY_DEFAULT_SEC)
    await sleep(sec * 1000)
    r = await call()
  }
  return r
}

export function listQuery(p: ListParams): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(p)) {
    if (v === undefined || v === null || v === '') continue
    q.set(k, String(v))
  }
  return q.toString()
}

export function listTitles(p: ListParams, o: CatalogOpts = {}): Promise<ApiResult<TitleListResp>> {
  const qs = listQuery(p)
  const url = '/api/me/catalog/titles' + (qs ? `?${qs}` : '')
  return withBusyRetry(() => apiCall<TitleListResp>('GET', url, { deps: o.deps }), o)
}

/** Карточки по slug одним запросом (1…20). */
export function titlesBySlugs(slugs: string[], o: CatalogOpts = {}): Promise<ApiResult<TitleSlugsResp>> {
  const url = '/api/me/catalog/titles?slugs=' + slugs.map(encodeURIComponent).join(',')
  return withBusyRetry(() => apiCall<TitleSlugsResp>('GET', url, { deps: o.deps }), o)
}

/** Подробная карточка; `snapshot` — версия списка, из которого её открыли (нет — без проверки версии). */
export function titleDetail(slug: string, snapshot: string | undefined, o: CatalogOpts = {}): Promise<ApiResult<TitleDetailResp>> {
  const url = `/api/me/catalog/titles/${encodeURIComponent(slug)}` + (snapshot ? `?snapshot=${encodeURIComponent(snapshot)}` : '')
  return withBusyRetry(() => apiCall<TitleDetailResp>('GET', url, { deps: o.deps }), o)
}

/**
 * checkTitles — адаптер для migratePointATitles (`check`): ответ — массив карточек
 * (в том числе пустой — «все ушли из каталога»), ЛЮБОЙ сбой — `null` (apiCall
 * исключений не бросает: отказ приходит значением). Не-массив `items` — тоже сбой.
 */
export async function checkTitles(slugs: string[], o: CatalogOpts = {}): Promise<TitleCard[] | null> {
  try {
    const r = await titlesBySlugs(slugs, o)
    if (!r.ok) return null
    const items = (r.data as { items?: unknown } | null)?.items
    return Array.isArray(items) ? (items as TitleCard[]) : null
  } catch {
    return null
  }
}
