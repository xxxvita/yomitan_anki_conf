// ShadowSettingsRow.test.tsx — ТЗ №3 п.4: the срез-B settings-row contract,
// MOVED here honestly from ShadowCardLifted.test.tsx (the card no longer renders
// this row; the bar does). Same assertions, new mount point — no ассерты dropped.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { ShadowSettingsRow, type ShadowSettings } from '../ShadowSettingsRow'
import { setLocale } from '../../i18n'

afterEach(() => setLocale('ru'))

const base: ShadowSettings = { advanceEnabled: true, advanceThreshold: 80, mode: 'subtitle', loopMode: true }

describe('ShadowSettingsRow (срез B, moved to the bar)', () => {
  it('renders the row + slider reflecting advanceThreshold', () => {
    const { getByTestId } = render(<ShadowSettingsRow settings={base} />)
    expect(getByTestId('shadow-settings-row')).toBeTruthy()
    const slider = getByTestId('shadow-advance-slider') as HTMLInputElement
    expect(slider.value).toBe('80')
    expect(getByTestId('shadow-mode-toggle')).toBeTruthy()
    expect(getByTestId('shadow-loop-toggle')).toBeTruthy()
  })

  it('slider pins: type=range, min=50 / max=100 / step=5, toggle aria-label, "80%" value label', () => {
    // Restored pins lost in the ShadowCardLifted.test → ShadowSettingsRow.test move.
    const { getByTestId } = render(<ShadowSettingsRow settings={base} />)
    const slider = getByTestId('shadow-advance-slider') as HTMLInputElement
    expect(slider.type).toBe('range')
    expect(slider.min).toBe('50')
    expect(slider.max).toBe('100')
    expect(slider.step).toBe('5')
    expect(getByTestId('shadow-advance-toggle').getAttribute('aria-label')).toBe('toggle auto-advance')
    expect(getByTestId('shadow-settings-row').textContent).toContain('80%')
  })

  it('slider disabled when advanceEnabled=false, enabled when true', () => {
    const off = render(<ShadowSettingsRow settings={{ ...base, advanceEnabled: false }} />)
    expect((off.getByTestId('shadow-advance-slider') as HTMLInputElement).disabled).toBe(true)
    off.unmount()
    const on = render(<ShadowSettingsRow settings={base} />)
    expect((on.getByTestId('shadow-advance-slider') as HTMLInputElement).disabled).toBe(false)
  })

  it('toggle click → onAdvanceEnabledChange(!current)', () => {
    const fn = vi.fn()
    const { getByTestId } = render(<ShadowSettingsRow settings={base} onAdvanceEnabledChange={fn} />)
    fireEvent.click(getByTestId('shadow-advance-toggle'))
    expect(fn).toHaveBeenCalledWith(false)
  })

  it('slider change → onAdvanceThresholdChange(number)', () => {
    const fn = vi.fn()
    const { getByTestId } = render(<ShadowSettingsRow settings={base} onAdvanceThresholdChange={fn} />)
    fireEvent.change(getByTestId('shadow-advance-slider'), { target: { value: '55' } })
    expect(fn).toHaveBeenCalledWith(55)
  })

  it('mode button → onModeChange(custom) when currently subtitle', () => {
    const fn = vi.fn()
    const { getByTestId } = render(<ShadowSettingsRow settings={base} onModeChange={fn} />)
    fireEvent.click(getByTestId('shadow-mode-toggle'))
    expect(fn).toHaveBeenCalledWith('custom')
  })

  it('loop button → onLoopModeChange(!current)', () => {
    const fn = vi.fn()
    const { getByTestId } = render(<ShadowSettingsRow settings={base} onLoopModeChange={fn} />)
    fireEvent.click(getByTestId('shadow-loop-toggle'))
    expect(fn).toHaveBeenCalledWith(false)
  })
})
