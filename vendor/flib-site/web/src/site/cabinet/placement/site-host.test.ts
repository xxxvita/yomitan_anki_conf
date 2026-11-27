// Хост сайта: сессия в localStorage по owner, ОДИН PUT на финиш, откат накопленного при сбое, замок вкладки,
// чужой прогон не трогается, dispose, квота localStorage, смена ключа, 401 при финише.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { openSiteHost, hasLiveSession, lsKeyOf, PlacementHostError, type SiteHost } from './site-host'
import { fakeServer, json, type FakeServer } from './__fixtures__/fake-server'
import { fakeLocks } from './__fixtures__/fake-locks'
import { finishRun, loadOverview, openSession, recordAnswer, startRun, answerReplace, type RunOutcome } from './store'

const RUN_A = 'pt-aaaa-0000000000000001'
const RUN_B = 'pt-bbbb-0000000000000002'
const T0 = Date.parse('2026-11-25T10:00:00Z')
const outcome = (flags: string[] = [], level: RunOutcome['level'] = 'A2'): RunOutcome => ({
  level, vocab_size: 2100, ci90: [1800, 2400], listening_offset: 0, flags, words: [{ lemma: 'dog', p: 0.9, rank: 5, cefrj: 1 }],
})
const ans = (id: string) => ({ id, kind: 'aural_yesno' as const, lemma: 'dog', r: { yes: true } })

let server: FakeServer
const opened: SiteHost[] = []
beforeEach(() => { localStorage.clear(); server = fakeServer() })
// Замки вкладки живут в модуле на всю страницу: хосты теста освобождаются после каждого теста.
afterEach(async () => { for (const h of opened.splice(0)) h.dispose(); await new Promise((r) => setTimeout(r, 0)) })

const open = async (extra: Partial<Parameters<typeof openSiteHost>[0]> = {}) => {
  const h = await openSiteHost({ apiDeps: { fetch: server.fetch }, storage: localStorage, locks: fakeLocks(), ...extra })
  opened.push(h)
  return h
}
const puts = () => server.callsTo('PUT', '/api/me/placement')

describe('открытие', () => {
  it('одно чтение файла; owner — из ответа; get отсутствующего — undefined, не null', async () => {
    const h = await open()
    expect(server.callsTo('GET', '/api/me/placement')).toHaveLength(1)
    expect(h.owner).toBe(server.owner)
    expect(await h.storage.get('pt.session')).toBeUndefined()
    expect(await h.storage.get('pt.history')).toBeUndefined()
    expect(await h.docs.get({ collection: 'pt_results', id: 'last' })).toBeUndefined()
    expect(h.meta()).toEqual({ appliedRunId: null, declinedRunId: null, lastRunId: null })
    expect(puts()).toHaveLength(0)
  })

  it('сессия лежит в localStorage под flib:placement:v1:<owner>:pt.session и не уходит на сервер', async () => {
    const h = await open()
    const s = await startRun(h, { prior: 'school', bankVersion: 'v', runId: RUN_A, now: () => T0 })
    expect(JSON.parse(localStorage.getItem(`flib:placement:v1:${server.owner}:pt.session`)!).run_id).toBe(RUN_A)
    await recordAnswer(h, s, ans('it_1'), { now: () => T0 + 1000 })
    expect(puts()).toHaveLength(0)
    expect(hasLiveSession(server.owner, localStorage, T0 + 2000)).toBe(true)
    expect(hasLiveSession(server.owner, localStorage, T0 + 25 * 3600_000)).toBe(false)
    expect(hasLiveSession('other', localStorage, T0)).toBe(false)
  })
})

