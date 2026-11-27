// quick-start-titles.test.tsx — экран старта при включённом каталоге (план 2026-11-19, S5;
// спека §7.3, §7.5). Каталог включён, когда SHOW_CATALOG (сборка) И session.catalog (сервер);
// здесь сборка «включена» подменой модуля, а флаг 0 проверяется тем же экраном (и v2-тестами).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { fireEvent, screen, waitFor, within, act } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const build = vi.hoisted(() => ({ show: true }))
vi.mock('../start-model', async importOriginal => {
  const m = await importOriginal<typeof import('../start-model')>()
  return { ...m, get SHOW_CATALOG() { return build.show } } // catalogOn — настоящая, читает подменённый SHOW_CATALOG
})

import { __resetSessionForTests, __setSessionForTests } from '../../../session'
import { __resetRouteStateForTests } from '../use-route-state'
import { __resetRouteOutboxForTests } from '../outbox'
import { FakeRouteBFF, json, renderRoutePage, st, TODAY, fullText } from './route-page-fakes'

const card = (slug: string, over: Record<string, unknown> = {}) => ({ slug, type: 'series', title_en: slug, goal_ok: true, ...over })
const FRIENDS = card('friends-light', { title_en: 'Friends', title_ru: 'Друзья', year: 1994, imdb_id: 'tt0108778', age_limit: 12 })
const HOUSE = card('house', { title_en: 'House', title_ru: 'Доктор Хаус', year: 2004, age_limit: 18 })
const SEVENTEEN = card('seventeen', { title_en: 'Seventeen', age_limit: 17 })
const MONK = card('monk', { title_en: 'Monk', year: 2002 })
const LOCKED = card('locked-show', { title_en: 'Locked Show', goal_ok: false })
const NOPOSTER = card('no-poster-film', { type: 'film', title_en: 'Quiet Film', year: 2010 })

const notStarted = () => st(null, { started: false, route_id: null, revision: 0, started_at: null })

