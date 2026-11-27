// recent-titles.ts — «Недавние» тайтлы этого устройства (каталог, спека §7.5):
// выбранное или открытое, новые впереди, до 20 slug в localStorage
// `flib:recent-titles`. Хранилище недоверенное (испорчено, недоступно) — любое
// чтение даёт валидный список, запись не бросает.
const KEY = 'flib:recent-titles'
const MAX = 20
const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,127}$/

export function isTitleSlug(v: unknown): v is string {
  return typeof v === 'string' && SLUG_RE.test(v)
}

export function loadRecentTitles(): string[] {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const out: string[] = []
    for (const v of parsed) {
      if (isTitleSlug(v) && !out.includes(v)) out.push(v)
      if (out.length >= MAX) break
    }
    return out
  } catch {
    return []
  }
}

export function pushRecentTitle(slug: string): void {
  if (!isTitleSlug(slug)) return
  try {
    const next = [slug, ...loadRecentTitles().filter(s => s !== slug)].slice(0, MAX)
    window.localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // хранилище недоступно — «Недавние» просто не копятся
  }
}