describe('финиш — один PUT', () => {
  it('документы и история уходят ОДНИМ PUT; сессия удалена', async () => {
    const h = await open()
    const s = await startRun(h, { prior: 'school', bankVersion: 'v', runId: RUN_A, now: () => T0 })
    await finishRun(h, s, outcome(), { now: () => T0 + 1000 })
    expect(puts()).toHaveLength(1)
    const set = (puts()[0].body as { set: Record<string, unknown> }).set
    expect(Object.keys(set).sort()).toEqual(['docs:pt_results/last', 'kv:pt.history'])
    expect(server.doc<{ run_id: string }>('docs:pt_results/last')!.run_id).toBe(RUN_A)
    expect(localStorage.getItem(lsKeyOf(server.owner, 'pt.session'))).toBeNull()
    expect(h.meta().lastRunId).toBe(RUN_A)
  })

  it('ответ R16 «Да, заменить» — тоже один PUT (last + удаление pending + история)', async () => {
    const h = await open()
    const a = await startRun(h, { prior: 'school', bankVersion: 'v', runId: RUN_A, now: () => T0 })
    await finishRun(h, a, outcome(), { now: () => T0 + 1000 })
    const b = await startRun(h, { prior: 'school', bankVersion: 'v', runId: RUN_B, now: () => T0 + 5000 })
    const { asked } = await finishRun(h, b, outcome(['no_audio', 'floor'], 'A1'), { now: () => T0 + 6000 })
    expect(asked).toBe(true)
    expect(puts()).toHaveLength(2)
    expect(server.doc('docs:pt_pending/' + RUN_B)).toBeTruthy()
    await answerReplace(h, RUN_B, true)
    expect(puts()).toHaveLength(3)
    const set = (puts()[2].body as { set: Record<string, unknown> }).set
    expect(set['docs:pt_pending/' + RUN_B]).toBeNull()
    expect((set['docs:pt_results/last'] as { run_id: string }).run_id).toBe(RUN_B)
  })

  it('сбой PUT: накопленное отброшено, следующая попытка перечитывает файл и заканчивает ровно один раз', async () => {
    const h = await open()
    const s = await startRun(h, { prior: 'school', bankVersion: 'v', runId: RUN_A, now: () => T0 })
    server.once('PUT', '/api/me/placement', json(503, { error: 'x' }))
    await expect(finishRun(h, s, outcome(), { now: () => T0 + 1000 })).rejects.toMatchObject({ code: 'network' })
    expect(server.doc('docs:pt_results/last')).toBeUndefined()
    // сессия осталась с finishing: прогон не потерян
    expect(JSON.parse(localStorage.getItem(lsKeyOf(server.owner, 'pt.session'))!).finishing).toBeTruthy()
    const getsBefore = server.callsTo('GET', '/api/me/placement').length
    await finishRun(h, s, outcome(), { now: () => T0 + 2000 })
    expect(server.callsTo('GET', '/api/me/placement').length).toBe(getsBefore + 1)
    expect(puts()).toHaveLength(2)
    expect(server.doc<Array<{ run_id: string }>>('kv:pt.history')!.filter((r) => r.run_id === RUN_A)).toHaveLength(1)
    expect(server.doc<{ taken_at: string }>('docs:pt_results/last')!.taken_at).toBe(new Date(T0 + 1000).toISOString())
  })

  it('PUT дошёл, ответ потерян: повтор видит уже записанный результат и не дублирует строку', async () => {
    const h = await open()
    const s = await startRun(h, { prior: 'school', bankVersion: 'v', runId: RUN_A, now: () => T0 })
    server.once('PUT', '/api/me/placement', async () => {
      const body = server.calls.at(-1)!.body
      await server.fetch('/api/me/placement', { method: 'PUT', body: JSON.stringify(body) }) // сервер записал…
      throw new TypeError('lost') // …а ответ потерялся
    })
    await expect(finishRun(h, s, outcome(), { now: () => T0 + 1000 })).rejects.toBeInstanceOf(PlacementHostError)
    expect(server.doc('docs:pt_results/last')).toBeTruthy()
    await finishRun(h, s, outcome(), { now: () => T0 + 2000 })
    expect(server.doc<Array<{ run_id: string }>>('kv:pt.history')!.filter((r) => r.run_id === RUN_A)).toHaveLength(1)
  })

  it('PUT 409 stale → ошибка stale; следующая операция перечитывает файл', async () => {
    const h = await open()
    const s = await startRun(h, { prior: 'school', bankVersion: 'v', runId: RUN_A, now: () => T0 })
    server.rev = 7 // другое устройство записало
    await expect(finishRun(h, s, outcome(), { now: () => T0 + 1000 })).rejects.toMatchObject({ code: 'stale' })
    await finishRun(h, s, outcome(), { now: () => T0 + 2000 })
    expect(server.doc('docs:pt_results/last')).toBeTruthy()
  })

  it('401 при финише → unauthorized; новая страница довершает финиш с тем же taken_at', async () => {
    const h = await open()
    const s = await startRun(h, { prior: 'school', bankVersion: 'v', runId: RUN_A, now: () => T0 })
    server.once('PUT', '/api/me/placement', json(401, { error: 'unauthorized' }))
    await expect(finishRun(h, s, outcome(), { now: () => T0 + 1000 })).rejects.toMatchObject({ code: 'unauthorized' })
    h.dispose()
    const h2 = await open()
    const r = await openSession(h2, { bankVersion: 'other', now: () => T0 + 99_000_000 })
    expect(r.kind).toBe('finished')
    const ov = await loadOverview(h2)
    expect(ov.history).toHaveLength(1)
    expect(ov.history[0].taken_at).toBe(new Date(T0 + 1000).toISOString())
    expect(ov.lastRunId).toBe(RUN_A)
  })

  it('смена ключа: PUT 409 key_changed → ошибка key_changed; на сервер ничего не записано', async () => {
    const h = await open()
    const s = await startRun(h, { prior: 'school', bankVersion: 'v', runId: RUN_A, now: () => T0 })
    server.owner = 'ffffffffffffffff'
    await expect(finishRun(h, s, outcome(), { now: () => T0 + 1000 })).rejects.toMatchObject({ code: 'key_changed' })
    expect(Object.keys(server.items)).toEqual([])
    // следующая операция тоже упирается в смену владельца: перечитанный файл — чужой
    await expect(loadOverview(h)).rejects.toMatchObject({ code: 'key_changed' })
  })
})

