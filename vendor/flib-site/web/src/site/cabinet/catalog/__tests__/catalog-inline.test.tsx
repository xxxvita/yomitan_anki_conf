// catalog-inline.test.tsx — полный каталог внутри шага «Цель» (план S6, спека §7.6; встраивание — S7a): состояния,
// запросы, поиск с задержкой, фильтры без уровня и жанра, «Показать ещё», 409/429/503,
// выбор (потолок 10, goal_ok), клавиатура.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { CatalogInline, type CatalogInlineProps } from '../CatalogInline'
import { card, FakeCatalog, json, many, SNAP, SNAP2 } from './fake-catalog'

let fc: FakeCatalog
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  fc = new FakeCatalog()
  fc.titles = many(5)
  fc.install()
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.style.overflow = '' })

function props(over: Partial<CatalogInlineProps> = {}): CatalogInlineProps {
  return { selected: new Set(), capped: false, onToggle: vi.fn(), onDetail: vi.fn(), onCollapse: vi.fn(), ...over }
}
async function open(over: Partial<CatalogInlineProps> = {}) {
  const p = props(over)
  const r = render(<CatalogInline {...p} />)
  await waitFor(() => expect(document.querySelector('.gc-grid .gc:not(.sk)')).not.toBeNull())
  return { p, ...r }
}
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

