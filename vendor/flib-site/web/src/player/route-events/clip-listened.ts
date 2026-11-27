// clip-listened.ts — отметка «прослушан» `flib:route-listened` (спека §4.7 п.1,
// §6.2, план B8b). Порт `clip-listened.ts` + условия `use-subtitle-listening.ts`
// приложения.
//
// Ролик прослушан, когда услышаны все нешумовые реплики (`прослушанВесь`
// счётчика), или на конце ролика без речевых реплик — но ТОЛЬКО когда дорожка
// субтитров получена: пока она неизвестна или не пришла (`503
// subtitles_unavailable`), отметка не ставится. Однажды — навсегда, в этом
// браузере и на этом домене, общая для всех ключей браузера (как в приложении).
// ≤ 5000 записей, старшие вытесняются. На «Выходе» не стирается (§6.2).
//
// Дополнительное видео (extra-video §9) ведёт СВОЮ отметку `flib:route-extra-listened`
// по тому же правилу: дневная и дополнительная не снимают гейт друг другу.
import { useEffect, useReducer } from 'react'
import { прослушанВесь, шумоваяРеплика, type Счётчик, type Реплика } from './subtitle-counter'

export const ROUTE_LISTENED_KEY = 'flib:route-listened'
export const ROUTE_LISTENED_MAX = 5000
export const EXTRA_LISTENED_KEY = 'flib:route-extra-listened'

function storage(): Storage | null {
  try { return typeof window !== 'undefined' ? window.localStorage : null } catch { return null }
}

// createListenedStore — «однажды прослушан — навсегда» в localStorage под своим ключом и событием.
function createListenedStore(key: string, event: string, max: number) {
  let cache: string[] | null = null
  const load = (): string[] => {
    if (cache) return cache
    try {
      const raw = JSON.parse(storage()?.getItem(key) || '[]')
      cache = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
    } catch {
      cache = []
    }
    return cache
  }
  const is = (puzzleId: string | null | undefined): boolean => {
    const id = (puzzleId ?? '').trim()
    return id !== '' && load().includes(id)
  }
  const mark = (puzzleId: string): void => {
    const id = (puzzleId ?? '').trim()
    if (!id || is(id)) return
    cache = [...load(), id].slice(-max)
    try { storage()?.setItem(key, JSON.stringify(cache)) } catch { /* помним до перезагрузки */ }
    try { window.dispatchEvent(new CustomEvent(event)) } catch { /* нет window */ }
  }
  const reset = (): void => { cache = null }
  // useIt — реактивно: прослушан ли ролик.
  const useIt = (puzzleId: string | null | undefined): boolean => {
    const [, bump] = useReducer((n: number) => n + 1, 0)
    useEffect(() => {
      const on = () => bump()
      window.addEventListener(event, on)
      return () => window.removeEventListener(event, on)
    }, [])
    return is(puzzleId)
  }
  return { is, mark, reset, useIt }
}

const dayStore = createListenedStore(ROUTE_LISTENED_KEY, 'flib-route-listened', ROUTE_LISTENED_MAX)
const extraStore = createListenedStore(EXTRA_LISTENED_KEY, 'flib-route-extra-listened', ROUTE_LISTENED_MAX)

export const isClipListened = dayStore.is
export const markClipListened = dayStore.mark
export const useClipListened = dayStore.useIt
export function __resetClipListenedForTests(): void { dayStore.reset() }

// Старый формат (голый puzzle_id) не совпадёт никогда: составной id всегда содержит «|».
// Отметка дополнительного видео — на пару (маршрут, ролик): `route_id|puzzle_id` (extra-video §9, ребро 23).
// Другой маршрут (после сброса/нового старта) — то же видео снова «не прослушано».
const extraId = (routeId: string | null | undefined, puzzleId: string | null | undefined): string => {
  const r = (routeId ?? '').trim(), p = (puzzleId ?? '').trim()
  return r && p ? `${r}|${p}` : ''
}
export const isExtraListened = (routeId: string | null | undefined, puzzleId: string | null | undefined): boolean => extraStore.is(extraId(routeId, puzzleId))
export const markExtraListened = (routeId: string, puzzleId: string): void => { const id = extraId(routeId, puzzleId); if (id) extraStore.mark(id) }
export const useExtraListened = (routeId: string | null | undefined, puzzleId: string | null | undefined): boolean => extraStore.useIt(extraId(routeId, puzzleId))
export function __resetExtraListenedForTests(): void { extraStore.reset() }

// shouldMarkListened — решение о постановке отметки по одному наблюдению.
//   counter — счётчик ролика (null — счёта нет);
//   trackResolved — дорожка окончательно получена или её нет вовсе (404);
//   cues — реплики дорожки; atEnd — ролик доигран (`конецРолика`).
export function shouldMarkListened(i: { counter: Счётчик | null; trackResolved: boolean; cues: Реплика[]; atEnd: boolean }): boolean {
  if (!i.trackResolved) return false
  if (i.counter && прослушанВесь(i.counter)) return true
  if (!i.atEnd) return false
  return !i.cues.some(r => !шумоваяРеплика(r.text))
}
