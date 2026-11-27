// catalog-model.test.ts — чистая логика каталога и карточки (план S6, спека §7.6).
import { describe, it, expect } from 'vitest'
import {
  activeChips, buildListParams, EMPTY_FILTERS, formatCount, formatShare, GROUP_META, groupsToShow,
  hasFilters, paceBucket, paceMarks, pagesNext, PAGE_SIZE, phraseCountLabel, removeChip, tempoSourceLabel, wpmWord,
  type Filters,
} from '../catalog-model'
import type { TitleGroup } from '../catalog-api'

const PACE = { slow_below: 150, fast_from: 190 }

describe('buildListParams', () => {
  it('пустые фильтры: sort=popular, limit=30, offset=0; уровня и жанра в запросе нет', () => {
    const p = buildListParams(EMPTY_FILTERS, 0)
    expect(p).toEqual({ sort: 'popular', limit: PAGE_SIZE, offset: 0 })
    expect(Object.keys(p)).not.toContain('level')
    expect(Object.keys(p)).not.toContain('genre')
  })
  it('фильтры → параметры; год «до 2000» = year_to 1999, «2020 и новее» = year_from 2020', () => {
    const f: Filters = { q: '  Друз ', type: 'series', year: 'to1999', pace: 'fast', sort: 'new' }
    expect(buildListParams(f, 60, 'abcdabcdabcdabcd')).toEqual({
      q: 'Друз', type: 'series', pace: 'fast', year_to: 1999, sort: 'new', limit: 30, offset: 60, snapshot: 'abcdabcdabcdabcd',
    })
    expect(buildListParams({ ...EMPTY_FILTERS, year: 'from2020' }, 0)).toMatchObject({ year_from: 2020 })
    expect(buildListParams({ ...EMPTY_FILTERS, year: 'y2000' }, 0)).toMatchObject({ year_from: 2000, year_to: 2009 })
    expect(buildListParams({ ...EMPTY_FILTERS, year: 'y2010' }, 0)).toMatchObject({ year_from: 2010, year_to: 2019 })
  })
  it('поиск длиннее 80 рун обрезается по рунам, пустой после trim не уходит', () => {
    const q = 'я'.repeat(120)
    expect((buildListParams({ ...EMPTY_FILTERS, q }, 0).q ?? '').length).toBe(80)
    expect(buildListParams({ ...EMPTY_FILTERS, q: '   ' }, 0).q).toBeUndefined()
  })
  it('ошибочные значения фильтров не уходят (испорченное состояние)', () => {
    const bad = { q: '', type: 'level9', year: 'zzz', pace: 'warp', sort: 'level' } as unknown as Filters
    expect(buildListParams(bad, 0)).toEqual({ sort: 'popular', limit: 30, offset: 0 })
  })
})

describe('чипы и сброс', () => {
  it('чипы — только Тип, Год, Темп речи (поиск и сортировка — не чипы)', () => {
    const f: Filters = { q: 'x', type: 'film', year: 'y2000', pace: 'slow', sort: 'new' }
    expect(activeChips(f)).toEqual([
      { key: 'type', label: 'Тип', value: 'Фильмы' },
      { key: 'year', label: 'Год', value: '2000–2009' },
      { key: 'pace', label: 'Темп речи', value: 'Медленно' },
    ])
    expect(activeChips(EMPTY_FILTERS)).toEqual([])
  })
  it('removeChip снимает один фильтр; hasFilters учитывает поиск', () => {
    const f: Filters = { q: 'x', type: 'film', year: '', pace: '', sort: 'popular' }
    expect(removeChip(f, 'type').type).toBe('')
    expect(hasFilters(f)).toBe(true)
    expect(hasFilters({ ...f, q: '', type: '' })).toBe(false)
    expect(hasFilters({ ...f, q: '  ', type: '' })).toBe(false)
  })
})

