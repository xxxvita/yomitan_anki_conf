// annotation-store.test.ts — T-A (A1) TDD: LocalAnnotationStore round-trip +
// empty-key vs corrupt-JSON distinction (G1-strict, see task-A-brief.md).
// localStorage polyfill lives in vitest.setup.ts (Node 22+ shadow-global fix).
import { describe, it, expect, beforeEach } from 'vitest'
import { LocalAnnotationStore, AnnotationStoreCorruptError } from '../annotation-store'
import type { ShadowExerciseAnnotation } from '../panel-types'

const KEY = (videoKey: string) => `flib:shadow-exercises:${videoKey}`

function mkAnn(overrides: Partial<ShadowExerciseAnnotation> = {}): ShadowExerciseAnnotation {
  return {
    id: 'e1',
    startTime: 1,
    endTime: 5,
    anchorMode: 'subtitle',
    subIndex: 2,
    settings: {
      loopMode: true,
      advanceEnabled: true,
      advanceThreshold: 80,
      mode: 'subtitle',
      saveAudio: false,
      engines: { asr: 'whisper-local', check: 'llm-local', ocr: 'llm-local' },
    },
    createdAt: '2026-07-06T00:00:00.000Z',
    updatedAt: '2026-07-06T00:00:00.000Z',
    ...overrides,
  }
}

beforeEach(() => { localStorage.clear() })

describe('LocalAnnotationStore', () => {
  it('save() then load() round-trips the annotation list', () => {
    const store = new LocalAnnotationStore()
    const anns = [mkAnn(), mkAnn({ id: 'e2', subIndex: 3 })]
    store.save('vid1', anns)
    expect(store.load('vid1')).toEqual(anns)
  })

  it('load() on a key with no data (never saved) returns [] — not corrupt', () => {
    const store = new LocalAnnotationStore()
    expect(store.load('never-saved-vid')).toEqual([])
    expect(localStorage.getItem(KEY('never-saved-vid'))).toBeNull()
  })

  it('load() on corrupt JSON throws (G1-strict) — does NOT silently return []', () => {
    localStorage.setItem(KEY('vid-corrupt'), '{not json')
    const store = new LocalAnnotationStore()
    expect(() => store.load('vid-corrupt')).toThrow(AnnotationStoreCorruptError)
  })

  it('load() on valid JSON that is not an array throws (G1-strict)', () => {
    localStorage.setItem(KEY('vid-shape'), JSON.stringify({ not: 'an array' }))
    const store = new LocalAnnotationStore()
    expect(() => store.load('vid-shape')).toThrow(AnnotationStoreCorruptError)
  })

  it('uses the flib:shadow-exercises:<videoKey> key convention', () => {
    const store = new LocalAnnotationStore()
    store.save('myVideo', [mkAnn()])
    expect(localStorage.getItem(KEY('myVideo'))).not.toBeNull()
  })
})
