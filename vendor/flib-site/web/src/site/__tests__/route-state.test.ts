// route-state.test.ts — TDD для чистой логики маршрута (Э2, план п.1).
// Пишется ДО route-state.ts (Pre-Write Protocol: тесты сначала).
import { describe, it, expect, beforeEach } from 'vitest'
import {
  loadRoute, saveRoute, ensureAnonId, visibleSteps, hasMore, markStepDone, buildMockRoute,
  spliceReplaceFrom, addExcludedVideo,
  type RouteState, type RouteStep,
} from '../route-state'

const HOUR = 3600

function makeStep(overrides: Partial<RouteStep> = {}): RouteStep {
  return {
    id: 'r1',
    kind: 'video',
    videoId: 'aaaaaaaaaaa',
    title: 'Step',
    source: 'Source',
    durationSec: HOUR,
    newLemmas: 10,
    words: [],
    status: 'next',
    ...overrides,
  }
}

function makeRoute(steps: RouteStep[], revealedBatches = 1): RouteState {
  return {
    v: 1,
    goalLabel: 'Friends без субтитров',
    steps,
    createdAt: new Date().toISOString(),
    settings: { profile: 'balance' },
    revealedBatches,
  }
}

describe('loadRoute/saveRoute', () => {
  beforeEach(() => { window.localStorage.clear() })

  it('returns null when nothing is stored', () => {
    expect(loadRoute()).toBeNull()
  })

  it('round-trips a saved route', () => {
    const route = makeRoute([makeStep()])
    saveRoute(route)
    expect(loadRoute()).toEqual(route)
  })

  it('returns null for corrupt JSON instead of throwing', () => {
    window.localStorage.setItem('flib:route', '{not json')
    expect(() => loadRoute()).not.toThrow()
    expect(loadRoute()).toBeNull()
  })

  it('returns null for a foreign schema (missing v/steps)', () => {
    window.localStorage.setItem('flib:route', JSON.stringify({ hello: 'world' }))
    expect(loadRoute()).toBeNull()
  })

  it('returns null when v is not 1', () => {
    window.localStorage.setItem('flib:route', JSON.stringify({ v: 2, steps: [] }))
    expect(loadRoute()).toBeNull()
  })

  it('returns null when steps is not an array', () => {
    window.localStorage.setItem('flib:route', JSON.stringify({ v: 1, steps: 'nope' }))
    expect(loadRoute()).toBeNull()
  })
})

describe('ensureAnonId', () => {
  beforeEach(() => { window.localStorage.clear() })

  it('creates and persists an id on first call', () => {
    const id = ensureAnonId()
    expect(id).toBeTruthy()
    expect(window.localStorage.getItem('flib:anon')).toBe(id)
  })

  it('returns the same id on subsequent calls', () => {
    const first = ensureAnonId()
    const second = ensureAnonId()
    expect(second).toBe(first)
  })

  it('falls back to a random hex id when crypto.randomUUID is unavailable', () => {
    const original = globalThis.crypto.randomUUID
    // @ts-expect-error — эмулируем окружение без randomUUID (старые браузеры/webview)
    delete globalThis.crypto.randomUUID
    try {
      const id = ensureAnonId()
      expect(typeof id).toBe('string')
      expect(id.length).toBeGreaterThan(0)
      expect(window.localStorage.getItem('flib:anon')).toBe(id)
    } finally {
      globalThis.crypto.randomUUID = original
    }
  })
})

