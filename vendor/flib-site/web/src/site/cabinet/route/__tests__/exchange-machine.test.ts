// exchange-machine.test.ts — машина обмена (спека §4.6, §4.3, план B7): каждый
// итог и каждый отказ, выгрузка с отказом не блокирует обмен, повтор
// `done`/`committed:false` сам не запускается, автоповтор — по КОДУ, а не по
// статусу, зависание в любом незавершённом статусе.
import { describe, it, expect } from 'vitest'
import {
  isStuckExchange, pollJob, runExchange, POLL_FAST_MS, POLL_SLOW_MS,
  type ExchangeDeps, type ExchangeRequest,
} from '../exchange-machine'
import type { ApiError, ApiResult, RouteJob, RouteState } from '../route-api'
import { classifyError } from '../route-api'
import type { FlushResult } from '../outbox'

function err(status: number, code: string | null, retryAfterSec: number | null = null, body: Record<string, unknown> | null = null): ApiError {
  return { ok: false, status, code, retryAfterSec, cls: classifyError(status, code), body: body ?? (code ? { error: code } : null) }
}
function ok<T>(data: T): ApiResult<T> { return { ok: true, status: 200, data } }

function state(over: Partial<RouteState> = {}): RouteState {
  return {
    started: true, route_id: 'r1', revision: 5, snapshot_date: '2026-11-18', started_at: null, goal_label: 'g',
    params: { daily_listening_budget_min: 20, daily_new_words: 15 }, day: null, next_clip: null,
    current_puzzle_id: null, replace_available: true, stop_reason: null, active_exchange: null, ...over,
  }
}
function job(over: Partial<RouteJob>): RouteJob {
  return { status: 'done', committed: true, committed_revision: 6, cancel_reason: null, error_code: null, ...over }
}

interface Harness {
  deps: ExchangeDeps
  t: () => number
  calls: { exchange: unknown[]; job: number[]; readState: number; flush: number; flushTimeouts: number[]; committed: number; broadcast: number[]; sleeps: number[] }
}

function harness(o: {
  flush?: () => Promise<FlushResult>
  exchange?: Array<ApiResult<{ job_id: string; base_revision: number }>>
  job?: (n: number, t: number) => ApiResult<RouteJob>
  states?: Array<ApiResult<RouteState>>
} = {}): Harness {
  let now = 1_000_000
  const calls: Harness['calls'] = { exchange: [], job: [], readState: 0, flush: 0, flushTimeouts: [], committed: 0, broadcast: [], sleeps: [] }
  const exchanges = o.exchange ?? [ok({ job_id: 'j1', base_revision: 5 })]
  const states = o.states ?? [ok(state({ revision: 6 }))]
  const deps: ExchangeDeps = {
    api: {
      exchange: async b => { calls.exchange.push(b); return exchanges[Math.min(calls.exchange.length - 1, exchanges.length - 1)] },
      job: async () => { calls.job.push(now); return (o.job ?? (() => ok(job({}))))(calls.job.length, now) },
    },
    readState: async () => { calls.readState++; return states[Math.min(calls.readState - 1, states.length - 1)] },
    outbox: {
      flush: async (f) => { calls.flush++; calls.flushTimeouts.push(f.timeoutMs); return o.flush ? o.flush() : 'sent' },
      onExchangeCommitted: () => { calls.committed++ },
    },
    now: () => now,
    sleep: async ms => { calls.sleeps.push(ms); now += Math.max(0, ms) },
    broadcast: r => { calls.broadcast.push(r) },
    forDate: () => '2026-11-18',
  }
  return { deps, t: () => now, calls }
}

const NEXT: ExchangeRequest = { want: 'next', expectedRevision: 5, snapshotDate: '2026-11-18' }

describe('выгрузка перед обменом', () => {
  for (const r of ['refused', 'timeout', 'empty', 'sent'] as FlushResult[]) {
    it(`flush = ${r} — обмен всё равно уходит`, async () => {
      const h = harness({ flush: async () => r })
      const out = await runExchange(NEXT, h.deps)
      expect(h.calls.flush).toBe(1)
      expect(h.calls.exchange.length).toBe(1)
      expect(out.type).toBe('committed')
    })
  }
  it('flush упал исключением — обмен всё равно уходит', async () => {
    const h = harness({ flush: async () => { throw new Error('x') } })
    await runExchange(NEXT, h.deps)
    expect(h.calls.exchange.length).toBe(1)
  })
})

