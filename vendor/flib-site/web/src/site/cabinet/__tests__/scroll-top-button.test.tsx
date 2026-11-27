// scroll-top-button.test.tsx — «Наверх» не заходит в подвал (liftFor + компонент).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { liftFor, ScrollTopButton } from '../ScrollTopButton'

// requestAnimationFrame — ручной: кадры копятся и выполняются flushFrames().
let frames: FrameRequestCallback[] = []
const flushFrames = () => act(() => { const cur = frames; frames = []; cur.forEach(f => f(0)) })
beforeEach(() => {
  frames = []
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.push(cb); return frames.length })
  vi.stubGlobal('cancelAnimationFrame', () => { frames = [] })
})
afterEach(() => { cleanup(); document.body.innerHTML = ''; vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('liftFor', () => {
  it('подвал ниже окна или не виден — 0', () => {
    expect(liftFor(900, 800)).toBe(0)
    expect(liftFor(800, 800)).toBe(0)
    expect(liftFor(Number.NaN, 800)).toBe(0)
  })
  it('нижний край кнопки на 16 px выше верха подвала', () => {
    // верх подвала на 100 px выше низа окна → отступ 100 + 16
    expect(liftFor(700, 800)).toBe(116)
    expect(liftFor(500, 800)).toBe(316)
    expect(liftFor(790, 800, 10)).toBe(20)
  })
  it('на низком окне подъём не выше окна минус кнопка и зазор 8 px', () => {
    expect(liftFor(0, 300)).toBe(300 - 44 - 8)
    expect(liftFor(-500, 200)).toBe(200 - 44 - 8)
  })
})

describe('ScrollTopButton', () => {
  function mount(footerTop: number | null, vh = 800) {
    Object.defineProperty(window, 'innerHeight', { value: vh, configurable: true })
    if (footerTop !== null) {
      const f = document.createElement('footer'); f.className = 'foot'
      f.getBoundingClientRect = () => ({ top: footerTop, bottom: footerTop + 100, left: 0, right: 0, width: 0, height: 100, x: 0, y: footerTop, toJSON: () => ({}) })
      document.body.appendChild(f)
    }
    render(<ScrollTopButton />)
    return screen.getByRole('button', { name: 'Наверх' })
  }
  const scroll = () => { act(() => { window.dispatchEvent(new Event('scroll')) }); flushFrames() }

  it('подвал виден — кнопка поднята; подвал уехал — подъём снят (scroll)', () => {
    const btn = mount(700)
    expect(btn.style.getPropertyValue('--totop-lift')).toBe('116px')
    const foot = document.querySelector('footer.foot') as HTMLElement
    foot.getBoundingClientRect = () => ({ top: 1500 } as DOMRect)
    scroll()
    expect(btn.style.getPropertyValue('--totop-lift')).toBe('')
  })

  it('resize пересчитывает', () => {
    const btn = mount(900)
    expect(btn.style.getPropertyValue('--totop-lift')).toBe('')
    Object.defineProperty(window, 'innerHeight', { value: 1000, configurable: true })
    act(() => { window.dispatchEvent(new Event('resize')) }); flushFrames()
    expect(btn.style.getPropertyValue('--totop-lift')).toBe('116px')
  })

  it('серия scroll даёт один кадр пересчёта (rAF), а не по расчёту на событие', () => {
    mount(900)
    frames = []
    act(() => { for (let i = 0; i < 5; i++) window.dispatchEvent(new Event('scroll')) })
    expect(frames.length).toBe(1)
  })

  it('смена высоты страницы без прокрутки (ResizeObserver на body) пересчитывает подъём и снимается при выходе', () => {
    let cb: () => void = () => {}
    const disconnect = vi.fn(); const observe = vi.fn()
    vi.stubGlobal('ResizeObserver', class { constructor(c: () => void) { cb = c } observe = observe; disconnect = disconnect })
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true })
    const f = document.createElement('footer'); f.className = 'foot'
    let top = 900
    f.getBoundingClientRect = () => ({ top } as DOMRect)
    const wrap = document.createElement('div'); wrap.appendChild(f); document.body.appendChild(wrap)
    const { unmount } = render(<ScrollTopButton />)
    const btn = screen.getByRole('button', { name: 'Наверх' })
    expect(observe).toHaveBeenCalledWith(wrap) // авто-высотный контейнер подвала: body/html высотой 100% не меняются
    expect(btn.style.getPropertyValue('--totop-lift')).toBe('')
    top = 700 // «Показать ещё» сократило страницу — подвал поднялся
    act(() => cb()); flushFrames()
    expect(btn.style.getPropertyValue('--totop-lift')).toBe('116px')
    unmount()
    expect(disconnect).toHaveBeenCalled()
  })

  it('нет подвала — без ошибок и без подъёма', () => {
    const btn = mount(null)
    scroll()
    expect(btn.style.getPropertyValue('--totop-lift')).toBe('')
  })

  it('слушатели scroll/resize снимаются при размонтировании', () => {
    const rm = vi.spyOn(window, 'removeEventListener')
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true })
    const { unmount } = render(<ScrollTopButton />)
    unmount()
    const names = rm.mock.calls.map(c => c[0])
    expect(names).toContain('scroll')
    expect(names).toContain('resize')
  })
})

describe("cabinet.css — подвал и кнопка", () => {
  it("у подвала справа не меньше 84 px (24 + 44 + 16), bottom кнопки берёт --totop-lift на десктопе и телефоне", async () => {
    const { readFileSync } = await import("node:fs")
    const { resolve } = await import("node:path")
    const css = readFileSync(resolve(__dirname, "../cabinet.css"), "utf8")
    const foot = /\.cab \.foot \{[^}]*padding:\s*\d+px (\d+)px/.exec(css)
    expect(Number(foot?.[1])).toBeGreaterThanOrEqual(84)
    expect(css).toMatch(/\.cab \.totop \{[^}]*bottom: max\(24px, var\(--totop-lift, 0px\)\)/)
    expect(css).toMatch(/\.cab \.totop \{ bottom: max\(84px, var\(--totop-lift, 0px\)\)/)
  })
})
