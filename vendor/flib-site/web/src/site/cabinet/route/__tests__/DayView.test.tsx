// DayView.test.tsx — экран дня (план B10b, приёмка): кнопки по фикстурам, оценка
// и замена «точно как в приложении», сторож `?next=`, сторож удаления
// `flib:route-watched`, фикстура Р24, урок слов, правило «до выдачи».
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { fireEvent, screen, waitFor, within, act } from '@testing-library/react'
import { __resetSessionForTests, __setSessionForTests } from '../../../session'
import { __resetRouteStateForTests } from '../use-route-state'
import { __resetRouteOutboxForTests, getRouteOutbox } from '../outbox'
import { writeWatched, readWatched } from '../../../../player/route-events/route-watched'
import { FakeRouteBFF, json, renderRoutePage, st, del, und, kept, lesson, other, pid, vid, ROUTE, ROUTE2, TODAY, fullText } from './route-page-fakes'
import type { RouteState } from '../route-api'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { markClipListened, __resetClipListenedForTests } from '../../../../player/route-events/clip-listened'

let bff: FakeRouteBFF
beforeEach(() => {
  __resetSessionForTests(); __resetRouteStateForTests(); __resetRouteOutboxForTests()
  localStorage.clear(); __resetClipListenedForTests(); for (const n of [1, 2, 3]) markClipListened(pid(n))
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(`${TODAY}T12:00:00`))
  bff = new FakeRouteBFF()
  vi.stubGlobal('fetch', vi.fn((u: string, i?: RequestInit) => bff.fetch(u, i)))
  __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_abcd', routeAllowed: true, demo: false })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); __resetRouteOutboxForTests() })

const hero = () => screen.getByTestId('day-hero')
const meta = () => screen.getByTestId('route-meta').textContent ?? ''
const rows = () => screen.getAllByTestId(/^row-\d+$/)
const row = (i: number) => screen.getByTestId(`row-${i}`)
const exchanges = () => bff.of('/api/me/route/exchange', 'POST').map(c => c.body as Record<string, unknown>)
const rated = () => bff.events().filter(e => e.type === 'clip_rated')
async function flushOutbox() { await act(async () => { await getRouteOutbox().flush({ timeoutMs: 3000 }) }) }
async function show(s: RouteState, url?: string) { bff.state = s; renderRoutePage(bff, { url }); await screen.findByTestId('day-hero').catch(() => screen.findByTestId('day-done')) }
async function queueClipPlayed(p: string, frac = 0.8) {
  await getRouteOutbox().enqueueDurable(ROUTE, { event_id: `web:cp-${p}-${Math.random()}`, type: 'clip_played', puzzle_id: p, played_frac: frac, learning_day: TODAY, client_ts: new Date().toISOString() }, { frac })
}

describe('герой и строка метаданных', () => {
  it('«Ролик 2 из 5» ≠ «1 из 5 просмотрено» (2-й текущий, 1 просмотрен, 5 в дне)', async () => {
    await show(st([del(1, { played: true }), del(2), und(), und(), und()]))
    expect(within(hero()).getByText('Ролик 2 из 5')).toBeTruthy()
    expect(meta()).toContain('1 из 5')
    expect(meta()).toContain('просмотрено')
  })

  it('«Смотреть» открывает плеер в маршрутном режиме (rp)', async () => {
    await show(st([del(1), und()]))
    const a = within(hero()).getByRole('link', { name: 'Смотреть' })
    expect(a.getAttribute('href')).toBe(`/player?v=${vid(1)}&rp=${encodeURIComponent(pid(1))}`)
  })

  it('пятисекундный заход (queued_played, доля 0,1) — «Смотреть снова» (rp) + «Следующий ролик», без галочки и «k»', async () => {
    writeWatched(ROUTE, TODAY, pid(1), 0.1, {})
    await show(st([del(1, { queued_played: true }), und()]))
    expect(within(hero()).getByRole('link', { name: 'Смотреть снова' }).getAttribute('href')).toContain('rp=')
    expect(within(hero()).getByRole('button', { name: 'Следующий ролик' })).toBeTruthy()
    expect(meta()).toContain('0 из 2')
    expect(row(1).querySelector('.ck')).toBeNull()
  })

  it('последний ролик дня досмотрен → перезагрузка → день завершён с подписью', async () => {
    writeWatched(ROUTE, TODAY, pid(2), 0.9, {})
    await show(st([del(1, { played: true }), del(2, { queued_played: true })]))
    const done = screen.getByTestId('day-done')
    expect(within(done).getByText('Все ролики дня просмотрены')).toBeTruthy()
    expect(within(done).getByText(fullText('На сегодня всё — до завтра'))).toBeTruthy()
    // под карточкой — строка последнего ролика со «Смотреть снова» (rp), «Заменить» и оценкой
    expect(within(row(2)).getByRole('link', { name: 'Смотреть снова' }).getAttribute('href')).toContain('rp=')
    expect(within(row(2)).getByRole('button', { name: 'Заменить' })).toBeTruthy()
    expect(within(row(2)).getByRole('button', { name: 'Нравится' })).toBeTruthy()
  })

  it('тот же день без локальной отметки (другое устройство) — герой со «Смотреть снова»', async () => {
    await show(st([del(1, { played: true }), del(2, { queued_played: true })]))
    expect(within(hero()).getByRole('link', { name: 'Смотреть снова' })).toBeTruthy()
    expect(screen.queryByTestId('day-done')).toBeNull()
  })

  it('один «пройден без зачёта» и досмотренный последний — «На сегодня всё» БЕЗ подписи, «1 из 2»', async () => {
    await show(st([del(1), del(2, { played: true })]))
    const done = screen.getByTestId('day-done')
    expect(within(done).queryByText('Все ролики дня просмотрены')).toBeNull()
    expect(done.textContent).toContain('1 из 2')
  })

  it('урок слов последним, не просмотрен — герой с кнопкой урока; с записью 0,8 — день завершён', async () => {
    await show(st([del(1, { played: true }), lesson('aaaa')]))
    expect(within(hero()).getByRole('link', { name: 'Пройти урок' }).getAttribute('href')).toBe('/app/route/words?rw=words%3A%3Aaaaa')
    expect(screen.queryByTestId('day-done')).toBeNull()
  })

  it('урок с записью 0,8 (отчёт ещё в очереди шлюза) — день завершён', async () => {
    writeWatched(ROUTE, TODAY, 'words::aaaa', 0.8, { words: ['a'] })
    await show(st([del(1, { played: true }), lesson('aaaa', { queued_played: true })]))
    expect(screen.getByTestId('day-done')).toBeTruthy()
  })

  it('коммит day_done (view.clip = null): герой — последний выданный, «Заменить» и оценка на месте', async () => {
    await show(st([del(1, { played: true }), del(2)]))
    expect(within(hero()).getByText('Title 2')).toBeTruthy()
    expect(within(hero()).getByRole('button', { name: 'Заменить' })).toBeTruthy()
    expect(within(hero()).getByRole('button', { name: 'Нравится' })).toBeTruthy()
    expect(row(2).getAttribute('data-kind')).toBe('current')
  })

  it('план без выданных — «Начать день» = обмен next', async () => {
    await show(st([und(), und()], { current_puzzle_id: null }))
    fireEvent.click(within(hero()).getByRole('button', { name: 'Начать день' }))
    await waitFor(() => expect(exchanges().length).toBe(1))
    expect(exchanges()[0]).toMatchObject({ want: 'next' })
  })

  it('текущий kind:"other" — главная «Следующий ролик», карточка программы Flibooster', async () => {
    await show(st([other(1), und()]))
    expect(within(hero()).getByRole('button', { name: 'Следующий ролик' })).toBeTruthy()
    expect(within(hero()).getByText('Этот ролик открывается в программе Flibooster')).toBeTruthy()
    expect(within(hero()).getByRole('link', { name: 'Скачать Flibooster' }).getAttribute('href')).toBe('/download.html')
  })

  it('новый учебный день — «Получить ролики на сегодня» → обмен с for_date = сегодня; заголовок без «Сегодня,»', async () => {
    await show(st([del(1, { played: true })], { snapshot_date: '2026-11-17', day: { date: '2026-11-17', clips: [del(1, { played: true })] } }))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('17 ноября')
    fireEvent.click(screen.getByRole('button', { name: 'Получить ролики на сегодня' }))
    await waitFor(() => expect(exchanges().length).toBe(1))
    expect(exchanges()[0]).toMatchObject({ want: 'next', for_date: TODAY })
  })

  it('заголовок сегодня — «Сегодня, 18 ноября»', async () => {
    await show(st([del(1)]))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Сегодня, 18 ноября')
  })
})

describe('«Следующий ролик» и сторож ?next=', () => {
  it('«Следующий ролик» героя → обмен, выдан YouTube-ролик — плеер с rp', async () => {
    writeWatched(ROUTE, TODAY, pid(1), 0.9, {})
    await show(st([del(1, { queued_played: true }), und()]))
    bff.afterCommit = st([del(1, { played: true }), del(2), ])
    fireEvent.click(within(hero()).getByRole('button', { name: 'Следующий ролик' }))
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe(`/player?v=${vid(2)}&rp=${encodeURIComponent(pid(2))}`))
  })

  it('?next=<старый id> — ноль обменов, параметр убран', async () => {
    await show(st([del(1, { played: true }), del(2), und()]), `/app/route?next=${encodeURIComponent(pid(1))}`)
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/app/route'))
    expect(exchanges().length).toBe(0)
  })

  it('?next= при плане без невыданных — ноль обменов, параметр убран', async () => {
    await show(st([del(1, { played: true }), del(2)]), `/app/route?next=${encodeURIComponent(pid(2))}`)
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/app/route'))
    expect(exchanges().length).toBe(0)
  })

  it('W-M2: ?next=<текущий>, обмен выдал урок слов — остаёмся на /app/route, герой-урок «Пройти урок», ноль запросов примеров', async () => {
    bff.afterCommit = st([del(1, { played: true }), lesson('bbbb'), und()])
    await show(st([del(1, { played: true }), und(), und()]), `/app/route?next=${encodeURIComponent(pid(1))}`)
    await waitFor(() => expect(exchanges().length).toBe(1))
    await waitFor(() => expect(within(hero()).getByRole('link', { name: 'Пройти урок' })).toBeTruthy())
    expect(screen.getByTestId('location').textContent).toBe('/app/route')
    expect(bff.calls.filter(c => c.url.includes('/examples')).length).toBe(0)
  })

  it('W-M2: тот же ?next= (со страницы урока), обмен выдал YouTube — плеер с rp', async () => {
    bff.afterCommit = st([lesson('aaaa', { played: true }), del(2), und()])
    await show(st([lesson('aaaa', { played: true }), und(), und()]), `/app/route?next=${encodeURIComponent('words::aaaa')}`)
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe(`/player?v=${vid(2)}&rp=${encodeURIComponent(pid(2))}`))
  })
})

