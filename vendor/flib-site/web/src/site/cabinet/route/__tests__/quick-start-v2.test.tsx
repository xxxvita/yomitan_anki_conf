// quick-start-v2.test.tsx — экран старта маршрута v2 и состояния запуска (дизайн
// владельца 2026-11-19 §3a/§3b; решения владельца 2026-11-19 п.1 и п.3).
// Поведение быстрого старта прежнее (RoutePageCabinet.test.tsx): здесь — вид.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { fireEvent, screen, waitFor, within, act } from '@testing-library/react'
import { __resetSessionForTests, __setSessionForTests } from '../../../session'
import { __resetRouteStateForTests } from '../use-route-state'
import { __resetRouteOutboxForTests } from '../outbox'
import { FakeRouteBFF, json, renderRoutePage, st, TODAY, fullText } from './route-page-fakes'

const FRIENDS = { id: 'friends', title: 'Friends', kind: 'Ситком', level: 'B1–B2', target: 'friends-light/s01e01', title_ru: 'Друзья', year: 1994, type: 'Сериал', imdb_id: 'tt0108778', poster_slug: 'friends-light' }
const WIRE = { id: 'the-wire', title: 'The Wire', kind: 'Драма', level: 'C1', target: 'the-wire/s01e01', title_ru: 'Прослушка', year: 2002, type: 'Сериал', imdb_id: 'tt0306414', poster_slug: 'the-wire' }
const BARE = { id: 'bare', title: 'Bare Show', kind: 'Ситком', level: '', target: 'bare/s01e01' }
const notStarted = () => st(null, { started: false, route_id: null, revision: 0, started_at: null })

