// billing-api.ts — клиент BFF /api/billing/* (internal/bff/billing.go).
//
// Токен заказа браузер не видит вовсе: BFF кладёт его в HttpOnly-cookie при
// создании заказа, а same-origin fetch отправляет её сам. Ключ из ответа
// reveal возвращается вызывающему и нигде не сохраняется.
import { parseRetryAfterSec } from './retry-after'

export interface Product {
  id: string
  title: string
  price_kopecks: number
  duration_days: number
  sort: number
}

export type OrderStatus = 'created' | 'pending' | 'paid' | 'fulfilled' | 'canceled' | 'refunded' | 'partially_refunded'

export interface Order {
  order_id: string
  status: OrderStatus
  product_id: string
  product_title: string
  duration_days: number
  amount_kopecks: number
  key_ready: boolean
  key_revealed: boolean
  reveal_until: string | null
  receipt_url: string | null
  confirmation_url: string | null
  created_at: string
  paid_at: string | null
  /** Итог заказа: новый ключ или продление. Старый шлюз поля не шлёт — считаем new. */
  kind?: 'new' | 'renewal'
  /** Новый ключ не открыли за 7 дней, и шлюз его стёр. Старый шлюз не шлёт — false. */
  key_purged?: boolean
  /**
   * Ключ заказа перевыпущен поддержкой после выдачи (шлюз, OpenAPI 0.41.0):
   * шлюз шлёт только true, иначе поля нет. Важнее key_purged (тот при этом
   * тоже может быть true), reveal тогда отвечает 410.
   */
  key_replaced?: boolean
  /**
   * Одноразовая ссылка привязки Telegram к новому ключу (шлюз 0.38.0). Шлюз
   * шлёт её только пока открыто окно показа ключа (после первого reveal) и
   * ссылка не использована. fetchOrder оставляет поле, только если это
   * диплинк https://t.me/<бот>?start=<…>. Ссылка даёт право привязки: не
   * логировать, не сохранять, не отправлять в события.
   */
  tg_link_url?: string
  /**
   * Почта покупателя у шлюза (0.37.0): ok — сохранена, deferred — хранилище
   * было недоступно, страница просит почту ещё раз, none — почту не давали или
   * хранилище выключено (снова не просим). Старый шлюз поля не шлёт — формы нет.
   */
  contact_status?: string
  /**
   * Текущий срок ключа заказа, RFC3339 UTC (шлюз, OpenAPI 0.40.0): только для
   * fulfilled, когда ключ есть, не отозван и не бессрочный; сдвигается при
   * следующем продлении. fetchOrder оставляет поле, только если оно
   * разбирается (parseKeyExpiry), иначе — как будто его нет.
   */
  key_expires_at?: string
  /**
   * Заказ создан по ссылке продления из письма (шлюз шлёт только true): почту
   * по нему не принять, форму «Оставьте почту» не показываем.
   */
  via_link?: boolean
  /**
   * Почему платёж возвращён или заказ закрыт без оплаты: duplicate — эта
   * ссылка уже оплачена другим заказом, key_unavailable — ключ больше нельзя
   * продлить. Остаётся после refunded/canceled. Старый шлюз поля не шлёт.
   */
  refund_reason?: 'duplicate' | 'key_unavailable' | null
}

export type ProductsResult = { kind: 'ok'; products: Product[] } | { kind: 'error' }

export type CreateResult =
  | { kind: 'ok'; orderId: string; confirmationUrl: string | null }
  | { kind: 'promo_invalid' }
  | { kind: 'key_not_renewable' }
  | { kind: 'product_unavailable' }
  | { kind: 'payments_unavailable' }
  | { kind: 'email_invalid' }
  | { kind: 'email_required' }
  | { kind: 'rate_limited'; retryAfterSec: number | null }
  | { kind: 'network' }
  /** Сервер не ответил за CREATE_ORDER_TIMEOUT_MS: можно повторить. */
  | { kind: 'timeout' }
  | { kind: 'error' }

