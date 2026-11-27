// outbox.ts — очередь событий маршрута `flib:route-outbox` (спека 2026-11-17
// §4.8, план B6).
//
// Событие рождается с `event_id`, `learning_day`, `client_ts` (их ставит
// вызывающий, mapper.ts) и попадает в БУФЕР вкладки. Буфер сбрасывается в
// localStorage не реже раза в 2 с, сразу — на `clip_played`/`clip_rated`, и на
// `pagehide`. Каждое чтение-изменение-запись ключа — под блокировкой Web Locks
// `flib-route-outbox`; отправка сериализуется той же блокировкой (§4.8), поэтому
// две вкладки не шлют одно событие дважды и не теряют чужих записей. Без Web
// Locks — без блокировки (редкие дубли гасит шлюз по `event_id`).
//
// Событие удаляется из хранилища только после ответа BFF, поэтому пачка в
// полёте видна `pendingClipPlayed()` (сторож удаления `flib:route-watched`).
//
// Ключ очереди — `route_id` (I14): пачка — одной эпохи; вход другим ключом даёт
// другой маршрут, его события шлюз отвергнет `409 stale_route`.
//
// Ответы (таблица §4.8):
//   200            — удалить принятые, дубли и отказы; `full_regressed` —
//                    пересобрать как `partial` (новый event_id) и поставить снова;
//   400 / 413      — пачку пополам; одиночное событие — выбросить;
//   409 stale_route / route_not_started — удалить события этой эпохи;
//   429 queue_full — пословные старше 1 ч выбросить, остальное держать, не слать
//                    до коммита обмена (`onExchangeCommitted`);
//   429 прочие     — ждать Retry-After;
//   502/503/сеть   — пауза 2, 4, 8 … 60 с;
//   401 / 403      — остановиться (сессия); 404 — маршрут на сервере выключен,
//                    тоже остановиться (решение исполнителя: повтор бессмыслен).
//
// Ведро реплик сайта (M3, line-credit.ts) лежит в том же объекте хранилища
// (`credit`): общее для вкладок, и его чтение-запись идут под той же блокировкой.
//
// Выгрузка страницы (ревью партии 2, C2). Браузер НЕ выдаёт Web Lock странице,
// которую выгружает (замер в Chromium: навигация, перезагрузка, закрытие вкладки,
// bfcache). Поэтому на `pagehide` и `visibilitychange:hidden` буфер вкладки (в нём
// и отчёт, ждущий блокировку: `enqueueDurable` кладёт событие в буфер сразу)
// пишется СИНХРОННО, без блокировки, в СВОЙ запасной ключ страницы
// `flib:route-outbox-unload:<метка>` (повторное ревью R-M2: общий ключ с
// чтением-изменением-записью терял запись соседней вкладки). Чужих ключей
// страница не пишет и не стирает никогда; если ей нечего сохранить — не пишет
// ничего. Записи других страниц вливаются в очередь под блокировкой, без дублей
// по `event_id`, при запуске и в начале каждой пачки (R-L2: и открытая вкладка, и
// выгрузка перед «Выходом» подхватывают записи закрытых вкладок); вкладка,
// вернувшаяся из фона, свою запись просто убирает. Отложенные `afterWrite`
// (отметка `flib:route-watched`) выполняются там же, синхронно.
// Доставка — «хотя бы раз»: у события keepalive есть двойник в хранилище, он
// уйдёт ещё раз, дубли гасит шлюз по `event_id`.
// keepalive делят один бюджет страницы (keepalive-budget.ts, R-L1): браузер
// считает сумму тел в полёте. Не отчёты оставляют запас 4 КиБ под отчёт и
// `PUT progress`; отчёт, который не помещается в оставшееся место, уходит
// короткой формой — `partial` + `played_frac` без массивов, свой `event_id`
// (`…:s`); полный остаётся в хранилище и уйдёт со следующей загрузкой.
//
// «Выход» (C1): `forget()` закрывает очередь — до следующего входа (`resume()`)
// она не пишет НИЧЕГО: ни постановок, ни отложенных отметок, ни ответов пачек.
import { CSRF_HEADERS, refreshSession } from '../../session'
import { parseRetryAfterSec } from '../../retry-after'
import { eraseRouteStorage, keysWithPrefix, ROUTE_OUTBOX_KEY, ROUTE_OUTBOX_UNLOAD_PREFIX } from './route-storage'
import { eventLineCost, msUntil, refillCredit, type LineCredit } from './line-credit'
import { KeepaliveBudget, pageKeepalive } from './keepalive-budget'

export interface RouteEvent {
  event_id: string
  type: string
  puzzle_id: string
  client_ts?: string
  [k: string]: unknown
}

// OutboxItem — `frac` (не уходит в шлюз): доля просмотра полного отчёта, нужна,
// чтобы пересобрать его как `partial` после `full_regressed`.
export interface OutboxItem { route_id: string; event: RouteEvent; frac?: number }

interface Stored { v: 2; items: OutboxItem[]; credit?: LineCredit }

// Запись страницы в её запасном ключе выгрузки; `debit` — реплики, отправленные
// keepalive (списываются из ведра при вливании).
interface UnloadRecord { v: 1; items: OutboxItem[]; debit?: number }

export type FlushResult = 'sent' | 'empty' | 'refused' | 'timeout'

