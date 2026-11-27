// pointA.ts — точка А ("твой словарь сейчас"), общий для /try и /import.
//
// docs/plan-2026-07-13-design-transfer.md, задача Э1: обе воронки-ветки
// пишут результат в один и тот же ключ localStorage `flib:pointA`, дальше
// его читает /route (Э2). Формат — размеченное объединение по `kind`, а не
// два разных ключа, потому что дальше по цепочке (маршрут/бэк) нужен один
// источник истины "какая точка А выбрана последней", независимо от того,
// какой веткой воронки прошёл пользователь.
const POINT_A_KEY = 'flib:pointA'

// GoalItemV2 — [ID:P-abstract-goals] контракт v2 §2.1/D2 (Правка 2, аудит
// HIGH — см. handoff): элемент мульти-абстрактной цели визарда /try (шаг 2).
// Размеченное объединение по `type`, собирается в pointA.goalsV2[] (см.
// ниже) и на RoutePage.tsx (goalOf()) превращается в блок `goal` тела POST
// /api/route (contract §2.5/D3):
//  - puzzle   → `target` (§2.1 контракта, ПРОВЕРЕНО puzzle-targets.ts:88 +
//    тесты :84/:91): ФИЛЬМ (media_type 3/4) = `slug/slug` (ветка-1 демона,
//    route_v2.go:196), СЕРИАЛ и ПРЕМИУМ (media_type 1/2) = голый slug → якорь на пилот
//    s01e01 (ветка-2). НЕ «плоский slug» для всех типов сразу — формат
//    зависит от kind, это единственная точка формата (puzzleItemToTarget).
//    Фолбэк «каталог недоступен» (Q5-b) тоже кладётся сюда КАК ОБЫЧНЫЙ
//    puzzle-элемент (kind:'series' фиксированно, слаг/target — из
//    fetchGoals(), у которого ЕСТЬ реальный `target` — см. TryPage.tsx
//    toggleFallbackGoal) — раньше был отдельный вариант `{type:'goal'}`,
//    построенный из STATIC_GOALS (id'шники которых НЕ СУЩЕСТВУЮТ на сервере,
//    configs/goals.json несёт другой набор slug'ов) и уходивший в legacy
//    `goal_ids` мимо блока `goal` — это давало 400 unknown_goal_id И роняло
//    смешанный кейс «фолбэк-цель + категория» (BFF при Goal!=nil legacy
//    goal_ids не читает вовсе, см. RoutePage.tsx goalOf). Вариант `goal`
//    УДАЛЁН — фолбэк-карточки строятся ТОЛЬКО из fetchGoals().
//  - category → UI-ключ из таблицы §4 контракта (НЕ лексиконное sources.category).
//  - youtube  → `videoId` без title (D6 — неоткуда взять для чужой ссылки,
//    ТОЛЬКО парсер извлекает 11-символьный ID, БФФ резолвит `youtube::<id>`).
//  - custom   → «Ещё»-текст (D5, диалог с textarea maxLength=280, кап 5 штук
//    на фронте — TryPage.tsx CUSTOM_GOAL_MAX, зеркалит BFF abstractTextMaxCount).
export type GoalItemV2 =
  | { type: 'puzzle'; slug: string; title: string; kind: 'film' | 'series'; target: string }
  | { type: 'category'; key: string; title: string }
  | { type: 'youtube'; videoId: string; url: string }
  | { type: 'custom'; id: string; text: string }

