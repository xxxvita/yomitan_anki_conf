// api.ts — клиент BFF (Э3): /api/goals, /api/route (+ /api/route/jobs/{id}).
//
// docs/plan-2026-07-13-design-transfer.md, этап Э3: контракт зафиксирован
// бэком (internal/bff, делается параллельно) — здесь только клиент под него,
// без домыслов сверх задачи. route-state.ts уже был рассчитан на подмену
// buildMockRoute реальным fetch без переписывания остального (см. комментарий
// там же) — buildRoute здесь и есть эта подмена, вызывается из RoutePage.tsx.
import {
  computeBatchIndexes, ensureAnonId,
  type RouteProfile, type RouteState, type RouteStep, type RouteStepKind, type RouteStepStatus,
} from './route-state'

// ---- GET /api/goals ----

export interface Goal {
  id: string
  title: string
  kind: string
  level: string
  target: string
  // Поля карточки цели экрана старта маршрута кабинета (дизайн 2026-11-19 §3a);
  // у старого ответа их нет — карточка тогда без постера и без метки IMDb.
  title_ru?: string
  year?: number
  type?: string
  imdb_id?: string
  poster_slug?: string
}

interface GoalsResponseDTO {
  goals: Goal[]
}

export async function fetchGoals(): Promise<Goal[]> {
  const res = await fetch('/api/goals')
  if (!res.ok) throw new Error(`Не удалось загрузить список целей (${res.status})`)
  const data = (await res.json()) as GoalsResponseDTO
  if (!data || !Array.isArray(data.goals)) throw new Error('Сервер вернул каталог целей в неожиданном формате')
  return data.goals
}

// ---- GET /api/puzzle/catalog, GET /api/puzzle/preview [ID:P-film-picker] ----
//
// Contract v2 2026-07-16 §2.1/§3.1: /api/puzzle/catalog отдаёт урезанный
// PuzzleItem-каталог (Puzzle Movies зеркало, ~6300 строк) целиком — фильтр
// НА КЛИЕНТЕ (puzzle-targets.ts filterPuzzleItems, contract D1). Постеры НЕ
// приходят в каталоге (poster_url намеренно пуст на бэке) — только через
// отдельную ручку preview по slug.

/** Урезанный CatalogItem (contract §1.2/§2.1) — release_year/popularity на
 *  бэке указатели (omitempty) и могут отсутствовать/быть null; seasons/episodes
 *  — обычные int (0 у не-сериала), не путать с "нет данных". */
export interface PuzzleItem {
  slug: string
  title_en: string
  title_ru: string
  media_type: number
  release_year?: number | null
  popularity?: number | null
  seasons: number
  episodes: number
}

interface PuzzleCatalogResponseDTO {
  items: PuzzleItem[]
  total: number
}

export async function fetchPuzzleCatalog(signal?: AbortSignal): Promise<PuzzleItem[]> {
  const res = await fetch('/api/puzzle/catalog', { signal })
  if (!res.ok) throw new Error(`Не удалось загрузить каталог фильмов (${res.status})`)
  const data = (await res.json()) as PuzzleCatalogResponseDTO
  if (!data || !Array.isArray(data.items)) throw new Error('Сервер вернул каталог фильмов в неожиданном формате')
  return data.items
}

/** puzzlePreviewURL — постер карточки (FilmPicker.tsx <img onError→hide,
 *  contract §3.4). slug уходит как есть — бэк валидирует формат сам
 *  (contract §2.1, 400 bad_slug), клиенту достаточно encodeURIComponent. */
export function puzzlePreviewURL(slug: string): string {
  return '/api/puzzle/preview?slug=' + encodeURIComponent(slug)
}

// ---- POST /api/route → poll GET /api/route/jobs/{id} ----

/** Точка А в формате запроса /api/route — подмножество PointA (pointA.ts):
 *  только то, что реально уходит в тело запроса, без ageBand/savedAt. */
export type ApiPointA =
  | { kind: 'cefr'; level: string }
  | { kind: 'words'; words: string[] }

export type BuildRoutePhase = 'pending' | 'running'

