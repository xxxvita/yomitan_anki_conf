// session.ts — сессия кабинета в браузере (спека 2026-11-17 §3.3, §3.6).
//
// Ключ пользователя в браузере НЕ хранится: он живёт в HttpOnly-cookie
// `__Host-flib_session`, которую ставит BFF. Здесь — только снимок
// `GET /api/session` (префикс ключа, срок, демо, права), его обновление и
// рассылка по вкладкам. Сырой ключ проходит через этот модуль ровно один раз —
// аргументом `loginWithKey` — и не сохраняется ни в памяти, ни в хранилище.
//
// Снимок обновляется: при старте (`startSession` из main.tsx), при возврате на
// вкладку после 5 мин в фоне, по `401` (`refreshSession`), по сообщению
// `login` из другой вкладки. `logout` из другой вкладки обнуляет снимок сразу.
// Плохое состояние (сеть/5xx или state:"unknown") перечитывается само, с
// нарастающей паузой, а также сразу по возврату на вкладку и фокусу окна
// (ревью A5–A8 H-1): шлюз вернулся — права вернулись без перезагрузки.
//
// Режим страницы задаёт метка BFF в index.html — `<meta name="flib-cabinet"
// content="1">`, она есть ТОЛЬКО при CABINET_ENABLED=1 (ревью C-2a, C-3):
// без метки страницы ведут себя как до кабинета сразу, не дожидаясь снимка.
// Перенос старого ключа `flib:tpk` по-прежнему решает ответ сервера
// (`cabinet:true`, §3.6).
import { clearAllKnowledgeHistory } from './cabinet/knowledge/knowledge-history'
import { loadKey } from './access'
import { parseRetryAfterSec } from './retry-after'

export type SessionState = 'active' | 'expired' | 'unknown'

// Причина «не залогинен». Серверные: unreadable, invalid, revoked,
// session_expired. Локальные: logout — вышли в другой вкладке (текст «Вы
// вышли из кабинета»), self_logout — «Выход» в этой вкладке.
export type SessionReason = 'unreadable' | 'invalid' | 'revoked' | 'session_expired' | 'logout' | 'self_logout'

export interface SessionSnapshot {
  // loading — ответа ещё нет; off — BFF ответил 404 (сессии нет на сервере);
  // ready — снимок с сервера; error — сеть или 5xx, режим неизвестен.
  status: 'loading' | 'off' | 'ready' | 'error'
  cabinet: boolean
  authenticated: boolean
  state: SessionState | null
  reason: SessionReason | null
  keyPrefix: string
  demo: boolean
  keyExpiresAt: string | null
  shadowing: boolean
  routeAllowed: boolean
  // catalog — каталог тайтлов включён на сервере (поле `catalog` GET /api/session).
  catalog: boolean
  // failures — неудачные чтения подряд (сеть, 5xx, таймаут); 0 после удачного.
  failures: number
}

const LOADING: SessionSnapshot = {
  status: 'loading', cabinet: false, authenticated: false, state: null, reason: null,
  keyPrefix: '', demo: false, keyExpiresAt: null, shadowing: false, routeAllowed: false,
  catalog: false,
  failures: 0,
}

const LEGACY_KEYS = ['flib:tpk', 'flib:access', 'flib:tpk-migrate']
const MIGRATE_KEY = 'flib:tpk-migrate'
const CHANNEL = 'flib-session'
const STALE_AFTER_MS = 5 * 60 * 1000
const MIGRATE_MAX_FAILS = 3
// Срок одного чтения GET /api/session. Без метки (кабинет выключен) — 3 с:
// снимок нужен только тем, кто держит cookie после отката флага. С меткой —
// дольше подтверждающей пробы BFF (до ~21,5 с при сбое шлюза).
const READ_TIMEOUT_OFF_MS = 3000
const READ_TIMEOUT_ON_MS = 25000
// Паузы повторов: сбой чтения — 1, 2, 4 с (окно входа ждёт ровно три повтора),
// затем 15 и 30 с; state:"unknown" от BFF (шлюз недоступен) — 2, 5, 15, 30 с.
const ERROR_DELAYS_MS = [1000, 2000, 4000, 15000, 30000]
const UNKNOWN_DELAYS_MS = [2000, 5000, 15000, 30000]
// После стольких неудач подряд окно входа показывает «Сервер сейчас не отвечает».
export const LOGIN_GIVE_UP_FAILURES = 4

