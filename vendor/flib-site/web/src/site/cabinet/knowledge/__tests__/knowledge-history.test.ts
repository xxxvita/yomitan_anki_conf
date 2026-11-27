import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { addHistory, clearAllKnowledgeHistory, clearHistory, historyKey, HISTORY_KEY_BASE, HISTORY_MAX, readHistory, textTitle } from '../knowledge-history'

const P = 'tpk_abcd'
const HISTORY_KEY = historyKey(P)

const entry = (n: number) => ({ kind: 'text' as const, title: `t${n}`, at: '2026-11-20T10:00:00Z', added: n })

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('knowledge-history', () => {
  it('пишет сверху и читает обратно', () => {
    addHistory(P, entry(1)); addHistory(P, entry(2))
    expect(readHistory(P).map(e => e.added)).toEqual([2, 1])
  })
  it('не больше 100 записей', () => {
    for (let i = 0; i < HISTORY_MAX + 20; i++) addHistory(P, entry(i))
    const h = readHistory(P)
    expect(h).toHaveLength(HISTORY_MAX)
    expect(h[0].added).toBe(HISTORY_MAX + 19)
  })
  it('в хранилище не массив, битый JSON, мусорные записи — страница живёт', () => {
    localStorage.setItem(HISTORY_KEY, '{"a":1}')
    expect(readHistory(P)).toEqual([])
    localStorage.setItem(HISTORY_KEY, 'not json')
    expect(readHistory(P)).toEqual([])
    localStorage.setItem(HISTORY_KEY, JSON.stringify([entry(1), null, 5, { kind: 'x' }, { ...entry(2), video_id: '<bad>' }, { ...entry(3), at: 'не дата' }]))
    expect(readHistory(P).map(e => e.added)).toEqual([1])
  })
  it('getItem бросает (запрещённое хранилище) — пустой список без падения', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    expect(readHistory(P)).toEqual([])
  })
  it('setItem бросает (квота) — addHistory возвращает список и не падает', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError') })
    expect(addHistory(P, entry(7))[0].added).toBe(7)
    expect(() => clearHistory(P)).not.toThrow()
  })
  it('история по ключу: другой ключ чужих источников не видит', () => {
    addHistory(P, entry(1))
    expect(readHistory('tpk_zzzz')).toEqual([])
    addHistory('tpk_zzzz', entry(2))
    expect(readHistory(P).map(e => e.added)).toEqual([1])
  })
  it('«Выход»: стираются истории всех ключей и прежний ключ без привязки, чужое остаётся', () => {
    addHistory(P, entry(1)); addHistory('tpk_zzzz', entry(2))
    localStorage.setItem(HISTORY_KEY_BASE, '[]')
    localStorage.setItem('flib:other', 'keep')
    clearAllKnowledgeHistory()
    expect(readHistory(P)).toEqual([]); expect(readHistory('tpk_zzzz')).toEqual([])
    expect(localStorage.getItem(HISTORY_KEY_BASE)).toBeNull()
    expect(localStorage.getItem('flib:other')).toBe('keep')
  })
  it('textTitle', () => {
    expect(textTitle('   ')).toBe('Текст')
    expect(textTitle('Hello\n  world')).toBe('Hello world')
    expect(textTitle('x'.repeat(100))).toHaveLength(61)
  })
})
