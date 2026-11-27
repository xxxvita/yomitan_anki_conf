// route-state.ts — модель и чистая логика маршрута (Э2).
//
// docs/plan-2026-07-13-design-transfer.md, «Архитектурные решения» п.4:
// весь маршрут лежит в localStorage `flib:route` ЦЕЛИКОМ (Э3 позже заменит
// источник на реальный route_v2 от бэка — эта модель уже рассчитана на то,
// чтобы просто подменить buildMockRoute на fetch, не трогая остальное).
// Порции и `anon_id` — тоже оттуда же (п.4). Размер порции — feedback-1 п.6в:
// было 15ч, владелец попросил давать «скажем на 1 час в день маршрута»
// (транскрипт 2026-07-14, 06:14–06:16) — иначе первая же "Дальше" открывала
// сразу пол-маршрута, а не дневную дозу.
//
// Темп «сл/мин» сознательно НЕ заведён в RouteStep (ОQ-2, план «Открытые
// вопросы — ЗАКРЫТЫ» п.2): в макетах дизайнера есть, но RouteV2StepDTO его
// не отдаёт (гэп бэка), и владелец решил не рендерить, пока не задеплоена
// доработка контракта.
import type { PointA } from './pointA'
import { GOAL_GROUPS, MOCK_ROUTE_STEPS, ROUTE_GOAL_FALLBACK } from './data'

const ROUTE_KEY = 'flib:route'
const ANON_KEY = 'flib:anon'

/** ~1 час — размер одной "порции" маршрута в день, раскрываемой кнопкой
 *  «Дальше» (feedback-1 п.6в: было 15ч, слишком много за один клик). */
const BATCH_LIMIT_SEC = 1 * 3600

export type RouteStepKind = 'video' | 'words'
export type RouteStepStatus = 'done' | 'current' | 'next' | 'locked'

export interface RouteStep {
  id: string
  kind: RouteStepKind
  /** youtube id для kind='video'; null для kind='words' (нет отдельного видео). */
  videoId: string | null
  title: string
  source: string
  durationSec: number
  newLemmas: number
  /** Список слов "как есть" — заполнен для kind='words' (прямое изучение), у
   *  video-шагов пуст (карточка видео показывает только "+N слов" из newLemmas). */
  words: string[]
  status: RouteStepStatus
}

export type RouteProfile = 'comfort' | 'balance' | 'learning'

export interface RouteSettings {
  profile: RouteProfile
}

/** ExcludedVideo — одно отклонённое видео текущего маршрута [ID:P-exclude-video].
 *  videoId — id ролика (уходит в exclude_video_ids сборки); blockChannel=true —
 *  пользователь поставил галку «убрать весь канал автора» (videoId дополнительно
 *  попадёт в exclude_channels_of_video_ids; channel_id на клиенте нет — демон
 *  резолвит канал по video_id сам). */
export interface ExcludedVideo {
  videoId: string
  blockChannel: boolean
}

export interface RouteState {
  v: 1
  goalLabel: string
  steps: RouteStep[]
  /** ISO-таймстамп, когда маршрут был (пере)собран — используется лендингом
   *  для "Ты на N-й неделе маршрута к …". */
  createdAt: string
  settings: RouteSettings
  /** Сколько порций по ~1ч уже раскрыто кнопкой «Дальше» (см. visibleSteps). */
  revealedBatches: number
  /** Видео, отклонённые кнопкой «Заменить» на ЭТОМ маршруте [ID:P-exclude-video]
   *  — прокидываются в перестройку (exclude_video_ids/exclude_channels_of_video_ids),
   *  чтобы демон не вернул то же видео при сборке с неизменным словарём.
   *  Опционально: старые записи без поля = пусто. Живёт ВНУТРИ маршрута →
   *  стирается вместе с ним при «Сбросить маршрут» (clearRoute убивает весь ключ). */
  excludedVideos?: ExcludedVideo[]
}

// addExcludedVideo — [ID:P-exclude-video] добавляет отклонённое видео к списку
// исключений маршрута, дедуп по videoId. blockChannel «липнет» в true: если
// пользователь хоть раз попросил убрать весь канал этого видео, повторная замена
// без галки НЕ снимает канальную блокировку (снять — только сбросом маршрута;
// отдельной «разблокировать канал» ручки в ТЗ нет). Пустой/битый videoId
// игнорируется — видео без id и заменить нельзя (кнопка задизейблена), в списках
// исключений пустышке делать нечего. Чистая функция — весь стейт наружу, тест.
export function addExcludedVideo(
  list: ExcludedVideo[] | undefined,
  videoId: string | null,
  blockChannel: boolean,
): ExcludedVideo[] {
  const base = list ?? []
  if (!videoId) return base
  if (base.some(e => e.videoId === videoId)) {
    return base.map(e =>
      e.videoId === videoId ? { videoId, blockChannel: e.blockChannel || blockChannel } : e,
    )
  }
  return [...base, { videoId, blockChannel }]
}

// ---- localStorage: flib:route ----

