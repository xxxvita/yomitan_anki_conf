// route-storage.ts — ключи браузерного хранилища маршрута кабинета (спека
// 2026-11-17 §6.2) и их стирание на «Выходе» (R2-C1). Одна копия имён: очередь
// (B6), оценки (B10b), отметки просмотра (B8c), урок слов и кэш примеров (B10f)
// берут их отсюда, и стирание не может пропустить ключ, которого нет в списке.
//
// Метка маршрута в index.html (`<meta name="flib-route" content="1">`) — её
// кладёт BFF только при CABINET_ENABLED && CABINET_ROUTE_ENABLED и разобранном
// SESSION_KEYS. Без метки ни очередь, ни события плеера, ни гейт субтитров не
// включаются: сайт ведёт себя ровно как до этапа 2.

import { resetHeardCheckMemory } from './heard-check/heard-check-memory'

export const ROUTE_OUTBOX_KEY = 'flib:route-outbox'
// Запасные ключи выгрузки страницы (ревью партии 2, C2; повторное ревью R-M2):
// буфер вкладки пишется синхронно на pagehide / visibilitychange:hidden в СВОЙ
// ключ страницы `flib:route-outbox-unload:<метка страницы>`; следующая загрузка
// вливает и стирает их по префиксу. Свой ключ у каждой страницы — потому что
// чтение-изменение-запись общего ключа без блокировки теряло запись соседней
// вкладки, выгружавшейся в то же мгновение (замер ревьюера: 12 из 12 в Chromium).
export const ROUTE_OUTBOX_UNLOAD_PREFIX = 'flib:route-outbox-unload:'
export const ROUTE_RATINGS_KEY = 'flib:route-ratings'
export const ROUTE_WATCHED_KEY = 'flib:route-watched'
export const ROUTE_LESSON_KEY = 'flib:route-lesson'
export const EXAMPLES_CACHE_KEY = 'flib:examples-cache'

// ROUTE_LOGOUT_KEYS — пять ключей маршрута, которые «Выход» стирает (§6.2);
// ROUTE_LOGOUT_PREFIXES — и все ключи с этими префиксами (запасные ключи выгрузки
// страниц). `flib:route-listened` сюда НЕ входит намеренно: это свойство ролика
// для браузера, а не личные данные.
export const ROUTE_LOGOUT_KEYS = [
  ROUTE_OUTBOX_KEY, ROUTE_RATINGS_KEY, ROUTE_WATCHED_KEY, ROUTE_LESSON_KEY, EXAMPLES_CACHE_KEY,
] as const
// Черновик «Моих целей» — свой ключ на ключ доступа (префикс ключа), поэтому
// стирается по префиксу, а не по фиксированному имени.
export const GOAL_HARVEST_PREFIX = 'flib:goal-harvest:v1:'
// Тест уровня: сессия и вкладка (`flib:placement:v1:<owner>:…`) и «Позже» с Главной
// (`flib:placement-later:v1:<owner>`) — по префиксу, ключ зависит от владельца.
export const PLACEMENT_PREFIX = 'flib:placement:v1:'
export const PLACEMENT_LATER_PREFIX = 'flib:placement-later:v1:'
export const ROUTE_LOGOUT_PREFIXES = [ROUTE_OUTBOX_UNLOAD_PREFIX, GOAL_HARVEST_PREFIX, PLACEMENT_PREFIX, PLACEMENT_LATER_PREFIX] as const

// keysWithPrefix — ключи хранилища с префиксом. Перечисление — через length /
// key(i) (Object.keys(localStorage) перечисляет не везде), список собирается
// целиком ДО любых удалений: удаление сдвигает индексы.
export function keysWithPrefix(storage: Storage | null, prefix: string): string[] {
  if (!storage) return []
  const out: string[] = []
  try {
    const n = storage.length
    for (let i = 0; i < n; i++) {
      const k = storage.key(i)
      if (k !== null && k.startsWith(prefix)) out.push(k)
    }
  } catch { /* хранилище недоступно */ }
  return out
}

// safeLocalStorage — localStorage или null (приватный режим, запрет сайта).
export function safeLocalStorage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    return window.localStorage
  } catch {
    return null
  }
}

