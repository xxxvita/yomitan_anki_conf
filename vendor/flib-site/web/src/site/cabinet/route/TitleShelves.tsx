// TitleShelves.tsx — полки тайтлов экрана старта при включённом каталоге (спека
// 2026-11-19 §7.5): «Популярное» (`sort=popular&limit=11` + плитка «Все фильмы и
// сериалы → / N в каталоге») и «Недавние» (выбранное или открытое на этом
// устройстве, одним `?slugs=`; пусто — переключатель скрыт). Полки «Для {уровень}»
// нет (Р-В6): уровня тайтла нигде нет.
//
// Хук useTitleShelves только грузит; вид — TitleShelves. Постер — НАШ каталог
// (`/api/puzzle/preview?slug=`), не IMDb.
import { useCallback, useEffect, useState } from 'react'
import { CabI } from '../cab-icons'
import { listTitles, titlesBySlugs, type TitleCard } from '../catalog/catalog-api'
import { GoalPoster } from './GoalPoster'
import { ALL_TITLES_TEXT, CATALOG_UNAVAILABLE_TEXT, imdbUrl, POPULAR_LABEL, RECENT_LABEL, TITLE_OFF_TEXT, TOO_MANY_TITLES_TEXT, totalLabel, typeLabel } from './start-model'

export type ShelfId = 'popular' | 'recent'

export interface ShelfState {
  status: 'loading' | 'ready' | 'error'
  items: TitleCard[]
  /** Всего в каталоге (только у «Популярного»). */
  total: number
  /** Версия снимка, из которого пришла полка: уходит в запрос подробной карточки. */
  snapshot?: string
}

const LOADING: ShelfState = { status: 'loading', items: [], total: 0 }
export const POPULAR_LIMIT = 11
const RECENT_MAX = 20 // ?slugs= принимает 1…20

export interface TitleShelvesData {
  popular: ShelfState
  recent: ShelfState
  retry: () => void
}

// useTitleShelves — «Популярное» грузится при включении, «Недавние» — когда полка
// открыта (по списку slug на момент открытия). Устаревший ответ (список сменился
// или компонент ушёл) отбрасывается.
export function useTitleShelves(enabled: boolean, shelf: ShelfId, recentSlugs: string[]): TitleShelvesData {
  const [popular, setPopular] = useState<ShelfState>(LOADING)
  const [recent, setRecent] = useState<ShelfState>(LOADING)
  const [nonce, setNonce] = useState(0)
  const retry = useCallback(() => setNonce(n => n + 1), [])
  const recentKey = recentSlugs.slice(0, RECENT_MAX).join(',')

  useEffect(() => {
    if (!enabled) return
    let alive = true
    setPopular(LOADING)
    void listTitles({ sort: 'popular', limit: POPULAR_LIMIT }).then(r => {
      if (!alive) return
      setPopular(r.ok && Array.isArray(r.data?.items)
        ? { status: 'ready', items: r.data.items, total: typeof r.data.total === 'number' ? r.data.total : r.data.items.length, snapshot: typeof r.data.snapshot === 'string' ? r.data.snapshot : undefined }
        : { status: 'error', items: [], total: 0 })
    })
    return () => { alive = false }
  }, [enabled, nonce])

  useEffect(() => {
    if (!enabled || shelf !== 'recent') return
    if (recentKey === '') { setRecent({ status: 'ready', items: [], total: 0 }); return }
    let alive = true
    setRecent(LOADING)
    const slugs = recentKey.split(',')
    void titlesBySlugs(slugs).then(r => {
      if (!alive) return
      if (!r.ok || !Array.isArray(r.data?.items)) { setRecent({ status: 'error', items: [], total: 0 }); return }
      // Порядок — как в «Недавних» (новые впереди), а не как ответил сервер.
      const by = new Map(r.data.items.map(i => [i.slug, i]))
      setRecent({ status: 'ready', items: slugs.flatMap(s => by.get(s) ?? []), total: 0, snapshot: typeof r.data.snapshot === 'string' ? r.data.snapshot : undefined })
    })
    return () => { alive = false }
  }, [enabled, shelf, recentKey, nonce])

  return { popular, recent, retry }
}

export const displayTitle = (c: Pick<TitleCard, 'title_ru' | 'title_en'>): string => c.title_ru || c.title_en