export function loadRoute(): RouteState | null {
  try {
    const raw = window.localStorage.getItem(ROUTE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    // Чужая схема/битый JSON в этом ключе → null, не падение (тот же принцип,
    // что и в pointA.ts/loadPointA): вызывающий код (RoutePage) трактует null
    // как "маршрута нет" и либо строит мок, либо показывает empty-state.
    if (parsed && parsed.v === 1 && Array.isArray(parsed.steps)) {
      return parsed as RouteState
    }
    return null
  } catch {
    return null
  }
}

export function saveRoute(route: RouteState): void {
  try {
    window.localStorage.setItem(ROUTE_KEY, JSON.stringify(route))
  } catch {
    // localStorage недоступен (приватный режим/заблокированное хранилище) —
    // не роняем UI, маршрут просто не переживёт эту сессию.
  }
}

// clearRoute — feedback-2 п.2 (владелец: «Сбросить маршрут», транскрипт
// screencast3, 04:53–05:11): «Сбросить маршрут» в RouteSettingsModal должно
// удалить `flib:route` целиком (вместе с `flib:pointA`, см. pointA.ts
// clearPointA), чтобы пользователь ушёл на главную и собрал маршрут "с нуля"
// заново, а не увидел старый маршрут при возврате на /route.
export function clearRoute(): void {
  try {
    window.localStorage.removeItem(ROUTE_KEY)
  } catch {
    // localStorage недоступен — уже нечего чистить, no-op.
  }
}

// ---- localStorage: flib:anon ----

function randomHexFallback(): string {
  // Fallback для окружений без crypto.randomUUID (старые браузеры/webview).
  // Не претендует на RFC4122-валидность — это просто анонимный клиентский
  // идентификатор для A/B-события «Дальше» (см. ab-events.ts), не PII и не
  // ключ безопасности, так что качество энтропии Math.random тут достаточно.
  let hex = ''
  for (let i = 0; i < 32; i++) {
    hex += Math.floor(Math.random() * 16).toString(16)
  }
  return hex
}

function generateAnonId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return randomHexFallback()
}

export function ensureAnonId(): string {
  try {
    const existing = window.localStorage.getItem(ANON_KEY)
    if (existing) return existing
    const id = generateAnonId()
    window.localStorage.setItem(ANON_KEY, id)
    return id
  } catch {
    // localStorage недоступен — отдаём одноразовый id за сессию, лучше, чем падение.
    return generateAnonId()
  }
}

// ---- порции по ~1 часу ----

// Батч k набирается жадно: копим durationSec шагов, пока сумма ≤ 1ч
// (границу включаем — ровно 1ч ещё влезает); как только следующий шаг не
// влезает — он открывает следующий батч. Первый шаг НОВОГО батча берётся
// безусловно, даже если сам по себе длиннее 1ч (иначе шаг длиннее лимита
// никогда не попал бы ни в один батч).
// Экспортирована для api.ts (Э3): buildRoute использует ту же батч-логику,
// чтобы проставить статусы шагов первого построения (current/next/locked) —
// см. api.ts:mapRouteSteps. Единая функция — не дублировать порционирование.
export function computeBatchIndexes(steps: RouteStep[]): number[] {
  const indexes: number[] = []
  let batch = 1
  let batchSum = 0
  let batchHasStep = false
  for (const step of steps) {
    if (batchHasStep && batchSum + step.durationSec > BATCH_LIMIT_SEC) {
      batch += 1
      batchSum = 0
      batchHasStep = false
    }
    indexes.push(batch)
    batchSum += step.durationSec
    batchHasStep = true
  }
  return indexes
}

export function visibleSteps(route: RouteState): RouteStep[] {
  const batches = computeBatchIndexes(route.steps)
  return route.steps.filter((_, i) => batches[i] <= route.revealedBatches)
}

export function hasMore(route: RouteState): boolean {
  const batches = computeBatchIndexes(route.steps)
  const maxBatch = batches.length > 0 ? Math.max(...batches) : 0
  return maxBatch > route.revealedBatches
}

// ---- прогресс шага ----

// Правило (план, Э2 п.1): помеченный шаг → 'done'; следующий по порядку
// шаг, который ещё не 'done' и уже ВИДЕН (в раскрытых батчах) → 'current';
// остальные видимые не-done → 'next'. Шаги за пределами раскрытых батчей не
// трогаем — они остаются как были (обычно 'locked'), раскроются «Дальше».
export function markStepDone(route: RouteState, stepId: string): RouteState {
  const targetIdx = route.steps.findIndex(s => s.id === stepId)
  if (targetIdx === -1) return route

  const visibleIds = new Set(visibleSteps(route).map(s => s.id))
  const steps = route.steps.map(s => ({ ...s }))
  steps[targetIdx].status = 'done'

  let currentAssigned = false
  for (const step of steps) {
    if (step.id === stepId) continue
    if (step.status === 'done') continue
    if (!visibleIds.has(step.id)) continue
    if (!currentAssigned) {
      step.status = 'current'
      currentAssigned = true
    } else {
      step.status = 'next'
    }
  }
  return { ...route, steps }
}