// RouteGoal — [ID:P-abstract-goals] contract §1 D3/golden-fixture: блок
// `goal` тела POST /api/route, единый путь для мульти-/абстрактных целей
// визарда /try (Фаза 1). RoutePage.tsx (goalOf()) собирает его из
// pointA.goalsV2 — здесь только тип и проброс в тело, без домыслов сверх
// wire-контракта. `words`/`label` фронт в Фазе 1 НЕ заполняет (BFF шлёт
// words для seed-категорий, собирает label сам, D3/D5) — оставлены
// опциональными в типе, чтобы форма СОВПАДАЛА с wire-контрактом дословно
// (golden fixture BFF→демон несёт оба поля), но buildRoute их не требует.
export interface RouteGoal {
  puzzle_ids?: string[]
  categories?: string[]
  words?: string[]
  text_queries?: string[]
  label?: string
}

// KNOWN_ERROR_MESSAGES — [ID:P-abstract-goals] contract §2.5: новые коды
// ошибок resolveGoalV2 (BFF, §3.2) НЕ читаемы юзером как есть ("goal_not_
// resolved") — переводим в понятный месседж. Остальные коды (missing_target/
// too_many_targets/сетевые) остаются как раньше — общая формулировка со
// статус-кодом (не расширяем маппинг сверх задачи).
const KNOWN_ERROR_MESSAGES: Record<string, string> = {
  goal_not_resolved: 'Цели не распознаны — вернитесь к выбору',
  empty_route: 'Маршрут пуст',
}

/** friendlyErrorFromResponse — пробует прочитать `{error:"<код>"}` из тела
 *  non-ok ответа и смэтчить его на KNOWN_ERROR_MESSAGES; иначе — null (вызывающий
 *  код падает на прежнее поведение). res.json() читается РОВНО ОДИН РАЗ здесь —
 *  вызывающий код НЕ должен читать body второй раз после этого вызова. */
async function friendlyErrorFromResponse(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { error?: string }
    if (body && typeof body.error === 'string' && KNOWN_ERROR_MESSAGES[body.error]) {
      return KNOWN_ERROR_MESSAGES[body.error]
    }
  } catch {
    // Тело не JSON / уже прочитано — нет опознаваемого кода, используем fallback.
  }
  return null
}

// ApiVocabSource — источник точки А для profile_meta.vocab_source (задача
// P-profile-feed, 2026-07-14). 'unknown' — старая localStorage-запись
// pointA (kind='words') БЕЗ source (до этой задачи): сознательно не
// угадываем upload/test по форме данных, честно шлём "не знаем".
export type ApiVocabSource = 'cefr' | 'test' | 'upload' | 'unknown'

/** profile_meta тела POST /api/route (задача P-profile-feed) — возраст/
 *  уровень/источник словаря, дополняющие point_a. age/level опциональны
 *  (не у каждого пути воронки они есть, см. RoutePage.tsx toProfileMeta) —
 *  JSON.stringify сам опускает ключи со значением undefined. */
export interface ProfileMeta {
  age?: number
  level?: string
  vocab_source: ApiVocabSource
}

export interface BuildRouteOptions {
  /** Интересы пользователя (заглушка-мультивыбор 2026-07-14) — сервер кладёт
   *  их в params.interests джобы демона; демон пока игнорирует. */
  interests?: string[]
  /** [ID:P-exclude-video] video_id, отклонённые кнопкой «Заменить» на маршруте
   *  — демон исключает эти ролики при сборке. Пусто → ключ exclude_video_ids
   *  не шлётся (omit). */
  excludeVideoIds?: string[]
  /** [ID:P-exclude-video] ПОДМНОЖЕСТВО excludeVideoIds, у которых юзер попросил
   *  убрать ВЕСЬ канал автора — демон резолвит channel по video_id сам.
   *  Пусто → ключ exclude_channels_of_video_ids не шлётся. */
  excludeChannelsOfVideoIds?: string[]
  /** [ID:P-film-picker] Contract §3.1/§3.7: цель(и) фильм/сериал-пикера в
   *  формате плоского slug (puzzle-targets.ts puzzleItemToTarget, contract C2).
   *  Пусто/не передано → ключ targets не шлётся (omit, как exclude_video_ids) —
   *  сервер тогда резолвит цель из goal_ids (fixed-целевой путь). RoutePage.tsx
   *  filmTargetOf() строит массив ровно из 0 или 1 элемента — демон route_v2
   *  принимает РОВНО одну цель (contract C1), BFF отклонит >1 (too_many_targets). */
  targets?: string[]
  /** [ID:P-abstract-goals] contract §1 D2/§2.5: блок `goal` (мульти-/
   *  абстрактная цель визарда /try, Фаза 1) — RoutePage.tsx (goalOf())
   *  собирает его из pointA.goalsV2 и передаёт СЮДА "вместо" goalIds/targets
   *  (не рядом — контракт §2.5 Q1-a). Пусто/не передано → ключ `goal` не
   *  шлётся (omit, тот же принцип, что targets/exclude_video_ids). */
  goal?: RouteGoal
  /** Проброс профиля пользователя в демон (задача P-profile-feed) —
   *  вычисляется вызывающим кодом (RoutePage.tsx toProfileMeta) из pointA,
   *  buildRoute сам pointA не разбирает (ApiPointA — уже урезанное
   *  подмножество без source/ageBand/levelEstimate). */
  profileMeta?: ProfileMeta
  onPhase?: (phase: BuildRoutePhase) => void
  /** Аудит HIGH #3: StrictMode-двойной POST и поллинг, переживающий unmount.
   *  Передаётся во все fetch и проверяется на каждом шаге цикла поллинга —
   *  RoutePage.tsx абортит его в cleanup эффекта сборки. */
  signal?: AbortSignal
}