describe('потолок выгрузки и отказ при опросе', () => {
  it('выгрузка перед обменом — с потолком ровно 5 с', async () => {
    const h = harness()
    await runExchange(NEXT, h.deps)
    expect(h.calls.flushTimeouts).toEqual([5000])
  })
  it('502 gateway_refused при опросе — отказ, опрос прекращён', async () => {
    const h = harness({ job: () => err(502, 'gateway_refused') as ApiResult<RouteJob> })
    expect(await runExchange(NEXT, h.deps)).toEqual({ type: 'refused' })
    expect(h.calls.job.length).toBe(1)
  })
})

describe('опрос и итоги (§4.6 п.3–4)', () => {
  it('2 с первые 30 с, затем 5 с; коммит — очередь, канал, перечитанное состояние', async () => {
    const h = harness({ job: (n) => n < 25 ? ok(job({ status: 'processing', committed: false })) : ok(job({ committed_revision: 6 })) })
    const out = await runExchange(NEXT, h.deps)
    const pollSleeps = h.calls.sleeps
    expect(pollSleeps.slice(0, 15).every(s => s === POLL_FAST_MS)).toBe(true)
    expect(pollSleeps.slice(16).every(s => s === POLL_SLOW_MS)).toBe(true)
    expect(out).toMatchObject({ type: 'committed', revision: 6 })
    expect(h.calls.committed).toBe(1)
    expect(h.calls.broadcast).toEqual([6])
    expect(h.calls.readState).toBe(1)
    expect(h.calls.exchange[0]).toEqual({ expected_revision: 5, want: 'next', for_date: '2026-11-18' })
  })

  it('429 busy при опросе — пропуск тика', async () => {
    let n = 0
    const h = harness({ job: () => (++n === 1 ? err(429, 'busy', 1) : ok(job({}))) as ApiResult<RouteJob> })
    expect((await runExchange(NEXT, h.deps)).type).toBe('committed')
    expect(h.calls.job.length).toBe(2)
  })

  it('404 job_not_found — прекратить и перечитать', async () => {
    const h = harness({ job: () => err(404, 'job_not_found') as ApiResult<RouteJob> })
    expect(await runExchange(NEXT, h.deps)).toEqual({ type: 'reread', code: 'job_not_found' })
    expect(h.calls.readState).toBe(1)
    expect(h.calls.job.length).toBe(1)
  })

  it('опрос не дольше 10 мин', async () => {
    const h = harness({ job: () => ok(job({ status: 'waiting', committed: false })) })
    expect((await runExchange(NEXT, h.deps)).type).toBe('timeout')
    expect(h.t() - 1_000_000).toBeLessThanOrEqual(10 * 60_000 + POLL_SLOW_MS * 2)
  })

  it('done + committed:false, ревизия та же — «не удалось подобрать», без автоповтора', async () => {
    const h = harness({ job: () => ok(job({ committed: false, committed_revision: null, error_code: 'daemon_error' })), states: [ok(state({ revision: 5 }))] })
    expect(await runExchange(NEXT, h.deps)).toEqual({ type: 'no_clip', code: 'daemon_error' })
    expect(h.calls.exchange.length).toBe(1)
  })

  it('done + committed:false, ревизия выросла — продолжить от новой', async () => {
    const h = harness({ job: () => ok(job({ committed: false, committed_revision: null })), states: [ok(state({ revision: 7 }))] })
    expect((await runExchange(NEXT, h.deps)).type).toBe('advanced')
    expect(h.calls.exchange.length).toBe(1)
  })

  it('failed commit_failed — «мы уже знаем»; прочий failed — «Повторить»', async () => {
    let h = harness({ job: () => ok(job({ status: 'failed', committed: false, error_code: 'commit_failed' })) })
    expect(await runExchange(NEXT, h.deps)).toEqual({ type: 'unavailable' })
    h = harness({ job: () => ok(job({ status: 'failed', committed: false, error_code: 'max_attempts_exceeded' })) })
    expect(await runExchange(NEXT, h.deps)).toEqual({ type: 'retry_offer', code: 'max_attempts_exceeded' })
    expect(h.calls.exchange.length).toBe(1)
  })

  it('cancelled reset — перечитать эпоху; иной cancelled — «Повторить»', async () => {
    let h = harness({ job: () => ok(job({ status: 'cancelled', committed: false, cancel_reason: 'reset' })) })
    expect(await runExchange(NEXT, h.deps)).toEqual({ type: 'reset' })
    h = harness({ job: () => ok(job({ status: 'cancelled', committed: false, cancel_reason: 'client' })) })
    expect((await runExchange(NEXT, h.deps)).type).toBe('retry_offer')
  })
})

