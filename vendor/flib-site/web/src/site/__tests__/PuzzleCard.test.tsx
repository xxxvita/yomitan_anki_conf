// PuzzleCard.test.tsx — [ID:P-abstract-goals] Правка 6 (аудит MED): покрытие,
// потерянное с удалением FilmPicker.test.tsx (contract §2.3 удалил файл
// целиком вместе с single-select модалкой), для рендер-логики, вынесенной в
// отдельный компонент PuzzleCard.tsx (contract §1 bottom-up шаг 5). Из
// старого набора кейсов актуальны для ЭТОГО компонента: двуязычное название,
// бейдж «С 1-й серии», poster onError→скрывает img (градиент-фон остаётся
// виден за счёт inline background на родителе — сам компонент только прячет
// <img>). Debounce-окно поиска покрыт в TryPage.test.tsx (поиск — на уровне
// страницы, не карточки).
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PuzzleCard } from '../PuzzleCard'
import type { PuzzleItem } from '../api'

function item(overrides: Partial<PuzzleItem> = {}): PuzzleItem {
  return {
    slug: 'the-wire',
    title_en: 'The Wire',
    title_ru: 'Прослушка',
    media_type: 2,
    release_year: 2002,
    popularity: 90,
    seasons: 5,
    episodes: 60,
    ...overrides,
  }
}

describe('PuzzleCard', () => {
  it('серия (media_type=2) — рендерит бейдж «С 1-й серии»', () => {
    render(<PuzzleCard item={item({ media_type: 2 })} selected={false} onClick={() => {}} />)
    expect(screen.getByText('С 1-й серии')).toBeTruthy()
  })

  it('премиум (media_type=1) — сериал: бейдж «С 1-й серии» и «N сез / M эп»', () => {
    render(<PuzzleCard item={item({ slug: 'friends', media_type: 1, seasons: 10, episodes: 236 })} selected={false} onClick={() => {}} />)
    expect(screen.getByText('С 1-й серии')).toBeTruthy()
    expect(screen.getByText('10 сез / 236 эп')).toBeTruthy()
  })

  it('фильм (media_type=3) — бейдж «С 1-й серии» ОТСУТСТВУЕТ', () => {
    render(<PuzzleCard item={item({ media_type: 3, seasons: 0, episodes: 0 })} selected={false} onClick={() => {}} />)
    expect(screen.queryByText('С 1-й серии')).toBeNull()
  })

  it('оба языка присутствуют и различаются — title=RU, EN вторичной строкой', () => {
    render(<PuzzleCard item={item({ title_ru: 'Прослушка', title_en: 'The Wire' })} selected={false} onClick={() => {}} />)
    expect(screen.getByText('Прослушка')).toBeTruthy()
    expect(screen.getByText('The Wire')).toBeTruthy()
  })

  it('только EN-название (title_ru пуст) — EN-подпись НЕ дублируется отдельной строкой', () => {
    render(<PuzzleCard item={item({ title_ru: '', title_en: 'Inception' })} selected={false} onClick={() => {}} />)
    // title показывает "Inception" (fallback на title_en) — ОДИН раз, не рендерится
    // как title + отдельная EN-subtitle строка того же текста.
    expect(screen.getAllByText('Inception')).toHaveLength(1)
  })

  it('title_ru совпадает с title_en — EN-подпись не рендерится второй раз', () => {
    render(<PuzzleCard item={item({ title_ru: 'Up', title_en: 'Up' })} selected={false} onClick={() => {}} />)
    expect(screen.getAllByText('Up')).toHaveLength(1)
  })

  it('img onError скрывает постер (display:none), градиент-фон карточки остаётся', () => {
    render(<PuzzleCard item={item()} selected={false} onClick={() => {}} />)
    const img = screen.getByAltText('Прослушка') as HTMLImageElement
    expect(img.style.display).not.toBe('none')
    fireEvent.error(img)
    expect(img.style.display).toBe('none')
  })

  it('selected=true добавляет класс "selected"; клик по карточке зовёт onClick', () => {
    const onClick = vi.fn()
    render(<PuzzleCard item={item()} selected={true} onClick={onClick} />)
    const card = screen.getByRole('button', { name: /Прослушка/ })
    expect(card.className).toContain('selected')
    fireEvent.click(card)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('selected=false — класс "selected" отсутствует', () => {
    render(<PuzzleCard item={item()} selected={false} onClick={() => {}} />)
    const card = screen.getByRole('button', { name: /Прослушка/ })
    expect(card.className).not.toContain('selected')
  })
})
