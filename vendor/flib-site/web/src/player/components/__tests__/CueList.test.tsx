import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent, within } from '@testing-library/react'
import { CueList } from '../CueList'

// start times deliberately differ from array index — proves onSelect receives
// the cue's INDEX, not its time (F8: PlayerPage.selectCue takes an index).
const cues = [
  { start: 100, end: 101, text_en: 'Hello', text_ru: 'Привет' },
  { start: 205, end: 206, text_en: 'World', text_ru: 'Мир' },
]
// без RU — чтобы капсула была видима (гейт: строка без RU)
const cuesNoRu = [
  { start: 100, end: 101, text_en: 'Hello', text_ru: '' },
  { start: 205, end: 206, text_en: '', text_ru: '' }, // пустой text_en — капсулы быть не должно (edge 1)
]

describe('CueList', () => {
  it('highlights the active row; клик по seek-кнопке внутри cue-N селектит индекс', () => {
    const onSelect = vi.fn()
    const { getByTestId } = render(<CueList cues={cues} activeIndex={1} onSelect={onSelect} />)
    expect(getByTestId('cue-1').getAttribute('data-active')).toBe('true')
    expect(getByTestId('cue-0').getAttribute('data-active')).toBe('false')
    // строка теперь <div>; кликаем seek-<button> внутри неё.
    fireEvent.click(within(getByTestId('cue-0')).getByRole('button', { name: /Hello/ }))
    expect(onSelect).toHaveBeenCalledWith(0)
  })

  it('auto-scrolls via scrollTop, NOT scrollIntoView', () => {
    const sii = vi.fn(); Element.prototype.scrollIntoView = sii
    const { rerender } = render(<CueList cues={cues} activeIndex={0} onSelect={() => {}} />)
    rerender(<CueList cues={cues} activeIndex={1} onSelect={() => {}} />)
    expect(sii).not.toHaveBeenCalled()
  })

  // [ID:P-subtitle-translate-capsule]
  it('капсула видна у строки без RU, её клик зовёт onTranslateLine (НЕ onSelect)', () => {
    const onSelect = vi.fn(); const onTranslateLine = vi.fn()
    const { getByTestId } = render(
      <CueList cues={cuesNoRu} activeIndex={0} onSelect={onSelect} onTranslateLine={onTranslateLine} />,
    )
    const capsule = within(getByTestId('cue-0')).getByRole('button', { name: 'Перевести эту строку' })
    fireEvent.click(capsule)
    expect(onTranslateLine).toHaveBeenCalledWith(0)
    expect(onSelect).not.toHaveBeenCalled() // stopPropagation
  })

  it('капсулы НЕТ у строки с RU (text_ru есть)', () => {
    const { container } = render(
      <CueList cues={cues} activeIndex={0} onSelect={() => {}} onTranslateLine={vi.fn()} />,
    )
    const row0 = within(container).getByTestId('cue-0')
    expect(within(row0).queryByRole('button', { name: 'Перевести эту строку' })).toBeNull()
  })

  it('капсулы НЕТ у строки с пустым text_en (edge 1)', () => {
    const { container } = render(
      <CueList cues={cuesNoRu} activeIndex={0} onSelect={() => {}} onTranslateLine={vi.fn()} />,
    )
    const row1 = within(container).getByTestId('cue-1') // пустой text_en
    expect(within(row1).queryByRole('button', { name: 'Перевести эту строку' })).toBeNull()
    // sanity: у строки 0 (непустой text_en, без RU) капсула ЕСТЬ
    const row0 = within(container).getByTestId('cue-0')
    expect(within(row0).queryByRole('button', { name: 'Перевести эту строку' })).not.toBeNull()
  })

  it('без onTranslateLine капсул нет вовсе (обратная совместимость)', () => {
    const { queryAllByRole } = render(<CueList cues={cuesNoRu} activeIndex={0} onSelect={() => {}} />)
    expect(queryAllByRole('button', { name: 'Перевести эту строку' })).toHaveLength(0)
  })
})

// Первый проход ролика маршрута (прод 2026-11-19, ревью M-1): панель «Субтитры»
// не печатает английский текст — строка показывает только время начала, переход
// по строке работает; ни русской строки, ни капсулы, ни ПКМ-меню.
describe('CueList — enHidden (первый проход маршрута)', () => {
  it('строки без текста реплик: только время начала, клик по строке по-прежнему селектит индекс', () => {
    const onSelect = vi.fn(), onCtx = vi.fn()
    const { getByTestId, container, queryAllByRole } = render(
      <CueList cues={cues} activeIndex={0} onSelect={onSelect} onCueContextMenu={onCtx} onTranslateLine={() => {}} enHidden />,
    )
    const list = getByTestId('cue-list')
    expect(list.textContent).not.toContain('Hello')
    expect(list.textContent).not.toContain('World')
    expect(list.textContent).not.toContain('Привет')
    expect(container.querySelectorAll('.cue-en')).toHaveLength(0)
    expect(within(getByTestId('cue-0')).getByText('1:40')).toBeTruthy()
    expect(within(getByTestId('cue-1')).getByText('3:25')).toBeTruthy()
    expect(queryAllByRole('button', { name: 'Перевести эту строку' })).toHaveLength(0)
    fireEvent.contextMenu(within(getByTestId('cue-1')).getByRole('button'))
    expect(onCtx).not.toHaveBeenCalled()
    fireEvent.click(within(getByTestId('cue-1')).getByRole('button'))
    expect(onSelect).toHaveBeenCalledWith(1)
  })

  it('без enHidden — текст реплик как раньше', () => {
    const { getByTestId } = render(<CueList cues={cues} activeIndex={0} onSelect={() => {}} />)
    expect(getByTestId('cue-list').textContent).toContain('Hello')
  })
})
