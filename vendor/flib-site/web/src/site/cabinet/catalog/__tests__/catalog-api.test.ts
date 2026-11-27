// catalog-api: запросы, молчаливый повтор 429, адаптер проверки переноса pointA.
import { describe, it, expect, vi } from 'vitest'
import { checkTitles, listQuery, listTitles, titleDetail, titlesBySlugs } from '../catalog-api'
import type { ApiDeps } from '../../route/route-api'

const res = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
const deps = (...rs: Array<Response | (() => Response)>): { d: ApiDeps; urls: string[] } => {
  const urls: string[] = []
  let i = 0
  const d: ApiDeps = { fetch: vi.fn(async (u: string) => { urls.push(u); const r = rs[Math.min(i++, rs.length - 1)]; return typeof r === 'function' ? r() : r.clone() }) }
  return { d, urls }
}
const noSleep = vi.fn(async () => {})

describe('запросы', () => {
  it('listTitles: параметры в query, пустые пропускаются', async () => {
    const { d, urls } = deps(res(200, { snapshot: 'a', total: 1, pace: { slow_below: 1, fast_from: 2 }, items: [] }))
    const r = await listTitles({ sort: 'popular', limit: 11, q: '', offset: 0 }, { deps: d })
    expect(r.ok).toBe(true)
    expect(urls[0]).toBe('/api/me/catalog/titles?sort=popular&limit=11&offset=0')
    expect(listQuery({})).toBe('')
  })
  it('titlesBySlugs: один запрос ?slugs=a,b', async () => {
    const { d, urls } = deps(res(200, { snapshot: 'a', items: [] }))
    await titlesBySlugs(['a', 'b-c'], { deps: d })
    expect(urls).toEqual(['/api/me/catalog/titles?slugs=a,b-c'])
  })
  it('titleDetail: snapshot в запросе', async () => {
    const { d, urls } = deps(res(200, {}))
    await titleDetail('friends-light', 'abcd', { deps: d })
    expect(urls[0]).toBe('/api/me/catalog/titles/friends-light?snapshot=abcd')
  })
})

describe('429 busy — молча повтор через Retry-After', () => {
  it('повторяет и отдаёт успех; пауза = Retry-After', async () => {
    const sleep = vi.fn(async () => {})
    const { d, urls } = deps(res(429, { error: 'busy' }, { 'Retry-After': '1' }), res(200, { snapshot: 'a', items: [] }))
    const r = await titlesBySlugs(['a'], { deps: d, sleep })
    expect(r.ok).toBe(true)
    expect(urls).toHaveLength(2)
    expect(sleep).toHaveBeenCalledWith(1000)
  })
  it('без Retry-After — 1 с; чужое большое значение режется до 5 с', async () => {
    const sleep = vi.fn(async (_ms: number) => {})
    const { d } = deps(res(429, { error: 'busy' }), res(429, { error: 'busy' }, { 'Retry-After': '600' }), res(200, { snapshot: 'a', items: [] }))
    await titlesBySlugs(['a'], { deps: d, sleep })
    expect(sleep.mock.calls.map(c => c[0])).toEqual([1000, 5000])
  })
  it('не бесконечно: после трёх повторов отдаёт 429', async () => {
    const { d, urls } = deps(res(429, { error: 'busy' }))
    const r = await titlesBySlugs(['a'], { deps: d, sleep: noSleep })
    expect(r.ok).toBe(false)
    expect(urls).toHaveLength(4)
  })
  it('503 не повторяется молча', async () => {
    const { d, urls } = deps(res(503, { error: 'catalog_unavailable' }))
    const r = await listTitles({}, { deps: d, sleep: noSleep })
    expect(r.ok).toBe(false)
    expect(urls).toHaveLength(1)
  })
})

describe('checkTitles — адаптер check для migratePointATitles: ЛЮБОЙ сбой = null', () => {
  it('успех — массив карточек, в том числе пустой', async () => {
    expect(await checkTitles(['a'], { deps: deps(res(200, { snapshot: 'a', items: [{ slug: 'a', goal_ok: true }] })).d })).toEqual([{ slug: 'a', goal_ok: true }])
    expect(await checkTitles(['a'], { deps: deps(res(200, { snapshot: 'a', items: [] })).d })).toEqual([])
  })
  it.each([
    ['503', () => res(503, { error: 'catalog_unavailable' })],
    ['404', () => res(404, { error: 'not_found' })],
    ['сеть', () => { throw new Error('net') }],
    ['items не массив', () => res(200, { snapshot: 'a', items: {} })],
    ['тело не объект', () => res(200, null)],
    ['тело — массив', () => res(200, [])],
  ])('%s → null', async (_n, mk) => {
    expect(await checkTitles(['a'], { deps: deps(mk).d, sleep: noSleep })).toBeNull()
  })
})
