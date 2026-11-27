// puzzle-targets.ts — Puzzle Movies (Складчик) каталог → цель маршрута.
//
// Contract v2 2026-07-16 [ID:P-film-picker] §3.3: порт desktop
// anki_conf/electron/renderer/components/panels/CoursesPanel/route/skladchik-targets.ts,
// УРЕЗАННЫЙ — БЕЗ episode-логики (contract D2: сериал на flib.club = кнопка
// весь сериал одной целью (лейбл «С 1-й серии»); БЕЗ drill-in в список серий — тот
// путь desktop'а (episodeLabel/puzzleEpisodeToTarget) сюда не переносится).
// Чистые функции — тестируются напрямую, без сети/DOM (puzzle-targets.test.ts).
import type { PuzzleItem } from './api'

// Core's media_type integer mapping (internal/puzzlemovies/catalog.go, contract
// §1.2): 1 = премиум, 2 = сериал, 3 = фильм, 4 = мультфильм.
const MEDIA_KIND: Record<number, string> = {
  1: 'Премиум',
  2: 'Сериал',
  3: 'Фильм',
  4: 'Мультфильм',
}

export function mediaKindLabel(mediaType: number): string {
  return MEDIA_KIND[mediaType] || 'Видео'
}

/** Детерминированный hue 0..359 из slug — фон-градиент карточки, когда постера
 *  нет или его /api/puzzle/preview вернул 404 (см. FilmPicker onError). Один и
 *  тот же slug — всегда один и тот же hue (стабилен между рендерами/сессиями). */
export function slugHue(slug: string): number {
  let h = 0
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0
  return h % 360
}

/** Contract edge #3: ~3% каталога приходят с ПУСТЫМИ title_ru/title_en (gateway
 *  teaser их не несёт). Выводим читаемое имя из slug вместо сырого
 *  "westworld-2016" — отрезаем хвостовой "-YYYY" (если есть) и Title-Case
 *  остальные dash-разделённые слова. */
export function prettySlugTitle(slug: string): { title: string; year?: number } {
  const m = slug.match(/-(\d{4})$/)
  const base = m ? slug.slice(0, m.index) : slug
  const year = m ? parseInt(m[1], 10) : undefined
  const title = base
    .split('-')
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
  return { title: title || slug, year }
}

/** Отображаемое название: реальный заголовок каталога, если есть, иначе — выведенный из slug. */
export function displayTitle(item: PuzzleItem): string {
  const t = (item.title_ru || item.title_en || '').trim()
  return t || prettySlugTitle(item.slug).title
}

/** Отображаемый год: поле каталога (contract §1.2 — release_year указатель,
 *  может быть null/undefined), иначе распарсенный из "-YYYY" в slug. */
export function displayYear(item: PuzzleItem): number | undefined {
  return item.release_year ?? prettySlugTitle(item.slug).year
}

export interface PuzzleTarget {
  slug: string
  title: string
  kind: 'film' | 'series'
  target: string
}

/** puzzleItemToTarget — ЕДИНСТВЕННАЯ точка формата таргета (contract C2).
 *  Формат ДОКАЗАН чтением резолвера демона `resolveTargetPuzzleID`
 *  (anki_conf/internal/modules/lexicon/route_v2.go:196-238):
 *   - ФИЛЬМ (media_type 3/4) → `${slug}/${slug}` — ветка-1 direct hit,
 *     подтверждено боевыми тестами route_passport_smoke_test.go:21,
 *     audio_route_units_classify_test.go:19.
 *   - СЕРИАЛ (media_type 1/2) → голый `slug` → ветка-2 резолвит в ПИЛОТ
 *     `slug/s01e01` (TestBuildRouteV2_SeriesSlugTarget). ⚠️ НЕ «все серии» —
 *     route_v2 берёт ровно один puzzle_id; «все серии» как одна цель в демоне
 *     не существует (см. contract §7 — решение владельца по лейблу).
 *  ⚠️ Остаточно: bare-film-slug→branch3 не unit-тестирован — потому шлём
 *  проверенный `slug/slug`, не bare. Первый реальный билд на проде — финальное
 *  подтверждение. Смена формата — ОДНА строка `target` ниже, больше нигде. */
export function puzzleItemToTarget(item: PuzzleItem): PuzzleTarget {
  // S1 (спека §7.8): премиум (1) и сериал (2) — сериал, голый slug (резолвится для
  // всех сериалов каталога; id из /info строить нельзя — у части нет s01e01).
  // Фильм и мультфильм (3, 4) — slug/slug (копия каталога: 1→31, 2→1224, 3→4640, 4→435).
  const kind: 'film' | 'series' = isSeriesItem(item) ? 'series' : 'film'
  return {
    slug: item.slug,
    title: displayTitle(item),
    kind,
    // contract C2, route_v2.go:196 — фильм: slug/slug (ветка-1); сериал: голый slug (ветка-2 → пилот).
    target: kind === 'series' ? item.slug : `${item.slug}/${item.slug}`,
  }
}

/** Копии «-rt» (20 штук) в гостевом выборе не показываются и не выбираются
 *  (ни из сетки, ни по ссылке /try?goal=): демон на них отвечает unknown_target. */
export function isHiddenPuzzleSlug(slug: string | undefined): boolean {
  return /-rt$/.test(slug || '')
}

/** Сериал ли карточка для цели (премиум и сериал — голый slug). */
export function isSeriesItem(item: PuzzleItem): boolean {
  return item.media_type === 1 || item.media_type === 2
}

/**
 * Фильтр каталога по имени (contract §3.3 + edge #1): совпадение
 * case-insensitive подстрокой по title_ru, title_en И slug, результат
 * сортирован по popularity (desc, null/undefined → 0) и урезан до `limit`.
 * ПУСТОЙ запрос отдаёт top-`limit` самых популярных — НЕ весь каталог
 * (contract D1: каталог тянется в браузер целиком, но показывать его весь
 * до ввода запроса нельзя).
 */
export function filterPuzzleItems(items: PuzzleItem[], query: string, limit: number): PuzzleItem[] {
  const q = query.trim().toLowerCase()
  // Копии «-rt» (20 штук, media_type 2) в гостевом каталоге не показываются.
  const visible = items.filter(it => !isHiddenPuzzleSlug(it.slug))
  const pool = q
    ? visible.filter(it =>
        (it.title_ru || '').toLowerCase().includes(q) ||
        (it.title_en || '').toLowerCase().includes(q) ||
        (it.slug || '').toLowerCase().includes(q),
      )
    : visible
  return [...pool]
    .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))
    .slice(0, Math.max(0, limit))
}
