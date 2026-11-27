// translate-capsule.test.ts — чистое ядро решений капсулы перевода строки.
// Мутационно-стойко: каждый тест изолирует ОДНО условие (остальные — проходные),
// так что мутация любой ветки роняет ровно свой тест.
import { describe, it, expect } from 'vitest'
import { capsuleVisible, shouldReveal, buildLineRevealPayload } from '../translate-capsule'
import { subLineHash } from '../../site/telemetry'
import { round2 } from '../player-telemetry'

describe('capsuleVisible', () => {
  const ok = { textEn: 'Hello there', hasVisibleRu: false, windowOk: true }
  it('видна, когда есть текст, RU не показан и окно не вырождено', () => {
    expect(capsuleVisible(ok)).toBe(true)
  })
  it('скрыта при пустом/пробельном text_en (edge 1 — переводить нечего)', () => {
    expect(capsuleVisible({ ...ok, textEn: '' })).toBe(false)
    expect(capsuleVisible({ ...ok, textEn: '   ' })).toBe(false)
  })
  it('скрыта, когда RU этой строки уже показан', () => {
    expect(capsuleVisible({ ...ok, hasVisibleRu: true })).toBe(false)
  })
  it('скрыта при вырожденном окне перевода (windowOk=false)', () => {
    expect(capsuleVisible({ ...ok, windowOk: false })).toBe(false)
  })
})

describe('shouldReveal', () => {
  it('true, когда matched содержит захваченный индекс', () => {
    expect(shouldReveal({ 5: 'привет' }, 5, '')).toBe(true)
  })
  it('FALSE, когда matched непуст, но БЕЗ захваченного индекса и text_ru пуст', () => {
    // Ключевой анти-регресс: иная сегментация шлюза (matched={6}) НЕ должна
    // раскрывать строку 5 (иначе пустая видимая RU-плашка).
    expect(shouldReveal({ 6: 'сосед' }, 5, '')).toBe(false)
  })
  it('true по корпусному text_ru, даже если matched без индекса', () => {
    expect(shouldReveal({ 6: 'сосед' }, 5, 'корпусный перевод')).toBe(true)
  })
  it('FALSE, когда matched[i] пустая строка и text_ru пуст (truthy-гард)', () => {
    expect(shouldReveal({ 5: '' }, 5, '')).toBe(false)
  })
})

describe('buildLineRevealPayload', () => {
  const base = {
    videoId: 'rVaAwVPJjtY', routeGoal: 'friends',
    cue: { start: 34.55, text_en: 'I never said that' },
    mode: 'l2' as const, surface: 'plate' as const, result: 'ok' as const,
  }
  it('sub_line_hash берётся от text_en (НЕ от RU) — join с rewind/ab_loop', () => {
    expect(buildLineRevealPayload(base).sub_line_hash).toBe(subLineHash('I never said that'))
  })
  it('timecode = round2(cue.start), НЕ currentTime плеера', () => {
    expect(buildLineRevealPayload({ ...base, cue: { start: 34.5678, text_en: 'x' } }).timecode)
      .toBe(round2(34.5678))
  })
  it('surface/mode/result/video_id/route_goal проброшены дословно', () => {
    const p = buildLineRevealPayload({ ...base, surface: 'list', mode: 'hidden', result: 'corpus' })
    expect(p.surface).toBe('list')
    expect(p.mode).toBe('hidden')
    expect(p.result).toBe('corpus')
    expect(p.video_id).toBe('rVaAwVPJjtY')
    expect(p.route_goal).toBe('friends')
  })
  it('НЕ утекает лишних полей (напр. сырой text_en) — точный набор ключей', () => {
    // Анти-утечка: text_en НЕ должен попасть в лог сырым (только хэш).
    expect(Object.keys(buildLineRevealPayload(base)).sort()).toEqual(
      ['mode', 'result', 'route_goal', 'sub_line_hash', 'surface', 'timecode', 'video_id'],
    )
  })
})
