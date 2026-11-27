// use-catalog-list.ts — данные и запросы полного каталога тайтлов (поиск через 300 мс,
// фильтры, сортировка, страницы по 30, 409 snapshot_changed → с первой страницы).
// Устаревший ответ отбрасывается по номеру запроса. Вид — CatalogInline.
import { useCallback, useEffect, useRef, useState } from 'react'
import { listTitles, type TitleCard } from './catalog-api'
import {
  activeChips, buildListParams, EMPTY_FILTERS, hasFilters, SEARCH_DEBOUNCE_MS, SEARCH_MAX_RUNES, type Filters,
} from './catalog-model'

export type CatalogStatus = 'loading' | 'ready' | 'error'

export interface CatalogView { filters: Filters; qInput: string }

export function useCatalogList(saved?: CatalogView, onViewChange?: (v: CatalogView) => void) {
  const [filters, setFilters] = useState<Filters>(saved ? { ...saved.filters, q: saved.qInput } : EMPTY_FILTERS)
  const [qInput, setQInput] = useState(saved?.qInput ?? '')
  // Вид (фильтры + поле поиска) уходит владельцу: при сворачивании и повторном открытии он возвращается.
  const viewCb = useRef(onViewChange)
  viewCb.current = onViewChange
  useEffect(() => { viewCb.current?.({ filters, qInput }) }, [filters, qInput])
  const [status, setStatus] = useState<CatalogStatus>('loading')
  const [items, setItems] = useState<TitleCard[]>([])
  const [total, setTotal] = useState(0)
  const [snapshot, setSnapshot] = useState<string | undefined>(undefined)
  const [more, setMore] = useState<'idle' | 'busy' | 'error'>('idle')
  const [nonce, setNonce] = useState(0)
  const seq = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  // Первая страница: на любую смену запроса (фильтры, поиск, сортировка, «Повторить», 409).
  useEffect(() => {
    const my = ++seq.current
    setStatus('loading'); setItems([]); setMore('idle')
    void listTitles(buildListParams(filters, 0)).then(r => {
      if (my !== seq.current) return // устаревший ответ
      if (!r.ok || !Array.isArray(r.data?.items)) { setStatus('error'); return }
      setItems(r.data.items)
      setTotal(typeof r.data.total === 'number' ? r.data.total : r.data.items.length)
      setSnapshot(typeof r.data.snapshot === 'string' ? r.data.snapshot : undefined)
      setStatus('ready')
    })
  }, [filters, nonce])

  const loadMore = useCallback(() => {
    const my = seq.current
    setMore('busy')
    void listTitles(buildListParams(filters, items.length, snapshot)).then(r => {
      if (my !== seq.current) return
      if (!r.ok && r.status === 409) { setNonce(n => n + 1); return } // версия сменилась: с первой страницы
      if (!r.ok || !Array.isArray(r.data?.items)) { setMore('error'); return }
      const next = r.data.items
      setItems(cur => [...cur, ...next.filter(n => !cur.some(c => c.slug === n.slug))])
      if (typeof r.data.total === 'number') setTotal(r.data.total)
      setMore('idle')
    })
  }, [filters, items.length, snapshot])

  const onQuery = (v: string) => {
    const q = Array.from(v).slice(0, SEARCH_MAX_RUNES).join('')
    setQInput(q)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setFilters(f => (f.q === q ? f : { ...f, q })), SEARCH_DEBOUNCE_MS)
  }
  const clearQuery = () => {
    if (timer.current) clearTimeout(timer.current)
    setQInput('')
    setFilters(f => (f.q === '' ? f : { ...f, q: '' }))
  }
  const reset = () => {
    if (timer.current) clearTimeout(timer.current)
    setQInput('')
    setFilters(f => ({ ...EMPTY_FILTERS, sort: f.sort }))
  }
  const retry = () => setNonce(n => n + 1)

  return {
    filters, setFilters, qInput, status, items: items as TitleCard[], total, snapshot, more,
    onQuery, clearQuery, reset, retry, loadMore,
    chips: activeChips(filters), dirty: hasFilters({ ...filters, q: qInput }),
  }
}
