// next-warning-cabinet.test.tsx — предупреждение «Вы прослушали не весь ролик.»
// на входах «дальше» кабинета (герой дня, сторож `?next=`) и клавиатура окна.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { fireEvent, screen, waitFor, within, act } from '@testing-library/react'
import { __resetSessionForTests, __setSessionForTests } from '../../../session'
import { __resetRouteStateForTests } from '../use-route-state'
import { __resetRouteOutboxForTests } from '../outbox'
import { FakeRouteBFF, renderRoutePage, st, del, und, other, pid, TODAY } from './route-page-fakes'
import { noteHeardFrac, resetHeardCheckMemory } from '../heard-check/heard-check-memory'
import { __resetHeardCheckFlowForTests } from '../heard-check/heard-check-flow'
import { abandonHeardCheck } from '../heard-check/heard-check-store'
import { abandonNextWarning } from '../heard-check/next-warning-store'
import { __resetClipListenedForTests, markClipListened } from '../../../../player/route-events/clip-listened'
import type { RouteState } from '../route-api'

let bff: FakeRouteBFF
beforeEach(() => {
  __resetSessionForTests(); __resetRouteStateForTests(); __resetRouteOutboxForTests()
  localStorage.clear(); __resetClipListenedForTests(); resetHeardCheckMemory(); __resetHeardCheckFlowForTests(); abandonHeardCheck(); abandonNextWarning()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(`${TODAY}T12:00:00`))
  bff = new FakeRouteBFF()
  vi.stubGlobal('fetch', vi.fn((u: string, i?: RequestInit) => bff.fetch(u, i)))
  __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_abcd', routeAllowed: true, demo: false })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); __resetRouteOutboxForTests(); abandonNextWarning() })

const QID = `hc:${TODAY}:${pid(1)}`
const withQ = (s: RouteState): RouteState => ({ ...s, heard_check_questions: [{ id: QID, kind: 'heard_check', puzzle_id: pid(1), words: ['alpha', 'beta'] }] })
const hero = () => screen.getByTestId('day-hero')
const exchanges = () => bff.of('/api/me/route/exchange', 'POST')
const answered = () => bff.events().filter(e => e.type === 'question_answered')
const nextBtn = () => within(hero()).getByRole('button', { name: 'Следующий ролик' })
const key = (k: string) => act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })) })
async function show(s: RouteState) { bff.state = s; renderRoutePage(bff); await screen.findByTestId('day-hero') }

describe('герой дня: непрослушанный ролик', () => {
  it('предупреждение: дословный текст, две кнопки, фокус на «Вернуться»; обмена и событий нет', async () => {
    noteHeardFrac(pid(1), 1)
    await show(withQ(st([del(1, { queued_played: true }), und()])))
    fireEvent.click(nextBtn())
    const dlg = await screen.findByRole('dialog')
    expect(within(dlg).getByText('Вы прослушали не весь ролик.')).toBeTruthy()
    expect(dlg.textContent).not.toMatch(/\d/)
    const back = within(dlg).getByRole('button', { name: 'Вернуться к ролику' })
    expect(within(dlg).getByRole('button', { name: 'Всё равно перейти к следующему ролику' })).toBeTruthy()
    expect(document.activeElement).toBe(back)
    expect(exchanges().length).toBe(0)
    expect(answered()).toHaveLength(0)
  })

  it('«Вернуться к ролику» — закрыто, ничего не отправлено', async () => {
    noteHeardFrac(pid(1), 1)
    await show(withQ(st([del(1, { queued_played: true }), und()])))
    fireEvent.click(nextBtn())
    fireEvent.click(await screen.findByTestId('nw-back'))
    await act(async () => { await new Promise(r => setTimeout(r, 30)) })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(exchanges().length).toBe(0)
    expect(answered()).toHaveLength(0)
  })

  it('Esc = «Вернуться»; Enter на кнопке в фокусе нажимает её (по умолчанию — «Вернуться»)', async () => {
    noteHeardFrac(pid(1), 1)
    await show(withQ(st([del(1, { queued_played: true }), und()])))
    fireEvent.click(nextBtn())
    await screen.findByRole('dialog')
    await key('Escape')
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(nextBtn())
    await screen.findByRole('dialog')
    await key('Enter')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(exchanges().length).toBe(0)
    expect(answered()).toHaveLength(0)
  })

  it('«Всё равно перейти» — обмен идёт, теста нет, question_answered не ставится', async () => {
    noteHeardFrac(pid(1), 1)
    await show(withQ(st([del(1, { queued_played: true }), und()])))
    bff.afterCommit = st([del(1, { played: true }), del(2)])
    fireEvent.click(nextBtn())
    fireEvent.click(await screen.findByTestId('nw-proceed'))
    await waitFor(() => expect(exchanges().length).toBe(1))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(answered()).toHaveLength(0)
  })

  it('повторные нажатия при открытом окне — одно окно, один обмен', async () => {
    await show(withQ(st([del(1, { queued_played: true }), und()])))
    bff.afterCommit = st([del(1, { played: true }), del(2)])
    const b = nextBtn()
    fireEvent.click(b); fireEvent.click(b)
    await screen.findByRole('dialog')
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    fireEvent.click(screen.getByTestId('nw-proceed'))
    await waitFor(() => expect(exchanges().length).toBe(1))
    expect(exchanges().length).toBe(1)
  })
})

