// heard-check-memory.ts — память теста «Тест после ролика» в браузере (листовой
// модуль, без импортов приложения).
//
// Два хранилища (спека heard-check §3 E2, E3):
//   • `flib:route-heard-frac` — МАКСИМУМ доли просмотра активного ролика по
//     puzzle_id. Порог показа теста (0.6) читает ЭТО, а не флаги `clip_played`:
//     отчёт о ролике уходит и на 30 %, значит «отправлен» — не доказательство
//     досмотра. Пишет плеер (useRouteEvents) на каждом шаге времени. Размер
//     ограничен (8 роликов, вытесняются самые старые), переживает перезагрузку;
//     смена активного ролика — `retainHeardFrac(active)` оставляет только его.
//   • `flib:route-heard-sent` — id вопросов, ответ на которые УЖЕ поставлен в
//     очередь (последние 20). Вопрос живёт в состоянии, пока демон не разберёт
//     очередь, а второе событие на тот же вопрос демон молча выбросит.
//     Помним ТОЛЬКО поставленные: сбой постановки обязан дать спросить ещё раз.
// Сброс маршрута (удаление, новый быстрый старт) и «Выход» стирают оба: id
// детерминирован (`hc:<день>:<ролик>`) и иначе заглушил бы тест нового маршрута
// того же дня.
// Хранилище закрыто — живём на памяти модуля.

export const HEARD_FRAC_KEY = 'flib:route-heard-frac'
export const HEARD_SENT_KEY = 'flib:route-heard-sent'
export const HEARD_FRAC_MAX = 8
export const HEARD_SENT_MAX = 20

type Frac = Record<string, number>

let fracMem: Frac = {}
let sentMem: string[] = []
// Ключ хоть раз лежал в хранилище (записан нами или прочитан): только тогда
// `null` значит «стёрт в другой вкладке» (выход), а не «хранилище не пишется».
let fracInStorage = false
let sentInStorage = false
// Разбор JSON — один раз на строку: шаги времени идут несколько раз в секунду.
let fracRaw: string | null = null
let fracParsed: Frac = {}

function store(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}

const round3 = (x: number) => Number(Math.min(1, Math.max(0, Number.isFinite(x) ? x : 0)).toFixed(3))

function parseFrac(raw: string): Frac | null {
  try {
    const v = JSON.parse(raw) as { v?: number; items?: unknown }
    if (v?.v !== 1 || !v.items || typeof v.items !== 'object' || Array.isArray(v.items)) return null
    const out: Frac = {}
    for (const [k, x] of Object.entries(v.items as Record<string, unknown>)) {
      if (typeof x === 'number' && Number.isFinite(x)) out[k] = round3(x)
    }
    return out
  } catch { return null }
}

function readFrac(): Frac {
  try {
    const st = store()
    if (!st) return fracMem
    const raw = st.getItem(HEARD_FRAC_KEY)
    if (raw === null) {
      // Стёрто другой вкладкой («Выход»): старые доли в памяти модуля не оживляем.
      if (fracInStorage) { fracInStorage = false; fracMem = {}; fracRaw = null; fracParsed = {} }
      return fracMem
    }
    fracInStorage = true
    if (raw === fracRaw) return fracParsed
    const out = parseFrac(raw)
    if (!out) return fracMem
    fracRaw = raw
    fracParsed = out
    return out
  } catch { return fracMem }
}

function writeFrac(f: Frac): void {
  fracMem = f
  try {
    const raw = JSON.stringify({ v: 1, items: f })
    store()?.setItem(HEARD_FRAC_KEY, raw)
    fracInStorage = true
    fracRaw = raw
    fracParsed = f
  } catch { /* остаётся память */ }
}

// maxHeardFrac — наибольшая доля просмотра ролика (0, если не видели).
export function maxHeardFrac(puzzleId: string): number {
  if (!puzzleId) return 0
  const a = readFrac()[puzzleId] ?? 0
  const b = fracMem[puzzleId] ?? 0
  return Math.max(a, b)
}

