// applyPlacement: тело запроса, пропуск применённого/отклонённого, force, floor → пустой список, 429 по
// Retry-After до трёх попыток, stale_run и сбои.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { applyPlacement } from './apply'
import { openSiteHost, type SiteHost } from './site-host'
import { fakeServer, json, type FakeServer } from './__fixtures__/fake-server'
import { fakeLocks } from './__fixtures__/fake-locks'
import { finishRun, startRun, type RunOutcome } from './store'

const RUN = 'pt-aaaa-0000000000000001'
const T0 = Date.parse('2026-11-25T10:00:00Z')
const outcome = (flags: string[] = []): RunOutcome => ({
  level: 'A2', vocab_size: 2100, ci90: [1800, 2400], listening_offset: 0, flags,
  words: [{ lemma: 'dog', p: 0.9, rank: 5, cefrj: 1 }, { lemma: 'owl', p: 0.7, rank: 900, cefrj: 2, s3: 1 }],
})
const P = '/api/me/placement/apply'

let server: FakeServer
let host: SiteHost
beforeEach(async () => {
  localStorage.clear()
  server = fakeServer()
  host = await openSiteHost({ apiDeps: { fetch: server.fetch }, storage: localStorage, locks: fakeLocks() })
})
afterEach(async () => { host.dispose(); await new Promise((r) => setTimeout(r, 0)) })

async function finish(flags: string[] = []) {
  const s = await startRun(host, { prior: 'school', bankVersion: 'v', runId: RUN, now: () => T0 })
  await finishRun(host, s, outcome(flags), { now: () => T0 + 1000 })
}
const run = (o: Parameters<typeof applyPlacement>[1] = {}) => applyPlacement(host, { apiDeps: { fetch: server.fetch }, sleep: async () => {}, ...o })

describe('applyPlacement', () => {
  it('нет pt_results/last → nothing, запроса нет', async () => {
    expect(await run()).toEqual({ kind: 'nothing' })
    expect(server.callsTo('POST', P)).toHaveLength(0)
  })

  it('точное тело: owner, run_id, слова {lemma, confidence} из снимка; затем applied → повтор ничего не шлёт', async () => {
    await finish()
    expect(await run()).toEqual({ kind: 'done', counted: 2 })
    expect(server.callsTo('POST', P)[0].body).toEqual({
      owner: server.owner, run_id: RUN, words: [{ lemma: 'dog', confidence: 90 }, { lemma: 'owl', confidence: 70 }],
    })
    expect(host.meta().appliedRunId).toBe(RUN)
    expect(await run()).toEqual({ kind: 'nothing' })
    expect(server.callsTo('POST', P)).toHaveLength(1)
  })

  it('floor-прогон — пустой список слов', async () => {
    await finish(['floor'])
    expect(await run()).toEqual({ kind: 'done', counted: 0 })
    expect((server.callsTo('POST', P)[0].body as { words: unknown[] }).words).toEqual([])
  })

  it('declined: без force — declined и запроса нет; force — применяет', async () => {
    server.declined = RUN
    host.dispose()
    await new Promise((r) => setTimeout(r, 0))
    host = await openSiteHost({ apiDeps: { fetch: server.fetch }, storage: localStorage, locks: fakeLocks() })
    await finish()
    expect(await run()).toEqual({ kind: 'declined' })
    expect(server.callsTo('POST', P)).toHaveLength(0)
    expect(await run({ force: true })).toEqual({ kind: 'done', counted: 2 })
  })

  it('429 → пауза по Retry-After и повтор; три 429 подряд → failed', async () => {
    await finish()
    const sleep = vi.fn(async () => {})
    server.once('POST', P, json(429, { error: 'busy' }, { 'Retry-After': '2' }))
    expect(await run({ sleep })).toEqual({ kind: 'done', counted: 2 })
    expect(sleep).toHaveBeenCalledWith(2000)
    expect(server.callsTo('POST', P)).toHaveLength(2)

    const r429 = () => json(429, { error: 'rate_limited' }, { 'Retry-After': '1' })
    server.applied = null
    server.once('POST', P, r429, r429, r429)
    host.markApplied('') // забыть метку
    const n0 = server.callsTo('POST', P).length
    expect(await run({ sleep })).toEqual({ kind: 'failed' })
    expect(server.callsTo('POST', P).length - n0).toBe(3)
  })

  it('409 stale_run → nothing (метка не ставится); 500 и сеть → failed', async () => {
    await finish()
    server.once('POST', P, json(409, { error: 'stale_run' }))
    expect(await run()).toEqual({ kind: 'nothing' })
    expect(host.meta().appliedRunId).toBeNull()
    server.once('POST', P, json(500, { error: 'storage_error' }))
    expect(await run()).toEqual({ kind: 'failed' })
    server.once('POST', P, () => { throw new TypeError('down') })
    expect(await run()).toEqual({ kind: 'failed' })
    expect(await run()).toEqual({ kind: 'done', counted: 2 })
  })
  it('key_changed от сервера → отдельный исход (страница откроет тест заново), метка не ставится', async () => {
    await finish()
    server.once('POST', P, json(409, { error: 'key_changed' }))
    expect(await run()).toEqual({ kind: 'key_changed' })
    expect(host.meta().appliedRunId).toBeNull()
  })

  it('мусорное тело успеха → failed и метка «применено» не ставится', async () => {
    await finish()
    for (const body of [{}, { counted: 'many' }, { counted: -1 }, null]) {
      server.once('POST', P, json(200, body))
      expect(await run()).toEqual({ kind: 'failed' })
      expect(host.meta().appliedRunId).toBeNull()
    }
  })

  it('уход со страницы: пауза 429 прерывается и новых запросов нет', async () => {
    await finish()
    const ctl = new AbortController()
    server.once('POST', P, json(429, { error: 'busy' }, { 'Retry-After': '30' }))
    const p = applyPlacement(host, { apiDeps: { fetch: server.fetch }, signal: ctl.signal })
    await new Promise((r) => setTimeout(r, 5))
    ctl.abort()
    expect(await p).toEqual({ kind: 'failed' })
    expect(server.callsTo('POST', P)).toHaveLength(1)
  })
})
