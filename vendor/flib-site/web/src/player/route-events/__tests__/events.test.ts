// events.test.ts — чистые модули событий (план B8a): строка таблицы
// сопоставления §4.8 — тест, правило полей шлюза — тест, таблица `subs_report`
// (вкл. `heard_max`), `played_frac` только не при `full`, деградация > 240 КиБ,
// потолок услышанных реплик (M3), дедуп, `subs_source`, доля по правилу демона.
import { describe, it, expect } from 'vitest'
import { завестиСчётчик, шаг, ключСнимка, сбросить, type Реплика, type Счётчик } from '../subtitle-counter'
import { buildClipPlayed, clipShare, wordsLessonClipPlayed, __spanUnion, CLIP_PLAYED_DEGRADE_BYTES, type ProgressInfo } from '../clip-played'
import {
  clipRatedEvent, clipReplayedEvent, clipboardCopyEvent, envelope, hintRequestedEvent, lineTranslatedEvent,
  subsSourceOf, subtitlesShownEvent, CLIP_DISLIKE_REASONS, type SiteEvent,
} from '../mapper'
import { WordEventMemory } from '../word-events'
import { MAX_HEARD_PER_REPORT } from '../../../site/cabinet/route/line-credit'

const PID = 'youtube::abcdefghijk'
const ENV = envelope('2026-11-18', new Date('2026-11-18T10:00:00Z'), 'web:00000000-0000-4000-8000-000000000001')
const enc = new TextEncoder()
const size = (v: unknown) => enc.encode(JSON.stringify(v)).length

const CUES: Реплика[] = [0, 1, 2, 3, 4].map(i => ({ start: i * 10, end: i * 10 + 10, text: `Line Number ${i} here` }))
const snap = (cues: Реплика[] = CUES) => ({ puzzleID: PID, ключ: ключСнимка(cues), реплики: cues })

// play — непрерывный ход от from до to шагом 0,25 с.
function play(c: Счётчик, from: number, to: number): Счётчик {
  let x = c
  for (let t = from; t <= to + 1e-9; t += 0.25) x = шаг(x, { время: t, сдвиг: 0, идётПеремотка: false, ставка: 1 })
  return x
}

const NOT_FOUND: ProgressInfo = { kind: 'not_found', heardMax: 0 }

// Правила полей шлюза (GW/internal/routestate/events.go) — общая проверка любого события.
function assertGatewayRules(ev: SiteEvent): void {
  expect(ev.event_id).toMatch(/^[A-Za-z0-9._:-]{1,128}$/)
  expect(ev.event_id.startsWith('ext:')).toBe(false)
  expect(typeof ev.puzzle_id).toBe('string')
  expect(ev.learning_day).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  expect(Number.isNaN(Date.parse(ev.client_ts))).toBe(false)
  if (Array.isArray(ev.lemmas)) for (const w of ev.lemmas as string[]) { expect(w).not.toBe(''); expect(w).toBe(w.toLowerCase()) }
  if (ev.sub_ref !== undefined) expect(['subtitles_shown', 'clip_replayed', 'word_marked_unheard']).toContain(ev.type)
  if (ev.subs_heard !== undefined || ev.subs_unheard !== undefined || ev.subs_report !== undefined) expect(ev.type).toBe('clip_played')
  expect(ev.native_track_on).toBeUndefined()
  if (ev.rating !== undefined || ev.rate_reason !== undefined) expect(ev.type).toBe('clip_rated')
  if (ev.type === 'clip_played') {
    expect(size(ev)).toBeLessThanOrEqual(256 * 1024)
    const heard = (ev.subs_heard ?? []) as Array<Record<string, number | string>>
    const unheard = (ev.subs_unheard ?? []) as Array<Record<string, number | string>>
    const refs = [...heard, ...unheard].map(x => x.sub_ref)
    expect(new Set(refs).size).toBe(refs.length)
    for (const x of [...heard, ...unheard]) {
      expect(x.sub_ref).not.toBe('')
      for (const f of ['from_ms', 'to_ms']) expect(Number.isInteger(x[f])).toBe(true)
      expect(x.from_ms as number).toBeGreaterThanOrEqual(0)
      expect(x.to_ms as number).toBeGreaterThanOrEqual(x.from_ms as number)
    }
    for (const h of heard) { expect(Number.isInteger(h.count)).toBe(true); expect(h.count as number).toBeGreaterThanOrEqual(0); expect(h.rate_min === 0 || (h.rate_min as number) > 0).toBe(true) }
    if (ev.subs_report === 'full') expect(ev.played_frac).toBeUndefined()
    else expect(typeof ev.played_frac).toBe('number')
    if (ev.subs_report === undefined || ev.subs_report === 'absent') { expect(ev.subs_heard).toBeUndefined(); expect(ev.subs_unheard).toBeUndefined() }
  } else {
    expect(size(ev)).toBeLessThanOrEqual(16 * 1024)
  }
}

