// catalog-model.ts — чистая логика панели каталога и подробной карточки (план
// 2026-11-19, S6; спека §7.6): фильтры → параметры запроса, чипы, корзины темпа по
// конверту `pace`, пять групп слов, форматы чисел. Без React и без запросов.
//
// Решения владельца: уровня тайтла нигде нет (ни фильтра, ни сортировки «проще →
// сложнее»); жанр — только когда появятся названия (в снимке пока id); «18+» — метка
// без фильтра; темп без p50 — «оценка».
import { plural } from '../../plural'
import type { ListParams, TitleGroup, TitlePace } from './catalog-api'

export const PAGE_SIZE = 30
export const SEARCH_MAX_RUNES = 80
export const SEARCH_DEBOUNCE_MS = 300
export const SKELETON_COUNT = 12

export type TypeFilter = '' | 'series' | 'film' | 'cartoon'
export type YearFilter = '' | 'to1999' | 'y2000' | 'y2010' | 'from2020'
export type PaceFilter = '' | 'slow' | 'normal' | 'fast'
export type SortKey = 'popular' | 'new'

export interface Filters { q: string; type: TypeFilter; year: YearFilter; pace: PaceFilter; sort: SortKey }

export const EMPTY_FILTERS: Filters = { q: '', type: '', year: '', pace: '', sort: 'popular' }

export const TYPE_OPTIONS: Array<{ value: Exclude<TypeFilter, ''>; label: string }> = [
  { value: 'series', label: 'Сериалы' },
  { value: 'film', label: 'Фильмы' },
  { value: 'cartoon', label: 'Мультфильмы' },
]
export const YEAR_OPTIONS: Array<{ value: Exclude<YearFilter, ''>; label: string; from?: number; to?: number }> = [
  { value: 'to1999', label: 'До 2000', to: 1999 },
  { value: 'y2000', label: '2000–2009', from: 2000, to: 2009 },
  { value: 'y2010', label: '2010–2019', from: 2010, to: 2019 },
  { value: 'from2020', label: '2020 и новее', from: 2020 },
]
export const PACE_OPTIONS: Array<{ value: Exclude<PaceFilter, ''>; label: string }> = [
  { value: 'slow', label: 'Медленно' },
  { value: 'normal', label: 'Обычно' },
  { value: 'fast', label: 'Быстро' },
]
export const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: 'popular', label: 'Популярное' },
  { value: 'new', label: 'Новое' },
]

const labelOf = <T extends string>(opts: Array<{ value: T; label: string }>, v: string): string | undefined =>
  opts.find(o => o.value === v)?.label

const runes = (s: string, max: number): string => Array.from(s).slice(0, max).join('')

/** Строка поиска как уйдёт в запрос: trim, ≤ 80 рун; пусто — undefined. */
export function searchTerm(q: string): string | undefined {
  const t = runes(typeof q === 'string' ? q.trim() : '', SEARCH_MAX_RUNES).trim()
  return t === '' ? undefined : t
}

// buildListParams — фильтры → параметры списка. Незнакомые значения (испорченное
// состояние) не уходят: BFF ответил бы 400 bad_param.
export function buildListParams(f: Filters, offset: number, snapshot?: string): ListParams {
  const p: ListParams = {}
  const q = searchTerm(f.q)
  if (q) p.q = q
  if (labelOf(TYPE_OPTIONS, f.type)) p.type = f.type
  if (labelOf(PACE_OPTIONS, f.pace)) p.pace = f.pace
  const y = YEAR_OPTIONS.find(o => o.value === f.year)
  if (y?.from !== undefined) p.year_from = y.from
  if (y?.to !== undefined) p.year_to = y.to
  p.sort = f.sort === 'new' ? 'new' : 'popular'
  p.limit = PAGE_SIZE
  p.offset = Math.max(0, Math.trunc(offset) || 0)
  if (snapshot) p.snapshot = snapshot
  return p
}

export type ChipKey = 'type' | 'year' | 'pace'
export interface Chip { key: ChipKey; label: string; value: string }

export function activeChips(f: Filters): Chip[] {
  const out: Chip[] = []
  const t = labelOf(TYPE_OPTIONS, f.type)
  if (t) out.push({ key: 'type', label: 'Тип', value: t })
  const y = labelOf(YEAR_OPTIONS, f.year)
  if (y) out.push({ key: 'year', label: 'Год', value: y })
  const p = labelOf(PACE_OPTIONS, f.pace)
  if (p) out.push({ key: 'pace', label: 'Темп речи', value: p })
  return out
}

export function removeChip(f: Filters, key: ChipKey): Filters {
  return { ...f, [key]: '' }
}

