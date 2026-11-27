// CatalogInline.tsx — полный каталог тайтлов ВНУТРИ шага «Цель» (вместо полки из 11
// карточек): поиск, фильтры Тип / Год / Темп речи, чипы, «Найдено», сортировка, страницы
// по 30. Карточка — та же, что на полках (TitleCardView): постер выбирает, «Подробнее»
// открывает подробную карточку. Выбор живёт в QuickStart. Не диалог, прокрутку не блокирует.
import { CabI } from '../cab-icons'
import { TitleCardView } from '../route/TitleShelves'
import { CATALOG_UNAVAILABLE_TEXT, TOO_MANY_TITLES_TEXT } from '../route/start-model'
import type { TitleCard } from './catalog-api'
import {
  formatCount, NOTHING_FOUND, NOTHING_FOUND_HINT, pagesNext, PACE_OPTIONS, removeChip, RESET_FILTERS, SKELETON_COUNT,
  SORT_OPTIONS, TYPE_OPTIONS, YEAR_OPTIONS, type ChipKey, type PaceFilter, type SortKey, type TypeFilter, type YearFilter,
} from './catalog-model'
import { useCatalogList, type CatalogView } from './use-catalog-list'
import './catalog.css'

export const COLLAPSE_CATALOG_TEXT = 'Свернуть каталог'

export interface CatalogInlineProps {
  selected: ReadonlySet<string>
  /** Выбрано 10 тайтлов: остальные карточки неактивны. */
  capped: boolean
  onToggle: (c: TitleCard) => void
  onDetail: (c: TitleCard, snapshot?: string) => void
  onCollapse: () => void
  /** Все выбранные тайтлы (в т.ч. с других страниц и вне текущего фильтра) — чипы под панелью. */
  chosen?: ReadonlyArray<{ slug: string; title?: string }>
  onRemove?: (slug: string) => void
  /** Фильтры и поиск, сохранённые при сворачивании (L5): панель открывается с ними же. */
  saved?: CatalogView
  onViewChange?: (v: CatalogView) => void
}

export function CatalogInline({ selected, capped, onToggle, onDetail, onCollapse, chosen, onRemove, saved, onViewChange }: CatalogInlineProps) {
  const l = useCatalogList(saved, onViewChange)
  const { filters, setFilters, qInput, status, items, total, snapshot, more } = l
  return (
    <div className="ct" data-testid="catalog-inline">
      <div className="sh-h">
        <h3 tabIndex={-1}>Фильмы и сериалы</h3>
        <button type="button" className="btn sm" onClick={onCollapse}><CabI.left />{COLLAPSE_CATALOG_TEXT}</button>
      </div>

      <div className="inp plain ct-q">
        <CabI.search />
        <input type="text" inputMode="search" autoComplete="off" spellCheck={false} placeholder="Название на английском или русском"
          aria-label="Поиск по названию" value={qInput} onChange={e => l.onQuery(e.target.value)} />
        {qInput !== '' && <button type="button" className="eye" aria-label="Очистить" onClick={l.clearQuery}><CabI.x /></button>}
      </div>

      <div className="ct-f">
        <FilterSelect label="Тип" value={filters.type} options={TYPE_OPTIONS} onChange={v => setFilters(f => ({ ...f, type: v as TypeFilter }))} />
        <FilterSelect label="Год" value={filters.year} options={YEAR_OPTIONS} onChange={v => setFilters(f => ({ ...f, year: v as YearFilter }))} />
        <FilterSelect label="Темп речи" value={filters.pace} options={PACE_OPTIONS} onChange={v => setFilters(f => ({ ...f, pace: v as PaceFilter }))} />
      </div>

      <div className="ct-bar">
        <div className="ct-chips">
          {l.chips.map(c => (
            <span key={c.key} className="chip on sm">
              {c.label}: {c.value}
              <button type="button" className="x" aria-label={`Убрать фильтр ${c.label}`}
                onClick={() => setFilters(f => removeChip(f, c.key as ChipKey))}><CabI.x /></button>
            </span>
          ))}
          {l.dirty && <button type="button" className="gc-more" onClick={l.reset}>Сбросить</button>}
          {status === 'ready' && <div className="ct-found">Найдено: <b>{formatCount(total)}</b></div>}
        </div>
        <label className="sel">
          <span className="mono">Сортировка</span>
          <select aria-label="Сортировка" value={filters.sort} onChange={e => setFilters(f => ({ ...f, sort: e.target.value as SortKey }))}>
            {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <CabI.chev />
        </label>
      </div>

      {chosen && chosen.length > 0 && (
        <div className="ct-sel" data-testid="catalog-chosen">
          {chosen.map(t => (
            <span key={t.slug} className="chip on">
              {t.title || t.slug}
              <button type="button" className="x" aria-label={`Убрать цель ${t.title || t.slug}`}
                onClick={() => onRemove?.(t.slug)}><CabI.x /></button>
            </span>
          ))}
        </div>
      )}

      {capped && <p className="mute ct-cap" role="status">{TOO_MANY_TITLES_TEXT}</p>}

      {status === 'loading' && (
        <div className="gc-grid" aria-busy="true" data-testid="catalog-loading">
          {Array.from({ length: SKELETON_COUNT }, (_, i) => <div key={i} className="gc sk"><span className="pst none" /></div>)}
        </div>
      )}
      {status === 'error' && (
        <div className="msg err ct-err" role="alert">
          <CabI.alert /><span>{CATALOG_UNAVAILABLE_TEXT}</span>
          <button type="button" className="btn" onClick={l.retry}>Повторить</button>
        </div>
      )}
      {status === 'ready' && items.length === 0 && (
        <div className="ct-empty">
          <CabI.search />
          <div className="serif">{NOTHING_FOUND}</div>
          <div className="mute">{NOTHING_FOUND_HINT}</div>
          <button type="button" className="btn" onClick={l.reset}>{RESET_FILTERS}</button>
        </div>
      )}
      {status === 'ready' && items.length > 0 && (
        <>
          <div className="gc-grid">
            {items.map((c, i) => (
              <TitleCardView key={c.slug} card={c} hue={(i * 47 + 30) % 360} on={selected.has(c.slug)} capped={capped}
                onToggle={() => onToggle(c)} onDetail={card => onDetail(card, snapshot)} />
            ))}
          </div>
          {pagesNext(items.length, total) && (
            <div className="ct-more">
              {more === 'error' && <span className="mute" role="alert">{CATALOG_UNAVAILABLE_TEXT}</span>}
              <button type="button" className="btn" disabled={more === 'busy'} onClick={l.loadMore}>
                {more === 'error' ? 'Повторить' : 'Показать ещё'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function FilterSelect({ label, value, options, onChange }: {
  label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (v: string) => void
}) {
  return (
    <label className={'sel' + (value ? ' on' : '')}>
      <select aria-label={label} value={value} onChange={e => onChange(e.target.value)}>
        <option value="">{label}</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <CabI.chev />
    </label>
  )
}
