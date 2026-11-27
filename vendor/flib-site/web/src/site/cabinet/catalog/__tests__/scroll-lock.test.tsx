// scroll-lock.test.tsx — блокировка прокрутки страницы под подробной карточкой (ревью S6, C-1).
// Полный каталог встроен в шаг «Цель» и прокрутку не блокирует (S7a): слой один.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { TitleDetail } from '../TitleDetail'
import { CatalogInline } from '../CatalogInline'
import { card, FakeCatalog, json, SNAP } from './fake-catalog'

let fc: FakeCatalog
beforeEach(() => {
  fc = new FakeCatalog(); fc.titles = [card('t1')]; fc.install()
  fc.detail = () => json(200, { snapshot: SNAP, pace: { slow_below: 160, fast_from: 178 }, item: card('t1', { groups: [] }) })
  document.body.style.overflow = ''
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.body.style.overflow = '' })

const detail = () => <TitleDetail card={card('t1') as never} snapshot={SNAP} selected={false} capped={false} onToggle={vi.fn()} onClose={vi.fn()} />

describe('блокировка прокрутки', () => {
  it('карточка блокирует и возвращает как было', () => {
    document.body.style.overflow = 'scroll'
    const { unmount } = render(detail())
    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(document.body.style.overflow).toBe('scroll')
  })

  it('встроенный каталог прокрутку не трогает; карточка поверх него — блокирует и снимает точно', () => {
    const inline = <CatalogInline selected={new Set()} capped={false} onToggle={vi.fn()} onDetail={vi.fn()} onCollapse={vi.fn()} />
    const { rerender } = render(<>{inline}</>)
    expect(document.body.style.overflow).toBe('')
    rerender(<>{inline}{detail()}</>)
    expect(document.body.style.overflow).toBe('hidden')
    rerender(<>{inline}</>)
    expect(document.body.style.overflow).toBe('')
  })

  it('повторное открытие после закрытия снова блокирует', () => {
    const a = render(detail()); a.unmount()
    expect(document.body.style.overflow).toBe('')
    const b = render(detail())
    expect(document.body.style.overflow).toBe('hidden')
    b.unmount()
    expect(document.body.style.overflow).toBe('')
  })
})
