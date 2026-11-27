// start-model.ts — экран старта маршрута v2 и экран подбора (дизайн владельца
// 2026-11-19, docs/design/cabinet-2026-11-19 §3a/§3b). Чистые функции и тексты:
// без React и без запросов.
import { plural } from '../../plural'

export type StartLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1'

// LEVELS — шаг 1 «Уровень»: тексты владельца (утверждены, дизайн §3a).
export const START_LEVELS: Array<{ id: StartLevel; name: string; text: string }> = [
  { id: 'A1', name: 'почти с нуля', text: 'Вы читаете и переводите отдельные фразы и слова, но не понимаете их на слух у носителей.' },
  { id: 'A2', name: 'базовый', text: 'Известные фразы Вы узнаёте в речи, но общий смысл улавливаете с трудом.' },
  { id: 'B1', name: 'средний', text: 'С субтитрами Вам кажется, что любой сериал Вам уже понятен. Повторяете любую реплику по смыслу.' },
  { id: 'B2', name: 'уверенный', text: 'Иногда подсматриваете слова в субтитрах, спорите о переводе, стремитесь освоить больше переносных значений.' },
  { id: 'C1', name: 'продвинутый', text: 'Говорите и понимаете на слух почти всё. Вам хочется освоить профессиональную среду английского и Вы принесли свой материал.' },
]

export const DEFAULT_LEVEL: StartLevel = 'A2'

export function isStartLevel(v: unknown): v is StartLevel {
  return typeof v === 'string' && START_LEVELS.some(l => l.id === v)
}

// whyTexts — подпись шага 2 «Цель» по уровню (дизайн §3a): A1 — своя, A2–B2 —
// общая, C1 — два абзаца.
export function whyTexts(level: StartLevel): string[] {
  if (level === 'A1') {
    return ['Начните с чего-то простого и запоминающегося. Фильтр для A1 поможет выбрать особые видео, которые дадут особый потенциал для будущего и одновременно легки в освоении.']
  }
  if (level === 'C1') {
    return [
      'Для Вас может быть полезен раздел ниже на странице, где можно передать ссылки на Youtube-каналы, добавить свой особый список слов или даже прислать своё видео или аудио (разбор аудио и видео скоро).',
      'Фильмы и сериалы на любой вкус, выбирайте, чтобы получить персональные рекомендации для просмотра роликов от Вашего уровня до понимания темпа и речи цели на слух.',
    ]
  }
  return ['Выбирайте свою цель, к которой Вы пойдёте через наши рекомендации и станете свободно понимать её на слух']
}

// levelSummary — сводка нижней полосы: «A2 · базовый».
export function levelSummary(level: StartLevel): string {
  const l = START_LEVELS.find(x => x.id === level)!
  return `${l.id} · ${l.name}`
}

// NEED_GOAL_PROMPT — без цели маршрута нет (решение владельца 2026-11-19: «Маршрут
// без цели не имеет смысла. Предлагаю просить выбрать цель.»): подсказка в сводке и
// у шага 2 вместо обещания «маршрут построится по уровню».
export const NEED_GOAL_PROMPT = 'Выберите хотя бы одну цель'

// SHOW_CATALOG — каталог источников и подробная карточка (дизайн §3c/§3d): переключатель
// подборок, «Подробнее» и плитка «Все фильмы и сериалы». В сборке ВКЛЮЧЕНО (S7a); показ
// решает сервер: пока session.catalog=false (BFF CABINET_CATALOG_ENABLED=0), экран прежний.
export const SHOW_CATALOG = true

// catalogOn — каталог на экране старта: сборка (SHOW_CATALOG) И сервер (session.catalog).
// Любая сторона выключена — экран ровно прежний (курируемые карточки /api/goals).
export function catalogOn(sessionCatalog: boolean, show: boolean = SHOW_CATALOG): boolean {
  return show === true && sessionCatalog === true
}

// --- тексты быстрого старта с целями-тайтлами (спека §7.3, Р-В14; обращение «Вы») ---