export interface PointACefr {
  kind: 'cefr'
  level: string
  /** Возраст со слайдера (сырое число). Название унаследовано от ТЗ — банд
   *  по возрастным диапазонам, если понадобится, считается на бэке/маршруте
   *  из этого сырого значения, не здесь. */
  ageBand: number
  goals: string[]
  /** Интересы (мультивыбор-заглушка, 2026-07-14) — опциональны, уходят в
   *  params.interests джобы демона через POST /api/route. */
  interests?: string[]
  /** [ID:P-film-picker] Contract v2 §3.5: цель из FilmPicker (фильм/сериал
   *  каталога Puzzle Movies) — РОВНО ОДНА (contract C1, демон route_v2
   *  принимает ровно 1 target), не массив в отличие от `goals`. `target` —
   *  плоский slug (contract C2, puzzle-targets.ts puzzleItemToTarget) —
   *  RoutePage.tsx filmTargetOf() кладёт его в BuildRouteOptions.targets.
   *  [ID:P-abstract-goals] СТАРОЕ поле — визард /try больше его не пишет
   *  (см. `goalsV2` ниже), но RoutePage.tsx продолжает читать его как
   *  ФОЛБЭК для уже сохранённых ДО этой задачи записей localStorage и
   *  записей из /import (contract §1 D2). */
  filmGoal?: { slug: string; title: string; kind: 'film' | 'series'; target: string }
  /** [ID:P-abstract-goals] contract §1 D2: мульти-/абстрактная цель визарда
   *  /try (шаг 2, Фаза 1) — заменяет собой и `filmGoal`, и одиночный/
   *  фикс-выбор `goals` для НОВЫХ записей. Пустой массив ИЛИ отсутствие поля
   *  трактуются одинаково — «goalsV2 не активен» (как раньше `filmGoal`) —
   *  RoutePage.tsx (goalOf()) тогда фолбэчит на `filmGoal`/`goals`.
   *
   *  [R3] ИНВАРИАНТ (обновлено под goalsV2, контракт §1 D2 — ТЕКСТОМ, не
   *  ссылкой на устаревший комментарий): визард на «Готово» собирает
   *  СВЕЖИЙ объект `savePointA({kind:'cefr', level, ageBand, interests,
   *  savedAt, goalsV2, goals:[], filmGoal:undefined})` — **НИКОГДА**
   *  `{...loadPointA(), goalsV2}`. Спред старого объекта протащил бы
   *  осиротевшие `filmGoal`/`goals` от ПРЕДЫДУЩЕГО выбора (другого типа/
   *  сессии) рядом с новым `goalsV2` — RoutePage.tsx правило «goalsV2
   *  непустой → ВМЕСТО legacy, не РЯДОМ» спасает от смешивания в блоке
   *  `goal`, но само поле filmGoal/goals осталось бы мусором в
   *  localStorage. pointA.ts сам инвариант НЕ проверяет (чистое хранилище,
   *  «что дали — то и сохранили») — гарантия целиком на TryPage.tsx. */
  goalsV2?: GoalItemV2[]
  /** Цели-тайтлы кабинета (каталог, спека §7.4): пишет ТОЛЬКО savePointATitles
   *  при переносе старых целей; RoutePage.tsx и гостевой /try это поле не
   *  читают и не пишут. Читать — через readPointATitles (санитайзер). */
  titles?: TitleRef[]
  savedAt: string
}

/** Тайтл каталога в предвыборе: slug и русское название (для показа). */
export interface TitleRef {
  slug: string
  title: string
}

export interface PointAWords {
  kind: 'words'
  words: string[]
  /** Цели ("что хочешь понимать"), Э3 п.4б: импорт словами сам по себе не
   *  несёт цели, а маршруту (goal_ids в POST /api/route) она нужна —
   *  ImportPage.tsx собирает её тем же GoalChips, что и TryPage.tsx. */
  goals: string[]
  interests?: string[]
  /** Проброс профиля в демон (задача P-profile-feed, 2026-07-14): kind='words'
   *  раньше не различал «прошёл тест» (test-page/ResultScreen.tsx) от
   *  «загрузил словарь» (ImportPage.tsx) — бэку это нужно для vocab_source в
   *  profile_meta (см. api.ts). ОБЯЗАТЕЛЬНОЕ поле у новых записей, но
   *  loadPointA() ниже продолжает принимать старые localStorage-записи БЕЗ
   *  него (source будет undefined в рантайме, TS этого не проверяет за
   *  пределами компиляции) — RoutePage.tsx тогда шлёт бэку
   *  vocab_source:'unknown', не угадывает по формату слов. */
  source: 'test' | 'upload'
  /** CEFR-оценка теста (synthResult.profile.cefr, "справочно") — есть
   *  только у test-пути (ResultScreen.tsx сохраняет её сюда). ImportPage.tsx
   *  такую оценку физически не собирает, поле остаётся undefined. Уходит в
   *  profile_meta.level (api.ts), когда есть. */
  levelEstimate?: string
  savedAt: string
}