describe('paceBucket — границы из конверта, не из констант', () => {
  it('терцили pace', () => {
    expect(paceBucket(149, PACE)).toBe('slow')
    expect(paceBucket(150, PACE)).toBe('normal')
    expect(paceBucket(189, PACE)).toBe('normal')
    expect(paceBucket(190, PACE)).toBe('fast')
    // при константах 160/178 эти значения дали бы slow и fast; по конверту 150/190 — normal
    expect(paceBucket(155, PACE)).toBe('normal')
    expect(paceBucket(185, PACE)).toBe('normal')
  })
  it('нет конверта или он битый — корзины нет', () => {
    expect(paceBucket(170, undefined)).toBeNull()
    expect(paceBucket(170, { slow_below: NaN, fast_from: 190 })).toBeNull()
    expect(paceBucket(170, { slow_below: 190, fast_from: 150 })).toBeNull()
    expect(paceBucket(Number.NaN, PACE)).toBeNull()
  })
  it('wpmWord: средняя подпись шкалы по корзине', () => {
    expect(wpmWord('slow')).toBe('медленнее обычного')
    expect(wpmWord('normal')).toBe('как в среднем')
    expect(wpmWord('fast')).toBe('быстрее обычного')
    expect(wpmWord(null)).toBe('')
  })
  it('paceMarks: шкала 100–240, значения вне шкалы прижаты, среднего нет — без метки', () => {
    expect(paceMarks(170, 170)).toEqual({ m: 50, avg: 50 })
    expect(paceMarks(60, 170)).toEqual({ m: 0, avg: 50 })
    expect(paceMarks(400, undefined)).toEqual({ m: 100, avg: null })
    expect(paceMarks(170, 0)).toEqual({ m: 50, avg: null })
  })
  it('подпись источника: p50 — без оценки, иное — «оценка»', () => {
    expect(tempoSourceLabel('p50')).toBe('')
    expect(tempoSourceLabel('p75_est')).toBe('оценка')
    expect(tempoSourceLabel('что-то новое')).toBe('оценка')
  })
})

describe('группы слов', () => {
  const g = (group: number, forms: number, extra: Partial<TitleGroup> = {}): TitleGroup => ({ group, forms, more: 0, share: 0.1, ...extra })
  it('пять групп с названиями и диапазонами владельца', () => {
    expect(GROUP_META.map(m => m.name)).toEqual(['Самые частые', 'Частые', 'Средние', 'Редкие', 'Очень редкие'])
    expect(GROUP_META.map(m => m.range)).toEqual([
      '1–1000 по частоте', '1001–2000 по частоте', '2001–5000 по частоте', '5001–10 000 по частоте', 'реже 10 000 по частоте',
    ])
  })
  it('groupsToShow: по порядку group, пустые, лишние и повторы не рисуются', () => {
    const out = groupsToShow([g(3, 10), g(1, 5), g(2, 0), g(7, 9), g(1, 99), g(5, 1)])
    expect(out.map(x => x.group.group)).toEqual([1, 3, 5])
    expect(out[0].group.forms).toBe(5)
    expect(out[0].meta.name).toBe('Самые частые')
  })
  it('groupsToShow устойчива к не-массиву и мусору', () => {
    expect(groupsToShow(undefined as unknown as TitleGroup[])).toEqual([])
    expect(groupsToShow([null, 3, { group: 'a' }] as unknown as TitleGroup[])).toEqual([])
  })
})

describe('форматы', () => {
  it('formatShare: запятая и пробел перед %, малые доли', () => {
    expect(formatShare(0.943)).toBe('94,3 %')
    expect(formatShare(0.0287)).toBe('2,9 %')
    expect(formatShare(0.0004)).toBe('меньше 0,1 %')
    expect(formatShare(0)).toBe('0 %')
    expect(formatShare(Number.NaN)).toBe('')
    expect(formatShare(1.2)).toBe('100 %')
  })
  it('formatCount: разделитель тысяч — неразрывный пробел', () => {
    expect(formatCount(1067)).toBe('1 067')
    expect(formatCount(7)).toBe('7')
    expect(formatCount(-3)).toBe('0')
  })
  it('phraseCountLabel: склонение', () => {
    expect(phraseCountLabel(1067)).toBe('оборотов')
    expect(phraseCountLabel(1)).toBe('оборот')
    expect(phraseCountLabel(23)).toBe('оборота')
  })
  it('pagesNext: «Показать ещё» только пока загружено меньше total', () => {
    expect(pagesNext(30, 100)).toBe(true)
    expect(pagesNext(100, 100)).toBe(false)
    expect(pagesNext(0, 0)).toBe(false)
  })
})