// Заголовки сторожа CSRF (§3.4): без X-Flib-Request меняющий запрос BFF
// отвергает. Origin и Sec-Fetch-Site браузер ставит сам.
export const CSRF_HEADERS: Record<string, string> = { 'X-Flib-Request': '1' }

let snap: SessionSnapshot = LOADING
const listeners = new Set<() => void>()
let inflight: Promise<SessionSnapshot> | null = null
// inflightCtl — AbortController текущего чтения: «Выход» обрывает его до
// DELETE (финальное ревью F-1).
let inflightCtl: AbortController | null = null
// logoutPending — идёт «Выход»: новые чтения ждут его конца.
let logoutPending: Promise<void> | null = null
// gen растёт на каждом входе, выходе и сообщении канала: ответ GET, начатого
// раньше, их не перетирает (ревью L-3).
let gen = 0
// epoch растёт только в __resetSessionForTests: ответ чтения, начатого до
// сброса, ничего не пишет и нового чтения не начинает.
let epoch = 0
// sweepSent — эта вкладка уже послала DELETE-уборку по свежему logged_out
// (diff-ревью F-3, правило 2); сбрасывается входом. sweepPending — эта уборка
// ещё в пути: вход ждёт её ответа, иначе её Set-Cookie мог бы стереть новую
// cookie.
let sweepSent = false
let sweepPending: Promise<unknown> | null = null
let retryTimer: ReturnType<typeof setTimeout> | null = null
let retryN = 0
let channel: BroadcastChannel | null = null
let hiddenAt: number | null = null
let started = false
let detach: (() => void) | null = null

// cabinetMarked — метка BFF в index.html: кабинет включён.
export function cabinetMarked(): boolean {
  if (typeof document === 'undefined') return false
  return document.querySelector('meta[name="flib-cabinet"][content="1"]') !== null
}

// degraded — снимок ненадёжен и перечитывается сам: сбой чтения (в том числе
// над снимком «ready, не вошёл» — ревью раунда 2 R2-C1 (b): иначе упавшее
// чтение после login из другой вкладки не повторялось) или state:"unknown".
function degraded(s: SessionSnapshot): boolean {
  return s.status === 'error' || s.failures > 0 || (s.status === 'ready' && s.authenticated && s.state === 'unknown')
}

// scheduleRetry — плохое состояние перечитывается само; хорошее снимает таймер.
function scheduleRetry(): void {
  if (!degraded(snap)) {
    if (retryTimer) clearTimeout(retryTimer)
    retryTimer = null
    retryN = 0
    return
  }
  if (retryTimer) return
  const delays = snap.status === 'error' || snap.failures > 0 ? ERROR_DELAYS_MS : UNKNOWN_DELAYS_MS
  const delay = delays[Math.min(retryN, delays.length - 1)]
  retryN++
  retryTimer = setTimeout(() => { retryTimer = null; void refreshSession() }, delay)
}

function setSnap(next: SessionSnapshot, external = false): void {
  if (external) gen++
  snap = next
  // Кабинет включён и сессия активна — старые ключи браузера не нужны: стираем
  // при первой встрече (вкладка до деплоя или старое окно могли их записать;
  // ревью L-5).
  if (next.cabinet && isActiveSession(next)) clearLegacyKeys()
  scheduleRetry()
  for (const l of listeners) l()
}