export type ContactResult =
  | { kind: 'ok' }
  /** Почта уже сохранена (contact_already_set) — для покупателя то же, что ok. */
  | { kind: 'already_set' }
  /** Форму больше не показывать: заказ отменён/возвращён (contact_not_allowed) или хранилище выключено (vault_disabled). */
  | { kind: 'not_allowed' }
  | { kind: 'email_invalid' }
  | { kind: 'email_required' }
  /** Хранилище контактов недоступно (503 contacts_unavailable) — повторить позже. */
  | { kind: 'unavailable'; retryAfterSec: number | null }
  | { kind: 'rate_limited'; retryAfterSec: number | null }
  | { kind: 'token_missing' }
  | { kind: 'not_found' }
  /** Сервер не ответил за CONTACT_TIMEOUT_MS: можно повторить. */
  | { kind: 'timeout' }
  | { kind: 'error' }

export type OrderResult =
  | { kind: 'ok'; order: Order }
  | { kind: 'token_missing' }
  | { kind: 'not_found' }
  | { kind: 'rate_limited'; retryAfterSec: number | null }
  | { kind: 'error' }

export type RevealResult =
  | { kind: 'ok'; key: string; revealUntil: string }
  | { kind: 'not_ready' }
  | { kind: 'already_issued' }
  | { kind: 'token_missing' }
  | { kind: 'not_found' }
  | { kind: 'rate_limited'; retryAfterSec: number | null }
  /** Сервер не ответил за REVEAL_TIMEOUT_MS: можно повторить. */
  | { kind: 'timeout' }
  | { kind: 'error' }

const ORDER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function isOrderId(id: string | undefined): id is string {
  return !!id && ORDER_ID_RE.test(id)
}

async function readJSON(resp: Response): Promise<unknown> {
  try { return await resp.json() } catch { return null }
}

function errorCode(body: unknown): string {
  const e = (body as { error?: unknown } | null)?.error
  return typeof e === 'string' ? e : ''
}


// ─── таймауты запросов ────────────────────────────────────────────────────
// Любой запрос к BFF обрывается по таймеру, чтобы кнопка не крутилась вечно.

export const PRODUCTS_TIMEOUT_MS = 20_000
// Создание заказа ждёт ДОЛЬШЕ, чем BFF ждёт шлюз (60 с, internal/bff/billing.go):
// здоровый сервер всегда успевает ответить раньше клиента. Оборванный заказ
// мог всё же создаться и забронировать одноразовый промокод на 30 минут, и
// преждевременный повтор получил бы promo_invalid.
export const CREATE_ORDER_TIMEOUT_MS = 70_000
// reveal и contact — тоже ДОЛЬШЕ 60 с BFF: клиент, оборвавший запрос раньше,
// мог бы каждый раз не дожидаться медленного ответа и потерять ключ, когда
// окно показа (15 мин) закроется.
export const REVEAL_TIMEOUT_MS = 65_000
export const CONTACT_TIMEOUT_MS = 65_000

interface Deadline {
  signal: AbortSignal
  timedOut: () => boolean
  done: () => void
}

function deadline(ms: number, parent?: AbortSignal): Deadline {
  const ctl = new AbortController()
  let fired = false
  const timer = setTimeout(() => { fired = true; ctl.abort() }, ms)
  const onAbort = () => ctl.abort()
  if (parent) {
    if (parent.aborted) ctl.abort()
    else parent.addEventListener('abort', onAbort, { once: true })
  }
  return {
    signal: ctl.signal,
    timedOut: () => fired,
    done: () => { clearTimeout(timer); parent?.removeEventListener('abort', onAbort) },
  }
}

export async function fetchProducts(signal?: AbortSignal): Promise<ProductsResult> {
  const dl = deadline(PRODUCTS_TIMEOUT_MS, signal)
  try {
    const resp = await fetch('/api/billing/products', { signal: dl.signal })
    if (!resp.ok) return { kind: 'error' }
    const body = await readJSON(resp) as { products?: unknown } | null
    if (!body || !Array.isArray(body.products)) return { kind: 'error' }
    const products = (body.products as Product[])
      .filter(p => p && typeof p.id === 'string' && typeof p.price_kopecks === 'number')
      .sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id))
    return { kind: 'ok', products }
  } catch {
    return { kind: 'error' }
  } finally {
    dl.done()
  }
}

