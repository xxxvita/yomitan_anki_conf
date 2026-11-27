// knowledge-api.ts — клиент `/api/me/knowledge/*` («Мои знания», кабинет).
// Ключа здесь нет: его держит cookie сессии, BFF ходит на шлюз сам.
import { apiCall, LONG_TIMEOUT_MS, type ApiDeps, type ApiResult } from '../route/route-api'

export type WordKind = 'word' | 'phrase' | 'idiom'
// lemma — то, что сохраняется (словарная форма); forms — подсказка (найденная в тексте форма и другие).
export interface NewWord { lemma: string; kind: WordKind; forms: string[] }
export interface AnalyzeOk {
  new_words: NewWord[]; token_count: number
  truncated?: boolean // субтитры длинного ролика обрезаны по потолку текста
  quota?: { used: number; limit: number }
}
export type AnalyzeInput = { text: string } | { youtube_url: string }

export interface SaveSource { kind: 'text' | 'youtube'; title: string; video_id?: string }
export interface SaveOk { added: number; total: number; skipped?: number }

export interface WordRow { lemma: string; status: string }
export interface WordsPage { total: number; matched: number; offset: number; items: WordRow[] }

export const SAVE_BATCH = 20_000 // потолок слов в одном save (BFF: knowledgeMaxWordsInSave)

export function analyze(input: AnalyzeInput, deps?: ApiDeps): Promise<ApiResult<AnalyzeOk>> {
  return apiCall<AnalyzeOk>('POST', '/api/me/knowledge/analyze', { body: input, timeoutMs: LONG_TIMEOUT_MS, deps })
}

// kinds — вид у фраз и идиом (у приложения такие слова пишутся с chunk).
export function saveWords(lemmas: string[], source: SaveSource, kinds?: Record<string, WordKind>, deps?: ApiDeps): Promise<ApiResult<SaveOk>> {
  return apiCall<SaveOk>('POST', '/api/me/knowledge/save', { body: { lemmas, ...(kinds && Object.keys(kinds).length ? { kinds } : {}), source }, deps })
}

export function fetchWords(p: { q: string; offset: number; limit: number }, deps?: ApiDeps): Promise<ApiResult<WordsPage>> {
  const qs = new URLSearchParams({ offset: String(p.offset), limit: String(p.limit) })
  if (p.q) qs.set('q', p.q)
  return apiCall<WordsPage>('GET', `/api/me/knowledge/words?${qs.toString()}`, { deps })
}
