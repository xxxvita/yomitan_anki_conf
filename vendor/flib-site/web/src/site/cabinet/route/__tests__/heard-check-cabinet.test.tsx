// heard-check-cabinet.test.tsx — входы «дальше» кабинета: герой дня («Следующий
// ролик») и сторож `?next=`. Тест после ролика — ДО обмена; ответ выгружен
// раньше запроса обмена; закрытие без ответа — обмена нет и событий нет.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { fireEvent, screen, waitFor, within, act } from '@testing-library/react'
import { __resetSessionForTests, __setSessionForTests } from '../../../session'
import { __resetRouteStateForTests } from '../use-route-state'
import { __resetRouteOutboxForTests } from '../outbox'
import { FakeRouteBFF, renderRoutePage, st, del, und, pid, TODAY, ROUTE } from './route-page-fakes'
import { isHeardCheckSent, noteHeardFrac, resetHeardCheckMemory } from '../heard-check/heard-check-memory'
import { __resetHeardCheckFlowForTests } from '../heard-check/heard-check-flow'
import { abandonHeardCheck } from '../heard-check/heard-check-store'
import type { RouteState } from '../route-api'
import { markClipListened, __resetClipListenedForTests } from '../../../../player/route-events/clip-listened'

let bff: FakeRouteBFF
beforeEach(() => {
  __resetSessionForTests(); __resetRouteStateForTests(); __resetRouteOutboxForTests()
  localStorage.clear(); resetHeardCheckMemory(); __resetClipListenedForTests(); markClipListened(pid(1)); __resetHeardCheckFlowForTests(); abandonHeardCheck()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(`${TODAY}T12:00:00`))
  bff = new FakeRouteBFF()
  vi.stubGlobal('fetch', vi.fn((u: string, i?: RequestInit) => bff.fetch(u, i)))
  __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_abcd', routeAllowed: true, demo: false })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); __resetRouteOutboxForTests() })

const QID = `hc:${TODAY}:${pid(1)}`
const withQ = (s: RouteState): RouteState => ({ ...s, heard_check_questions: [{ id: QID, kind: 'heard_check', puzzle_id: pid(1), words: ['alpha', 'beta'] }] })
const hero = () => screen.getByTestId('day-hero')
const exchanges = () => bff.of('/api/me/route/exchange', 'POST')
const answered = () => bff.events().filter(e => e.type === 'question_answered')
async function show(s: RouteState, url?: string) { bff.state = s; renderRoutePage(bff, { url }); await screen.findByTestId('day-hero') }

describe('герой дня: «Следующий ролик» → тест → обмен', () => {
  it('≥ 0.6 и вопрос есть: тест открывается, обмена пока нет; «Готово» → событие, затем обмен', async () => {
    noteHeardFrac(pid(1), 0.9)
    await show(withQ(st([del(1, { queued_played: true }), und()])))
    bff.afterCommit = st([del(1, { played: true }), del(2)])
    fireEvent.click(within(hero()).getByRole('button', { name: 'Следующий ролик' }))
    const dlg = await screen.findByRole('dialog')
    expect(exchanges().length).toBe(0)
    fireEvent.click(within(dlg).getAllByTestId('hc-word')[1])
    fireEvent.click(within(dlg).getByTestId('hc-done'))
    await waitFor(() => expect(exchanges().length).toBe(1))
    const a = answered()
    expect(a).toHaveLength(1)
    expect(a[0]).toMatchObject({ puzzle_id: pid(1), question_id: QID, answer_outcome: 'answered', shown: ['alpha', 'beta'], marked: ['beta'] })
    // порядок: пачка с ответом ушла ДО создания обмена
    const order = bff.calls.map(c => c.url)
    expect(order.indexOf('/api/me/route/events')).toBeLessThan(order.indexOf('/api/me/route/exchange'))
    expect(isHeardCheckSent(QID, ROUTE)).toBe(true)
  })

  it('< 0.6 — теста нет, кнопка как раньше', async () => {
    noteHeardFrac(pid(1), 0.3)
    await show(withQ(st([del(1, { queued_played: true }), und()])))
    bff.afterCommit = st([del(1, { played: true }), del(2)])
    fireEvent.click(within(hero()).getByRole('button', { name: 'Следующий ролик' }))
    await waitFor(() => expect(exchanges().length).toBe(1))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(answered()).toHaveLength(0)
  })

  it('Esc → declined и обмен идёт', async () => {
    noteHeardFrac(pid(1), 1)
    await show(withQ(st([del(1, { queued_played: true }), und()])))
    bff.afterCommit = st([del(1, { played: true }), del(2)])
    fireEvent.click(within(hero()).getByRole('button', { name: 'Следующий ролик' }))
    await screen.findByRole('dialog')
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })) })
    await waitFor(() => expect(exchanges().length).toBe(1))
    expect(answered().map(e => e.answer_outcome)).toEqual(['declined'])
  })

  it('уход со страницы при открытом тесте — ни ответа, ни обмена', async () => {
    noteHeardFrac(pid(1), 1)
    const { unmount } = (bff.state = withQ(st([del(1, { queued_played: true }), und()])), renderRoutePage(bff))
    await screen.findByTestId('day-hero')
    fireEvent.click(within(hero()).getByRole('button', { name: 'Следующий ролик' }))
    await screen.findByRole('dialog')
    unmount()
    await act(async () => { await new Promise(r => setTimeout(r, 30)) })
    expect(answered()).toHaveLength(0)
    expect(exchanges().length).toBe(0)
    expect(isHeardCheckSent(QID, ROUTE)).toBe(false)
  })
})

