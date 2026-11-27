// KnowledgePage.test.tsx — «Мои знания»: разбор текста и ссылки, итог, просмотр,
// запись, «Слова», «Источники», отказы.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { KnowledgePage } from '../KnowledgePage'
import { __resetSessionForTests, __setSessionForTests } from '../../../session'
import { historyKey } from '../knowledge-history'
import { setRouteMarker } from '../../route/__tests__/route-page-fakes'

const HISTORY_KEY = historyKey('tpk_abcd')

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>
let calls: { url: string; method: string; body: unknown }[] = []
let handlers: Record<string, Handler> = {}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (u: string, i?: RequestInit) => {
    const url = String(u)
    const path = url.split('?')[0]
    calls.push({ url, method: i?.method ?? 'GET', body: i?.body ? JSON.parse(String(i.body)) : undefined })
    const h = handlers[path]
    if (!h) return json(404, { error: 'not_found' })
    return h(url, i)
  }))
}

const words = (...l: string[]) => l.map(lemma => ({ lemma, kind: 'word', forms: [] as string[] }))
const callsTo = (p: string) => calls.filter(c => c.url.split('?')[0] === p)

beforeEach(() => {
  __resetSessionForTests()
  setRouteMarker(true)
  __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_abcd', routeAllowed: true, demo: false })
  localStorage.clear()
  calls = []
  handlers = {}
  stubFetch()
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); setRouteMarker(false) })

const typeText = (v: string) => fireEvent.change(screen.getByTestId('kn-text'), { target: { value: v } })

