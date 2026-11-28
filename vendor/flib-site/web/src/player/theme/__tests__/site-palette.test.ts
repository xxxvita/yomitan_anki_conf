// site-palette.test.ts — вариант 'site' (палитра основного сайта, решение владельца
// 2026-11-25): по умолчанию, сохранённые refined/indigo/mono по-прежнему
// читаются, обе копии сборщика (player/theme и player/workspace/theme) дают одно
// и то же, а `:root` в dusk-tokens.css равен cssVars варианта 'site'.
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getPlayerTheme } from '../player-theme'
import { usePlayerTheme } from '../usePlayerTheme'
import { buildDuskPlayerTheme as buildWorkspace, duskPlayerTheme } from '../../workspace/theme/dusk'

beforeEach(() => { localStorage.clear() })

describe('вариант по умолчанию и сохранённый', () => {
  it('без записи — site', () => {
    expect(renderHook(() => usePlayerTheme()).result.current.variant).toBe('site')
  })
  it.each(['site', 'refined', 'indigo', 'mono'] as const)('сохранённый %s читается', v => {
    localStorage.setItem('flib:dusk-variant', v)
    expect(renderHook(() => usePlayerTheme()).result.current.variant).toBe(v)
  })
  it('мусор в хранилище — site', () => {
    localStorage.setItem('flib:dusk-variant', 'original')
    expect(renderHook(() => usePlayerTheme()).result.current.variant).toBe('site')
  })
})

describe('обе копии сборщика', () => {
  it('site: cssVars одинаковы', () => {
    expect(buildWorkspace('site').cssVars).toEqual(getPlayerTheme('site').cssVars)
  })
  it('по умолчанию — site; --ok #9ab87a', () => {
    expect(buildWorkspace().cssVars).toEqual(getPlayerTheme('site').cssVars)
    expect(duskPlayerTheme.cssVars?.['--ok']).toBe('#9ab87a')
    expect(buildWorkspace('refined').cssVars?.['--ok']).toBe('#86D27A')
  })
  it('рабочая панель site берёт панель и акцент кабинета', () => {
    expect(buildWorkspace('site').panel.background).toBe('#1d1a14')
    expect(getPlayerTheme('site').rightPanel?.background).toBe('#1d1a14')
  })
})

describe('dusk-tokens.css', () => {
  const css = readFileSync(join(process.cwd(), 'src/dusk-tokens.css'), 'utf-8')
  const block = (selectorStart: RegExp) => {
    const m = css.match(new RegExp(selectorStart.source + '[^{]*\\{([^}]*)\\}'))
    if (!m) throw new Error('нет блока ' + selectorStart)
    const out: Record<string, string> = {}
    for (const d of m[m.length - 1].matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[d[1]] = d[2].trim().replace(/\s+/g, ' ')
    return out
  }
  const norm = (s: string) => s.replace(/,\s+/g, ',').replace(/\s+/g, ' ').toLowerCase()

  it(':root равен cssVars варианта site (все ключи)', () => {
    const root = block(/:root,\s*\.dusk-site/)
    const vars = getPlayerTheme('site').cssVars!
    expect(Object.keys(root).sort()).toEqual(Object.keys(vars).sort())
    for (const [k, v] of Object.entries(vars)) expect(norm(root[k]), k).toBe(norm(v))
  })
  it(':root больше не refined; .dusk-refined — отдельный блок с бордо', () => {
    expect(css).not.toMatch(/:root,\s*\.dusk-refined/)
    const refined = block(/\n\.dusk-refined/)
    expect(refined['--panel'].toLowerCase()).toBe('#2a1419')
  })
})
