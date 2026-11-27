// WorkspacePanelThemed.dockinset.test.tsx — T8 / audit-28 class-5: proves the
// dock producer (ShadowCardLifted's drag mechanic, video-player-store) and the
// dock CONSUMER (WorkspacePanelThemed's dockReserve/effectiveDock, already
// ported at T2/T-RULE — see that file's :518-526 WEB-SEAM comment) are
// actually wired together end to end. Before T8 this consumer code always
// read hardcoded `null` stubs (video-player-store.ts's old shadowChatDock/
// shadowChatDockHint fields) — dockReserve/effectiveDock existed but no test
// ever set a real value through it, so it was structurally present but dead.
// This is the "dock MOVES THE TIMELINE, not just the card" contract the T8
// brief calls "class-5 (audit/28) inset-контракт".
import { describe, it, expect, afterEach, vi } from 'vitest'
import { useEffect } from 'react'
import { render, act } from '@testing-library/react'
import { WorkspacePanel } from '../WorkspacePanel'
import { ShadowCard } from '../ShadowCardLifted'
import type { ShadowV1Api } from '../../hooks/useShadowV1'
import { makeFakeAdapter } from '../../../adapter/__tests__/fake'
import { useVideoPlayerStore } from '../video-player-store'

function makeWs() {
  return {
    rangeStart: 0, rangeEnd: 0, looping: false, pauseAtEnd: 0, viewStart: 0, viewEnd: 60,
    setABLoop() {}, toggleABLoop() {}, onUserSeek() {}, setPauseAtEnd() {}, stopLoop() {},
    setView() {}, zoom() {}, fitToRange() {}, setRange() {}, _boundaryTickForTest() {}, countdownValue: null,
  } as any
}

// Test-only bridge to the module-level store — same idiom as the other T8
// test files (no direct setter export).
function DockSetter({ dock, hint }: { dock: 'left' | 'right' | null; hint: 'left' | 'right' | null }) {
  const setDock = useVideoPlayerStore(s => s.setShadowChatDock)
  const setHint = useVideoPlayerStore(s => s.setShadowChatDockHint)
  useEffect(() => { setDock(dock); setHint(hint) }, [dock, hint, setDock, setHint])
  return null
}

function SizeSetter({ size }: { size: { w: number; h: number } | null }) {
  const setSize = useVideoPlayerStore(s => s.setShadowChatSize)
  useEffect(() => { setSize(size) }, [size, setSize])
  return null
}

// ТЗ №5 п.1 — bridge to the emit-only live-resize store field.
function SizeLiveSetter({ live }: { live: { w: number; h: number } | null }) {
  const setLive = useVideoPlayerStore(s => s.setShadowChatSizeLive)
  useEffect(() => { setLive(live) }, [live, setLive])
  return null
}

afterEach(() => {
  const { unmount } = render(<><DockSetter dock={null} hint={null} /><SizeSetter size={null} /><SizeLiveSetter live={null} /></>)
  unmount()
  localStorage.removeItem('videoPlayer.shadowChatDock')
  localStorage.removeItem('videoPlayer.shadowChatSize')
  vi.restoreAllMocks()
})

