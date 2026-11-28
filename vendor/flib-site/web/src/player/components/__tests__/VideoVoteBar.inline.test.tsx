// VideoVoteBar.inline.test.tsx — оценка под видео (плеер v2, режим маршрута; ревью
// v2a H-2): формы «Не нравится» и «❗» — всплывающая панель над кнопками, поверх
// видео, а не в потоке (в потоке они сжимали видео до полоски). Открылась — фокус
// в неё; Esc закрывает и возвращает фокус на кнопку.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { VideoVoteBar, type RouteVote } from '../VideoVoteBar'

const route = (over: Partial<RouteVote> = {}): RouteVote => ({ rating: null, canReplace: true, busy: false, onLike: vi.fn(), onDislike: vi.fn(), ...over })

describe('VideoVoteBar inline — всплывающие формы', () => {
  beforeEach(() => { window.localStorage.clear(); vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 204 })) })
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })

  it('«Не понравилось» в маршруте: причины — внутри .vvb-pop, фокус в панели; Esc закрывает, фокус на кнопке', () => {
    render(<VideoVoteBar videoId="abcdef12345" route={route()} inline />)
    const btn = screen.getByRole('button', { name: 'Не понравилось' })
    fireEvent.click(btn)
    const pop = document.querySelector('.vvb-pop') as HTMLElement
    expect(pop).toBeTruthy()
    expect(pop.querySelector('.vvb-route-reasons')).toBeTruthy()
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    expect(pop.contains(document.activeElement)).toBe(true)
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' })
    expect(document.querySelector('.vvb-pop')).toBeNull()
    expect(document.activeElement).toBe(btn)
  })

  it('«❗»: форма с полем — в панели, фокус в ней; Esc закрывает', () => {
    render(<VideoVoteBar videoId="abcdef12345" route={route()} inline />)
    const btn = screen.getByRole('button', { name: 'Обратить внимание и написать комментарий' })
    fireEvent.click(btn)
    const pop = document.querySelector('.vvb-pop') as HTMLElement
    expect(pop.querySelector('.vvb-flag-form textarea')).toBeTruthy()
    expect(pop.contains(document.activeElement)).toBe(true)
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' })
    expect(document.querySelector('.vvb-flag-form')).toBeNull()
    expect(document.activeElement).toBe(btn)
  })

  it('ничего не открыто — панели нет', () => {
    render(<VideoVoteBar videoId="abcdef12345" route={route()} inline />)
    expect(document.querySelector('.vvb-pop')).toBeNull()
  })

  it('поверх видео (не inline) — разметка прежняя, без .vvb-pop', () => {
    render(<VideoVoteBar videoId="abcdef12345" route={route()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Не понравилось' }))
    expect(document.querySelector('.vvb-pop')).toBeNull()
    expect(document.querySelector('.vvb-route-reasons')).toBeTruthy()
  })

  it('CSS: панель — absolute над кнопками, не в потоке', () => {
    const css = readFileSync(join(process.cwd(), 'src/player/components/video-vote-bar.css'), 'utf-8')
    const m = css.match(/\.vvb-inline \.vvb-pop\s*\{([^}]*)\}/)
    expect(m).not.toBeNull()
    expect(m![1]).toMatch(/position:\s*absolute/)
    expect(m![1]).toMatch(/bottom:\s*calc\(100%/)
    expect(css).toMatch(/\.video-vote-bar\.vvb-inline\s*\{[^}]*position:\s*relative/)
  })

  // Ревью v2a R1-C1: на телефоне панель лежала под панелью управления (z 48) и под
  // листом упражнений (z 55) — тап по «Отправить» глушил звук. Панель — выше обоих,
  // но ниже шторки настроек субтитров (z 70).
  it('CSS: z-index панели выше панели управления (48) и листа упражнений (55), ниже шторки настроек (70)', () => {
    const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf-8')
    const z = Number(read('src/player/components/video-vote-bar.css').match(/\.vvb-inline \.vvb-pop\s*\{[^}]*z-index:\s*(\d+)/)![1])
    const app = read('src/app.css')
    const zOf = (sel: string) => {
      const all = [...app.matchAll(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}', 'g'))]
      const zs = all.map(m => m[1].match(/z-index:\s*(\d+)/)).filter(Boolean).map(m => Number(m![1]))
      expect(zs.length, sel).toBeGreaterThan(0)
      return Math.max(...zs)
    }
    expect(z).toBeGreaterThan(zOf('.controls-bar'))
    expect(z).toBeGreaterThan(zOf('.workspace-lift'))
    expect(z).toBeLessThan(70)
  })
})