describe('отказы создания (§4.6 п.5)', () => {
  it('409 stale_revision — перечитать', async () => {
    const h = harness({ exchange: [err(409, 'stale_revision', null, { error: 'stale_revision', revision: 9 }) as never] })
    expect(await runExchange(NEXT, h.deps)).toEqual({ type: 'reread', code: 'stale_revision' })
    expect(h.calls.readState).toBe(1)
  })

  it('409 exchange_in_progress — опрашивать присланный job_id', async () => {
    const h = harness({ exchange: [err(409, 'exchange_in_progress', null, { error: 'exchange_in_progress', job_id: 'other' }) as never] })
    expect((await runExchange(NEXT, h.deps)).type).toBe('committed')
    expect(h.calls.job.length).toBe(1)
  })

  it('409 route_not_started — «Маршрута нет»', async () => {
    const h = harness({ exchange: [err(409, 'route_not_started') as never] })
    expect(await runExchange(NEXT, h.deps)).toEqual({ type: 'no_route' })
  })

  it('409 replace_unavailable — строка «Замена сейчас недоступна», состояние перечитано, обмена нет', async () => {
    const h = harness({ exchange: [err(409, 'replace_unavailable') as never], states: [ok(state({ replace_available: false }))] })
    const out = await runExchange({ ...NEXT, want: 'replace', replacePuzzleId: 'youtube::abcdefghijk' }, h.deps)
    expect(out).toEqual({ type: 'replace_unavailable' })
    expect(h.calls.readState).toBe(1)
    expect(h.calls.exchange.length).toBe(1)
    expect(h.calls.job.length).toBe(0)
  })

  it('400 snapshot_required у замены', async () => {
    const h = harness({ exchange: [err(400, 'snapshot_required') as never] })
    expect(await runExchange({ ...NEXT, want: 'replace', replacePuzzleId: 'p' }, h.deps)).toEqual({ type: 'snapshot_required' })
  })

  it('замена несёт replace_puzzle_id и replace_reason только при want:"replace"', async () => {
    let h = harness()
    await runExchange({ ...NEXT, want: 'replace', replacePuzzleId: 'youtube::AAAAAAAAAAA', replaceReason: 'content' }, h.deps)
    expect(h.calls.exchange[0]).toEqual({ expected_revision: 5, want: 'replace', for_date: '2026-11-18', replace_puzzle_id: 'youtube::AAAAAAAAAAA', replace_reason: 'content' })
    h = harness()
    await runExchange({ ...NEXT, replacePuzzleId: 'x', replaceReason: 'content' }, h.deps)
    expect(h.calls.exchange[0]).toEqual({ expected_revision: 5, want: 'next', for_date: '2026-11-18' })
  })

  it('502 gateway_refused — ни одного повтора за 60 с', async () => {
    const h = harness({ exchange: [err(502, 'gateway_refused') as never] })
    expect(await runExchange(NEXT, h.deps)).toEqual({ type: 'refused' })
    expect(h.calls.exchange.length).toBe(1)
    expect(h.t() - 1_000_000).toBeLessThan(60_000)
  })

  it('502 с разобранным, но незнакомым кодом — отказ без повтора', async () => {
    const h = harness({ exchange: [err(502, 'something_new') as never] })
    expect(await runExchange(NEXT, h.deps)).toEqual({ type: 'refused' })
    expect(h.calls.exchange.length).toBe(1)
  })

  it('502 text/html (без JSON-кода) — повтор через 5 с после перечитывания', async () => {
    const h = harness({ exchange: [err(502, null) as never, ok({ job_id: 'j2', base_revision: 5 })], states: [ok(state({ revision: 5 })), ok(state({ revision: 6 }))] })
    expect((await runExchange(NEXT, h.deps)).type).toBe('committed')
    expect(h.calls.exchange.length).toBe(2)
    expect(h.calls.sleeps[0]).toBe(5000)
  })

  it('502 gateway_unavailable и 503 <код> — повтор по Retry-After', async () => {
    for (const e of [err(502, 'gateway_unavailable', 7), err(503, 'daemon_unavailable', 7), err(429, 'rate_limited', 7), err(429, 'route_banned', 7)]) {
      const h = harness({ exchange: [e as never, ok({ job_id: 'j2', base_revision: 5 })], states: [ok(state({ revision: 5 })), ok(state({ revision: 6 }))] })
      const phases: string[] = []
      h.deps.onPhase = p => phases.push(p.kind)
      expect((await runExchange(NEXT, h.deps)).type).toBe('committed')
      expect(h.calls.sleeps[0]).toBe(7000)
      expect(phases).toContain('cooldown')
      expect(h.calls.exchange.length).toBe(2)
    }
  })

  it('503 route_timeout — сначала перечитать: обмен уже идёт — опрашивать его, второго не создавать', async () => {
    const active = { job_id: 'jX', status: 'waiting', created_at: new Date(1_000_000).toISOString() }
    const h = harness({ exchange: [err(503, 'route_timeout', 5) as never], states: [ok(state({ revision: 5, active_exchange: active })), ok(state({ revision: 6 }))] })
    expect((await runExchange(NEXT, h.deps)).type).toBe('committed')
    expect(h.calls.exchange.length).toBe(1)
    expect(h.calls.job.length).toBeGreaterThan(0)
  })

  it('401 / 403 — сессия', async () => {
    const h = harness({ exchange: [err(403, 'key_expired') as never] })
    expect(await runExchange(NEXT, h.deps)).toEqual({ type: 'session', status: 403, code: 'key_expired' })
  })
})