export function getSession(): SessionSnapshot {
  return snap
}

// sessionGen — растёт на каждом входе, выходе и сообщении канала; кэши, зависящие от
// того, КТО вошёл (названия роликов), сверяют его, потому что два ключа могут
// делить префикс.
export function sessionGen(): number {
  return gen
}

export function subscribeSession(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

// isActiveSession — сессия отвечает за доступ ТОЛЬКО в этом случае (§3.6):
// при expired/unknown/нет ответа/404 читатели идут по старому пути.
export function isActiveSession(s: SessionSnapshot = snap): boolean {
  return s.status === 'ready' && s.authenticated && s.state === 'active'
}

// clearLegacyKeys — стирает старый ключ браузера и его снимок. Зовётся после
// КАЖДОГО успешного POST /api/session и в действии «Выход» кабинета, но НЕ в
// обёртке DELETE /api/session: её зовёт и старое окно входа сразу после записи
// flib:tpk (§3.3, N-I2).
export function clearLegacyKeys(): void {
  for (const k of LEGACY_KEYS) {
    try { window.localStorage.removeItem(k) } catch { /* хранилище недоступно */ }
  }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function parseSnapshot(body: unknown): SessionSnapshot {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const cabinet = b.cabinet === true
  if (b.authenticated !== true) {
    const r = str(b.reason)
    // logged_out — cookie сессии, вышедшей недавно (надгробие BFF, F-1): «вы вышли».
    const reason = r === 'logged_out' ? 'logout' : (['unreadable', 'invalid', 'revoked', 'session_expired'] as const).find(x => x === r) ?? null
    return { ...LOADING, status: 'ready', cabinet, catalog: b.catalog === true, reason }
  }
  const st = str(b.state)
  const state: SessionState = st === 'active' || st === 'expired' ? st : 'unknown'
  return {
    ...LOADING,
    status: 'ready', cabinet, catalog: b.catalog === true, authenticated: true, state, reason: null,
    keyPrefix: str(b.key_prefix), demo: b.demo !== false,
    keyExpiresAt: typeof b.key_expires_at === 'string' ? b.key_expires_at : null,
    shadowing: state === 'active' && b.shadowing === true,
    routeAllowed: state === 'active' && b.route_allowed === true,
  }
}

async function fetchSnapshot(ctl: AbortController = new AbortController()): Promise<SessionSnapshot> {
  const t = setTimeout(() => ctl.abort(), cabinetMarked() ? READ_TIMEOUT_ON_MS : READ_TIMEOUT_OFF_MS)
  try {
    let resp: Response
    try {
      resp = await fetch('/api/session', { credentials: 'same-origin', headers: { Accept: 'application/json' }, signal: ctl.signal })
    } catch {
      return { ...LOADING, status: 'error' }
    }
    if (resp.status === 404) return { ...LOADING, status: 'off' }
    if (!resp.ok) return { ...LOADING, status: 'error' }
    try {
      return parseSnapshot(await resp.json())
    } catch {
      return { ...LOADING, status: 'error' }
    }
  } finally {
    clearTimeout(t)
  }
}

// refreshSession — перечитать GET /api/session. Одновременные вызовы делят
// один запрос. Ошибка сети не затирает уже известный снимок `ready`: режим
// сайта не прыгает из-за одного сбоя (сессия отвечает только при active).
// Ответ, начатый до входа, выхода или сообщения канала, отбрасывается — и
// тогда СРАЗУ начинается новое чтение (ревью раунда 1 R1-C1): иначе login из
// другой вкладки во время первого чтения оставлял снимок «loading» навсегда.
export function refreshSession(): Promise<SessionSnapshot> {
  if (logoutPending) return logoutPending.then(() => refreshSession())
  if (inflight) return inflight
  const g = gen
  const e = epoch
  const ctl = new AbortController()
  inflightCtl = ctl
  inflight = fetchSnapshot(ctl).then(next => {
    if (e !== epoch) return snap
    inflight = null
    inflightCtl = null
    if (g !== gen) return refreshSession()
    const failures = next.status === 'error' ? snap.failures + 1 : 0
    if (next.status === 'error' && snap.status === 'ready') {
      // Известный режим сохраняем, но сессия больше не «активна» наверняка.
      setSnap(snap.authenticated
        ? { ...snap, state: 'unknown', shadowing: false, routeAllowed: false, failures }
        : { ...snap, failures })
    } else {
      setSnap({ ...next, failures })
      if (next.status === 'ready' && next.reason === 'logout') sweepStaleCookie()
    }
    return snap
  })
  return inflight
}

// sweepStaleCookie — свежее чтение (ни входа в этой вкладке, ни сообщения
// канала с его начала — иначе ответ отброшен по gen) ответило logged_out: BFF
// эту сессию уже считает вышедшей, а cookie в браузере осталась (ответ на
// DELETE «Выхода» потерян или её вернул запрос другой вкладки — diff-ревью
// F-3, правило 2). Один DELETE её стирает. Не больше одного на вкладку до
// следующего входа — без петли, если DELETE не доходит.
function sweepStaleCookie(): void {
  if (sweepSent) return
  sweepSent = true
  const p: Promise<unknown> = deleteStatus().finally(() => { if (sweepPending === p) sweepPending = null })
  sweepPending = p
}

// ensureSession — снимок, дождавшись первого ответа сервера.
export function ensureSession(): Promise<SessionSnapshot> {
  if (snap.status !== 'loading') return Promise.resolve(snap)
  return refreshSession()
}

function broadcast(type: 'login' | 'logout'): void {
  try { channel?.postMessage({ type }) } catch { /* канал закрыт */ }
}

// --- вход -----------------------------------------------------------------

export type LoginResult =
  | { kind: 'ok' }
  | { kind: 'bad_format' }
  | { kind: 'invalid' }
  | { kind: 'expired' }
  | { kind: 'revoked' }
  | { kind: 'too_many'; retryAfterSec: number }
  | { kind: 'busy'; retryAfterSec: number }
  | { kind: 'unavailable' }
  | { kind: 'off' }

// loginWithKey — POST /api/session {key}. Успех → clearLegacyKeys(), снимок
// из ответа, сообщение `login` другим вкладкам. Ключ нигде не остаётся.
export async function loginWithKey(key: string): Promise<LoginResult> {
  // DELETE-уборка ещё в пути — ждём её ответа: пришедший после POST, он стёр бы
  // новую cookie (то же имя).
  if (sweepPending) await sweepPending
  let resp: Response
  try {
    resp = await fetch('/api/session', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...CSRF_HEADERS },
      body: JSON.stringify({ key: key.trim() }),
    })
  } catch {
    return { kind: 'unavailable' }
  }
  let body: Record<string, unknown> = {}
  try { body = (await resp.json()) as Record<string, unknown> } catch { /* не JSON */ }
  const code = str(body?.error)
  const retry = Math.max(1, Math.ceil(parseRetryAfterSec(resp.headers.get('Retry-After'), body) ?? 1))
  switch (resp.status) {
    case 200: {
      // 200 без тела BFF (прокси, заглушка) входом не считается (ревью L-2).
      if (typeof body?.key_prefix !== 'string') return { kind: 'unavailable' }
      clearLegacyKeys()
      sweepSent = false // новая cookie: её будущий остаток можно убрать снова
      setSnap(parseSnapshot({ ...body, authenticated: true, state: 'active', cabinet: true }), true)
      broadcast('login')
      return { kind: 'ok' }
    }
    case 400: return { kind: 'bad_format' }
    case 401: return { kind: 'invalid' }
    case 403:
      if (code === 'key_expired') return { kind: 'expired' }
      if (code === 'key_revoked') return { kind: 'revoked' }
      return { kind: 'unavailable' }
    case 404: return { kind: 'off' }
    case 429:
      return code === 'busy' ? { kind: 'busy', retryAfterSec: retry } : { kind: 'too_many', retryAfterSec: retry }
  }
  return { kind: 'unavailable' }
}

