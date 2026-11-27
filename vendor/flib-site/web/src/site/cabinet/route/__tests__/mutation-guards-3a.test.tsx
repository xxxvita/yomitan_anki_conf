// mutation-guards-3a.test.tsx — стражи по выжившим мутантам партии 3а:
// граница доли 0,6; «Следующего ролика» нет без невыданных; дедуп оценки на
// обоих рубежах (кнопка и rateClip) по отдельности.
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/react'
import { buildDayModel, heroButtons, type DayRow } from '../day-model'
import { rateClip, saveRating } from '../route-ratings'
import { RateButtons } from '../RateButtons'
import { DislikeReasons } from '../DislikeReasons'
import type { DayActions } from '../day-actions'
import { MemStorage } from './outbox-fakes'
import { del, pid, st, und, ROUTE } from './route-page-fakes'

describe('граница «просмотрен»: доля ровно 0,6 — просмотрен', () => {
  it('0,6 + отчёт не обработан → просмотрен; 0,59 → нет', () => {
    const mk = (share: number) => buildDayModel(st([del(1, { queued_played: true }), und()]), { watched: { [pid(1)]: { share } }, pendingClipPlayed: new Set() })
    expect(mk(0.6).current?.watched).toBe(true)
    expect(mk(0.59).current?.watched).toBe(false)
  })
  it('kept_local: ровно 0,6 — строка есть', () => {
    const m = buildDayModel(st([del(10)]), { watched: { [pid(3)]: { share: 0.6, meta: { title: 'x' } } }, pendingClipPlayed: new Set() })
    expect(m.rows.some(r => r.kind === 'kept_local')).toBe(true)
  })
})

describe('«открыт, не просмотрен», невыданных нет — «Следующего ролика» нет', () => {
  it('главная «Смотреть снова», второстепенной нет', () => {
    const m = buildDayModel(st([del(1, { queued_played: true })]), { watched: {}, pendingClipPlayed: new Set() })
    expect(heroButtons(m)).toEqual({ primary: 'watch_again', secondary: null })
  })
})

describe('дедуп оценки — каждый рубеж отдельно', () => {
  it('rateClip: та же оценка уже выбрана — в очередь ничего', async () => {
    const storage = new MemStorage()
    const outbox = { enqueueDurable: vi.fn(async () => {}), isClosed: () => false }
    saveRating(ROUTE, pid(1), 'like', storage)
    const sent = await rateClip({ routeId: ROUTE, puzzleId: pid(1), rating: 'like', subsSource: '', snapshotDate: null, outbox, storage })
    expect(sent).toBe(false)
    expect(outbox.enqueueDurable).not.toHaveBeenCalled()
    // контроль: другая оценка — уходит
    expect(await rateClip({ routeId: ROUTE, puzzleId: pid(1), rating: 'dislike', reason: 'content', subsSource: '', snapshotDate: null, outbox, storage })).toBe(true)
    expect(outbox.enqueueDurable).toHaveBeenCalledTimes(1)
  })

  it('rateClip: «Выход» посреди постановки — оценка не записывается', async () => {
    const storage = new MemStorage()
    let closed = false
    const outbox = { enqueueDurable: vi.fn(async () => { closed = true }), isClosed: () => closed }
    expect(await rateClip({ routeId: ROUTE, puzzleId: pid(1), rating: 'like', subsSource: '', snapshotDate: null, outbox, storage })).toBe(false)
    expect(storage.getItem('flib:route-ratings')).toBeNull()
    // контроль: без выхода — записывается
    const ok = { enqueueDurable: vi.fn(async () => {}), isClosed: () => false }
    expect(await rateClip({ routeId: ROUTE, puzzleId: pid(2), rating: 'like', subsSource: '', snapshotDate: null, outbox: ok, storage })).toBe(true)
    expect(storage.getItem('flib:route-ratings')).not.toBeNull()
  })

  it('кнопка: выбранная «Нравится» не зовёт действие; невыбранная — зовёт', () => {
    const row = { puzzleId: pid(1) } as DayRow
    const like = vi.fn()
    const dislike = vi.fn()
    const a = { busy: false, ratingOf: () => 'like', like, dislike } as unknown as DayActions
    const { unmount } = render(<RateButtons row={row} a={a} where="row" />)
    fireEvent.click(screen.getByRole('button', { name: 'Нравится' }))
    expect(like).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Не нравится' }))
    expect(dislike).toHaveBeenCalledTimes(1)
    unmount()
    const a2 = { busy: false, ratingOf: () => null, like, dislike } as unknown as DayActions
    render(<RateButtons row={row} a={a2} where="row" />)
    fireEvent.click(screen.getByRole('button', { name: 'Нравится' }))
    expect(like).toHaveBeenCalledTimes(1)
  })
})

describe('DislikeReasons без галки — «Отправить» никогда не просит замену', () => {
  it('canReplace=false → onSubmit(причина, false); canReplace=true → (причина, true)', () => {
    const onSubmit = vi.fn()
    const { unmount } = render(<DislikeReasons canReplace={false} onSubmit={onSubmit} onCancel={() => {}} />)
    fireEvent.click(screen.getByLabelText('Не интересно'))
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }))
    expect(onSubmit).toHaveBeenLastCalledWith('content', false)
    unmount()
    render(<DislikeReasons canReplace onSubmit={onSubmit} onCancel={() => {}} />)
    fireEvent.click(screen.getByLabelText('Не интересно'))
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }))
    expect(onSubmit).toHaveBeenLastCalledWith('content', true)
  })
})