export interface CreateInput {
  productId: string
  promoCode: string
  renewKey: string
  /** Почта покупателя — персональные данные: только в теле запроса, нигде больше. */
  email: string
}

export async function createOrder(input: CreateInput): Promise<CreateResult> {
  const body: Record<string, string> = { product_id: input.productId }
  if (input.promoCode) body.promo_code = input.promoCode
  if (input.renewKey) body.renew_key = input.renewKey
  if (input.email) body.email = input.email
  const dl = deadline(CREATE_ORDER_TIMEOUT_MS)
  let resp: Response
  let data: unknown
  try {
    resp = await fetch('/api/billing/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: dl.signal,
    })
    data = await readJSON(resp)
  } catch {
    return dl.timedOut() ? { kind: 'timeout' } : { kind: 'network' }
  } finally {
    dl.done()
  }
  if (resp.status === 201) {
    const d = data as { order_id?: unknown; confirmation_url?: unknown } | null
    if (!d || typeof d.order_id !== 'string' || !isOrderId(d.order_id)) return { kind: 'error' }
    const url = typeof d.confirmation_url === 'string' && /^https:\/\//.test(d.confirmation_url) ? d.confirmation_url : null
    return { kind: 'ok', orderId: d.order_id, confirmationUrl: url }
  }
  const code = errorCode(data)
  if (resp.status === 429) return { kind: 'rate_limited', retryAfterSec: parseRetryAfterSec(resp.headers.get('Retry-After'), data) }
  if (resp.status === 503 && code === 'payments_unavailable') return { kind: 'payments_unavailable' }
  if (resp.status === 400) {
    if (code === 'promo_invalid') return { kind: 'promo_invalid' }
    if (code === 'key_not_renewable') return { kind: 'key_not_renewable' }
    if (code === 'product_unavailable') return { kind: 'product_unavailable' }
    if (code === 'email_invalid') return { kind: 'email_invalid' }
    if (code === 'email_required') return { kind: 'email_required' }
  }
  return { kind: 'error' }
}

// ─── почта покупателя ─────────────────────────────────────────────────────

/** Предел длины почты — как у шлюза и BFF (billingEmailMaxLen), после trim. */
export const EMAIL_MAX_LEN = 254

/** Почта для сравнения двух полей: без пробелов по краям и без учёта регистра. */
export function normalizeEmail(s: string): string {
  return s.trim().toLowerCase()
}

/**
 * Оба поля заполнены одним адресом и он не длиннее предела. Формат — забота
 * шлюза (400 email_invalid). Предел — в байтах UTF-8, как у BFF.
 */
export function emailsReady(email: string, confirm: string): boolean {
  const a = email.trim()
  return a !== '' && new TextEncoder().encode(a).length <= EMAIL_MAX_LEN && normalizeEmail(a) === normalizeEmail(confirm)
}

