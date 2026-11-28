// shadow-arm-cue-index.test.ts — Срез C+D фикс-волна [ID:P-CD-fix]: чистый
// резолвер cue_index, снимаемого на МОМЕНТ арма. Покрывает два адверсариальных
// дефекта мутационно (без монтирования PlayerPage):
//   H2 — activeIndex=-1 (playhead в паузе между cue при A-B/time-range-арме) →
//        кламп на ПЕРВЫЙ cue, пересекающий армленный отрезок (иначе cue_index:-1,
//        а toPanel/merge пропускают <0 → запись невидима навсегда).
//   M2 — детектор пересъёмки обязан ловить ЛЮБУЮ смену armed id (в т.ч. id1→id2
//        БЕЗ прохода через null, как заармит срез E), а не только null→id.
import { describe, it, expect } from 'vitest'
import { resolveArmCaptureIndex, resolveAttemptBucket } from '../shadow-arm-cue-index'

const CUES = [
  { start: 0, end: 2 },
  { start: 2, end: 4 },
  { start: 5, end: 7 }, // после дыры [4,5)
]

describe('resolveArmCaptureIndex', () => {
  it('activeIndex>=0 → возвращает его как есть (обычный арм на субтитре, без клампа)', () => {
    expect(resolveArmCaptureIndex({
      prevArmedId: null, armedId: 'ex-1', prevCaptured: -1,
      activeIndex: 1, cues: CUES, armedRange: { startTime: 2, endTime: 4 },
    })).toBe(1)
  })

  it('armedId=null (дормант/разарм) → prevCaptured без изменений', () => {
    expect(resolveArmCaptureIndex({
      prevArmedId: 'ex-1', armedId: null, prevCaptured: 3,
      activeIndex: 0, cues: CUES, armedRange: null,
    })).toBe(3)
  })

  it('armedId НЕ сменился (тот же id) → prevCaptured, пересъёмки нет', () => {
    expect(resolveArmCaptureIndex({
      prevArmedId: 'ex-1', armedId: 'ex-1', prevCaptured: 2,
      activeIndex: 0, cues: CUES, armedRange: { startTime: 0, endTime: 2 },
    })).toBe(2)
  })

  // ── M2: смена id1→id2 БЕЗ прохода через null (мина под срез E) ──
  it('[M2] armed id1→id2 (без null между) → ПЕРЕСЪЁМКА на новый activeIndex', () => {
    expect(resolveArmCaptureIndex({
      prevArmedId: 'ex-1', armedId: 'ex-2', prevCaptured: 0,
      activeIndex: 1, cues: CUES, armedRange: { startTime: 2, endTime: 4 },
    })).toBe(1) // новый бакет cue#1, не залипший 0 от первого арма
  })

  // ── H2: playhead в паузе между cue → activeIndex=-1, кламп на первый пересекающий ──
  it('[H2] activeIndex=-1 + armedRange пересекает cue#0 → кламп на 0', () => {
    expect(resolveArmCaptureIndex({
      prevArmedId: null, armedId: 'ex-1', prevCaptured: -1,
      activeIndex: -1, cues: CUES, armedRange: { startTime: 0, endTime: 3 },
    })).toBe(0)
  })

  it('[H2] activeIndex=-1 + armedRange пересекает только cue#2 (после дыры) → кламп на 2', () => {
    expect(resolveArmCaptureIndex({
      prevArmedId: null, armedId: 'ex-1', prevCaptured: -1,
      activeIndex: -1, cues: CUES, armedRange: { startTime: 4.5, endTime: 6 },
    })).toBe(2)
  })

  it('[H2] activeIndex=-1 + armedRange НЕ пересекает ни один cue → остаётся -1 (нечестного бакета не выдумываем)', () => {
    expect(resolveArmCaptureIndex({
      prevArmedId: null, armedId: 'ex-1', prevCaptured: -1,
      activeIndex: -1, cues: CUES, armedRange: { startTime: 4, endTime: 5 },
    })).toBe(-1)
  })

  it('[H2] activeIndex=-1 + armedRange=null → нечем кламповать, -1', () => {
    expect(resolveArmCaptureIndex({
      prevArmedId: null, armedId: 'ex-1', prevCaptured: -1,
      activeIndex: -1, cues: CUES, armedRange: null,
    })).toBe(-1)
  })

  it('[H2] пустые cues → -1', () => {
    expect(resolveArmCaptureIndex({
      prevArmedId: null, armedId: 'ex-1', prevCaptured: -1,
      activeIndex: -1, cues: [], armedRange: { startTime: 0, endTime: 3 },
    })).toBe(-1)
  })

  // ── [ID:P-feed-dead-fix] армCue=-1 не должен залипать на весь ран: апгрейд
  // без даунгрейда на ветке unchanged-armedId. Арм ДО прихода субтитров (cues=[],
  // pending fetch) честно даёт -1; как только приходит первый живой activeIndex —
  // латч встаёт на НЕГО и держится, даже если playhead потом уехал дальше.
  it('[P-feed-dead-fix] армCue=-1 на арме (cues=[]) → activeIndex=0 подхватывается (латч на 0) → activeIndex=1 бакет ОСТАЁТСЯ 0', () => {
    // Момент 1: арм до субтитров — cues=[], activeIndex=-1 → честный -1.
    const captured1 = resolveArmCaptureIndex({
      prevArmedId: null, armedId: 'ex-1', prevCaptured: -1,
      activeIndex: -1, cues: [], armedRange: null,
    })
    expect(captured1).toBe(-1)

    // Момент 2: субтитры пришли, playhead на cue#0 (activeIndex=0), armedId тот же
    // (пересъёмки нет) → латч ДОЛЖЕН подхватить первый живой cue, а не остаться на -1.
    const captured2 = resolveArmCaptureIndex({
      prevArmedId: 'ex-1', armedId: 'ex-1', prevCaptured: captured1,
      activeIndex: 0, cues: CUES, armedRange: { startTime: 0, endTime: 2 },
    })
    expect(captured2).toBe(0)

    // Момент 3: playhead уехал на cue#1 (activeIndex=1), armedId всё тот же →
    // бакет НЕ должен дрейфовать за live activeIndex — латч держит 0.
    const captured3 = resolveArmCaptureIndex({
      prevArmedId: 'ex-1', armedId: 'ex-1', prevCaptured: captured2,
      activeIndex: 1, cues: CUES, armedRange: { startTime: 0, endTime: 2 },
    })
    expect(captured3).toBe(0)
  })
})

// [ID:P-feed-dead] Регрессия ТЗ-5: аккумулятор писал попытку под ГОЛЫМ armCue
// (мог быть -1 → cue_index<0 → toPanel скрывает → лента вечно пуста), а карта
// читала armCue>=0?armCue:activeIndex. Резолвер бакета зовётся из ОБОИХ мест —
// бакет записи ОБЯЗАН == бакету чтения.
describe('resolveAttemptBucket', () => {
  it('armCue>=0 → он сам (обычный арм на субтитре; activeIndex игнор)', () => {
    expect(resolveAttemptBucket(2, 0)).toBe(2)
    expect(resolveAttemptBucket(0, -1)).toBe(0)
  })
  it('armCue=-1 (gap-арм, честный -1) → фолбэк на activeIndex (ВИДИМЫЙ бакет, не -1)', () => {
    expect(resolveAttemptBucket(-1, 3)).toBe(3)
    expect(resolveAttemptBucket(-1, 0)).toBe(0)
  })
  it('armCue=-1 И activeIndex=-1 (плейхед реально вне cue) → -1 симметрично', () => {
    expect(resolveAttemptBucket(-1, -1)).toBe(-1)
  })
})
