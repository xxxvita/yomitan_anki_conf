// api.test.ts — клиент BFF (Э3): fetchGoals + buildRoute (create→poll→map).
//
// Контракт зафиксирован бэком (docs/plan-2026-07-13-design-transfer.md, Э3):
// GET /api/goals, POST /api/route → 202 {job_id}, GET /api/route/jobs/{id}
// → {status,route,error}. fetch мокается ровно под этот контракт.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchGoals, buildRoute, fetchPuzzleCatalog, puzzlePreviewURL } from '../api'

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body }
}

beforeEach(() => {
  vi.useFakeTimers()
  // buildRoute шлёт anon_id (ensureAnonId) — фиксируем, чтобы body был детерминирован.
  window.localStorage.setItem('flib:anon', 'anon-test')
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('fetchGoals', () => {
  it('returns the goals array on a 200 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      goals: [{ id: 'friends', title: 'Friends', kind: 'sitcom', level: 'B1', target: 'friends' }],
    })))
    const goals = await fetchGoals()
    expect(goals).toEqual([{ id: 'friends', title: 'Friends', kind: 'sitcom', level: 'B1', target: 'friends' }])
  })

  it('throws on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, false, 500)))
    await expect(fetchGoals()).rejects.toThrow('500')
  })

  it('throws on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    await expect(fetchGoals()).rejects.toThrow('network down')
  })
})

// fetchPuzzleCatalog/puzzlePreviewURL — [ID:P-film-picker] contract §3.1.
describe('fetchPuzzleCatalog', () => {
  it('returns the items array on a 200 response', async () => {
    const items = [{ slug: 'friends', title_en: 'Friends', title_ru: 'Друзья', media_type: 2, seasons: 10, episodes: 236 }]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ items, total: 1 })))
    const result = await fetchPuzzleCatalog()
    expect(result).toEqual(items)
  })

  it('passes an AbortSignal through to fetch when given one', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [], total: 0 }))
    vi.stubGlobal('fetch', fetchMock)
    await fetchPuzzleCatalog(controller.signal)
    expect(fetchMock).toHaveBeenCalledWith('/api/puzzle/catalog', { signal: controller.signal })
  })

  it('throws on a non-ok response (e.g. 502 gateway_denied/catalog_unavailable)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, false, 502)))
    await expect(fetchPuzzleCatalog()).rejects.toThrow('502')
  })

  it('throws on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    await expect(fetchPuzzleCatalog()).rejects.toThrow('network down')
  })

  it('throws a human-readable error when items is not an array', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ total: 0 })))
    await expect(fetchPuzzleCatalog()).rejects.toThrow(/неожиданном формате/i)
  })
})

describe('puzzlePreviewURL', () => {
  it('builds the preview URL with an encoded slug', () => {
    expect(puzzlePreviewURL('the-wire')).toBe('/api/puzzle/preview?slug=the-wire')
  })

  it('encodes special characters in the slug (defense in depth against a malformed value)', () => {
    expect(puzzlePreviewURL('a b/c')).toBe('/api/puzzle/preview?slug=a%20b%2Fc')
  })
})