let bff: FakeRouteBFF
beforeEach(() => {
  __resetSessionForTests(); __resetRouteStateForTests(); __resetRouteOutboxForTests()
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(`${TODAY}T12:00:00`))
  bff = new FakeRouteBFF()
  bff.state = notStarted()
  bff.goals = [FRIENDS, WIRE, BARE] as typeof bff.goals
  vi.stubGlobal('fetch', vi.fn((u: string, i?: RequestInit) => bff.fetch(u, i)))
  __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_abcd', routeAllowed: true, demo: false })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); __resetRouteOutboxForTests() })

async function open() {
  renderRoutePage(bff)
  await screen.findByText(fullText('Давайте установим Ваш реальный уровень'))
  await screen.findByRole('button', { name: 'Friends' })
}
const bar = () => document.querySelector('.st-bar') as HTMLElement
const go = () => within(bar()).getByRole('button') as HTMLButtonElement

describe('шапка и быстрый старт', () => {
  it('«▶ Быстрый старт» с текстом владельца; «Скоро: тест уровня…» убрано, без сводки теста предложения нет', async () => {
    await open()
    const way = document.querySelector('.st-way') as HTMLElement
    expect(way.querySelector('.st-way-tag')?.textContent).toBe('Быстрый старт')
    expect(way.querySelector('.st-way-txt')?.textContent).toBe('Укажите свой уровень владения языком и выберите материал, который хотите понимать на слух. Мы начнём с рекомендаций видео для просмотров от Вашего уровня и будем двигаться к Вашей цели, наблюдая за Вашими успехами.')
    expect(way.querySelector('.st-soon')).toBeNull()
    expect(screen.queryByText('Пройти тест')).toBeNull()
  })
})

describe('шаг 1 — уровень', () => {
  it('радиогруппа из 5 карточек с текстами владельца; по умолчанию A2', async () => {
    await open()
    const group = screen.getByRole('radiogroup', { name: 'Уровень' })
    const radios = within(group).getAllByRole('radio')
    expect(radios.map(r => r.querySelector('.lv-code')?.textContent)).toEqual(['A1', 'A2', 'B1', 'B2', 'C1'])
    expect(radios.map(r => r.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false', 'false', 'false'])
    expect(radios[0].querySelector('.lv-name')?.textContent).toBe('почти с нуля')
    expect(radios[0].querySelector('.lv-d')?.textContent).toBe('Вы читаете и переводите отдельные фразы и слова, но не понимаете их на слух у носителей.')
    expect(radios[1].querySelector('.lv-ck')).toBeTruthy()
    expect(radios[0].querySelector('.lv-ck')).toBeNull()
  })

  it('выбор B1 — отмечен, сводка «B1 · средний»; прошлый выбор из flib:pointA', async () => {
    localStorage.setItem('flib:pointA', JSON.stringify({ kind: 'cefr', level: 'C1', ageBand: 0, goals: [], savedAt: '2026-11-01' }))
    await open()
    expect(screen.getByRole('radio', { name: /^C1/ }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('radio', { name: /^B1/ }))
    expect(screen.getByRole('radio', { name: /^B1/ }).getAttribute('aria-checked')).toBe('true')
    expect(bar().textContent).toContain('B1 · средний')
  })

  it('подпись цели меняется с уровнем: A1, A2–B2, C1 — два абзаца', async () => {
    await open()
    const why = () => Array.from(document.querySelectorAll('.st-why')).map(p => p.textContent)
    expect(why()).toEqual(['Выбирайте свою цель, к которой Вы пойдёте через наши рекомендации и станете свободно понимать её на слух'])
    fireEvent.click(screen.getByRole('radio', { name: /^A1/ }))
    expect(why()[0]).toMatch(/^Начните с чего-то простого и запоминающегося\./)
    fireEvent.click(screen.getByRole('radio', { name: /^C1/ }))
    expect(why()).toHaveLength(2)
  })
})

describe('шаг 2 — фильмы и сериалы', () => {
  it('карточка: постер-кнопка aria-pressed, название, «Сериал · 1994», уровень, IMDb в новой вкладке', async () => {
    await open()
    const card = screen.getByRole('button', { name: 'Friends' }).closest('.gc') as HTMLElement
    const hit = within(card).getByRole('button', { name: 'Friends' })
    expect(hit.getAttribute('aria-pressed')).toBe('false')
    expect(card.querySelector('.gc-t')?.textContent).toBe('Friends')
    expect(card.querySelector('.gc-s span')?.textContent).toBe('Сериал · 1994')
    expect(card.querySelector('.gc-l')?.textContent).toBe('B1–B2')
    const imdb = within(card).getByRole('link', { name: /IMDb/ }) as HTMLAnchorElement
    expect(imdb.getAttribute('href')).toBe('https://www.imdb.com/title/tt0108778/')
    expect(imdb.getAttribute('target')).toBe('_blank')
    expect(imdb.getAttribute('rel')).toBe('noopener noreferrer')
    expect(imdb.closest('button')).toBeNull()
  })

  it('нажатие на постер — выбрано (рамка, галочка, «Выбрано: 1»); повторно — снято; IMDb выбор не меняет', async () => {
    await open()
    const hit = screen.getByRole('button', { name: 'Friends' })
    const card = hit.closest('.gc') as HTMLElement
    fireEvent.click(hit)
    expect(hit.getAttribute('aria-pressed')).toBe('true')
    expect(card.className).toContain('on')
    expect(card.querySelector('.gc-ck')).toBeTruthy()
    expect(bar().querySelector('.st-cnt')?.textContent).toBe('Выбрано: 1')
    fireEvent.click(within(card).getByRole('link', { name: /IMDb/ }))
    expect(hit.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(hit)
    expect(hit.getAttribute('aria-pressed')).toBe('false')
    expect(card.querySelector('.gc-ck')).toBeNull()
  })

  it('постер — из нашего каталога (/api/puzzle/preview), не с IMDb; ошибка загрузки — плашка с названием', async () => {
    await open()
    const card = screen.getByRole('button', { name: 'Friends' }).closest('.gc') as HTMLElement
    const img = card.querySelector('.pst img') as HTMLImageElement
    expect(img.getAttribute('src')).toBe('/api/puzzle/preview?slug=friends-light')
    expect(document.querySelectorAll('img[src*="imdb"], img[src*="media-amazon"]').length).toBe(0)
    fireEvent.error(img)
    expect(card.querySelector('.pst img')).toBeNull()
    expect(card.querySelector('.pst.none .pst-t')?.textContent).toBe('Friends')
  })

  it('постер загрузился — название поверх не дублируется; без poster_slug — сразу плашка; без IMDb и уровня — нет меток', async () => {
    await open()
    const card = screen.getByRole('button', { name: 'Friends' }).closest('.gc') as HTMLElement
    fireEvent.load(card.querySelector('.pst img') as HTMLImageElement)
    expect(card.querySelector('.pst-t')).toBeNull()
    const bare = screen.getByRole('button', { name: 'Bare Show' }).closest('.gc') as HTMLElement
    expect(bare.querySelector('.pst img')).toBeNull()
    expect(bare.querySelector('.pst.none .pst-t')?.textContent).toBe('Bare Show')
    expect(bare.querySelector('.imdb')).toBeNull()
    expect(bare.querySelector('.gc-l')).toBeNull()
  })

  it('каталога пока нет: ни подборок, ни «Подробнее», ни плитки «Все фильмы и сериалы»', async () => {
    await open()
    expect(screen.queryByText('Подробнее')).toBeNull()
    expect(screen.queryByText(/Все фильмы и сериалы/)).toBeNull()
    expect(screen.queryByText('Популярное')).toBeNull()
    expect(screen.queryByText('Недавние')).toBeNull()
  })

  it('демо видит те же цели, без плашки «В демо — 20 сериалов» и без «С полным ключом»', async () => {
    __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_abcd', routeAllowed: true, demo: true })
    await open()
    expect(document.querySelectorAll('.gc').length).toBe(3)
    expect(screen.queryByText(/В демо/)).toBeNull()
    expect(screen.queryByText(/С полным ключом/)).toBeNull()
    expect(document.querySelector('.pst.locked')).toBeNull()
  })

  it('сериал из прошлого выбора со старым target — уходит текущий target из /api/goals', async () => {
    localStorage.setItem('flib:pointA', JSON.stringify({ kind: 'cefr', level: 'B1', ageBand: 0, goals: [], savedAt: '2026-11-01',
      goalsV2: [{ type: 'puzzle', slug: 'the-wire', title: 'The Wire', kind: 'series', target: 'old-wire/s01e01' }] }))
    await open()
    expect(screen.getByRole('button', { name: 'The Wire' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(go())
    await waitFor(() => expect(bff.of('/api/me/route/quick-start', 'POST').length).toBe(1))
    expect(bff.of('/api/me/route/quick-start', 'POST')[0].body).toMatchObject({ goal: { puzzle_ids: ['the-wire/s01e01'] } })
  })

  it('выбранный сериал уходит в цель (puzzle_ids = target)', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'The Wire' }))
    fireEvent.click(go())
    await waitFor(() => expect(bff.of('/api/me/route/quick-start', 'POST').length).toBe(1))
    expect(bff.of('/api/me/route/quick-start', 'POST')[0].body).toMatchObject({ cefr_level: 'A2', goal: { puzzle_ids: ['the-wire/s01e01'] } })
  })
})

describe('темы и своё', () => {
  it('14 чипов тем с иконками, множественный выбор; категории уходят в цель', async () => {
    await open()
    const wrap = document.querySelector('.tp-wrap') as HTMLElement
    const chips = within(wrap).getAllByRole('button')
    expect(chips).toHaveLength(14)
    expect(chips.every(c => c.querySelector('svg'))).toBe(true)
    fireEvent.click(within(wrap).getByRole('button', { name: 'Наука' }))
    fireEvent.click(within(wrap).getByRole('button', { name: 'Стендапы' }))
    expect(within(wrap).getByRole('button', { name: 'Наука' }).getAttribute('aria-pressed')).toBe('true')
    expect(bar().querySelector('.st-cnt')?.textContent).toBe('Выбрано: 2')
    fireEvent.click(within(wrap).getByRole('button', { name: 'Наука' }))
    expect(within(wrap).getByRole('button', { name: 'Наука' }).getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(go())
    await waitFor(() => expect(bff.of('/api/me/route/quick-start', 'POST').length).toBe(1))
    expect(bff.of('/api/me/route/quick-start', 'POST')[0].body).toMatchObject({ goal: { categories: ['standup'] } })
  })

  it('«Или добавьте своё» свёрнут; ролик YouTube — карточка с превью i.ytimg.com и ×; слова — чип с ×; счётчик', async () => {
    await open()
    const det = document.querySelector('details.own2') as HTMLDetailsElement
    expect(det.open).toBe(false)
    expect(det.querySelector('summary')?.textContent).toBe('Или добавьте своё')
    fireEvent.change(screen.getByLabelText('Ссылка на ролик YouTube'), { target: { value: 'https://youtu.be/dQw4w9WgXcQ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Добавить ролик' }))
    const yt = det.querySelector('.yt-card') as HTMLElement
    expect(yt.querySelector('img')?.getAttribute('src')).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg')
    const words = screen.getByLabelText('Слова, которые хотите, чтобы постепенно добавлялись в ролики')
    fireEvent.change(words, { target: { value: 'negotiation' } })
    fireEvent.keyDown(words, { key: 'Enter' })
    expect(det.querySelector('.own-items .chip')?.textContent).toContain('negotiation')
    expect(det.querySelector('summary')?.textContent).toBe('Или добавьте своё2')
    fireEvent.click(within(yt).getByRole('button', { name: /Убрать/ }))
    expect(det.querySelector('.yt-card')).toBeNull()
    expect(bar().querySelector('.st-cnt')?.textContent).toBe('Выбрано: 1')
  })

  it('«Видео и аудио с компьютера» — неактивно, «Скоро», «Выбрать файлы» выключена', async () => {
    await open()
    const f = document.querySelector('.own-file') as HTMLElement
    expect(f.textContent).toContain('Видео и аудио с компьютера')
    expect(f.textContent).toContain('Скоро')
    expect(f.textContent).toContain('Один или несколько файлов, не более 300 Мб')
    expect((within(f).getByRole('button', { name: 'Выбрать файлы' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('экран «Подбираем ролики» (§3b)', () => {
  const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString()
  const J = '44444444-4444-4444-8444-444444444444'
  const steps = () => Array.from(document.querySelectorAll('.pk-steps li')).map(li => li.className)

  it('первый подбор, обмен waiting 1 мин назад: шаг 2, 50 %, «осталось около 1 минуты», плашка о 2 минутах', async () => {
    bff.state = st(null, { active_exchange: { job_id: J, status: 'waiting', created_at: ago(1) } })
    bff.jobReply = () => new Promise<Response>(() => {})
    renderRoutePage(bff)
    const pk = await screen.findByTestId('route-building')
    expect(pk.querySelector('h1')?.textContent).toBe('Подбираем ролики')
    expect(pk.querySelector('h1 em')?.textContent).toBe('ролики')
    expect(pk.querySelector('.pk-meta')?.textContent).toBe('50%осталось около 1 минуты')
    expect((pk.querySelector('.pk-bar i') as HTMLElement).style.width).toBe('50%')
    expect(steps()).toEqual(['done', 'cur', '', ''])
    expect(pk.querySelector('.pk-steps li.cur')?.textContent).toBe('Собираем словарь целей')
    expect(pk.querySelector('.pk-note')?.textContent).toBe('Первый подбор может занять до 2 минут. Страницу можно закрыть — маршрут будет ждать здесь.')
  })

  it('processing — шаг 3; старше 2 минут — 95 %, «около 1 минуты», не 100', async () => {
    bff.state = st(null, { active_exchange: { job_id: J, status: 'processing', created_at: ago(3) } })
    bff.jobReply = () => new Promise<Response>(() => {})
    renderRoutePage(bff)
    const pk = await screen.findByTestId('route-building')
    expect(steps()).toEqual(['done', 'done', 'cur', ''])
    expect(pk.querySelector('.pk-meta span')?.textContent).toBe('95%')
    expect((pk.querySelector('.pk-bar i') as HTMLElement).style.width).toBe('95%')
    expect(pk.querySelector('.pk-meta')?.textContent).toBe('95%осталось около 1 минуты')
  })

  it('статус из опроса задания двигает шаг: waiting → processing', async () => {
    bff.state = st(null, { active_exchange: { job_id: J, status: 'waiting', created_at: ago(1) } })
    let n = 0
    bff.jobReply = () => (++n === 1 ? json(200, { status: 'processing', committed: false, committed_revision: null, cancel_reason: null, error_code: null }) : new Promise<Response>(() => {}))
    renderRoutePage(bff)
    await screen.findByTestId('route-building')
    await waitFor(() => expect(steps()).toEqual(['done', 'done', 'cur', '']))
  })

  it('не первый подбор (день есть) — без шагов, утверждённый текст спеки', async () => {
    bff.state = st([{ puzzle_id: 'youtube::vid00000001', kind: 'youtube', video_id: 'vid00000001', title: 'T', delivered: true, played: true, queued_played: false, new_words: 0, words: [] }], { active_exchange: { job_id: J, status: 'processing', created_at: ago(1) } })
    bff.jobReply = () => new Promise<Response>(() => {})
    renderRoutePage(bff)
    const pk = await screen.findByTestId('route-building')
    expect(pk.querySelector('.pk-steps')).toBeNull()
    expect(pk.querySelector('.pk-note')?.textContent).toBe('Подбираем рекомендации на сегодня. Страницу можно закрыть — маршрут сохранится')
  })
})

describe('нижняя полоса и запуск', () => {
  // Решение владельца 2026-11-19: «Маршрут без цели не имеет смысла. Предлагаю просить
  // выбрать цель.»
  it('без целей: «Выбрано: 0», «A2 · базовый», «Выберите хотя бы одну цель»; без «маршрут построится по уровню»; кнопка активна', async () => {
    await open()
    expect(bar().querySelector('.st-cnt')?.textContent).toBe('Выбрано: 0')
    expect(bar().textContent).toContain('A2 · базовый')
    expect(bar().querySelector('.st-need')?.textContent).toBe('Выберите хотя бы одну цель')
    expect(document.body.textContent).not.toContain('построится по уровню')
    expect(go().textContent).toBe('Начать маршрут')
    expect(go().disabled).toBe(false)
  })

  it('без целей нажатие — ни запроса, ни красной плашки, ни «Попробовать снова»: прокрутка к шагу 2 и подсказка', async () => {
    const scrolled: Element[] = []
    const orig = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(this) } as typeof orig
    try {
      await open()
      fireEvent.click(go())
      expect(bff.of('/api/me/route/quick-start', 'POST').length).toBe(0)
      expect(bar().querySelector('.msg.err')).toBeNull()
      expect(go().textContent).toBe('Начать маршрут')
      const msg = document.querySelector('.st-need-msg') as HTMLElement
      expect(msg.textContent).toBe('Выберите хотя бы одну цель')
      expect(msg.getAttribute('role')).toBe('alert')
      expect(scrolled.some(e => e.id === 'st-goal')).toBe(true)
      expect(bar().querySelector('.st-need')?.className).toContain('on')
      fireEvent.click(screen.getByRole('button', { name: 'Friends' }))
      expect(document.querySelector('.st-need-msg')).toBeNull()
      expect(bar().querySelector('.st-need')).toBeNull()
    } finally {
      Element.prototype.scrollIntoView = orig
    }
  })

  // Ревью v2a R1-M2: цель, выбранную гостем в широком каталоге (не из 8 курируемых),
  // не выбрасываем молча — карточка-чип с × (название из сохранённых данных), она в
  // «Выбрано» и уходит в цель. Устаревший id подменит BFF (target_aliases).
  it('сохранённая цель каталога, которой нет в /api/goals, — чип с ×, в «Выбрано», уходит в цель; × убирает', async () => {
    localStorage.setItem('flib:pointA', JSON.stringify({ kind: 'cefr', level: 'B1', ageBand: 0, goals: [], savedAt: '2026-11-01',
      goalsV2: [{ type: 'puzzle', slug: 'casino-1995', title: 'Casino', kind: 'film', target: 'casino-1995/casino-1995' }] }))
    // Ответ-отказ оставляет экран старта на месте — проверим и × после отправки.
    bff.quickStartReply = () => json(400, { error: 'goal_not_resolved' })
    await open()
    const chip = document.querySelector('.gc-extra .chip') as HTMLElement
    expect(chip.textContent).toContain('Casino')
    expect(bar().querySelector('.st-cnt')?.textContent).toBe('Выбрано: 1')
    fireEvent.click(go())
    await waitFor(() => expect(bff.of('/api/me/route/quick-start', 'POST').length).toBe(1))
    expect(bff.of('/api/me/route/quick-start', 'POST')[0].body).toMatchObject({ goal: { puzzle_ids: ['casino-1995/casino-1995'] } })
    fireEvent.click(within(chip).getByRole('button', { name: /Убрать/ }))
    expect(document.querySelector('.gc-extra .chip')).toBeNull()
    // Цели не осталось — повторное нажатие запроса не шлёт, просит выбрать цель.
    fireEvent.click(go())
    expect(bff.of('/api/me/route/quick-start', 'POST').length).toBe(1)
    expect(document.querySelector('.st-need-msg')).toBeTruthy()
  })

  it('сохранённая цель без target — показать нечем: не считается и не уходит', async () => {
    localStorage.setItem('flib:pointA', JSON.stringify({ kind: 'cefr', level: 'B1', ageBand: 0, goals: [], savedAt: '2026-11-01',
      goalsV2: [{ type: 'puzzle', slug: 'ghost', title: 'Ghost', kind: 'film', target: '' }] }))
    await open()
    expect(document.querySelector('.gc-extra')).toBeNull()
    expect(bar().querySelector('.st-cnt')?.textContent).toBe('Выбрано: 0')
  })

  it('/api/goals не ответил — сохранённый сериал виден чипом, считается и уходит со своим target (BFF подменит старый id)', async () => {
    localStorage.setItem('flib:pointA', JSON.stringify({ kind: 'cefr', level: 'B1', ageBand: 0, goals: [], savedAt: '2026-11-01',
      goalsV2: [{ type: 'puzzle', slug: 'ted-lasso', title: 'Ted Lasso', kind: 'series', target: 'ted-lasso/s01e01' },
                { type: 'category', key: 'science', title: 'Наука' }] }))
    const inner = bff.fetch
    bff.fetch = async (u: string, i?: RequestInit) => (String(u) === '/api/goals' ? new Promise<Response>(() => {}) : inner(u, i))
    renderRoutePage(bff)
    await screen.findByText(fullText('Давайте установим Ваш реальный уровень'))
    expect(bar().querySelector('.st-cnt')?.textContent).toBe('Выбрано: 2')
    expect(document.querySelector('.gc-extra .chip')?.textContent).toContain('Ted Lasso')
    fireEvent.click(go())
    await waitFor(() => expect(bff.of('/api/me/route/quick-start', 'POST').length).toBe(1))
    const body = bff.of('/api/me/route/quick-start', 'POST')[0].body as { goal: Record<string, unknown> }
    expect(body.goal.puzzle_ids).toEqual(['ted-lasso/s01e01'])
    expect(body.goal.categories).toEqual(['science'])
  })

  it('запуск: кнопка неактивна, спиннер и «Запускаем»', async () => {
    let release: (r: Response) => void = () => {}
    bff.quickStartReply = () => new Promise<Response>(r => { release = r })
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Friends' }))
    fireEvent.click(go())
    await waitFor(() => expect(go().textContent).toBe('Запускаем'))
    expect(go().disabled).toBe(true)
    expect(go().querySelector('.spin')).toBeTruthy()
    await act(async () => { release(json(400, { error: 'goal_not_resolved' })) })
  })

  it('ошибка запуска — красная плашка вместо сводки и «Попробовать снова» (повтор отправки)', async () => {
    let n = 0
    bff.quickStartReply = () => (++n === 1 ? json(400, { error: 'goal_not_resolved' }) : json(400, { error: 'goal_not_resolved' }))
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Friends' }))
    fireEvent.click(go())
    await waitFor(() => expect(bar().querySelector('.msg.err.st-err')?.textContent).toBe('Для этой цели пока нет материала — добавьте фильм, ролик или свои слова'))
    expect(bar().querySelector('.st-sum')).toBeNull()
    expect(go().textContent).toBe('Попробовать снова')
    fireEvent.click(go())
    await waitFor(() => expect(bff.of('/api/me/route/quick-start', 'POST').length).toBe(2))
  })

  it('временный сбой — плашка «Маршрут временно недоступен. Повторим через N с», кнопка неактивна до конца отсчёта', async () => {
    bff.quickStartReply = () => json(503, { error: 'route_unavailable' }, { 'Retry-After': '30' })
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Friends' }))
    fireEvent.click(go())
    await waitFor(() => expect(bar().querySelector('.msg.err')?.textContent).toMatch(/^Маршрут временно недоступен\. Повторим через \d+ с$/))
    expect(go().disabled).toBe(true)
    expect(go().textContent).toBe('Попробовать снова')
  })

  it('отказ шлюза — плашка «… мы уже знаем о проблеме» + поддержка', async () => {
    bff.quickStartReply = () => json(502, { error: 'gateway_refused' })
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Friends' }))
    fireEvent.click(go())
    await waitFor(() => expect(bar().querySelector('.msg.err')?.textContent).toContain('Маршрут временно недоступен, мы уже знаем о проблеме'))
    expect(within(bar()).getByRole('link', { name: '@FliboosterHelpUser_bot' })).toBeTruthy()
  })

  it('вопрос о списке слов — модальное окно: заголовок дизайна, утверждённый текст, «Оставить мой список» основная', async () => {
    bff.quickStartReply = () => json(409, { error: 'profile_has_words' })
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Friends' }))
    fireEvent.click(go())
    const dlg = await screen.findByRole('dialog', { name: 'У Вас уже есть список известных слов' })
    expect(dlg.closest('.dlg-scrim')).toBeTruthy()
    expect(dlg.textContent).toContain('У этого ключа уже сохранён список слов, которые Вы знаете. Оставить его или заменить словами уровня A2?')
    expect(within(dlg).getByRole('button', { name: 'Оставить мой список' }).className).toContain('primary')
    expect(within(dlg).getByRole('button', { name: 'Заменить' }).className).not.toContain('primary')
    // Фокус — в окне (основная кнопка).
    expect(document.activeElement).toBe(within(dlg).getByRole('button', { name: 'Оставить мой список' }))
  })

  it('окно вопроса: Esc закрывает и возвращает фокус на «Начать маршрут»', async () => {
    bff.quickStartReply = () => json(409, { error: 'profile_has_words' })
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Friends' }))
    go().focus()
    fireEvent.click(go())
    await screen.findByRole('dialog')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(go())
  })

  it('ошибка после «Оставить мой список» — окно закрывается, плашка видна', async () => {
    let n = 0
    bff.quickStartReply = () => (++n === 1 ? json(409, { error: 'profile_has_words' }) : json(400, { error: 'goal_not_resolved' }))
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Friends' }))
    fireEvent.click(go())
    const dlg = await screen.findByRole('dialog')
    fireEvent.click(within(dlg).getByRole('button', { name: 'Оставить мой список' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(bar().querySelector('.msg.err')?.textContent).toBe('Для этой цели пока нет материала — добавьте фильм, ролик или свои слова')
  })

  it('временный сбой после «Заменить» — окно закрывается, плашка с отсчётом видна', async () => {
    let n = 0
    bff.quickStartReply = () => (++n === 1 ? json(409, { error: 'profile_has_words' }) : json(503, { error: 'route_unavailable' }, { 'Retry-After': '30' }))
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Friends' }))
    fireEvent.click(go())
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Заменить' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(bar().querySelector('.msg.err')?.textContent).toMatch(/^Маршрут временно недоступен\. Повторим через \d+ с$/)
  })
})
