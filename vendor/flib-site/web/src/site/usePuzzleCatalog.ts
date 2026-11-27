// usePuzzleCatalog.ts — ленивый загрузчик каталога Puzzle Movies для FilmPicker.
//
// Contract v2 2026-07-16 [ID:P-film-picker] §3.2 (порт desktop
// .../route/useSkladchikCatalog.ts): грузит GET /api/puzzle/catalog (~6300
// строк, contract D1 — фильтр целиком на клиенте) ОДИН раз за жизнь вкладки —
// модульная переменная-кэш вместо desktop-стора usePuzzleMoviesStore (здесь
// нет общего Zustand-стора, модульный кэш даёт тот же эффект проще). Грузит
// ТОЛЬКО когда `active` — FilmPicker.tsx монтируется лишь пока пикер открыт,
// так что /try никогда не бьёт по BFF, если пользователь пикер не открыл.
import { useEffect, useState } from 'react'
import { fetchPuzzleCatalog, type PuzzleItem } from './api'

export interface PuzzleCatalogState {
  items: PuzzleItem[]
  loading: boolean
  error: string | null
}

let cachedItems: PuzzleItem[] | null = null
let inflight: Promise<PuzzleItem[]> | null = null

/** Тестовый seam — сбрасывает модульный кэш между тестами. Без него первый
 *  тест, открывший пикер, "прогревает" кэш на весь остальной test-run
 *  (модульная переменная переживает между it()-блоками в одном файле). */
export function resetPuzzleCatalogCache(): void {
  cachedItems = null
  inflight = null
}

export function usePuzzleCatalog(active: boolean): PuzzleCatalogState {
  const [items, setItems] = useState<PuzzleItem[]>(cachedItems ?? [])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!active || cachedItems) return // уже в кэше, или пикер ещё не открыт
    let cancelled = false
    setLoading(true)
    setError(null)
    // inflight — второй одновременный монтаж (маловероятно на /try, но дёшево
    // защититься) переиспользует уже летящий запрос вместо второго fetch.
    const promise = inflight ?? fetchPuzzleCatalog()
    inflight = promise
    promise
      .then(list => {
        // Пустой успешный ответ (front-аудит MED): BFF ДОЛЖЕН конвертить
        // total==0 / demo-restricted-пустышку в 502, но это фронт-защита-в-
        // глубину. НЕ кэшируем пустоту — иначе `[]` truthy → guard `cachedItems`
        // навсегда блокирует рефетч на всю сессию вкладки, а showFallback
        // (error && items.length===0) не сработает (200 без error) → мёртвый
        // пустой пикер без выхода. Пустой → error → FilmPicker рисует фолбэк-цели.
        if (list.length === 0) {
          if (!cancelled) setError('empty_catalog')
          return
        }
        cachedItems = list
        if (!cancelled) setItems(list)
      })
      .catch(e => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        inflight = null
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [active])

  return { items, loading, error }
}
