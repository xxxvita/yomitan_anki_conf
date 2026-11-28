import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { SubtitleSearch } from '../SubtitleSearch'

// start times deliberately differ from array index — proves onPick receives
// the cue's INDEX, not its time (F8: PlayerPage.selectCue takes an index).
const cues = [
  { start: 300, end: 301, text_en: 'Hello world', text_ru: 'Привет мир' },
  { start: 405, end: 406, text_en: 'Goodbye', text_ru: 'Пока' },
]

describe('SubtitleSearch', () => {
  it('no results for empty query', () => {
    const { queryByTestId } = render(<SubtitleSearch cues={cues} onPick={() => {}} />)
    expect(queryByTestId('search-results')).toBeNull()
  })
  it('filters by EN substring and picks its index on click', () => {
    const onPick = vi.fn()
    const { getByTestId } = render(<SubtitleSearch cues={cues} onPick={onPick} />)
    fireEvent.change(getByTestId('search-input'), { target: { value: 'hello' } })
    fireEvent.click(getByTestId('search-result-0'))
    expect(onPick).toHaveBeenCalledWith(0) // cues[0] matched → index 0 (not its start=300)
  })
  it('filters by RU substring too, picking the ORIGINAL index even though it is the sole (0th) filtered result', () => {
    const onPick = vi.fn()
    const { getByTestId, queryByTestId } = render(<SubtitleSearch cues={cues} onPick={onPick} />)
    fireEvent.change(getByTestId('search-input'), { target: { value: 'пока' } })
    expect(getByTestId('search-result-0')).toBeTruthy()
    expect(queryByTestId('search-result-1')).toBeNull()
    fireEvent.click(getByTestId('search-result-0'))
    expect(onPick).toHaveBeenCalledWith(1) // cues[1] matched, filtered position 0 → original index 1
  })
  it('supports regex patterns (wor.d matches "world")', () => {
    const { getByTestId } = render(<SubtitleSearch cues={cues} onPick={() => {}} />)
    fireEvent.change(getByTestId('search-input'), { target: { value: 'wor.d' } })
    expect(getByTestId('search-result-0')).toBeTruthy()
  })
  it('falls back to literal substring on invalid regex, marks input invalid, no crash', () => {
    const { getByTestId, queryByTestId } = render(<SubtitleSearch cues={cues} onPick={() => {}} />)
    fireEvent.change(getByTestId('search-input'), { target: { value: 'Good(' } }) // битый regex
    expect((getByTestId('search-input') as HTMLInputElement).className).toContain('ss-invalid')
    expect(queryByTestId('search-results')).toBeNull() // 'Good(' как литерал не встречается
  })
})

// Первый проход ролика маршрута (ревью M-1): поиск выключен — он печатал бы
// найденные английские строки.
describe('SubtitleSearch — enHidden (первый проход маршрута)', () => {
  it('поле выключено, с подсказкой; совпадения не печатаются', () => {
    const { getByTestId, queryByTestId } = render(<SubtitleSearch cues={cues} onPick={() => {}} enHidden />)
    const inp = getByTestId('search-input') as HTMLInputElement
    expect(inp.disabled).toBe(true)
    expect(inp.placeholder).toMatch(/после первого просмотра/)
    fireEvent.change(inp, { target: { value: 'Hello' } })
    expect(queryByTestId('search-results')).toBeNull()
    expect(getByTestId('sub-search').textContent).not.toContain('Hello')
  })
})
