import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { SettingsDrawer } from '../SettingsDrawer'
import { setLocale } from '../../i18n'

describe('SettingsDrawer', () => {
  it('open=false is not marked open; open=true is', () => {
    const { rerender, getByTestId } = render(
      <SettingsDrawer open={false} onClose={() => {}} mode="l2l1" onMode={() => {}} />
    )
    expect(getByTestId('settings-drawer').className).not.toContain('open')
    rerender(<SettingsDrawer open onClose={() => {}} mode="l2l1" onMode={() => {}} />)
    expect(getByTestId('settings-drawer').className).toContain('open')
  })
  it('active mode reflected; clicking a mode calls onMode', () => {
    const onMode = vi.fn()
    const { getByTestId } = render(
      <SettingsDrawer open onClose={() => {}} mode="l2l1" onMode={onMode} />
    )
    expect(getByTestId('sd-mode-l2l1').getAttribute('data-active')).toBe('true')
    expect(getByTestId('sd-mode-l2').getAttribute('data-active')).toBe('false')
    fireEvent.click(getByTestId('sd-mode-l2'))
    expect(onMode).toHaveBeenCalledWith('l2')
  })
  it('close button calls onClose', () => {
    const onClose = vi.fn()
    const { getByTestId } = render(
      <SettingsDrawer open onClose={onClose} mode="l2l1" onMode={() => {}} />
    )
    fireEvent.click(getByTestId('sd-close'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

// i18n (T2): лейблы режимов резолвятся через useT; переключатель локали
// RU|EN живёт в drawer. Локаль — глобальный module-state → сброс в afterEach.
describe('SettingsDrawer — i18n лейблы и переключатель локали', () => {
  afterEach(() => { setLocale('ru'); try { localStorage.clear() } catch { /* noop */ } })

  it('дефолт ru: режимы — EN / EN + RU / Скрыть', () => {
    const { getByTestId } = render(
      <SettingsDrawer open onClose={() => {}} mode="l2l1" onMode={() => {}} />
    )
    expect(getByTestId('sd-mode-l2').textContent).toBe('EN')
    expect(getByTestId('sd-mode-l2l1').textContent).toBe('EN + RU')
    expect(getByTestId('sd-mode-hidden').textContent).toBe('Скрыть')
  })

  it('клик sd-locale-en → Скрыть становится Hide; EN / EN + RU не меняются (это названия языков)', () => {
    const { getByTestId } = render(
      <SettingsDrawer open onClose={() => {}} mode="l2l1" onMode={() => {}} />
    )
    fireEvent.click(getByTestId('sd-locale-en'))
    expect(getByTestId('sd-mode-hidden').textContent).toBe('Hide')
    expect(getByTestId('sd-mode-l2').textContent).toBe('EN')
    expect(getByTestId('sd-mode-l2l1').textContent).toBe('EN + RU')
  })

  it('sd-locale-ru возвращает Скрыть; активная локаль отражена data-active', () => {
    const { getByTestId } = render(
      <SettingsDrawer open onClose={() => {}} mode="l2l1" onMode={() => {}} />
    )
    fireEvent.click(getByTestId('sd-locale-en'))
    expect(getByTestId('sd-locale-en').getAttribute('data-active')).toBe('true')
    expect(getByTestId('sd-locale-ru').getAttribute('data-active')).toBe('false')
    fireEvent.click(getByTestId('sd-locale-ru'))
    expect(getByTestId('sd-mode-hidden').textContent).toBe('Скрыть')
    expect(getByTestId('sd-locale-ru').getAttribute('data-active')).toBe('true')
  })
})