describe('зависший обмен (§4.6 п.6)', () => {
  const now = Date.parse('2026-11-18T12:00:00Z')
  for (const status of ['waiting', 'claimed', 'processing']) {
    it(`${status} старше 10 мин — «Подобрать заново»`, () => {
      expect(isStuckExchange({ job_id: 'j', status, created_at: '2026-11-18T11:49:00Z' }, now)).toBe(true)
      expect(isStuckExchange({ job_id: 'j', status, created_at: '2026-11-18T11:51:00Z' }, now)).toBe(false)
    })
  }
  it('конечный статус не зависает', () => {
    expect(isStuckExchange({ job_id: 'j', status: 'done', created_at: '2026-11-18T10:00:00Z' }, now)).toBe(false)
    expect(isStuckExchange(null, now)).toBe(false)
  })
  it('возобновлённый опрос активного обмена', async () => {
    const h = harness()
    expect((await pollJob('jA', 5, h.deps)).type).toBe('committed')
  })
})

// Экран «Подбираем ролики» (дизайн 2026-11-19 §3b) показывает шаг по статусу
// задания: фаза опроса несёт статус каждого удачного ответа.
describe('фаза опроса несёт статус задания', () => {
  it('waiting → processing → done: onPhase получает каждый статус по порядку', async () => {
    const seq = ['waiting', 'processing', 'done']
    const h = harness({ job: n => ok(job(seq[n - 1] === 'done' ? {} : { status: seq[n - 1], committed: false, committed_revision: null })) })
    const phases: Array<string | undefined> = []
    h.deps.onPhase = p => { if (p.kind === 'polling') phases.push(p.status) }
    const out = await pollJob('j1', 5, h.deps)
    expect(out.type).toBe('committed')
    expect(phases).toEqual([undefined, 'waiting', 'processing', 'done'])
  })
})
