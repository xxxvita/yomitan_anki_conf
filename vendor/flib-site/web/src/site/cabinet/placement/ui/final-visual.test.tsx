// Правки по скриншотам: основная кнопка результата, год в дате, CSS узких экранов и перехода кнопки.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { RouteBlock, type ApplyUi } from './RouteBlock'
import { fmtDate } from './format'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function block(state: ApplyUi) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })))
  render(<MemoryRouter><RouteBlock lang="ru" state={state} flags={[]} onApply={() => {}} /></MemoryRouter>)
}

describe('V3: следующий шаг — основная кнопка', () => {
  it('«К маршруту» основная; при сбое основная — «Повторить», ссылка вторичная', () => {
    block({ k: 'done', counted: 1 })
    expect(screen.getByRole('link', { name: /маршрут/i }).className).toContain('pt-primary')
    cleanup()
    block({ k: 'failed' })
    expect(screen.getByRole('button', { name: 'Повторить' }).className).toContain('pt-primary')
    expect(screen.getByRole('link', { name: /маршрут/i }).className).not.toContain('pt-primary')
    cleanup()
    block({ k: 'declined' })
    expect(screen.getByRole('link', { name: /маршрут/i }).className).not.toContain('pt-primary')
  })
})

describe('V5: год в дате, если он не текущий', () => {
  it('текущий год — «дд.мм», другой — «дд.мм.гггг»', () => {
    const y = new Date().getFullYear()
    expect(fmtDate(new Date(y, 2, 5, 12).toISOString())).toBe('05.03')
    expect(fmtDate(new Date(y - 1, 11, 31, 12).toISOString())).toBe(`31.12.${y - 1}`)
  })
})

describe('CSS: узкие экраны и кнопки', () => {
  const pt = readFileSync(join(__dirname, '../placement.css'), 'utf8')
  const qs = readFileSync(join(__dirname, '../../route/route-start.css'), 'utf8')
  it('V2: тире «Старт — Сейчас» скрыто на ≤ 760 px', () => {
    const m = pt.match(/@media \(max-width: 760px\) \{[\s\S]*?\n\}/)
    expect(m?.[0]).toMatch(/\.pt-sn-sep \{ display: none; \}/)
  })
  it('V4: у основной кнопки нет перехода, выключенная — --fg-mute', () => {
    expect(pt).toMatch(/button\.pt-primary \{ transition: none; \}/)
    expect(pt).toMatch(/button\.pt-primary:disabled \{[^}]*color: var\(--fg-mute\)/)
  })
  it('V1: карточка результата старта остаётся столбцом на узком экране', () => {
    expect(qs).toMatch(/\.cab \.lv-c\.pt-res-c \{[^}]*flex-direction: column/)
  })
})
