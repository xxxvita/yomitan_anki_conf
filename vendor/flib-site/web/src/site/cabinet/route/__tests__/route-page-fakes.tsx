// route-page-fakes.tsx — стенд страницы маршрута: фикстуры проекции BFF (§4.2)
// и сценарный BFF `/api/me/route/*` в браузере (повторяет режимы фальшивого
// шлюза B0: без Г7 / с Г7, day_done, Р24, задержанный ответ состояния).
import { HeardCheckHost } from '../heard-check/HeardCheckModal'
import { render } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { DayClip, DayClipDelivered, DayClipKept, DayClipUndelivered, ExtraRow, RouteState } from '../route-api'
import { RoutePageCabinet, type RoutePageTestDeps } from '../RoutePageCabinet'

export const ROUTE = '11111111-1111-4111-8111-111111111111'
export const ROUTE2 = '22222222-2222-4222-8222-222222222222'
export const TODAY = '2026-11-18'
export const EXTRA_JOB = '55555555-5555-4555-8555-555555555555'

export const vid = (n: number) => `vid${String(n).padStart(8, '0')}`
export const pid = (n: number) => `youtube::${vid(n)}`

export function del(n: number, over: Partial<DayClipDelivered> = {}): DayClipDelivered {
  return { puzzle_id: pid(n), kind: 'youtube', video_id: vid(n), title: `Title ${n}`, source: 'YouTube', duration_sec: 300, delivered: true, played: false, queued_played: false, new_words: 0, words: [], ...over }
}
export function lesson(id: string, over: Partial<DayClipDelivered> = {}): DayClipDelivered {
  return { puzzle_id: `words::${id}`, kind: 'words', delivered: true, played: false, queued_played: false, new_words: 3, words: ['alpha', 'beta', 'gamma'], ...over }
}
export function other(n: number, over: Partial<DayClipDelivered> = {}): DayClipDelivered {
  return { puzzle_id: `film::${n}`, kind: 'other', title: `Film ${n}`, source: 'Puzzle', duration_sec: 600, delivered: true, played: false, queued_played: false, new_words: 0, words: [], ...over }
}
export function und(over: Partial<DayClipUndelivered> = {}): DayClipUndelivered {
  return { delivered: false, duration_sec: 240, new_words: 0, ...over }
}
export function kept(n: number, over: Partial<DayClipKept> = {}): DayClipKept {
  return { puzzle_id: pid(n), kind: 'youtube', video_id: vid(n), title: `Kept ${n}`, source: 'YouTube', duration_sec: 300, delivered: true, played: true, kept: true, ...over }
}

export function xrow(n: number, over: Partial<ExtraRow> = {}): ExtraRow {
  return { puzzle_id: `youtube::xtr${String(n).padStart(8, '0')}`, kind: 'youtube', video_id: `xtr${String(n).padStart(8, '0')}`, title: `Extra ${n}`, source: 'YouTube', duration_sec: 240, played: false, ...over }
}

export function st(clips: DayClip[] | null, over: Partial<RouteState> = {}): RouteState {
  const delivered = (clips ?? []).filter(c => c.delivered === true && !('kept' in c && (c as DayClipKept).kept)) as DayClipDelivered[]
  return {
    started: true, route_id: ROUTE, revision: 5, snapshot_date: TODAY, started_at: '2026-11-10T10:00:00Z', goal_label: 'Friends',
    params: { daily_listening_budget_min: 20, daily_new_words: 15 },
    day: clips ? { date: TODAY, clips } : null,
    next_clip: null, current_puzzle_id: delivered.length ? delivered[delivered.length - 1].puzzle_id : null,
    replace_available: true, stop_reason: null, active_exchange: null, ...over,
  }
}

export const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })

export interface Call { method: string; url: string; body: unknown; at: number }

export const GOAL_ID = '44444444-4444-4444-8444-444444444444'
export function goalView(status: string, readyCount: number, over: Record<string, unknown> = {}) {
  return { request_id: GOAL_ID, status, revision: 1, total: 2, ready_count: readyCount, worker_online: true, videos: [
    { video_id: 'dQw4w9WgXcQ', status: readyCount > 0 ? 'ready' : 'queued', title: 'Never Gonna' },
    { video_id: 'aaaaaaaaaaa', status: readyCount > 1 ? 'ready' : 'queued' },
  ], ...over }
}

