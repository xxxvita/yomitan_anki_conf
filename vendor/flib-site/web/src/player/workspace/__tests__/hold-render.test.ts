// hold-render.test.ts — T3 seam: filterAnswerOutcomeForRender pure function.
import { describe, it, expect } from 'vitest';
import { filterAnswerOutcomeForRender } from '../hold-render';
import type { AnswerOutcomeEvent } from '../answer-source';

const finalEvent = (exerciseId: string): AnswerOutcomeEvent => ({
  exerciseId,
  outcome: { status: 'final', text: 'hello world' },
});

describe('filterAnswerOutcomeForRender', () => {
  it('matching exerciseId → returns the event unchanged', () => {
    const e = finalEvent('ex1');
    expect(filterAnswerOutcomeForRender(e, 'ex1')).toBe(e);
  });

  it('foreign exerciseId (loop already moved on) → null (stale, dropped)', () => {
    const e = finalEvent('ex1');
    expect(filterAnswerOutcomeForRender(e, 'ex2')).toBeNull();
  });

  it('currentExerciseId null (nothing armed — run ended) → null even if ids happen to line up conceptually', () => {
    const e = finalEvent('ex1');
    expect(filterAnswerOutcomeForRender(e, null)).toBeNull();
  });

  it('non-final outcomes are filtered the same way (status is irrelevant to the id match)', () => {
    const e: AnswerOutcomeEvent = { exerciseId: 'ex1', outcome: { status: 'no-response', reason: 'no-audio' } };
    expect(filterAnswerOutcomeForRender(e, 'ex1')).toBe(e);
    expect(filterAnswerOutcomeForRender(e, 'ex-other')).toBeNull();
  });
});
