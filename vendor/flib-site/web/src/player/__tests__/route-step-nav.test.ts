// route-step-nav.test.ts — TDD для Phase 2 п.B: пройденный шаг маршрута
// накапливает свои слова в flib:vocab (source='learned').
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NavigateFunction } from 'react-router-dom'
import { advanceRouteStep } from '../route-step-nav'
import { saveRoute, type RouteState, type RouteStep } from '../../site/route-state'
import { loadVocab } from '../../site/vocab'

function step(overrides: Partial<RouteStep> = {}): RouteStep {
  return {
    id: 'r1',
    kind: 'video',
    videoId: 'abcdefghijk',
    title: 'Step',
    source: 'Source',
    durationSec: 300,
    newLemmas: 2,
    words: [],
    status: 'current',
    ...overrides,
  }
}

function seedRoute(steps: RouteStep[]): RouteState {
  const route: RouteState = {
    v: 1,
    goalLabel: 'Friends без субтитров',
    steps,
    createdAt: new Date().toISOString(),
    settings: { profile: 'balance' },
    revealedBatches: 1,
  }
  saveRoute(route)
  return route
}

describe('advanceRouteStep — накопление слов пройденного шага (Phase 2, п.B)', () => {
  beforeEach(() => { window.localStorage.clear() })

  it('добавляет words пройденного video-шага в flib:vocab с source=learned', () => {
    seedRoute([step({ id: 'r1', words: ['just', "i'm", 'gonna'], status: 'current' })])
    advanceRouteStep('r1', vi.fn() as unknown as NavigateFunction)
    const vocab = loadVocab()
    expect(Object.keys(vocab.words).sort()).toEqual(['gonna', "i'm", 'just'])
    expect(vocab.words.just.source).toBe('learned')
  })

  it('шаг без слов (words: []) — валидный no-op, не падает', () => {
    seedRoute([step({ id: 'r1', words: [], status: 'current' })])
    expect(() => advanceRouteStep('r1', vi.fn() as unknown as NavigateFunction)).not.toThrow()
    expect(loadVocab().words).toEqual({})
  })

  it('неизвестный stepId — не падает, словарь не трогается (route есть, шага нет)', () => {
    seedRoute([step({ id: 'r1', words: ['cat'], status: 'current' })])
    advanceRouteStep('unknown-id', vi.fn() as unknown as NavigateFunction)
    expect(loadVocab().words).toEqual({})
  })

  it('маршрута нет вовсе — advanceRouteStep возвращает null, словарь не трогается', () => {
    const result = advanceRouteStep('r1', vi.fn() as unknown as NavigateFunction)
    expect(result).toBeNull()
    expect(loadVocab().words).toEqual({})
  })

  it('слова уже пройденного ранее шага не теряют added_at при повторном marking (дедуп из vocab.ts)', () => {
    seedRoute([step({ id: 'r1', words: ['cat'], status: 'current' })])
    advanceRouteStep('r1', vi.fn() as unknown as NavigateFunction)
    const first = loadVocab().words.cat.added_at
    // Повторный вызов на том же (уже done) шаге — стороны, вызывающие
    // advanceRouteStep, этого не делают в норме, но addWords сам по себе
    // идемпотентен по added_at — проверяем контракт напрямую.
    advanceRouteStep('r1', vi.fn() as unknown as NavigateFunction)
    expect(loadVocab().words.cat.added_at).toBe(first)
  })
})