describe('таблица subs_report (§4.8)', () => {
  it('дорожка получена и пуста → absent, массивов нет, played_frac есть', () => {
    const { event } = buildClipPlayed({ puzzleId: PID, counter: null, trackResolved: true, frac: 0.81234, progress: NOT_FOUND, subsSource: 'server' }, ENV)
    expect(event.subs_report).toBe('absent')
    expect(event.played_frac).toBe(0.812)
    assertGatewayRules(event)
  })

  it('дорожка ещё не получена → "" (не absent)', () => {
    const { event } = buildClipPlayed({ puzzleId: PID, counter: null, trackResolved: false, frac: 0.5, progress: NOT_FOUND, subsSource: 'server' }, ENV)
    expect(event.subs_report).toBeUndefined()
    assertGatewayRules(event)
  })

  it('ни одна реплика не услышана → "", массивов нет, только played_frac', () => {
    const c = завестиСчётчик(snap())
    const { event } = buildClipPlayed({ puzzleId: PID, counter: play(c, 0, 5), trackResolved: true, frac: 0.1, progress: NOT_FOUND, subsSource: 'server' }, ENV)
    expect(event.subs_report).toBeUndefined()
    expect(event.subs_heard).toBeUndefined()
    expect(event.played_frac).toBe(0.1)
    assertGatewayRules(event)
  })

  it('счётчик не сбрасывался и progress = 404 → full без played_frac', () => {
    const { event } = buildClipPlayed({ puzzleId: PID, counter: play(завестиСчётчик(snap()), 0, 25), trackResolved: true, frac: 0.5, progress: NOT_FOUND, subsSource: 'server' }, ENV)
    expect(event.subs_report).toBe('full')
    expect(event.played_frac).toBeUndefined()
    expect((event.subs_heard as unknown[]).length).toBe(2)
    assertGatewayRules(event)
  })

  it('progress = 200 той же дорожки, счёт восстановлен → full', () => {
    const { event } = buildClipPlayed({ puzzleId: PID, counter: play(завестиСчётчик(snap()), 0, 25), trackResolved: true, frac: 0.5, progress: { kind: 'restored', heardMax: 2 }, subsSource: 'server' }, ENV)
    expect(event.subs_report).toBe('full')
  })

  for (const [name, progress] of [
    ['GET progress не удался', { kind: 'failed', heardMax: 0 }],
    ['дорожка другая', { kind: 'other', heardMax: 0 }],
    ['различных услышанных меньше heard_max', { kind: 'restored', heardMax: 3 }],
    ['прогресса нет вовсе', null],
  ] as Array<[string, ProgressInfo | null]>) {
    it(`${name} → partial с played_frac`, () => {
      const { event } = buildClipPlayed({ puzzleId: PID, counter: play(завестиСчётчик(snap()), 0, 25), trackResolved: true, frac: 0.5, progress, subsSource: 'server' }, ENV)
      expect(event.subs_report).toBe('partial')
      expect(event.played_frac).toBe(0.5)
      assertGatewayRules(event)
    })
  }

  it('счётчик сбрасывался → partial', () => {
    const c = play(сбросить(snap()), 0, 25)
    const { event } = buildClipPlayed({ puzzleId: PID, counter: c, trackResolved: true, frac: 0.5, progress: NOT_FOUND, subsSource: 'server' }, ENV)
    expect(event.subs_report).toBe('partial')
  })
})

