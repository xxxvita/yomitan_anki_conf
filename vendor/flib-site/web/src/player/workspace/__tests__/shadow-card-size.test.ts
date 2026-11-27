// shadow-card-size.test.ts — ТЗ №3 pure geometry gates (resize clamp, docked
// width, zero-scroll feed N). These are the mutation-sentinel unit tests: the
// "убери вычисление N → скролл-тест red" gate lives here (computeVisibleFeed).
import { describe, it, expect } from 'vitest'
import {
  clampShadowSize, dockedWidth, dockedReserveWidth, computeVisibleFeed,
  SHADOW_MIN_W, SHADOW_MIN_H, DOCKED_WIDTH, SHADOW_MIN_CONTROLS_W,
} from '../shadow-card-size'

describe('clampShadowSize', () => {
  it('passes a mid-range size through unchanged', () => {
    expect(clampShadowSize(500, 400, 1920, 1080)).toEqual({ w: 500, h: 400 })
  })
  it('clamps below the min floor (320×240)', () => {
    expect(clampShadowSize(100, 50, 1920, 1080)).toEqual({ w: SHADOW_MIN_W, h: SHADOW_MIN_H })
  })
  it('clamps above the viewport', () => {
    expect(clampShadowSize(9999, 9999, 800, 600)).toEqual({ w: 800, h: 600 })
  })
  it('a tiny viewport never forces below the min floor', () => {
    expect(clampShadowSize(400, 400, 100, 100)).toEqual({ w: SHADOW_MIN_W, h: SHADOW_MIN_H })
  })
  it('non-finite (NaN pointer delta) collapses to the min', () => {
    expect(clampShadowSize(NaN, NaN, 1920, 1080)).toEqual({ w: SHADOW_MIN_W, h: SHADOW_MIN_H })
  })
})

describe('dockedWidth', () => {
  it('falls back to DOCKED_WIDTH (420) when no size saved', () => {
    expect(dockedWidth(null)).toBe(DOCKED_WIDTH)
    expect(dockedWidth(undefined)).toBe(420)
  })
  it('uses the saved width when present (even below 420)', () => {
    expect(dockedWidth({ w: 360, h: 500 })).toBe(360)
    expect(dockedWidth({ w: 640, h: 500 })).toBe(640)
  })
})

describe('computeVisibleFeed', () => {
  it('shows everything when there is room', () => {
    // availH 400, latest reserves 120 → usable 280, rowH 40 → 7 slots ≥ 3 rows
    expect(computeVisibleFeed(3, 400, 40, 120)).toEqual({ visibleHistory: 3, hiddenEarly: 0 })
  })
  it('overflow: spends one slot on the "+K" line', () => {
    // usable 400-120 = 280, rowH 40 → 7 slots; 12 rows > 7 → show 6, hide 6
    expect(computeVisibleFeed(12, 400, 40, 120)).toEqual({ visibleHistory: 6, hiddenEarly: 6 })
    // tighter: usable 200-120=80, rowH 40 → 2 slots; 5 rows > 2 → show 1, hide 4
    expect(computeVisibleFeed(5, 200, 40, 120)).toEqual({ visibleHistory: 1, hiddenEarly: 4 })
  })
  it('very small height: zero history visible, all collapsed', () => {
    // usable 30 - 120 → clamped 0 → 0 slots → show 0, hide all
    expect(computeVisibleFeed(5, 150, 40, 120)).toEqual({ visibleHistory: 0, hiddenEarly: 5 })
  })
  it('empty history → nothing', () => {
    expect(computeVisibleFeed(0, 400, 40, 120)).toEqual({ visibleHistory: 0, hiddenEarly: 0 })
  })
  it('unmeasured (rowH<=0) shows all, never a premature "+K"', () => {
    expect(computeVisibleFeed(9, 400, 0, 120)).toEqual({ visibleHistory: 9, hiddenEarly: 0 })
  })
})

// ТЗ №4 п.1 — единый источник истины docked-ширины: и карта, и таймлайн-резерв
// считают одно значение через dockedReserveWidth(size, barWidth), поэтому reserve
// ВСЕГДА == видимой ширине карты (перекрытия таймлайна/транспорта нет).
// ТЗ №5 п.1 — потолок изменён с floor(bar/2) на (bar − SHADOW_MIN_CONTROLS_W):
// владелец РАЗРЕШИЛ карте занимать >50% бара (контролы переносятся в 2-3 ряда).
describe('dockedReserveWidth (ТЗ №4 п.1 + ТЗ №5 п.1 — единый источник, потолок bar−controls)', () => {
  it('узкая карта (< потолка) проходит без клампа', () => {
    expect(dockedReserveWidth({ w: 400, h: 300 }, 1280)).toBe(400)
  })
  it('ТЗ №5 п.1: карта >50% бара ДОПУСКАЕТСЯ (потолок = bar − 280, НЕ bar/2)', () => {
    // Раньше 800 клампилось до floor(1280/2)=640; теперь потолок 1280−280=1000,
    // поэтому 800 проходит целиком — карта реально занимает >половины.
    expect(dockedReserveWidth({ w: 800, h: 300 }, 1280)).toBe(800)
  })
  it('ТЗ №5 п.1: у бара всегда остаётся SHADOW_MIN_CONTROLS_W под контролы', () => {
    // 1200 > потолок 1000 → резерв = 1000, бару остаётся ровно 280.
    expect(dockedReserveWidth({ w: 1200, h: 300 }, 1280)).toBe(1000)
    expect(dockedReserveWidth({ w: 1200, h: 300 }, 1280)).toBe(1280 - SHADOW_MIN_CONTROLS_W)
  })
  it('barWidth<=0 (неизмерено / jsdom no-layout) → без клампа, raw dockedWidth', () => {
    expect(dockedReserveWidth({ w: 800, h: 300 }, 0)).toBe(800)
    expect(dockedReserveWidth({ w: 800, h: 300 }, -5)).toBe(800)
  })
  it('size=null → DOCKED_WIDTH дефолт (под потолком)', () => {
    expect(dockedReserveWidth(null, 1280)).toBe(DOCKED_WIDTH)      // 420 <= 1000
    expect(dockedReserveWidth(null, 900)).toBe(420)                // 420 <= 900−280=620
  })

  // ── Пол резерва = SHADOW_MIN_W (320): при УЗКОМ баре (bar − controls < 320)
  // резерв держится на 320 (карта чуть перекрывает — приемлемо против полоски). ──
  it('узкий бар: bar − 280 < 320 → резерв НЕ падает ниже SHADOW_MIN_W (пол 320)', () => {
    // bar 560 → 560−280=280 < 320 → пол выигрывает → 320 (а НЕ 280).
    expect(dockedReserveWidth({ w: 800, h: 300 }, 560)).toBe(SHADOW_MIN_W)
    expect(dockedReserveWidth({ w: 420, h: 300 }, 500)).toBe(SHADOW_MIN_W) // 500−280=220 → 320
  })
  it('bar − 280 ровно 320 (bar 600) → 320 (граница пола)', () => {
    expect(dockedReserveWidth({ w: 800, h: 300 }, 600)).toBe(SHADOW_MIN_W)
  })
  it('bar − 280 чуть выше пола (bar 602 → 322) → потолок выигрывает над полом', () => {
    expect(dockedReserveWidth({ w: 800, h: 300 }, 602)).toBe(322)
  })
})