// ---- «Заменить видео» [ID:P-replace-video]: сборка-с-этого-места,
// сохраняя префикс ----

// spliceReplaceFrom — владелец-бриф «Заменить это видео»: заменяемый шаг
// (индекс k) и ВСЁ после него отбрасываются, вместо них встают newSteps
// (результат buildRoute с point_a = текущий накопленный словарь) — steps[0..k-1]
// (пройденное/current до заменяемого шага) остаются как были. ОТЛИЧИЕ от
// handleRestructure (RoutePage.tsx, п.E) — тот пересобирает ВЕСЬ маршрут с
// нуля; здесь префикс — часть контракта, не побочный эффект.
//
// Переименование id: mapRouteSteps (api.ts) всегда нумерует id новой
// сборки с нуля ("route-step-0", "route-step-1", …) — те же значения, что
// уже заняты префиксом (он тоже родом из mapRouteSteps). Без ренумерации
// возник бы дубль id между префиксом и новым хвостом (ключи React, поиск
// шага по id в RouteStepBar/advanceRouteStep). Переприсваиваем id ВСЕМ
// шагам по их итоговой позиции ("route-step-0"..N-1") — для префикса это
// no-op (там id уже совпадают с позицией по построению), для хвоста —
// продолжает нумерацию с k, гарантированно без коллизий.
//
// Статусы — та же логика, что и markStepDone (не изобретаем новое
// правило): 'done' остаётся 'done'; первый оставшийся не-done шаг, который
// уже ВИДЕН (в раскрытых батчах) — 'current', остальные видимые не-done —
// 'next'; шаги за пределами видимых батчей — 'locked' (даже если билд
// проставил им что-то другое — общий батч-расклад пересчитан для ВСЕГО
// склеенного массива, а не только нового хвоста, поэтому статусы билда по
// отдельности не заслуживают доверия).
//
// revealedBatches — max(старое, батч первого НОВОГО шага): гарантирует, что
// пользователь сразу увидит хотя бы начало нового хвоста (не нужно жать
// «Дальше» ещё раз сразу после замены), но не схлопывает то, что уже было
// раскрыто раньше (владелец мог быть на 3-й порции — замена не должна
// спрятать 2-ю и 3-ю).
export function spliceReplaceFrom(route: RouteState, k: number, newSteps: RouteStep[]): RouteState {
  // Клампим k в [0, steps.length] (аудит LOW): у голого slice(0, k)
  // отрицательный k считается ОТ КОНЦА (slice(0,-1) сохранил бы весь префикс
  // кроме последнего) — тихо неверный маршрут вместо ошибки. Вызывающий код
  // (RoutePage.handleReplaceVideo) уже отсекает k===-1 до вызова, но
  // экспортируемая чистая функция не должна молча ломаться на битом входе.
  const safeK = Math.max(0, Math.min(k, route.steps.length))
  const prefix = route.steps.slice(0, safeK)
  const spliced = [...prefix, ...newSteps].map((s, i) => ({ ...s, id: `route-step-${i}` }))

  const batches = computeBatchIndexes(spliced)
  const firstNewBatch = safeK < batches.length ? batches[safeK] : (batches[batches.length - 1] ?? 1)
  const revealedBatches = Math.max(route.revealedBatches, firstNewBatch)

  const visibleIds = new Set(spliced.filter((_, i) => batches[i] <= revealedBatches).map(s => s.id))
  let currentAssigned = false
  for (const step of spliced) {
    if (step.status === 'done') continue
    if (!visibleIds.has(step.id)) { step.status = 'locked'; continue }
    if (!currentAssigned) {
      step.status = 'current'
      currentAssigned = true
    } else {
      step.status = 'next'
    }
  }

  return { ...route, steps: spliced, revealedBatches }
}

// ---- построение маршрута из моков (Э3 заменит на реальный route_v2) ----

function resolveGoalLabel(pointA: PointA | null): string {
  if (pointA && pointA.kind === 'cefr' && pointA.goals.length > 0) {
    const firstGoalId = pointA.goals[0]
    const goal = GOAL_GROUPS.flatMap(g => g.goals).find(g => g.id === firstGoalId)
    if (goal) return goal.title
  }
  return ROUTE_GOAL_FALLBACK
}

export function buildMockRoute(pointA: PointA | null): RouteState {
  return {
    v: 1,
    goalLabel: resolveGoalLabel(pointA),
    // Глубокая копия — MOCK_ROUTE_STEPS модуль-уровневый и переиспользуется
    // между вызовами (например при «Пересобрать маршрут»); без копии мутации
    // markStepDone/status утекли бы в исходные моки других вкладок/тестов.
    steps: MOCK_ROUTE_STEPS.map(step => ({ ...step, words: [...step.words] })),
    createdAt: new Date().toISOString(),
    settings: { profile: 'balance' },
    revealedBatches: 1,
  }
}
