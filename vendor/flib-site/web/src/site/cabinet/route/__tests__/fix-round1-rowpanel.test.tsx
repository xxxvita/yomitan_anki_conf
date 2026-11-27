// fix-round1-rowpanel.test.tsx — C1, рубеж отрисовки: строка подтверждения
// «Заменить» не рисуется под строкой, которую ТЕКУЩЕЕ состояние заменять не даёт,
// даже если открытая строка ещё не закрыта (кадр между перечитыванием и закрытием).
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RowPanel } from '../RowPanel'
import type { DayActions } from '../day-actions'
import type { DayRow } from '../day-model'

const row = (over: Partial<DayRow>): DayRow => ({
  kind: 'kept', index: 1, puzzleId: 'youtube::aaaaaaaaaaa', clipKind: 'youtube', durationSec: 60, newWords: 0, words: [],
  opened: true, watched: true, lesson: false, inPlan: false, replaceable: false, ...over,
})
const actions = (replaceAvailable: boolean): DayActions => ({
  busy: false, replaceAvailable, notice: null,
  panel: { kind: 'replace', puzzleId: 'youtube::aaaaaaaaaaa', where: 'row', canReplace: true },
  ratingOf: () => null, like: () => {}, dislike: () => {}, replace: () => {}, submitDislike: () => {},
  confirmReplace: () => {}, closePanel: () => {}, next: () => {}, lessonHeard: () => 0,
})

describe('RowPanel: подтверждение «Заменить» — только у заменяемой строки', () => {
  it('kept — нет подтверждения; выданная строка плана при Г7 — есть; без Г7 — нет', () => {
    const { unmount } = render(<RowPanel row={row({})} a={actions(true)} where="row" />)
    expect(screen.queryByTestId('replace-confirm')).toBeNull()
    unmount()
    const plan = row({ kind: 'passed', inPlan: true, replaceable: true, watched: false })
    const r2 = render(<RowPanel row={plan} a={actions(true)} where="row" />)
    expect(screen.getByTestId('replace-confirm')).toBeTruthy()
    r2.unmount()
    render(<RowPanel row={plan} a={actions(false)} where="row" />)
    expect(screen.queryByTestId('replace-confirm')).toBeNull()
  })
})
