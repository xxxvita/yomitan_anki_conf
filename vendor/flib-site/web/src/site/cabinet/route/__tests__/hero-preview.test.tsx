// hero-preview.test.tsx — настоящее превью YouTube на обложке героя (решение
// владельца 2026-11-19 «если превью доступны»; README макета: «обложки роликов —
// штриховые заглушки, заменить реальными превью»). Превью — только у героя
// (текущий ВЫДАННЫЙ ролик, вид youtube); урок слов и `other` — прежняя обложка;
// невыданный ролик не порождает ни URL, ни запроса (правило «до выдачи», §4.2).
// Ошибка картинки / нет video_id → прежняя штриховая заглушка.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { __resetSessionForTests, __setSessionForTests } from '../../../session'
import { __resetRouteStateForTests } from '../use-route-state'
import { __resetRouteOutboxForTests } from '../outbox'
import { FakeRouteBFF, renderRoutePage, st, del, und, lesson, other, vid, pid, TODAY } from './route-page-fakes'
import type { RouteState } from '../route-api'
import { HeroPoster, youtubePreviewUrl } from '../DayHero'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

let bff: FakeRouteBFF
beforeEach(() => {
  __resetSessionForTests(); __resetRouteStateForTests(); __resetRouteOutboxForTests()
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(`${TODAY}T12:00:00`))
  bff = new FakeRouteBFF()
  vi.stubGlobal('fetch', vi.fn((u: string, i?: RequestInit) => bff.fetch(u, i)))
  __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_abcd', routeAllowed: true, demo: false })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); __resetRouteOutboxForTests() })

const hero = () => screen.getByTestId('day-hero')
async function show(s: RouteState) { bff.state = s; renderRoutePage(bff); await screen.findByTestId('day-hero').catch(() => screen.findByTestId('day-done')) }
// Все картинки страницы, ведущие на YouTube: никакой другой адрес превью
// построен быть не должен.
const ytImgs = () => Array.from(document.querySelectorAll('img')).filter(i => (i.getAttribute('src') ?? '').includes('ytimg'))
// Нарочно сломанная проекция BFF: невыданная строка (вопреки §4.2) несёт id,
// video_id и название. Клиент обязан это не показывать — ни картинки, ни id.
const hostileUnd = () => und({ puzzle_id: pid(9), kind: 'youtube', video_id: vid(9), title: 'SecretTitle' } as never)

describe('превью героя', () => {
  it('выданный текущий ролик YouTube — обложка с превью i.ytimg.com (mqdefault), декоративная', async () => {
    await show(st([del(1, { played: true }), del(2), und()]))
    const img = within(hero()).getByTestId('hero-preview') as HTMLImageElement
    expect(img.getAttribute('src')).toBe(`https://i.ytimg.com/vi/${vid(2)}/mqdefault.jpg`)
    expect(img.getAttribute('alt')).toBe('')
    // на странице ровно одно превью — у героя; строки и невыданные — без
    expect(ytImgs()).toHaveLength(1)
    // обложка остаётся ссылкой на плеер, кнопка Play поверх превью
    const poster = img.closest('a')!
    expect(poster.className).toContain('poster')
    expect(poster.querySelector('.play')).toBeTruthy()
    // обложка декоративна: «Смотреть» — доступное действие, обложка вне фокуса и дерева
    expect(poster.getAttribute('aria-hidden')).toBe('true')
    expect(poster.getAttribute('tabindex')).toBe('-1')
  })

  it('ошибка загрузки превью → штриховая заглушка без картинки (без значка битой картинки)', async () => {
    await show(st([del(1), und()]))
    fireEvent.error(within(hero()).getByTestId('hero-preview'))
    expect(within(hero()).queryByTestId('hero-preview')).toBeNull()
    expect(within(hero()).queryByRole('img')).toBeNull()
    expect(hero().querySelector('.poster img')).toBeNull()
    // обложка-ссылка и Play на месте
    expect(hero().querySelector('a.poster .play')).toBeTruthy()
  })

  it('урок слов — прежняя обложка, без превью (даже если проекция назвала его youtube с video_id)', async () => {
    await show(st([del(1, { played: true }), lesson('aaaa', { kind: 'youtube', video_id: vid(3) } as never), und()]))
    expect(within(hero()).queryByTestId('hero-preview')).toBeNull()
    expect(ytImgs()).toHaveLength(0)
    expect(hero().querySelector('.poster.static')).toBeTruthy()
  })

  it('ролик `other` — прежняя обложка, без превью (даже с video_id в проекции)', async () => {
    await show(st([other(1, { video_id: vid(1) }), und()]))
    expect(within(hero()).queryByTestId('hero-preview')).toBeNull()
    expect(ytImgs()).toHaveLength(0)
    expect(hero().querySelector('.poster.static')).toBeTruthy()
  })

  it('невыданная строка с id в сломанной проекции, current_puzzle_id на ней — ни картинки, ни id, ни названия', async () => {
    await show(st([del(1, { played: true }), hostileUnd()], { current_puzzle_id: pid(9) }))
    expect(document.querySelectorAll('img[src*="ytimg"]')).toHaveLength(0)
    expect(document.body.innerHTML).not.toContain(vid(9))
    expect(document.body.innerHTML).not.toContain('SecretTitle')
  })

  it('невыданная строка с id в сломанной проекции, герой — выданный ролик: превью только у выданного', async () => {
    await show(st([del(1), hostileUnd()]))
    expect(Array.from(document.querySelectorAll('img[src*="ytimg"]')).map(i => i.getAttribute('src')))
      .toEqual([`https://i.ytimg.com/vi/${vid(1)}/mqdefault.jpg`])
    expect(document.body.innerHTML).not.toContain(vid(9))
  })

  it('нет выданных роликов («Начать день») — превью нет', async () => {
    bff.state = st([und(), und()]); renderRoutePage(bff)
    await screen.findByText('Начать день')
    expect(document.querySelectorAll('img')).toHaveLength(0)
    expect(document.body.innerHTML).not.toContain('ytimg')
  })

  it('день завершён (героя нет) — превью нигде нет', async () => {
    await show(st([del(1, { played: true })]))
    expect(screen.queryByTestId('day-hero')).toBeNull()
    expect(ytImgs()).toHaveLength(0)
  })
})

describe('youtubePreviewUrl / HeroPoster', () => {
  it('адрес строится только для валидного 11-символьного id', () => {
    expect(youtubePreviewUrl('dQw4w9WgXcQ')).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg')
    expect(youtubePreviewUrl('a-b_c1234XY')).toBe('https://i.ytimg.com/vi/a-b_c1234XY/mqdefault.jpg')
    expect(youtubePreviewUrl(undefined)).toBeNull()
    expect(youtubePreviewUrl('')).toBeNull()
    expect(youtubePreviewUrl('short')).toBeNull()
    expect(youtubePreviewUrl('dQw4w9WgXcQ1')).toBeNull()
    expect(youtubePreviewUrl('../evil/xyz')).toBeNull()
    expect(youtubePreviewUrl('dQw4w9WgX/Q')).toBeNull()
  })

  it('нет / битый video_id → заглушка без картинки', () => {
    render(<MemoryRouter><HeroPoster videoId={undefined} watchUrl="/player?v=x" /></MemoryRouter>)
    expect(document.querySelector('img')).toBeNull()
    expect(document.querySelector('a.poster .play')).toBeTruthy()
  })

  it('до загрузки превью скрыто (видна штриховка), настоящее превью 320 px — показывается', () => {
    render(<MemoryRouter><HeroPoster videoId={vid(1)} watchUrl="/p1" /></MemoryRouter>)
    const img = screen.getByTestId('hero-preview')
    expect(img.className).toContain('pending')
    Object.defineProperty(img, 'naturalWidth', { configurable: true, value: 320 })
    fireEvent.load(img)
    expect(screen.getByTestId('hero-preview').className).not.toContain('pending')
  })

  it('заглушка YouTube «нет превью» (404 с серой картинкой 120×90, onerror не срабатывает) → штриховка', () => {
    render(<MemoryRouter><HeroPoster videoId={vid(1)} watchUrl="/p1" /></MemoryRouter>)
    const img = screen.getByTestId('hero-preview')
    Object.defineProperty(img, 'naturalWidth', { configurable: true, value: 120 })
    fireEvent.load(img)
    expect(screen.queryByTestId('hero-preview')).toBeNull()
    expect(document.querySelector('a.poster .play')).toBeTruthy()
  })

  it('принятое превью ролика A не открывает превью ролика B до его проверки', () => {
    const { rerender } = render(<MemoryRouter><HeroPoster videoId={vid(1)} watchUrl="/p1" /></MemoryRouter>)
    const a = screen.getByTestId('hero-preview')
    Object.defineProperty(a, 'naturalWidth', { configurable: true, value: 320 })
    fireEvent.load(a)
    expect(screen.getByTestId('hero-preview').className).not.toContain('pending')
    rerender(<MemoryRouter><HeroPoster videoId={vid(2)} watchUrl="/p2" /></MemoryRouter>)
    expect(screen.getByTestId('hero-preview').className).toContain('pending')
  })

  // Firefox (по спецификации HTML) после смены src дозагружает старую картинку и
  // присылает её `load` на тот же элемент — с naturalWidth СТАРОЙ картинки. Новый
  // id обязан получить новый элемент (key), иначе старое событие решает за него.
  it('запоздалый load картинки прежнего ролика (заглушка 120 px) не решает за новый', () => {
    const { rerender } = render(<MemoryRouter><HeroPoster videoId={vid(1)} watchUrl="/p1" /></MemoryRouter>)
    const a = screen.getByTestId('hero-preview')
    rerender(<MemoryRouter><HeroPoster videoId={vid(2)} watchUrl="/p2" /></MemoryRouter>)
    expect(screen.getByTestId('hero-preview')).not.toBe(a)
    Object.defineProperty(a, 'naturalWidth', { configurable: true, value: 120 })
    fireEvent.load(a)
    const b = screen.getByTestId('hero-preview')
    expect(b.getAttribute('src')).toBe(`https://i.ytimg.com/vi/${vid(2)}/mqdefault.jpg`)
    expect(b.className).toContain('pending')
  })

  it('запоздалый load настоящей картинки прежнего ролика не показывает её под новым героем', () => {
    const { rerender } = render(<MemoryRouter><HeroPoster videoId={vid(1)} watchUrl="/p1" /></MemoryRouter>)
    const a = screen.getByTestId('hero-preview')
    rerender(<MemoryRouter><HeroPoster videoId={vid(2)} watchUrl="/p2" /></MemoryRouter>)
    Object.defineProperty(a, 'naturalWidth', { configurable: true, value: 320 })
    fireEvent.load(a)
    expect(screen.getByTestId('hero-preview').className).toContain('pending')
  })

  it('CSS: непроверенное превью прозрачно (.cab .poster img.pending { opacity: 0 })', () => {
    const css = readFileSync(join(process.cwd(), 'src/site/cabinet/route/route.css'), 'utf-8')
    expect(css).toMatch(/\.cab \.poster img\.pending\s*\{[^}]*opacity:\s*0\s*;?[^}]*\}/)
  })

  it('ошибка одного ролика не прячет превью следующего (после замены)', () => {
    const { rerender } = render(<MemoryRouter><HeroPoster videoId={vid(1)} watchUrl="/p1" /></MemoryRouter>)
    fireEvent.error(screen.getByTestId('hero-preview'))
    expect(screen.queryByTestId('hero-preview')).toBeNull()
    rerender(<MemoryRouter><HeroPoster videoId={vid(2)} watchUrl="/p2" /></MemoryRouter>)
    expect(screen.getByTestId('hero-preview').getAttribute('src')).toBe(`https://i.ytimg.com/vi/${vid(2)}/mqdefault.jpg`)
  })
})