export const CATALOG_UNAVAILABLE_TEXT = 'Каталог временно недоступен. Попробуйте через минуту.'
export const TITLE_UNKNOWN_TEXT = 'Этого материала больше нет в каталоге — уберите его из цели'
export const TITLE_UNAVAILABLE_TEXT = 'Этот материал пока нельзя выбрать целью — уберите его из цели'
export const TARGET_INVALID_TEXT = 'Страница устарела. Обновите её и выберите цель заново'
export const TOO_MANY_TITLES_TEXT = 'Можно выбрать до 10 целей'
export const TOO_MANY_GOALS_TEXT = 'Можно выбрать до 20 целей вместе с роликами'

// quickStartErrorText — текст отказа быстрого старта по коду BFF; null — код не из
// этого набора. `too_many_goals` делится по полю `field` (goal.titles / goal).
export function quickStartErrorText(code: string | null, body: Record<string, unknown> | null): string | null {
  switch (code) {
    case 'goal_title_unknown': return TITLE_UNKNOWN_TEXT
    case 'goal_title_unavailable': return TITLE_UNAVAILABLE_TEXT
    case 'goal_target_invalid': return TARGET_INVALID_TEXT
    case 'catalog_unavailable': return CATALOG_UNAVAILABLE_TEXT
    case 'too_many_goals': return body?.field === 'goal.titles' ? TOO_MANY_TITLES_TEXT : TOO_MANY_GOALS_TEXT
    default: return null
  }
}

// toggleTitleRef — выбор/снятие тайтла; сверх max новый не добавляется (потолок PD-4),
// снятие работает всегда. Чистая: проверка не зависит от того, заблокирована ли кнопка.
export function toggleTitleRef<T extends { slug: string }>(list: readonly T[], item: T, max: number): T[] {
  if (list.some(t => t.slug === item.slug)) return list.filter(t => t.slug !== item.slug)
  return list.length >= max ? [...list] : [...list, item]
}

// typeLabel — «Сериал» / «Фильм» / «Мультфильм» карточки каталога.
export function typeLabel(t: string): string {
  return t === 'series' ? 'Сериал' : t === 'film' ? 'Фильм' : t === 'cartoon' ? 'Мультфильм' : ''
}

export const ALL_TITLES_TEXT = 'Все фильмы и сериалы'
export const TITLE_OFF_TEXT = 'Пока нельзя выбрать'
export const POPULAR_LABEL = 'Популярное'
export const RECENT_LABEL = 'Недавние'

// totalLabel — «6 312 в каталоге» (разделитель тысяч — пробел, как в макете).
export function totalLabel(n: number): string {
  return `${Math.max(0, Math.trunc(n)).toLocaleString('ru-RU').replace(/[\u202f\u00a0]/g, '\u00a0')} в каталоге`
}

export function imdbUrl(id: string): string {
  return `https://www.imdb.com/title/${id}/`
}

// ytThumb — превью ролика YouTube (CSP сайта разрешает i.ytimg.com).
export function ytThumb(videoId: string): string {
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/mqdefault.jpg`
}

// --- экран «Подбираем ролики» (§3b) -------------------------------------------------

export const PICK_EXPECTED_MS = 2 * 60_000
const PICK_MAX_PCT = 95

// pickProgress — оценка по прошедшему времени против 2 минут: процент (до готовности
// никогда не 100 — потолок 95) и «осталось около N минут» (не меньше 1).
export function pickProgress(elapsedMs: number): { pct: number; minutesLeft: number } {
  const e = Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0)
  const pct = Math.min(PICK_MAX_PCT, Math.floor((e / PICK_EXPECTED_MS) * 100))
  const minutesLeft = Math.max(1, Math.ceil((PICK_EXPECTED_MS - e) / 60_000))
  return { pct, minutesLeft }
}

export function minutesLeftLabel(n: number): string {
  return `осталось около ${n} ${plural(n, 'минуты', 'минут', 'минут')}`
}

export const PICK_STEPS = [
  'Уровень и цели сохранены',
  'Собираем словарь целей',
  'Подбираем ролики YouTube под Ваш уровень',
  'Собираем первый день',
] as const

// pickStep — текущий шаг (0…3) по статусу задания обмена: нет задания — шаг 1;
// waiting — шаг 2; claimed / processing — шаг 3; done — шаг 4.
export function pickStep(status: string | null | undefined): number {
  if (status === 'waiting') return 1
  if (status === 'claimed' || status === 'processing') return 2
  if (status === 'done') return 3
  return 0
}