export interface TitleShelvesProps {
  shelf: ShelfId
  onShelf: (s: ShelfId) => void
  hasRecent: boolean
  data: TitleShelvesData
  selected: ReadonlySet<string>
  /** Выбрано 10 тайтлов (потолок PD-4): остальные карточки неактивны. */
  capped?: boolean
  onToggle: (c: TitleCard) => void
  /** Плитка «Все фильмы и сериалы →» открывает панель каталога (S6). */
  onOpenCatalog?: () => void
  /** «Подробнее» открывает подробную карточку (S6); нет обработчика — кнопки нет. Второй
   *  аргумент — версия снимка полки. */
  onDetail?: (c: TitleCard, snapshot?: string) => void
}

export function TitleShelves({ shelf, onShelf, hasRecent, data, selected, capped, onToggle, onOpenCatalog, onDetail }: TitleShelvesProps) {
  const cur = shelf === 'recent' && hasRecent ? data.recent : data.popular
  const showRecent = shelf === 'recent' && hasRecent
  return (
    <>
      <div className="sh-h">
        <h3>Фильмы и сериалы</h3>
        {hasRecent && (
          <div className="seg" role="group" aria-label="Подборки">
            <button type="button" className={!showRecent ? 'on' : ''} aria-pressed={!showRecent} onClick={() => onShelf('popular')}>{POPULAR_LABEL}</button>
            <button type="button" className={showRecent ? 'on' : ''} aria-pressed={showRecent} onClick={() => onShelf('recent')}>{RECENT_LABEL}</button>
          </div>
        )}
      </div>
      {cur.status === 'loading' && (
        <div className="gc-grid" aria-busy="true" data-testid="shelf-loading">
          {Array.from({ length: 6 }, (_, i) => <div key={i} className="gc sk"><span className="pst none" /></div>)}
        </div>
      )}
      {cur.status === 'error' && (
        <div className="msg err st-shelf-err" role="alert">
          <CabI.alert /><span>{CATALOG_UNAVAILABLE_TEXT}</span>
          <button type="button" className="btn" onClick={data.retry}>Повторить</button>
        </div>
      )}
      {cur.status === 'ready' && (
        <div className="gc-grid">
          {cur.items.map((c, i) => (
            <TitleCardView key={c.slug} card={c} hue={(i * 47 + 30) % 360} on={selected.has(c.slug)} capped={capped === true} onToggle={() => onToggle(c)} onDetail={onDetail && (card => onDetail(card, cur.snapshot))} />
          ))}
          {!showRecent && (
            <button type="button" className="gc-all" onClick={() => onOpenCatalog?.()}>
              <span className="serif">{ALL_TITLES_TEXT}</span>
              <span className="mute">{totalLabel(cur.total)}</span>
              <CabI.right />
            </button>
          )}
        </div>
      )}
      {cur.status === 'ready' && capped && <p className="mute st-cap" role="status">{TOO_MANY_TITLES_TEXT}</p>}
    </>
  )
}

// TitleCardView — карточка тайтла (дизайн §3a) без метки уровня: постер — кнопка
// выбора (aria-pressed), IMDb — своя зона, «18+» при age_limit ≥ 18, нет постера —
// плашка, goal_ok=false — неактивна и «Пока нельзя выбрать».
export function TitleCardView({ card: c, hue, on, capped, onToggle, onDetail }: {
  card: TitleCard; hue: number; on: boolean; capped?: boolean; onToggle: () => void; onDetail?: (c: TitleCard) => void
}) {
  const name = displayTitle(c)
  const off = c.goal_ok !== true
  const sub = [typeLabel(c.type), c.year ? String(c.year) : ''].filter(Boolean).join(' · ')
  return (
    <div className={'gc' + (on ? ' on' : '') + (off ? ' off' : '')} data-slug={c.slug}>
      <button type="button" className="gc-hit" aria-pressed={on} aria-label={name} disabled={(off || capped === true) && !on} onClick={onToggle}>
        <GoalPoster slug={c.slug} title={name} hue={hue} on={on} />
      </button>
      <div className="gc-b">
        <div className="gc-t">{name}</div>
        {(sub || (c.age_limit ?? 0) >= 18) && (
          <div className="gc-s">{sub && <span>{sub}</span>}{(c.age_limit ?? 0) >= 18 && <span className="gc-age">18+</span>}</div>
        )}
        {off && <div className="gc-off">{TITLE_OFF_TEXT}</div>}
        <div className="gc-a">
          {c.imdb_id && (
            <a className="imdb" href={imdbUrl(c.imdb_id)} target="_blank" rel="noopener noreferrer" aria-label={`${name} на IMDb`}>IMDb</a>
          )}
          {onDetail && <button type="button" className="gc-more" onClick={() => onDetail(c)}>Подробнее</button>}
        </div>
      </div>
    </div>
  )
}