export interface OutboxLocks { request<T>(name: string, fn: () => Promise<T>): Promise<T> }

export interface OutboxDeps {
  storage: Storage | null
  locks: OutboxLocks | null
  fetch: (url: string, init: RequestInit) => Promise<Response>
  now: () => number
  setTimer: (fn: () => void, ms: number) => unknown
  clearTimer: (h: unknown) => void
  newId: () => string
  // keepalive — бюджет keepalive страницы (общий с PUT progress); без него — свой.
  keepalive?: KeepaliveBudget
  // onAuthRefused — события отвергнуты 401/403: перечитать сессию (R-M3).
  onAuthRefused?: () => void
}

export const OUTBOX_MAX_ITEMS = 1000
export const OUTBOX_MAX_BYTES = 1 << 20
export const BATCH_MAX_EVENTS = 100
export const BATCH_MAX_BYTES = 512 << 10
export const KEEPALIVE_MAX_BYTES = 60 << 10
// KEEPALIVE_RESERVE_BYTES — запас, который keepalive не-отчётов оставляет под
// отчёт ролика и PUT progress той же выгрузки (R-L1).
export const KEEPALIVE_RESERVE_BYTES = 4 << 10
// AUTH_REREAD_MIN_MS — перечитывание сессии после 401/403 не чаще раза в минуту:
// снимок active при отвергнутом ключе иначе дал бы петлю POST → 403 → GET → POST.
export const AUTH_REREAD_MIN_MS = 60_000
export const BUFFER_FLUSH_MS = 2000
export const SEND_INTERVAL_MS = 10_000
export const BATCH_PAUSE_MS = 1000
export const LOGOUT_FLUSH_MS = 2000
const POST_TIMEOUT_MS = 20_000
const BACKOFF_MS = [2000, 4000, 8000, 16000, 32000, 60000]
const QUEUE_FULL_WORD_AGE_MS = 3600_000
const LOCK_NAME = 'flib-route-outbox'
export const EVENTS_ENDPOINT = '/api/me/route/events'

// Пословные роды — вытесняются первыми; clip_played и clip_rated — последними.
export const WORD_KINDS: ReadonlySet<string> = new Set([
  'clip_replayed', 'hint_requested', 'line_translated', 'clipboard_copy', 'subtitles_shown',
])
const PRIORITY_KINDS: ReadonlySet<string> = new Set(['clip_played', 'clip_rated'])

const enc = new TextEncoder()
const bytesOf = (v: unknown): number => enc.encode(JSON.stringify(v)).length

function validItem(x: unknown): x is OutboxItem {
  const it = x as OutboxItem
  return !!it && typeof it.route_id === 'string' && !!it.event && typeof it.event === 'object'
    && typeof it.event.event_id === 'string' && typeof it.event.type === 'string'
}

function errorCode(body: unknown): string | null {
  const b = body as { error?: unknown; code?: unknown } | null
  const c = typeof b?.code === 'string' ? b.code : typeof b?.error === 'string' ? b.error : null
  return c && /^[a-z_]{1,64}$/.test(c) ? c : null
}

// evict — потолок 1000 событий / 1 МиБ: первыми уходят старшие пословные, затем
// старшие прочие, clip_played и clip_rated — последними (§4.8).
function evict(s: Stored): number {
  const sizes = s.items.map(bytesOf)
  let total = bytesOf({ ...s, items: [] }) + sizes.reduce((a, b) => a + b + 1, 0)
  let dropped = 0
  const rank = (it: OutboxItem): number => WORD_KINDS.has(it.event.type) ? 0 : PRIORITY_KINDS.has(it.event.type) ? 2 : 1
  while (s.items.length > OUTBOX_MAX_ITEMS || total > OUTBOX_MAX_BYTES) {
    let victim = -1
    for (let r = 0; r <= 2 && victim < 0; r++) victim = s.items.findIndex(it => rank(it) === r)
    if (victim < 0) break
    total -= sizes[victim] + 1
    s.items.splice(victim, 1)
    sizes.splice(victim, 1)
    dropped++
  }
  return dropped
}

