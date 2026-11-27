// Подделка BFF теста уровня для тестов хоста и страницы: файл ключа (`/api/me/placement`, PUT с проверкой
// owner/rev/белого списка, summary, apply) и звук (`/api/placement/audio/*`). fetch(url, init) —
// подмена и для apiCall (`apiDeps`), и для vi.stubGlobal('fetch', …).
export interface Call { method: string; path: string; body?: unknown }

const INVALID = ['no_audio', 'floor', 'yeasayer', 'careless']
const RUN_ID = /^pt-[0-9a-z]{1,16}-[0-9a-f]{16}$/
const KEYS = /^(kv:pt\.history|kv:pt\.history\.corrupt|docs:pt_results\/last|docs:pt_pending\/pt-[0-9a-z]{1,16}-[0-9a-f]{16})$/

export interface FakeServer {
  owner: string
  rev: number
  items: Record<string, unknown>
  applied: string | null
  declined: string | null
  calls: Call[]
  /** Состояние маршрута для блока «Маршрут» результата (null — 404). */
  routeState: unknown
  audioStatus: number
  applyCounted: number | null
  fetch: (url: string, init?: RequestInit) => Promise<Response>
  /** Разовые ответы на method+path (первый совпавший снимается). */
  once(method: string, path: string, ...rs: Array<Response | (() => Response | Promise<Response>)>): void
  callsTo(method: string, path: string): Call[]
  doc<T = unknown>(key: string): T | undefined
}

export const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })

export function fakeServer(owner = '0123456789abcdef'): FakeServer {
  const overrides: Array<{ key: string; r: Response | (() => Response | Promise<Response>) }> = []
  const s: FakeServer = {
    owner, rev: 0, items: {}, applied: null, declined: null, calls: [], routeState: null,
    audioStatus: 200, applyCounted: null,
    once(method, path, ...rs) { for (const r of rs) overrides.push({ key: `${method} ${path}`, r }) },
    callsTo: (m, p) => s.calls.filter((c) => c.method === m && c.path === p),
    doc: <T,>(k: string) => s.items[k] as T | undefined,
    async fetch(url, init) {
      const u = new URL(url, 'http://x')
      const method = init?.method ?? 'GET'
      const path = u.pathname
      let body: unknown
      if (init?.body) { try { body = JSON.parse(String(init.body)) } catch { body = undefined } }
      s.calls.push({ method, path, ...(body !== undefined ? { body } : {}) })
      const i = overrides.findIndex((o) => o.key === `${method} ${path}`)
      if (i >= 0) {
        const [o] = overrides.splice(i, 1)
        return typeof o.r === 'function' ? o.r() : o.r
      }
      if (path.startsWith('/api/placement/audio/')) {
        return s.audioStatus === 200 ? new Response(new Blob(['x']), { status: 200 }) : json(s.audioStatus, { error: 'audio_not_ready' })
      }
      if (path === '/api/me/route/state') return s.routeState ? json(200, s.routeState) : json(404, { error: 'not_found' })
      if (path === '/api/me/placement' && method === 'GET') {
        return json(200, { owner: s.owner, rev: s.rev, items: s.items, applied_run_id: s.applied, declined_run_id: s.declined })
      }
      if (path === '/api/me/placement' && method === 'PUT') {
        const b = body as { owner?: string; rev?: number; set?: Record<string, unknown> }
        if (b.owner !== s.owner) return json(409, { error: 'key_changed' })
        if (b.rev !== s.rev) return json(409, { error: 'stale', rev: s.rev })
        for (const k of Object.keys(b.set ?? {})) if (!KEYS.test(k)) return json(400, { error: 'bad_request', field: 'set' })
        for (const [k, v] of Object.entries(b.set ?? {})) { if (v === null) delete s.items[k]; else s.items[k] = v }
        s.rev++
        return json(200, { rev: s.rev })
      }
      if (path === '/api/me/placement/summary') {
        const last = s.items['docs:pt_results/last'] as { run_id: string; level: string; taken_at: string; flags: string[]; words: unknown[] } | undefined
        const hist = (s.items['kv:pt.history'] as Array<{ run_id: string; vocab_size: number }> | undefined) ?? []
        return json(200, {
          owner: s.owner, applied: !!last && s.applied === last.run_id, declined: !!last && s.declined === last.run_id,
          pending: Object.keys(s.items).some((k) => k.startsWith('docs:pt_pending/')),
          last: last ? {
            run_id: last.run_id, level: last.level, taken_at: last.taken_at, word_count: last.words.length,
            vocab_size: hist.find((r) => r.run_id === last.run_id)?.vocab_size ?? null,
            valid: !last.flags.some((f) => INVALID.includes(f)),
            floor: last.flags.includes('floor'),
          } : null,
        })
      }
      if (path === '/api/me/placement/apply' && method === 'POST') {
        const b = body as { owner?: string; run_id?: string; words?: unknown[] }
        if (b.owner !== s.owner) return json(409, { error: 'key_changed' })
        if (!b.run_id || !RUN_ID.test(b.run_id)) return json(400, { error: 'bad_request', field: 'run_id' })
        const last = s.items['docs:pt_results/last'] as { run_id: string } | undefined
        if (!last || last.run_id !== b.run_id) return json(409, { error: 'stale_run' })
        s.applied = b.run_id
        return json(200, { counted: s.applyCounted ?? (b.words ?? []).length })
      }
      return json(404, { error: 'not_found' })
    },
  }
  return s
}