// submitContact — почта после оплаты (contact_status = deferred). Адрес
// уходит только в теле POST; ответ его не содержит.
export async function submitContact(id: string, email: string): Promise<ContactResult> {
  const dl = deadline(CONTACT_TIMEOUT_MS)
  let resp: Response
  let data: unknown
  try {
    resp = await fetch(`${orderUrl(id)}/contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
      cache: 'no-store',
      signal: dl.signal,
    })
    data = await readJSON(resp)
  } catch {
    return dl.timedOut() ? { kind: 'timeout' } : { kind: 'error' }
  } finally {
    dl.done()
  }
  const code = errorCode(data)
  if (resp.status === 200) {
    return (data as { contact_status?: unknown } | null)?.contact_status === 'ok' ? { kind: 'ok' } : { kind: 'error' }
  }
  if (resp.status === 401) return { kind: 'token_missing' }
  if (resp.status === 404) return { kind: 'not_found' }
  if (resp.status === 409) {
    if (code === 'contact_already_set') return { kind: 'already_set' }
    if (code === 'contact_not_allowed' || code === 'vault_disabled') return { kind: 'not_allowed' }
    return { kind: 'error' }
  }
  if (resp.status === 400) {
    if (code === 'email_invalid') return { kind: 'email_invalid' }
    if (code === 'email_required') return { kind: 'email_required' }
    return { kind: 'error' }
  }
  if (resp.status === 503 && code === 'contacts_unavailable') {
    return { kind: 'unavailable', retryAfterSec: parseRetryAfterSec(resp.headers.get('Retry-After'), data) }
  }
  if (resp.status === 429) return { kind: 'rate_limited', retryAfterSec: parseRetryAfterSec(resp.headers.get('Retry-After'), data) }
  return { kind: 'error' }
}

// ─── проверка промокода (кнопка «Применить») ─────────────────────────────

export interface PromoPrice {
  product_id: string
  price_kopecks: number
  amount_kopecks: number
}

export type PromoCheckResult =
  /** Тарифы, к которым код применим; пустой список — код ни к одному не подходит. */
  | { kind: 'ok'; products: PromoPrice[] }
  | { kind: 'promo_invalid' }
  /** Ручки проверки ещё нет на шлюзе: код проверит заказ. */
  | { kind: 'unavailable' }
  | { kind: 'rate_limited'; retryAfterSec: number | null }
  | { kind: 'network' }
  | { kind: 'error' }

function isKopecks(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0
}

/** Предел длины промокода в БАЙТАХ UTF-8 — тот же, что у BFF (billingPromoMaxLen). */
export const PROMO_MAX_BYTES = 64

export function promoBytes(code: string): number {
  return new TextEncoder().encode(code).length
}

// Зависшая проверка не должна держать «Оплатить» заблокированной: через
// 10 с запрос отменяется, и код проверит заказ.
export const PROMO_CHECK_TIMEOUT_MS = 10_000

// checkPromo — ничего не бронирует: окончательную цену решает заказ. Код
// уходит только в теле POST, ни в URL, ни в хранилища. signal — отмена
// вызывающим (правка поля); и она, и таймаут дают { kind: 'network' }.
export async function checkPromo(code: string, signal?: AbortSignal): Promise<PromoCheckResult> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), PROMO_CHECK_TIMEOUT_MS)
  const onAbort = () => ctl.abort()
  if (signal) {
    if (signal.aborted) ctl.abort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }
  let resp: Response
  let data: unknown
  try {
    resp = await fetch('/api/billing/promo/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
      cache: 'no-store',
      signal: ctl.signal,
    })
    data = await readJSON(resp)
  } catch {
    return { kind: 'network' }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
  if (resp.status === 200) {
    const list = (data as { products?: unknown } | null)?.products
    if (!Array.isArray(list)) return { kind: 'error' }
    const products = (list as PromoPrice[]).filter(p =>
      p && typeof p.product_id === 'string' && isKopecks(p.price_kopecks) && isKopecks(p.amount_kopecks))
    return { kind: 'ok', products }
  }
  // Любой 404 — «проверки нет»: так страница в худшем случае откатывается к
  // прежнему поведению (код проверит заказ), а не показывает ошибку.
  if (resp.status === 404) return { kind: 'unavailable' }
  if (resp.status === 429) return { kind: 'rate_limited', retryAfterSec: parseRetryAfterSec(resp.headers.get('Retry-After'), data) }
  if (resp.status === 400 && errorCode(data) === 'promo_invalid') return { kind: 'promo_invalid' }
  return { kind: 'error' }
}

// monthsIn — срок тарифа в месяцах для строки «… ₽/мес»: 30 → 1, 90 → 3, 365 → 12.
export function monthsIn(durationDays: number): number {
  return Math.round(durationDays / 30.4375)
}

// perMonthKopecks — цена за месяц, округлённая до рубля (строка мелким
// шрифтом, копейки там только мешают); null — тариф короче полумесяца,
// строку не показываем.
export function perMonthKopecks(priceKopecks: number, durationDays: number): number | null {
  const months = monthsIn(durationDays)
  if (!(months >= 1)) return null
  return Math.round(priceKopecks / months / 100) * 100
}

function orderUrl(id: string): string {
  return `/api/billing/orders/${id}`
}

// Диплинк бота строго в той форме, в какой его строит шлюз
// (turmalin_getaway internal/server/billing_tg.go): имя бота — как у
// Telegram (буква, затем 3..31 символов [A-Za-z0-9_]), start = lk_ + 26
// символов base32 в нижнем регистре. Всё прочее (javascript:, http:, другой
// хост, порт, userinfo, пробелы, лишние параметры) кнопкой не станет, даже
// если ответ шлюза окажется битым.
const TG_LINK_RE = /^https:\/\/t\.me\/[A-Za-z][A-Za-z0-9_]{3,31}\?start=lk_[a-z2-7]{26}$/

export function isTgLink(v: unknown): v is string {
  return typeof v === 'string' && TG_LINK_RE.test(v)
}

// ─── срок ключа (key_expires_at) ──────────────────────────────────────────

const RFC3339_RE = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?([Zz]|[+-]\d{2}:\d{2})$/

/**
 * Момент из строки RFC3339 (с часовым поясом обязательно), мс эпохи; null —
 * не строка, не RFC3339 или несуществующая дата (2026-02-30, 13-й месяц).
 * Разбор свой, а не Date.parse: тот прощает дату без времени и без пояса.
 */
export function parseKeyExpiry(v: unknown): number | null {
  if (typeof v !== 'string') return null
  const m = RFC3339_RE.exec(v)
  if (!m) return null
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number)
  if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 59) return null
  const day = new Date(Date.UTC(y, mo - 1, d))
  if (day.getUTCFullYear() !== y || day.getUTCMonth() !== mo - 1 || day.getUTCDate() !== d) return null
  const ms = m[7] ? Number(m[7].slice(0, 3).padEnd(3, '0')) : 0
  let offsetMin = 0
  if (m[8] !== 'Z' && m[8] !== 'z') {
    const sign = m[8][0] === '-' ? -1 : 1
    const oh = Number(m[8].slice(1, 3))
    const om = Number(m[8].slice(4, 6))
    if (oh > 23 || om > 59) return null
    offsetMin = sign * (oh * 60 + om)
  }
  return Date.UTC(y, mo - 1, d, h, mi, s, ms) - offsetMin * 60_000
}

/**
 * «16 декабря 2026, 14:37» — во времени устройства покупателя (timeZone не
 * задан) или в заданном поясе (тесты). Собирается из частей Intl: целиком
 * Intl даёт «16 декабря 2026 г. в 14:37».
 */
export function formatKeyExpiry(t: number, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone,
  }).formatToParts(new Date(t))
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value ?? ''
  return `${get('day')} ${get('month')} ${get('year')}, ${get('hour')}:${get('minute')}`
}

// Опрос не должен висеть на одном запросе: оборванный посреди ответа запрос
// без таймаута остановил бы обновление страницы навсегда.
export const ORDER_FETCH_TIMEOUT_MS = 20_000

export async function fetchOrder(id: string, signal?: AbortSignal): Promise<OrderResult> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), ORDER_FETCH_TIMEOUT_MS)
  const onAbort = () => ctl.abort()
  if (signal) {
    if (signal.aborted) ctl.abort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }
  try {
    const resp = await fetch(orderUrl(id), { signal: ctl.signal, cache: 'no-store' })
    if (resp.status === 401) return { kind: 'token_missing' }
    if (resp.status === 404) return { kind: 'not_found' }
    if (resp.status === 429) {
      return { kind: 'rate_limited', retryAfterSec: parseRetryAfterSec(resp.headers.get('Retry-After'), await readJSON(resp)) }
    }
    if (!resp.ok) return { kind: 'error' }
    const body = await readJSON(resp) as Order | null
    if (!body || typeof body.status !== 'string') return { kind: 'error' }
    if (!isTgLink(body.tg_link_url)) delete body.tg_link_url
    if (parseKeyExpiry(body.key_expires_at) === null) delete body.key_expires_at
    return { kind: 'ok', order: body }
  } catch {
    return { kind: 'error' }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

export async function revealKey(id: string): Promise<RevealResult> {
  const dl = deadline(REVEAL_TIMEOUT_MS)
  let resp: Response
  let data: unknown
  try {
    resp = await fetch(`${orderUrl(id)}/reveal`, { method: 'POST', cache: 'no-store', signal: dl.signal })
    data = await readJSON(resp)
  } catch {
    return dl.timedOut() ? { kind: 'timeout' } : { kind: 'error' }
  } finally {
    dl.done()
  }
  if (resp.status === 200) {
    const d = data as { key?: unknown; reveal_until?: unknown } | null
    if (!d || typeof d.key !== 'string' || !d.key) return { kind: 'error' }
    return { kind: 'ok', key: d.key, revealUntil: typeof d.reveal_until === 'string' ? d.reveal_until : '' }
  }
  if (resp.status === 401) return { kind: 'token_missing' }
  if (resp.status === 404) return { kind: 'not_found' }
  if (resp.status === 409) return { kind: 'not_ready' }
  if (resp.status === 410) return { kind: 'already_issued' }
  if (resp.status === 429) return { kind: 'rate_limited', retryAfterSec: parseRetryAfterSec(resp.headers.get('Retry-After'), data) }
  return { kind: 'error' }
}

// formatRub — «1 500 ₽» (неразрывные пробелы: цена не переносится по частям).
export function formatRub(kopecks: number): string {
  const rub = kopecks / 100
  const whole = Math.trunc(rub)
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  const frac = Math.round((rub - whole) * 100)
  return frac ? `${grouped},${String(frac).padStart(2, '0')} ₽` : `${grouped} ₽`
}

// waitLabel — «через N с» до полутора минут, дальше в минутах: «через 600 с»
// читается хуже, чем «через 10 мин».
export function waitLabel(sec: number): string {
  return sec > 90 ? `${Math.ceil(sec / 60)} мин` : `${Math.ceil(sec)} с`
}

// ─── продление ключа по почте (шлюз rev 4, спека 2026-11-21) ─────────────

/**
 * Сборочный флаг: продление по почте на странице покупки. false — страница
 * ведёт себя как до фичи (только ключ, поля почты нет). Включён, когда шлюз
 * включил подось продления (billing.renew_link.enabled): выключенная подось
 * отвечает голым 404, и страница предлагала бы нерабочую возможность.
 */
export const RENEW_BY_EMAIL = true

// Шлюз отправляет письмо синхронно (BFF ждёт до 60 с), поэтому клиент ждёт
// ДОЛЬШЕ BFF: здоровый ответ всегда приходит раньше клиентского таймера.
export const RENEW_LINK_TIMEOUT_MS = 70_000
export const REDEEM_TIMEOUT_MS = 70_000

export type RenewLinkResult =
  | { kind: 'sent' }
  /** 404 no_key_for_email — ТОЛЬКО этот код значит «ключа на почте нет». */
  | { kind: 'no_key' }
  /** 404 no_renewable_key_for_product — ключ есть, но выбранный тариф к нему не подходит. */
  | { kind: 'no_renewable' }
  | { kind: 'email_invalid' }
  | { kind: 'promo_invalid' }
  | { kind: 'product_unavailable' }
  | { kind: 'rate_limited'; retryAfterSec: number | null }
  | { kind: 'timeout' }
  /** Любое другое: 503, голый 404 (подось шлюза выключена), сеть, мусор. */
  | { kind: 'error' }

export interface RenewLinkInput {
  /** Почта — персональные данные: только в теле запроса, нигде больше. */
  email: string
  productId: string
  promoCode: string
}

export async function requestRenewLink(input: RenewLinkInput): Promise<RenewLinkResult> {
  const body: Record<string, string> = { email: input.email, product_id: input.productId }
  if (input.promoCode) body.promo_code = input.promoCode
  const dl = deadline(RENEW_LINK_TIMEOUT_MS)
  let resp: Response
  let data: unknown
  try {
    resp = await fetch('/api/billing/renew-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: dl.signal,
    })
    data = await readJSON(resp)
  } catch {
    return dl.timedOut() ? { kind: 'timeout' } : { kind: 'error' }
  } finally {
    dl.done()
  }
  const code = errorCode(data)
  if (resp.status === 200) {
    return (data as { sent?: unknown } | null)?.sent === true ? { kind: 'sent' } : { kind: 'error' }
  }
  if (resp.status === 404) {
    if (code === 'no_key_for_email') return { kind: 'no_key' }
    if (code === 'no_renewable_key_for_product') return { kind: 'no_renewable' }
    return { kind: 'error' }
  }
  if (resp.status === 400) {
    if (code === 'email_invalid') return { kind: 'email_invalid' }
    if (code === 'promo_invalid') return { kind: 'promo_invalid' }
    if (code === 'product_unavailable') return { kind: 'product_unavailable' }
    return { kind: 'error' }
  }
  if (resp.status === 429) return { kind: 'rate_limited', retryAfterSec: parseRetryAfterSec(resp.headers.get('Retry-After'), data) }
  return { kind: 'error' }
}

export type RedeemResult =
  /** Заказ создан или выдан повторно; без confirmationUrl (бесплатный) — сразу на страницу заказа. */
  | { kind: 'ok'; orderId: string; confirmationUrl: string | null }
  | { kind: 'link_used' }
  | { kind: 'link_replaced' }
  | { kind: 'link_expired' }
  | { kind: 'not_found' }
  | { kind: 'key_not_renewable' }
  /** Промокод ссылки больше не действует; priceKopecks — цена тарифа без скидки. */
  | { kind: 'promo_gone'; priceKopecks: number | null }
  /** Сумма 0 ₽: нужно явное «Продлить бесплатно». */
  | { kind: 'confirm_required' }
  | { kind: 'timeout' }
  /** 429, 503, сеть, мусор: можно повторить с тем же токеном. */
  | { kind: 'error' }

export interface RedeemOpts {
  dropPromo?: boolean
  confirmFree?: boolean
}

export async function redeemRenewLink(token: string, opts: RedeemOpts = {}): Promise<RedeemResult> {
  const body: Record<string, unknown> = { token }
  if (opts.dropPromo) body.drop_promo = true
  if (opts.confirmFree) body.confirm_free = true
  const dl = deadline(REDEEM_TIMEOUT_MS)
  let resp: Response
  let data: unknown
  try {
    resp = await fetch('/api/billing/renew-link/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: dl.signal,
    })
    data = await readJSON(resp)
  } catch {
    return dl.timedOut() ? { kind: 'timeout' } : { kind: 'error' }
  } finally {
    dl.done()
  }
  if (resp.status === 200 || resp.status === 201) {
    const d = data as { order_id?: unknown; confirmation_url?: unknown } | null
    if (!d || typeof d.order_id !== 'string' || !isOrderId(d.order_id)) return { kind: 'error' }
    const url = typeof d.confirmation_url === 'string' && /^https:\/\//.test(d.confirmation_url) ? d.confirmation_url : null
    return { kind: 'ok', orderId: d.order_id, confirmationUrl: url }
  }
  const code = errorCode(data)
  if (resp.status === 410) {
    if (code === 'link_used') return { kind: 'link_used' }
    if (code === 'link_replaced') return { kind: 'link_replaced' }
    if (code === 'link_expired') return { kind: 'link_expired' }
    return { kind: 'error' }
  }
  if (resp.status === 404) return code === 'link_not_found' ? { kind: 'not_found' } : { kind: 'error' }
  if (resp.status === 409) {
    if (code === 'key_not_renewable') return { kind: 'key_not_renewable' }
    if (code === 'confirm_required') return { kind: 'confirm_required' }
    if (code === 'promo_no_longer_valid') {
      const p = (data as { price_kopecks?: unknown } | null)?.price_kopecks
      return { kind: 'promo_gone', priceKopecks: isKopecks(p) ? p : null }
    }
  }
  return { kind: 'error' }
}