describe('большой clip_played (I7) и потолок реплик (M3)', () => {
  function big(heardN: number, unheardN: number, words = 14): Счётчик {
    const cues: Реплика[] = Array.from({ length: heardN + unheardN }, (_, i) => ({
      start: i * 2, end: i * 2 + 1.5, text: Array.from({ length: words }, (_, k) => `word${(i * 7 + k) % 997}x`).join(' '),
    }))
    const c = завестиСчётчик(snap(cues))
    return { ...c, услышано: cues.map((_, i) => (i < heardN ? 1 : 0)), возвраты: cues.map((_, i) => (i < heardN ? 1 : 0)), минСтавка: cues.map((_, i) => (i < heardN ? 1 : 0)) }
  }

  it('> 240 КиБ → без lemmas и обязательно partial с played_frac', () => {
    const { event } = buildClipPlayed({ puzzleId: PID, counter: big(1000, 2000), trackResolved: true, frac: 0.7, progress: NOT_FOUND, subsSource: 'server' }, ENV)
    expect(event.subs_report).toBe('partial')
    expect(event.played_frac).toBe(0.7)
    expect((event.subs_heard as Array<Record<string, unknown>>).every(h => !('lemmas' in h))).toBe(true)
    expect(size(event)).toBeLessThanOrEqual(CLIP_PLAYED_DEGRADE_BYTES)
    expect(size(event)).toBeGreaterThan(16 * 1024)
    assertGatewayRules(event)
  })

  it('и без lemmas > 240 КиБ → "" без массивов, только played_frac', () => {
    const { event } = buildClipPlayed({ puzzleId: PID, counter: big(1000, 4500), trackResolved: true, frac: 0.7, progress: NOT_FOUND, subsSource: 'server' }, ENV)
    expect(event.subs_report).toBeUndefined()
    expect(event.subs_heard).toBeUndefined()
    expect(event.played_frac).toBe(0.7)
    assertGatewayRules(event)
  })

  it('услышано больше MAX_HEARD_PER_REPORT → без состава: одно событие не опустошит ведро шлюза', () => {
    const { event } = buildClipPlayed({ puzzleId: PID, counter: big(MAX_HEARD_PER_REPORT + 1, 0, 1), trackResolved: true, frac: 0.9, progress: NOT_FOUND, subsSource: 'server' }, ENV)
    expect(event.subs_report).toBeUndefined()
    expect(event.subs_heard).toBeUndefined()
    const ok = buildClipPlayed({ puzzleId: PID, counter: big(MAX_HEARD_PER_REPORT, 0, 1), trackResolved: true, frac: 0.9, progress: NOT_FOUND, subsSource: 'server' }, ENV)
    expect((ok.event.subs_heard as unknown[]).length).toBe(MAX_HEARD_PER_REPORT)
  })
})

describe('сопоставление сигналов (таблица §4.8)', () => {
  it('subtitles_shown: слово / строка, sub_ref c<i>, subs_kind 1, subs_lang en, без native_track_on', () => {
    const w = subtitlesShownEvent(PID, 12, ['Hello'], ENV)!
    expect(w).toMatchObject({ type: 'subtitles_shown', sub_ref: 'c12', subs_kind: 1, subs_lang: 'en', lemmas: ['hello'] })
    assertGatewayRules(w)
    const line = subtitlesShownEvent(PID, 3, ['Are', 'YOU', 'okay?'], ENV)!
    expect(line.lemmas).toEqual(['are', 'you', 'okay'])
    expect(subtitlesShownEvent(PID, 3, ['a'], ENV)).toBeNull()
  })

  it('hint_requested: одно слово, без sub_ref', () => {
    const e = hintRequestedEvent(PID, 'Controlled', ENV)!
    expect(e.lemmas).toEqual(['controlled'])
    expect(e.sub_ref).toBeUndefined()
    assertGatewayRules(e)
  })

  it('line_translated: слова строки, без sub_ref', () => {
    const e = lineTranslatedEvent(PID, "I don't KNOW, really", ENV)!
    expect(e.lemmas).toEqual(["don't", 'know', 'really'])
    expect(e.sub_ref).toBeUndefined()
    assertGatewayRules(e)
  })

  it('clip_replayed: слова текущей реплики', () => {
    const e = clipReplayedEvent(PID, 'Wait for it -- now', ENV)!
    expect(e.lemmas).toEqual(['wait', 'for', 'it', 'now'])
    expect(e.sub_ref).toBeUndefined()
    assertGatewayRules(e)
  })

  it('clipboard_copy: выделение; из русской строки — слова английской', () => {
    expect(clipboardCopyEvent(PID, 'Big Cat', { fromL1: false }, ENV)!.lemmas).toEqual(['big', 'cat'])
    expect(clipboardCopyEvent(PID, 'Большой кот', { fromL1: true, enLine: 'The big cat' }, ENV)!.lemmas).toEqual(['the', 'big', 'cat'])
    expect(clipboardCopyEvent(PID, 'Большой кот', { fromL1: false }, ENV)).toBeNull()
    assertGatewayRules(clipboardCopyEvent(PID, 'Big Cat', { fromL1: false }, ENV)!)
  })

  it('clip_rated: like без причины; dislike только с одним из 8 кодов; subs_source как передан', () => {
    const like = clipRatedEvent(PID, { rating: 'like', subsSource: '' }, ENV)!
    expect(like).toMatchObject({ rating: 'like', subs_source: '' })
    expect(like.rate_reason).toBeUndefined()
    for (const r of CLIP_DISLIKE_REASONS) expect(clipRatedEvent(PID, { rating: 'dislike', reason: r, subsSource: 'server:x' }, ENV)!.rate_reason).toBe(r)
    expect(clipRatedEvent(PID, { rating: 'dislike', subsSource: '' }, ENV)).toBeNull()
    expect(clipRatedEvent(PID, { rating: 'dislike', reason: 'boring', subsSource: '' }, ENV)).toBeNull()
    assertGatewayRules(like)
  })

  it('урок слов: puzzle_id строки, доля с 3 знаками, без subs_* и lemmas', () => {
    const e = wordsLessonClipPlayed('words::0123456789abcdef', 0.66666, ENV)
    expect(e).toEqual({ event_id: ENV.event_id, type: 'clip_played', puzzle_id: 'words::0123456789abcdef', played_frac: 0.667, learning_day: '2026-11-18', client_ts: ENV.client_ts })
    assertGatewayRules(e)
  })

  it('доля прижата к [0, 1]', () => {
    expect(wordsLessonClipPlayed('words::0123456789abcdef', 7, ENV).played_frac).toBe(1)
    expect(wordsLessonClipPlayed('words::0123456789abcdef', -1, ENV).played_frac).toBe(0)
    const { event } = buildClipPlayed({ puzzleId: PID, counter: null, trackResolved: true, frac: 1.7, progress: NOT_FOUND, subsSource: 'server' }, ENV)
    expect(event.played_frac).toBe(1)
  })

  it('subs_source: server:<X-Subtitle-Source> или server', () => {
    expect(subsSourceOf('daemon_align')).toBe('server:daemon_align')
    expect(subsSourceOf(null)).toBe('server')
    expect(subsSourceOf('Bad Value')).toBe('server')
    expect(subsSourceOf('a'.repeat(41))).toBe('server')
  })
})

