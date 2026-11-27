// vocab.test.ts — TDD для словаря пользователя в localStorage (Phase 2, п.A).
// Пишется ДО vocab.ts (Pre-Write Protocol: тесты сначала).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  loadVocab, addWords, importWords, exportKnoWords, vocabCount, clearVocab,
} from '../vocab'

describe('vocab.ts — flib:vocab', () => {
  beforeEach(() => { window.localStorage.clear() })

  it('loadVocab returns empty state when nothing is stored', () => {
    const v = loadVocab()
    expect(v.words).toEqual({})
    expect(typeof v.updated_at).toBe('string')
  })

  it('loadVocab returns empty state on corrupt JSON (лениво, не падает)', () => {
    window.localStorage.setItem('flib:vocab', '{not json')
    const v = loadVocab()
    expect(v.words).toEqual({})
  })

  it('loadVocab returns empty state on a foreign schema in the same key', () => {
    window.localStorage.setItem('flib:vocab', JSON.stringify({ foo: 'bar' }))
    const v = loadVocab()
    expect(v.words).toEqual({})
  })

  it('addWords adds new words with source and added_at', () => {
    const before = new Date().toISOString()
    const v = addWords(['cat', 'dog'], 'learned')
    expect(Object.keys(v.words).sort()).toEqual(['cat', 'dog'])
    expect(v.words.cat.source).toBe('learned')
    expect(v.words.cat.added_at >= before).toBe(true)
  })

  it('addWords persists across loadVocab calls', () => {
    addWords(['cat'], 'learned')
    const v = loadVocab()
    expect(v.words.cat).toBeTruthy()
  })

  it('addWords dedups within one call (repeated word in the input array)', () => {
    const v = addWords(['cat', 'cat', 'Cat'], 'learned')
    expect(Object.keys(v.words)).toEqual(['cat'])
  })

  it('addWords normalizes case (Cat/CAT/cat collide to one entry)', () => {
    addWords(['Cat'], 'learned')
    const v = addWords(['CAT', 'cat'], 'learned')
    expect(Object.keys(v.words)).toEqual(['cat'])
  })

  it('addWords does NOT overwrite added_at/source of an already-known word', () => {
    const first = addWords(['cat'], 'learned')
    const firstAddedAt = first.words.cat.added_at
    const second = addWords(['cat'], 'cefr')
    expect(second.words.cat.added_at).toBe(firstAddedAt)
    expect(second.words.cat.source).toBe('learned')
  })

  it('addWords on an empty array is a no-op (no write, state unchanged)', () => {
    const before = loadVocab()
    const v = addWords([], 'learned')
    expect(v).toEqual(before)
  })

  it('addWords skips blank/whitespace-only tokens', () => {
    const v = addWords(['', '   ', 'cat'], 'learned')
    expect(Object.keys(v.words)).toEqual(['cat'])
  })

  it('addWords updates updated_at only when something new was actually added', () => {
    const v1 = addWords(['cat'], 'learned')
    const v2 = addWords(['cat'], 'learned') // всё уже есть — no-op
    expect(v2.updated_at).toBe(v1.updated_at)
  })

  it('importWords behaves like addWords (same dedup/persist contract)', () => {
    importWords(['fox', 'owl'], 'upload')
    const v = loadVocab()
    expect(v.words.fox.source).toBe('upload')
    expect(v.words.owl.source).toBe('upload')
  })

  it('exportKnoWords round-trips: array of {word, added_at, source}', () => {
    addWords(['cat', 'dog'], 'learned')
    const exported = exportKnoWords()
    expect(exported).toHaveLength(2)
    for (const entry of exported) {
      expect(typeof entry.word).toBe('string')
      expect(typeof entry.added_at).toBe('string')
      expect(typeof entry.source).toBe('string')
    }
    expect(exported.map(e => e.word).sort()).toEqual(['cat', 'dog'])
  })

  it('exportKnoWords on an empty vocab returns []', () => {
    expect(exportKnoWords()).toEqual([])
  })

  it('vocabCount reflects the number of distinct words', () => {
    expect(vocabCount()).toBe(0)
    addWords(['cat', 'dog', 'cat'], 'learned')
    expect(vocabCount()).toBe(2)
  })

  it('clearVocab removes the key entirely', () => {
    addWords(['cat'], 'learned')
    clearVocab()
    expect(vocabCount()).toBe(0)
    expect(window.localStorage.getItem('flib:vocab')).toBeNull()
  })

  it('addWords swallows QuotaExceededError from localStorage.setItem безопасно', () => {
    const spy = vi.spyOn(window.localStorage.__proto__, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError')
    })
    // Не должен бросить — и всё равно возвращает корректный in-memory результат
    // ДЛЯ ЭТОГО вызова (тот же принцип, что saveRoute), даже если запись физически
    // не удалась. Персист не переживает вызов (это ожидаемо — нет клиентского кэша).
    let v: ReturnType<typeof addWords> | undefined
    expect(() => { v = addWords(['cat'], 'learned') }).not.toThrow()
    expect(v?.words.cat).toBeTruthy()
    spy.mockRestore()
    // После восстановления setItem реальная запись не переживший quota-сбой
    // вызов не оставил следов — loadVocab с диска пуст (честно, не соврал).
    expect(loadVocab().words.cat).toBeUndefined()
  })
})
