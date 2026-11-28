// route-state.ts импортируется здесь только как ТИП (стирается компиляцией) —
// рантайм-зависимость идёт в обратную сторону (route-state.ts импортирует
// MOCK_ROUTE_STEPS отсюда), так что кругового рантайм-импорта нет.
import type { RouteStep } from './route-state'
// Кадры клипов — в бандле (Vite: /assets/<имя>-<hash>.png), не в web/public/img:
// путь /img/ BFF отдаёт лендингу шлюза (bff.LandingPaths), там они отвечали 404.
import clipZootopia from './img/clip-zootopia.png'
import clipPhm from './img/clip-phm.png'

// data.ts — типизированный порт temp/flib/data.js.
//
// Э0 переносит только то, что нужно лендингу и уже портированным общим
// компонентам (ClipPlayer, GoalPicker): CLIPS, GOAL_GROUPS, CEFR_LEVELS.
// ROUTE/ROUTE_META/WEEK_DIFF/PROBES/PRESETS из оригинала — воронка/маршрут/
// тест, заводятся в Э1/Э2/Э4 вместе со своими экранами.
//
// Э2 добавляет MOCK_ROUTE_STEPS — не прямой 1:1 порт window.ROUTE
// (temp/flib/data.js:75-84): тот массив был заточен под "сл/мин"-карточки
// track/map-вариантов (не переносим, см. RoutePage.tsx) и `thumb`
// (в модели RouteStep поля thumb нет — дизайна под карточки списка со
// статикой не было). Здесь — под RouteStep (route-state.ts): youtube-like
// videoId вместо thumb, 3 шага kind='words' (решение владельца — ОQ-5,
// план «Открытые вопросы — ЗАКРЫТЫ» п.5), статусы done/current/next/locked
// и суммарная длительность нарочно >30ч на 18 шагах — чтобы порционность
// "Дальше" (~1ч на батч, feedback-1 п.6в) реально пересекала границу
// многократно в тестах (при 1ч-лимите почти каждый шаг — новый батч).

/** Одно слово в пословной подсветке ClipPlayer (playphrase-стиль). */
export interface ClipWord {
  w: string
  /** Перевод/подсказка — показывается во всплывающем чипе, если задан. */
  r?: string
  /** Ключевое слово реплики — подсвечивается амброй, когда "on". */
  key?: number
}

export interface Clip {
  id: string
  title: string
  kind: string
  tc: string
  /** URL фонового кадра (картинка из бандла, см. импорты выше). */
  bg: string
  ru: string
  words: ClipWord[]
}

// --- Клипы для героя: пословная подсветка (как playphrase.me) ---
export const CLIPS: Clip[] = [
  {
    id: 'zootopia',
    title: 'Zootopia',
    kind: 'Мультфильм',
    tc: 'S01 · 05:47',
    bg: clipZootopia,
    ru: 'Я не знаю, когда пора сдаваться.',
    words: [
      { w: 'I' }, { w: "don't" }, { w: 'know' }, { w: 'when' },
      { w: 'to' }, { w: 'quit.', r: 'сдаваться', key: 1 },
    ],
  },
  {
    id: 'phm',
    title: 'Project Hail Mary',
    kind: 'Фильм',
    tc: '1:29:01',
    bg: clipPhm,
    ru: 'Выглядишь неплохо, но не так уж хорош.',
    words: [
      { w: 'You' }, { w: 'look' }, { w: 'pretty' }, { w: 'good' },
      { w: 'down' }, { w: 'here,' }, { w: 'but' }, { w: 'you' },
      { w: "ain't", r: 'не (разг.)', key: 1 }, { w: 'really' }, { w: 'good.', r: 'хорош', key: 1 },
    ],
  },
]

export interface Goal {
  id: string
  title: string
  meta: string
  weeks: number
}

export interface GoalGroup {
  id: string
  label: string
  hint: string
  goals: Goal[]
}