describe('Мои знания — каркас', () => {
  it('H1 из макета, три вкладки, «Файл · скоро» — недоступный пункт, совет справа со ссылкой «Скачать Flibooster»', () => {
    render(<KnowledgePage />)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Что Вы уже понимаете')
    expect(screen.getByTestId('kn-tab-add').textContent).toBe('Добавить')
    expect(screen.getByTestId('kn-tab-words').textContent).toBe('Известные слова')
    expect(screen.getByTestId('kn-tab-sources').textContent).toBe('Мои источники')
    expect(screen.getByTestId('kn-tab-add').getAttribute('aria-selected')).toBe('true')
    const file = screen.getByTestId('kn-mode-file') as HTMLButtonElement
    expect(file.disabled).toBe(true)
    expect(file.getAttribute('role')).toBeNull() // не вкладка
    fireEvent.click(file)
    expect(screen.getByTestId('kn-mode-text').className).toContain('on')
    const hint = screen.getByTestId('kn-hint')
    expect(hint.className).toContain('hint')
    expect(hint.textContent).toContain('С длинными видео и аудиокнигами удобнее в программе Flibooster')
    expect(within(hint).getByText('Скачать Flibooster').getAttribute('href')).toBe('/download.html')
    expect(hint.parentElement?.className).toContain('know-grid')
    expect((screen.getByTestId('kn-run') as HTMLButtonElement).disabled).toBe(true)
  })

  it('стрелки/Home/End переключают вкладки; aria-controls — только на смонтированные панели', () => {
    render(<KnowledgePage />)
    const add = screen.getByTestId('kn-tab-add'), words = screen.getByTestId('kn-tab-words'), src = screen.getByTestId('kn-tab-sources')
    expect(add.getAttribute('aria-controls')).toBe('kn-panel-add')
    expect(words.getAttribute('aria-controls')).toBeNull()
    expect(add.getAttribute('tabindex')).toBe('0'); expect(words.getAttribute('tabindex')).toBe('-1')
    fireEvent.keyDown(add, { key: 'ArrowRight' })
    expect(words.getAttribute('aria-selected')).toBe('true')
    expect(words.getAttribute('aria-controls')).toBe('kn-panel-words')
    expect(document.getElementById('kn-panel-words')).toBeTruthy()
    fireEvent.keyDown(words, { key: 'End' })
    expect(src.getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(src, { key: 'ArrowRight' })
    expect(add.getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(add, { key: 'ArrowLeft' })
    expect(src.getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(src, { key: 'Home' })
    expect(add.getAttribute('aria-selected')).toBe('true')
    // каждый aria-controls указывает на существующий элемент
    for (const t of [add, words, src]) {
      const c = t.getAttribute('aria-controls')
      if (c) expect(document.getElementById(c)).toBeTruthy()
    }
  })

  it('без метки BFF — «скоро», запросов нет', () => {
    setRouteMarker(false)
    render(<KnowledgePage />)
    expect(screen.getByText('Скоро')).toBeTruthy()
    expect(screen.queryByTestId('kn-tab-add')).toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('ключ без права маршрута — объяснение вместо страницы', () => {
    __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_abcd', routeAllowed: false, demo: false })
    render(<KnowledgePage />)
    expect(screen.getByText(/Маршрут недоступен для этого ключа/)).toBeTruthy()
    expect(screen.queryByTestId('kn-tab-add')).toBeNull()
  })

  it('ключ истёк — продление', () => {
    __setSessionForTests({ cabinet: true, authenticated: true, state: 'expired', keyPrefix: 'tpk_abcd', routeAllowed: true, demo: false })
    render(<KnowledgePage />)
    expect(screen.getByText('Срок действия ключа закончился')).toBeTruthy()
    expect(screen.queryByTestId('kn-tab-add')).toBeNull()
  })
})

describe('Добавить: текст', () => {
  it('разобрать → «Найдено новых слов» → «Добавить все» → «Добавлено слов» + история', async () => {
    handlers['/api/me/knowledge/analyze'] = () => json(200, { new_words: words('world', 'run'), token_count: 6 })
    handlers['/api/me/knowledge/save'] = () => json(200, { added: 2, total: 2 })
    render(<KnowledgePage />)
    typeText('Hello world. I run.')
    fireEvent.click(screen.getByTestId('kn-run'))
    await screen.findByTestId('kn-ready')
    expect(screen.getByTestId('kn-count').textContent).toBe('2')
    expect(callsTo('/api/me/knowledge/analyze')[0].body).toEqual({ text: 'Hello world. I run.' })
    fireEvent.click(screen.getByTestId('kn-add-all'))
    await screen.findByTestId('kn-saved')
    expect(screen.getByTestId('kn-saved').textContent).toContain('Добавлено слов: 2')
    expect(callsTo('/api/me/knowledge/save')[0].body).toEqual({ lemmas: ['world', 'run'], source: { kind: 'text', title: 'Hello world. I run.' } })
    const hist = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]')
    expect(hist).toHaveLength(1)
    expect(hist[0]).toMatchObject({ kind: 'text', added: 2 })
  })

  it('просмотр: снятая галочка не уходит, выбор живёт между страницами', async () => {
    const many = Array.from({ length: 120 }, (_, i) => `word${i}`)
    handlers['/api/me/knowledge/analyze'] = () => json(200, { new_words: words(...many), token_count: 500 })
    handlers['/api/me/knowledge/save'] = () => json(200, { added: 119, total: 119 })
    render(<KnowledgePage />)
    typeText('x '.repeat(10))
    fireEvent.click(screen.getByTestId('kn-run'))
    await screen.findByTestId('kn-ready')
    fireEvent.click(screen.getByTestId('kn-review'))
    expect(screen.getAllByTestId('kn-word')).toHaveLength(50)
    fireEvent.click(screen.getByTestId('kn-check-word3'))
    fireEvent.click(screen.getByTestId('kn-page-next'))
    expect(screen.getByText('word50')).toBeTruthy()
    fireEvent.click(screen.getByTestId('kn-page-prev'))
    expect((screen.getByTestId('kn-check-word3') as HTMLInputElement).checked).toBe(false)
    expect(screen.getByTestId('kn-add-selected').textContent).toContain('(119)')
    fireEvent.click(screen.getByTestId('kn-add-selected'))
    await screen.findByTestId('kn-saved')
    expect((callsTo('/api/me/knowledge/save')[0].body as { lemmas: string[] }).lemmas).toEqual(many.filter(w => w !== 'word3'))
  })

  it('всё известно и нет английских слов — без кнопок сохранения', async () => {
    handlers['/api/me/knowledge/analyze'] = () => json(200, { new_words: [], token_count: 4 })
    render(<KnowledgePage />)
    typeText('hello')
    fireEvent.click(screen.getByTestId('kn-run'))
    await screen.findByTestId('kn-all-known')
    expect(screen.queryByTestId('kn-add-all')).toBeNull()
    handlers['/api/me/knowledge/analyze'] = () => json(200, { new_words: [], token_count: 0 })
    typeText('привет')
    fireEvent.click(screen.getByTestId('kn-run'))
    await screen.findByTestId('kn-no-words')
    expect(callsTo('/api/me/knowledge/save')).toHaveLength(0)
  })

  it('текст больше 200 КБ — отказ на странице, запрос не уходит', async () => {
    render(<KnowledgePage />)
    typeText('a'.repeat(200_001))
    fireEvent.click(screen.getByTestId('kn-run'))
    await screen.findByTestId('kn-failed-text_too_large')
    expect(callsTo('/api/me/knowledge/analyze')).toHaveLength(0)
  })

  it('дневной лимит — без «Повторить»', async () => {
    handlers['/api/me/knowledge/analyze'] = () => json(429, { error: 'daily_limit', code: 'daily_limit', used: 20, limit: 20 })
    render(<KnowledgePage />)
    typeText('hello world')
    fireEvent.click(screen.getByTestId('kn-run'))
    const f = await screen.findByTestId('kn-failed-daily_limit')
    expect(f.textContent).toContain('20 в день')
    expect(screen.queryByTestId('kn-retry')).toBeNull()
  })

  it('сервер занят — «Повторить» запускает разбор снова', async () => {
    let n = 0
    handlers['/api/me/knowledge/analyze'] = () => (++n === 1 ? json(503, { error: 'analyzer_timeout' }, { 'Retry-After': '5' }) : json(200, { new_words: words('x'), token_count: 3 }))
    render(<KnowledgePage />)
    typeText('hello')
    fireEvent.click(screen.getByTestId('kn-run'))
    await screen.findByTestId('kn-failed-analyzer_timeout')
    fireEvent.click(screen.getByTestId('kn-retry'))
    await screen.findByTestId('kn-ready')
    expect(n).toBe(2)
  })

  it('сеть упала при записи: слова остаются, повтор возможен и записывает', async () => {
    handlers['/api/me/knowledge/analyze'] = () => json(200, { new_words: words('a', 'b'), token_count: 3 })
    let n = 0
    handlers['/api/me/knowledge/save'] = () => { if (++n === 1) throw new TypeError('network'); return json(200, { added: 2, total: 2 }) }
    render(<KnowledgePage />)
    typeText('hello')
    fireEvent.click(screen.getByTestId('kn-run'))
    await screen.findByTestId('kn-ready')
    fireEvent.click(screen.getByTestId('kn-add-all'))
    await screen.findByTestId('kn-failed-network')
    expect(screen.getByTestId('kn-ready')).toBeTruthy()
    expect(localStorage.getItem(HISTORY_KEY)).toBeNull()
    fireEvent.click(screen.getByTestId('kn-add-all'))
    await screen.findByTestId('kn-saved')
  })

  it('401 при разборе — сессия перечитывается', async () => {
    handlers['/api/me/knowledge/analyze'] = () => json(401, { error: 'session_invalid' })
    handlers['/api/session'] = () => json(200, { authenticated: false, cabinet: true })
    render(<KnowledgePage />)
    typeText('hello')
    fireEvent.click(screen.getByTestId('kn-run'))
    await screen.findByTestId('kn-failed-session')
    await waitFor(() => expect(callsTo('/api/session').length).toBeGreaterThan(0))
  })

  it('уже было в словаре: «Уже были в словаре»', async () => {
    handlers['/api/me/knowledge/analyze'] = () => json(200, { new_words: words('a', 'b', 'c'), token_count: 3 })
    handlers['/api/me/knowledge/save'] = () => json(200, { added: 1, total: 9, skipped: 0 })
    render(<KnowledgePage />)
    typeText('hello')
    fireEvent.click(screen.getByTestId('kn-run'))
    await screen.findByTestId('kn-ready')
    fireEvent.click(screen.getByTestId('kn-add-all'))
    await screen.findByTestId('kn-saved')
    expect(screen.getByTestId('kn-saved').textContent).toContain('Уже были в словаре: 2')
  })
})

describe('Добавить: леммы, фразы, пропуски, длинные ролики', () => {
  it('фразы уходят с видом (chunk делает сервер), показывается лемма и формы-подсказка', async () => {
    handlers['/api/me/knowledge/analyze'] = () => json(200, {
      new_words: [{ lemma: 'give up', kind: 'phrase', forms: ['gave up', 'gives up'] }, { lemma: 'run', kind: 'word', forms: ['ran'] }],
      token_count: 9,
    })
    handlers['/api/me/knowledge/save'] = () => json(200, { added: 2, total: 2, skipped: 0 })
    render(<KnowledgePage />)
    typeText('he gave up and ran')
    fireEvent.click(screen.getByTestId('kn-run'))
    await screen.findByTestId('kn-ready')
    fireEvent.click(screen.getByTestId('kn-review'))
    expect(screen.getAllByTestId('kn-word')[0].textContent).toContain('give up')
    expect(screen.getAllByTestId('kn-word')[0].textContent).toContain('gave up, gives up')
    fireEvent.click(screen.getByTestId('kn-add-selected'))
    await screen.findByTestId('kn-saved')
    expect(callsTo('/api/me/knowledge/save')[0].body).toEqual({
      lemmas: ['give up', 'run'], kinds: { 'give up': 'phrase' }, source: { kind: 'text', title: 'he gave up and ran' },
    })
  })

  it('«Добавлено слов» + «Известно слов» из ответа; пропущенные необычные записи названы отдельно', async () => {
    handlers['/api/me/knowledge/analyze'] = () => json(200, { new_words: words('a', 'b', 'c', 'd'), token_count: 3 })
    handlers['/api/me/knowledge/save'] = () => json(200, { added: 2, total: 2377, skipped: 1 })
    render(<KnowledgePage />)
    typeText('hello')
    fireEvent.click(screen.getByTestId('kn-run'))
    await screen.findByTestId('kn-ready')
    fireEvent.click(screen.getByTestId('kn-add-all'))
    await screen.findByTestId('kn-saved')
    expect(screen.getByTestId('kn-known-total').textContent).toMatch(/2.377/)
    expect(screen.getByTestId('kn-skipped').textContent).toContain('1')
    expect(screen.getByTestId('kn-saved').textContent).toContain('Уже были в словаре: 1')
  })

  it('обрезанные субтитры длинного ролика — пользователю сказано', async () => {
    handlers['/api/me/knowledge/analyze'] = () => json(200, { new_words: words('a'), token_count: 3, truncated: true })
    render(<KnowledgePage />)
    fireEvent.click(screen.getByTestId('kn-mode-youtube'))
    fireEvent.change(screen.getByTestId('kn-url'), { target: { value: 'https://youtu.be/dQw4w9WgXcQ' } })
    fireEvent.click(screen.getByTestId('kn-run'))
    await screen.findByTestId('kn-truncated')
  })

  it('частичная запись (вторая пачка упала): добавленное попадает в историю', async () => {
    const many = Array.from({ length: 20_001 }, (_, i) => `w${i}`)
    handlers['/api/me/knowledge/analyze'] = () => json(200, { new_words: words(...many), token_count: 9 })
    let n = 0
    handlers['/api/me/knowledge/save'] = () => (++n === 1 ? json(200, { added: 20_000, total: 20_000 }) : json(502, { error: 'gateway_unavailable' }))
    render(<KnowledgePage />)
    typeText('hello')
    fireEvent.click(screen.getByTestId('kn-run'))
    await screen.findByTestId('kn-ready')
    fireEvent.click(screen.getByTestId('kn-add-all'))
    await screen.findByTestId('kn-failed-unknown')
    const hist = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]')
    expect(hist).toHaveLength(1)
    expect(hist[0].added).toBe(20_000)
  })

  it('пока идёт разбор, режим не переключается; ответ после ухода с вкладки/сброса не применяется', async () => {
    let release: (r: Response) => void = () => undefined
    handlers['/api/me/knowledge/analyze'] = () => new Promise<Response>(res => { release = res })
    const { unmount } = render(<KnowledgePage />)
    typeText('hello')
    fireEvent.click(screen.getByTestId('kn-run'))
    await waitFor(() => expect((screen.getByTestId('kn-mode-youtube') as HTMLButtonElement).disabled).toBe(true))
    unmount()
    await act(async () => { release(json(200, { new_words: words('a'), token_count: 3 })) })
    expect(screen.queryByTestId('kn-ready')).toBeNull() // ничего не смонтировано и не упало
  })
})

describe('Добавить: ссылка YouTube', () => {
  it('ссылка уходит как youtube_url; история хранит id и ссылку на ролик', async () => {
    handlers['/api/me/knowledge/analyze'] = () => json(200, { new_words: words('word'), token_count: 3 })
    handlers['/api/me/knowledge/save'] = () => json(200, { added: 1, total: 1 })
    render(<KnowledgePage />)
    fireEvent.click(screen.getByTestId('kn-mode-youtube'))
    fireEvent.change(screen.getByTestId('kn-url'), { target: { value: 'https://youtu.be/dQw4w9WgXcQ?t=5' } })
    fireEvent.click(screen.getByTestId('kn-run'))
    await screen.findByTestId('kn-ready')
    expect(callsTo('/api/me/knowledge/analyze')[0].body).toEqual({ youtube_url: 'https://youtu.be/dQw4w9WgXcQ?t=5' })
    fireEvent.click(screen.getByTestId('kn-add-all'))
    await screen.findByTestId('kn-saved')
    expect((callsTo('/api/me/knowledge/save')[0].body as { source: unknown }).source).toEqual({ kind: 'youtube', title: 'YouTube · dQw4w9WgXcQ', video_id: 'dQw4w9WgXcQ' })
    fireEvent.click(screen.getByTestId('kn-tab-sources'))
    const row = screen.getByTestId('kn-source')
    expect(within(row).getByRole('link').getAttribute('href')).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
  })

  it('нет субтитров — подсказка про Flibooster со ссылкой «Скачать Flibooster»', async () => {
    handlers['/api/me/knowledge/analyze'] = () => json(422, { error: 'youtube_unavailable', code: 'youtube_unavailable' })
    render(<KnowledgePage />)
    fireEvent.click(screen.getByTestId('kn-mode-youtube'))
    fireEvent.change(screen.getByTestId('kn-url'), { target: { value: 'https://youtu.be/dQw4w9WgXcQ' } })
    fireEvent.click(screen.getByTestId('kn-run'))
    const f = await screen.findByTestId('kn-failed-youtube_unavailable')
    expect(f.textContent).toContain('Не удалось получить субтитры этого ролика')
    expect(f.textContent).toContain('там всё уже работает, знания загружаются быстрее и в полном объёме')
    expect(screen.getByTestId('kn-download').getAttribute('href')).toBe('/download.html')
    expect(screen.queryByTestId('kn-retry')).toBeNull()
  })

  it('не ссылка на ролик — подсказка из макета, «Распознать» неактивна, запрос не уходит', () => {
    render(<KnowledgePage />)
    fireEvent.click(screen.getByTestId('kn-mode-youtube'))
    fireEvent.change(screen.getByTestId('kn-url'), { target: { value: 'garbage' } })
    expect(screen.getByTestId('kn-url-hint').textContent).toBe('Нужна ссылка на ролик YouTube')
    expect((screen.getByTestId('kn-run') as HTMLButtonElement).disabled).toBe(true)
    expect(callsTo('/api/me/knowledge/analyze')).toHaveLength(0)
  })

  it('сервер отверг ссылку (чужой хост) — тот же текст', async () => {
    handlers['/api/me/knowledge/analyze'] = () => json(400, { error: 'bad_youtube_url', code: 'bad_youtube_url' })
    render(<KnowledgePage />)
    fireEvent.click(screen.getByTestId('kn-mode-youtube'))
    fireEvent.change(screen.getByTestId('kn-url'), { target: { value: 'https://evil.example/watch?v=dQw4w9WgXcQ' } })
    fireEvent.click(screen.getByTestId('kn-run'))
    const f = await screen.findByTestId('kn-failed-bad_youtube_url')
    expect(f.textContent).toContain('Нужна ссылка на ролик YouTube')
  })

  it('временный сбой субтитров (503 retryable) — предложение программы И «Повторить», не текст про анализатор', async () => {
    let n = 0
    handlers['/api/me/knowledge/analyze'] = () => (++n === 1
      ? json(503, { error: 'youtube_unavailable', code: 'youtube_unavailable', retryable: true }, { 'Retry-After': '5' })
      : json(200, { new_words: words('x'), token_count: 3 }))
    render(<KnowledgePage />)
    fireEvent.click(screen.getByTestId('kn-mode-youtube'))
    fireEvent.change(screen.getByTestId('kn-url'), { target: { value: 'https://youtu.be/dQw4w9WgXcQ' } })
    fireEvent.click(screen.getByTestId('kn-run'))
    const f = await screen.findByTestId('kn-failed-youtube_unavailable')
    expect(f.textContent).not.toContain('разбора слов')
    expect(screen.getByTestId('kn-download').getAttribute('href')).toBe('/download.html')
    fireEvent.click(screen.getByTestId('kn-retry'))
    await screen.findByTestId('kn-ready')
  })
})

describe('Слова', () => {
  const page = (items: string[], total = items.length, matched = items.length) =>
    json(200, { total, matched, offset: 0, items: items.map(lemma => ({ lemma, status: 'known_offanki' })) })

  it('счётчик, список, пустой профиль', async () => {
    handlers['/api/me/knowledge/words'] = () => page(['apple', 'banana'], 2)
    render(<KnowledgePage />)
    fireEvent.click(screen.getByTestId('kn-tab-words'))
    await waitFor(() => expect(screen.getAllByTestId('kn-row')).toHaveLength(2))
    expect(screen.getByTestId('kn-words-count').textContent).toBe('2')
    expect(screen.getByText('Известно слов')).toBeTruthy()
    cleanup()
    handlers['/api/me/knowledge/words'] = () => page([], 0)
    render(<KnowledgePage />)
    fireEvent.click(screen.getByTestId('kn-tab-words'))
    await screen.findByTestId('kn-words-empty')
  })

  it('поиск уходит с задержкой и сбрасывает список; «Показать ещё» дозагружает', async () => {
    handlers['/api/me/knowledge/words'] = (url) => {
      const u = new URL(url, 'https://x')
      const off = Number(u.searchParams.get('offset'))
      if (u.searchParams.get('q') === 'app') return page(['apple'], 100, 1)
      return json(200, { total: 100, matched: 100, offset: off, items: Array.from({ length: 50 }, (_, i) => ({ lemma: `w${off + i}`, status: 'mature' })) })
    }
    render(<KnowledgePage />)
    fireEvent.click(screen.getByTestId('kn-tab-words'))
    await waitFor(() => expect(screen.getAllByTestId('kn-row')).toHaveLength(50))
    expect(screen.getByTestId('kn-more').textContent).toContain('осталось 50')
    fireEvent.click(screen.getByTestId('kn-more'))
    await waitFor(() => expect(screen.getAllByTestId('kn-row')).toHaveLength(100))
    expect(screen.queryByTestId('kn-more')).toBeNull()
    fireEvent.change(screen.getByTestId('kn-search'), { target: { value: 'app' } })
    await waitFor(() => expect(screen.getAllByTestId('kn-row')).toHaveLength(1), { timeout: 2000 })
    expect(screen.getByTestId('kn-row').textContent).toContain('apple')
    expect(screen.getByTestId('kn-words-count').textContent).toBe('100')
  })

  it('ошибка загрузки — сообщение и «Повторить»', async () => {
    let n = 0
    handlers['/api/me/knowledge/words'] = () => (++n === 1 ? json(502, { error: 'gateway_unavailable' }) : page(['apple']))
    render(<KnowledgePage />)
    fireEvent.click(screen.getByTestId('kn-tab-words'))
    await screen.findByTestId('kn-words-error')
    fireEvent.click(within(screen.getByTestId('kn-words-error')).getByText('Повторить'))
    await waitFor(() => expect(screen.getAllByTestId('kn-row')).toHaveLength(1))
  })

  it('после записи на «Добавить» список слов перечитывается', async () => {
    let total = 1
    handlers['/api/me/knowledge/words'] = () => page(Array.from({ length: total }, (_, i) => `w${i}`), total)
    handlers['/api/me/knowledge/analyze'] = () => json(200, { new_words: words('a', 'b'), token_count: 3 })
    handlers['/api/me/knowledge/save'] = () => { total = 3; return json(200, { added: 2, total: 3 }) }
    render(<KnowledgePage />)
    typeText('hello')
    fireEvent.click(screen.getByTestId('kn-run'))
    await screen.findByTestId('kn-ready')
    fireEvent.click(screen.getByTestId('kn-add-all'))
    await screen.findByTestId('kn-saved')
    fireEvent.click(screen.getByTestId('kn-tab-words'))
    await waitFor(() => expect(screen.getByTestId('kn-words-count').textContent).toBe('3'))
  })
})

describe('Источники', () => {
  it('пусто; сломанное хранилище не ломает страницу', () => {
    render(<KnowledgePage />)
    fireEvent.click(screen.getByTestId('kn-tab-sources'))
    expect(screen.getByTestId('kn-sources-empty')).toBeTruthy()
    localStorage.setItem(HISTORY_KEY, '{"не":"массив"}')
    cleanup()
    render(<KnowledgePage />)
    fireEvent.click(screen.getByTestId('kn-tab-sources'))
    expect(screen.getByTestId('kn-sources-empty')).toBeTruthy()
  })

  it('история по ключу: чужой ключ записей не видит', () => {
    localStorage.setItem(historyKey('tpk_zzzz'), JSON.stringify([{ kind: 'text', title: 'Чужой', at: '2026-11-20T10:00:00Z', added: 3 }]))
    render(<KnowledgePage />)
    fireEvent.click(screen.getByTestId('kn-tab-sources'))
    expect(screen.getByTestId('kn-sources-empty').textContent).toContain('Источников пока нет. Добавьте текст, ролик или запись на вкладке «Добавить».')
  })

  it('записи и «Очистить историю»', () => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify([{ kind: 'text', title: 'Мой текст', at: '2026-11-20T10:00:00Z', added: 7 }]))
    render(<KnowledgePage />)
    fireEvent.click(screen.getByTestId('kn-tab-sources'))
    expect(screen.getByTestId('kn-source').textContent).toContain('7')
    expect(screen.getByRole('table')).toBeTruthy()
    act(() => { fireEvent.click(screen.getByTestId('kn-clear')) })
    expect(screen.getByTestId('kn-sources-empty')).toBeTruthy()
    expect(localStorage.getItem(HISTORY_KEY)).toBeNull()
  })
})
