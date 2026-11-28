// extra-origin.test.ts — метка происхождения дополнительного ролика (спека extra-video §7, §9).
import { describe, it, expect } from 'vitest'
import { asExtraEvent, EXTRA_KINDS } from '../extra-origin'
import type { SiteEvent } from '../mapper'

const SEVEN = ['clip_played', 'subtitles_shown', 'hint_requested', 'translation_opened', 'word_added_to_dict', 'word_marked_unheard', 'line_translated']
const OTHER = ['clip_coverage', 'playback_rate_fitted', 'question_answered', 'clip_rated', 'clipboard_copy', 'clip_replayed']

const base = (type: string, extra: Record<string, unknown> = {}): SiteEvent => ({
  event_id: 'web:e1', type, puzzle_id: 'youtube::abcdefghijk', learning_day: '2026-11-24', client_ts: '2026-11-24T10:00:00.000Z', ...extra,
})

describe('asExtraEvent', () => {
  it('EXTRA_KINDS — ровно семь родов', () => {
    expect([...EXTRA_KINDS].sort()).toEqual([...SEVEN].sort())
  })
  it.each(SEVEN)('%s получает origin: more', type => {
    const out = asExtraEvent(base(type))
    expect(out).not.toBeNull()
    expect(out!.origin).toBe('more')
  })
  it.each(OTHER)('%s → null', type => {
    expect(asExtraEvent(base(type))).toBeNull()
  })
  it.each([
    ['full', { subs_report: 'full', subs_heard: [{ sub_ref: '0' }], subs_unheard: [], played_frac: 1 }],
    ['partial', { subs_report: 'partial', subs_heard: [{ sub_ref: '0' }], played_frac: 0.4 }],
    ['absent', { subs_report: '' }],
  ])('отчёт %s отличается от исходного только origin', (_n, extra) => {
    const src = base('clip_played', extra)
    const out = asExtraEvent(src)!
    const { origin, ...rest } = out
    expect(origin).toBe('more')
    expect(rest).toEqual(src)
  })
  it('вход не мутируется и копия — другой объект', () => {
    const src = base('clip_played', { subs_report: 'full' })
    const snap = JSON.parse(JSON.stringify(src))
    const out = asExtraEvent(src)!
    expect(out).not.toBe(src)
    expect(src).toEqual(snap)
    expect('origin' in src).toBe(false)
  })
  it('чужое значение origin заменяется на more', () => {
    expect(asExtraEvent(base('clip_played', { origin: 'other' }))!.origin).toBe('more')
  })
})