// --- Каталог целей (богатство выбора) ---
export const GOAL_GROUPS: GoalGroup[] = [
  {
    id: 'sitcom', label: 'Ситкомы', hint: 'быстрая разговорная речь',
    goals: [
      { id: 'friends', title: 'Friends', meta: 'CEFR B1–B2 · 236 серий', weeks: 9 },
      { id: 'office', title: 'The Office', meta: 'CEFR B2 · 201 серия', weeks: 12 },
      { id: 'bigbang', title: 'The Big Bang Theory', meta: 'CEFR B2 · 279 серий', weeks: 11 },
    ],
  },
  {
    id: 'film', label: 'Фильмы и мультфильмы', hint: 'по жанрам',
    goals: [
      { id: 'zootopia', title: 'Zootopia', meta: 'CEFR A2–B1 · семейный', weeks: 6 },
      { id: 'inception', title: 'Inception', meta: 'CEFR B2–C1 · триллер', weeks: 14 },
      { id: 'up', title: 'Up', meta: 'CEFR A2 · семейный', weeks: 5 },
    ],
  },
  {
    id: 'news', label: 'Новости', hint: 'спорт, политика',
    goals: [
      { id: 'bbc', title: 'BBC News', meta: 'CEFR B2 · политика', weeks: 13 },
      { id: 'espn', title: 'ESPN', meta: 'CEFR B1–B2 · спорт', weeks: 10 },
    ],
  },
  {
    id: 'podcast', label: 'Подкасты', hint: 'живой диалог',
    goals: [
      { id: 'lex', title: 'Lex Fridman', meta: 'CEFR C1 · интервью', weeks: 16 },
      { id: 'ted', title: 'TED Talks', meta: 'CEFR B2 · лекции', weeks: 12 },
    ],
  },
  {
    id: 'book', label: 'Книги', hint: 'аудио + текст',
    goals: [
      { id: 'hp', title: 'Harry Potter', meta: 'CEFR B1 · аудиокнига', weeks: 15 },
    ],
  },
]

/** Фолбэк-список целей для GoalChips (Э3 п.4): TryPage показывает его пока
 *  fetchGoals() не ответил / если сеть недоступна; ImportPage использует его
 *  как единственный источник (задача не требует живого каталога для импорта,
 *  см. GoalChips.tsx). Те же первые 8 целей каталога, что были заинлайнены
 *  в TryPage.tsx до выноса в общий компонент. */
export const STATIC_GOALS: Goal[] = GOAL_GROUPS.flatMap(g => g.goals).slice(0, 8)

export interface CefrLevel {
  id: string
  label: string
  words: number
}

// GOAL_CATEGORIES — [ID:P-abstract-goals] contract §1 D4/D4-BIS: UI-ключ→
// заголовок для «Групповых целей» визарда /try (шаг 2).
//
// ⚠ Ключи — ТЕ ЖЕ строки, что уходят в `goal.categories` (D3): это UI-ключи
// каталога §4, НЕ лексиконные значения `sources.category`. Белый список
// дублируется на BFF (route.go routeCategoryWhitelist) — он и валидирует.
//
// Показываем ВСЕ 14 (правка после сверки с реальным демоном, contract D4-BIS):
// демон `goal.categories` НЕ резолвит (CAPTURED ONLY) — кнопка строит маршрут
// ТОЛЬКО потому, что BFF подставляет ей слова из ETL-словаря
// (internal/bff/data/category_dicts.json). Словарь готов для всех 14 ключей
// (9 агрегированы из корпуса lexicon.db, 5 — LLM-сид ∩ реальные леммы), т.е.
// «сильных» и «слабых» кнопок для пользователя больше нет — разница лишь в
// происхождении слов. ⚠ Ключ БЕЗ словарной статьи показывать НЕЛЬЗЯ: он не даст
// слов, и цель-одиночка получит 400 goal_not_resolved (route.go resolveGoalV2).
export interface GoalCategory { key: string; title: string }
export const GOAL_CATEGORIES: GoalCategory[] = [
  { key: 'science', title: 'Наука' },
  { key: 'it-courses', title: 'IT-семинары и курсы' },
  { key: 'news-politics', title: 'Новости политики' },
  { key: 'news-sports', title: 'Новости спорта' },
  { key: 'everyday', title: 'Бытовая речь' },
  { key: 'business', title: 'Деловая речь' },
  { key: 'beginners', title: 'Для начинающих' },
  { key: 'docs', title: 'Документалки' },
  { key: 'history', title: 'История' },
  { key: 'standup', title: 'Стендапы' },
  { key: 'cooking', title: 'Кулинария' },
  { key: 'travel', title: 'Путешествия' },
  { key: 'religion', title: 'Религия' },
  { key: 'pronunciation', title: 'Произношение' },
]

