// telemetry.ts — лёгкий сбор поведенческих событий плеера (НЕ аналитический SDK).
//
// Одна функция track(event, payload): событие копится в буфере в памяти и
// уходит на бэк батчем — периодически по таймеру и ПРИНУДИТЕЛЬНО на
// pagehide/visibilitychange(hidden) через navigator.sendBeacon (переживает
// teardown навигации, в отличие от обычного fetch). Fire-and-forget: ошибки
// глотаются, НИКАКОЙ очереди с ретраями/оффлайном (по ТЗ) — потеря отдельного
// события дешевле сложности и багов персистентной очереди.
//
// Бэк: POST /api/telemetry/events — батч → append-only JSONL (event sourcing),
// см. internal/bff/telemetry.go. Сосед по слою — ab-events.ts (тот же fire-and-
// forget-паттерн для /api/route/next).
import { ensureAnonId } from './route-state'

export const TELEMETRY_SCHEMA_VERSION = 1
// tier — зарезервировано под тиры воронки (web_anon → авторизованные и т.д.),
// пока константа. Живёт в КАЖДОМ событии по ТЗ.
const TIER = 'web_anon'
const ENDPOINT = '/api/telemetry/events'
// Интервал батч-флаша живой страницы. Компромисс: достаточно редко, чтобы не
// слать по запросу на событие, достаточно часто, чтобы при внезапном kill
// (mobile task-kill без pagehide) потерять максимум ~интервал событий.
const FLUSH_INTERVAL_MS = 8000
// Жёсткий потолок буфера. Реальные батчи крошечные (watch_progress раз в ~10-15с
// + редкие клики); cap — только защита от утечки памяти, если флаши почему-то
// перестали уходить. При достижении — принудительный флаш, события НЕ
// отбрасываются. 100 (а не серверный лимит 200): sendBeacon/keepalive-fetch в
// браузере ограничены ~64 КБ на тело; 100 событий × ~300 Б ≈ 30 КБ держат
// терминальный бикон с запасом под лимитом (200 × 300 ≈ 60 КБ рисковали
// перевалить и уронить ВЕСЬ батч без ретрая). Сервер принимает до 200 — фора.
export const TELEMETRY_MAX_BUFFER = 100

export type TelemetryPayload = Record<string, unknown>

let buffer: Record<string, unknown>[] = []
let timer: ReturnType<typeof setInterval> | null = null
let listenersAttached = false
// terminalHooks — колбэки, которые ОБЯЗАНЫ выполниться СИНХРОННО перед
// терминальным флашем (pagehide/hidden), чтобы «последнее слово» попало в тот
// же sendBeacon. Так эмитится ФИНАЛЬНЫЙ watch_progress (точка броска): без
// хука порядок слушателей мог бы прогнать flushBeacon РАНЬШЕ, чем PlayerPage
// добавит финальное событие в буфер, и оно бы потерялось.
const terminalHooks = new Set<() => void>()
// anon_id стабилен на сессию — читаем localStorage один раз и кэшируем в модуле
// (ensureAnonId сам персистит; кэш экономит чтение на каждом watch_progress).
let cachedAnonId: string | null = null

function anonId(): string {
  if (cachedAnonId == null) cachedAnonId = ensureAnonId()
  return cachedAnonId
}