// feedback-1 п.6в: лимит порции понижен с 15ч до 1ч (владелец — «давать
// скажем на 1 час в день маршрута»). Границы батчей ниже пересчитаны под
// новый лимит (было 8ч+7ч=15ч ровно/10ч+10ч и т.п. — масштабируем к минутам).
describe('visibleSteps/hasMore — порции по ~1 часу', () => {
  it('empty steps: nothing visible, no more', () => {
    const route = makeRoute([], 1)
    expect(visibleSteps(route)).toEqual([])
    expect(hasMore(route)).toBe(false)
  })

  it('a single step longer than 1h is still included whole in batch 1', () => {
    const long = makeStep({ id: 'r1', durationSec: 2 * HOUR })
    const route = makeRoute([long], 1)
    expect(visibleSteps(route)).toEqual([long])
    expect(hasMore(route)).toBe(false)
  })

  it('exactly on the batch boundary stays in the same batch (inclusive)', () => {
    const a = makeStep({ id: 'r1', durationSec: 20 * 60 })
    const b = makeStep({ id: 'r2', durationSec: 40 * 60 }) // сумма == 1h ровно
    const c = makeStep({ id: 'r3', durationSec: 60 }) // должен уйти в батч 2
    const route = makeRoute([a, b, c], 1)
    expect(visibleSteps(route).map(s => s.id)).toEqual(['r1', 'r2'])
    expect(hasMore(route)).toBe(true)

    const route2 = { ...route, revealedBatches: 2 }
    expect(visibleSteps(route2).map(s => s.id)).toEqual(['r1', 'r2', 'r3'])
    expect(hasMore(route2)).toBe(false)
  })

  it('crossing 1h starts a new batch, revealed by revealedBatches', () => {
    const steps = [
      makeStep({ id: 'r1', durationSec: 40 * 60 }),
      makeStep({ id: 'r2', durationSec: 40 * 60 }), // не влезает следом за r1 -> батч 2
      makeStep({ id: 'r3', durationSec: 10 * 60 }),
    ]
    const route = makeRoute(steps, 1)
    expect(visibleSteps(route).map(s => s.id)).toEqual(['r1'])
    expect(hasMore(route)).toBe(true)

    const route2 = { ...route, revealedBatches: 2 }
    expect(visibleSteps(route2).map(s => s.id)).toEqual(['r1', 'r2', 'r3'])
    expect(hasMore(route2)).toBe(false)
  })
})

describe('markStepDone', () => {
  it('marks the step done and the next not-done visible step becomes current, rest next', () => {
    // feedback-1 п.6в: makeStep's default durationSec (1h) is now the whole
    // batch limit itself — three default steps would land in three separate
    // batches and only r1 would be visible. Shrink to keep all three in
    // batch 1 (this test is about status propagation, not batching).
    const steps = [
      makeStep({ id: 'r1', status: 'current', durationSec: 10 * 60 }),
      makeStep({ id: 'r2', status: 'next', durationSec: 10 * 60 }),
      makeStep({ id: 'r3', status: 'next', durationSec: 10 * 60 }),
    ]
    const route = makeRoute(steps, 1)
    const next = markStepDone(route, 'r1')
    expect(next.steps.find(s => s.id === 'r1')?.status).toBe('done')
    expect(next.steps.find(s => s.id === 'r2')?.status).toBe('current')
    expect(next.steps.find(s => s.id === 'r3')?.status).toBe('next')
  })

  it('marking the last step done leaves no new current (no crash)', () => {
    const steps = [
      makeStep({ id: 'r1', status: 'done' }),
      makeStep({ id: 'r2', status: 'current' }),
    ]
    const route = makeRoute(steps, 1)
    const next = markStepDone(route, 'r2')
    expect(next.steps.every(s => s.status !== 'current')).toBe(true)
    expect(next.steps.find(s => s.id === 'r2')?.status).toBe('done')
  })

  it('does not touch steps beyond the revealed batches (still locked/hidden)', () => {
    const steps = [
      makeStep({ id: 'r1', status: 'current', durationSec: HOUR }),
      makeStep({ id: 'r2', status: 'locked', durationSec: 20 * HOUR }), // батч 2, не виден
    ]
    const route = makeRoute(steps, 1)
    const next = markStepDone(route, 'r1')
    expect(next.steps.find(s => s.id === 'r2')?.status).toBe('locked')
  })

  it('unknown stepId is a no-op (returns an equal route)', () => {
    const steps = [makeStep({ id: 'r1', status: 'current' })]
    const route = makeRoute(steps, 1)
    const next = markStepDone(route, 'does-not-exist')
    expect(next).toEqual(route)
  })
})