// --- Анкета «Дай попробовать» ---
export const CEFR_LEVELS: CefrLevel[] = [
  { id: 'A1', label: 'A1 · почти с нуля', words: 300 },
  { id: 'A2', label: 'A2 · базовый', words: 900 },
  { id: 'B1', label: 'B1 · средний', words: 2000 },
  { id: 'B2', label: 'B2 · уверенный', words: 4000 },
  { id: 'C1', label: 'C1 · продвинутый', words: 6000 },
]

// --- Маршрут (Э2): мок-цепочка, см. комментарий сверху файла ---

/** Цель по умолчанию, когда pointA нет или он kind='words' (route-state.ts,
 *  buildMockRoute) — совпадает с window.ROUTE_META.goal оригинала. */
export const ROUTE_GOAL_FALLBACK = 'Friends без субтитров'

export const MOCK_ROUTE_STEPS: RouteStep[] = [
  { id: 'r1', kind: 'video', videoId: 'tNLwtufdlTY', title: 'Numbers 1–10 for Kids', source: 'Dream English', durationSec: 142, newLemmas: 8, words: [], status: 'done' },
  { id: 'r2', kind: 'video', videoId: 'dQw4w9WgXcQ', title: 'Everyday Greetings', source: 'Speak English', durationSec: 250, newLemmas: 14, words: [], status: 'done' },
  { id: 'r3', kind: 'words', videoId: null, title: 'Приветствия и вежливые фразы', source: 'Словарь маршрута', durationSec: 240, newLemmas: 6, words: ['hello', 'hi', 'thanks', 'please', 'sorry', 'goodbye'], status: 'done' },
  { id: 'r4', kind: 'video', videoId: 'jNQXAC9IVRw', title: 'At the Coffee Shop', source: 'EnglishClass101', durationSec: 331, newLemmas: 22, words: [], status: 'current' },
  { id: 'r5', kind: 'video', videoId: '9bZkp7q19f0', title: 'Zootopia · сцена 1', source: 'Disney', durationSec: 228, newLemmas: 30, words: [], status: 'next' },
  { id: 'r6', kind: 'video', videoId: 'kXYiU_JCYtU', title: 'Small Talk at Work', source: 'BBC Learning English', durationSec: 362, newLemmas: 26, words: [], status: 'next' },
  { id: 'r7', kind: 'words', videoId: null, title: 'Разговорные связки', source: 'Словарь маршрута', durationSec: 260, newLemmas: 6, words: ['actually', 'basically', 'honestly', 'anyway', 'though', 'sort of'], status: 'next' },
  { id: 'r8', kind: 'video', videoId: 'y6120QOlsfU', title: 'Friends · S01E01, отрывок', source: 'Warner Bros', durationSec: 435, newLemmas: 34, words: [], status: 'next' },
  { id: 'r9', kind: 'video', videoId: '3JZ_D3ELwOQ', title: 'News in Slow English', source: 'BBC', durationSec: 520, newLemmas: 28, words: [], status: 'next' },
  { id: 'r10', kind: 'video', videoId: 'e-ORhEE9VVg', title: 'TED-Ed: How language works', source: 'TED-Ed', durationSec: 623, newLemmas: 40, words: [], status: 'locked' },
  { id: 'r11', kind: 'video', videoId: 'RgKAFK5djSk', title: 'Friends · S01E02, отрывок', source: 'Warner Bros', durationSec: 460, newLemmas: 30, words: [], status: 'locked' },
  { id: 'r12', kind: 'video', videoId: 'CevxZvSJLk8', title: 'Zootopia · весь фильм', source: 'Disney', durationSec: 6120, newLemmas: 120, words: [], status: 'locked' },
  { id: 'r13', kind: 'video', videoId: '2Vv-BfVoq4g', title: 'The Office · пилот', source: 'NBC', durationSec: 1320, newLemmas: 60, words: [], status: 'locked' },
  { id: 'r14', kind: 'video', videoId: 'fJ9rUzIMcZQ', title: 'Inception · разбор трейлера', source: 'Warner Bros', durationSec: 900, newLemmas: 45, words: [], status: 'locked' },
  { id: 'r15', kind: 'words', videoId: null, title: 'Идиомы из ситкомов', source: 'Словарь маршрута', durationSec: 300, newLemmas: 5, words: ['break a leg', 'piece of cake', 'under the weather', 'hit the sack', 'spill the beans'], status: 'locked' },
  { id: 'r16', kind: 'video', videoId: 'YQHsXMglC9A', title: 'Friends · марафон сезона 1', source: 'Warner Bros', durationSec: 97200, newLemmas: 220, words: [], status: 'locked' },
  { id: 'r17', kind: 'video', videoId: 'OPf0YbXqDm0', title: 'BBC News · выпуск целиком', source: 'BBC', durationSec: 1800, newLemmas: 50, words: [], status: 'locked' },
  { id: 'r18', kind: 'video', videoId: 'hT_nvWreIhg', title: 'Friends · полная серия без субтитров', source: 'Warner Bros', durationSec: 1320, newLemmas: 70, words: [], status: 'locked' },
]