describe('сторож ?next= (приход из плеера или урока слов)', () => {
  it('тест не пройден раньше и досмотр ≥ 0.6 — тест открывается до обмена', async () => {
    noteHeardFrac(pid(1), 0.8)
    bff.afterCommit = st([del(1, { played: true }), del(2)])
    bff.state = withQ(st([del(1, { queued_played: true }), und()]))
    renderRoutePage(bff, { url: `/app/route?next=${encodeURIComponent(pid(1))}` })
    const dlg = await screen.findByRole('dialog')
    expect(exchanges().length).toBe(0)
    fireEvent.click(within(dlg).getByTestId('hc-skip'))
    await waitFor(() => expect(exchanges().length).toBe(1))
    expect(answered().map(e => e.answer_outcome)).toEqual(['declined'])
  })

  it('из плеера тест уже пройден (id в памяти отправленных) — второго нет, обмен сразу', async () => {
    noteHeardFrac(pid(1), 1)
    localStorage.setItem('flib:route-heard-sent', JSON.stringify([`${ROUTE}|${QID}`]))
    bff.afterCommit = st([del(1, { played: true }), del(2)])
    bff.state = withQ(st([del(1, { queued_played: true }), und()]))
    renderRoutePage(bff, { url: `/app/route?next=${encodeURIComponent(pid(1))}` })
    await waitFor(() => expect(exchanges().length).toBe(1))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(answered()).toHaveLength(0)
  })
})

describe('LOW-6: кнопка занята, пока идут тест и выгрузка очереди', () => {
  const heroBtn = () => within(hero()).getByRole('button', { name: 'Следующий ролик', hidden: true })
  it('герой дня: на время теста кнопка неактивна, после ответа обмен идёт', async () => {
    noteHeardFrac(pid(1), 0.9)
    await show(withQ(st([del(1, { queued_played: true }), und()])))
    bff.afterCommit = st([del(1, { played: true }), del(2)])
    fireEvent.click(heroBtn())
    const dlg = await screen.findByRole('dialog')
    expect((heroBtn() as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(within(dlg).getByTestId('hc-skip'))
    await waitFor(() => expect(exchanges().length).toBe(1))
  })
  it('?next=: на время теста кнопка героя неактивна', async () => {
    noteHeardFrac(pid(1), 0.8)
    bff.afterCommit = st([del(1, { played: true }), del(2)])
    bff.state = withQ(st([del(1, { queued_played: true }), und()]))
    renderRoutePage(bff, { url: `/app/route?next=${encodeURIComponent(pid(1))}` })
    const dlg = await screen.findByRole('dialog')
    expect((heroBtn() as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(within(dlg).getByTestId('hc-skip'))
    await waitFor(() => expect(exchanges().length).toBe(1))
  })
})