describe('buildMockRoute', () => {
  it('uses the first cefr goal title as goalLabel', () => {
    const route = buildMockRoute({ kind: 'cefr', level: 'B1', ageBand: 25, goals: ['friends'], savedAt: new Date().toISOString() })
    expect(route.goalLabel).toBe('Friends')
    expect(route.v).toBe(1)
    expect(route.revealedBatches).toBe(1)
    expect(route.steps.length).toBeGreaterThan(0)
  })

  it('falls back to the default goal label for words pointA', () => {
    const route = buildMockRoute({ kind: 'words', words: ['cat', 'dog'], goals: [], source: 'upload', savedAt: new Date().toISOString() })
    expect(route.goalLabel).toBe('Friends без субтитров')
  })

  it('falls back to the default goal label when pointA is null', () => {
    const route = buildMockRoute(null)
    expect(route.goalLabel).toBe('Friends без субтитров')
  })

  it('the generated route has 15-20 steps summing to more than 30 hours (so batching is exercised)', () => {
    const route = buildMockRoute(null)
    const total = route.steps.reduce((sum, s) => sum + s.durationSec, 0)
    expect(total).toBeGreaterThan(30 * HOUR)
    expect(route.steps.length).toBeGreaterThanOrEqual(15)
    expect(route.steps.length).toBeLessThanOrEqual(20)
  })

  it('does not leak mutations back into the shared mock data (independent copies)', () => {
    const a = buildMockRoute(null)
    const b = buildMockRoute(null)
    const lastIdx = a.steps.length - 1
    expect(a.steps[lastIdx].status).not.toBe('done') // тыл маршрута ещё не пройден
    a.steps[lastIdx].status = 'done'
    expect(b.steps[lastIdx].status).not.toBe('done')
  })
})

