// PuzzleCard.tsx — карточка тайтла каталога Puzzle Movies (постер + бейдж
// сериала «С 1-й серии» + двуязычное название), рендер-логика ВЫНЕСЕНА из
// FilmPicker.tsx (contract [ID:P-abstract-goals] §1 §2.3, bottom-up шаг 5).
//
// Два потребителя: FilmPicker.tsx (сетка модалки, сохраняется до её удаления
// на последнем шаге контракта) И TryPage.tsx визард (шаг 2 «По тайтлам»,
// горизонтальный скролл-ряд, contract §2.2) — карточка сама по себе не знает
// ни про модалку, ни про визард, только про PuzzleItem + состояние выбора +
// клик, оба потребителя решают, что творить по клику (single-select замена
// у FilmPicker vs прямое добавление/удаление тапом у визарда, D7 Q3-a).
import { displayTitle, displayYear, slugHue, mediaKindLabel, isSeriesItem } from './puzzle-targets'
import { puzzlePreviewURL, type PuzzleItem } from './api'

export interface PuzzleCardProps {
  item: PuzzleItem
  selected: boolean
  onClick: () => void
}

export function PuzzleCard({ item, selected, onClick }: PuzzleCardProps) {
  const title = displayTitle(item)
  const year = displayYear(item)
  // Название на ДВУХ языках (запрос владельца 2026-07-16, как в desktop
  // TargetPicker.tsx:147): title = RU-предпочтительное, enSubtitle =
  // EN-название вторичной строкой, когда есть ОБА и они различаются (иначе
  // одно уже показано в title).
  const enSubtitle = item.title_ru && item.title_en && item.title_en !== title ? item.title_en : null
  const isSeries = isSeriesItem(item)
  return (
    <button
      type="button"
      data-slug={item.slug}
      className={'fp-card' + (selected ? ' selected' : '')}
      onClick={onClick}
    >
      <div
        className="fp-card-thumb"
        style={{ background: `linear-gradient(135deg, hsl(${slugHue(item.slug)} 30% 26%), hsl(${slugHue(item.slug)} 26% 16%))` }}
      >
        <img
          src={puzzlePreviewURL(item.slug)}
          alt={title}
          loading="lazy"
          onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
        />
        {/* Сериал = голый slug → демон якорит маршрут на пилоте s01e01
         *  (route_v2 ветка-2, «все серии одним маршрутом» в демоне не
         *  реализовано — решение владельца 2026-07-16: пилот-якорь +
         *  честный лейбл «С 1-й серии»). */}
        {isSeries && <span className="fp-card-badge">С 1-й серии</span>}
      </div>
      <div className="fp-card-body">
        <div className="fp-card-title">{title}</div>
        {enSubtitle && <div className="fp-card-en">{enSubtitle}</div>}
        <div className="fp-card-meta">
          <span>{mediaKindLabel(item.media_type)}</span>
          {year ? <><span>·</span><span>{year}</span></> : null}
          {isSeries && item.seasons > 0 ? <><span>·</span><span>{item.seasons} сез / {item.episodes} эп</span></> : null}
        </div>
      </div>
    </button>
  )
}
