// day-model.test.ts — модель экрана дня (спека §4.2, §4.12; план B10b):
// три признака, «Ролик N из M» и «k из M», таблица кнопок героя, день завершён,
// строки kept / kept_local, сторож `?next=`.
import { describe, it, expect } from 'vitest'
import { buildDayModel, heroButtons, lessonLabelOf, nextGuard, type LocalDayInputs } from '../day-model'
import { del, kept, lesson, other, pid, st, und } from './route-page-fakes'

const none: LocalDayInputs = { watched: {}, pendingClipPlayed: new Set() }
const w = (o: Record<string, number>, meta = true): LocalDayInputs => ({
  watched: Object.fromEntries(Object.entries(o).map(([k, share]) => [k, { share, ...(meta ? { meta: { title: `Local ${k}`, duration_sec: 120, video_id: k.slice(9) } } : {}) }])),
  pendingClipPlayed: new Set(),
})

describe('«Ролик N из M» и «k из M» — разные числа', () => {
  it('2-й ролик текущий, 1 просмотрен, 5 в дне → «Ролик 2 из 5», «1 из 5»', () => {
    const m = buildDayModel(st([del(1, { played: true }), del(2), und(), und(), und()]), none)
    expect(m.current?.index).toBe(2)
    expect(m.total).toBe(5)
    expect(m.watchedCount).toBe(1)
  })
  it('минуты и слова — по всем роликам дня, вкл. невыданные', () => {
    const m = buildDayModel(st([del(1, { duration_sec: 120, new_words: 2 }), und({ duration_sec: 180, new_words: 3 })]), none)
    expect(m.minutes).toBe(5)
    expect(m.words).toBe(5)
  })
})

describe('три признака (§4.2)', () => {
  it('пятисекундный заход (queued_played, доля 0,1): «открыт», не «просмотрен»; герой — «Смотреть снова» + «Следующий ролик»', () => {
    const m = buildDayModel(st([del(1, { queued_played: true }), und()]), w({ [pid(1)]: 0.1 }))
    expect(m.current?.opened).toBe(true)
    expect(m.current?.watched).toBe(false)
    expect(m.watchedCount).toBe(0)
    expect(m.watchedMinutes).toBe(0)
    expect(heroButtons(m)).toEqual({ primary: 'watch_again', secondary: 'next' })
  })
  it('clip_played в локальной очереди — «открыт»', () => {
    const m = buildDayModel(st([del(1), und()]), { watched: {}, pendingClipPlayed: new Set([pid(1)]) })
    expect(m.current?.opened).toBe(true)
  })
  it('не открыт — «Смотреть»', () => {
    expect(heroButtons(buildDayModel(st([del(1), und()]), none))).toEqual({ primary: 'watch', secondary: null })
  })
  it('просмотрен (отметка ≥ 0,6 и отчёт не обработан) — «Следующий ролик» + «Смотреть снова»', () => {
    const m = buildDayModel(st([del(1, { queued_played: true }), und()]), w({ [pid(1)]: 0.7 }))
    expect(m.current?.watched).toBe(true)
    expect(heroButtons(m)).toEqual({ primary: 'next', secondary: 'watch_again' })
  })
  it('отметка ≥ 0,6, но отчёт уже обработан (нет ни queued_played, ни в очереди) — решает played демона', () => {
    const m = buildDayModel(st([del(1), und()]), w({ [pid(1)]: 0.9 }))
    expect(m.current?.watched).toBe(false)
  })
})

describe('день завершён (R2-C2)', () => {
  it('последний досмотрен (отметка + queued_played), невыданных нет — день завершён, все просмотрены', () => {
    const m = buildDayModel(st([del(1, { played: true }), del(2, { queued_played: true })]), w({ [pid(2)]: 0.8 }))
    expect(m.dayDone).toBe(true)
    expect(m.allWatched).toBe(true)
    expect(heroButtons(m)).toEqual({ primary: null, secondary: null })
  })
  it('тот же день без локальной отметки (другое устройство) — герой со «Смотреть снова»', () => {
    const m = buildDayModel(st([del(1, { played: true }), del(2, { queued_played: true })]), none)
    expect(m.dayDone).toBe(false)
    expect(heroButtons(m).primary).toBe('watch_again')
  })
  it('один «пройден без зачёта» + досмотренный последний — завершён, но не «все просмотрены», (M−1) из M', () => {
    const m = buildDayModel(st([del(1), del(2, { played: true })]), none)
    expect(m.rows[0].kind).toBe('passed')
    expect(m.dayDone).toBe(true)
    expect(m.allWatched).toBe(false)
    expect(m.watchedCount).toBe(m.total - 1)
  })
  it('текущий kind:"other": есть невыданные — главная «Следующий ролик»; нет — день завершён', () => {
    expect(heroButtons(buildDayModel(st([other(1), und()]), none))).toEqual({ primary: 'next', secondary: null })
    expect(buildDayModel(st([other(1)]), none).dayDone).toBe(true)
  })
  it('урок слов последним, не просмотрен — герой с кнопкой урока, дня-завершён нет; с записью 0,8 — завершён', () => {
    const notDone = buildDayModel(st([del(1, { played: true }), lesson('aaaa')]), none)
    expect(notDone.dayDone).toBe(false)
    expect(heroButtons(notDone)).toEqual({ primary: 'lesson', secondary: null, lessonLabel: 'Пройти урок' })
    const done = buildDayModel(st([del(1, { played: true }), lesson('aaaa', { queued_played: true })]), w({ 'words::aaaa': 0.8 }))
    expect(done.dayDone).toBe(true)
  })
  it('урок-герой: «Следующий ролик» второстепенной при невыданных и в «не открыт», и в «открыт»', () => {
    expect(heroButtons(buildDayModel(st([lesson('a'), und()]), none))).toEqual({ primary: 'lesson', secondary: 'next', lessonLabel: 'Пройти урок' })
    expect(heroButtons(buildDayModel(st([lesson('a', { queued_played: true }), und()]), w({ 'words::a': 0.3 })))).toEqual({ primary: 'lesson', secondary: 'next', lessonLabel: 'Продолжить урок' })
    expect(heroButtons(buildDayModel(st([lesson('a', { played: true }), und()]), none))).toEqual({ primary: 'next', secondary: 'lesson', lessonLabel: 'Повторить урок' })
  })
  it('W-L3: урок не «открыт» по признаку 1, но в flib:route-lesson 2 слова — «Продолжить урок»', () => {
    const m = buildDayModel(st([lesson('a'), und()]), { ...none, lessonHeard: () => 2 })
    expect(heroButtons(m, 2).lessonLabel).toBe('Продолжить урок')
    expect(lessonLabelOf(m.current!, 0)).toBe('Пройти урок')
  })
})

