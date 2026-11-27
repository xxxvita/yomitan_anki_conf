// use-placement.ts — сводка теста уровня для Главной, старта маршрута, «Моих знаний» (спека §4).
// Один запрос `GET /api/me/placement/summary` на вкладку и на того, кто вошёл (profileIdent); сброс —
// invalidatePlacement() после любой записи теста.
import { useCallback, useEffect, useState } from 'react'
import { useSession } from '../../useSession'
import { profileIdent } from '../profile-api'
import { placementApi, type PlacementSummary } from './placement-api'
import { hasLiveSession } from './site-host'

type Read = { ok: true; data: PlacementSummary } | { ok: false }

let cache: { ident: string; gen: number; p: Promise<Read> } | null = null
let gen = 0
const listeners = new Set<() => void>()

function fetchSummary(ident: string): Promise<Read> {
  if (cache && cache.ident === ident && cache.gen === gen) return cache.p
  const my = gen
  const p: Promise<Read> = placementApi.summary().then(
    (r): Read => (r.ok ? { ok: true, data: r.data } : { ok: false }),
    (): Read => ({ ok: false }),
  )
  cache = { ident, gen: my, p }
  // Сбой не кэшируется: следующее монтирование (или reload) спросит заново.
  void p.then((r) => { if (!r.ok && cache && cache.p === p) cache = null })
  return p
}

/** Сбросить общий кэш (после записи теста) и перечитать у всех, кто его показывает. */
export function invalidatePlacement(): void {
  gen++
  cache = null
  for (const l of [...listeners]) l()
}

export interface PlacementView {
  loading: boolean
  error: boolean
  summary?: PlacementSummary
  /** Есть живой незаконченный прогон этого владельца (localStorage). */
  unfinished: boolean
  reload: () => void
}

export function usePlacement(enabled = true): PlacementView {
  const s = useSession()
  const ident = profileIdent(s)
  const [tick, setTick] = useState(0)
  const [st, setSt] = useState<{ ident: string; loading: boolean; read?: Read }>({ ident, loading: true })

  useEffect(() => {
    const l = () => setTick((n) => n + 1)
    listeners.add(l)
    return () => { listeners.delete(l) }
  }, [])

  useEffect(() => {
    if (ident === 'out' || !enabled) { setSt({ ident, loading: false }); return }
    let alive = true
    setSt((p) => ({ ident, loading: true, read: p.ident === ident ? p.read : undefined }))
    void fetchSummary(ident).then((read) => {
      // Перечитывание не удалось — последний годный ответ ЭТОГО ключа остаётся (иначе сбой сети убирает результат теста с экрана).
      if (alive) setSt((p) => ({ ident, loading: false, read: !read.ok && p.ident === ident && p.read?.ok ? p.read : read }))
    })
    return () => { alive = false }
  }, [ident, tick, enabled])

  const reload = useCallback(() => invalidatePlacement(), [])
  const cur = st.ident === ident ? st : { ident, loading: true } as typeof st
  const summary = enabled && cur.read && cur.read.ok ? cur.read.data : undefined
  return {
    loading: cur.loading,
    error: enabled && !cur.loading && !!cur.read && !cur.read.ok,
    ...(summary ? { summary } : {}),
    unfinished: summary ? hasLiveSession(summary.owner) : false,
    reload,
  }
}

export function __resetPlacementCacheForTests(): void {
  cache = null
  gen++
  listeners.clear()
}