// FakeRouteBFF — сценарный BFF. state — ответ GET state (или функция); exchange —
// ответ создания обмена; job — ответ опроса; afterCommit — состояние после коммита.
export class FakeRouteBFF {
  calls: Call[] = []
  seq = 0
  state: RouteState | ((n: number) => Response | Promise<Response>) = st(null, { started: false, route_id: null, revision: 0, started_at: null })
  stateGets = 0
  afterCommit: RouteState | null = null
  exchangeReply: (body: Record<string, unknown>) => Response | Promise<Response> = () => json(202, { job_id: '33333333-3333-4333-8333-333333333333', base_revision: this.currentRevision() })
  jobReply: () => Response | Promise<Response> = () => json(200, { status: 'done', committed: true, committed_revision: this.currentRevision() + 1, cancel_reason: null, error_code: null })
  // Дополнительное видео: создание подбора и опрос задания (`/api/me/route/extra*`).
  extraReply: (body: Record<string, unknown>, n: number) => Response | Promise<Response> = () => json(202, { job_id: EXTRA_JOB })
  extraJobReply: (n: number) => Response | Promise<Response> = () => json(200, { status: 'done', outcome: 'clip' })
  extraJobGets = 0
  quickStartReply: (body: Record<string, unknown>) => Response | Promise<Response> = () => json(202, { job_id: '33333333-3333-4333-8333-333333333333', revision: 1 })
  eventsReply: (body: { route_id: string; events: Array<Record<string, unknown>> }) => Response = b => json(200, { accepted: b.events.length, duplicates: 0, rejected: [], evicted_external: 0 })
  sessionReply: () => Response = () => json(200, { authenticated: true, cabinet: true, state: 'active', key_prefix: 'tpk_abcd', demo: false, route_allowed: true })
  // daysReply — ответ GET days; daysInflight / daysMaxInflight — сколько запросов дней в полёте.
  daysReply: (from: string, to: string) => Response | Promise<Response> = () => json(200, { days: [] })
  daysInflight = 0
  daysMaxInflight = 0
  paramsReply: (body: Record<string, unknown>) => Response | Promise<Response> = () => json(200, {})
  resetReply: () => Response | Promise<Response> = () => json(200, { removed: 1 })
  examplesReply: (word: string, n: number) => Response | Promise<Response> = () => json(200, { items: [], empty_reason: 'not_in_corpus' })
  examplesCalls = 0
  // Каталог тайтлов BFF (`/api/me/catalog/titles`): список (popular/limit) и ?slugs=.
  titles: Array<Record<string, unknown>> = []
  titlesReply: ((url: string, n: number) => Response | Promise<Response> | null) | null = null
  titlesCalls = 0
  // «Мои цели»: ответ создания / опроса сбора (`/api/me/route/goals*`).
  goalCreateReply: (body: Record<string, unknown>, n: number) => Response | Promise<Response> = () => json(202, goalView('queued', 0))
  goalGetReply: (id: string, n: number) => Response | Promise<Response> = () => json(200, goalView('harvesting', 0))
  goalGets = 0
  // Названия роликов целей (`/api/me/route/video-titles?ids=`): по умолчанию ни одного — «нет названия».
  videoTitlesReply: (ids: string[], n: number) => Response | Promise<Response> = () => json(200, { titles: {}, pending: [] })
  videoTitlesCalls = 0
  goals = [{ id: 'friends-light', title: 'Friends', kind: 'Ситком', level: 'A2', target: 'friends-light/s01e01' }]

  currentRevision(): number { return typeof this.state === 'function' ? 0 : this.state.revision }