// spliceReplaceFrom [ID:P-replace-video] — «Заменить видео»: сохраняет
// ПРЕФИКС (route.steps[0..k-1]) нетронутым, отбрасывает заменяемый шаг и
// всё после него, ставит на их место newSteps (результат buildRoute с
// point_a=текущий словарь). ОТЛИЧИЕ от handleRestructure (весь маршрут с
// нуля): здесь пройденное/current до k-й позиции остаётся как было.
describe('spliceReplaceFrom', () => {
  it('keeps the prefix (steps before k) untouched and appends newSteps in its place', () => {
    const steps = [
      makeStep({ id: 'route-step-0', status: 'done', title: 'Done1' }),
      makeStep({ id: 'route-step-1', status: 'current', title: 'Current' }),
      makeStep({ id: 'route-step-2', status: 'next', title: 'OldNext' }),
    ]
    const route = makeRoute(steps, 5) // уже раскрыто много батчей
    // Заменяем ТРЕТИЙ шаг (индекс 2, 'OldNext') — префикс из ДВУХ шагов
    // (Done1 + Current) остаётся как был, 'OldNext' и всё после него ушло.
    const newSteps = [makeStep({ id: 'route-step-0', title: 'New1', status: 'current' })]
    const next = spliceReplaceFrom(route, 2, newSteps)

    expect(next.steps).toHaveLength(3)
    expect(next.steps[0].title).toBe('Done1')
    expect(next.steps[0].status).toBe('done')
    expect(next.steps[1].title).toBe('Current') // префикс до k нетронут
    expect(next.steps[2].title).toBe('New1') // заменяемый шаг ушёл, вместо него — новый
  })

  it('renumbers ALL step ids sequentially (route-step-0..N-1) so new steps never collide with prefix ids', () => {
    const steps = [
      makeStep({ id: 'route-step-0', status: 'done' }),
      makeStep({ id: 'route-step-1', status: 'current' }),
    ]
    const route = makeRoute(steps, 1)
    // newSteps приходят от mapRouteSteps свежей суб-сборки — те же
    // id, что и у префикса (нумерация всегда начинается с 0 в builder'e).
    const newSteps = [
      makeStep({ id: 'route-step-0', title: 'New1' }),
      makeStep({ id: 'route-step-1', title: 'New2' }),
    ]
    const next = spliceReplaceFrom(route, 1, newSteps)

    const ids = next.steps.map(s => s.id)
    expect(new Set(ids).size).toBe(ids.length) // без дублей
    expect(ids).toEqual(['route-step-0', 'route-step-1', 'route-step-2'])
    expect(next.steps.map(s => s.title)).toEqual([steps[0].title, 'New1', 'New2'])
  })

  it('k=0 replaces the whole route (empty prefix) — same effect as a full restructure', () => {
    const steps = [makeStep({ id: 'route-step-0', status: 'current', title: 'Old' })]
    const route = makeRoute(steps, 1)
    const newSteps = [makeStep({ id: 'route-step-0', title: 'Brand new' })]
    const next = spliceReplaceFrom(route, 0, newSteps)

    expect(next.steps).toHaveLength(1)
    expect(next.steps[0].title).toBe('Brand new')
  })

  it('an empty build result (0 new steps) leaves just the prefix — same "target reached" path as handleRestructure', () => {
    const steps = [
      makeStep({ id: 'route-step-0', status: 'done' }),
      makeStep({ id: 'route-step-1', status: 'current' }),
    ]
    const route = makeRoute(steps, 1)
    const next = spliceReplaceFrom(route, 1, [])
    expect(next.steps).toHaveLength(1)
    expect(next.steps[0].status).toBe('done')
  })

  it('recomputes statuses like markStepDone: first not-done visible step becomes current, rest visible next, prefix "done" stays done', () => {
    const steps = [
      makeStep({ id: 'route-step-0', status: 'done', durationSec: 10 * 60 }),
      makeStep({ id: 'route-step-1', status: 'current', durationSec: 10 * 60 }),
    ]
    const route = makeRoute(steps, 1) // батч 1 раскрыт
    // Заменяем route-step-1 (current) двумя новыми шагами.
    const newSteps = [
      makeStep({ id: 'route-step-0', title: 'New1', durationSec: 10 * 60 }),
      makeStep({ id: 'route-step-1', title: 'New2', durationSec: 10 * 60 }),
    ]
    const next = spliceReplaceFrom(route, 1, newSteps)

    expect(next.steps[0].status).toBe('done') // префикс не тронут
    expect(next.steps[1].status).toBe('current') // первый не-done видимый
    expect(next.steps[2].status).toBe('next')
  })

  it('a not-yet-visible replacement (batches beyond revealedBatches) is left locked, not current', () => {
    const steps = [makeStep({ id: 'route-step-0', status: 'current', durationSec: HOUR })]
    const route = makeRoute(steps, 1)
    // Новый хвост длиннее батча — второй шаг уходит за пределы revealedBatches.
    const newSteps = [
      makeStep({ id: 'route-step-0', title: 'New1', durationSec: HOUR }),
      makeStep({ id: 'route-step-1', title: 'New2', durationSec: HOUR }),
    ]
    const next = spliceReplaceFrom(route, 0, newSteps)
    expect(next.revealedBatches).toBe(1) // первый новый шаг уже помещается в батч 1
    expect(next.steps[1].status).toBe('locked')
  })

  it('bumps revealedBatches (via max, never shrinking what was already revealed) so the first new step is guaranteed visible', () => {
    const steps = [
      makeStep({ id: 'route-step-0', status: 'done', durationSec: HOUR }),
      makeStep({ id: 'route-step-1', status: 'current', durationSec: HOUR }),
    ]
    const route = makeRoute(steps, 1) // только батч 1 раскрыт
    // Заменяем route-step-1 (батч 2) — новый шаг должен стать видимым.
    const newSteps = [makeStep({ id: 'route-step-0', title: 'New1', durationSec: HOUR })]
    const next = spliceReplaceFrom(route, 1, newSteps)
    expect(next.revealedBatches).toBeGreaterThanOrEqual(2)
    expect(visibleSteps(next).some(s => s.title === 'New1')).toBe(true)
  })

  it('clamps out-of-range k (negative → 0, beyond length → append) instead of the silent slice-from-end bug', () => {
    const steps = [
      makeStep({ id: 'route-step-0', status: 'done', title: 'A' }),
      makeStep({ id: 'route-step-1', status: 'current', title: 'B' }),
    ]
    const route = makeRoute(steps, 1)
    const nw = [makeStep({ id: 'route-step-0', title: 'New' })]
    // Отрицательный k → как 0 (полная замена, пустой префикс), НЕ slice(0,-1).
    expect(spliceReplaceFrom(route, -1, nw).steps.map(s => s.title)).toEqual(['New'])
    // k больше длины → префикс = весь маршрут, новые шаги в хвост.
    expect(spliceReplaceFrom(route, 99, nw).steps.map(s => s.title)).toEqual(['A', 'B', 'New'])
  })

  it('preserves goalLabel and settings from the original route (not from the build)', () => {
    const route = makeRoute([makeStep({ id: 'route-step-0', status: 'current' })], 1)
    const next = spliceReplaceFrom(route, 0, [makeStep({ id: 'route-step-0' })])
    expect(next.goalLabel).toBe(route.goalLabel)
    expect(next.settings).toEqual(route.settings)
  })
})

