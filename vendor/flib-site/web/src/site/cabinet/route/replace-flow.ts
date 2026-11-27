// replace-flow.ts — шаги замены (спека 2026-11-17 §4.6 «Шаги замены», план
// B10b/B9) — общие для экрана дня и плеера:
//   2. несданные clip_played заменяемого ролика выбрасываются из локальной
//      очереди, тем же шагом удаляется его запись `flib:route-watched` — под ОДНОЙ
//      блокировкой очереди (ревью партии 2, L13): иначе после коммита ролик
//      вернулся бы строкой `kept_local` (Р24), а его долю приложение не шлёт;
//   3. выгрузка очереди (≤ 5 с) и обмен `want:"replace"` с `replace_puzzle_id`
//      ЭТОГО ролика и `replace_reason` (путь «Не нравится») или без него.
// Шаг 1 (clip_rated пути «Не нравится») делает вызывающий ДО этих шагов.
import { getRouteOutbox } from './outbox'
import { removeWatched } from '../../../player/route-events/route-watched'
import { runExchange, type ExchangeDeps, type ExchangeOutcome } from './exchange-machine'
import type { RouteState } from './route-api'

export async function dropReplacedLocally(puzzleId: string): Promise<void> {
  await getRouteOutbox().dropClipPlayed(puzzleId, { afterDrop: () => removeWatched(puzzleId) })
}

// markReplaced — пометка «заменён с этого браузера» в `flib:route-watched` (L2) —
// ТОЛЬКО после того, как наша замена закоммичена (ревью 3а, R1-H1): иначе ролик,
// оставшийся в плане (отказ, stale_revision, чужой коммит, уход со страницы), весь
// день не получал бы отметку. Под блокировкой очереди (L13).
export async function markReplaced(puzzleId: string, epoch: { routeId: string; day: string }): Promise<void> {
  await getRouteOutbox().locked(() => removeWatched(puzzleId, undefined, epoch))
}

// epochOf — эпоха и дата плана состояния (для пометки заменённого ролика, L2).
export function epochOf(state: RouteState): { routeId: string; day: string } | undefined {
  return state.route_id && state.day ? { routeId: state.route_id, day: state.day.date } : undefined
}

export async function replaceClip(o: { state: RouteState; puzzleId: string; reason?: string; deps: ExchangeDeps }): Promise<ExchangeOutcome> {
  await dropReplacedLocally(o.puzzleId)
  return runExchange({
    want: 'replace', expectedRevision: o.state.revision, snapshotDate: o.state.snapshot_date,
    replacePuzzleId: o.puzzleId, ...(o.reason ? { replaceReason: o.reason } : {}),
  }, o.deps)
}

// afterReplaceUrl — куда уйти после коммита замены из плеера (§4.6 «После
// коммита замены», W-M2): новый текущий YouTube — его плеер с `rp`; урок слов
// и `other` — экран дня (страница урока сама не открывается).
export function afterReplaceUrl(state: RouteState | null): string {
  const cur = state?.current_puzzle_id
  if (!state || !cur || !cur.startsWith('youtube::')) return '/app/route'
  const row = state.day?.clips.find(c => c.delivered === true && c.puzzle_id === cur) as { video_id?: string } | undefined
  return row?.video_id ? `/player?v=${encodeURIComponent(row.video_id)}&rp=${encodeURIComponent(cur)}` : '/app/route'
}
