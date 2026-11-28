// heard-check-event.ts — вопрос теста после ролика и событие `question_answered`.
//
// Форма события — РОВНО та, которую принимает шлюз (turmalin_getaway
// internal/routestate/events.go checkHeardCheckAnswer):
//   • question_id вида `hc:<YYYY-MM-DD>:<puzzle_id>`; answer_value не ставится;
//   • shown — слова как показаны: ≤ 6, непустые, без повторов;
//   • marked ⊆ shown, без повторов; пустой marked поле не ставит (как приложение);
//   • answer_outcome — `answered` | `declined`.
// Слова — только английские, без перевода (решение владельца).
import type { RouteEvent } from '../outbox'
import type { HeardQuestion } from '../route-api'
import { envelope } from '../../../../player/route-events/mapper'

export const HEARD_CHECK_MIN_FRAC = 0.6
export const HEARD_CHECK_MAX_WORDS = 6

export type HeardAnswer = { outcome: 'answered'; marked: string[] } | { outcome: 'declined' }

// shownWords — слова, как они показываются и уходят в `shown`: непустые, без
// повторов, не больше шести (защита от ответа шлюза, не от нормы).
export function shownWords(q: Pick<HeardQuestion, 'words'>): string[] {
  const out: string[] = []
  for (const w of q.words) {
    if (typeof w === 'string' && w !== '' && !out.includes(w) && out.length < HEARD_CHECK_MAX_WORDS) out.push(w)
  }
  return out
}

// buildHeardCheckEvent — событие ответа. marked пересекается с shown (порядок —
// порядок показа), поэтому ⊆ shown выполняется по построению.
export function buildHeardCheckEvent(q: HeardQuestion, a: HeardAnswer, learningDay: string, now: Date = new Date()): RouteEvent {
  const shown = shownWords(q)
  const env = envelope(learningDay, now)
  const ev: RouteEvent = {
    event_id: env.event_id, type: 'question_answered', puzzle_id: q.puzzle_id, question_id: q.id,
    answer_outcome: a.outcome, shown, learning_day: env.learning_day, client_ts: env.client_ts,
  }
  if (a.outcome === 'answered') {
    const set = new Set(a.marked)
    const marked = shown.filter(w => set.has(w))
    if (marked.length > 0) ev.marked = marked
  }
  return ev
}

// heardQuestionFor — открытый вопрос по активному ролику: heard_check, тот же
// puzzle_id, ≥ 1 слова (E6).
export function heardQuestionFor(questions: readonly HeardQuestion[] | null | undefined, activePuzzleId: string | null | undefined): HeardQuestion | null {
  if (!activePuzzleId || !questions) return null
  for (const q of questions) {
    if (q && q.kind === 'heard_check' && q.puzzle_id === activePuzzleId && typeof q.id === 'string' && q.id !== ''
      && Array.isArray(q.words) && shownWords(q).length > 0) return q
  }
  return null
}