describe('T8 / audit-28 class-5 — dock inset moves the timeline bar, not just the card', () => {
  it('committed dock="left" (shadow active) reserves DOCKED_WIDTH on the LEFT padding of [data-workspace-bar], right padding unaffected', () => {
    const a = makeFakeAdapter({ duration: 100 })
    const base = { ws: makeWs(), cues: [], adapter: a, activeIndex: -1, waveform: null,
      variant: 'refined' as const, currentTime: 0, playing: false, muted: false, shadowActive: true }

    const { container } = render(<WorkspacePanel {...base} />)
    const bar = container.querySelector('[data-workspace-bar]') as HTMLElement
    const basePaddingLeft = bar.style.paddingLeft
    const basePaddingRight = bar.style.paddingRight
    expect(basePaddingLeft).not.toBe('420px') // sanity: baseline isn't already docked-width

    act(() => { render(<DockSetter dock="left" hint={null} />) })
    // ТЗ №8 п.1: dock-left резерв = dw (420) + гуттер (38) = 458 — таймлайн
    // освобождает и ширину карты, И полосу трек-лейблов справа от неё.
    expect(bar.style.paddingLeft).toBe('458px')
    expect(bar.style.paddingRight).toBe(basePaddingRight) // right side untouched

    act(() => { render(<DockSetter dock={null} hint={null} />) })
    expect(bar.style.paddingLeft).toBe(basePaddingLeft) // undocking gives the gutter back
  })

  it('committed dock="right" reserves DOCKED_WIDTH on the RIGHT padding instead', () => {
    const a = makeFakeAdapter({ duration: 100 })
    const base = { ws: makeWs(), cues: [], adapter: a, activeIndex: -1, waveform: null,
      variant: 'refined' as const, currentTime: 0, playing: false, muted: false, shadowActive: true }

    const { container } = render(<WorkspacePanel {...base} />)
    const bar = container.querySelector('[data-workspace-bar]') as HTMLElement

    act(() => { render(<DockSetter dock="right" hint={null} />) })
    expect(bar.style.paddingRight).toBe('420px')
    expect(bar.style.paddingLeft).not.toBe('420px')
  })

  it('the live drag hint (shadowChatDockHint) previews the post-drop inset BEFORE the drop commits — overrides the committed dock', () => {
    const a = makeFakeAdapter({ duration: 100 })
    const base = { ws: makeWs(), cues: [], adapter: a, activeIndex: -1, waveform: null,
      variant: 'refined' as const, currentTime: 0, playing: false, muted: false, shadowActive: true }

    const { container } = render(<WorkspacePanel {...base} />)
    const bar = container.querySelector('[data-workspace-bar]') as HTMLElement

    // Committed dock is "left"; a live drag toward the right edge previews
    // "right" — the hint must win (this is what lets the bar visibly shift
    // WHILE the user is still holding the mouse, before mouseup commits it).
    act(() => { render(<DockSetter dock="left" hint="right" />) })
    expect(bar.style.paddingRight).toBe('420px')
    expect(bar.style.paddingLeft).not.toBe('420px')
  })

  it('ТЗ №3 п.1: the docked inset reserves the user\'s SAVED width (dockedWidth(size)), not the hardcoded 420', () => {
    const a = makeFakeAdapter({ duration: 100 })
    const base = { ws: makeWs(), cues: [], adapter: a, activeIndex: -1, waveform: null,
      variant: 'refined' as const, currentTime: 0, playing: false, muted: false, shadowActive: true }

    const { container } = render(<WorkspacePanel {...base} />)
    const bar = container.querySelector('[data-workspace-bar]') as HTMLElement

    // User resized the card to 560px wide, then docked left → the timeline
    // reflows by 560 + 38 гуттер (ТЗ №8 п.1) = 598, not the 420 default.
    act(() => { render(<><SizeSetter size={{ w: 560, h: 400 }} /><DockSetter dock="left" hint={null} /></>) })
    expect(bar.style.paddingLeft).toBe('598px')

    // Clearing the size falls back to the 420 default (+38 гуттер = 458).
    act(() => { render(<SizeSetter size={null} />) })
    expect(bar.style.paddingLeft).toBe('458px')
  })

  it('ТЗ №5 п.1: карта МОЖЕТ занять >50% бара; потолок = bar − 280 (контролам остаётся минимум), НЕ bar/2 (решение владельца ТЗ-5 п.1 — реверс MED-9)', () => {
    // Владелец (видео-прогон): «панель shadowing займёт вот такое место, а справа
    // останется маленькая панелька с управлением» → прежний кламп floor(bar/2)
    // ЗАПРЕЩАЛ карте >50% и замораживал ширину. Теперь потолок = bar − 280.
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000)
    const a = makeFakeAdapter({ duration: 100 })
    const base = { ws: makeWs(), cues: [], adapter: a, activeIndex: -1, waveform: null,
      variant: 'refined' as const, currentTime: 0, playing: false, muted: false, shadowActive: true }

    const { container } = render(<WorkspacePanel {...base} />)
    const bar = container.querySelector('[data-workspace-bar]') as HTMLElement

    // saved 560 < потолок 720 (=1000−280) → проходит целиком (+38 гуттер = 598).
    act(() => { render(<><SizeSetter size={{ w: 560, h: 400 }} /><DockSetter dock="left" hint={null} /></>) })
    expect(bar.style.paddingLeft).toBe('598px')

    // saved 900 > потолок 720 → кламп dw до 720, +38 гуттер = 758 (ТЗ №8 п.1).
    act(() => { render(<SizeSetter size={{ w: 900, h: 400 }} />) })
    expect(bar.style.paddingLeft).toBe('758px')
  })

  it('на УЗКОМ баре резерв флорится на SHADOW_MIN_W (320), никогда ниже (карта не схлопывается в полоску)', () => {
    // bar 560 → 560−280=280 < 320 → пол выигрывает → 320.
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(560)
    const a = makeFakeAdapter({ duration: 100 })
    const base = { ws: makeWs(), cues: [], adapter: a, activeIndex: -1, waveform: null,
      variant: 'refined' as const, currentTime: 0, playing: false, muted: false, shadowActive: true }

    const { container } = render(<WorkspacePanel {...base} />)
    const bar = container.querySelector('[data-workspace-bar]') as HTMLElement

    act(() => { render(<><SizeSetter size={{ w: 900, h: 400 }} /><DockSetter dock="left" hint={null} /></>) })
    expect(bar.style.paddingLeft).toBe('358px') // пол dw=320 + 38 гуттер (ТЗ №8 п.1)
  })

  it('ТЗ №5 п.1: резерв ТРЕКАЕТ live-resize (shadowChatSizeLive) — не только на pointerup («меняю ширину — резерв не меняется» пофикшено)', () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000)
    const a = makeFakeAdapter({ duration: 100 })
    const base = { ws: makeWs(), cues: [], adapter: a, activeIndex: -1, waveform: null,
      variant: 'refined' as const, currentTime: 0, playing: false, muted: false, shadowActive: true }
    const { container } = render(<WorkspacePanel {...base} />)
    const bar = container.querySelector('[data-workspace-bar]') as HTMLElement

    // Персист = 420 (дефолт). Драг тянет live-размер до 640 БЕЗ pointerup —
    // резерв обязан следовать за live, а не сидеть на персисте.
    act(() => { render(<><SizeSetter size={{ w: 420, h: 400 }} /><DockSetter dock="left" hint={null} /></>) })
    expect(bar.style.paddingLeft).toBe('458px') // 420 dw + 38 гуттер (ТЗ №8 п.1)
    act(() => { render(<SizeLiveSetter live={{ w: 640, h: 400 }} />) })
    expect(bar.style.paddingLeft).toBe('678px') // live 640 + 38 гуттер БЬЁТ персист
    // Конец драга (live=null) → падаем на персист.
    act(() => { render(<SizeLiveSetter live={null} />) })
    expect(bar.style.paddingLeft).toBe('458px')
  })

  it('ТЗ №4 п.1 + ТЗ №5 п.1: docked card VISIBLE width == bar reserve (единый источник; клампятся к ОДНОМУ потолку bar−280)', () => {
    // Инвариант ТЗ №4 (карта == резерв, ОДИН источник dockedReserveWidth) СОХРАНЁН;
    // ТЗ №5 п.1 лишь сменил потолок с floor(bar/2) на bar−280. Карта size.w=800 на
    // баре 1000 → потолок 720 → И карта, И резерв = 720 (совпадают, перекрытия нет).
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const wide = this.hasAttribute?.('data-workspace-bar')
      const r = wide
        ? { left: 0, top: 0, right: 1000, bottom: 40, width: 1000, height: 40 }
        : { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }
      return { ...r, x: r.left, y: r.top, toJSON() {} } as DOMRect
    })
    const a = makeFakeAdapter({ duration: 100 })
    const base = { ws: makeWs(), cues: [], adapter: a, activeIndex: -1, waveform: null,
      variant: 'refined' as const, currentTime: 0, playing: false, muted: false, shadowActive: true }
    const shadow = { active: true, phase: 'idle', errorCode: null, remainingSec: 60,
      referenceText: 'hi', cueIndex: 0, lastMarks: null, lastMatchPct: null, lastSpoken: null,
      capped: false, recordAudioUrl: null, analyserNode: null, shadowAttempts: {}, recordings: [],
      activate: vi.fn(), deactivate: vi.fn(), toggle: vi.fn(), startRecording: vi.fn(async () => {}),
      stopRecording: vi.fn(), dismissResult: vi.fn(), selectRecording: vi.fn(), deleteRecording: vi.fn(),
    } as unknown as ShadowV1Api

    const { container } = render(
      <>
        <WorkspacePanel {...base} />
        <ShadowCard shadow={shadow} />
      </>,
    )
    const bar = container.querySelector('[data-workspace-bar]') as HTMLElement

    // Wide card (800) docked right on a 1000px bar → BOTH clamp to потолок 1000−280=720.
    act(() => { render(<><SizeSetter size={{ w: 800, h: 400 }} /><DockSetter dock="right" hint={null} /></>) })

    const card = container.querySelector('[data-testid="shadow-card"]') as HTMLElement
    expect(bar.style.paddingRight).toBe('720px')      // резерв
    expect(card.style.width).toBe('720px')            // видимая ширина карты
    expect(card.style.width).toBe(bar.style.paddingRight) // ЕДИНЫЙ источник истины
  })

  it('ТЗ №8 п.1: docked-left → гуттер ВСЕГДА в -38 band, а резерв = dw + 38 → кью стартуют ПОСЛЕ гуттера (не под лейблами)', () => {
    // ТЗ №6 п.4 двигал САМ гуттер на left:0 при dock-left, НЕ расширяя резерв →
    // гуттер (content-left) и первые кью (тот же content-left) рисовались друг на
    // друге (live-факт оркестратора: card[216,936], гуттер[936,972], кью с x=938).
    // ТЗ №8: гуттер остаётся в -38 band ВСЕГДА; dock-left резерв += 38, так что
    // band -38 попадает в полосу [card_right, card_right+36] СРАЗУ за картой, а
    // кью/волна/транспорт — после (barLeft + dw + 38). Инвариант ТЗ №4 «карта не
    // перекрывает таймлайн» сохранён; +38 — намеренная полоса под гуттер.
    const a = makeFakeAdapter({ duration: 100 })
    const base = { ws: makeWs(), cues: [], adapter: a, activeIndex: -1, waveform: null,
      variant: 'refined' as const, currentTime: 0, playing: false, muted: false, shadowActive: true }
    const { container } = render(<WorkspacePanel {...base} />)
    const gutter = () => container.querySelector('[data-testid="track-label-gutter"]') as HTMLElement
    const bar = container.querySelector('[data-workspace-bar]') as HTMLElement

    // Undocked — гуттер в левом внешнем band (-38).
    expect(gutter().style.left).toBe('-38px')

    act(() => { render(<><SizeSetter size={{ w: 420, h: 400 }} /><DockSetter dock="left" hint={null} /></>) })
    // Docked-left — гуттер по-прежнему -38 (band за картой), а резерв = 420 + 38.
    expect(gutter().style.left).toBe('-38px')
    expect(bar.style.paddingLeft).toBe('458px') // dw 420 + гуттер 38 → кью за гуттером

    // Docked-right — карта справа, левый гуттер не затронут; резерв справа БЕЗ +38.
    act(() => { render(<DockSetter dock="right" hint={null} />) })
    expect(gutter().style.left).toBe('-38px')
    expect(bar.style.paddingRight).toBe('420px') // dock-right гуттер слева, +38 не нужен

    act(() => { render(<DockSetter dock={null} hint={null} />) })
    expect(gutter().style.left).toBe('-38px')
  })

  it('ТЗ №7 п.2: резерв меряет КОРЕНЬ бара, а не внутренний таймлайн-div — иначе широкая карта перекрывает транспорт-ряд (play-кластер под картой)', () => {
    // Диагноз: резерв считался от `barRef` (внутренний timeline-div), чья
    // clientWidth = rootW − paddingLeft(=резерв) − paddingRight — т.е. САМА
    // СЖИМАЕТСЯ на величину резерва (обратная связь). Карта же меряет КОРЕНЬ
    // [data-workspace-bar] через getBoundingClientRect (полная ширина). При
    // широкой карте резерв «недосдвигал» (settle ~360 против карты 720) → карта
    // накрывала левую часть транспорта (play/prev/next). Фикс: и резерв, и карта
    // меряют ОДИН корень → dockedReserveWidth получает ОДИН barWidth → резерв ==
    // ширина карты (инвариант ТЗ №4 восстановлен).
    //
    // Модель бага в jsdom: clientWidth корня = 1000 (полный), внутреннего div =
    // 640 (сжат резервом). Старый код мерил 640 → резерв=min(900,640−280)=360;
    // карта мерит 1000 (getBoundingClientRect) → 720. Расходятся. Новый код
    // мерит корень 1000 → резерв=720==карта.
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute?.('data-workspace-bar') ? 1000 : 640
    })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const wide = this.hasAttribute?.('data-workspace-bar')
      const r = wide
        ? { left: 0, top: 0, right: 1000, bottom: 40, width: 1000, height: 40 }
        : { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }
      return { ...r, x: r.left, y: r.top, toJSON() {} } as DOMRect
    })
    const a = makeFakeAdapter({ duration: 100 })
    const base = { ws: makeWs(), cues: [], adapter: a, activeIndex: -1, waveform: null,
      variant: 'refined' as const, currentTime: 0, playing: false, muted: false, shadowActive: true }
    const shadow = { active: true, phase: 'idle', errorCode: null, remainingSec: 60,
      referenceText: 'hi', cueIndex: 0, lastMarks: null, lastMatchPct: null, lastSpoken: null,
      capped: false, recordAudioUrl: null, analyserNode: null, shadowAttempts: {}, recordings: [],
      activate: vi.fn(), deactivate: vi.fn(), toggle: vi.fn(), startRecording: vi.fn(async () => {}),
      stopRecording: vi.fn(), dismissResult: vi.fn(), selectRecording: vi.fn(), deleteRecording: vi.fn(),
    } as unknown as ShadowV1Api

    const { container } = render(
      <>
        <WorkspacePanel {...base} />
        <ShadowCard shadow={shadow} />
      </>,
    )
    const bar = container.querySelector('[data-workspace-bar]') as HTMLElement

    act(() => { render(<><SizeSetter size={{ w: 900, h: 400 }} /><DockSetter dock="right" hint={null} /></>) })

    const card = container.querySelector('[data-testid="shadow-card"]') as HTMLElement
    // Инвариант: видимая ширина карты == резерв бара (ОДИН источник ширины).
    expect(card.style.width).toBe('720px')
    expect(bar.style.paddingRight).toBe('720px')
    expect(bar.style.paddingRight).toBe(card.style.width)
  })

  it('a committed dock is NOT reserved while shadowing is inactive (no perpetual empty stripe after Stop)', () => {
    const a = makeFakeAdapter({ duration: 100 })
    const base = { ws: makeWs(), cues: [], adapter: a, activeIndex: -1, waveform: null,
      variant: 'refined' as const, currentTime: 0, playing: false, muted: false, shadowActive: false }

    const { container } = render(<WorkspacePanel {...base} />)
    const bar = container.querySelector('[data-workspace-bar]') as HTMLElement
    const basePaddingLeft = bar.style.paddingLeft

    act(() => { render(<DockSetter dock="left" hint={null} />) })
    // shadowActive=false → effectiveDock falls back to null (no hint either)
    // → padding stays at the theme baseline, not DOCKED_WIDTH.
    expect(bar.style.paddingLeft).toBe(basePaddingLeft)
    expect(bar.style.paddingLeft).not.toBe('420px')
  })
})
