// title-detail.test.tsx — подробная карточка тайтла (план S6, спека §7.6, Р-В16/Р-В17):
// item ответа деталей, корзины темпа из pace конверта, пять групп слов с `more` шлюза,
// 409/404/503, кнопка цели, клавиатура.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { TitleDetail, type TitleDetailProps } from '../TitleDetail'
import { card, FakeCatalog, json, PACE, SNAP, SNAP2 } from './fake-catalog'

let fc: FakeCatalog
beforeEach(() => { fc = new FakeCatalog(); fc.install() })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const w = (word: string, count: number) => ({ word, count })
const FULL_GROUPS = [
  { group: 1, forms: 2742, more: 2337, share: 0.943, top: [w('know', 6186), w('want', 4000), w('think', 3500), w('going', 3000), w('see', 2500)] },
  { group: 2, forms: 1787, more: 1593, share: 0.0287, top: [w('honey', 367), w('sorry', 300), w('worry', 200), w('hey', 100), w('lot', 90)] },
  { group: 3, forms: 3, more: 0, share: 0.01, top: [w('alpha', 5), w('beta', 4), w('gamma', 3)] },
  { group: 4, forms: 120, more: 0, share: 0.0004 },
  { group: 5, forms: 0, more: 0, share: 0 },
]
const ITEM = (over: Record<string, unknown> = {}) => ({
  ...card('friends-light', { title_en: 'Friends', title_ru: 'Друзья', year: 1994, age_limit: 12, imdb_id: 'tt0108778' }),
  director: 'Дэвид Крейн',
  groups: FULL_GROUPS,
  phrases: { n: 1067, top: [{ text: 'come on', count: 931 }, { text: 'go on', count: 800 }] },
  tempo: { wpm: 175, source: 'p75_est' },
  ...over,
})
const envelope = (item: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  ({ snapshot: SNAP, tempo_median_wpm: 169, pace: PACE, item, ...extra })

function props(over: Partial<TitleDetailProps> = {}): TitleDetailProps {
  return {
    card: card('friends-light', { title_en: 'Friends', title_ru: 'Друзья', year: 1994, age_limit: 12, imdb_id: 'tt0108778' }) as TitleDetailProps['card'],
    snapshot: SNAP, selected: false, capped: false, onToggle: vi.fn(), onClose: vi.fn(), ...over,
  }
}
async function open(item: Record<string, unknown> = ITEM(), over: Partial<TitleDetailProps> = {}, extra: Record<string, unknown> = {}) {
  fc.detail = () => json(200, envelope(item, extra))
  const p = props(over)
  const r = render(<TitleDetail {...p} />)
  await screen.findByText('Слова')
  return { p, ...r }
}

describe('запрос и шапка', () => {
  it('snapshot списка уходит в запрос деталей; шапка: названия, тип · год, 18+ не показывается при 12, режиссёр, IMDb', async () => {
    await open()
    expect(fc.details()).toEqual([`/api/me/catalog/titles/friends-light?snapshot=${SNAP}`])
    const d = screen.getByRole('dialog', { name: 'Друзья' })
    expect(d.getAttribute('aria-modal')).toBe('true')
    expect(within(d).getByRole('heading', { level: 2 }).textContent).toBe('Friends')
    expect(within(d).getAllByText('Друзья').length).toBeGreaterThan(0)
    expect(d.querySelector('.dt-meta')?.textContent).toBe('Сериал · 1994')
    expect(within(d).queryByText('18+')).toBeNull()
    expect(d.querySelector('.dt-dir')?.textContent).toBe('РежиссёрДэвид Крейн')
    const imdb = within(d).getByRole('link', { name: 'Открыть на IMDb ↗' }) as HTMLAnchorElement
    expect(imdb.href).toBe('https://www.imdb.com/title/tt0108778/')
    expect(imdb.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('«18+» при age_limit ≥ 18; уровня, «Вы знаете…», «Скрыть знакомые», полного списка слов нет', async () => {
    await open(ITEM({ age_limit: 18 }))
    const d = screen.getByRole('dialog')
    expect(within(d).getByText('18+')).toBeTruthy()
    expect(d.textContent).not.toMatch(/Уровень|уровн|Вы знаете|Скрыть знакомые|Показать все|free_forms/)
  })

  it('скелет, пока карточка грузится', async () => {
    let release!: (r: Response) => void
    fc.reply = url => (/titles\/friends/.test(url) ? new Promise<Response>(res => { release = res }) : null)
    render(<TitleDetail {...props()} />)
    expect(screen.getByTestId('detail-loading')).toBeTruthy()
    release(json(200, envelope(ITEM())))
    await screen.findByText('Слова')
    expect(screen.queryByTestId('detail-loading')).toBeNull()
  })
})

describe('слова: пять групп', () => {
  it('названия, число словоформ, доля речи; диапазон — в подсказке названия; подсказка блока', async () => {
    await open()
    expect(screen.getByText('Считаем словоформы: is, are и am — три разные')).toBeTruthy()
    const g1 = document.querySelector('[data-group="1"]') as HTMLElement
    expect(g1.querySelector('.dt-gn')?.textContent).toBe('Самые частые')
    expect(g1.querySelector('.dt-gr')?.textContent).toBe('1–1000 по частоте') // видимо, не только в title: на телефоне подсказки нет
    expect(g1.querySelector('[tabindex]')).toBeNull() // пустой фокусный стоп не нужен
    expect(g1.querySelector('.dt-gs')?.textContent).toBe('2 742 словоформы · 94,3 % речи')
    expect(document.querySelector('[data-group="2"] .dt-gr')?.textContent).toBe('1001–2000 по частоте')
    expect(document.querySelector('[data-group="2"] .dt-gs')?.textContent).toBe('1 787 словоформ · 2,9 % речи')
    expect(document.querySelector('[data-group="3"] .dt-gr')?.textContent).toBe('2001–5000 по частоте')
  })

  it('«Самые частые» тоже с пятью словами и числом употреблений; «+ ещё N» ровно из `more`', async () => {
    await open()
    const g1 = document.querySelector('[data-group="1"]') as HTMLElement
    const words = Array.from(g1.querySelectorAll('.dt-words span')).map(s => s.textContent)
    expect(words).toEqual(['know6 186', 'want4 000', 'think3 500', 'going3 000', 'see2 500'])
    expect(g1.querySelector('.dt-more')?.textContent).toBe('+ ещё 2 337')
    // 2742 − 5 = 2737, но страница не вычитает: показывает поле `more` шлюза (в нём уже вычтен свободный слой)
    expect(g1.textContent).not.toContain('2737')
    expect(document.querySelector('[data-group="2"] .dt-more')?.textContent).toBe('+ ещё 1 593')
  })

  it('`more = 0` — строки «+ ещё» нет; группа без `top` — только число словоформ и доля, без списка', async () => {
    await open()
    expect(document.querySelector('[data-group="3"] .dt-more')).toBeNull()
    expect(document.querySelectorAll('[data-group="3"] .dt-words span').length).toBe(3)
    const g4 = document.querySelector('[data-group="4"]') as HTMLElement
    expect(g4.querySelector('.dt-gs')?.textContent).toBe('120 словоформ · меньше 0,1 % речи')
    expect(g4.querySelector('.dt-words')).toBeNull()
    expect(g4.querySelector('.dt-more')).toBeNull()
  })

  it('top длиннее 5 показывает 5; free_forms не показывается; share=0 у непустой группы — «меньше 0,1 %», а не «0 %»', async () => {
    const six = ['a1', 'b2', 'c3', 'd4', 'e5', 'f6'].map((x, i) => w(x, 100 - i))
    await open(ITEM({ groups: [
      { group: 1, forms: 50, free_forms: 31337, more: 3, share: 0.5, top: six },
      { group: 5, forms: 10, free_forms: 31338, more: 0, share: 0 },
    ] }))
    const g1 = document.querySelector('[data-group="1"]') as HTMLElement
    expect(g1.querySelectorAll('.dt-words span').length).toBe(5)
    expect(g1.textContent).not.toContain('f6')
    expect(document.body.textContent).not.toMatch(/31337|31338|free_forms/)
    expect(document.querySelector('[data-group="5"] .dt-gs')?.textContent).toBe('10 словоформ · меньше 0,1\u00a0% речи')
  })

  it('пустая группа (forms = 0) не рисуется; без `top` у «Самых частых» (--group1-top=false) — число и доля', async () => {
    await open(ITEM({ groups: [{ group: 1, forms: 900, more: 7, share: 0.9 }, ...FULL_GROUPS.slice(1)] }))
    expect(document.querySelector('[data-group="5"]')).toBeNull()
    const g1 = document.querySelector('[data-group="1"]') as HTMLElement
    expect(g1.querySelector('.dt-words')).toBeNull()
    expect(g1.querySelector('.dt-more')).toBeNull()
    expect(g1.querySelector('.dt-gs')?.textContent).toBe('900 словоформ · 90 % речи')
  })

  it('мусорные группы не роняют карточку; нет групп — нет блока «Слова»', async () => {
    fc.detail = () => json(200, envelope(ITEM({ groups: [null, 7, { group: 99, forms: 1 }, { group: 1, forms: 'x' }] })))
    render(<TitleDetail {...props()} />)
    await screen.findByText('Темп речи')
    expect(screen.queryByText('Слова')).toBeNull()
  })
})

describe('темп', () => {
  it('«175 слов/мин» + «оценка» при p75_est; шкала с «в среднем»; нет «оценка» при p50', async () => {
    await open()
    const sec = screen.getByRole('region', { name: 'Темп речи' })
    expect(sec.querySelector('.dt-big')?.textContent).toContain('175')
    expect(sec.querySelector('.dt-big')?.textContent).toContain('слов/мин')
    expect(sec.querySelector('.dt-big')?.textContent).toContain('оценка')
    expect(sec.querySelector('.pace-avg i')?.textContent).toBe('в среднем')
    cleanup()
    await open(ITEM({ tempo: { wpm: 175, source: 'p50' } }))
    expect(screen.getByRole('region', { name: 'Темп речи' }).textContent).not.toContain('оценка')
  })

  it('подпись середины шкалы — по pace конверта, а не по константам 160/178', async () => {
    await open(ITEM({ tempo: { wpm: 175, source: 'p50' } }), {}, { pace: { slow_below: 150, fast_from: 170 } })
    expect(document.querySelector('.pace-l span:nth-child(2)')?.textContent).toBe('быстрее обычного') // 175 ≥ 170 (по константам было бы normal)
    cleanup()
    await open(ITEM({ tempo: { wpm: 175, source: 'p50' } }), {}, { pace: { slow_below: 180, fast_from: 200 } })
    expect(document.querySelector('.pace-l span:nth-child(2)')?.textContent).toBe('медленнее обычного') // 175 < 180 (по константам normal)
    cleanup()
    await open(ITEM({ tempo: { wpm: 165, source: 'p50' } }), {}, { pace: { slow_below: 150, fast_from: 190 } })
    expect(document.querySelector('.pace-l span:nth-child(2)')?.textContent).toBe('как в среднем')
    expect(document.querySelector('.pace-l')?.textContent).toContain('медленно')
    expect(document.querySelector('.pace-l')?.textContent).toContain('быстро')
  })

  it('нет темпа — нет блока', async () => {
    await open(ITEM({ tempo: undefined }))
    expect(screen.queryByRole('region', { name: 'Темп речи' })).toBeNull()
  })
})

describe('обороты и цель', () => {
  it('«1 067 оборотов» и примеры; нет оборотов — нет блока', async () => {
    await open()
    const sec = screen.getByRole('region', { name: 'Полезные обороты' })
    expect(sec.querySelector('.dt-big')?.textContent).toBe('1 067 оборотов')
    expect(Array.from(sec.querySelectorAll('.tp-wrap .chip')).map(e => e.textContent)).toEqual(['come on', 'go on'])
    cleanup()
    await open(ITEM({ phrases: undefined }))
    expect(screen.queryByRole('region', { name: 'Полезные обороты' })).toBeNull()
  })

  it('сериал: «Цель — первая серия»; фильм — нет', async () => {
    await open()
    expect(screen.getByText('Цель — первая серия')).toBeTruthy()
    cleanup()
    await open(ITEM({ type: 'film' }), { card: card('some-film', { type: 'film', title_en: 'Some Film' }) as TitleDetailProps['card'] })
    expect(screen.queryByText('Цель — первая серия')).toBeNull()
  })

  it('кнопка: «В цель маршрута» → onToggle; выбрано — «✓ В цели маршрута», aria-pressed', async () => {
    const { p } = await open()
    fireEvent.click(screen.getByRole('button', { name: 'В цель маршрута' }))
    expect(p.onToggle).toHaveBeenCalledTimes(1)
    cleanup()
    await open(ITEM(), { selected: true })
    const b = screen.getByRole('button', { name: 'В цели маршрута' })
    expect(b.getAttribute('aria-pressed')).toBe('true')
  })

  it('выбрано 10: невыбранную нельзя добавить, подпись; выбранную — снять можно', async () => {
    await open(ITEM(), { capped: true })
    expect((screen.getByRole('button', { name: 'В цель маршрута' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Можно выбрать до 10 целей')).toBeTruthy()
    cleanup()
    await open(ITEM(), { capped: true, selected: true })
    expect((screen.getByRole('button', { name: 'В цели маршрута' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('goal_ok=false: кнопка неактивна и «Пока нельзя выбрать»', async () => {
    await open(ITEM({ goal_ok: false }), { card: card('friends-light', { title_en: 'Friends', goal_ok: false }) as TitleDetailProps['card'] })
    expect((screen.getByRole('button', { name: 'В цель маршрута' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Пока нельзя выбрать')).toBeTruthy()
  })
})

describe('409, 404, 503', () => {
  it('409 snapshot_changed: берётся свежая версия одним ?slugs= и карточка просится заново с ней', async () => {
    let n = 0
    fc.snapshot = SNAP2
    fc.titles = [card('friends-light')]
    fc.detail = (_s, url) => (url.includes(`snapshot=${SNAP2}`) ? json(200, envelope(ITEM(), { snapshot: SNAP2 })) : (n++, json(409, { error: 'snapshot_changed', snapshot: SNAP2 })))
    render(<TitleDetail {...props()} />)
    await screen.findByText('Слова')
    expect(n).toBe(1)
    expect(fc.details()).toEqual([`/api/me/catalog/titles/friends-light?snapshot=${SNAP}`, `/api/me/catalog/titles/friends-light?snapshot=${SNAP2}`])
    expect(fc.slugsCalls()).toEqual([]) // версия уже в теле 409: лишнего ?slugs= нет
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('409 без версии в теле — запасной путь: свежая версия одним ?slugs=', async () => {
    fc.snapshot = SNAP2
    fc.titles = [card('friends-light')]
    fc.detail = (_s, url) => (url.includes(`snapshot=${SNAP2}`) ? json(200, envelope(ITEM(), { snapshot: SNAP2 })) : json(409, { error: 'snapshot_changed' }))
    render(<TitleDetail {...props()} />)
    await screen.findByText('Слова')
    expect(fc.slugsCalls()).toEqual(['/api/me/catalog/titles?slugs=friends-light'])
  })

  it('второй 409 подряд — ошибка и «Повторить», а не бесконечный цикл', async () => {
    fc.titles = [card('friends-light')]
    fc.detail = () => json(409, { error: 'snapshot_changed' })
    render(<TitleDetail {...props()} />)
    await screen.findByRole('alert')
    expect(fc.details().length).toBe(2)
  })

  it('404: шапка из списка и «Подробности для этого материала пока недоступны», кнопки цели нет', async () => {
    fc.detail = () => json(404, { error: 'title_not_found' })
    render(<TitleDetail {...props()} />)
    await screen.findByText('Подробности для этого материала пока недоступны')
    const d = screen.getByRole('dialog')
    expect(within(d).getByRole('heading', { level: 2 }).textContent).toBe('Friends')
    expect(within(d).queryByRole('button', { name: /В цел/ })).toBeNull()
    expect(within(d).getByRole('button', { name: 'Закрыть' })).toBeTruthy()
  })

  it('503: «Каталог временно недоступен…» + «Повторить»; кнопка цели остаётся; повтор работает', async () => {
    let n = 0
    fc.detail = () => (n++ === 0 ? json(503, { error: 'catalog_unavailable' }, { 'Retry-After': '5' }) : json(200, envelope(ITEM())))
    render(<TitleDetail {...props()} />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Каталог временно недоступен. Попробуйте через минуту.')
    expect(screen.getByRole('button', { name: 'В цель маршрута' })).toBeTruthy()
    fireEvent.click(within(alert).getByRole('button', { name: 'Повторить' }))
    await screen.findByText('Слова')
  })

  it('снимка нет (открыто без версии) — запрос без ?snapshot=', async () => {
    fc.detail = () => json(200, envelope(ITEM()))
    render(<TitleDetail {...props({ snapshot: undefined })} />)
    await screen.findByText('Слова')
    expect(fc.details()).toEqual(['/api/me/catalog/titles/friends-light'])
  })
})

describe('закрытие и клавиатура', () => {
  it('«Закрыть», Esc и клик по подложке закрывают; клик внутри — нет', async () => {
    const { p } = await open()
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
    expect(p.onClose).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(p.onClose).toHaveBeenCalledTimes(2)
    fireEvent.mouseDown(screen.getByTestId('detail-scrim'))
    expect(p.onClose).toHaveBeenCalledTimes(3)
    fireEvent.mouseDown(screen.getByRole('dialog'))
    expect(p.onClose).toHaveBeenCalledTimes(3)
  })

  it('фокус уходит внутрь и возвращается на открывавший; Tab зациклен', async () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const { unmount } = await open()
    const d = screen.getByRole('dialog')
    expect(d.contains(document.activeElement)).toBe(true)
    const f = Array.from(d.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),[tabindex]:not([tabindex="-1"])'))
    f[f.length - 1].focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(f[0])
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(f[f.length - 1])
    unmount()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })
})
