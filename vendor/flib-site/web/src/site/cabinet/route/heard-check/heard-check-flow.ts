// heard-check-flow.ts — «Тест после ролика» перед запросом следующего ролика.
//
// Единая точка для ВСЕХ входов «дальше» (плеер: карточка конца; кабинет: герой
// дня и `?next=`): сначала runHeardCheck, и только потом выгрузка очереди и
// запрос ролика. Результат:
//   'none'        — теста нет (условия ниже не выполнены): кнопка работает как раньше;
//   'sent'        — ответ поставлен в очередь и выгружен; можно идти дальше;
//   'send_failed' — ответ потерян (очередь закрыта/сбой): в лог и дальше, не блокируем;
//   'abandoned'   — экран закрыт без ответа (уход со страницы): ничего не отправлено,
//                   вызывающий дальше НЕ идёт (его страница уже ушла).
//
// Условия показа (спека §2): есть открытый вопрос heard_check ПО АКТИВНОМУ ролику
// (`current_puzzle_id`) со словами; сохранённый максимум доли этого ролика ≥ 0.6;
// id вопроса ещё не отправлялся. «Пропустить»/Esc шлют `declined`; закрытие без
// ответа — ничего (демон гасит вопрос ПЕРВЫМ событием, лишний declined съел бы
// настоящий ответ).
//
// ⚠️ Один тест за раз (E5): второй вход ждёт первый (весь, вместе с выгрузкой) и
// сам теста не показывает и получает ИТОГ первого входа (в т.ч. 'abandoned'); дальнейший двойной запрос отсекает занятость вызывающего.
import type { RouteOutbox } from '../outbox'
import type { RouteState } from '../route-api'
import { forDate } from '../learning-day'
import { buildHeardCheckEvent, heardQuestionFor, HEARD_CHECK_MIN_FRAC } from './heard-check-event'
import { isHeardCheckSent, maxHeardFrac, noteHeardCheckSent } from './heard-check-memory'
import { askHeardCheck, type HeardOutcome } from './heard-check-store'
import { getRouteOutbox } from '../outbox'

export type HeardCheckResult = 'none' | 'sent' | 'send_failed' | 'abandoned'

export interface HeardCheckDeps {
  ask: (q: Parameters<typeof askHeardCheck>[0]) => Promise<HeardOutcome>
  outbox: Pick<RouteOutbox, 'enqueueDurable' | 'isClosed' | 'flush'>
  now: () => Date
  flushTimeoutMs: number
}

export const HEARD_CHECK_FLUSH_MS = 5000

const defaultDeps = (): HeardCheckDeps => ({ ask: askHeardCheck, outbox: getRouteOutbox(), now: () => new Date(), flushTimeoutMs: HEARD_CHECK_FLUSH_MS })

let inflight: Promise<HeardCheckResult> | null = null

// runHeardCheck — state: свежее состояние маршрута страницы; beforeShow —
// действие перед показом (плеер: пауза и выход из полноэкранного режима).
export async function runHeardCheck(state: RouteState | null, o: { beforeShow?: () => void; deps?: HeardCheckDeps } = {}): Promise<HeardCheckResult> {
  if (inflight) {
    // Ошибка первого входа — его дело: ждущему она не должна ронять СВОЙ запрос.
    // Итог первого отдаём и ждущему: если экран закрыли без ответа ('abandoned'),
    // страница уже ушла — ждущий не должен идти дальше.
    try { return await inflight } catch { return 'none' /* вторичный прибор */ }
  }
  const p = run(state, o)
  inflight = p
  try { return await p } finally { if (inflight === p) inflight = null }
}

async function run(state: RouteState | null, o: { beforeShow?: () => void; deps?: HeardCheckDeps }): Promise<HeardCheckResult> {
  const d = o.deps ?? defaultDeps()
  if (!state || !state.route_id) return 'none'
  const q = heardQuestionFor(state.heard_check_questions, state.current_puzzle_id)
  if (!q) return 'none'
  if (isHeardCheckSent(q.id, state.route_id)) return 'none'
  if (maxHeardFrac(q.puzzle_id) < HEARD_CHECK_MIN_FRAC) return 'none'
  if (d.outbox.isClosed()) return 'none'
  try { o.beforeShow?.() } catch { /* пауза не должна ронять тест */ }
  const ans = await d.ask(q)
  if (ans === 'abandoned') return 'abandoned'
  const now = d.now()
  const ev = buildHeardCheckEvent(q, ans, forDate(state.snapshot_date, now), now)
  try {
    await d.outbox.enqueueDurable(state.route_id, ev)
    // «Выход» во время постановки закрыл очередь — событие не легло.
    if (d.outbox.isClosed()) return 'send_failed'
    noteHeardCheckSent(q.id, state.route_id)
    await d.outbox.flush({ timeoutMs: d.flushTimeoutMs })
    return 'sent'
  } catch (e) {
    console.warn('[route] ответ теста после ролика не отправлен — дальше без него:', e)
    return 'send_failed'
  }
}

// __resetHeardCheckFlowForTests — сброс единственного входа между тестами.
export function __resetHeardCheckFlowForTests(): void { inflight = null }
