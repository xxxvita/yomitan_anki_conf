// site-palette-css.test.ts — палитра 'site' привязана к токенам кабинета (cabinet.css), а CSS
// плеера и меню, затронутый сменой палитры, держит свои инварианты.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getPlayerTheme } from '../player-theme'
import { DUSK_SWATCHES, DUSK_VARIANT_ORDER } from '../../workspace/theme/dusk'

const read = (p: string) => readFileSync(join(process.cwd(), 'src', p), 'utf-8')
const rule = (css: string, sel: string) => {
  const m = css.match(new RegExp('^' + sel.replace(/[.*+?^${}()|[\]\\>]/g, '\\$&') + '\\s*\\{([^}]*)\\}', 'm'))
  return m ? m[1] : ''
}

describe('палитра site привязана к токенам кабинета (cabinet.css)', () => {
  const cab = read('site/cabinet/cabinet.css')
  const tok = (name: string) => {
    const m = cab.match(new RegExp('\\.cab \\{[^}]*?' + name + ':\\s*([^;]+);'))
    if (!m) throw new Error('нет токена ' + name)
    return m[1].trim().toLowerCase()
  }
  const v = getPlayerTheme('site').cssVars!
  it('акцент, фон, поверхность, текст, приглушённый текст, ошибка, ок', () => {
    expect(v['--accent'].toLowerCase()).toBe(tok('--accent'))
    expect(v['--surface'].toLowerCase()).toBe(tok('--bg'))      // фон страницы кабинета
    expect(v['--panel'].toLowerCase()).toBe(tok('--surface'))   // панель кабинета
    expect(v['--fg'].toLowerCase()).toBe(tok('--fg'))
    expect(v['--fg-dim'].toLowerCase()).toBe(tok('--fg-mute'))  // fgDim = fg-mute кабинета
    expect(v['--danger'].toLowerCase()).toBe(tok('--err'))
    expect(v['--ok'].toLowerCase()).toBe(tok('--ok'))
  })
})

describe('CSS плеера и меню под палитру site', () => {
  const app = read('app.css')
  const cab = read('site/cabinet/cabinet.css')
  const route = read('site/cabinet/route/route.css')
  it('активная реплика берёт --cue-active-bg', () => {
    expect(rule(app, ".cue-row[data-active='true']")).toMatch(/background:\s*var\(--cue-active-bg\)/)
  })
  it('дорожка перемотки читается на фоне заливки (--border-strong, не --fg-mute)', () => {
    expect(rule(app, '.controls-bar .cb-seek')).toMatch(/background:\s*var\(--border-strong/)
  })
  it('.poster-rate: кликабелен, .on — акцент, есть hover / disabled / focus-visible, обложка без рамки', () => {
    expect(rule(route, '.cab .poster-rate')).not.toMatch(/pointer-events:\s*none/)
    expect(rule(route, '.cab .poster-rate .btn')).not.toMatch(/pointer-events:\s*none/)
    const on = rule(route, '.cab .poster-rate .btn.on')
    expect(on).toMatch(/color:\s*var\(--accent\)/)
    expect(on).toMatch(/border-color:\s*var\(--accent\)/)
    expect(rule(route, '.cab .poster-rate .btn:hover')).not.toBe('')
    expect(rule(route, '.cab .poster-rate .btn:disabled')).not.toBe('')
    expect(rule(route, '.cab .poster-rate .btn:focus-visible')).not.toBe('')
    expect(rule(route, '.cab .poster-wrap > .poster')).toMatch(/border:\s*0/)
  })
  it('.nav-cnt: одна строка и ровно одно объявление padding', () => {
    const r = rule(cab, '.cab .nav-cnt')
    expect(r).toMatch(/white-space:\s*nowrap/)
    expect((r.match(/padding:/g) ?? []).length).toBe(1)
    expect((cab.match(/\.nav-cnt[^{]*\{[^}]*padding:/g) ?? []).length).toBe(1)
  })
  it('предупреждение первого прохода берёт панель и текст плеера', () => {
    const sub = read('player/components/subtitle-overlay.css')
    expect(rule(sub, '.subs-first-pass-warning')).toMatch(/background:\s*var\(--panel/)
    expect(rule(sub, '.subs-first-pass-warning')).toMatch(/color:\s*var\(--fg/)
  })
  it('образцы переключателя: site первым', () => {
    expect(DUSK_VARIANT_ORDER[0]).toBe('site')
    expect(DUSK_SWATCHES[0]).toMatchObject({ id: 'site', label: 'Site · warm graphite', fill: '#1d1a14', ring: '#d4a574' })
  })
})
