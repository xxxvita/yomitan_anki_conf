// shadow-attempts-accumulate.ts — Срез C: чистый аккумулятор истории попыток
// из runtime-вердиктов. Вынесен из PlayerPage's accumulator-эффекта АДДИТИВНО
// (тот же паттерн, что shadow-phase.ts/shadow-settings-delivery.ts — чистый
// хелпер, мутационно-тестируемый без монтирования страницы), потому что React
// StrictMode double-invoke эффектов эмпирически подтверждён ТОЛЬКО на самом
// первом mount-коммите компонента, НЕ на последующих ре-рендерах, вызванных
// изменением state — а `verdictOutcome` у PlayerPage
// ВСЕГДА null на первом mount-коммите (runtime свежий), так что StrictMode
// сам по себе НИКОГДА не бьёт по этому эффекту дважды с непустым исходом при
// текущей форме PlayerPage. Дедуп-реф здесь — defense-in-depth (mount-time
// restore в будущем срезе, ре-инвок эффекта по другой причине), и вынесение
// в чистую функцию даёт РЕАЛЬНУЮ, детерминированную мутационную проверку
// (звать дважды с ОДНИМ И ТЕМ ЖЕ object-identity `oc` → add() ровно раз) —
// то, что полноценный React-mount PlayerPage под StrictMode эмпирически не
// может воспроизвести для этого конкретного эффекта.
import { matchWordsDetailed } from './word-matcher'
import type { AnswerOutcomeEvent } from './answer-source'
import type { ShadowAttemptStored } from './shadow-attempts'

/** Мутируемый держатель "последнего обработанного" verdictOutcome — ref-подобный
 *  контракт (React useRef удовлетворяет этой форме напрямую). */
export interface ConsumedVerdictHolder {
  current: AnswerOutcomeEvent | null
}

/**
 * Срез C, п.2-3 ТЗ: на КАЖДЫЙ финальный verdictOutcome — matchWordsDetailed(text,
 * targetSnapshot) → add(...) РОВНО ОДИН РАЗ (дедуп по object-identity `oc`,
 * т.к. AnswerOutcomeEvent не несёт seq — answer-source.ts:203-206, координатор
 * минтит новый объект на каждый setVerdictOutcome). cue_index — уже ЗАФИКСИРОВАННЫЙ
 * снимок (armedCueIndex), взятый ВЫЗЫВАЮЩИМ на момент арма — эта функция его не
 * вычисляет. Пустой/whitespace финальный текст ("тишина/таймаут") НЕ пишет строку
 * (десктоп-канон finalizeLoopRow, anki_conf useShadow.ts:564-577). audio-границы
 * фиксированы 0/0 — записей аудио попыток на вебе нет.
 */
export function accumulateShadowAttempt(
  holder: ConsumedVerdictHolder,
  oc: AnswerOutcomeEvent | null,
  targetSnapshot: string | null,
  armedCueIndex: number,
  add: (a: ShadowAttemptStored) => void,
  now: () => Date = () => new Date(),
): void {
  if (!oc || oc.outcome.status !== 'final') return
  if (holder.current === oc) return // уже обработан этот САМЫЙ объект — дедуп
  holder.current = oc
  if (!targetSnapshot) return
  const text = oc.outcome.text
  if (!text.trim()) return
  const { marks, matchPct } = matchWordsDetailed(text, targetSnapshot)
  add({
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
    cue_index: armedCueIndex,
    text,
    marks,
    match_pct: Math.round(matchPct),
    audio_start_sec: 0,
    audio_end_sec: 0,
    created_at: now().toISOString(),
  })
}