describe('одна вкладка', () => {
  it('замок занят — tab_busy, на сервер ничего не пишется', async () => {
    const locks = fakeLocks()
    const h1 = await open({ locks })
    await expect(open({ locks })).rejects.toMatchObject({ code: 'tab_busy' })
    expect(puts()).toHaveLength(0)
    h1.dispose()
    await Promise.resolve()
    await Promise.resolve()
    const h3 = await open({ locks })
    expect(h3.owner).toBe(server.owner)
  })

  it('замок держит другая вкладка (LockManager отдаёт null) — tab_busy, пишущих запросов нет', async () => {
    const locks = fakeLocks()
    locks.held.add(`flib-placement:${server.owner}`)
    await expect(open({ locks })).rejects.toMatchObject({ code: 'tab_busy' })
    expect(puts()).toHaveLength(0)
    expect(locks.log).toContain(`busy flib-placement:${server.owner}`)
  })

  it('StrictMode: отменённое открытие не оставляет замок и не принимается за «другую вкладку»', async () => {
    const locks = fakeLocks()
    const c1 = new AbortController()
    const p1 = open({ locks, signal: c1.signal })
    c1.abort()
    const c2 = new AbortController()
    const p2 = open({ locks, signal: c2.signal })
    await expect(p1).rejects.toMatchObject({ code: 'aborted' })
    const h2 = await p2
    expect(h2.owner).toBe(server.owner)
    expect(locks.held.size).toBe(1)
    h2.dispose()
    await new Promise((r) => setTimeout(r, 0))
    expect(locks.held.size).toBe(0)
  })

  it('StrictMode: первое открытие успело взять замок и сразу освобождено — второе его получает', async () => {
    const locks = fakeLocks()
    const c1 = new AbortController()
    const h1 = await open({ locks, signal: c1.signal })
    c1.abort() // cleanup эффекта
    h1.dispose()
    const h2 = await open({ locks })
    expect(h2.owner).toBe(server.owner)
  })

  it('открытие отменено между запросом замка и его выдачей: поздняя выдача сразу отпускается', async () => {
    const locks = fakeLocks({ defer: true })
    const c = new AbortController()
    const p = open({ locks, signal: c.signal })
    const settled = p.catch((e) => e)
    await new Promise((r) => setTimeout(r, 5)) // чтение файла прошло, замок запрошен, выдачи ещё нет
    c.abort()
    locks.grant()
    expect(await settled).toMatchObject({ code: 'aborted' })
    await new Promise((r) => setTimeout(r, 5))
    expect(locks.held.size).toBe(0)
    expect(locks.log).toContain(`release flib-placement:${server.owner}`)
  })

  it('нет Web Locks — без замка', async () => {
    const h = await open({ locks: null })
    expect(h.owner).toBe(server.owner)
  })
})

