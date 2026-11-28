// outbox-fakes.ts — стенды для тестов очереди: память вместо localStorage,
// общая блокировка двух «вкладок», сценарный BFF событий.
import type { OutboxLocks } from '../outbox'

export class MemStorage implements Storage {
  private m = new Map<string, string>()
  failWrites = false
  get length(): number { return this.m.size }
  clear(): void { this.m.clear() }
  getItem(k: string): string | null { return this.m.has(k) ? this.m.get(k)! : null }
  key(i: number): string | null { return [...this.m.keys()][i] ?? null }
  removeItem(k: string): void { this.m.delete(k) }
  setItem(k: string, v: string): void {
    if (this.failWrites) throw new DOMException('quota', 'QuotaExceededError')
    this.m.set(k, String(v))
  }
}

// SharedLock — Web Locks на двоих: fn второй вкладки ждёт конца первой.
export class SharedLock implements OutboxLocks {
  private tail: Promise<unknown> = Promise.resolve()
  held = false
  request<T>(_name: string, fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(async () => {
      this.held = true
      try { return await fn() } finally { this.held = false }
    })
    this.tail = run.catch(() => undefined)
    return run
  }
}

export interface Sent { body: { route_id: string; events: Array<Record<string, unknown>> }; init: RequestInit }

export type Reply = (s: Sent) => Response | Promise<Response>

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
}

// ok200 — ответ BFF: все события приняты, кроме перечисленных отказов.
export function ok200(s: Sent, rejected: Array<{ event_id: string; reason: string }> = []): Response {
  return json(200, {
    accepted: s.body.events.length - rejected.length, duplicates: 0,
    rejected: rejected.map(r => ({ index: s.body.events.findIndex(e => e.event_id === r.event_id), ...r })),
    evicted_external: 0,
  })
}

// FakeBFF — запоминает каждую пачку; ответ — по сценарию (по умолчанию 200).
export class FakeBFF {
  sent: Sent[] = []
  keepalive: Sent[] = []
  reply: Reply = s => ok200(s)
  fetch = async (_url: string, init: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init.body)) as Sent['body']
    const s = { body, init }
    if (init.keepalive) { this.keepalive.push(s); return json(200, {}) }
    this.sent.push(s)
    return this.reply(s)
  }
  ids(): string[] { return this.sent.flatMap(s => s.body.events.map(e => String(e.event_id))) }
}

export const ROUTE_A = '11111111-1111-4111-8111-111111111111'
export const ROUTE_B = '22222222-2222-4222-8222-222222222222'

let n = 0
export function ev(type: string, extra: Record<string, unknown> = {}): { event_id: string; type: string; puzzle_id: string; [k: string]: unknown } {
  n++
  return {
    event_id: `web:test-${n}`, type, puzzle_id: 'youtube::abcdefghijk',
    learning_day: '2026-11-18', client_ts: new Date().toISOString(), ...extra,
  }
}

// heard — clip_played с k различными услышанными репликами.
export function played(k: number, extra: Record<string, unknown> = {}) {
  const subs_heard = Array.from({ length: k }, (_, i) => ({ sub_ref: String(i), from_ms: i * 1000, to_ms: i * 1000 + 900, rate_min: 1, count: 1, lemmas: ['word'] }))
  return ev('clip_played', { subs_report: k > 0 ? 'partial' : '', ...(k > 0 ? { subs_heard, subs_unheard: [] } : {}), played_frac: 0.5, ...extra })
}
