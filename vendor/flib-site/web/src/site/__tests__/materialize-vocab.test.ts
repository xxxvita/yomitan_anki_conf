// materialize-vocab.test.ts — TDD для Phase 2, п.C: материализация точки А
// в flib:vocab при успешной сборке маршрута. Пишется ДО materialize-vocab.ts
// (Pre-Write Protocol: тесты сначала).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { materializeVocabFromPointA } from '../materialize-vocab'
import { loadVocab } from '../vocab'
import type { PointA } from '../pointA'

function cefrPointA(level = 'A2'): PointA {
  return { kind: 'cefr', level, ageBand: 20, goals: ['friends'], savedAt: new Date().toISOString() }
}

function wordsPointA(overrides: Partial<Extract<PointA, { kind: 'words' }>> = {}): PointA {
  return { kind: 'words', words: ['cat', 'dog'], goals: ['friends'], source: 'upload', savedAt: new Date().toISOString(), ...overrides }
}

describe('materializeVocabFromPointA', () => {
  beforeEach(() => { window.localStorage.clear() })
  afterEach(() => { vi.unstubAllGlobals() })

  it('kind=words: добавляет pointA.words в vocab с source=pointA.source', async () => {
    await materializeVocabFromPointA(wordsPointA({ source: 'upload' }))
    const v = loadVocab()
    expect(Object.keys(v.words).sort()).toEqual(['cat', 'dog'])
    expect(v.words.cat.source).toBe('upload')
  })

  it('kind=words, source=test (прошёл тест) — тот же source уходит в vocab, не хардкод upload', async () => {
    await materializeVocabFromPointA(wordsPointA({ source: 'test' }))
    expect(loadVocab().words.cat.source).toBe('test')
  })

  it('kind=cefr: фетчит /api/dicts/cefr/<level> и добавляет слова с source=cefr', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ words: ['hello', 'world'] }) })
    vi.stubGlobal('fetch', fetchMock)

    await materializeVocabFromPointA(cefrPointA('A2'))

    expect(fetchMock).toHaveBeenCalledWith('/api/dicts/cefr/A2')
    const v = loadVocab()
    expect(Object.keys(v.words).sort()).toEqual(['hello', 'world'])
    expect(v.words.hello.source).toBe('cefr')
  })

  it('kind=cefr: 4xx/5xx от бэка — best-effort, не бросает, словарь не трогается', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({}) }))
    await expect(materializeVocabFromPointA(cefrPointA())).resolves.toBeUndefined()
    expect(loadVocab().words).toEqual({})
  })

  it('kind=cefr: сеть недоступна (fetch кидает) — best-effort, не бросает', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    await expect(materializeVocabFromPointA(cefrPointA())).resolves.toBeUndefined()
    expect(loadVocab().words).toEqual({})
  })

  it('kind=cefr: сервер вернул неожиданный формат (words не массив) — best-effort, не бросает', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ words: 'not-an-array' }) }))
    await expect(materializeVocabFromPointA(cefrPointA())).resolves.toBeUndefined()
    expect(loadVocab().words).toEqual({})
  })
})
