// shadow-phase.test.ts — Срез A fix-wave (M-2): резолвер фазы карточки.
// Ключевой мутационный гейт: 'result' ПЕРЕД 'recording' (иначе hold с открытым
// миком залипает в 'recording' и вердикт недостижим).
import { describe, it, expect } from 'vitest'
import { computeShadowPhase, computeShadowTransmitEnabled } from '../shadow-phase'

const base = { analyzing: false, evalOverlayVisible: false, micOpen: false, finalVerdict: false, holding: false }

describe('computeShadowPhase (Срез A M-2)', () => {
  it('idle по умолчанию (ничего не активно)', () => {
    expect(computeShadowPhase(base)).toBe('idle')
  })

  it('analyzing → transcribing', () => {
    expect(computeShadowPhase({ ...base, analyzing: true })).toBe('transcribing')
  })

  it('evalOverlayVisible → transcribing', () => {
    expect(computeShadowPhase({ ...base, evalOverlayVisible: true })).toBe('transcribing')
  })

  it('мик открыт, вердикта нет → recording', () => {
    expect(computeShadowPhase({ ...base, micOpen: true })).toBe('recording')
  })

  it('финальный вердикт + hold, мик ЗАКРЫТ → result', () => {
    expect(computeShadowPhase({ ...base, finalVerdict: true, holding: true })).toBe('result')
  })

  // ── МУТАЦИОННЫЙ ГЕЙТ M-2: result бьёт recording при открытом мике ──
  it('M-2: финальный вердикт + hold + мик ВСЁ ЕЩЁ ОТКРЫТ → result (НЕ recording)', () => {
    expect(computeShadowPhase({ ...base, finalVerdict: true, holding: true, micOpen: true })).toBe('result')
  })

  it('analyzing старше result (граница новой петли важнее прошлого вердикта)', () => {
    expect(computeShadowPhase({ ...base, analyzing: true, finalVerdict: true, holding: true, micOpen: true })).toBe('transcribing')
  })

  it('финальный вердикт БЕЗ hold, мик открыт → recording (hold обязателен для result)', () => {
    expect(computeShadowPhase({ ...base, finalVerdict: true, holding: false, micOpen: true })).toBe('recording')
  })

  it('hold без финального вердикта, мик открыт → recording (нужен именно финал)', () => {
    expect(computeShadowPhase({ ...base, finalVerdict: false, holding: true, micOpen: true })).toBe('recording')
  })
})

// ТЗ №4 фикс-волна [ID:P-tz4-fix] — CRIT-1 + HIGH-3. transmitEnabled решает,
// гоним ли PCM на сервер. Канон desktop listeningEnabled (index.tsx:1569):
// (playing || listenHoldForFinal) && ... . Веб-формула: playing || analyzing
// (граница→финал ASR: видео УЖЕ паузнуто координатором, но eval-start ещё не
// эмитнут — веб-эквивалент listenHoldForFinal) || evalOverlayVisible
// (координаторская пауза на B). `holding` УБРАН (HIGH-3: hold = вечный стрим —
// hold снимается только юзером, петля OFF+fail оставила бы мик гореть часами).
describe('computeShadowTransmitEnabled (ТЗ №4 п.3 — пауза=стоп передачи)', () => {
  const b = { playing: false, analyzing: false, evalOverlayVisible: false }
  it('видео играет → передаём', () => {
    expect(computeShadowTransmitEnabled({ ...b, playing: true })).toBe(true)
  })
  it('(a-ish) юзерская пауза mid-петли (всё false) → НЕ передаём (мик закроется)', () => {
    expect(computeShadowTransmitEnabled(b)).toBe(false)
  })
  it('(c) координаторская пауза на B при eval (evalOverlayVisible=true) → передача ЖИВЁТ', () => {
    expect(computeShadowTransmitEnabled({ ...b, evalOverlayVisible: true })).toBe(true)
  })
  // ── CRIT-1: окно «граница→финал» ──
  it('(crit-a) грейдинговая граница: видео паузнуто (playing=false), eval-start ещё НЕ эмитнут (evalOverlayVisible=false), но analyzing=true → передача ЖИВА (хвост фразы дострима до ASR, pending-waiter не убит)', () => {
    expect(computeShadowTransmitEnabled({ playing: false, analyzing: true, evalOverlayVisible: false })).toBe(true)
  })
  it('(crit-b) вердикт пришёл: analyzing сброшен, видео на паузе, eval закрыт → передача ГАСНЕТ (не жжём токены на паузе)', () => {
    expect(computeShadowTransmitEnabled({ playing: false, analyzing: false, evalOverlayVisible: false })).toBe(false)
  })
  // ── HIGH-3: hold-парк НЕ держит стрим (holding больше НЕ входит в формулу) ──
  it('(high-3) hold-клетка (видео на паузе, analyzing сброшен на вердикте, eval закрыт) → передача ВЫКЛЮЧЕНА (в hold-парке НЕ слушаем — re-score идёт переигрыванием, playing сам откроет)', () => {
    // В desktop hold-парке listeningEnabled=false; переигрывание ставит playing=true.
    expect(computeShadowTransmitEnabled({ playing: false, analyzing: false, evalOverlayVisible: false })).toBe(false)
  })
})