// --- выход ----------------------------------------------------------------

// DELETE_TIMEOUT_MS — срок одного DELETE /api/session: зависший запрос не
// должен держать чтения сессии этой вкладки (они ждут конца «Выхода»);
// истёкший срок — неудача выхода (повторное ревью F-1, LOW).
const DELETE_TIMEOUT_MS = 10_000

async function deleteStatus(): Promise<number | null> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), DELETE_TIMEOUT_MS)
  try {
    const resp = await fetch('/api/session', { method: 'DELETE', credentials: 'same-origin', headers: { ...CSRF_HEADERS }, signal: ctl.signal })
    return resp.status
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

// deleteSession — DELETE /api/session: стирает cookie. Общая обёртка — её
// зовёт и старое окно входа (§3.6, N-I3), поэтому старые ключи браузера она
// НЕ трогает. true — cookie стёрта или сессии на сервере нет (404): для
// старого окна это «стирать нечего».
export async function deleteSession(): Promise<boolean> {
  const st = await deleteStatus()
  return st !== null && (st === 204 || st === 404 || (st >= 200 && st < 300))
}

// dropSessionCookie — старое окно входа (кабинет выключен) после успешной
// проверки ключа: стереть cookie, сообщить другим вкладкам и перечитать снимок,
// чтобы гейт Shadowing в этой и других вкладках перешёл на новый ключ
// (flib:access), а не на снимок стёртой cookie (ревью LM3, L-6).
export async function dropSessionCookie(): Promise<void> {
  if (await deleteSession()) broadcast('logout')
  await refreshSession()
}

// cabinetLogout — действие «Выход» кабинета (§3.3): выгрузка очереди событий
// (подключит B6) → DELETE → clearLegacyKeys() → канал. Старые ключи стираются
// при любом исходе: выход на общем компьютере обязан держаться.
//
// Чтение GET /api/session, начатое до «Выхода», обрывается ДО DELETE (финальное
// ревью F-1): его ответ мог прийти после 204 с перевыдачей cookie и вернуть
// сессию (оборванный fetch, чьи заголовки не пришли, Set-Cookie не применяет;
// BFF к тому же держит надгробие sid). Его результат отбрасывается без нового
// чтения; чтения, запрошенные во время выхода, ждут его конца.
//
// После DELETE — с ЛЮБЫМ исходом — перечитывание; пока оно не показало, что
// cookie нет (cookieGone), DELETE повторяется и снова перечитывается, до
// LOGOUT_REPEATS раз; упавший повтор DELETE прекращает попытки. «Вышел» — ТОЛЬКО
// после удачного перечитывания, не показавшего cookie (diff-ревью F-3): ни
// исход DELETE, ни logged_out этого не доказывают. 204 мог не дойти (сеть, 52x
// по дороге назад, срок 10 с), хотя BFF выход обработал и положил надгробие —
// тогда cookie в браузере, перечитывание отвечает logged_out, а через срок
// надгробия (10 мин) сессия снова жива. 404 на DELETE — пропал SESSION_KEYS
// (ревью C-2b): GET тоже 404, «вышел» не скажем. Иначе false и кабинет на месте
// («Не удалось выйти»).
//
// LOGOUT_REPEATS — сколько раз повторить DELETE, если перечитывание не
// показало, что cookie нет (R-1, F-3).
const LOGOUT_REPEATS = 2

// cookieGone — удачное чтение, по которому cookie сессии в браузере нет: ready,
// не вошёл, и причина не logged_out (надгробие BFF при живой cookie;
// parseSnapshot переводит его в 'logout') и не unreadable (cookie предъявлена,
// BFF её не стирает). invalid/revoked/session_expired BFF отвечает, стирая
// cookie тем же ответом.
function cookieGone(s: SessionSnapshot): boolean {
  return s.status === 'ready' && !s.authenticated && s.reason !== 'logout' && s.reason !== 'unreadable'
}

// LogoutHooks — маршрут кабинета (план B6): перед DELETE очередь событий
// выгружается (не дольше 2 с, cookie ещё жива), после УДАЧНОГО «Выхода»
// стираются пять ключей маршрута (§6.2, R2-C1). Неудачный «Выход» ничего не
// стирает — человек остаётся в кабинете вместе со своей очередью. Хук ставит
// route-lifecycle.ts только при метке маршрута; без неё «Выход» прежний.
export interface LogoutHooks { beforeLogout(): Promise<void>; afterLogout(): void }
let logoutHooks: LogoutHooks | null = null
export function setLogoutHooks(h: LogoutHooks | null): void { logoutHooks = h }

export async function cabinetLogout(): Promise<boolean> {
  clearLegacyKeys()
  if (logoutHooks) {
    try { await logoutHooks.beforeLogout() } catch { /* выгрузка не мешает выходу */ }
  }
  let done: () => void = () => {}
  logoutPending = new Promise<void>(res => { done = res })
  const finish = () => { logoutPending = null; done() }
  epoch++ // ответ оборванного чтения ничего не пишет и нового чтения не начинает
  inflightCtl?.abort()
  inflightCtl = null
  inflight = null
  try {
    await deleteStatus()
    clearLegacyKeys()
    // Перечитывание после любого исхода DELETE. Cookie в браузере ещё может
    // быть: ответ на DELETE потерян (F-3) или её вернул запрос ДРУГОЙ вкладки —
    // отвеченный другим подом во время выкатки или в окне микросекунд после
    // последней проверки надгробия (повторное ревью F-1, R-1). Тогда DELETE ещё
    // раз и снова перечитать, не больше LOGOUT_REPEATS раз.
    let after = await fetchSnapshot()
    for (let i = 0; i < LOGOUT_REPEATS && !cookieGone(after); i++) {
      const again = await deleteStatus()
      if (again !== 204) break
      after = await fetchSnapshot()
    }
    // Последнее чтение не показало, что cookie нет (logged_out, unreadable,
    // «вошёл», сбой чтения, упавший повтор DELETE) — выход не удался: «вышел»
    // не говорим, окно покажет «Не удалось выйти» (D-1, F-3). Снимок меняем
    // только на «вошёл» от сервера; иначе остаётся прежний.
    if (!cookieGone(after)) {
      if (after.status === 'ready' && after.authenticated) setSnap({ ...after, failures: 0 }, true)
      return false
    }
    clearAllKnowledgeHistory() // история «Моих знаний» не должна пережить сессию на общем компьютере
    try { logoutHooks?.afterLogout() } catch { /* no-op */ }
    setSnap({ ...LOADING, status: 'ready', cabinet: snap.cabinet, reason: 'self_logout' }, true)
    broadcast('logout')
    return true
  } finally {
    finish()
  }
}

// --- перенос старого ключа (§3.6) ----------------------------------------------

interface MigrateRecord { fails: number; last_day: string }

function today(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

function loadMigrate(): MigrateRecord {
  try {
    const raw = window.localStorage.getItem(MIGRATE_KEY)
    const v = raw ? JSON.parse(raw) : null
    if (v && typeof v.fails === 'number' && typeof v.last_day === 'string') return { fails: v.fails, last_day: v.last_day }
  } catch { /* битая запись — как пустая */ }
  return { fails: 0, last_day: '' }
}

function saveMigrate(r: MigrateRecord): void {
  try { window.localStorage.setItem(MIGRATE_KEY, JSON.stringify(r)) } catch { /* no-op */ }
}

export type MigrateOutcome = 'skipped' | LoginResult['kind']

// migrateLegacyKey — один POST /api/session со старым ключом `flib:tpk`, если
// кабинет включён, сессии нет и сегодня попытки ещё не было. Таблица §3.6:
// 200 и key_revoked — стереть; invalid_key — счётчик, стереть после трёх в
// разные дни; key_expired — оставить, не чаще раза в сутки; 429/502/503/сеть —
// оставить, повтор при следующей загрузке.
export async function migrateLegacyKey(now: Date = new Date()): Promise<MigrateOutcome> {
  const s = snap
  if (s.status !== 'ready' || !s.cabinet || s.authenticated) return 'skipped'
  const key = loadKey()
  if (!key) return 'skipped'
  const rec = loadMigrate()
  const day = today(now)
  if (rec.last_day === day) return 'skipped'
  const res = await loginWithKey(key)
  // Пока ответ шёл, ключ стёрли (ручной вход, «Выход»): записывать нечего
  // (ревью L-4).
  if (loadKey() !== key) return res.kind
  switch (res.kind) {
    case 'ok': // clearLegacyKeys() уже вызван внутри loginWithKey
      break
    case 'revoked':
      clearLegacyKeys()
      break
    case 'invalid': {
      const fails = rec.fails + 1
      if (fails >= MIGRATE_MAX_FAILS) clearLegacyKeys()
      else saveMigrate({ fails, last_day: day })
      break
    }
    case 'expired':
      saveMigrate({ fails: rec.fails, last_day: day })
      break
  }
  return res.kind
}

// --- старт ----------------------------------------------------------------

function onChannelMessage(ev: MessageEvent): void {
  const type = (ev.data as { type?: unknown } | null)?.type
  if (type === 'logout') {
    // Первого ответа ещё нет — режим берём из метки страницы (ревью R1-L1),
    // иначе страница с меткой решила бы, что кабинет выключен.
    const cabinet = snap.status === 'ready' ? snap.cabinet : cabinetMarked()
    setSnap({ ...LOADING, status: 'ready', cabinet, reason: 'logout' }, true)
  } else if (type === 'login') {
    sweepSent = false // вход в другой вкладке — новая cookie браузера
    gen++
    void refreshSession()
  }
}

function onVisibility(): void {
  if (document.visibilityState === 'hidden') {
    hiddenAt = Date.now()
    return
  }
  if (degraded(snap) || (hiddenAt != null && Date.now() - hiddenAt > STALE_AFTER_MS)) void refreshSession()
  hiddenAt = null
}

function onFocus(): void {
  if (degraded(snap)) void refreshSession()
}

// startSession — один раз при загрузке SPA (main.tsx): снимок, канал вкладок,
// возврат на вкладку и фокус, перенос старого ключа.
export async function startSession(): Promise<void> {
  if (started) return
  started = true
  try {
    channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL) : null
    if (channel) channel.onmessage = onChannelMessage
  } catch {
    channel = null
  }
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('focus', onFocus)
  detach = () => {
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('focus', onFocus)
  }
  await ensureSession()
  await migrateLegacyKey()
}

// Только для тестов: вернуть модуль в исходное состояние.
export function __resetSessionForTests(): void {
  try { channel?.close() } catch { /* no-op */ }
  channel = null
  detach?.()
  detach = null
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = null
  retryN = 0
  started = false
  inflight = null
  inflightCtl = null
  logoutPending = null
  sweepSent = false
  sweepPending = null
  hiddenAt = null
  gen++
  epoch++ // ответ запроса прошлого теста не попадёт в новый снимок и не начнёт новый GET
  listeners.clear()
  logoutHooks = null
  snap = LOADING
}

// Только для тестов: подставить снимок.
export function __setSessionForTests(next: Partial<SessionSnapshot>, external = false): void {
  setSnap({ ...LOADING, status: 'ready', ...next }, external)
}
