// ExtraVideos.test.tsx — строки «Дополнительное видео»: фокус держится, пока строка не нарисована,
// и сбрасывается только после фокусировки или когда фокус двигать нельзя; имя ссылки несёт название.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ExtraVideos } from '../ExtraVideos'
import type { ExtraVideoView } from '../use-extra-video'
import { __resetVideoTitlesForTests } from '../use-video-titles'
import { xrow } from './route-page-fakes'

const view = (over: Partial<ExtraVideoView> = {}): ExtraVideoView => ({
  visible: true, disabled: false, busy: false, note: null, focusPid: null, start: () => {}, focusDone: () => {}, ...over,
})
const ui = (rows: ReturnType<typeof xrow>[], v: ExtraVideoView) => (
  <MemoryRouter><div className="cab"><ExtraVideos rows={rows} view={v} demo={false} /></div></MemoryRouter>
)

beforeEach(() => { __resetVideoTitlesForTests(); document.body.focus() })

describe('ExtraVideos', () => {
  it('строки ещё нет — focusDone не зовётся; появилась — фокус на ссылке и один focusDone', () => {
    const done = vi.fn()
    const target = xrow(5)
    const v = view({ focusPid: target.puzzle_id, focusDone: done })
    const r = render(ui([], v))
    expect(done).not.toHaveBeenCalled()
    r.rerender(ui([target], v))
    const link = screen.getByRole('link', { name: 'Смотреть: Extra 5' })
    expect(document.activeElement).toBe(link)
    expect(done).toHaveBeenCalledTimes(1)
  })

  it('фокус в окне aria-modal не двигается, но цель сбрасывается', () => {
    const done = vi.fn()
    const d = document.createElement('div'); d.setAttribute('aria-modal', 'true'); d.innerHTML = '<input id="m">'
    document.body.appendChild(d)
    const input = d.querySelector('input')!; input.focus()
    const target = xrow(6)
    render(ui([target], view({ focusPid: target.puzzle_id, focusDone: done })))
    expect(document.activeElement).toBe(input)
    expect(done).toHaveBeenCalledTimes(1)
    d.remove()
  })

  it('имя ссылки: «Смотреть: …» / «Пересмотреть: …»', () => {
    render(ui([xrow(1), xrow(2, { played: true })], view()))
    expect(screen.getByRole('link', { name: 'Смотреть: Extra 1' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Пересмотреть: Extra 2' })).toBeTruthy()
  })

  it('CSS: «Подбираем…» читаема (цвет --fg-mute 6.7:1, без opacity), метка «+» слева как у номеров', () => {
    const css = readFileSync(join(process.cwd(), 'src/site/cabinet/route/route.css'), 'utf-8')
    const dis = css.match(/\.cab \.btn\[aria-disabled="true"\]\s*\{([^}]*)\}/)![1]
    expect(dis).toContain('color: var(--fg-mute)')
    expect(dis).not.toMatch(/opacity/)
    const n = css.match(/\.cab \.vrow\.extra-row \.n\s*\{([^}]*)\}/)![1]
    expect(n).not.toMatch(/text-align/)
  })
})