// subLineHash — КОНТЕНТ-хэш строки субтитра (FNV-1a 32-bit → 8 hex). Привязка
// события к реплике идёт ТОЛЬКО через него, НЕ через позиционный индекс cue:
// корпус/индекс пересобираются и индексы перенумеровываются — хэш текста
// остаётся стабильным маппингом. Не крипто, коллизии для корреляции
// пренебрежимы. trim() — ведущие/хвостовые пробелы не должны менять хэш.
export function subLineHash(text: string): string {
  const s = text.trim()
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

export function track(event: string, payload: TelemetryPayload = {}): void {
  if (typeof window === 'undefined') return
  // payload сначала, базовые поля — поверх: event-specific проходят насквозь, но
  // идентичность (event/anon_id/ts_client/schema_version/tier) НЕЛЬЗЯ подменить
  // из payload (тот же принцип, что ts_server на бэке).
  buffer.push({
    ...payload,
    event,
    anon_id: anonId(),
    ts_client: Date.now(),
    schema_version: TELEMETRY_SCHEMA_VERSION,
    tier: TIER,
  })
  ensureStarted()
  if (buffer.length >= TELEMETRY_MAX_BUFFER) flushTelemetry()
}

function ensureStarted(): void {
  if (listenersAttached) return
  listenersAttached = true
  // visibilitychange — на document (мобильный уход в фон/сворачивание вкладки —
  // самый надёжный «терминальный» сигнал, pagehide на мобилках не гарантирован).
  document.addEventListener('visibilitychange', onVisibilityChange)
  // pagehide — на window (десктопная навигация/закрытие).
  window.addEventListener('pagehide', flushBeacon)
  timer = setInterval(flushTelemetry, FLUSH_INTERVAL_MS)
}

function onVisibilityChange(): void {
  if (document.visibilityState === 'hidden') flushBeacon()
}

// flushTelemetry — периодический/cap-флаш живой страницы через fetch(keepalive).
// keepalive не даёт браузеру оборвать запрос, если флаш совпал с началом
// навигации. Ошибки глотаются (fire-and-forget). Экспортирована для теста и на
// случай ручного флаша.
export function flushTelemetry(): void {
  if (buffer.length === 0) return
  const events = buffer
  buffer = []
  try {
    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({ events }),
    })
      .then(res => { if (!res.ok) console.warn('[tele] non-ok', res.status) })
      .catch(err => console.warn('[tele] failed', err))
  } catch (err) {
    // fetch недоступен / бросил синхронно — не роняем страницу.
    console.warn('[tele] threw', err)
  }
}

// flushBeacon — ТЕРМИНАЛЬНЫЙ флаш (pagehide/hidden). navigator.sendBeacon
// переживает teardown, обычный fetch — нет. Blob с type:'application/json',
// иначе sendBeacon шлёт text/plain и Go json.NewDecoder всё равно распарсит, но
// Content-Type будет неверным; Blob задаёт корректный тип. sendBeacon===false =
// очередь браузера полна — ретраев НЕТ (по ТЗ), просто глотаем (буфер уже
// очищен: терять — так честно, а не копить неотправляемое).
function flushBeacon(): void {
  // Хуки — ПЕРВЫМИ и синхронно: они дописывают финальные события в буфер до
  // его слива. Ошибка одного хука не должна сорвать выгрузку остальных.
  for (const fn of terminalHooks) {
    try { fn() } catch { /* хук не имеет права ломать teardown страницы */ }
  }
  if (buffer.length === 0) return
  const events = buffer
  buffer = []
  try {
    const blob = new Blob([JSON.stringify({ events })], { type: 'application/json' })
    navigator.sendBeacon?.(ENDPOINT, blob)
  } catch {
    // sendBeacon недоступен/бросил в момент выгрузки — глотаем.
  }
}

// onTerminalFlush — зарегистрировать хук «дописать последнее событие перед
// уходом». Возвращает функцию отписки (для cleanup эффекта). ensureStarted —
// чтобы pagehide/hidden-слушатели существовали, даже если track() ещё ни разу
// не звали (напр. пользователь открыл видео и сразу ушёл, не успев накопить
// периодических событий).
export function onTerminalFlush(fn: () => void): () => void {
  terminalHooks.add(fn)
  if (typeof window !== 'undefined') ensureStarted()
  return () => { terminalHooks.delete(fn) }
}

// ---- test-only helpers (сбрасывают модульное состояние между тестами) ----
export function __resetTelemetryForTests(): void {
  buffer = []
  if (timer) { clearInterval(timer); timer = null }
  if (listenersAttached) {
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('pagehide', flushBeacon)
    listenersAttached = false
  }
  terminalHooks.clear()
  cachedAnonId = null
}

export function __telemetryBufferSize(): number {
  return buffer.length
}