  fetch = async (input: string, init: RequestInit = {}): Promise<Response> => {
    const url = String(input)
    const method = (init.method ?? 'GET').toUpperCase()
    let body: unknown = null
    if (typeof init.body === 'string') { try { body = JSON.parse(init.body) } catch { body = init.body } }
    this.calls.push({ method, url, body, at: ++this.seq })
    if (url === '/api/goals') return json(200, { goals: this.goals })
    if (url === '/api/session') return this.sessionReply()
    if (url.startsWith('/api/me/route/video-titles') && method === 'GET') {
      const ids = (new URL(url, 'https://flib.club').searchParams.get('ids') ?? '').split(',')
      return this.videoTitlesReply(ids, ++this.videoTitlesCalls)
    }
    if (url === '/api/me/route/goals' && method === 'POST') return this.goalCreateReply(body as Record<string, unknown>, this.of('/api/me/route/goals', 'POST').length)
    if (url.startsWith('/api/me/route/goals/') && method === 'GET') return this.goalGetReply(url.slice('/api/me/route/goals/'.length), ++this.goalGets)
    if (url.startsWith('/api/me/route/state')) {
      this.stateGets++
      return typeof this.state === 'function' ? this.state(this.stateGets) : json(200, this.state)
    }
    if (url === '/api/me/route/extra' && method === 'POST') return this.extraReply(body as Record<string, unknown>, this.of('/api/me/route/extra', 'POST').length)
    if (url.startsWith('/api/me/route/extra-jobs/') && method === 'GET') return this.extraJobReply(++this.extraJobGets)
    if (url === '/api/me/route/exchange' && method === 'POST') return this.exchangeReply(body as Record<string, unknown>)
    if (url.startsWith('/api/me/route/jobs/')) {
      const r = await this.jobReply()
      if (this.afterCommit) { const copy = r.clone(); const j = await copy.json().catch(() => null) as { committed?: boolean } | null; if (j?.committed) { this.state = this.afterCommit; this.afterCommit = null } }
      return r
    }
    if (url === '/api/me/route/quick-start' && method === 'POST') return this.quickStartReply(body as Record<string, unknown>)
    if (url === '/api/me/route/events' && method === 'POST') return this.eventsReply(body as { route_id: string; events: Array<Record<string, unknown>> })
    if (url === '/api/me/route' && method === 'DELETE') return this.resetReply()
    if (url === '/api/me/route/params' && method === 'PUT') return this.paramsReply(body as Record<string, unknown>)
    if (url.startsWith('/api/me/route/examples')) {
      const word = new URL(url, 'https://flib.club').searchParams.get('word') ?? ''
      return this.examplesReply(word, ++this.examplesCalls)
    }
    if (url.startsWith('/api/me/route/days')) {
      const q = new URL(url, 'https://flib.club').searchParams
      this.daysInflight++
      this.daysMaxInflight = Math.max(this.daysMaxInflight, this.daysInflight)
      try { return await this.daysReply(q.get('from') ?? '', q.get('to') ?? '') } finally { this.daysInflight-- }
    }
    if (url.startsWith('/api/me/catalog/titles')) {
      const n = ++this.titlesCalls
      const custom = this.titlesReply?.(url, n)
      if (custom) return custom
      const q = new URL(url, 'https://flib.club').searchParams
      const slugs = q.get('slugs')
      if (slugs) {
        const want = slugs.split(',')
        return json(200, { snapshot: 'aaaaaaaaaaaaaaaa', items: want.flatMap(s => this.titles.filter(t => t.slug === s)) })
      }
      const limit = Number(q.get('limit') ?? 30)
      return json(200, { snapshot: 'aaaaaaaaaaaaaaaa', total: this.titles.length, tempo_median_wpm: 169, pace: { slow_below: 160, fast_from: 178 }, items: this.titles.slice(Number(q.get('offset') ?? 0), Number(q.get('offset') ?? 0) + limit) })
    }
    if (url.startsWith('/api/feedback/video')) return new Response(null, { status: 204 })
    return json(404, { error: 'not_found' })
  }

  of(path: string, method = 'GET'): Call[] { return this.calls.filter(c => c.url.startsWith(path) && c.method === method) }
  events(): Array<Record<string, unknown>> { return this.of('/api/me/route/events', 'POST').flatMap(c => (c.body as { events: Array<Record<string, unknown>> }).events) }
}

export function LocationProbe() {
  const l = useLocation()
  return <div data-testid="location">{l.pathname + l.search}</div>
}

export function renderRoutePage(bff: FakeRouteBFF, o: { url?: string; deps?: RoutePageTestDeps } = {}) {
  const deps: RoutePageTestDeps = { fetch: bff.fetch, sleep: async () => { await new Promise(r => setTimeout(r, 0)) }, ...o.deps }
  return render(
    <MemoryRouter initialEntries={[o.url ?? '/app/route']}>
      <div className="cab">
        <Routes>
          <Route path="/app/route" element={<RoutePageCabinet testDeps={deps} />} />
          <Route path="*" element={<div data-testid="elsewhere" />} />
        </Routes>
        <LocationProbe />
        <HeardCheckHost />
      </div>
    </MemoryRouter>,
  )
}

export function setRouteMarker(on: boolean): void {
  document.head.querySelectorAll('meta[name="flib-route"]').forEach(m => m.remove())
  if (!on) return
  const m = document.createElement('meta'); m.setAttribute('name', 'flib-route'); m.setAttribute('content', '1'); document.head.appendChild(m)
}

// fullText — сопоставитель по полному тексту элемента (текст разбит на <em>,
// ссылки): самый глубокий элемент, чей textContent равен строке или подходит под regexp.
export function fullText(t: string | RegExp) {
  const ok = (x: string | null | undefined) => x != null && (typeof t === 'string' ? x === t : t.test(x))
  return (_: string, el: Element | null) => !!el && ok(el.textContent) && Array.from(el.children).every(c => !ok(c.textContent))
}