let bff: FakeRouteBFF
beforeEach(() => {
  __resetSessionForTests(); __resetRouteStateForTests(); __resetRouteOutboxForTests()
  localStorage.clear()
  build.show = true
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(`${TODAY}T12:00:00`))
  bff = new FakeRouteBFF()
  bff.state = notStarted()
  bff.titles = [FRIENDS, HOUSE, MONK, LOCKED, NOPOSTER, SEVENTEEN]
  vi.stubGlobal('fetch', vi.fn((u: string, i?: RequestInit) => bff.fetch(u, i)))
  __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_abcd', routeAllowed: true, demo: false, catalog: true })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); __resetRouteOutboxForTests() })

async function open() {
  renderRoutePage(bff)
  await screen.findByText(fullText('Давайте установим Ваш реальный уровень'))
  await screen.findByRole('button', { name: 'Друзья' })
}
const bar = () => document.querySelector('.st-bar') as HTMLElement
const go = () => within(bar()).getByRole('button') as HTMLButtonElement
const qs = () => bff.of('/api/me/route/quick-start', 'POST')
const quickBody = () => qs()[0].body as { goal: Record<string, unknown>; known_words?: string }
const savePointA = (extra: Record<string, unknown>) =>
  localStorage.setItem('flib:pointA', JSON.stringify({ kind: 'cefr', level: 'B1', ageBand: 0, goals: [], savedAt: '2026-11-01', ...extra }))

describe('полки', () => {
  it('«Популярное» — один запрос sort=popular&limit=11; плитка «Все фильмы и сериалы → / N в каталоге»; /api/goals не читается', async () => {
    await open()
    expect(bff.of('/api/me/catalog/titles').map(c => c.url)).toEqual(['/api/me/catalog/titles?sort=popular&limit=11'])
    expect(bff.calls.some(c => c.url === '/api/goals')).toBe(false)
    const tile = document.querySelector('.gc-all') as HTMLElement
    expect(tile.querySelector('.serif')?.textContent).toBe('Все фильмы и сериалы')
    expect(tile.querySelector('.mute')?.textContent).toBe('6 в каталоге')
    expect(document.querySelectorAll('.gc').length).toBe(6)
    expect(document.querySelector('.seg')).toBeNull() // «Недавних» нет — переключателя нет
  })

  it('плитка: число — total ответа, с разделителем тысяч', async () => {
    bff.titlesReply = () => json(200, { snapshot: 'aaaaaaaaaaaaaaaa', total: 6312, pace: { slow_below: 160, fast_from: 178 }, items: [FRIENDS] })
    await open()
    expect((document.querySelector('.gc-all .mute') as HTMLElement).textContent).toBe('6 312 в каталоге')
  })

  it('SHOW_CATALOG=false при catalog:true — экран прежний: курируемые карточки, ни одного запроса каталога', async () => {
    build.show = false
    bff.goals = [{ id: 'friends-light', title: 'Friends', kind: 'Ситком', level: 'B1', target: 'friends-light/s01e01' }]
    renderRoutePage(bff)
    await screen.findByRole('button', { name: 'Friends' })
    expect(bff.calls.some(c => c.url.startsWith('/api/me/catalog'))).toBe(false)
    expect(document.querySelector('.gc-all')).toBeNull()
  })

  it('catalog:false при включённой сборке — то же: /api/goals, без запросов каталога', async () => {
    __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_abcd', routeAllowed: true, demo: false, catalog: false })
    bff.goals = [{ id: 'friends-light', title: 'Friends', kind: 'Ситком', level: 'B1', target: 'friends-light/s01e01' }]
    renderRoutePage(bff)
    await screen.findByRole('button', { name: 'Friends' })
    expect(bff.calls.some(c => c.url.startsWith('/api/me/catalog'))).toBe(false)
  })

  it('«Недавние»: одним ?slugs=, порядок как в списке; плитки «Все фильмы» на этой полке нет', async () => {
    localStorage.setItem('flib:recent-titles', JSON.stringify(['monk', 'friends-light']))
    // сервер отвечает в ДРУГОМ порядке — страница обязана вернуть порядок «Недавних»
    bff.titlesReply = url => (url.includes('slugs=') ? json(200, { snapshot: 'aaaaaaaaaaaaaaaa', items: [FRIENDS, MONK] }) : null)
    await open()
    const seg = document.querySelector('.seg') as HTMLElement
    expect(within(seg).getByRole('button', { name: 'Популярное' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(within(seg).getByRole('button', { name: 'Недавние' }))
    await waitFor(() => expect(Array.from(document.querySelectorAll('.gc .gc-t')).map(e => e.textContent)).toEqual(['Monk', 'Друзья']))
    expect(bff.of('/api/me/catalog/titles').filter(c => c.url.includes('slugs=')).map(c => c.url)).toEqual(['/api/me/catalog/titles?slugs=monk,friends-light'])
    expect(document.querySelector('.gc-all')).toBeNull()
    fireEvent.click(within(seg).getByRole('button', { name: 'Популярное' }))
    expect(document.querySelector('.gc-all')).toBeTruthy()
  })

  it('выбранный тайтл попадает в «Недавние» и открывает переключатель', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Друзья' }))
    expect(JSON.parse(localStorage.getItem('flib:recent-titles') ?? '[]')).toEqual(['friends-light'])
    expect(document.querySelector('.seg')).toBeTruthy()
  })

  it('сбой списка — «Каталог временно недоступен…» + «Повторить» (role=alert); повтор — карточки', async () => {
    let first = true
    bff.titlesReply = () => { if (first) { first = false; return json(503, { error: 'catalog_unavailable' }, { 'Retry-After': '5' }) } return null }
    renderRoutePage(bff)
    const al = await screen.findByText('Каталог временно недоступен. Попробуйте через минуту.')
    expect(al.closest('[role="alert"]')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    await screen.findByRole('button', { name: 'Друзья' })
  })

  it('429 busy на списке — молча повтор, ошибки нет', async () => {
    let n = 0
    bff.titlesReply = () => (++n === 1 ? json(429, { error: 'busy' }, { 'Retry-After': '1' }) : null)
    renderRoutePage(bff)
    await screen.findByRole('button', { name: 'Друзья' }, { timeout: 4000 })
    expect(screen.queryByText(/Каталог временно недоступен/)).toBeNull()
  })
})

describe('карточка тайтла', () => {
  it('без уровня; «18+» при age_limit ≥ 18; IMDb noopener noreferrer; постер из нашего каталога', async () => {
    await open()
    const friends = screen.getByRole('button', { name: 'Друзья' }).closest('.gc') as HTMLElement
    expect(friends.querySelector('.gc-l')).toBeNull()
    expect(friends.querySelector('.gc-s span')?.textContent).toBe('Сериал · 1994')
    expect(friends.querySelector('.gc-age')).toBeNull()
    const imdb = within(friends).getByRole('link', { name: /IMDb/ }) as HTMLAnchorElement
    expect(imdb.getAttribute('href')).toBe('https://www.imdb.com/title/tt0108778/')
    expect(imdb.getAttribute('target')).toBe('_blank')
    expect(imdb.getAttribute('rel')).toBe('noopener noreferrer')
    expect((friends.querySelector('.pst img') as HTMLImageElement).getAttribute('src')).toBe('/api/puzzle/preview?slug=friends-light')
    const house = screen.getByRole('button', { name: 'Доктор Хаус' }).closest('.gc') as HTMLElement
    expect(house.querySelector('.gc-age')?.textContent).toBe('18+')
    const monk = screen.getByRole('button', { name: 'Monk' }).closest('.gc') as HTMLElement
    expect(monk.querySelector('.gc-age')).toBeNull()
    const sev = screen.getByRole('button', { name: 'Seventeen' }).closest('.gc') as HTMLElement
    expect(sev.querySelector('.gc-age')).toBeNull() // граница: 17 — без метки, 18 — с меткой
    expect(monk.querySelector('.imdb')).toBeNull()
  })

  it('ошибка постера — плашка с названием; у карточки есть «Подробнее» (карточка — S6)', async () => {
    await open()
    const c = screen.getByRole('button', { name: 'Quiet Film' }).closest('.gc') as HTMLElement
    fireEvent.error(c.querySelector('.pst img') as HTMLImageElement)
    expect(c.querySelector('.pst.none .pst-t')?.textContent).toBe('Quiet Film')
    expect(within(c).getByRole('button', { name: 'Подробнее' })).toBeTruthy()
  })

  it('goal_ok=false — «Пока нельзя выбрать», выбрать нельзя', async () => {
    await open()
    const c = screen.getByRole('button', { name: 'Locked Show' }).closest('.gc') as HTMLElement
    expect(c.querySelector('.gc-off')?.textContent).toBe('Пока нельзя выбрать')
    const hit = within(c).getByRole('button', { name: 'Locked Show' }) as HTMLButtonElement
    expect(hit.disabled).toBe(true)
    fireEvent.click(hit)
    expect(bar().querySelector('.st-cnt')?.textContent).toBe('Выбрано: 0')
  })

  it('демо видит тот же каталог', async () => {
    __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_abcd', routeAllowed: true, demo: true, catalog: true })
    await open()
    expect(document.querySelectorAll('.gc').length).toBe(6)
    expect(screen.queryByText(/В демо/)).toBeNull()
    expect(document.querySelector('.pst.locked')).toBeNull()
  })
})

describe('цель: тайтлы — только в goal.titles', () => {
  it('выбор тайтла + ролик YouTube: titles=[slug], puzzle_ids — только youtube::; label — русские названия', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Друзья' }))
    const det = document.querySelector('details.own2') as HTMLDetailsElement
    fireEvent.change(screen.getByLabelText('Ссылка на ролик YouTube'), { target: { value: 'https://youtu.be/dQw4w9WgXcQ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Добавить ролик' }))
    expect(det.querySelector('.yt-card')).toBeTruthy()
    expect(bar().querySelector('.st-cnt')?.textContent).toBe('Выбрано: 2')
    fireEvent.click(go())
    fireEvent.click(await screen.findByRole('button', { name: 'Начать без сбора слов' })) // платный с роликами: сначала сбор «Моих целей»
    await waitFor(() => expect(qs().length).toBe(1))
    const g = quickBody().goal
    expect(g.titles).toEqual(['friends-light'])
    expect(g.puzzle_ids).toEqual(['youtube::dQw4w9WgXcQ'])
    expect(String(g.label)).toBe('Друзья + Мои ролики (1)')
  })

  it('только тайтлы: puzzle_ids в теле нет вовсе; ни один не-YouTube id не уходит', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Друзья' }))
    fireEvent.click(screen.getByRole('button', { name: 'Monk' }))
    fireEvent.click(go())
    await waitFor(() => expect(qs().length).toBe(1))
    const g = quickBody().goal
    expect(g.titles).toEqual(['friends-light', 'monk'])
    expect(g.puzzle_ids).toBeUndefined()
    expect(JSON.stringify(qs()[0].body)).not.toMatch(/s01e01|\/friends/)
  })

  it('(1) сохранённая puzzle-цель goalsV2 → titles:[slug] после проверки; в puzzle_ids только youtube::', async () => {
    savePointA({ goalsV2: [
      { type: 'puzzle', slug: 'friends-light', title: 'Friends', kind: 'series', target: 'friends-light/s01e01' },
      { type: 'youtube', videoId: 'dQw4w9WgXcQ', url: 'https://youtu.be/dQw4w9WgXcQ' },
    ] })
    await open()
    expect(screen.getByRole('button', { name: 'Друзья' }).getAttribute('aria-pressed')).toBe('true')
    expect(bar().querySelector('.st-cnt')?.textContent).toBe('Выбрано: 2')
    fireEvent.click(go())
    fireEvent.click(await screen.findByRole('button', { name: 'Начать без сбора слов' })) // платный с роликами: сначала сбор «Моих целей»
    await waitFor(() => expect(qs().length).toBe(1))
    const g = quickBody().goal
    expect(g.titles).toEqual(['friends-light'])
    expect(g.puzzle_ids).toEqual(['youtube::dQw4w9WgXcQ'])
  })

  it('puzzle-цель, которой нет в снимке, молча не переносится и не уходит (PD-8)', async () => {
    savePointA({ goalsV2: [{ type: 'puzzle', slug: 'ted-lasso', title: 'Ted Lasso', kind: 'series', target: 'ted-lasso/s01e01' }] })
    await open()
    await waitFor(() => expect(bff.of('/api/me/catalog/titles').some(c => c.url.includes('slugs=ted-lasso'))).toBe(true))
    expect(bar().querySelector('.st-cnt')?.textContent).toBe('Выбрано: 0')
    fireEvent.click(go())
    expect(qs().length).toBe(0)
  })

  it('сбой проверки переноса (503) — ничего не выбрано и flib:pointA не тронут', async () => {
    const raw = JSON.stringify({ kind: 'cefr', level: 'B1', ageBand: 0, goals: [], savedAt: '2026-11-01', goalsV2: [{ type: 'puzzle', slug: 'friends-light', title: 'Friends', kind: 'series', target: 'friends-light/s01e01' }] })
    localStorage.setItem('flib:pointA', raw)
    bff.titlesReply = url => (url.includes('slugs=') ? json(503, { error: 'catalog_unavailable' }) : null)
    await open()
    await waitFor(() => expect(bff.of('/api/me/catalog/titles').some(c => c.url.includes('slugs='))).toBe(true))
    expect(localStorage.getItem('flib:pointA')).toBe(raw)
    expect(bar().querySelector('.st-cnt')?.textContent).toBe('Выбрано: 0')
  })

  it('(2) выбранный тайтл вне полки — чип с ×: считается, уходит в цель, снимается', async () => {
    savePointA({ goalsV2: [{ type: 'puzzle', slug: 'casino-1995', title: 'Casino', kind: 'film', target: 'casino-1995/casino-1995' }] })
    bff.titles = [FRIENDS, HOUSE, MONK, LOCKED, NOPOSTER, card('casino-1995', { type: 'film', title_en: 'Casino', title_ru: 'Казино', year: 1995 })]
    bff.titlesReply = url => (url.includes('sort=popular') ? json(200, { snapshot: 'aaaaaaaaaaaaaaaa', total: 6, pace: { slow_below: 160, fast_from: 178 }, items: [FRIENDS, HOUSE] }) : null)
    await open()
    const chip = await waitFor(() => { const c = document.querySelector('.gc-extra .chip') as HTMLElement; expect(c).toBeTruthy(); return c })
    expect(chip.textContent).toContain('Казино')
    expect(bar().querySelector('.st-cnt')?.textContent).toBe('Выбрано: 1')
    fireEvent.click(within(chip).getByRole('button', { name: /Убрать цель Казино/ }))
    expect(document.querySelector('.gc-extra .chip')).toBeNull()
    expect(bar().querySelector('.st-cnt')?.textContent).toBe('Выбрано: 0')
  })

  it('(7) тайтл пропал из снимка между выбором и стартом — 400 goal_title_unknown {slug}: снимается ровно этот чип', async () => {
    bff.quickStartReply = () => json(400, { error: 'goal_title_unknown', slug: 'friends-light' })
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Друзья' }))
    fireEvent.click(screen.getByRole('button', { name: 'Monk' }))
    fireEvent.click(screen.getByRole('button', { name: 'Доктор Хаус' }))
    fireEvent.click(go())
    await waitFor(() => expect(qs().length).toBe(1))
    await screen.findByText('Этого материала больше нет в каталоге — уберите его из цели')
    expect(screen.getByRole('button', { name: 'Друзья' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('button', { name: 'Monk' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Доктор Хаус' }).getAttribute('aria-pressed')).toBe('true')
    expect(bar().querySelector('.st-cnt')).toBeNull() // красная плашка вместо сводки
    fireEvent.click(go())
    await waitFor(() => expect(qs().length).toBe(2))
    expect((qs()[1].body as { goal: { titles: string[] } }).goal.titles).toEqual(['monk', 'house'])
  })
})

describe('нижняя кнопка', () => {
  it('(6) без цели: запроса нет, прокрутка и фокус на шаг «Цель», «Выберите хотя бы одну цель» role=alert', async () => {
    const scrolled: Element[] = []
    const orig = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(this) } as typeof orig
    try {
      await open()
      expect(go().disabled).toBe(false)
      expect(go().textContent).toBe('Начать маршрут')
      fireEvent.click(go())
      expect(qs().length).toBe(0)
      const msg = document.querySelector('.st-need-msg') as HTMLElement
      expect(msg.textContent).toBe('Выберите хотя бы одну цель')
      expect(msg.getAttribute('role')).toBe('alert')
      expect(scrolled.some(e => e.id === 'st-goal')).toBe(true)
      expect(document.activeElement?.id).toBe('st-goal')
      expect(bar().querySelector('.msg.err')).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Друзья' }))
      expect(document.querySelector('.st-need-msg')).toBeNull()
    } finally {
      Element.prototype.scrollIntoView = orig
    }
  })

  it('с целью: «Выбрано: N» + «A2 · базовый»; тайтл считается', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Друзья' }))
    expect(bar().querySelector('.st-cnt')?.textContent).toBe('Выбрано: 1')
    expect(bar().textContent).toContain('A2 · базовый')
    expect(bar().textContent).not.toContain('построится по уровню')
    expect(bar().querySelector('.st-need')).toBeNull()
  })

  it('«Оставить мой список» после 409 profile_has_words — тот же goal.titles, known_words:keep', async () => {
    let n = 0
    bff.quickStartReply = () => (++n === 1 ? json(409, { error: 'profile_has_words' }) : json(202, { job_id: '33333333-3333-4333-8333-333333333333', revision: 1 }))
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Друзья' }))
    fireEvent.click(go())
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: 'Оставить мой список' }))
    await waitFor(() => expect(qs().length).toBe(2))
    expect(qs()[1].body).toMatchObject({ known_words: 'keep', goal: { titles: ['friends-light'] } })
  })
})

describe('(9) тексты отказов быстрого старта — спека §7.3', () => {
  const pick = async () => { await open(); fireEvent.click(screen.getByRole('button', { name: 'Друзья' })); fireEvent.click(go()); await waitFor(() => expect(qs().length).toBe(1)) }
  const plaque = () => document.querySelector('.st-err') as HTMLElement

  it.each([
    ['goal_title_unavailable', { slug: 'friends-light' }, 'Этот материал пока нельзя выбрать целью — уберите его из цели'],
    ['goal_target_invalid', {}, 'Страница устарела. Обновите её и выберите цель заново'],
    ['too_many_goals', { field: 'goal.titles' }, 'Можно выбрать до 10 целей'],
    ['too_many_goals', { field: 'goal' }, 'Можно выбрать до 20 целей вместе с роликами'],
  ])('400 %s %j → «%s»', async (error, extra, text) => {
    bff.quickStartReply = () => json(400, { error, ...extra })
    await pick()
    await waitFor(() => expect(plaque()).toBeTruthy())
    expect(plaque().textContent).toBe(text)
    expect(plaque().getAttribute('role')).toBe('alert')
  })

  it('goal_title_unavailable снимает ровно названный чип', async () => {
    bff.quickStartReply = () => json(400, { error: 'goal_title_unavailable', slug: 'friends-light' })
    await pick()
    await waitFor(() => expect(plaque()).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Друзья' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('503 catalog_unavailable: «Каталог временно недоступен. Попробуйте через минуту.», кнопка неактивна до Retry-After, затем активна', async () => {
    bff.quickStartReply = () => json(503, { error: 'catalog_unavailable' }, { 'Retry-After': '1' })
    await pick()
    await waitFor(() => expect(plaque()?.textContent).toBe('Каталог временно недоступен. Попробуйте через минуту.'))
    expect(go().disabled).toBe(true)
    fireEvent.click(go())
    expect(qs().length).toBe(1)
    await waitFor(() => expect(go().disabled).toBe(false), { timeout: 3000 })
    expect(go().textContent).toBe('Попробовать снова')
    // перечитывания состояния маршрута из-за каталога нет
    expect(bff.stateGets).toBe(1)
  })

  it('прочие ошибки — прежние тексты (goal_not_resolved)', async () => {
    bff.quickStartReply = () => json(400, { error: 'goal_not_resolved' })
    await pick()
    await waitFor(() => expect(plaque()?.textContent).toBe('Для этой цели пока нет материала — добавьте фильм, ролик или свои слова'))
  })

  it('too_many_goals без поля field — текст про 20 (по умолчанию «вместе с роликами»)', async () => {
    bff.quickStartReply = () => json(400, { error: 'too_many_goals' })
    await pick()
    await waitFor(() => expect(plaque()?.textContent).toBe('Можно выбрать до 20 целей вместе с роликами'))
  })
})

describe('тихий выход', () => {
  it('закрытие страницы во время загрузки полки не падает', async () => {
    let release: (r: Response) => void = () => {}
    bff.titlesReply = () => new Promise<Response>(r => { release = r })
    const view = renderRoutePage(bff)
    await screen.findByText(fullText('Давайте установим Ваш реальный уровень'))
    view.unmount()
    await act(async () => { release(json(200, { snapshot: 'a', total: 0, pace: { slow_below: 1, fast_from: 2 }, items: [] })) })
  })
})

describe('ревью S5: потолок, полки, стили', () => {
  it('L-3: 11-й тайтл выбрать нельзя — карточки неактивны, «Можно выбрать до 10 целей»; снятие возвращает выбор', async () => {
    bff.titles = Array.from({ length: 11 }, (_, i) => card(`t${i}`, { title_en: `T${i}` }))
    renderRoutePage(bff)
    await screen.findByRole('button', { name: 'T0' })
    for (let i = 0; i < 10; i++) fireEvent.click(screen.getByRole('button', { name: `T${i}` }))
    expect(bar().querySelector('.st-cnt')?.textContent).toBe('Выбрано: 10')
    expect(screen.getByText('Можно выбрать до 10 целей')).toBeTruthy()
    const last = screen.getByRole('button', { name: 'T10' }) as HTMLButtonElement
    expect(last.disabled).toBe(true)
    fireEvent.click(last)
    expect(bar().querySelector('.st-cnt')?.textContent).toBe('Выбрано: 10')
    expect((screen.getByRole('button', { name: 'T3' }) as HTMLButtonElement).disabled).toBe(false) // выбранное снимается
    fireEvent.click(screen.getByRole('button', { name: 'T3' }))
    expect(screen.queryByText('Можно выбрать до 10 целей')).toBeNull()
    expect((screen.getByRole('button', { name: 'T10' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('L-6: «Недавние» целиком ушли из снимка — полка возвращается на «Популярное», переключателя нет', async () => {
    localStorage.setItem('flib:recent-titles', JSON.stringify(['gone-1', 'gone-2']))
    await open()
    fireEvent.click(within(document.querySelector('.seg') as HTMLElement).getByRole('button', { name: 'Недавние' }))
    await waitFor(() => expect(document.querySelector('.seg')).toBeNull())
    expect(screen.getByRole('button', { name: 'Друзья' })).toBeTruthy()
    expect(document.querySelector('.gc-all')).toBeTruthy()
  })

  it('переключатель полок — общий .seg из route.css: активный сегмент имеет класс on', async () => {
    localStorage.setItem('flib:recent-titles', JSON.stringify(['monk']))
    await open()
    const seg = document.querySelector('.seg') as HTMLElement
    expect(within(seg).getByRole('button', { name: 'Популярное' }).className).toBe('on')
    expect(within(seg).getByRole('button', { name: 'Недавние' }).className).toBe('')
  })

  it('L-5: пока «Популярное» грузится, выбранные из pointA тайтлы чипами не мигают', async () => {
    savePointA({ goalsV2: [{ type: 'puzzle', slug: 'friends-light', title: 'Friends', kind: 'series', target: 'friends-light/s01e01' }] })
    bff.titlesReply = url => (url.includes('sort=popular') ? new Promise<Response>(() => {}) : null)
    renderRoutePage(bff)
    await screen.findByText(fullText('Давайте установим Ваш реальный уровень'))
    await waitFor(() => expect(bar().querySelector('.st-cnt')?.textContent).toBe('Выбрано: 1'))
    expect(document.querySelector('.gc-extra')).toBeNull()
  })

  it('H-1: route-start.css не определяет .seg (общий .seg живёт в route.css и не должен меняться на экране дня)', () => {
    const css = readFileSync(resolve(__dirname, '../route-start.css'), 'utf-8')
    expect(css).not.toMatch(/\.seg\b\s*[{,]|\.seg button/)
  })

  it('L-4: подпись карточки .gc-t переносит длинное слово (overflow-wrap: anywhere)', () => {
    const css = readFileSync(resolve(__dirname, '../route-start.css'), 'utf-8')
    expect(css).toMatch(/\.cab \.gc-t \{[^}]*overflow-wrap: anywhere/)
  })

  it('L-4: заплатка постера переносит длинное слово (overflow-wrap: anywhere)', () => {
    const css = readFileSync(resolve(__dirname, '../route-start.css'), 'utf-8')
    expect(css).toMatch(/\.cab \.pst-t \{[^}]*overflow-wrap: anywhere/)
  })
})

describe('M-1: настоящий catalogOn при включённой сборке — выключатель сессии работает', () => {
  it('сборка включена, session.catalog=false → прежний экран (/api/goals, без каталога)', async () => {
    __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_abcd', routeAllowed: true, demo: false, catalog: false })
    bff.goals = [{ id: 'friends-light', title: 'Friends', kind: 'Ситком', level: 'B1', target: 'friends-light/s01e01' }]
    renderRoutePage(bff)
    await screen.findByRole('button', { name: 'Friends' })
    expect(bff.calls.some(c => c.url.startsWith('/api/me/catalog'))).toBe(false)
  })
})
