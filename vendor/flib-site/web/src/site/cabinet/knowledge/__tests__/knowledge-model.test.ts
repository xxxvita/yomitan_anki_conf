import { describe, it, expect } from 'vitest'
import type { ApiError } from '../../route/route-api'
import { batches, classifyAnalyze, describeAnalyzeError, describeSaveError, pageCount, pageSlice, statusLabel, utf8Bytes, youtubeVideoId, YOUTUBE_LINK_HINT } from '../knowledge-model'

const err = (status: number, code: string | null, body: Record<string, unknown> | null = null, retryAfterSec: number | null = null): ApiError =>
  ({ ok: false, status, code, retryAfterSec, cls: 'other', body })

describe('describeAnalyzeError', () => {
  it('YouTube без субтитров предлагает программу и не предлагает повтор', () => {
    const f = describeAnalyzeError(err(422, 'youtube_unavailable'))
    expect(f.offerApp).toBe(true)
    expect(f.retry).toBe(false)
    expect(f.text).toContain('В программе Flibooster такие ролики разбираются целиком')
  })
  it('сбой получения субтитров (503, retryable) — предложение программы И «Повторить», не текст про анализатор', () => {
    const f = describeAnalyzeError(err(503, 'youtube_unavailable', { retryable: true }))
    expect(f.offerApp).toBe(true)
    expect(f.retry).toBe(true)
    expect(f.text).not.toContain('разбора слов')
  })
  it('сбой самого анализатора и сбой шлюза — разные тексты', () => {
    expect(describeAnalyzeError(err(503, 'analyzer_unavailable')).text).toContain('разбора слов')
    expect(describeAnalyzeError(err(502, 'gateway_unavailable')).text).not.toContain('разбора слов')
  })
  it('bad_youtube_url — текст макета', () => {
    expect(describeAnalyzeError(err(400, 'bad_youtube_url')).text).toBe(YOUTUBE_LINK_HINT)
    expect(YOUTUBE_LINK_HINT).toBe('Нужна ссылка на ролик YouTube')
  })
  it('дневной лимит: число из ответа, без повтора', () => {
    const f = describeAnalyzeError(err(429, 'daily_limit', { limit: 20, used: 20 }))
    expect(f.text).toContain('20 в день')
    expect(f.retry).toBe(false)
  })
  it('слишком большой текст', () => {
    expect(describeAnalyzeError(err(413, 'text_too_large')).text).toContain('больше 200 КБ')
    expect(describeAnalyzeError(err(413, 'body_too_large')).retry).toBe(false)
  })
  it('сервер занят / таймаут / недоступен — повтор уместен', () => {
    for (const c of ['analyzer_timeout', 'analyzer_unavailable', 'gateway_unavailable', 'busy']) {
      expect(describeAnalyzeError(err(503, c)).retry).toBe(true)
    }
  })
  it('сеть и неизвестные коды', () => {
    expect(describeAnalyzeError(err(0, null)).code).toBe('network')
    expect(describeAnalyzeError(err(500, 'weird')).retry).toBe(true)
  })
  it('429 берёт паузу из Retry-After', () => {
    expect(describeAnalyzeError(err(429, 'rate_limited', null, 30)).text).toContain('через 30 с')
    expect(describeAnalyzeError(err(429, 'route_banned', null, 600)).text).toContain('через 10 мин')
  })
  it('401 — перечитать сессию', () => {
    expect(describeAnalyzeError(err(401, 'no_session')).session).toBe(true)
  })
})

describe('describeSaveError', () => {
  it('коды записи', () => {
    expect(describeSaveError(err(413, 'too_many_words')).retry).toBe(false)
    // «предел 200 000» — только когда упёрлись в предел словаря
    expect(describeSaveError(err(413, 'too_many_words', { scope: 'profile', limit: 200000 })).text).toContain('200')
    expect(describeSaveError(err(413, 'too_many_words', { scope: 'request', limit: 20000 })).text).not.toContain('200')
    expect(describeSaveError(err(409, 'busy')).retry).toBe(true)
    expect(describeSaveError(err(0, null)).code).toBe('network')
    expect(describeSaveError(err(401, 'session_invalid')).session).toBe(true)
  })
})

describe('classifyAnalyze', () => {
  it('нет английских слов / всё известно / список', () => {
    expect(classifyAnalyze({ new_words: [], token_count: 0 }).s).toBe('no_words')
    expect(classifyAnalyze({ new_words: [], token_count: 5 }).s).toBe('all_known')
    expect(classifyAnalyze({ new_words: [{ lemma: 'a', kind: 'word', forms: [] }], token_count: 5 }).s).toBe('ready')
  })
})

describe('youtubeVideoId', () => {
  it('ссылки и мусор', () => {
    expect(youtubeVideoId(' https://youtu.be/dQw4w9WgXcQ?t=7 ')).toBe('dQw4w9WgXcQ')
    expect(youtubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLx')).toBe('dQw4w9WgXcQ')
    expect(youtubeVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(youtubeVideoId('привет')).toBeNull()
    expect(youtubeVideoId('https://www.youtube.com/playlist?list=PLx')).toBeNull()
  })
})

describe('страницы и пачки', () => {
  it('pageCount / pageSlice', () => {
    expect(pageCount(0)).toBe(1)
    expect(pageCount(50)).toBe(1)
    expect(pageCount(51)).toBe(2)
    const items = Array.from({ length: 120 }, (_, i) => i)
    expect(pageSlice(items, 2)).toHaveLength(20)
    expect(pageSlice(items, 0)[0]).toBe(0)
  })
  it('batches', () => {
    expect(batches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(batches([], 2)).toEqual([])
  })
  it('utf8Bytes считает байты, не символы', () => {
    expect(utf8Bytes('abc')).toBe(3)
    expect(utf8Bytes('привет')).toBe(12)
  })
  it('statusLabel', () => {
    expect(statusLabel('known_offanki')).toBe('знаю')
    expect(statusLabel('mature')).toBe('знаю')
    expect(statusLabel('learning')).toBe('учу')
  })
})
