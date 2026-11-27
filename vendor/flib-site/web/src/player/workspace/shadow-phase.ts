// shadow-phase.ts — Срез A fix-wave (M-2): чистый резолвер фазы карточки
// Shadowing из runtime-сигналов. Вынесен из PlayerPage.shadowCardData АДДИТИВНО,
// чтобы (а) порядок веток был мутационно-тестируемым без монтирования страницы,
// (б) исправить баг M-2: `micOpen` проверялся РАНЬШЕ `holding`, поэтому в hold с
// открытым миком (реалтайм-режим, арм жив ⇒ мик не закрыт) фаза вечно залипала в
// 'recording' — вердикт-'result' был НЕДОСТИЖИМ. Правильный порядок: как только
// пришёл финальный вердикт и координатор держит hold — это 'result', и он бьёт
// 'recording'.
import type { ShadowPhase } from '../hooks/useShadowV1'

export interface ShadowPhaseInputs {
  /** Композиц-флаг «Анализ» (PlayerPage) — окно граница→финал-ASR. */
  analyzing: boolean
  /** Координаторское окно оценки (eval-start…eval-end). */
  evalOverlayVisible: boolean
  /** Мик реально открыт (analyserNode != null) — реалтайм-стрим активен. */
  micOpen: boolean
  /** Пришёл финальный вердикт (outcome.status === 'final'). */
  finalVerdict: boolean
  /** Координатор держит grading-hold (park at B, ждём юзера). */
  holding: boolean
}

export function computeShadowPhase(s: ShadowPhaseInputs): ShadowPhase {
  // Анализ (граница→финал ASR или окно оценки) — старше всего.
  if (s.analyzing || s.evalOverlayVisible) return 'transcribing'
  // M-2: 'result' ОБЯЗАН стоять ПЕРЕД 'recording'. Финальный вердикт + hold =
  // «показать результат», даже если мик ещё открыт (арм жив ⇒ реалтайм-мик
  // не закрылся). Обратный порядок вешал фазу в 'recording' навсегда.
  if (s.finalVerdict && s.holding) return 'result'
  // Мик открыт, вердикта/hold нет → идёт запись («Говорите»).
  if (s.micOpen) return 'recording'
  return 'idle'
}

export interface ShadowTransmitInputs {
  /** Видео играет (юзер НЕ на паузе) — `!playerState.paused`. */
  playing: boolean
  /** Композиц-флаг «Анализ» (PlayerPage) — окно «граница→финал ASR». CRIT-1:
   *  на грейдинговой границе видео паузится координатором ДО того, как
   *  `evalOverlayVisible` станет true (eval-start эмитится ПОСЛЕ flush-резолва
   *  finalizeLoop — useShadowLoopCoordinator.ts:602-643, до 3с спустя). В этом
   *  окне `playing=false && evalOverlayVisible=false`, и без `analyzing` формула
   *  бы дала transmit=false → reconcile закрыл бы пайплайн + closeSession →
   *  resolveAll убил бы pending-waiter ЭТОЙ ЖЕ границы, а мик закрылся бы до
   *  дострима хвоста фразы → «Нет ответа» в ШТАТНОМ сценарии. `analyzing` —
   *  веб-эквивалент desktop listenHoldForFinal (index.tsx:1569): ставится
   *  СИНХРОННО на грейдинговой границе (PlayerPage, гейт по isEvalInFlight),
   *  bounded — сбрасывается на вердикте, eval-timeout ≤10с ограничивает. */
  analyzing: boolean
  /** Координаторское окно оценки на B (eval-start…eval-end). Это пауза
   *  КООРДИНАТОРА (evaluating), НЕ юзерская — рвать передачу нельзя. */
  evalOverlayVisible: boolean
}

/**
 * ТЗ №4 п.3 (+ фикс-волна [ID:P-tz4-fix]) — гоним ли PCM на сервер. Пауза видео =
 * прекращение передачи (иначе юзер ушёл на паузе и мы жжём его токены). НО не рвём
 * в окне «граница→финал»: координатор сам ставит паузу на B на грейдинговой
 * границе — это НЕ юзерская пауза.
 *
 * Канон desktop listeningEnabled (index.tsx:1569):
 *   (playing || listenHoldForFinal) && shadow.active && !(evaluating && !hold) && …
 * Здесь `active`/collapsed/consent/realtime — ОТДЕЛЬНЫЕ reconcile-гейты в
 * useShadowMicStream; этот резолвер отвечает ТОЛЬКО за «играем ли мы поток»:
 *   playing || analyzing (=listenHoldForFinal, окно граница→финал) ||
 *   evalOverlayVisible (=evaluating).
 *
 * `holding` в формулу НЕ входит (HIGH-3): grading-hold снимается ТОЛЬКО юзером
 * (петля OFF + fail оставила бы мик гореть часами — «нажал паузу и ушёл»).
 * Desktop в hold-парке НЕ слушает; re-score в hold идёт переигрыванием
 * (playing=true сам откроет передачу).
 */
export function computeShadowTransmitEnabled(s: ShadowTransmitInputs): boolean {
  return s.playing || s.analyzing || s.evalOverlayVisible
}