// noteHeardFrac — запомнить долю (только рост). В хранилище пишется, когда доля
// выросла на ≥ 0.01, пересекла порог 0.6 или достигла 1: шаги времени идут
// несколько раз в секунду, запись на каждом была бы лишней.
export function noteHeardFrac(puzzleId: string, frac: number): void {
  if (!puzzleId) return
  const f = round3(frac)
  const cur = readFrac()
  const prev = Math.max(cur[puzzleId] ?? 0, fracMem[puzzleId] ?? 0)
  if (f <= prev) return
  const crossed = (prev < 0.6 && f >= 0.6) || (prev < 1 && f >= 0.999)
  if (!crossed && f - prev < 0.01 && prev > 0) { fracMem = { ...cur, [puzzleId]: f }; return }
  const next: Frac = { ...cur }
  delete next[puzzleId] // обновлённый — самый свежий (порядок ключей)
  next[puzzleId] = f
  const ids = Object.keys(next)
  for (const id of ids.slice(0, Math.max(0, ids.length - HEARD_FRAC_MAX))) delete next[id]
  writeFrac(next)
}

// retainHeardFrac — активный ролик маршрута сменился: доли прочих отбрасываются.
export function retainHeardFrac(activePuzzleId: string | null): void {
  const cur = readFrac()
  const keep: Frac = {}
  if (activePuzzleId && cur[activePuzzleId] !== undefined) keep[activePuzzleId] = cur[activePuzzleId]
  if (Object.keys(cur).length === Object.keys(keep).length) return
  writeFrac(keep)
}

// Ключ памяти отправленных — маршрут + id вопроса: id детерминирован
// (`hc:<день>:<ролик>`), и после сброса маршрута на другом устройстве в тот же
// день с тем же первым роликом тот же id иначе считался бы отправленным.
// Старые записи (без `|`) не совпадут ни с одним ключом и при записи отбрасываются.
const sentKey = (routeId: string, id: string) => `${routeId}|${id}`

function readSent(): string[] {
  try {
    const st = store()
    if (!st) return sentMem
    const raw = st.getItem(HEARD_SENT_KEY)
    if (raw === null) {
      if (sentInStorage) { sentInStorage = false; sentMem = [] }
      return sentMem
    }
    sentInStorage = true
    const v: unknown = JSON.parse(raw)
    if (!Array.isArray(v)) return sentMem
    return v.filter((x): x is string => typeof x === 'string' && x.includes('|'))
  } catch { return sentMem }
}

// isHeardCheckSent — ответ на вопрос этого маршрута уже поставлен в очередь.
export function isHeardCheckSent(id: string | null | undefined, routeId: string | null | undefined): boolean {
  if (!id || !routeId) return false
  const k = sentKey(routeId, id)
  return readSent().includes(k) || sentMem.includes(k)
}

// noteHeardCheckSent — запомнить поставленный вопрос (последние HEARD_SENT_MAX).
export function noteHeardCheckSent(id: string, routeId: string): void {
  if (!id || !routeId) return
  const k = sentKey(routeId, id)
  const list = [...readSent().filter(x => x !== k), k].slice(-HEARD_SENT_MAX)
  sentMem = list
  try { store()?.setItem(HEARD_SENT_KEY, JSON.stringify(list)); sentInStorage = true } catch { /* остаётся память */ }
}

// resetHeardCheckMemory — забыть и доли, и отправленные id (сброс маршрута, выход).
export function resetHeardCheckMemory(): void {
  fracMem = {}
  sentMem = []
  fracInStorage = false
  sentInStorage = false
  fracRaw = null
  fracParsed = {}
  try { store()?.removeItem(HEARD_FRAC_KEY) } catch { /* нет хранилища */ }
  try { store()?.removeItem(HEARD_SENT_KEY) } catch { /* нет хранилища */ }
}
