// fake-catalog.ts — подставной BFF каталога для тестов панели и карточки: записывает
// запросы, отвечает по сценарию. Подменяет глобальный fetch (apiCall идёт через него).
import { vi } from 'vitest'

export const SNAP = 'aaaaaaaaaaaaaaaa'
export const SNAP2 = 'bbbbbbbbbbbbbbbb'
export const PACE = { slow_below: 160, fast_from: 178 }

export const card = (slug: string, over: Record<string, unknown> = {}) =>
  ({ slug, type: 'series', title_en: slug, goal_ok: true, ...over })

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
}

export interface Call { url: string }

export class FakeCatalog {
  calls: Call[] = []
  /** Все тайтлы каталога (список режется limit/offset). */
  titles: Array<Record<string, unknown>> = []
  total: number | null = null
  snapshot = SNAP
  /** Сценарий: вернуть Response — перехватить запрос; null/undefined — обычный ответ. */
  reply: ((url: string, n: number) => Response | Promise<Response> | null | undefined) | null = null
  detail: ((slug: string, url: string) => Response) | null = null

  list(): string[] { return this.calls.map(c => c.url).filter(u => !/\/titles\/[^?]/.test(u) && !u.includes('slugs=')) }
  details(): string[] { return this.calls.map(c => c.url).filter(u => /\/titles\/[^?]/.test(u)) }
  slugsCalls(): string[] { return this.calls.map(c => c.url).filter(u => u.includes('slugs=')) }

  install() {
    vi.stubGlobal('fetch', vi.fn((u: string) => this.fetch(u)))
  }

  async fetch(url: string): Promise<Response> {
    this.calls.push({ url })
    const custom = this.reply?.(url, this.calls.length)
    if (custom) return custom
    const m = /\/api\/me\/catalog\/titles\/([^?]+)/.exec(url)
    if (m) {
      const slug = decodeURIComponent(m[1])
      return this.detail ? this.detail(slug, url) : json(404, { error: 'title_not_found' })
    }
    const u = new URL(url, 'http://x')
    const slugs = u.searchParams.get('slugs')
    if (slugs !== null) {
      const want = slugs.split(',')
      return json(200, { snapshot: this.snapshot, items: want.flatMap(s => this.titles.filter(t => t.slug === s)) })
    }
    const limit = Number(u.searchParams.get('limit') ?? 30)
    const offset = Number(u.searchParams.get('offset') ?? 0)
    return json(200, {
      snapshot: this.snapshot, total: this.total ?? this.titles.length, tempo_median_wpm: 169, pace: PACE,
      items: this.titles.slice(offset, offset + limit),
    })
  }
}

export const many = (n: number, prefix = 't') => Array.from({ length: n }, (_, i) => card(`${prefix}${i + 1}`, { title_en: `Title ${i + 1}`, year: 2000 + (i % 20) }))