describe('дедуп пословных событий', () => {
  it('subtitles_shown — раз на пару реплика+слово; line_translated — по локальному ключу; смена ролика сбрасывает', () => {
    const m = new WordEventMemory()
    expect(m.take('subtitles_shown', ['cat'], 'c1')).toEqual(['cat'])
    expect(m.take('subtitles_shown', ['cat'], 'c1')).toEqual([])
    expect(m.take('subtitles_shown', ['cat'], 'c2')).toEqual(['cat'])
    expect(m.take('line_translated', ['a', 'b'], 'c4')).toEqual(['a', 'b'])
    expect(m.take('line_translated', ['a', 'b'], 'c4')).toEqual([])
    expect(m.take('hint_requested', ['dog'])).toEqual(['dog'])
    expect(m.take('hint_requested', ['dog'])).toEqual([])
    m.forget()
    expect(m.take('hint_requested', ['dog'])).toEqual(['dog'])
  })
})

describe('доля по правилу демона (clipPlayedShare)', () => {
  const h = (from: number, to: number, r = String(from)) => ({ sub_ref: r, from_ms: from, to_ms: to })
  it('перекрытия считаются один раз', () => {
    expect(clipShare({ subs_report: 'full', subs_heard: [h(0, 6000)], subs_unheard: [h(3000, 9000, 'u')] })).toBeCloseTo(6000 / 9000)
    expect(clipShare({ subs_report: 'full', subs_heard: [h(0, 2000), h(500, 2000, 'b'), h(1000, 2000, 'c')], subs_unheard: [h(2000, 10000, 'u')] })).toBeCloseTo(0.2)
  })
  it('нулевые отрезки (даже смесь) — доля по числу реплик', () => {
    expect(clipShare({ subs_report: 'full', subs_heard: [h(100, 100), h(200, 200, 'b'), h(300, 300, 'c')], subs_unheard: [h(400, 500, 'u')] })).toBeCloseTo(0.75)
  })
  it('промежутки не речь', () => {
    expect(clipShare({ subs_report: 'full', subs_heard: [h(0, 1000), h(50000, 51000, 'b')], subs_unheard: [h(90000, 90500, 'u')] })).toBeCloseTo(2000 / 2500)
  })
  it('не full — played_frac', () => {
    expect(clipShare({ subs_report: 'partial', played_frac: 0.4, subs_heard: [h(0, 9000)], subs_unheard: [] })).toBe(0.4)
    expect(clipShare({ played_frac: 0.9 })).toBe(0.9)
  })
  it('spanUnion', () => {
    expect(__spanUnion([])).toBe(0)
    expect(__spanUnion([[0, 10], [5, 15], [20, 30]])).toBe(25)
  })
})