describe('чужой прогон и dispose', () => {
  it('чужой run_id в localStorage не перезаписывается и не удаляется', async () => {
    const h = await open()
    const s = await startRun(h, { prior: 'school', bankVersion: 'v', runId: RUN_A, now: () => T0 })
    const foreign = { ...s, run_id: RUN_B, seed: '5' }
    localStorage.setItem(lsKeyOf(server.owner, 'pt.session'), JSON.stringify(foreign))
    await expect(recordAnswer(h, s, ans('it_1'), { now: () => T0 + 1 })).rejects.toMatchObject({ code: 'foreign_session' })
    expect(await h.storage.delete('pt.session')).toEqual({ removed: 0 })
    expect(JSON.parse(localStorage.getItem(lsKeyOf(server.owner, 'pt.session'))!).run_id).toBe(RUN_B)
  })

  it('прогон, который страница сама прочитала при открытии, — свой: его можно продолжить и удалить', async () => {
    const h0 = await open()
    await startRun(h0, { prior: 'school', bankVersion: 'v', runId: RUN_A, now: () => T0 })
    h0.dispose()
    const h = await open()
    const r = await openSession(h, { bankVersion: 'v', now: () => T0 + 1000 })
    expect(r.kind).toBe('resume')
    if (r.kind !== 'resume') return
    await recordAnswer(h, r.session, ans('it_1'), { now: () => T0 + 2000 })
    expect((await h.storage.delete('pt.session')).removed).toBe(1)
  })

  it('dispose: любая запись — ошибка, localStorage и сервер не трогаются', async () => {
    const h = await open()
    const s = await startRun(h, { prior: 'school', bankVersion: 'v', runId: RUN_A, now: () => T0 })
    const before = localStorage.getItem(lsKeyOf(server.owner, 'pt.session'))
    h.dispose()
    await expect(recordAnswer(h, s, ans('it_1'), { now: () => T0 + 1 })).rejects.toMatchObject({ code: 'disposed' })
    await expect(h.storage.set('pt.history', [])).rejects.toMatchObject({ code: 'disposed' })
    await expect(h.docs.put({ collection: 'pt_results', id: 'last', body: {} })).rejects.toMatchObject({ code: 'disposed' })
    expect(localStorage.getItem(lsKeyOf(server.owner, 'pt.session'))).toBe(before)
    expect(puts()).toHaveLength(0)
  })

  it('квота localStorage: прогон продолжается в памяти страницы', async () => {
    const quota: Storage = {
      get length() { return 0 }, clear() {}, key: () => null, getItem: () => null, removeItem() {},
      setItem() { throw new DOMException('full', 'QuotaExceededError') },
    }
    const h = await open({ storage: quota })
    const s = await startRun(h, { prior: 'school', bankVersion: 'v', runId: RUN_A, now: () => T0 })
    await recordAnswer(h, s, ans('it_1'), { now: () => T0 + 1 })
    const got = await h.storage.get<{ answers: unknown[] }>('pt.session')
    expect(got!.answers).toHaveLength(1)
    await finishRun(h, s, outcome(), { now: () => T0 + 2 })
    expect(await h.storage.get('pt.session')).toBeUndefined()
    expect(server.doc('docs:pt_results/last')).toBeTruthy()
  })
})

describe('сервер как источник', () => {
  it('открывает уже записанный результат и метки применения', async () => {
    server.applied = RUN_A
    server.items['docs:pt_results/last'] = { run_id: RUN_A, level: 'A1', flags: [], taken_at: new Date(T0).toISOString(), words: [], bank_version: 'v' }
    const h: SiteHost = await open()
    expect(h.meta()).toEqual({ appliedRunId: RUN_A, declinedRunId: null, lastRunId: RUN_A })
    h.markApplied(RUN_B)
    expect(h.meta().appliedRunId).toBe(RUN_B)
  })
})