export type PointA = PointACefr | PointAWords

// savePointA — [ID:P-abstract-goals] Правка 5 (аудит MED): возвращает
// boolean-успех, а не молчит. До этой правки Safari-приватный-режим/забитая
// квота глотали исключение и вызывающий код (TryPage.tsx handleFinish) всё
// равно навигировал на /route — RoutePage строил маршрут из СТАРОГО pointA
// (прошлый filmGoal/goalsV2 из предыдущей сессии), юзер молча получал чужую
// цель. Возврат значения обратно совместим — ImportPage.tsx/ResultScreen.tsx
// продолжают вызывать savePointA(...) без учёта результата и не ломаются.
export function savePointA(point: PointA): boolean {
  try {
    window.localStorage.setItem(POINT_A_KEY, JSON.stringify(point))
    return true
  } catch {
    // localStorage недоступен (приватный режим/заблокированное хранилище) —
    // не роняем UI из-за этого здесь; вызывающий код (TryPage.tsx) решает,
    // что показать юзеру по false.
    return false
  }
}

// savePointATitles — [каталог, спека §7.4] единственный писатель поля `titles`.
// Пишет сохранённый объект с ПОБАЙТНО прежними полями + titles: объявленное
// исключение из инварианта «никогда не спредить» выше — titles не читает
// RoutePage.tsx, а гостевой /try на каждом выборе пишет свежий объект (поле
// исчезает). Объект kind:'words' и нечитаемая запись не трогаются (false).
// expectedRaw — сравнить-и-записать: пишет, только если запись в хранилище всё ещё
// ровно эта строка (миграция ждёт ответ сети; за это время запись могли изменить).
export function savePointATitles(titles: TitleRef[], expectedRaw?: string): boolean {
  try {
    const raw = window.localStorage.getItem(POINT_A_KEY)
    if (!raw) return false
    if (expectedRaw !== undefined && raw !== expectedRaw) return false
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.kind !== 'cefr') return false
    window.localStorage.setItem(POINT_A_KEY, JSON.stringify({ ...parsed, titles }))
    return true
  } catch {
    return false
  }
}

// loadPointA — читает точку А (Э2, /route: buildMockRoute нужен pointA, чтобы
// понять цель). Валидирует kind, а не просто "JSON распарсился" — чужая
// схема в этом же ключе (или мусор) не должна притвориться валидной точкой А.
// clearPointA — feedback-2 п.2: см. route-state.ts clearRoute (тот же
// сброс-флоу «Сбросить маршрут» удаляет ОБА ключа — маршрут построен из
// точки А, оставшаяся точка А без явного clearRoute() иначе бесшумно
// пересобрала бы тот же маршрут на /route без похода через /fork заново).
export function clearPointA(): void {
  try {
    window.localStorage.removeItem(POINT_A_KEY)
  } catch {
    // localStorage недоступен — уже нечего чистить, no-op.
  }
}

// readPointARaw — сырая строка записи (для сравнить-и-записать); null — нет/недоступно.
export function readPointARaw(): string | null {
  try {
    return window.localStorage.getItem(POINT_A_KEY)
  } catch {
    return null
  }
}

export function loadPointA(): PointA | null {
  try {
    const raw = window.localStorage.getItem(POINT_A_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed && (parsed.kind === 'cefr' || parsed.kind === 'words')) {
      // filmGoal — optional: старые записи (до P-film-picker) не несут его в
      // JSON вовсе, `parsed.filmGoal` тогда просто undefined в рантайме, TS не
      // проверяет это за пределами компиляции — вызывающий код (RoutePage.tsx
      // filmTargetOf) уже трактует "нет filmGoal" как film-путь неактивен.
      return parsed as PointA
    }
    return null
  } catch {
    return null
  }
}