// Интересы пользователя — мультивыбор-заглушка (решение владельца 2026-07-14,
// скринкаст-3 + голосовое уточнение): выверенного источника интересов ещё
// нет, список сформулирован владельцем (20) + 4 добавленных; влияют на
// маршрут — уже сейчас уходят в job.json демону (params.interests), демон
// начнёт учитывать, когда научится. «Штук 20, если накинуто — не страшно».
export interface Interest { id: string; title: string }
export const INTERESTS: Interest[] = [
  { id: 'games', title: 'Игры' },
  { id: 'science-pop', title: 'Научпоп' },
  { id: 'novels', title: 'Книги и романы' },
  { id: 'sport', title: 'Спорт' },
  { id: 'travel', title: 'Путешествия' },
  { id: 'edu', title: 'Обучающие' },
  { id: 'math', title: 'Математика' },
  { id: 'physics', title: 'Физика' },
  { id: 'science', title: 'Наука' },
  { id: 'history', title: 'История' },
  { id: 'nature', title: 'Природа' },
  { id: 'animals', title: 'Животные' },
  { id: 'music', title: 'Музыка' },
  { id: 'crafts', title: 'Рукоделие' },
  { id: 'gambling', title: 'Азартные игры' },
  { id: 'comics', title: 'Комиксы' },
  { id: 'standup', title: 'Стендап' },
  { id: 'news', title: 'Новости' },
  { id: 'politics', title: 'Политика' },
  { id: 'geography', title: 'География' },
  { id: 'tech', title: 'Технологии' },
  { id: 'cooking', title: 'Кулинария' },
  { id: 'psychology', title: 'Психология' },
  { id: 'finance', title: 'Финансы' },
]