/** Есть что сбрасывать: фильтр или непустой поиск (сортировка — не фильтр). */
export function hasFilters(f: Filters): boolean {
  return activeChips(f).length > 0 || searchTerm(f.q) !== undefined
}

export function pagesNext(loaded: number, total: number): boolean {
  return Number.isFinite(loaded) && Number.isFinite(total) && loaded > 0 && loaded < total
}

// --- темп ----------------------------------------------------------------------------

export type PaceBucket = 'slow' | 'normal' | 'fast'

// paceBucket — корзина по конверту ответа (`pace`), не по константам страницы:
// терцили считает шлюз, пересчёт у него не ломает страницу. Битый конверт — null.
export function paceBucket(wpm: number, pace: TitlePace | undefined | null): PaceBucket | null {
  if (!Number.isFinite(wpm) || !pace) return null
  const { slow_below: lo, fast_from: hi } = pace
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(lo < hi)) return null
  return wpm < lo ? 'slow' : wpm < hi ? 'normal' : 'fast'
}

export function wpmWord(b: PaceBucket | null): string {
  return b === 'slow' ? 'медленнее обычного' : b === 'fast' ? 'быстрее обычного' : b === 'normal' ? 'как в среднем' : ''
}

const SCALE_MIN = 100
const SCALE_MAX = 240

const clampPct = (v: number): number => Math.max(0, Math.min(100, ((v - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100))

/** Положение метки темпа и «в среднем» на шкале 100–240 сл/мин, проценты. */
export function paceMarks(wpm: number, median: number | undefined | null): { m: number; avg: number | null } {
  return { m: clampPct(wpm), avg: typeof median === 'number' && Number.isFinite(median) && median > 0 ? clampPct(median) : null }
}

/** «оценка» — темп не по медиане p50 (p75_est и любое будущее значение). */
export function tempoSourceLabel(source: string | undefined): string {
  return source === 'p50' ? '' : 'оценка'
}

// --- слова ---------------------------------------------------------------------------

const NB = ' '

export interface GroupMeta { name: string; range: string }
export const GROUP_META: GroupMeta[] = [
  { name: 'Самые частые', range: '1–1000 по частоте' },
  { name: 'Частые', range: '1001–2000 по частоте' },
  { name: 'Средние', range: '2001–5000 по частоте' },
  { name: 'Редкие', range: `5001–10${NB}000 по частоте` },
  { name: 'Очень редкие', range: `реже 10${NB}000 по частоте` },
]

// groupsToShow — группы к показу: только 1…5, по порядку, без повторов и пустых
// (forms ≤ 0). Мусор в ответе не бросает исключений.
export function groupsToShow(groups: unknown): Array<{ group: TitleGroup; meta: GroupMeta }> {
  if (!Array.isArray(groups)) return []
  const seen = new Set<number>()
  const out: Array<{ group: TitleGroup; meta: GroupMeta }> = []
  for (const g of groups as Array<TitleGroup | null>) {
    if (!g || typeof g !== 'object') continue
    const n = g.group
    if (!Number.isInteger(n) || n < 1 || n > GROUP_META.length || seen.has(n)) continue
    if (!(typeof g.forms === 'number' && g.forms > 0)) continue
    seen.add(n)
    out.push({ group: g, meta: GROUP_META[n - 1] })
  }
  return out.sort((a, b) => a.group.group - b.group.group)
}

export function formatCount(n: number): string {
  const v = Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0
  return v.toLocaleString('ru-RU').replace(/[  ]/g, NB)
}

export function formatShare(share: number): string {
  if (typeof share !== 'number' || !Number.isFinite(share)) return ''
  const pct = Math.max(0, Math.min(100, share * 100))
  if (pct > 0 && pct < 0.05) return `меньше 0,1${NB}%`
  return `${String(Math.round(pct * 10) / 10).replace('.', ',')}${NB}%`
}

export function formsLabel(n: number): string {
  return `${formatCount(n)} ${plural(n, 'словоформа', 'словоформы', 'словоформ')}`
}

export function phraseCountLabel(n: number): string {
  return plural(n, 'оборот', 'оборота', 'оборотов')
}

// --- тексты (черновики владельца, спека §7.6; обращение «Вы») -------------------------

export const CATALOG_LABEL = 'Каталог источников'
export const NOTHING_FOUND = 'Ничего не нашлось.'
export const NOTHING_FOUND_HINT = 'Уберите часть фильтров.'
export const RESET_FILTERS = 'Сбросить фильтры'
export const WORDS_HINT = 'Считаем словоформы: is, are и am — три разные'
export const DETAIL_UNAVAILABLE = 'Подробности для этого материала пока недоступны'
export const FIRST_EPISODE_NOTE = 'Цель — первая серия'
