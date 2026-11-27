// pointA-titles.ts — перенос целей `flib:pointA` в `titles` (каталог, спека §7.4, PD-8).
//
// Гостевой выбор (/try) продолжает писать старые поля (goalsV2, filmGoal), поэтому
// перенос идёт при КАЖДОМ открытии кабинета: старые поля не трогаются, рядом
// пишется `titles: [{slug, title}]`. Если `titles` уже есть — побеждает оно.
import { loadPointA, readPointARaw, savePointATitles, type PointA, type TitleRef } from './pointA'
import { isTitleSlug } from './recent-titles'

export const MAX_POINT_A_TITLES = 10
const MAX_CHECK_SLUGS = 20 // ?slugs= принимает 1…20

/** Карточка тайтла из GET /api/me/catalog/titles?slugs= (нужные здесь поля). */
export interface TitleItem {
  slug: string
  title_en: string
  title_ru?: string
  goal_ok: boolean
}

const MAX_TITLE_LEN = 200

// readPointATitles — сохранённые titles после санитайзера: только массив, только
// {slug, title} с годным slug, без дублей, не больше 10. Остальное — как нет.
export function readPointATitles(p: PointA | null): TitleRef[] {
  const raw = p && p.kind === 'cefr' ? (p as { titles?: unknown }).titles : undefined
  if (!Array.isArray(raw)) return []
  const out: TitleRef[] = []
  for (const v of raw) {
    if (!v || typeof v !== 'object') continue
    const slug = (v as { slug?: unknown }).slug
    if (!isTitleSlug(slug) || out.some(o => o.slug === slug)) continue
    const t = (v as { title?: unknown }).title
    out.push({ slug, title: typeof t === 'string' ? t.slice(0, MAX_TITLE_LEN) : '' })
    if (out.length >= MAX_POINT_A_TITLES) break
  }
  return out
}

// slug старой цели: первый сегмент `target`, если он есть, иначе поле `slug`.
function legacySlug(g: unknown): string | null {
  if (!g || typeof g !== 'object') return null
  const { target, slug } = g as { target?: unknown; slug?: unknown }
  const first = typeof target === 'string' && target ? target.split('/')[0] : ''
  const s = first || slug
  return isTitleSlug(s) ? s : null
}

function legacySlugs(p: PointA): string[] {
  const out: string[] = []
  const add = (s: string | null) => { if (s && !out.includes(s)) out.push(s) }
  const v2 = (p as { goalsV2?: unknown }).goalsV2
  if (Array.isArray(v2)) {
    for (const g of v2) {
      if (g && typeof g === 'object' && (g as { type?: unknown }).type === 'puzzle') add(legacySlug(g))
    }
  }
  add(legacySlug((p as { filmGoal?: unknown }).filmGoal))
  return out.slice(0, MAX_CHECK_SLUGS) // проверка берёт до 20 slug; в titles уйдёт ≤ 10 годных
}

const same = (a: TitleRef[], b: TitleRef[]) => JSON.stringify(a) === JSON.stringify(b)

// migratePointATitles — предвыбор тайтлов для экрана старта. `check` — запрос
// `?slugs=` к снимку каталога. Чего нет в ответе или goal_ok=false — молча
// убирается (принятая потеря, PD-8). Сбой проверки ничего не пишет. Перенесённые
// slug в flib:recent-titles не попадают.
//
// Контракт `check` (важно для S5): ответ — МАССИВ карточек, в том числе пустой («все
// ушли из каталога» — положительный ответ). Любой не-массив (undefined, null, объект,
// ответ с ошибкой — apiCall их не бросает, а возвращает значением) — сбой проверки:
// ничего не пишется. Явный сбой — `null` или исключение.
export async function migratePointATitles(check: (slugs: string[]) => Promise<TitleItem[] | null>): Promise<TitleRef[]> {
  const rawBefore = readPointARaw()
  const p = loadPointA()
  if (!p || p.kind !== 'cefr') return []
  const stored = Array.isArray((p as { titles?: unknown }).titles)
  const current = readPointATitles(p)
  const candidates = stored ? current.map(t => t.slug) : legacySlugs(p)
  const kept: TitleRef[] = []
  if (candidates.length > 0) {
    let items: unknown
    try {
      items = await check(candidates)
    } catch {
      return current
    }
    if (!Array.isArray(items)) return current // C-1: не-массив — сбой, не «каталог пуст»
    for (const slug of candidates) {
      const it = (items as TitleItem[]).find(i => i && i.slug === slug)
      if (!it || it.goal_ok !== true) continue
      const title = (typeof it.title_ru === 'string' && it.title_ru) || (typeof it.title_en === 'string' ? it.title_en : '')
      kept.push({ slug, title: title.slice(0, MAX_TITLE_LEN) })
      if (kept.length >= MAX_POINT_A_TITLES) break
    }
  }
  // Нечего писать: первое открытие без переноса пустой titles не создаёт (он перекрыл
  // бы старые поля навсегда); без изменений — не пишем.
  if (stored ? same(kept, current) : kept.length === 0) return kept
  // M-1: запись изменилась, пока шла проверка, — результат устарел, не пишем.
  if (rawBefore === null || !savePointATitles(kept, rawBefore)) return readPointATitles(loadPointA())
  return kept
}
