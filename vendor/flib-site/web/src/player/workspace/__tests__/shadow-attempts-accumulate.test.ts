// shadow-attempts-accumulate.test.ts — Срез C [ID:P-C]: pure-function unit
// tests for the accumulator (dedup, empty-text canon, cue_index passthrough,
// field shape). This is the GENUINE mutation-sensitive proof for the
// object-identity dedup guard — see shadow-attempts-accumulate.ts's own doc
// for why the full-PlayerPage StrictMode integration test cannot exercise
// this (React only double-invokes effects on the very first mount commit,
// and verdictOutcome is always null there).
import { describe, it, expect, vi } from 'vitest'
import { accumulateShadowAttempt, type ConsumedVerdictHolder } from '../shadow-attempts-accumulate'
import type { AnswerOutcomeEvent } from '../answer-source'
import { matchWordsDetailed } from '../word-matcher'

function finalEvent(text: string): AnswerOutcomeEvent {
  return { exerciseId: 'ex-1', outcome: { status: 'final', text } }
}

describe('accumulateShadowAttempt', () => {
  it('final(непустой текст) → add() зовётся РОВНО ОДИН РАЗ с честными 8 полями snake_case', () => {
    const holder: ConsumedVerdictHolder = { current: null }
    const add = vi.fn()
    const oc = finalEvent('hello there')
    const now = () => new Date('2026-07-10T12:00:00.000Z')
    accumulateShadowAttempt(holder, oc, 'hello world', 3, add, now)

    expect(add).toHaveBeenCalledTimes(1)
    const expected = matchWordsDetailed('hello there', 'hello world')
    const a = add.mock.calls[0][0]
    expect(a.cue_index).toBe(3)
    expect(a.text).toBe('hello there')
    expect(a.match_pct).toBe(Math.round(expected.matchPct))
    expect(a.marks).toEqual(expected.marks)
    expect(a.audio_start_sec).toBe(0)
    expect(a.audio_end_sec).toBe(0)
    expect(a.created_at).toBe('2026-07-10T12:00:00.000Z')
    expect(typeof a.id).toBe('string')
    expect(a.id.length).toBeGreaterThan(0)
    expect(Object.keys(a).sort()).toEqual(
      ['audio_end_sec', 'audio_start_sec', 'created_at', 'cue_index', 'id', 'marks', 'match_pct', 'text'].sort(),
    )
  })

  it('ДЕДУП: тот же object-identity `oc` дважды подряд → add() зовётся ТОЛЬКО ОДИН раз (StrictMode-double-invoke repro)', () => {
    const holder: ConsumedVerdictHolder = { current: null }
    const add = vi.fn()
    const oc = finalEvent('hello there') // ОДИН И ТОТ ЖЕ объект — как повторный инвок эффекта в одном коммите
    accumulateShadowAttempt(holder, oc, 'hello world', 0, add)
    accumulateShadowAttempt(holder, oc, 'hello world', 0, add) // повтор — тот же oc

    expect(add).toHaveBeenCalledTimes(1)
  })

  it('ДВА РАЗНЫХ final-объекта (не перезапись) → add() зовётся ДВАЖДЫ', () => {
    const holder: ConsumedVerdictHolder = { current: null }
    const add = vi.fn()
    accumulateShadowAttempt(holder, finalEvent('first answer'), 'hello world', 0, add)
    accumulateShadowAttempt(holder, finalEvent('second answer'), 'hello world', 0, add)

    expect(add).toHaveBeenCalledTimes(2)
    expect(add.mock.calls[0][0].text).toBe('first answer')
    expect(add.mock.calls[1][0].text).toBe('second answer')
  })

  it('final с ПУСТЫМ/whitespace текстом → add() НЕ зовётся (десктоп-канон: тишина/таймаут не пишет ложный 0%-ряд)', () => {
    const holder: ConsumedVerdictHolder = { current: null }
    const add = vi.fn()
    accumulateShadowAttempt(holder, finalEvent(''), 'hello world', 0, add)
    accumulateShadowAttempt(holder, finalEvent('   '), 'hello world', 0, add)

    expect(add).not.toHaveBeenCalled()
  })

  it('non-final (partial/timeout/no-response) → no-op, holder НЕ трогается', () => {
    const holder: ConsumedVerdictHolder = { current: null }
    const add = vi.fn()
    const partial: AnswerOutcomeEvent = { exerciseId: 'ex-1', outcome: { status: 'non-final', partial: 'hel' } }
    accumulateShadowAttempt(holder, partial, 'hello world', 0, add)

    expect(add).not.toHaveBeenCalled()
    expect(holder.current).toBeNull()
  })

  it('oc === null (дормант / сброс) → no-op', () => {
    const holder: ConsumedVerdictHolder = { current: null }
    const add = vi.fn()
    accumulateShadowAttempt(holder, null, 'hello world', 0, add)
    expect(add).not.toHaveBeenCalled()
  })

  it('targetSnapshot пуст/null → add() НЕ зовётся (нет честной цели для word-diff), но holder помечен consumed', () => {
    const holder: ConsumedVerdictHolder = { current: null }
    const add = vi.fn()
    const oc = finalEvent('hello there')
    accumulateShadowAttempt(holder, oc, null, 0, add)

    expect(add).not.toHaveBeenCalled()
    expect(holder.current).toBe(oc) // помечен — повторный инвок того же oc не пересчитывает
  })

  it('cue_index честно ПРОБРАСЫВАЕТСЯ от вызывающего (снимок на момент арма), не пересчитывается', () => {
    const holder: ConsumedVerdictHolder = { current: null }
    const add = vi.fn()
    accumulateShadowAttempt(holder, finalEvent('x'), 'x', 7, add)
    expect(add.mock.calls[0][0].cue_index).toBe(7)
  })
})