describe('buildRoute', () => {
  const pointA = { kind: 'cefr' as const, level: 'B1' }
  const dtoSteps = [
    { kind: 'video' as const, video_id: 'abc', title: 'T1', source: 'S1', duration_sec: 300, new_lemmas: 5, words: [] },
    { kind: 'words' as const, video_id: null, title: 'T2', source: 'S2', duration_sec: 200, new_lemmas: 3, words: ['a', 'b'] },
  ]

  it('успешный цикл 202→pending→done: маппит route в RouteState', async () => {
    const onPhase = vi.fn()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ job_id: 'job-1' }, true, 202))
      .mockResolvedValueOnce(jsonResponse({ status: 'pending', route: null, error: '' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'done', route: { goal_label: 'Friends', steps: dtoSteps }, error: '' }))
    vi.stubGlobal('fetch', fetchMock)

    const promise = buildRoute(pointA, ['friends'], 'balance', { onPhase })
    await vi.runAllTimersAsync()
    const result = await promise

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ point_a: pointA, goal_ids: ['friends'], profile: 'balance', anon_id: 'anon-test' }),
      signal: undefined,
    })
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/route/jobs/job-1', { signal: undefined })
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/route/jobs/job-1', { signal: undefined })
    expect(onPhase).toHaveBeenCalledWith('pending')

    expect(result.v).toBe(1)
    expect(result.goalLabel).toBe('Friends')
    expect(result.settings).toEqual({ profile: 'balance' })
    expect(result.revealedBatches).toBe(1)
    expect(result.steps).toHaveLength(2)
    expect(result.steps[0]).toMatchObject({
      kind: 'video', videoId: 'abc', title: 'T1', source: 'S1', durationSec: 300, newLemmas: 5, status: 'current',
    })
    expect(result.steps[1]).toMatchObject({
      kind: 'words', videoId: null, words: ['a', 'b'], status: 'next',
    })
  })

  it('failed job status: throws with the server-provided message', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ job_id: 'job-2' }, true, 202))
      .mockResolvedValueOnce(jsonResponse({ status: 'failed', route: null, error: 'route-provider недоступен' }))
    vi.stubGlobal('fetch', fetchMock)

    const promise = buildRoute(pointA, ['friends'], 'comfort')
    const assertion = expect(promise).rejects.toThrow('route-provider недоступен')
    await vi.runAllTimersAsync()
    await assertion
  })

  it('failed job status without an error message falls back to a generic message', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ job_id: 'job-2b' }, true, 202))
      .mockResolvedValueOnce(jsonResponse({ status: 'failed', route: null, error: '' }))
    vi.stubGlobal('fetch', fetchMock)

    const promise = buildRoute(pointA, ['friends'], 'comfort')
    const assertion = expect(promise).rejects.toThrow(/не удалось собрать маршрут/i)
    await vi.runAllTimersAsync()
    await assertion
  })

  it('network error on job creation: throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    await expect(buildRoute(pointA, ['friends'], 'balance')).rejects.toThrow('network down')
  })

  it('non-ok response on job creation: throws a human-readable error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, false, 503)))
    await expect(buildRoute(pointA, ['friends'], 'balance')).rejects.toThrow('503')
  })

  it('missing job_id in the create response: throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, true, 202)))
    await expect(buildRoute(pointA, ['friends'], 'balance')).rejects.toThrow(/идентификатор/i)
  })

  it('done status without a route payload: throws', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ job_id: 'job-3' }, true, 202))
      .mockResolvedValueOnce(jsonResponse({ status: 'done', route: null, error: '' }))
    vi.stubGlobal('fetch', fetchMock)

    const promise = buildRoute(pointA, ['friends'], 'balance')
    const assertion = expect(promise).rejects.toThrow(/не прислал/i)
    await vi.runAllTimersAsync()
    await assertion
  })

  it('аудит HIGH #3: an already-aborted signal short-circuits the polling loop before the next GET, with an AbortError', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ job_id: 'job-abort' }, true, 202))
      .mockResolvedValueOnce(jsonResponse({ status: 'pending', route: null, error: '' }))
    vi.stubGlobal('fetch', fetchMock)

    const promise = buildRoute(pointA, ['friends'], 'balance', { signal: controller.signal })
    // Аборт происходит после первого pending-ответа, но до второго GET
    // (пока висит delay(POLL_INTERVAL_MS) в цикле поллинга) — цикл обязан
    // проверить signal.aborted на входе в следующую итерацию, а не тихо
    // продолжить поллить отменённый билд.
    const assertion = expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()
    await vi.advanceTimersByTimeAsync(3000) // POLL_INTERVAL_MS (api.ts, не экспортирован)
    await assertion
    expect(fetchMock).toHaveBeenCalledTimes(2) // третий (следующий) GET так и не случился
  })

  it('аудит HIGH #3: signal передаётся во все fetch-вызовы (POST и GET)', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ job_id: 'job-sig' }, true, 202))
      .mockResolvedValueOnce(jsonResponse({ status: 'done', route: { goal_label: 'Friends', steps: dtoSteps }, error: '' }))
    vi.stubGlobal('fetch', fetchMock)

    const promise = buildRoute(pointA, ['friends'], 'balance', { signal: controller.signal })
    await vi.runAllTimersAsync()
    await promise

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/route', expect.objectContaining({ signal: controller.signal }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/route/jobs/job-sig', { signal: controller.signal })
  })

  it('аудит MED #4: route.steps не массив -> человекочитаемая ошибка вместо сырого TypeError', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ job_id: 'job-bad-steps' }, true, 202))
      .mockResolvedValueOnce(jsonResponse({ status: 'done', route: { goal_label: 'Friends', steps: 'not-an-array' }, error: '' }))
    vi.stubGlobal('fetch', fetchMock)

    const promise = buildRoute(pointA, ['friends'], 'balance')
    const assertion = expect(promise).rejects.toThrow(/неожиданном формате/i)
    await vi.runAllTimersAsync()
    await assertion
  })

  it('аудит LOW: duration_sec NaN/отрицательный клампится к 0, не протекает в UI/батчи как есть', async () => {
    const brokenDtoSteps = [
      { kind: 'video' as const, video_id: 'abc', title: 'T1', source: 'S1', duration_sec: Number.NaN, new_lemmas: 5, words: [] },
      { kind: 'video' as const, video_id: 'def', title: 'T2', source: 'S2', duration_sec: -300, new_lemmas: 3, words: [] },
    ]
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ job_id: 'job-dur' }, true, 202))
      .mockResolvedValueOnce(jsonResponse({ status: 'done', route: { goal_label: 'Friends', steps: brokenDtoSteps }, error: '' }))
    vi.stubGlobal('fetch', fetchMock)

    const promise = buildRoute(pointA, ['friends'], 'balance')
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result.steps[0].durationSec).toBe(0)
    expect(result.steps[1].durationSec).toBe(0)
  })

  it('times out after ~10 minutes of pending status with a human-readable error', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ job_id: 'job-4' }, true, 202))
      .mockResolvedValue(jsonResponse({ status: 'pending', route: null, error: '' }))
    vi.stubGlobal('fetch', fetchMock)

    const promise = buildRoute(pointA, ['friends'], 'balance')
    const assertion = expect(promise).rejects.toThrow(/долго|позже/i)
    await vi.runAllTimersAsync()
    await assertion
  })

  // profile_meta (задача P-profile-feed, 2026-07-14): buildRoute сам pointA
  // не разбирает — profileMeta целиком приходит от вызывающего кода
  // (RoutePage.tsx toProfileMeta), buildRoute только кладёт его в тело, если
  // передали.
  it('profileMeta: непустой — уходит в тело POST /api/route, отсутствующий — поле не добавляется', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ job_id: 'j1' }, true, 202))
      .mockResolvedValueOnce(jsonResponse({ status: 'done', route: { goal_label: 'X', steps: [] }, error: '' }))
    vi.stubGlobal('fetch', fetchMock)
    await buildRoute(pointA, ['friends'], 'balance', { profileMeta: { vocab_source: 'cefr', level: 'B1', age: 30 } })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.profile_meta).toEqual({ vocab_source: 'cefr', level: 'B1', age: 30 })

    fetchMock.mockClear()
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ job_id: 'j2' }, true, 202))
      .mockResolvedValueOnce(jsonResponse({ status: 'done', route: { goal_label: 'X', steps: [] }, error: '' }))
    await buildRoute(pointA, ['friends'], 'balance', {})
    const body2 = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect('profile_meta' in body2).toBe(false)
  })

  // [ID:P-film-picker] contract §3.1: targets — mirrors exclude_video_ids
  // (omit when empty), stable key order (anon_id стабильно последний — тест
  // на точный порядок ключей, см. doc-комментарий api.ts buildRoute).
  it('targets: непустой — уходит в тело ПОСЛЕ exclude_channels_of_video_ids и ПЕРЕД anon_id, отсутствующий/пустой — ключ опущен', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ job_id: 'jt1' }, true, 202))
      .mockResolvedValueOnce(jsonResponse({ status: 'done', route: { goal_label: 'X', steps: [] }, error: '' }))
    vi.stubGlobal('fetch', fetchMock)
    await buildRoute(pointA, [], 'balance', {
      excludeVideoIds: ['v1'], excludeChannelsOfVideoIds: ['v1'], targets: ['the-wire'],
    })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.targets).toEqual(['the-wire'])
    expect(Object.keys(body)).toEqual([
      'point_a', 'goal_ids', 'profile', 'exclude_video_ids', 'exclude_channels_of_video_ids', 'targets', 'anon_id',
    ])

    fetchMock.mockClear()
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ job_id: 'jt2' }, true, 202))
      .mockResolvedValueOnce(jsonResponse({ status: 'done', route: { goal_label: 'X', steps: [] }, error: '' }))
    await buildRoute(pointA, ['friends'], 'balance', { targets: [] })
    const body2 = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect('targets' in body2).toBe(false)

    fetchMock.mockClear()
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ job_id: 'jt3' }, true, 202))
      .mockResolvedValueOnce(jsonResponse({ status: 'done', route: { goal_label: 'X', steps: [] }, error: '' }))
    await buildRoute(pointA, ['friends'], 'balance', {})
    const body3 = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect('targets' in body3).toBe(false)
  })

  // §3.8 «Бонус из скринкаста»: 404 на создании джобы — дружелюбное
  // сообщение, не голый "(404)".
  it('404 on job creation: friendly "попробуйте позже" message, not a raw status code', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, false, 404)))
    await expect(buildRoute(pointA, ['friends'], 'balance')).rejects.toThrow('Маршрут построить не удалось — попробуйте позже')
  })

  // [ID:P-abstract-goals] contract §1 D3/golden fixture: `goal` — mirrors
  // targets/exclude_video_ids (omit when not passed), stable key order —
  // ПОСЛЕ targets, ПЕРЕД anon_id (golden fixture §wire-контракт).
  describe('goal (contract §1 D3, [ID:P-abstract-goals])', () => {
    it('goal: непустой — уходит в тело ПОСЛЕ targets и ПЕРЕД anon_id, отсутствующий — ключ опущен', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(jsonResponse({ job_id: 'jg1' }, true, 202))
        .mockResolvedValueOnce(jsonResponse({ status: 'done', route: { goal_label: 'X', steps: [] }, error: '' }))
      vi.stubGlobal('fetch', fetchMock)
      await buildRoute(pointA, [], 'balance', {
        excludeVideoIds: ['v1'], excludeChannelsOfVideoIds: ['v1'], targets: ['the-wire'],
        goal: { puzzle_ids: ['the-wire'], categories: ['science'] },
      })
      const body = JSON.parse(fetchMock.mock.calls[0][1].body)
      expect(body.goal).toEqual({ puzzle_ids: ['the-wire'], categories: ['science'] })
      expect(Object.keys(body)).toEqual([
        'point_a', 'goal_ids', 'profile', 'exclude_video_ids', 'exclude_channels_of_video_ids', 'targets', 'goal', 'anon_id',
      ])

      fetchMock.mockClear()
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ job_id: 'jg2' }, true, 202))
        .mockResolvedValueOnce(jsonResponse({ status: 'done', route: { goal_label: 'X', steps: [] }, error: '' }))
      await buildRoute(pointA, ['friends'], 'balance', {})
      const body2 = JSON.parse(fetchMock.mock.calls[0][1].body)
      expect('goal' in body2).toBe(false)
    })

    it('goal present but targets/excludes absent: key order is point_a, goal_ids, profile, goal, anon_id', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(jsonResponse({ job_id: 'jg3' }, true, 202))
        .mockResolvedValueOnce(jsonResponse({ status: 'done', route: { goal_label: 'X', steps: [] }, error: '' }))
      vi.stubGlobal('fetch', fetchMock)
      await buildRoute(pointA, [], 'balance', { goal: { text_queries: ['хочу понимать лекции'] } })
      const body = JSON.parse(fetchMock.mock.calls[0][1].body)
      expect(Object.keys(body)).toEqual(['point_a', 'goal_ids', 'profile', 'goal', 'anon_id'])
    })
  })

  // [ID:P-abstract-goals] contract §2.5: goal_not_resolved (400 на создании
  // джобы) и empty_route (failed-статус с кодом вместо готового текста) —
  // переводятся в понятные месседжи, не показываются юзеру как raw-код.
  describe('known error codes (contract §2.5, [ID:P-abstract-goals])', () => {
    it('goal_not_resolved on job creation (400, body {error:"goal_not_resolved"}): friendly message', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'goal_not_resolved' }, false, 400)))
      await expect(buildRoute(pointA, [], 'balance', { goal: { categories: ['unknown-key'] } }))
        .rejects.toThrow('Цели не распознаны — вернитесь к выбору')
    })

    it('an UNKNOWN error code in the 400 body falls back to the generic status-code message (no over-matching)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'missing_target' }, false, 400)))
      await expect(buildRoute(pointA, ['friends'], 'balance')).rejects.toThrow('(400)')
    })

    it('empty_route: failed job status with error="empty_route" (a code, not prose) maps to a friendly message', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(jsonResponse({ job_id: 'job-empty' }, true, 202))
        .mockResolvedValueOnce(jsonResponse({ status: 'failed', route: null, error: 'empty_route' }))
      vi.stubGlobal('fetch', fetchMock)
      const promise = buildRoute(pointA, ['friends'], 'balance')
      const assertion = expect(promise).rejects.toThrow('Маршрут пуст')
      await vi.runAllTimersAsync()
      await assertion
    })

    it('a failed job status with an already human-readable error message is passed through unchanged (regression)', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(jsonResponse({ job_id: 'job-human' }, true, 202))
        .mockResolvedValueOnce(jsonResponse({ status: 'failed', route: null, error: 'route-provider недоступен' }))
      vi.stubGlobal('fetch', fetchMock)
      const promise = buildRoute(pointA, ['friends'], 'balance')
      const assertion = expect(promise).rejects.toThrow('route-provider недоступен')
      await vi.runAllTimersAsync()
      await assertion
    })
  })
})