describe('вид и первый запрос', () => {
  it('скелет 12 карточек, затем сетка; один запрос sort=popular&limit=30&offset=0 (ни уровня, ни жанра)', async () => {
    render(<CatalogInline {...props()} />)
    expect(screen.getByTestId('catalog-loading').querySelectorAll('.gc.sk').length).toBe(12)
    await screen.findAllByText('Title 1')
    expect(fc.list()).toEqual(['/api/me/catalog/titles?sort=popular&limit=30&offset=0'])
    expect(document.querySelectorAll('.gc-grid .gc').length).toBe(5)
  })

  it('не диалог и не блокирует прокрутку; заголовок и «Свернуть каталог»; Найдено; без уровня и «Проще → сложнее»', async () => {
    await open()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.body.style.overflow).toBe('')
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('Фильмы и сериалы')
    expect(screen.getByRole('button', { name: 'Свернуть каталог' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Готово' })).toBeNull()
    expect(screen.getByPlaceholderText('Название на английском или русском')).toBeTruthy()
    expect(document.querySelector('.ct-found')?.textContent).toBe('Найдено: 5')
    const text = document.querySelector('.ct')?.textContent ?? ''
    expect(text).not.toMatch(/Уровень|Проще|Жанр|YouTube-каналы|Вы знаете|Скрыть знакомые/)
    // фильтры — ровно Тип, Год, Темп речи, плюс сортировка
    expect(screen.getAllByRole('combobox').map(c => c.getAttribute('aria-label'))).toEqual(['Тип', 'Год', 'Темп речи', 'Сортировка'])
    const sort = screen.getByRole('combobox', { name: 'Сортировка' })
    expect(Array.from(sort.querySelectorAll('option')).map(o => o.textContent)).toEqual(['Популярное', 'Новое'])
  })

  it('«Свернуть каталог» зовёт onCollapse', async () => {
    const { p } = await open()
    fireEvent.click(screen.getByRole('button', { name: 'Свернуть каталог' }))
    expect(p.onCollapse).toHaveBeenCalledTimes(1)
  })

  it('«Найдено» — total с разделителем тысяч, а не число загруженных', async () => {
    fc.total = 6312
    await open()
    expect(document.querySelector('.ct-found b')?.textContent).toBe('6 312')
  })

  it('карточка: 18+ при age_limit ≥ 18, IMDb с rel, «Пока нельзя выбрать», год и тип; метки уровня нет', async () => {
    fc.titles = [
      card('house', { title_en: 'House', title_ru: 'Доктор Хаус', year: 2004, age_limit: 18, imdb_id: 'tt0412142' }),
      card('kids', { title_en: 'Kids', age_limit: 17 }),
      card('locked', { title_en: 'Locked', goal_ok: false, type: 'film' }),
    ]
    await open()
    const house = document.querySelector('[data-slug="house"]') as HTMLElement
    expect(within(house).getByText('18+')).toBeTruthy()
    expect(house.querySelector('.gc-s')?.textContent).toContain('Сериал · 2004')
    const imdb = within(house).getByRole('link', { name: /IMDb/ }) as HTMLAnchorElement
    expect(imdb.getAttribute('rel')).toBe('noopener noreferrer')
    expect(imdb.getAttribute('target')).toBe('_blank')
    expect(imdb.href).toBe('https://www.imdb.com/title/tt0412142/')
    expect(within(document.querySelector('[data-slug="kids"]') as HTMLElement).queryByText('18+')).toBeNull()
    const locked = document.querySelector('[data-slug="locked"]') as HTMLElement
    expect(within(locked).getByText('Пока нельзя выбрать')).toBeTruthy()
    expect((within(locked).getByRole('button', { name: 'Locked' }) as HTMLButtonElement).disabled).toBe(true)
    expect(document.querySelector('.gc-l')).toBeNull()
  })
})

describe('поиск', () => {
  it('запрос через 300 мс; быстрый ввод отменяет прежний — уходит один запрос с последним текстом', async () => {
    await open()
    const q = screen.getByPlaceholderText('Название на английском или русском')
    fc.calls = []
    fireEvent.change(q, { target: { value: 'dru' } })
    await advance(200)
    fireEvent.change(q, { target: { value: 'друз' } })
    await advance(200)
    expect(fc.list()).toEqual([]) // с первого ввода прошло 400 мс, но таймер перезапущен
    await advance(150)
    expect(fc.list()).toEqual(['/api/me/catalog/titles?q=%D0%B4%D1%80%D1%83%D0%B7&sort=popular&limit=30&offset=0'])
  })

  it('устаревший ответ не затирает свежий', async () => {
    let release!: (r: Response) => void
    await open()
    const q = screen.getByPlaceholderText('Название на английском или русском')
    fc.reply = url => {
      if (url.includes('q=slow')) return new Promise<Response>(res => { release = res })
      return null
    }
    fireEvent.change(q, { target: { value: 'slow' } })
    await advance(310)
    fc.titles = [card('fresh', { title_en: 'Fresh One' })]
    fireEvent.change(q, { target: { value: 'fresh' } })
    await advance(310)
    await screen.findAllByText('Fresh One')
    release(json(200, { snapshot: SNAP, total: 1, pace: { slow_below: 160, fast_from: 178 }, items: [card('stale', { title_en: 'Stale One' })] }))
    await advance(10)
    expect(screen.queryByText('Stale One')).toBeNull()
    expect(screen.getAllByText('Fresh One').length).toBeGreaterThan(0)
  })

  it('«Очистить» сбрасывает поиск сразу; поле длиннее 80 рун обрезается', async () => {
    await open()
    const q = screen.getByPlaceholderText('Название на английском или русском') as HTMLInputElement
    fireEvent.change(q, { target: { value: 'я'.repeat(120) } })
    expect(Array.from(q.value).length).toBe(80)
    await advance(310)
    fc.calls = []
    fireEvent.click(screen.getByRole('button', { name: 'Очистить' }))
    await waitFor(() => expect(fc.list().length).toBe(1))
    expect(fc.list()[0]).toBe('/api/me/catalog/titles?sort=popular&limit=30&offset=0')
    expect(q.value).toBe('')
    expect(screen.queryByRole('button', { name: 'Очистить' })).toBeNull()
  })
})

describe('фильтры, чипы, сортировка', () => {
  it('Тип + Год + Темп речи → параметры; чипы с «Убрать фильтр …»; «Сбросить» чистит всё', async () => {
    await open()
    fc.calls = []
    fireEvent.change(screen.getByRole('combobox', { name: 'Тип' }), { target: { value: 'series' } })
    await waitFor(() => expect(fc.list().length).toBe(1))
    fireEvent.change(screen.getByRole('combobox', { name: 'Год' }), { target: { value: 'from2020' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Темп речи' }), { target: { value: 'fast' } })
    await waitFor(() => expect(fc.list().length).toBe(3))
    expect(fc.list()[2]).toBe('/api/me/catalog/titles?type=series&pace=fast&year_from=2020&sort=popular&limit=30&offset=0')
    const chips = Array.from(document.querySelectorAll('.ct-chips .chip')).map(c => c.textContent)
    expect(chips).toEqual(['Тип: Сериалы', 'Год: 2020 и новее', 'Темп речи: Быстро'])
    fireEvent.click(screen.getByRole('button', { name: 'Убрать фильтр Год' }))
    await waitFor(() => expect(fc.list().length).toBe(4))
    expect(fc.list()[3]).not.toContain('year_from')
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить' }))
    await waitFor(() => expect(fc.list().length).toBe(5))
    expect(fc.list()[4]).toBe('/api/me/catalog/titles?sort=popular&limit=30&offset=0')
    expect(document.querySelectorAll('.ct-chips .chip').length).toBe(0)
  })

  it('сортировка «Новое» → sort=new и первая страница заново', async () => {
    await open()
    fc.calls = []
    fireEvent.change(screen.getByRole('combobox', { name: 'Сортировка' }), { target: { value: 'new' } })
    await waitFor(() => expect(fc.list()).toEqual(['/api/me/catalog/titles?sort=new&limit=30&offset=0']))
  })
})

describe('пусто, сбой, повторы', () => {
  it('«Ничего не нашлось.» + «Уберите часть фильтров.» + «Сбросить фильтры»', async () => {
    fc.titles = []
    render(<CatalogInline {...props()} />)
    await screen.findByText('Ничего не нашлось.')
    expect(screen.getByText('Уберите часть фильтров.')).toBeTruthy()
    fc.titles = many(2)
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить фильтры' }))
    await screen.findAllByText('Title 1')
  })

  it('503 catalog_unavailable → текст и «Повторить»; повтор работает', async () => {
    let n = 0
    fc.reply = () => (n++ === 0 ? json(503, { error: 'catalog_unavailable' }, { 'Retry-After': '5' }) : null)
    render(<CatalogInline {...props()} />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Каталог временно недоступен. Попробуйте через минуту.')
    fireEvent.click(within(alert).getByRole('button', { name: 'Повторить' }))
    await screen.findAllByText('Title 1')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('429 busy: молча повтор через Retry-After, плашки ошибки нет', async () => {
    let n = 0
    fc.reply = () => (n++ === 0 ? json(429, { error: 'busy' }, { 'Retry-After': '1' }) : null)
    render(<CatalogInline {...props()} />)
    await advance(1100)
    await screen.findAllByText('Title 1')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(fc.list().length).toBe(2)
  })
})

describe('«Показать ещё»', () => {
  it('по 30: второй запрос с offset и snapshot, дописывает; кнопка исчезает, когда всё загружено', async () => {
    fc.titles = many(45)
    await open()
    expect(document.querySelectorAll('.gc-grid .gc').length).toBe(30)
    fireEvent.click(screen.getByRole('button', { name: 'Показать ещё' }))
    await screen.findAllByText('Title 45')
    expect(fc.list()[1]).toBe(`/api/me/catalog/titles?sort=popular&limit=30&offset=30&snapshot=${SNAP}`)
    expect(document.querySelectorAll('.gc-grid .gc').length).toBe(45)
    expect(screen.queryByRole('button', { name: 'Показать ещё' })).toBeNull()
  })

  it('409 snapshot_changed: список перечитывается с первой страницы без snapshot, выбор сохраняется', async () => {
    fc.titles = many(45)
    const selected = new Set(['t2'])
    const { p } = await open({ selected })
    expect((document.querySelector('[data-slug="t2"]') as HTMLElement).className).toContain('on')
    fc.reply = url => (url.includes('offset=30') ? json(409, { error: 'snapshot_changed' }) : null)
    fc.snapshot = SNAP2
    fc.calls = []
    fireEvent.click(screen.getByRole('button', { name: 'Показать ещё' }))
    await waitFor(() => expect(fc.list().length).toBe(2))
    expect(fc.list()[1]).toBe('/api/me/catalog/titles?sort=popular&limit=30&offset=0')
    await screen.findAllByText('Title 1')
    expect(document.querySelectorAll('.gc-grid .gc').length).toBe(30)
    expect((document.querySelector('[data-slug="t2"]') as HTMLElement).className).toContain('on')
    expect(p.onToggle).not.toHaveBeenCalled()
    // следующая страница уже идёт с новой версией
    fireEvent.click(screen.getByRole('button', { name: 'Показать ещё' }))
    await waitFor(() => expect(fc.list().some(u => u.includes(`snapshot=${SNAP2}`))).toBe(true))
  })

  it('сбой «Показать ещё» — сообщение и «Повторить», уже загруженное остаётся', async () => {
    fc.titles = many(45)
    await open()
    fc.reply = url => (url.includes('offset=30') ? json(503, { error: 'catalog_unavailable' }) : null)
    fireEvent.click(screen.getByRole('button', { name: 'Показать ещё' }))
    await screen.findByRole('alert')
    expect(document.querySelectorAll('.gc-grid .gc').length).toBe(30)
    fc.reply = null
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    await screen.findAllByText('Title 45')
  })
})

describe('выбор', () => {
  it('постер зовёт onToggle; у выбранной aria-pressed; у каждой карточки есть «Подробнее»', async () => {
    const { p } = await open({ selected: new Set(['t1']) })
    const on = within(document.querySelector('[data-slug="t1"]') as HTMLElement).getByRole('button', { name: 'Title 1' })
    expect(on.getAttribute('aria-pressed')).toBe('true')
    const off = within(document.querySelector('[data-slug="t2"]') as HTMLElement).getByRole('button', { name: 'Title 2' })
    expect(off.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(off)
    expect(p.onToggle).toHaveBeenCalledTimes(1)
    expect((p.onToggle as ReturnType<typeof vi.fn>).mock.calls[0][0].slug).toBe('t2')
    expect(screen.getAllByRole('button', { name: 'Подробнее' }).length).toBe(5)
  })

  it('выбрано 10: остальные постеры неактивны, выбранный можно снять, «Можно выбрать до 10 целей»', async () => {
    await open({ selected: new Set(['t1']), capped: true })
    expect(document.querySelector('.ct-cap')?.textContent).toBe('Можно выбрать до 10 целей')
    const t2 = within(document.querySelector('[data-slug="t2"]') as HTMLElement).getByRole('button', { name: 'Title 2' }) as HTMLButtonElement
    expect(t2.disabled).toBe(true)
    const t1 = within(document.querySelector('[data-slug="t1"]') as HTMLElement).getByRole('button', { name: 'Title 1' }) as HTMLButtonElement
    expect(t1.disabled).toBe(false)
  })

  it('«Подробнее» открывает подробную карточку со снимком списка', async () => {
    const { p } = await open()
    fireEvent.click(within(document.querySelector('[data-slug="t3"]') as HTMLElement).getByRole('button', { name: 'Подробнее' }))
    expect(p.onDetail).toHaveBeenCalledTimes(1)
    const [c, snap] = (p.onDetail as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(c.slug).toBe('t3')
    expect(snap).toBe(SNAP)
  })
})