export class RouteOutbox {
  private buffer: OutboxItem[] = []
  private mem: Stored | null = null
  private warned = false
  private blockedUntil = 0
  private backoffN = 0
  private hold = false
  private halted = false
  private gen = 0
  private loop: Promise<FlushResult> | null = null
  private bufferTimer: unknown = null
  private running = false
  // closed — «Выход» (здесь или в другой вкладке): до resume() ничего не пишем.
  private closed = false
  // retryUntil — Retry-After шлюза (429) и ожидание ведра: online его не снимает (L4).
  private retryUntil = 0
  // writer — метка записи этой страницы в запасном ключе выгрузки.
  private readonly writer = `p${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
  // afterWrites — отметки, ждущие блокировку (выполняются под ней или синхронно на выгрузке).
  private afterWrites = new Map<string, () => void>()
  // keepaliveSent — event_id, уже отправленные keepalive этой страницей.
  private keepaliveSent = new Set<string>()
  private readonly ka: KeepaliveBudget
  // authRereadAt — когда последний раз перечитывали сессию после 401/403.
  private authRereadAt = -Infinity
  // acceptedListeners — читатели «пачка с отчётами ролика принята» (ревью 3а, H1):
  // страница маршрута перечитывает состояние, посчитанное, возможно, до отчёта.
  private acceptedListeners = new Set<(puzzleIds: string[]) => void>()
  // logoutListeners — страницы, которым есть что поставить перед «Выходом» (урок
  // слов: выросшая доля, финальное ревью PR-B, L5). Зовутся синхронно в начале
  // logoutFlush, их события уходят той же выгрузкой.
  private logoutListeners = new Set<() => void>()

  constructor(private deps: OutboxDeps) {
    this.ka = deps.keepalive ?? new KeepaliveBudget()
    if (!deps.storage) this.toMemory({ v: 2, items: [] })
  }

  // --- хранилище ---------------------------------------------------------------

  private toMemory(s: Stored): void {
    if (!this.warned) {
      this.warned = true
      console.warn('[route] localStorage недоступен — очередь событий маршрута живёт только в этой вкладке')
    }
    this.mem = s
  }

  private read(): Stored {
    if (this.mem) return { ...this.mem, items: [...this.mem.items] }
    try {
      const raw = this.deps.storage!.getItem(ROUTE_OUTBOX_KEY)
      if (!raw) return { v: 2, items: [] }
      const v = JSON.parse(raw) as Partial<Stored>
      if (v?.v !== 2 || !Array.isArray(v.items)) return { v: 2, items: [] }
      return { v: 2, items: v.items.filter(validItem), ...(v.credit ? { credit: v.credit } : {}) }
    } catch {
      return { v: 2, items: [] }
    }
  }

  private write(s: Stored): void {
    const dropped = evict(s)
    if (dropped > 0) console.info(`[route] очередь событий переполнена: вытеснено ${dropped}`)
    if (this.mem) { this.mem = s; return }
    try {
      this.deps.storage!.setItem(ROUTE_OUTBOX_KEY, JSON.stringify(s))
    } catch {
      this.toMemory(s)
    }
  }

  private withLock<T>(fn: () => Promise<T> | T): Promise<T> {
    const run = async () => fn()
    return this.deps.locks ? this.deps.locks.request(LOCK_NAME, run) : run()
  }

  private moveBuffer(): void {
    if (this.closed || this.buffer.length === 0) return
    const s = this.read()
    const have = new Set(s.items.map(it => it.event.event_id))
    for (const it of this.buffer) if (!have.has(it.event.event_id)) { s.items.push(it); have.add(it.event.event_id) }
    this.buffer = []
    this.write(s)
  }

  // runAfterWrites — отложенные отметки (под блокировкой после записи в очередь
  // или синхронно на выгрузке после записи в запасной ключ).
  private runAfterWrites(): void {
    if (this.closed) { this.afterWrites.clear(); return }
    const fns = [...this.afterWrites.values()]
    this.afterWrites.clear()
    for (const fn of fns) { try { fn() } catch { /* отметка не мешает очереди */ } }
  }

  // --- запасные ключи выгрузки -----------------------------------------------------

  private get unloadKey(): string { return ROUTE_OUTBOX_UNLOAD_PREFIX + this.writer }

  private parseUnload(raw: string | null): UnloadRecord | null {
    if (!raw) return null
    try {
      const v = JSON.parse(raw) as Partial<UnloadRecord>
      if (v?.v !== 1 || !Array.isArray(v.items)) return null
      const debit = typeof v.debit === 'number' && Number.isFinite(v.debit) && v.debit > 0 ? v.debit : 0
      return { v: 1, items: v.items.filter(validItem), ...(debit > 0 ? { debit } : {}) }
    } catch {
      return null
    }
  }

  private getRaw(k: string): string | null {
    try { return this.deps.storage?.getItem(k) ?? null } catch { return null }
  }

  private removeKey(k: string): void {
    try { this.deps.storage?.removeItem(k) } catch { /* no-op */ }
  }

  // foreignUnloadKeys — запасные ключи ДРУГИХ страниц.
  private foreignUnloadKeys(): string[] {
    const own = this.unloadKey
    return keysWithPrefix(this.deps.storage, ROUTE_OUTBOX_UNLOAD_PREFIX).filter(k => k !== own)
  }

  // persistNow — синхронная запись буфера вкладки в её запасной ключ (без
  // блокировки). Своя запись заменяется целиком: то, что уже ушло в очередь, в ней
  // не остаётся. Нечего сохранить — ничего не пишем; своя прежняя запись (если
  // была) убирается. Чужие ключи не трогаем никогда (R-M2).
  private persistNow(extraDebit = 0): void {
    if (this.closed || !this.deps.storage) return
    const k = this.unloadKey
    const raw = this.getRaw(k)
    const prev = this.parseUnload(raw)
    const debit = (prev?.debit ?? 0) + extraDebit
    if (this.buffer.length === 0 && debit === 0) {
      if (raw !== null) this.removeKey(k)
      return
    }
    try {
      this.deps.storage.setItem(k, JSON.stringify({ v: 1, items: [...this.buffer], ...(debit > 0 ? { debit } : {}) } satisfies UnloadRecord))
    } catch { /* переполнено — остаётся keepalive */ }
  }

  // dropOwnUnload — страница жива (вернулась из фона): её запись не нужна;
  // реплики, отправленные keepalive, списываются из ведра под блокировкой.
  private dropOwnUnload(): void {
    if (!this.deps.storage) return
    const k = this.unloadKey
    const raw = this.getRaw(k)
    if (raw === null) return
    const mine = this.parseUnload(raw)
    this.removeKey(k)
    const debit = mine?.debit ?? 0
    if (debit > 0) void this.withLock(() => {
      if (this.closed) return
      const s = this.read()
      const c = refillCredit(s.credit, this.deps.now())
      c.level = Math.max(0, c.level - debit)
      s.credit = c
      this.write(s)
    })
  }

  // mergeUnload — под блокировкой: записи других страниц — в очередь, без дублей
  // по event_id; отправленные keepalive реплики — из ведра; влитые ключи стираются.
  // Ключ, который его страница переписала между чтением и стиранием (она жива и
  // снова ушла в фон), не стирается — он вольётся в следующий раз (дубли гасит
  // event_id; его списание реплик тогда учтётся повторно — ведро осторожнее, не щедрее).
  private mergeUnload(): boolean {
    if (this.closed || !this.deps.storage) return false
    const keys = this.foreignUnloadKeys()
    if (keys.length === 0) return false
    const s = this.read()
    const have = new Set(s.items.map(it => it.event.event_id))
    let debit = 0
    const taken: Array<[string, string]> = []
    for (const k of keys) {
      const raw = this.getRaw(k)
      if (raw === null) continue
      const rec = this.parseUnload(raw)
      taken.push([k, raw])
      if (!rec) continue
      debit += rec.debit ?? 0
      for (const it of rec.items) if (!have.has(it.event.event_id)) { s.items.push(it); have.add(it.event.event_id) }
    }
    if (debit > 0) {
      const c = refillCredit(s.credit, this.deps.now())
      c.level = Math.max(0, c.level - debit)
      s.credit = c
    }
    this.write(s)
    for (const [k, raw] of taken) if (this.getRaw(k) === raw) this.removeKey(k)
    return true
  }

  // --- постановка ----------------------------------------------------------------

  // enqueue — событие в буфер вкладки; clip_played/clip_rated — сразу в хранилище
  // и (если очередь запущена) сразу отправка.
  enqueue(routeId: string, event: RouteEvent, opts: { frac?: number } = {}): void {
    if (this.closed) return
    this.buffer.push({ route_id: routeId, event, ...(opts.frac !== undefined ? { frac: opts.frac } : {}) })
    if (PRIORITY_KINDS.has(event.type)) {
      void this.withLock(() => this.moveBuffer()).then(() => this.kick())
      return
    }
    if (this.bufferTimer === null) {
      this.bufferTimer = this.deps.setTimer(() => {
        this.bufferTimer = null
        void this.withLock(() => this.moveBuffer())
      }, BUFFER_FLUSH_MS)
    }
  }

  // enqueueDurable — событие сразу в хранилище; afterWrite выполняется ПОСЛЕ
  // записи и под ТОЙ ЖЕ блокировкой (плеер пишет `flib:route-watched` только
  // так: другая вкладка не видит отметку без отчёта в очереди, §4.2).
  // ⚠️ Событие кладётся в БУФЕР сразу (C2): пока блокировку держит пачка в полёте,
  // его видят pendingClipPlayed и выгрузка страницы.
  async enqueueDurable(routeId: string, event: RouteEvent, opts: { frac?: number; afterWrite?: () => void } = {}): Promise<void> {
    if (this.closed) return
    const gen = this.gen
    this.buffer.push({ route_id: routeId, event, ...(opts.frac !== undefined ? { frac: opts.frac } : {}) })
    if (opts.afterWrite) this.afterWrites.set(event.event_id, opts.afterWrite)
    await this.withLock(() => {
      if (gen !== this.gen || this.closed) return
      this.moveBuffer()
      this.runAfterWrites()
    })
    if (PRIORITY_KINDS.has(event.type)) this.kick()
  }

  // dropClipPlayed — выбросить несданные clip_played ролика (шаг 2 замены, §4.6).
  // afterDrop выполняется под ТОЙ ЖЕ блокировкой сразу после выбрасывания: шаг
  // замены удаляет так запись ролика в `flib:route-watched` (ревью партии 2, L13) —
  // ни одна вкладка не увидит отчёт без записи или запись без отчёта.
  // Сначала под той же блокировкой вливаются записи выгрузки других страниц (ревью
  // 3а, M1): отчёт ролика, оставленный закрытой вкладкой, иначе ушёл бы в выгрузке
  // перед обменом замены.
  async dropClipPlayed(puzzleId: string, opts: { afterDrop?: () => void } = {}): Promise<void> {
    const keep = (it: OutboxItem) => !(it.event.type === 'clip_played' && it.event.puzzle_id === puzzleId && it.event.origin === undefined)
    this.buffer = this.buffer.filter(keep)
    await this.withLock(() => {
      if (this.closed) return
      this.mergeUnload()
      const s = this.read()
      const n = s.items.length
      s.items = s.items.filter(keep)
      if (s.items.length !== n) this.write(s)
      if (opts.afterDrop) { try { opts.afterDrop() } catch { /* запись отметки не мешает очереди */ } }
    })
  }

  // onReportsAccepted — подписка на «пачка с clip_played принята шлюзом (200)»;
  // аргумент — puzzle_id принятых отчётов. Возвращает отписку.
  onReportsAccepted(fn: (puzzleIds: string[]) => void): () => void {
    this.acceptedListeners.add(fn)
    return () => { this.acceptedListeners.delete(fn) }
  }

  // locked — выполнить fn под блокировкой очереди (L13): сторож удаления
  // `flib:route-watched` страницы маршрута читает-меняет-пишет отметки под той же
  // блокировкой, под которой их пишет плеер. После «Выхода» не выполняет ничего.
  async locked(fn: () => void): Promise<void> {
    if (this.closed) return
    await this.withLock(() => {
      if (this.closed) return
      fn()
    })
  }

  // pendingClipPlayed — ролики с clip_played в очереди, ВКЛЮЧАЯ пачку в полёте
  // (она лежит в хранилище до ответа). Читатели: признаки «открыт» / «отчёт не
  // обработан» и сторож удаления `flib:route-watched` (R3-M3, R4-C1).
  pendingClipPlayed(): Set<string> {
    const out = new Set<string>()
    const unload = keysWithPrefix(this.deps.storage, ROUTE_OUTBOX_UNLOAD_PREFIX).flatMap(k => this.parseUnload(this.getRaw(k))?.items ?? [])
    for (const it of [...this.read().items, ...this.buffer, ...unload]) {
      if (it.event.type === 'clip_played' && it.event.origin === undefined && typeof it.event.puzzle_id === 'string') out.add(it.event.puzzle_id)
    }
    return out
  }

  // reserveLineCredit — списать до n реплик из общего ведра сайта (M3); возвращает
  // выданное (≤ n). Читатель — `PUT progress` (progress.ts).
  async reserveLineCredit(n: number): Promise<number> {
    if (!(n > 0) || this.closed) return 0
    return this.withLock(() => {
      if (this.closed) return 0
      const s = this.read()
      const c = refillCredit(s.credit, this.deps.now())
      const granted = Math.max(0, Math.min(Math.floor(n), Math.floor(c.level)))
      c.level -= granted
      s.credit = c
      this.write(s)
      return granted
    })
  }

  onExchangeCommitted(): void { this.hold = false }

  // --- отправка ---------------------------------------------------------------------

  private hasItems(): boolean { return this.buffer.length > 0 || this.read().items.length > 0 }
  private hasForeignUnload(): boolean { return this.foreignUnloadKeys().length > 0 }

  private kick(): void {
    if (this.running) void this.runLoop()
  }

  private runLoop(): Promise<FlushResult> {
    if (this.loop) return this.loop
    const p = this.sendAll().finally(() => { if (this.loop === p) this.loop = null })
    this.loop = p
    return p
  }

  private blocked(): boolean {
    const now = this.deps.now()
    return this.closed || this.halted || this.hold || now < this.blockedUntil || now < this.retryUntil
  }

  private async sendAll(): Promise<FlushResult> {
    let sent = false
    for (;;) {
      if (this.blocked()) return this.hasItems() ? 'refused' : (sent ? 'sent' : 'empty')
      const r = await this.withLock(() => this.sendOneBatch())
      if (r === 'empty') return sent ? 'sent' : 'empty'
      if (r === 'refused') return 'refused'
      sent = true
      if (!this.hasItems()) return 'sent'
      await new Promise<void>(res => this.deps.setTimer(res, BATCH_PAUSE_MS))
    }
  }

  // flush — выгрузить очередь; не дольше timeoutMs. Отправка, не успевшая к
  // сроку, продолжается в фоне. Интерфейс машины обмена (§4.6 п.1).
  async flush(o: { timeoutMs: number }): Promise<FlushResult> {
    const work = (async (): Promise<FlushResult> => {
      await this.withLock(() => this.moveBuffer())
      let r = await this.runLoop()
      // Цикл, начатый раньше, мог закончиться до переноса буфера — ещё раз.
      while (r === 'sent' && this.hasItems() && !this.blocked()) r = await this.runLoop()
      return r
    })()
    let timer: unknown = null
    const timeout = new Promise<FlushResult>(res => { timer = this.deps.setTimer(() => res('timeout'), o.timeoutMs) })
    try {
      return await Promise.race([work, timeout])
    } finally {
      this.deps.clearTimer(timer)
    }
  }

  // pickBatch — пачка одной эпохи: clip_played и clip_rated первыми, ≤ 100
  // событий, ≤ 512 КиБ тела, реплики — по ведру сайта (M3).
  private pickBatch(s: Stored): { routeId: string; items: OutboxItem[]; credit: LineCredit; waitMs: number } {
    const routeId = s.items[0].route_id
    const epoch = s.items.filter(it => it.route_id === routeId)
    const ordered = [...epoch.filter(it => PRIORITY_KINDS.has(it.event.type)), ...epoch.filter(it => !PRIORITY_KINDS.has(it.event.type))]
    const credit = refillCredit(s.credit, this.deps.now())
    let bytes = bytesOf({ route_id: routeId, events: [] })
    let waitMs = 0
    const items: OutboxItem[] = []
    for (const it of ordered) {
      if (items.length >= BATCH_MAX_EVENTS) break
      const b = bytesOf(it.event) + 1
      if (bytes + b > BATCH_MAX_BYTES) continue
      const cost = eventLineCost(it.event)
      if (cost > credit.level) {
        const w = msUntil(credit, cost)
        waitMs = waitMs === 0 ? w : Math.min(waitMs, w)
        continue
      }
      credit.level -= cost
      bytes += b
      items.push(it)
    }
    return { routeId, items, credit, waitMs }
  }

  private async sendOneBatch(): Promise<'ok' | 'empty' | 'refused'> {
    if (this.blocked()) return 'refused'
    this.mergeUnload()
    this.moveBuffer()
    const s = this.read()
    if (s.items.length === 0) return 'empty'
    const pick = this.pickBatch(s)
    if (pick.items.length === 0) {
      if (pick.waitMs > 0) this.retryUntil = this.deps.now() + pick.waitMs
      return 'refused'
    }
    s.credit = pick.credit
    this.write(s)
    return this.postBatch(pick.routeId, pick.items, this.gen)
  }

  private backoff(): void {
    this.blockedUntil = this.deps.now() + BACKOFF_MS[Math.min(this.backoffN, BACKOFF_MS.length - 1)]
    this.backoffN++
  }

  // mutate — изменение хранилища после ответа; после «Выхода» (gen сменился) —
  // ничего не пишем: стёртый ключ не воскресает.
  private mutate(gen: number, fn: (s: Stored) => void): void {
    if (gen !== this.gen || this.closed) return
    const s = this.read()
    fn(s)
    this.write(s)
  }

  private async postBatch(routeId: string, items: OutboxItem[], gen: number): Promise<'ok' | 'refused'> {
    const body = JSON.stringify({ route_id: routeId, events: items.map(it => it.event) })
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null
    const t = this.deps.setTimer(() => ctl?.abort(), POST_TIMEOUT_MS)
    let res: Response
    try {
      res = await this.deps.fetch(EVENTS_ENDPOINT, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', ...CSRF_HEADERS },
        body, ...(ctl ? { signal: ctl.signal } : {}),
      })
    } catch {
      this.deps.clearTimer(t)
      this.backoff()
      return 'refused'
    }
    this.deps.clearTimer(t)
    const data = await res.json().catch(() => null)
    const ids = new Set(items.map(it => it.event.event_id))
    const st = res.status
    // L2: 200 без разбираемого тела (край, туннель) — не удаляем, повторим позже.
    if (st === 200 && typeof (data as { accepted?: unknown } | null)?.accepted !== 'number') {
      this.backoff()
      return 'refused'
    }
    if (st === 200) {
      this.backoffN = 0
      const rejected = Array.isArray((data as { rejected?: unknown })?.rejected) ? (data as { rejected: Array<{ event_id?: unknown; reason?: unknown }> }).rejected : []
      const again: OutboxItem[] = []
      let thrown = 0
      for (const rj of rejected) {
        const it = items.find(x => x.event.event_id === rj.event_id)
        if (!it) continue
        if (rj.reason === 'full_regressed' && it.event.type === 'clip_played' && it.event.subs_report === 'full') {
          const { played_frac: _drop, ...rest } = it.event
          void _drop
          again.push({ route_id: it.route_id, event: { ...rest, event_id: this.deps.newId(), subs_report: 'partial', played_frac: it.frac ?? 0 } })
        } else {
          thrown++
        }
      }
      if (thrown > 0) console.info(`[route] шлюз отверг событий: ${thrown}`)
      this.mutate(gen, s => {
        s.items = s.items.filter(it => !ids.has(it.event.event_id))
        s.items.push(...again)
      })
      const rejIds = new Set(rejected.map(r => r.event_id))
      const accepted = [...new Set(items.filter(it => it.event.type === 'clip_played' && !rejIds.has(it.event.event_id)).map(it => it.event.puzzle_id))]
      if (accepted.length && gen === this.gen && !this.closed) {
        for (const fn of [...this.acceptedListeners]) { try { fn(accepted) } catch { /* читатель не мешает очереди */ } }
      }
      return 'ok'
    }
    if (st === 400 || st === 413) {
      if (items.length > 1) {
        const mid = Math.ceil(items.length / 2)
        for (const half of [items.slice(0, mid), items.slice(mid)]) {
          if (await this.postBatch(routeId, half, gen) === 'refused') return 'refused'
        }
        return 'ok'
      }
      console.info('[route] событие отвергнуто целиком — выброшено')
      this.mutate(gen, s => { s.items = s.items.filter(it => !ids.has(it.event.event_id)) })
      return 'ok'
    }
    const code = errorCode(data)
    if (st === 409 && (code === 'stale_route' || code === 'route_not_started')) {
      this.mutate(gen, s => { s.items = s.items.filter(it => it.route_id !== routeId) })
      return 'ok'
    }
    if (st === 429 && code === 'queue_full') {
      const cut = this.deps.now() - QUEUE_FULL_WORD_AGE_MS
      this.mutate(gen, s => {
        s.items = s.items.filter(it => {
          if (!WORD_KINDS.has(it.event.type)) return true
          const ts = Date.parse(String(it.event.client_ts ?? ''))
          return !(Number.isFinite(ts) && ts < cut)
        })
      })
      this.hold = true
      return 'refused'
    }
    if (st === 429) {
      const sec = parseRetryAfterSec(res.headers.get('Retry-After'), data) ?? 5
      this.retryUntil = this.deps.now() + sec * 1000
      return 'refused'
    }
    if (st === 401 || st === 403 || st === 404) {
      this.halted = true
      // R-M3: продление ключа не шлёт сообщения о входе — перечитываем сессию сами;
      // снимок active (здесь или позже) зовёт resume(). Не чаще раза в минуту.
      const now = this.deps.now()
      if (st !== 404 && now - this.authRereadAt >= AUTH_REREAD_MIN_MS) {
        this.authRereadAt = now
        try { this.deps.onAuthRefused?.() } catch { /* no-op */ }
      }
      return 'refused'
    }
    this.backoff()
    return 'refused'
  }

  // --- pagehide, запуск, «Выход» -----------------------------------------------------

  // onPagehide — выгрузка страницы (C2): синхронная запись буфера в запасной
  // ключ, отложенные отметки, keepalive ≤ 60 КиБ. `extra` — события, которых ещё
  // нет ни в очереди, ни в буфере. keepalive не уходит, когда очередь остановлена,
  // удержана или ждёт Retry-After; запись в хранилище делается всегда (кроме
  // закрытой очереди).
  onPagehide(extra: OutboxItem[] = []): void {
    if (this.closed) return
    for (const it of extra) if (!this.buffer.some(b => b.event.event_id === it.event.event_id)) this.buffer.push(it)
    let debit = 0
    const now = this.deps.now()
    const canSend = !this.halted && !this.hold && now >= this.retryUntil
    const all = [...this.buffer, ...this.read().items].filter(it => !this.keepaliveSent.has(it.event.event_id))
    if (canSend && all.length > 0) {
      const routeId = all[0].route_id
      const credit = refillCredit(this.read().credit, now)
      const epoch = all.filter(it => it.route_id === routeId)
      const ordered = [...epoch.filter(it => PRIORITY_KINDS.has(it.event.type)), ...epoch.filter(it => !PRIORITY_KINDS.has(it.event.type))]
      // Отчёты (clip_played, clip_rated) берут всё оставшееся место бюджета,
      // остальные оставляют запас под отчёт и PUT progress (R-L1).
      const capReport = Math.min(KEEPALIVE_MAX_BYTES, this.ka.room())
      const capOther = Math.max(0, capReport - KEEPALIVE_RESERVE_BYTES)
      const events: RouteEvent[] = []
      const picked: string[] = []
      let cost = 0
      let bytes = bytesOf({ route_id: routeId, events: [] })
      for (const it of ordered) {
        if (events.length >= BATCH_MAX_EVENTS) break
        const cap = PRIORITY_KINDS.has(it.event.type) ? capReport : capOther
        let e = it.event
        let b = bytesOf(e) + 1
        if (bytes + b > cap && e.type === 'clip_played') {
          const sh = shortClipPlayed(it)
          if (!sh) continue
          e = sh
          b = bytesOf(e) + 1
        }
        if (bytes + b > cap) continue
        const c = eventLineCost(e)
        if (c > credit.level) continue
        credit.level -= c
        cost += c
        bytes += b
        events.push(e)
        picked.push(it.event.event_id)
      }
      if (events.length > 0) {
        const sent = this.ka.send(this.deps.fetch, EVENTS_ENDPOINT, {
          method: 'POST', credentials: 'same-origin', keepalive: true,
          headers: { 'Content-Type': 'application/json', ...CSRF_HEADERS },
          body: JSON.stringify({ route_id: routeId, events }),
        })
        if (sent) {
          debit = cost
          for (const id of picked) this.keepaliveSent.add(id)
        }
      }
    }
    this.persistNow(debit)
    this.runAfterWrites()
  }

  // onHidden — вкладка ушла в фон: только синхронная запись (без keepalive).
  onHidden(): void {
    if (this.closed) return
    this.persistNow()
  }

  // start — таймер отправки (раз в 10 с при непустой очереди), pagehide, online.
  start(): () => void {
    if (this.running) return () => this.stop()
    this.running = true
    let timer: unknown = null
    const tick = () => {
      timer = this.deps.setTimer(tick, SEND_INTERVAL_MS)
      if (this.hasItems() || this.hasForeignUnload()) void this.runLoop()
    }
    timer = this.deps.setTimer(tick, SEND_INTERVAL_MS)
    const onHide = () => this.onPagehide()
    // L4: online снимает только паузы сбоев, не Retry-After шлюза.
    const onOnline = () => { this.blockedUntil = 0; this.backoffN = 0; this.kick() }
    const onVis = () => {
      if (typeof document === 'undefined') return
      if (document.visibilityState === 'hidden') this.onHidden()
      else this.dropOwnUnload()
    }
    const onShow = () => this.dropOwnUnload()
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', onHide)
      window.addEventListener('online', onOnline)
      window.addEventListener('pageshow', onShow)
    }
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis)
    this.stopFn = () => {
      this.deps.clearTimer(timer)
      if (typeof window !== 'undefined') {
        window.removeEventListener('pagehide', onHide)
        window.removeEventListener('online', onOnline)
        window.removeEventListener('pageshow', onShow)
      }
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis)
    }
    // Записи выгруженных страниц — в очередь (под блокировкой), затем отправка.
    const had = this.hasItems()
    void this.withLock(() => this.mergeUnload()).then(merged => { if (had || merged) void this.runLoop() })
    return () => this.stop()
  }

  private stopFn: (() => void) | null = null

  stop(): void {
    this.running = false
    this.stopFn?.()
    this.stopFn = null
  }

  // resume — сессия снова активна: новый вход после «Выхода» (closed), продление
  // ключа после 403 (halted) — очередь снова принимает и шлёт события (M3 ревью).
  // Зовётся на КАЖДОМ подтверждённом снимке active (R-M3): одна дешёвая попытка;
  // ключ всё ещё отвергнут — очередь снова остановится. Идёт отправка — новая
  // попытка после неё (иначе снятый halted увидела бы только следующая пачка).
  resume(): void {
    this.closed = false
    this.halted = false
    if (this.loop) void this.loop.then(() => this.kick())
    else this.kick()
  }

  isClosed(): boolean { return this.closed }

  // generation — поколение сессии вкладки: растёт на каждом «Выходе» (forget).
  // Читатель — страница урока: поздний ответ примеров, запрошенный в прошлом
  // поколении, не пишется после нового входа (ревью 3b, R1-L3).
  generation(): number { return this.gen }

  // onBeforeLogout — подписка «перед выгрузкой «Выхода» поставь своё»; возвращает
  // отписку. Слушатель ставит события синхронно (enqueueDurable кладёт событие в
  // буфер сразу), поэтому они уходят в ту же выгрузку и в тот же срок 2 с.
  onBeforeLogout(fn: () => void): () => void {
    this.logoutListeners.add(fn)
    return () => { this.logoutListeners.delete(fn) }
  }

  // logoutFlush — выгрузка перед «Выходом», не дольше 2 с (§4.8). Сначала —
  // постановки страниц (onBeforeLogout), как при обычном уходе со страницы.
  async logoutFlush(): Promise<void> {
    for (const fn of [...this.logoutListeners]) { try { fn() } catch { /* постановка не мешает выходу */ } }
    await this.flush({ timeoutMs: LOGOUT_FLUSH_MS })
  }

  // eraseAfterLogout — «Выход» удался: буфер и память вкладки сброшены, пять
  // ключей маршрута стёрты (§6.2, R2-C1); ответы пачек в полёте ничего не пишут.
  // Стирание повторяется под блокировкой: пачка другой вкладки, ответ которой
  // пришёл до её сообщения о «Выходе», не воскрешает ключ (ревью P12).
  eraseAfterLogout(): void {
    this.forget()
    eraseRouteStorage(this.deps.storage)
    void this.withLock(() => { eraseRouteStorage(this.deps.storage) })
  }

  // forget — вышли (здесь или в другой вкладке): буфер вкладки и память очереди
  // сброшены, ответы пачек в полёте больше ничего не пишут.
  forget(): void {
    this.closed = true
    this.gen++
    this.buffer = []
    this.afterWrites.clear()
    this.keepaliveSent.clear()
    if (this.bufferTimer !== null) { this.deps.clearTimer(this.bufferTimer); this.bufferTimer = null }
    if (this.mem) this.mem = { v: 2, items: [] }
    this.stop()
  }
}

// shortClipPlayed — короткая форма отчёта для keepalive (C2): `partial` +
// `played_frac` без массивов, свой event_id; проходит правила полей шлюза
// (checkSubs: `partial` допускает пустой состав). Полный отчёт остаётся в хранилище.
export function shortClipPlayed(it: OutboxItem): RouteEvent | null {
  const e = it.event
  const frac = typeof it.frac === 'number' ? it.frac : typeof e.played_frac === 'number' ? e.played_frac : null
  if (frac === null) return null
  const id = `${e.event_id}:s`
  if (id.length > 128) return null
  const out: RouteEvent = { event_id: id, type: 'clip_played', puzzle_id: e.puzzle_id, subs_report: 'partial', played_frac: Number(Math.min(1, Math.max(0, frac)).toFixed(3)) }
  if (typeof e.subs_source === 'string') out.subs_source = e.subs_source
  if (e.origin === 'more') out.origin = 'more'
  if (typeof e.learning_day === 'string') out.learning_day = e.learning_day
  if (typeof e.client_ts === 'string') out.client_ts = e.client_ts
  return out
}

// --- экземпляр вкладки -----------------------------------------------------------

let instance: RouteOutbox | null = null

function browserLocks(): OutboxLocks | null {
  const l = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined
  if (!l || typeof l.request !== 'function') return null
  return { request: <T>(name: string, fn: () => Promise<T>) => l.request(name, fn) as Promise<T> }
}

export function newEventId(): string {
  const c = typeof crypto !== 'undefined' ? crypto : undefined
  if (c && typeof c.randomUUID === 'function') return `web:${c.randomUUID()}`
  const hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
  return `web:${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`
}

export function getRouteOutbox(): RouteOutbox {
  if (instance) return instance
  let storage: Storage | null = null
  try { storage = typeof window !== 'undefined' ? window.localStorage : null } catch { storage = null }
  instance = new RouteOutbox({
    storage,
    locks: browserLocks(),
    fetch: (url, init) => fetch(url, init),
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: h => clearTimeout(h as ReturnType<typeof setTimeout>),
    newId: newEventId,
    keepalive: pageKeepalive,
    onAuthRefused: () => { void refreshSession().catch(() => undefined) },
  })
  return instance
}

export function __resetRouteOutboxForTests(): void {
  instance?.forget()
  instance = null
}
