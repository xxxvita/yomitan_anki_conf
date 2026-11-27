import { describe, it, expect, beforeEach } from 'vitest'
import { draftFor, saveGoalDraft, loadGoalDraft, clearGoalDraft, eraseRouteStorage } from '../route-storage'
import { createGoal } from '../route-api'
import { goalOf } from '../../../route-goal'
import type { PointA } from '../../../pointA'

beforeEach(() => { try { window.localStorage.clear() } catch { /* no-op */ } })

describe('goal harvest draft', () => {
  it('draft resets when video set changes', () => {
    const a = draftFor('flib_ab12', ['aaaaaaaaaaa', 'bbbbbbbbbbb'])
    saveGoalDraft('flib_ab12', a)
    const b = draftFor('flib_ab12', ['aaaaaaaaaaa', 'ccccccccccc'])
    expect(b.client_request_id).not.toBe(a.client_request_id)
    expect(b.request_id).toBeUndefined()
  })
  it('draft reused for same set in any order', () => {
    const a = { ...draftFor('flib_ab12', ['aaaaaaaaaaa', 'bbbbbbbbbbb']), request_id: 'r1' }
    saveGoalDraft('flib_ab12', a)
    const b = draftFor('flib_ab12', ['bbbbbbbbbbb', 'aaaaaaaaaaa'])
    expect(b.client_request_id).toBe(a.client_request_id)
    expect(b.request_id).toBe('r1')
    clearGoalDraft('flib_ab12')
    expect(loadGoalDraft('flib_ab12')).toBeNull()
  })
  it('eraseRouteStorage removes goal draft', () => {
    saveGoalDraft('flib_ab12', draftFor('flib_ab12', ['aaaaaaaaaaa']))
    saveGoalDraft('flib_cd34', draftFor('flib_cd34', ['aaaaaaaaaaa']))
    eraseRouteStorage()
    expect(loadGoalDraft('flib_ab12')).toBeNull()
    expect(loadGoalDraft('flib_cd34')).toBeNull()
  })
  it('goalOf labels youtube items as «Мои ролики (2)»', () => {
    const p = {
      kind: 'cefr', level: 'B2',
      goalsV2: [
        { type: 'youtube', videoId: 'aaaaaaaaaaa' },
        { type: 'custom', text: 'x' },
        { type: 'youtube', videoId: 'bbbbbbbbbbb' },
      ],
    } as unknown as PointA
    const g = goalOf(p).goal!
    expect(g.label).toBe('Мои ролики (2) + «x»')
    expect(g.puzzle_ids).toEqual(['youtube::aaaaaaaaaaa', 'youtube::bbbbbbbbbbb'])
  })
  it('createGoal maps 503 worker_offline with retryAfterSec 30', async () => {
    const deps = {
      fetch: async () => new Response(JSON.stringify({ error: 'worker_offline' }), {
        status: 503, headers: { 'Retry-After': '30', 'Content-Type': 'application/json' },
      }),
    }
    const r = await createGoal({ video_urls: ['u'], client_request_id: 'c' }, deps)
    expect(r).toEqual({ ok: false, status: 503, code: 'worker_offline', retryAfterSec: 30 })
  })
})
