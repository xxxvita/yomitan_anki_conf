import { describe, it, expect } from 'vitest'
import { getPlayerTheme, DUSK_VARIANTS } from '../player-theme'

describe('Dusk theme', () => {
  it('all 4 variants expose the full contract', () => {
    expect(DUSK_VARIANTS).toEqual(['site', 'refined', 'indigo', 'mono'])
    for (const v of DUSK_VARIANTS) {
      const t = getPlayerTheme(v)
      expect(t.playhead).toBeDefined()
      expect(t.handles).toBeDefined()
      expect(t.cssVars).toBeDefined()
      expect(t.visibilityTiers).toBeDefined() // обязательное поле контракта
      expect(typeof t.cssVars?.['--accent']).toBe('string') // значение из живого dusk.ts
    }
  })
  it('defaults to site (палитра основного сайта)', () => {
    expect(getPlayerTheme()).toEqual(getPlayerTheme('site'))
    expect(getPlayerTheme().cssVars?.['--accent']).toBe('#d4a574')
    expect(getPlayerTheme().cssVars?.['--panel']).toBe('#1d1a14')
  })
  it('refined остаётся прежним (бордо)', () => {
    const v = getPlayerTheme('refined').cssVars!
    expect(v['--panel']).toBe('#2A1419')
    expect(v['--accent']).toBe('#E8B84A')
    expect(v['--ok']).toBe('#86D27A')
  })
  it('site: --ok #9ab87a, подложка плашки субтитров и токены кабинета', () => {
    const v = getPlayerTheme('site').cssVars!
    expect(v['--ok']).toBe('#9ab87a')
    expect(v['--surface']).toBe('#16140f')
    expect(v['--rail-bg']).toBe('#16140f')
    expect(v['--drawer-bg']).toBe('#1d1a14')
    expect(v['--fg']).toBe('#e8e2d3')
    expect(v['--border']).toBe('rgba(163,156,134,0.16)')
    expect(v['--border-strong']).toBe('rgba(163,156,134,0.30)')
    expect(v['--fg-mute']).toBe('#857d69')
    expect(v['--region-dictation']).toBe('#dfb389')
    expect(v['--cue-active-bg']).toBe('rgba(212,165,116,0.16)')
    expect(v['--danger']).toBe('#d9826f')
    expect(v['--caption-plate-bg']).toBe('rgba(15,13,10,0.62)')
    expect(v['--caption-en-fg']).toBe('#f0e2c6')
  })
  it('cssVars keys are unprefixed (no --player- prefix)', () => {
    const keys = Object.keys(getPlayerTheme('refined').cssVars ?? {})
    expect(keys.some(k => k.startsWith('--player-'))).toBe(false)
    expect(keys.some(k => k.startsWith('--'))).toBe(true)
  })
})