describe('героя дня: прослушанный ролик — как раньше', () => {
  it('без предупреждения; тест после ролика открывается', async () => {
    markClipListened(pid(1))
    noteHeardFrac(pid(1), 1)
    await show(withQ(st([del(1, { queued_played: true }), und()])))
    fireEvent.click(nextBtn())
    const dlg = await screen.findByRole('dialog')
    expect(within(dlg).getByText('Тест после ролика')).toBeTruthy()
    expect(screen.queryByText('Вы прослушали не весь ролик.')).toBeNull()
  })
})

describe('сторож ?next= и skip_hc', () => {
  it('skip_hc=1: обмен сразу, теста нет, событий нет, параметры убраны из адреса', async () => {
    noteHeardFrac(pid(1), 1)
    bff.afterCommit = st([del(1, { played: true }), del(2)])
    bff.state = withQ(st([del(1, { queued_played: true }), und()]))
    renderRoutePage(bff, { url: `/app/route?next=${encodeURIComponent(pid(1))}&skip_hc=1` })
    await waitFor(() => expect(exchanges().length).toBe(1))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(answered()).toHaveLength(0)
    expect(screen.getByTestId('location').textContent).not.toMatch(/skip_hc|next=/)
  })

  it('без skip_hc (прослушан в плеере) тест по-прежнему открывается', async () => {
    markClipListened(pid(1))
    noteHeardFrac(pid(1), 1)
    bff.state = withQ(st([del(1, { queued_played: true }), und()]))
    renderRoutePage(bff, { url: `/app/route?next=${encodeURIComponent(pid(1))}` })
    const dlg = await screen.findByRole('dialog')
    expect(within(dlg).getByText('Тест после ролика')).toBeTruthy()
  })
})

describe('вход с главной кабинета («Продолжить маршрут» = ?next= без skip_hc), не прослушан', () => {
  it('предупреждение на странице маршрута; «Вернуться» — обмена нет, параметры убраны', async () => {
    noteHeardFrac(pid(1), 1)
    bff.state = withQ(st([del(1, { queued_played: true }), und()]))
    renderRoutePage(bff, { url: `/app/route?next=${encodeURIComponent(pid(1))}` })
    const dlg = await screen.findByTestId('next-warning')
    expect(within(dlg).getByText('Вы прослушали не весь ролик.')).toBeTruthy()
    expect(screen.getByTestId('location').textContent).toBe('/app/route')
    fireEvent.click(within(dlg).getByTestId('nw-back'))
    await act(async () => { await new Promise(r => setTimeout(r, 30)) })
    expect(exchanges().length).toBe(0)
    expect(answered()).toHaveLength(0)
  })

  it('«Всё равно перейти» — обмен без теста', async () => {
    noteHeardFrac(pid(1), 1)
    bff.afterCommit = st([del(1, { played: true }), del(2)])
    bff.state = withQ(st([del(1, { queued_played: true }), und()]))
    renderRoutePage(bff, { url: `/app/route?next=${encodeURIComponent(pid(1))}` })
    fireEvent.click(await screen.findByTestId('nw-proceed'))
    await waitFor(() => expect(exchanges().length).toBe(1))
    expect(screen.queryByTestId('heard-check')).toBeNull()
    expect(answered()).toHaveLength(0)
  })
})

describe('не-YouTube клипы не предупреждают', () => {
  it('текущий kind:"other": «Следующий ролик» без предупреждения', async () => {
    await show(st([other(1), und()]))
    bff.afterCommit = st([other(1, { played: true }), del(2)])
    fireEvent.click(nextBtn())
    await waitFor(() => expect(exchanges().length).toBe(1))
    expect(screen.queryByTestId('next-warning')).toBeNull()
  })
})

describe('клавиши при открытом окне', () => {
  it('пробел и цифры не доходят до плеера (document); Esc закрывает', async () => {
    await show(withQ(st([del(1, { queued_played: true }), und()])))
    fireEvent.click(nextBtn())
    await screen.findByTestId('next-warning')
    const seen: string[] = []
    const on = (e: KeyboardEvent) => { seen.push(e.key) }
    document.addEventListener('keydown', on)
    for (const k of ['1', '3', ' ']) {
      await act(async () => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })) })
    }
    expect(seen).toEqual([])
    await key('Escape')
    document.removeEventListener('keydown', on)
    expect(screen.queryByTestId('next-warning')).toBeNull()
  })
})