// addExcludedVideo [ID:P-exclude-video] — накопление отклонённых видео маршрута
// с дедупом по videoId и «липким» blockChannel.
describe('addExcludedVideo', () => {
  it('adds a new videoId with its blockChannel flag to an empty/undefined list', () => {
    expect(addExcludedVideo(undefined, 'vid00000001', false)).toEqual([
      { videoId: 'vid00000001', blockChannel: false },
    ])
    expect(addExcludedVideo([], 'vid00000002', true)).toEqual([
      { videoId: 'vid00000002', blockChannel: true },
    ])
  })

  it('dedups by videoId — replacing the same video twice does not grow the list', () => {
    const once = addExcludedVideo(undefined, 'vidAAAA0001', false)
    const twice = addExcludedVideo(once, 'vidAAAA0001', false)
    expect(twice).toHaveLength(1)
  })

  it('blockChannel is STICKY: once true, a later replace without the flag keeps it true', () => {
    const withChannel = addExcludedVideo(undefined, 'vidAAAA0001', true)
    const again = addExcludedVideo(withChannel, 'vidAAAA0001', false)
    expect(again).toEqual([{ videoId: 'vidAAAA0001', blockChannel: true }])
  })

  it('blockChannel UPGRADES false→true when a later replace checks the box', () => {
    const noChannel = addExcludedVideo(undefined, 'vidAAAA0001', false)
    const upgraded = addExcludedVideo(noChannel, 'vidAAAA0001', true)
    expect(upgraded).toEqual([{ videoId: 'vidAAAA0001', blockChannel: true }])
  })

  it('ignores null/empty videoId (video без id заменить нельзя — в исключениях ему не место)', () => {
    expect(addExcludedVideo(undefined, null, true)).toEqual([])
    expect(addExcludedVideo([{ videoId: 'vid00000001', blockChannel: false }], '', true)).toEqual([
      { videoId: 'vid00000001', blockChannel: false },
    ])
  })

  it('accumulates distinct videos and preserves order', () => {
    let list = addExcludedVideo(undefined, 'vid00000001', false)
    list = addExcludedVideo(list, 'vid00000002', true)
    list = addExcludedVideo(list, 'vid00000003', false)
    expect(list.map(e => e.videoId)).toEqual(['vid00000001', 'vid00000002', 'vid00000003'])
    expect(list.filter(e => e.blockChannel).map(e => e.videoId)).toEqual(['vid00000002'])
  })
})