// eraseRouteStorage — стереть пять ключей маршрута и запасные ключи выгрузки
// всех страниц. Ошибки хранилища глотаются: стирание вызывается на «Выходе», и
// сбой записи не должен его сорвать.
export function eraseRouteStorage(storage: Storage | null = safeLocalStorage()): void {
  if (!storage) return
  const keys = [...ROUTE_LOGOUT_KEYS, ...ROUTE_LOGOUT_PREFIXES.flatMap(p => keysWithPrefix(storage, p))]
  for (const k of keys) {
    try { storage.removeItem(k) } catch { /* no-op */ }
  }
  // Память теста после ролика (доли и отправленные id) — свои два ключа, в
  // перечень пяти не входят; «Выход» стирает и их.
  goalDraftMemory.clear()
  resetHeardCheckMemory()
}

// readWatchedSeq — счётчик записей объекта `flib:route-watched` (§6.2): его
// запоминает отправка `GET /api/me/route/state` для сторожа удаления (R4-C1).
// Нет объекта или он битый — 0.
export function readWatchedSeq(storage: Storage | null = safeLocalStorage()): number {
  if (!storage) return 0
  try {
    const raw = storage.getItem(ROUTE_WATCHED_KEY)
    if (!raw) return 0
    const v = JSON.parse(raw) as { seq?: unknown }
    return typeof v.seq === 'number' && Number.isFinite(v.seq) ? v.seq : 0
  } catch {
    return 0
  }
}

// cabinetRouteMarked — метка BFF: маршрут кабинета включён.
export function cabinetRouteMarked(): boolean {
  if (typeof document === 'undefined') return false
  return document.querySelector('meta[name="flib-route"][content="1"]') !== null
}

// --- черновик «Моих целей» (ролики пользователя как цель) ----------------------------

export interface GoalDraft { client_request_id: string; video_ids: string[]; request_id?: string }

const goalDraftMemory = new Map<string, string>()
const goalDraftKey = (keyPrefix: string) => GOAL_HARVEST_PREFIX + keyPrefix

function readDraftRaw(keyPrefix: string): string | null {
  const k = goalDraftKey(keyPrefix)
  const st = safeLocalStorage()
  if (st) {
    try { return st.getItem(k) } catch { /* в память */ }
  }
  return goalDraftMemory.get(k) ?? null
}

export function loadGoalDraft(keyPrefix: string): GoalDraft | null {
  const raw = readDraftRaw(keyPrefix)
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as Partial<GoalDraft>
    if (typeof v.client_request_id !== 'string' || !Array.isArray(v.video_ids)) return null
    if (!v.video_ids.every(x => typeof x === 'string')) return null
    return {
      client_request_id: v.client_request_id, video_ids: v.video_ids,
      ...(typeof v.request_id === 'string' ? { request_id: v.request_id } : {}),
    }
  } catch { return null }
}

export function saveGoalDraft(keyPrefix: string, d: GoalDraft): void {
  const k = goalDraftKey(keyPrefix)
  const raw = JSON.stringify(d)
  const st = safeLocalStorage()
  if (st) {
    try { st.setItem(k, raw); return } catch { /* в память */ }
  }
  goalDraftMemory.set(k, raw)
}

export function clearGoalDraft(keyPrefix: string): void {
  const k = goalDraftKey(keyPrefix)
  goalDraftMemory.delete(k)
  const st = safeLocalStorage()
  if (st) { try { st.removeItem(k) } catch { /* no-op */ } }
}

// draftFor — сохранённый черновик, если набор роликов тот же (порядок не важен);
// иначе новый с новым client_request_id (иной набор — иной запрос к шлюзу).
export function draftFor(keyPrefix: string, videoIds: string[]): GoalDraft {
  const sorted = [...videoIds].sort()
  const cur = loadGoalDraft(keyPrefix)
  if (cur) {
    const have = [...cur.video_ids].sort()
    if (have.length === sorted.length && have.every((x, i) => x === sorted[i])) return cur
  }
  return { client_request_id: crypto.randomUUID(), video_ids: sorted }
}
