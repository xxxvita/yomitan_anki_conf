// catalog-list-races.test.tsx — «Показать ещё»: дубли slug между страницами отбрасываются,
// запоздавший ответ страницы после смены фильтра не попадает в новый список (use-catalog-list.ts).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CatalogInline, type CatalogInlineProps } from '../CatalogInline'
import { card, FakeCatalog, json, many } from './fake-catalog'

let fc: FakeCatalog
beforeEach(() => { fc = new FakeCatalog(); fc.install() })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const props: CatalogInlineProps = { selected: new Set(), capped: false, onToggle: vi.fn(), onDetail: vi.fn(), onCollapse: vi.fn() }
const cards = () => Array.from(document.querySelectorAll('.gc-grid .gc:not(.sk)')).map(e => e.getAttribute('data-slug'))

describe('«Показать ещё»', () => {
  it('slug, уже показанный на предыдущей странице, второй раз не добавляется', async () => {
    fc.titles = many(35)
    fc.total = 35
    // вторая страница приходит со сдвигом: t30 повторяется, добавляются t31..t35
    fc.reply = url => (url.includes('offset=30')
      ? json(200, { snapshot: fc.snapshot, total: 35, items: fc.titles.slice(29, 35) })
      : null)
    render(<CatalogInline {...props} />)
    await waitFor(() => expect(cards().length).toBe(30))
    fireEvent.click(screen.getByRole('button', { name: 'Показать ещё' }))
    await waitFor(() => expect(cards().length).toBe(35))
    const slugs = cards()
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('ответ «Показать ещё», пришедший после смены фильтра, отбрасывается', async () => {
    fc.titles = many(35)
    let release: (r: Response) => void = () => {}
    fc.reply = url => (url.includes('offset=30') && !url.includes('sort=new')
      ? new Promise<Response>(res => { release = res })
      : null)
    render(<CatalogInline {...props} />)
    await waitFor(() => expect(cards().length).toBe(30))
    fireEvent.click(screen.getByRole('button', { name: 'Показать ещё' }))
    // пока страница в пути, меняем сортировку: список перечитывается с первой страницы
    fireEvent.change(screen.getByRole('combobox', { name: 'Сортировка' }), { target: { value: 'new' } })
    await waitFor(() => expect(fc.list().some(u => u.includes('sort=new'))).toBe(true))
    await waitFor(() => expect(cards().length).toBe(30))
    const before = cards()
    await act(async () => {
      release(json(200, { snapshot: fc.snapshot, total: 35, items: [card('stale-1'), card('stale-2')] }))
      await Promise.resolve()
    })
    expect(cards()).toEqual(before)
    expect(cards()).not.toContain('stale-1')
  })
})
