// route-step-nav.ts — общий "шаг маршрута пройден → куда дальше" переход.
// Вынесено из RouteStepBar (Э5) при добавлении UnplayableOverlay
// (P-unplayable п.2, «Пропустить шаг →»): ОБА компонента должны отметить
// stepId пройденным и попасть на тот же следующий шаг — было бы дублем
// логики markStepDone+saveRoute+navigate в двух местах, теперь один источник.
import type { NavigateFunction } from 'react-router-dom'
import { loadRoute, saveRoute, markStepDone, type RouteState } from '../site/route-state'
import { addWords } from '../site/vocab'

/** Отмечает stepId пройденным, персистит route в localStorage и переводит
 *  навигацию на следующий незавершённый шаг маршрута: если это kind='video'
 *  — на /player с его videoId/route_step; иначе (kind='words' или шагов
 *  больше нет) — на /route. Возвращает обновлённый RouteState (или null,
 *  если маршрута в localStorage вообще нет — вызывающая сторона решает,
 *  что делать дальше, но переход/логика markStepDone уже не применимы).
 *
 * Phase 2, п.B: пройденный шаг накапливает СВОИ слова (RouteStep.words —
 * реальный список слов шага, проверено на живом маршруте: video-шаг
 * new_lemmas=8 → words=[...8шт]) в flib:vocab с source='learned'. Ищем шаг
 * ДО markStepDone (тот не удаляет и не мутирует words, но так нагляднее —
 * "вот шаг, который проходим, вот его слова"). Пустой words (мок-данные
 * video-шагов без реального бэка) — addWords(['...']) валидный no-op, не
 * падение.
 */
export function advanceRouteStep(stepId: string, navigate: NavigateFunction): RouteState | null {
  const route = loadRoute()
  if (!route) return null
  const passedStep = route.steps.find(s => s.id === stepId)
  if (passedStep) addWords(passedStep.words, 'learned')
  const updated = markStepDone(route, stepId)
  saveRoute(updated)
  // markStepDone проставляет 'current' максимум ОДНОМУ шагу — первому
  // видимому не-done шагу по порядку (route-state.ts) — это и есть
  // "следующий шаг маршрута", каким бы ни было его kind.
  const nextStep = updated.steps.find(s => s.status === 'current')
  if (nextStep && nextStep.kind === 'video' && nextStep.videoId) {
    navigate(`/player?v=${nextStep.videoId}&route_step=${nextStep.id}`)
  } else {
    // Следующий шаг — kind='words' (без отдельного видео, живёт только на
    // /route) либо шагов больше нет (конец маршрута/раскрытого батча) — оба
    // случая ведём на страницу маршрута.
    navigate('/route')
  }
  return updated
}