interface CreateJobResponseDTO {
  job_id: string
}

interface RouteStepDTO {
  kind: RouteStepKind
  video_id: string | null
  title: string
  source: string
  duration_sec: number
  new_lemmas: number
  words: string[]
}

interface RouteDTO {
  goal_label: string
  steps: RouteStepDTO[]
}

type JobStatus = 'pending' | 'running' | 'done' | 'failed'

interface JobStatusResponseDTO {
  status: JobStatus
  route: RouteDTO | null
  error: string
}

const POLL_INTERVAL_MS = 3000
const POLL_TIMEOUT_MS = 10 * 60 * 1000

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Аудит LOW: duration_sec с бэка может прийти NaN/отрицательным (битые
// данные джобы) — без clamp такое значение протекает в formatDuration
// (RoutePage.tsx) и в суммирование батчей (computeBatchIndexes/FreshBanner),
// ломая и текст, и разбиение на батчи.
function clampDurationSec(v: number): number {
  return Number.isFinite(v) ? Math.max(0, v) : 0
}

// Статусы шагов (план, «Архитектурные решения» п.4 + route-state.ts): первый
// шаг маршрута — 'current', остальные шаги ПЕРВОГО ~1ч-батча (та же
// computeBatchIndexes-логика, что раскрывает "Дальше" на /route) — 'next',
// хвост за пределом первого батча — 'locked'. Один и тот же алгоритм батчей
// используется и здесь (что видно сразу), и в visibleSteps (что раскрывается
// кнопкой «Дальше») — иначе они бы разошлись при первой же пересборке.
function mapRouteSteps(steps: RouteStepDTO[]): RouteStep[] {
  const mapped: RouteStep[] = steps.map((s, i) => ({
    id: `route-step-${i}`,
    kind: s.kind,
    videoId: s.video_id,
    title: s.title,
    source: s.source,
    durationSec: clampDurationSec(s.duration_sec),
    newLemmas: s.new_lemmas,
    words: s.words ?? [],
    status: 'locked' as RouteStepStatus,
  }))
  const batches = computeBatchIndexes(mapped)
  mapped.forEach((step, i) => {
    if (i === 0) { step.status = 'current'; return }
    step.status = batches[i] <= 1 ? 'next' : 'locked'
  })
  return mapped
}

function mapRouteDTO(route: RouteDTO, profile: RouteProfile): RouteState {
  return {
    v: 1,
    goalLabel: route.goal_label,
    steps: mapRouteSteps(route.steps),
    createdAt: new Date().toISOString(),
    settings: { profile },
    revealedBatches: 1,
  }
}

// buildRoute — POST /api/route (создаёт джобу) → поллит GET
// /api/route/jobs/{id} раз в 3с до done/failed, либо до 10-минутного
// таймаута. onPhase зовётся на каждом pending/running-ответе — RoutePage.tsx
// показывает его как подпись под спиннером на странице "Собираем маршрут…".
export async function buildRoute(
  pointA: ApiPointA,
  goalIds: string[],
  profile: RouteProfile,
  { onPhase, signal, interests, profileMeta, excludeVideoIds, excludeChannelsOfVideoIds, targets, goal }: BuildRouteOptions = {},
): Promise<RouteState> {
  // Тело собираем в фиксированном порядке ключей (point_a, goal_ids, profile,
  // [interests], [profile_meta], [exclude_video_ids], [exclude_channels_of_video_ids],
  // [targets], [goal], anon_id) — все опциональные поля пропущены, если вызывающий их
  // не передал (тот же принцип, что уже был у interests: пустая заглушка не должна
  // засорять тело запроса ради обратной совместимости со старыми снятыми телами
  // в api.test.ts). anon_id — ВСЕГДА последний ключ (есть тест на точный порядок).
  // [ID:P-abstract-goals] golden fixture: `goal` — ПОСЛЕ targets, ПЕРЕД anon_id.
  const body: Record<string, unknown> = { point_a: pointA, goal_ids: goalIds, profile }
  if (interests && interests.length > 0) body.interests = interests
  if (profileMeta) body.profile_meta = profileMeta
  if (excludeVideoIds && excludeVideoIds.length > 0) body.exclude_video_ids = excludeVideoIds
  if (excludeChannelsOfVideoIds && excludeChannelsOfVideoIds.length > 0) {
    body.exclude_channels_of_video_ids = excludeChannelsOfVideoIds
  }
  // [ID:P-film-picker] contract §3.1: targets кладём в тело ТОЛЬКО если непусто
  // (зеркалит exclude_video_ids выше) — пустой массив/undefined значит "цель не
  // из пикера, идём через goal_ids" и ключ вообще не должен появиться в теле.
  if (targets && targets.length > 0) body.targets = targets
  if (goal) body.goal = goal
  body.anon_id = ensureAnonId()

  const createRes = await fetch('/api/route', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!createRes.ok) {
    // [ID:P-abstract-goals] contract §2.5: новые коды resolveGoalV2
    // (goal_not_resolved и т.п.) приходят в теле 400-ответа как {error:"<код>"} —
    // переводим в понятный месседж ДО частных веток ниже (единственное чтение
    // тела ответа, friendlyErrorFromResponse res.json() читает один раз).
    const known = await friendlyErrorFromResponse(createRes)
    if (known) throw new Error(known)
    // §3.8 «Бонус из скринкаста»: 404 на создании джобы — дружелюбное сообщение
    // вместо голого "(404)" (владелец воспроизвёл на скринкасте 2026-07-16).
    // Прочие коды остаются как были — их текст уже человекочитаем достаточно
    // (сеть/5xx — реальный сбой сервера, не "маршрута не существует").
    if (createRes.status === 404) {
      throw new Error('Маршрут построить не удалось — попробуйте позже')
    }
    throw new Error(`Не удалось начать сборку маршрута (${createRes.status})`)
  }
  const created = (await createRes.json()) as Partial<CreateJobResponseDTO>
  const jobId = created.job_id
  if (!jobId) throw new Error('Сервер не вернул идентификатор задания на сборку маршрута')

  const deadline = Date.now() + POLL_TIMEOUT_MS
  for (;;) {
    // Аудит HIGH #3: перед каждым шагом поллинга — не пережил ли цикл свой
    // unmount (RoutePage абортит signal в cleanup эффекта сборки).
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
    if (Date.now() > deadline) {
      throw new Error('Сборка маршрута занимает слишком много времени — попробуйте ещё раз чуть позже')
    }

    const statusRes = await fetch(`/api/route/jobs/${jobId}`, { signal })
    if (!statusRes.ok) throw new Error(`Не удалось получить статус сборки маршрута (${statusRes.status})`)
    const job = (await statusRes.json()) as JobStatusResponseDTO

    if (job.status === 'done') {
      if (!job.route) throw new Error('Маршрут собран, но сервер не прислал его содержимое')
      // Аудит MED #4: route.steps не массив → без проверки сырой TypeError
      // из mapRouteSteps/computeBatchIndexes всплыл бы в UI английским текстом.
      if (!Array.isArray(job.route.steps)) throw new Error('Сервер вернул маршрут в неожиданном формате')
      return mapRouteDTO(job.route, profile)
    }
    if (job.status === 'failed') {
      // [ID:P-abstract-goals] contract §3.6: response status=done&&len(steps)==0
      // трактуется BFF как failed `empty_route` — job.error тогда несёт код,
      // не готовый текст (в отличие от "route-provider недоступен" и т.п.,
      // которые уже человекочитаемы и проходят маппинг как no-op fallback).
      throw new Error((job.error && KNOWN_ERROR_MESSAGES[job.error]) || job.error || 'Не удалось собрать маршрут')
    }

    onPhase?.(job.status === 'running' ? 'running' : 'pending')
    await delay(POLL_INTERVAL_MS)
  }
}