describe('без Г7 (replace_available:false)', () => {
  it('«Заменить» нет нигде; строка причин без галки; «Отправить» — только clip_rated, ноль обменов', async () => {
    await show(st([del(1, { played: true }), del(2), und()], { replace_available: false }))
    expect(screen.queryAllByRole('button', { name: 'Заменить' })).toEqual([])
    fireEvent.click(within(hero()).getByRole('button', { name: 'Не нравится' }))
    const panel = screen.getByRole('group', { name: 'Что не так с роликом?' })
    expect(within(panel).queryByLabelText('Заменить ролик')).toBeNull()
    fireEvent.click(within(panel).getByLabelText('Не интересно'))
    fireEvent.click(within(panel).getByRole('button', { name: 'Отправить' }))
    await flushOutbox()
    expect(rated()).toMatchObject([{ puzzle_id: pid(2), rating: 'dislike', rate_reason: 'content', subs_source: '' }])
    expect(exchanges().length).toBe(0)
  })
})

describe('с Г7: оценка и замена «точно как в приложении»', () => {
  it('«Не нравится» — 8 причин, галка включена, «Отправить» неактивна до причины; «Отмена» ничего не шлёт', async () => {
    await show(st([del(1), und()]))
    fireEvent.click(within(hero()).getByRole('button', { name: 'Не нравится' }))
    const panel = screen.getByRole('group', { name: 'Что не так с роликом?' })
    for (const t of ['Субтитры неполные или не совпадают с речью', 'Субтитры не попадают во время', 'Речь не на английском', 'Запутался, слишком сложно', 'Не интересно', 'Плохое видео или звук', 'Видео не открывается', 'Ограничение по возрасту']) {
      expect(within(panel).getByLabelText(t)).toBeTruthy()
    }
    expect((within(panel).getByLabelText('Заменить ролик') as HTMLInputElement).checked).toBe(true)
    expect((within(panel).getByRole('button', { name: 'Отправить' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(within(panel).getByRole('button', { name: 'Отмена' }))
    await flushOutbox()
    expect(bff.events()).toEqual([])
    expect(exchanges()).toEqual([])
    expect(screen.queryByRole('group', { name: 'Что не так с роликом?' })).toBeNull()
  })

  it('«Отправить» с галкой — clip_rated(dislike, причина) РАНЬШЕ обмена replace с тем же replace_reason; несданный clip_played удалён', async () => {
    writeWatched(ROUTE, TODAY, pid(1), 0.8, { title: 'x' })
    await show(st([del(1, { queued_played: true }), und()]))
    await queueClipPlayed(pid(1))
    fireEvent.click(within(hero()).getByRole('button', { name: 'Не нравится' }))
    const panel = screen.getByRole('group', { name: 'Что не так с роликом?' })
    fireEvent.click(within(panel).getByLabelText('Плохое видео или звук'))
    fireEvent.click(within(panel).getByRole('button', { name: 'Отправить' }))
    await waitFor(() => expect(exchanges().length).toBe(1))
    expect(exchanges()[0]).toMatchObject({ want: 'replace', replace_puzzle_id: pid(1), replace_reason: 'video_quality' })
    const evPost = bff.of('/api/me/route/events', 'POST')
    const exPost = bff.of('/api/me/route/exchange', 'POST')[0]
    const ratedPost = evPost.find(c => (c.body as { events: Array<{ type: string }> }).events.some(e => e.type === 'clip_rated'))!
    expect(ratedPost.at).toBeLessThan(exPost.at)
    expect(rated()).toMatchObject([{ puzzle_id: pid(1), rating: 'dislike', rate_reason: 'video_quality' }])
    expect(bff.events().filter(e => e.type === 'clip_played' && e.puzzle_id === pid(1))).toEqual([])
    expect(readWatched()?.items[pid(1)]).toBeUndefined()
  })

  it('«Отправить» без галки — только clip_rated', async () => {
    await show(st([del(1), und()]))
    fireEvent.click(within(hero()).getByRole('button', { name: 'Не нравится' }))
    const panel = screen.getByRole('group', { name: 'Что не так с роликом?' })
    fireEvent.click(within(panel).getByLabelText('Заменить ролик'))
    fireEvent.click(within(panel).getByLabelText('Не интересно'))
    fireEvent.click(within(panel).getByRole('button', { name: 'Отправить' }))
    await flushOutbox()
    expect(rated().length).toBe(1)
    expect(exchanges()).toEqual([])
    // подсветка «Не нравится» после «Отправить»
    await waitFor(() => expect(within(hero()).getByRole('button', { name: 'Не нравится' }).getAttribute('aria-pressed')).toBe('true'))
  })

  it('«Заменить» → строка подтверждения; [Заменить] — обмен без replace_reason, ноль clip_rated; clip_played удалён', async () => {
    await show(st([del(1), und()]))
    await queueClipPlayed(pid(1))
    fireEvent.click(within(hero()).getByRole('button', { name: 'Заменить' }))
    const c = screen.getByRole('group', { name: 'Подтверждение замены' })
    expect(within(c).getByText('Маршрут подберёт новый набор роликов на сегодня. Заменить?')).toBeTruthy()
    fireEvent.click(within(c).getByRole('button', { name: 'Заменить' }))
    await waitFor(() => expect(exchanges().length).toBe(1))
    expect(exchanges()[0]).toMatchObject({ want: 'replace', replace_puzzle_id: pid(1) })
    expect('replace_reason' in exchanges()[0]).toBe(false)
    await flushOutbox()
    expect(rated()).toEqual([])
    expect(bff.events().filter(e => e.type === 'clip_played')).toEqual([])
  })

  it('«Заменить» → [Отмена] — ничего', async () => {
    await show(st([del(1), und()]))
    fireEvent.click(within(hero()).getByRole('button', { name: 'Заменить' }))
    fireEvent.click(within(screen.getByRole('group', { name: 'Подтверждение замены' })).getByRole('button', { name: 'Отмена' }))
    await flushOutbox()
    expect(exchanges()).toEqual([])
    expect(bff.events()).toEqual([])
  })

  it('замена строки «пройден без зачёта» (не текущей) — replace_puzzle_id этой строки; после коммита герой — первый ролик нового плана, вспышка только у героя', async () => {
    await show(st([del(1), del(2), und()]))
    expect(row(1).getAttribute('data-kind')).toBe('passed')
    bff.afterCommit = st([del(7), und(), und()], { revision: 6 })
    fireEvent.click(within(row(1)).getByRole('button', { name: 'Заменить' }))
    fireEvent.click(within(screen.getByRole('group', { name: 'Подтверждение замены' })).getByRole('button', { name: 'Заменить' }))
    await waitFor(() => expect(exchanges().length).toBe(1))
    expect(exchanges()[0]).toMatchObject({ replace_puzzle_id: pid(1) })
    await waitFor(() => expect(within(hero()).getByText('Title 7')).toBeTruthy())
    expect(hero().classList.contains('fresh')).toBe(true)
    expect(document.querySelectorAll('.vrow.fresh').length).toBe(0)
    expect(screen.getByText('День подобран заново — просмотренные ролики остались в списке')).toBeTruthy()
  })

  it('пока идёт замена — «Подбираем замену…» на герое, кнопки оценки и замены неактивны', async () => {
    let release: () => void = () => {}
    bff.exchangeReply = () => new Promise<Response>(r => { release = () => r(json(202, { job_id: '33333333-3333-4333-8333-333333333333', base_revision: 5 })) })
    await show(st([del(1), del(2), und()]))
    fireEvent.click(within(hero()).getByRole('button', { name: 'Заменить' }))
    fireEvent.click(within(screen.getByRole('group', { name: 'Подтверждение замены' })).getByRole('button', { name: 'Заменить' }))
    await waitFor(() => expect(within(hero()).getByText('Подбираем замену…')).toBeTruthy())
    for (const b of screen.getAllByRole('button', { name: /^(Нравится|Не нравится|Заменить)$/ })) expect((b as HTMLButtonElement).disabled).toBe(true)
    release()
  })

  it('у kept и урока слов «Заменить» нет и галки нет, оценка есть', async () => {
    await show(st([kept(1), lesson('a', { played: true }), del(3), und()], { current_puzzle_id: pid(3) }))
    for (const i of [1, 2]) {
      expect(within(row(i)).queryByRole('button', { name: 'Заменить' })).toBeNull()
      expect(within(row(i)).getByRole('button', { name: 'Нравится' })).toBeTruthy()
    }
    fireEvent.click(within(row(1)).getByRole('button', { name: 'Не нравится' }))
    expect(within(screen.getByRole('group', { name: 'Что не так с роликом?' })).queryByLabelText('Заменить ролик')).toBeNull()
  })

  it('текущий урок слов (в плане): у героя «Заменить» нет, в строке причин героя и строки урока галки нет', async () => {
    await show(st([del(1, { played: true }), lesson('a'), und()]))
    expect(within(hero()).queryByRole('button', { name: 'Заменить' })).toBeNull()
    fireEvent.click(within(hero()).getByRole('button', { name: 'Не нравится' }))
    expect(within(screen.getByRole('group', { name: 'Что не так с роликом?' })).queryByLabelText('Заменить ролик')).toBeNull()
    fireEvent.click(within(screen.getByRole('group', { name: 'Что не так с роликом?' })).getByRole('button', { name: 'Отмена' }))
    fireEvent.click(within(row(2)).getByRole('button', { name: 'Не нравится' }))
    expect(within(screen.getByRole('group', { name: 'Что не так с роликом?' })).queryByLabelText('Заменить ролик')).toBeNull()
    // контроль: у ролика YouTube той же раскладки галка есть
    fireEvent.click(within(screen.getByRole('group', { name: 'Что не так с роликом?' })).getByRole('button', { name: 'Отмена' }))
    fireEvent.click(within(row(1)).getByRole('button', { name: 'Не нравится' }))
    expect(within(screen.getByRole('group', { name: 'Что не так с роликом?' })).getByLabelText('Заменить ролик')).toBeTruthy()
  })

  it('«Нравится» — clip_rated(like, subs_source:""); повторный клик по выбранной — ноль событий', async () => {
    await show(st([del(1), und()]))
    fireEvent.click(within(hero()).getByRole('button', { name: 'Нравится' }))
    await waitFor(() => expect(within(hero()).getByRole('button', { name: 'Нравится' }).getAttribute('aria-pressed')).toBe('true'))
    fireEvent.click(within(hero()).getByRole('button', { name: 'Нравится' }))
    fireEvent.click(within(row(1)).getByRole('button', { name: 'Нравится' }))
    await flushOutbox()
    expect(rated()).toMatchObject([{ puzzle_id: pid(1), rating: 'like', subs_source: '' }])
    expect(rated().length).toBe(1)
  })

  it('выбранная «Не нравится» не открывает строку причин; смена на «Нравится» шлёт новое событие', async () => {
    localStorage.setItem('flib:route-ratings', JSON.stringify({ v: 1, route_id: ROUTE, items: { [pid(1)]: 'dislike' } }))
    await show(st([del(1), und()]))
    fireEvent.click(within(hero()).getByRole('button', { name: 'Не нравится' }))
    expect(screen.queryByRole('group', { name: 'Что не так с роликом?' })).toBeNull()
    fireEvent.click(within(hero()).getByRole('button', { name: 'Нравится' }))
    await flushOutbox()
    expect(rated()).toMatchObject([{ rating: 'like' }])
  })

  it('вкладка, узнавшая о «Выходе», не пишет flib:route-ratings (контроль: до выхода — пишет)', async () => {
    await show(st([del(1), del(2), und()]))
    fireEvent.click(within(row(1)).getByRole('button', { name: 'Нравится' }))
    await waitFor(() => expect(localStorage.getItem('flib:route-ratings')).not.toBeNull())
    localStorage.removeItem('flib:route-ratings')
    getRouteOutbox().forget()
    fireEvent.click(within(hero()).getByRole('button', { name: 'Нравится' }))
    await act(async () => { await new Promise(r => setTimeout(r, 30)) })
    expect(localStorage.getItem('flib:route-ratings')).toBeNull()
  })

  it('flib:route-ratings с чужим route_id игнорируется', async () => {
    localStorage.setItem('flib:route-ratings', JSON.stringify({ v: 1, route_id: ROUTE2, items: { [pid(1)]: 'like' } }))
    await show(st([del(1), und()]))
    expect(within(hero()).getByRole('button', { name: 'Нравится' }).getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(within(hero()).getByRole('button', { name: 'Нравится' }))
    await flushOutbox()
    expect(rated().length).toBe(1)
  })

  it('409 replace_unavailable — «Замена сейчас недоступна» под кнопкой и перечитанное состояние', async () => {
    bff.exchangeReply = () => json(409, { error: 'replace_unavailable' })
    await show(st([del(1), und()]))
    fireEvent.click(within(hero()).getByRole('button', { name: 'Заменить' }))
    fireEvent.click(within(screen.getByRole('group', { name: 'Подтверждение замены' })).getByRole('button', { name: 'Заменить' }))
    await screen.findByText('Замена сейчас недоступна')
  })
})

describe('строки списка (H4)', () => {
  it('«пройден без зачёта» — номер, «Пересмотреть» с back=route&rc, не в «k»', async () => {
    await show(st([del(1), del(2), und()]))
    const r1 = row(1)
    expect(r1.getAttribute('data-kind')).toBe('passed')
    expect(within(r1).getByText('01')).toBeTruthy()
    expect(within(r1).getByRole('link', { name: 'Пересмотреть' }).getAttribute('href')).toBe(`/player?v=${vid(1)}&back=route&rc=${encodeURIComponent(pid(1))}`)
    expect(meta()).toContain('0 из 3')
  })

  it('невыданный — «Следующий ролик / Откроется после текущего» с замком, без кнопок', async () => {
    await show(st([del(1), und()], { next_clip: { title: 'SECRET NEXT TITLE' } }))
    const r = row(2)
    expect(within(r).getByText('Следующий ролик')).toBeTruthy()
    expect(within(r).getByText('Откроется после текущего')).toBeTruthy()
    expect(within(r).queryAllByRole('button')).toEqual([])
    expect(document.body.textContent).not.toContain('SECRET NEXT TITLE')
  })

  it('урок слов: кнопка урока ведёт на страницу урока; «пройден без зачёта» — «Продолжить урок», не «Пересмотреть»; ни слова о программе Flibooster', async () => {
    writeWatched(ROUTE, TODAY, 'words::aaaa', 0.3, { words: ['a'] })
    await show(st([lesson('aaaa', { queued_played: true }), del(2), und()]))
    const r = row(1)
    expect(within(r).getByText('Урок слов · 3 слова')).toBeTruthy()
    expect(within(r).getByRole('link', { name: 'Продолжить урок' }).getAttribute('href')).toBe('/app/route/words?rw=words%3A%3Aaaaa')
    expect(within(r).queryByRole('link', { name: 'Пересмотреть' })).toBeNull()
    expect(document.body.textContent).not.toContain('Этот урок открывается в программе Flibooster')
    expect(within(r).queryByText('Скачать Flibooster')).toBeNull()
  })

  it('W-L3: урок с долей 0,4, отчёт обработан (played:false, записи нет), в flib:route-lesson 2 слова — «Продолжить урок»', async () => {
    localStorage.setItem('flib:route-lesson', JSON.stringify({ v: 1, route_id: ROUTE, day: TODAY, items: { 'words::aaaa': { heard: ['alpha', 'beta'] } } }))
    await show(st([lesson('aaaa'), und()]))
    expect(within(hero()).getByRole('link', { name: 'Продолжить урок' })).toBeTruthy()
  })

  it('раскрытие «+N сл.» — один блок, aria-expanded, выражения цветом акцента; у невыданных нет', async () => {
    await show(st([del(1, { new_words: 2, words: ['figure out', 'cat'], played: true }), del(2, { new_words: 1, words: ['dog'] }), und({ new_words: 4 })]))
    const b1 = within(row(1)).getByRole('button', { name: /\+2 сл\./ })
    fireEvent.click(b1)
    expect(b1.getAttribute('aria-expanded')).toBe('true')
    expect(within(row(1)).getByText('Новые слова и выражения · 2')).toBeTruthy()
    expect(within(row(1)).getByText('figure out').className).toContain('ph')
    fireEvent.click(within(row(2)).getByRole('button', { name: /\+1 сл\./ }))
    expect(b1.getAttribute('aria-expanded')).toBe('false')
    expect(within(row(3)).queryByRole('button')).toBeNull()
    fireEvent.click(within(row(2)).getByRole('button', { name: /\+1 сл\./ }))
    expect(screen.queryByText(/Новые слова и выражения/)).toBeNull()
  })

  it('kept — галочка, «Пересмотреть» с back=route&rc; урок среди kept — без кнопки урока', async () => {
    await show(st([kept(1), kept(2, { puzzle_id: 'words::kk', kind: 'words', video_id: undefined, title: undefined, words: ['a', 'b'] }), del(3), und()], { current_puzzle_id: pid(3) }))
    expect(row(1).querySelector('.ck')).toBeTruthy()
    expect(within(row(1)).getByRole('link', { name: 'Пересмотреть' }).getAttribute('href')).toBe(`/player?v=${vid(1)}&back=route&rc=${encodeURIComponent(pid(1))}`)
    expect(within(row(2)).getByText('Урок слов · 2 слова')).toBeTruthy()
    expect(within(row(2)).queryAllByRole('link')).toEqual([])
  })

  it('день из 40 роликов: строки с многоточием, без фиксированной ширины (вёрстка на 360 px)', async () => {
    const clips = [del(1, { title: 'A'.repeat(300) }), ...Array.from({ length: 39 }, () => und())]
    await show(st(clips))
    expect(rows().length).toBe(40)
    const css = readFileSync(join(process.cwd(), 'src/site/cabinet/route/route.css'), 'utf-8')
    expect(css).toMatch(/\.cab \.vrow \{[^}]*grid-template-columns: 28px minmax\(0,1fr\) auto/)
    expect(css).toMatch(/\.cab \.vrow \.t \{[^}]*overflow: hidden;[^}]*text-overflow: ellipsis/)
    expect(css).not.toMatch(/min-width:\s*[4-9]\d\dpx/)
  })
})

describe('сторож удаления flib:route-watched (R2-L1, R3-M3, R4-C1)', () => {
  it('коммит, не засчитавший ролик, УДАЛЯЕТ запись; следующий пятисекундный заход не оживляет старый максимум', async () => {
    writeWatched(ROUTE, TODAY, pid(1), 0.9, {})
    await show(st([del(1), und()]))
    await waitFor(() => expect(readWatched()?.items[pid(1)]).toBeUndefined())
  })

  it('состояние, запрошенное пока clip_played ролика в очереди, запись не удаляет; следующее — удаляет', async () => {
    writeWatched(ROUTE, TODAY, pid(1), 0.9, {})
    await queueClipPlayed(pid(1))
    bff.eventsReply = b => json(200, { accepted: b.events.length, duplicates: 0, rejected: [], evicted_external: 0 })
    let n = 0
    bff.state = () => { n++; return json(200, st([del(1), und()])) }
    renderRoutePage(bff)
    await screen.findByTestId('day-hero')
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    expect(readWatched()?.items[pid(1)]).toBeTruthy()
    await flushOutbox()
    window.dispatchEvent(new Event('focus'))
    await act(async () => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')) })
    await waitFor(() => expect(n).toBeGreaterThanOrEqual(2))
    await waitFor(() => expect(readWatched()?.items[pid(1)]).toBeUndefined())
  })

  it('R4-C1: отчёт поставлен ПОСЛЕ отправки запроса и выгружен ДО ответа — запись не удаляется', async () => {
    let release: () => void = () => {}
    let n = 0
    // как шлюз: принятый отчёт виден в queued_played ответов, посчитанных ПОСЛЕ приёма;
    // первый ответ посчитан до него (задержанный ответ, режим B0)
    let stored = false
    const orig = bff.eventsReply
    bff.eventsReply = b => { stored = true; return orig(b) }
    bff.state = () => {
      n++
      if (n === 1) return new Promise<Response>(r => { release = () => r(json(200, st([del(1), und()]))) })
      return json(200, st([del(1, { queued_played: stored }), und()]))
    }
    renderRoutePage(bff)
    await waitFor(() => expect(n).toBe(1))
    // плеер в другой вкладке: отчёт в очередь и запись под той же блокировкой, затем выгрузка
    await getRouteOutbox().enqueueDurable(ROUTE, { event_id: 'web:late', type: 'clip_played', puzzle_id: pid(1), played_frac: 0.9, learning_day: TODAY, client_ts: new Date().toISOString() }, { frac: 0.9, afterWrite: () => writeWatched(ROUTE, TODAY, pid(1), 0.9, {}) })
    await flushOutbox()
    await act(async () => { release(); await new Promise(r => setTimeout(r, 30)) })
    await screen.findByTestId('day-hero')
    expect(readWatched()?.items[pid(1)]).toBeTruthy()
  })
})

describe('фикстура Р24 (kept_local)', () => {
  const before = () => st([del(1, { played: true }), del(2), del(3, { queued_played: true }), und(), und()])
  const after = (over: Partial<RouteState> = {}) => st([kept(1), del(20), und(), und()], { current_puzzle_id: pid(20), revision: 6, ...over })

  it('после коммита замены 2-го ролика 3-й (досмотрен здесь) — строкой kept_local после kept 1-го; «Ролик 3 из 2+M′», «2 из 2+M′»', async () => {
    writeWatched(ROUTE, TODAY, pid(3), 0.9, { video_id: vid(3), title: 'Title 3', duration_sec: 300 })
    await show(before())
    bff.afterCommit = after()
    fireEvent.click(within(row(2)).getByRole('button', { name: 'Заменить' }))
    fireEvent.click(within(screen.getByRole('group', { name: 'Подтверждение замены' })).getByRole('button', { name: 'Заменить' }))
    await waitFor(() => expect(within(hero()).getByText('Title 20')).toBeTruthy())
    expect(rows().map(r => r.getAttribute('data-kind'))).toEqual(['kept', 'kept_local', 'current', 'locked', 'locked'])
    const kl = row(2)
    expect(kl.querySelector('.ck')).toBeTruthy()
    expect(within(kl).getByRole('link', { name: 'Пересмотреть' }).getAttribute('href')).toBe(`/player?v=${vid(3)}&back=route`)
    expect(within(kl).getByRole('button', { name: 'Нравится' })).toBeTruthy()
    expect(within(kl).queryByRole('button', { name: 'Заменить' })).toBeNull()
    expect(within(hero()).getByText('Ролик 3 из 5')).toBeTruthy()
    expect(meta()).toContain('2 из 5')
  })

  it('без записи (второе устройство) — строки нет, «1 из 4»', async () => {
    await show(after())
    expect(rows().map(r => r.getAttribute('data-kind'))).toEqual(['kept', 'current', 'locked', 'locked'])
    expect(meta()).toContain('1 из 4')
  })

  it('другая дата плана — строки нет', async () => {
    writeWatched(ROUTE, '2026-11-17', pid(3), 0.9, { title: 'Title 3' })
    await show(after())
    expect(rows().length).toBe(4)
  })

  it('новый route_id (сброс) — строки нет', async () => {
    writeWatched(ROUTE2, TODAY, pid(3), 0.9, { title: 'Title 3' })
    await show(after())
    expect(rows().length).toBe(4)
  })

  it('замена досмотренного ролика с этого устройства — его запись удалена, строкой kept_local он не возвращается', async () => {
    writeWatched(ROUTE, TODAY, pid(3), 0.9, { video_id: vid(3), title: 'Title 3', duration_sec: 300 })
    await show(before())
    bff.afterCommit = after()
    fireEvent.click(within(row(3)).getByRole('button', { name: 'Заменить' }))
    fireEvent.click(within(screen.getByRole('group', { name: 'Подтверждение замены' })).getByRole('button', { name: 'Заменить' }))
    await waitFor(() => expect(within(hero()).getByText('Title 20')).toBeTruthy())
    expect(rows().map(r => r.getAttribute('data-kind'))).toEqual(['kept', 'current', 'locked', 'locked'])
    expect(readWatched()?.items[pid(3)]).toBeUndefined()
  })

  it('42д: тот же ролик заменён «со второго устройства» — строка kept_local остаётся', async () => {
    writeWatched(ROUTE, TODAY, pid(3), 0.9, { video_id: vid(3), title: 'Title 3', duration_sec: 300 })
    await show(after())
    expect(rows().map(r => r.getAttribute('data-kind'))).toEqual(['kept', 'kept_local', 'current', 'locked', 'locked'])
  })

  it('замена на фикстуре «до замены 2 засчитаны из 5» → два kept сверху, «Ролик 3 из 2+M′», «2 из 2+M′»', async () => {
    await show(st([del(1, { played: true }), del(2, { played: true }), del(3), und(), und()]))
    bff.afterCommit = st([kept(1), kept(2), del(30), und()], { current_puzzle_id: pid(30), revision: 6 })
    fireEvent.click(within(hero()).getByRole('button', { name: 'Заменить' }))
    fireEvent.click(within(screen.getByRole('group', { name: 'Подтверждение замены' })).getByRole('button', { name: 'Заменить' }))
    await waitFor(() => expect(within(hero()).getByText('Title 30')).toBeTruthy())
    expect(within(hero()).getByText('Ролик 3 из 4')).toBeTruthy()
    expect(meta()).toContain('2 из 4')
  })
})
