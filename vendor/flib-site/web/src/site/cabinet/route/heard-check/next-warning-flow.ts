// next-warning-flow.ts — предупреждение перед «Следующий ролик» для непрослушанного
// активного ролика. Единая точка для всех входов «дальше» (плеер, день, урок).
//   'listened'   — ролик прослушан (или id нет): без предупреждения, дальше как раньше
//                  (тест после ролика идёт обычным путём);
//   'skip_check' — человек выбрал «Всё равно перейти»: идём дальше БЕЗ теста после
//                  ролика и без единого события (даже declined);
//   'stay'       — «Вернуться к ролику» / Esc / уход со страницы / второй вход:
//                  ничего не делаем.
// «Прослушан» — существующая отметка isClipListened (без нового правила).
import { isClipListened } from '../../../../player/route-events/clip-listened'
import { askNextWarning } from './next-warning-store'

export type NextDecision = 'listened' | 'skip_check' | 'stay'

// Решение «без теста» едет на страницу маршрута в `?next=…&skip_hc=1`.
export const SKIP_HC_PARAM = 'skip_hc'

export const NW_TEXT = {
  message: 'Вы прослушали не весь ролик.',
  proceed: 'Всё равно перейти к следующему ролику',
  back: 'Вернуться к ролику',
} as const

export async function confirmNextClip(puzzleId: string | null | undefined, o: { beforeShow?: () => void } = {}): Promise<NextDecision> {
  // «Прослушан» ставит только плеер YouTube: для урока слов и прочих клипов отметки не
  // бывает — предупреждать там нечем и возвращаться некуда.
  if (!puzzleId || !puzzleId.startsWith('youtube::') || isClipListened(puzzleId)) return 'listened'
  try { o.beforeShow?.() } catch { /* пауза не должна ронять окно */ }
  const r = await askNextWarning()
  return r === 'proceed' ? 'skip_check' : 'stay'
}
