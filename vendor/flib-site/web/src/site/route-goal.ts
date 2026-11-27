// route-goal.ts — сборка цели маршрута из pointA (вынесено из RoutePage.tsx без
// изменений: им пользуются гостевой маршрут /route и быстрый старт кабинета,
// спека 2026-11-17 §4.4 «goalOf() из RoutePage.tsx»).
import type { RouteGoal } from './api'
import type { PointA, GoalItemV2 } from './pointA'

function goalIdsOf(pointA: PointA): string[] {
  return pointA.goals ?? []
}

// filmTargetOf — [ID:P-film-picker] contract §3.7: FilmPicker-цель (фильм/
// сериал каталога Puzzle Movies) как массив ровно 0 или 1 элементов для
// BuildRouteOptions.targets. kind='words' (ImportPage/тест) не несёт
// filmGoal вовсе (PointAWords не имеет этого поля) — TS уже сужает это на
// уровне типа, явная проверка kind==='cefr' здесь для рантайм-безопасности
// (pointA приходит из localStorage через loadPointA, TS не проверяет форму
// за пределами компиляции). CRIT (contract [R2]): должна протаскиваться в
// ТРИ вызова runBuildCore (runBuild/handleRestructure/handleReplaceVideo)
// ниже — без этого «Перестроить»/«Заменить» на film-маршруте шлют
// goal_ids:[]+targets:[] → BFF 400 missing_target.
function filmTargetOf(pointA: PointA): string[] {
  return pointA.kind === 'cefr' && pointA.filmGoal ? [pointA.filmGoal.target] : []
}

// GoalResolution — [ID:P-abstract-goals] возврат goalOf() ниже: три поля
// вместо трёх отдельных функций (filmTargetOf/goalIdsOf/новый goal-блок) —
// они взаимоисключающи (goalsV2-путь ВСЕГДА даёт goalIds:[]+goal, никогда
// goal+непустой goalIds сразу), поэтому один объект-результат честнее, чем
// три параллельных вызова, которые вызывающий код обязан был бы
// синхронизировать вручную.
export interface GoalResolution {
  goalIds: string[]
  targets: string[]
  goal?: RouteGoal
}

// GOAL_LABEL_MAX_RUNES — [ID:P-abstract-goals] Правка 3 (D5 контракта
// оставлен, D3 «фронт не шлёт label» отменён — русские названия тайтлов/
// категорий есть ТОЛЬКО у клиента в goalsV2[].title, BFF-фолбэк
// prettySlugTitle даёт английские, юзер на русском сайте увидел бы "The
// Wire" вместо "Прослушка"). BFF капит своё собрание на 120 РУН (не байт —
// кириллица, route.go goalLabelMaxLen) — зеркалим кап тут же, чтобы клиент
// не полагался на молчаливую обрезку сервера для собственного отображения.
const GOAL_LABEL_MAX_RUNES = 120

// truncateToRunes — срез СТРОГО по границе unicode-руны через Array.from
// (которая итерирует по code point, а не UTF-16 code unit) — `str.slice(0,120)`
// на кириллице/эмодзи рвёт суррогатные пары/составные графемы.
function truncateToRunes(s: string, maxRunes: number): string {
  const runes = Array.from(s)
  return runes.length <= maxRunes ? s : runes.slice(0, maxRunes).join('')
}

// labelPartOf — человекочитаемый кусок label для ОДНОГО элемента goalsV2, в
// порядке golden fixture (docs/impl-contract-2026-07-16-phase1-wizard-goals.md
// + scratchpad/golden-goal-fixture.md): puzzle/category → `title` как есть;
// youtube → в метку не идёт (одна часть «Мои ролики (N)» собирается в goalOf); custom → текст в
// кавычках-ёлочках, чтобы не сливался с соседними частями при join(' + ').
function labelPartOf(item: GoalItemV2): string {
  switch (item.type) {
    case 'puzzle': return item.title
    case 'category': return item.title
    case 'youtube': return `YouTube: ${item.videoId}`
    case 'custom': return `«${item.text}»`
  }
}

// goalOf — [ID:P-abstract-goals] contract §1 §2.5 (Правка 2/3 — аудит HIGH):
// единая точка сборки цели маршрута. `goalsV2` непустой → собрать блок `goal`
// (D3/golden fixture) «ВМЕСТО» legacy-путей (Q1-a) — goalIds:[], targets:[]
// (оба омитятся в теле POST, buildRoute уже это делает для пустых массивов).
// Итерация СТРОГО по порядку goalsV2 (golden fixture: puzzle_ids несёт
// puzzle И youtube вперемешку в порядке появления в массиве, не
// сгруппированными по типу; label — join(' + ') в ТОМ ЖЕ порядке).
// ⚠ Правка 2 (аудит HIGH): раньше существовал спец-тип `{type:'goal'}`
// (фолбэк «каталог недоступен») с ОТДЕЛЬНОЙ веткой — уходил как legacy
// `goal_ids` мимо блока `goal`, что при смешении с category-целью молча
// теряло фолбэк-цель (BFF при Goal!=nil legacy goal_ids не читает вовсе) И
// давало 400 unknown_goal_id (STATIC_GOALS id'шники не существуют на
// сервере). Вариант `goal` УДАЛЁН из GoalItemV2 (pointA.ts) — фолбэк-карточки
// теперь ОБЫЧНЫЕ `puzzle`-элементы (TryPage.tsx toggleFallbackGoal, слаг+
// target из живого fetchGoals()), поэтому goalOf больше не имеет спец-ветки:
// непустой goalsV2 ВСЕГДА даёт РОВНО блок `goal` (+goalIds:[]). `goalsV2`
// пуст/отсутствует → полный фолбэк на СТАРЫЕ поля (filmGoal/goals) — записи
// ДО этой задачи и /import продолжают работать.
export function goalOf(pointA: PointA): GoalResolution {
  const goalsV2 = pointA.kind === 'cefr' ? pointA.goalsV2 : undefined
  if (!goalsV2 || goalsV2.length === 0) {
    return { goalIds: goalIdsOf(pointA), targets: filmTargetOf(pointA) }
  }
  const puzzleIds: string[] = []
  const categories: string[] = []
  const textQueries: string[] = []
  const labelParts: string[] = []
  // Все ролики пользователя — ОДНА часть метки «Мои ролики (N)» на месте первого.
  const ytCount = goalsV2.filter(i => i.type === 'youtube').length
  let ytLabelPlaced = false
  for (const item of goalsV2) {
    if (item.type !== 'youtube') labelParts.push(labelPartOf(item))
    else if (!ytLabelPlaced) { labelParts.push(`Мои ролики (${ytCount})`); ytLabelPlaced = true }
    switch (item.type) {
      case 'puzzle':
        puzzleIds.push(item.target)
        break
      case 'youtube':
        // contract §1 D3: youtube → `youtube::<id>` в ТОТ ЖЕ puzzle_ids-массив,
        // порядок общий с puzzle (не отдельный массив).
        puzzleIds.push(`youtube::${item.videoId}`)
        break
      case 'category':
        categories.push(item.key)
        break
      case 'custom':
        textQueries.push(item.text)
        break
    }
  }
  const goal: RouteGoal = {}
  if (puzzleIds.length > 0) goal.puzzle_ids = puzzleIds
  if (categories.length > 0) goal.categories = categories
  if (textQueries.length > 0) goal.text_queries = textQueries
  const label = truncateToRunes(labelParts.join(' + '), GOAL_LABEL_MAX_RUNES)
  if (label) goal.label = label
  return { goalIds: [], targets: [], goal }
}