describe('kept и kept_local (Г7, Р24)', () => {
  it('kept сверху в порядке шлюза, затем kept_local, затем план; «Ролик 3 из 2+M′», «2 из 2+M′»', () => {
    const s = st([kept(1), del(10), und(), und()], { current_puzzle_id: pid(10) })
    const m = buildDayModel(s, w({ [pid(3)]: 0.8 }))
    expect(m.rows.map(r => r.kind)).toEqual(['kept', 'kept_local', 'current', 'locked', 'locked'])
    expect(m.current?.index).toBe(3)
    expect(m.total).toBe(5)
    expect(m.watchedCount).toBe(2)
    expect(m.rows[1].title).toBe(`Local ${pid(3)}`)
    expect(m.rows[1].replaceable).toBe(false)
  })
  it('без записи (второе устройство) — строки нет, «1 из 1+M′»', () => {
    const m = buildDayModel(st([kept(1), del(10), und()], { current_puzzle_id: pid(10) }), none)
    expect(m.rows.map(r => r.kind)).toEqual(['kept', 'current', 'locked'])
    expect(m.watchedCount).toBe(1)
  })
  it('ролик появился в kept_today или в плане — одна строка шлюза, k не удвоен', () => {
    const inKept = buildDayModel(st([kept(3), del(10)], { current_puzzle_id: pid(10) }), w({ [pid(3)]: 0.8 }))
    expect(inKept.rows.filter(r => r.puzzleId === pid(3)).length).toBe(1)
    expect(inKept.watchedCount).toBe(1)
    const inPlan = buildDayModel(st([del(3, { played: true }), del(10)], { current_puzzle_id: pid(10) }), w({ [pid(3)]: 0.8 }))
    expect(inPlan.rows.filter(r => r.puzzleId === pid(3)).length).toBe(1)
  })
  it('доля < 0,6 или без meta — строки kept_local нет', () => {
    expect(buildDayModel(st([del(10)]), w({ [pid(3)]: 0.5 })).rows.length).toBe(1)
    expect(buildDayModel(st([del(10)]), w({ [pid(3)]: 0.9 }, false)).rows.length).toBe(1)
  })
  it('kept-урок узнаётся по префиксу words::', () => {
    const m = buildDayModel(st([kept(1, { puzzle_id: 'words::k', kind: 'words', video_id: undefined, title: undefined, words: ['a', 'b'] }), del(10)], { current_puzzle_id: pid(10) }), none)
    expect(m.rows[0].lesson).toBe(true)
    expect(m.rows[0].newWords).toBe(2)
  })
  it('невыданная строка не несёт ничего, кроме длительности и слов', () => {
    const m = buildDayModel(st([del(1), und({ duration_sec: 60, new_words: 4 })]), none)
    const r = m.rows[1]
    expect(r).toMatchObject({ kind: 'locked', puzzleId: null, clipKind: null, words: [] })
    expect(r.title).toBeUndefined()
    expect(r.videoId).toBeUndefined()
  })
  it('минуты сегодня — по «просмотренным», вкл. kept и kept_local', () => {
    const m = buildDayModel(st([kept(1, { duration_sec: 300 }), del(10, { duration_sec: 600 })], { current_puzzle_id: pid(10) }), w({ [pid(3)]: 0.8 }))
    expect(m.watchedMinutes).toBe(7)
  })
})

describe('сторож ?next= (§4.7, N-C1)', () => {
  it('только next = текущий и есть невыданный', () => {
    const s = st([del(1), del(2), und()])
    expect(nextGuard(s, pid(2))).toBe(true)
    expect(nextGuard(s, pid(1))).toBe(false)
    expect(nextGuard(s, null)).toBe(false)
    expect(nextGuard(st([del(1), del(2)]), pid(2))).toBe(false)
  })
})
