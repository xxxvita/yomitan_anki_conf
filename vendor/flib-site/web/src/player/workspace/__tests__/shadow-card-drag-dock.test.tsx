// shadow-card-drag-dock.test.tsx — T8: RTL coverage for the drag-to-dock
// mechanic lifted verbatim from desktop ShadowChat.tsx :491-695 (state/
// detectSnap/handleHeaderMouseDown/global mousemove-mouseup/containerStyle)
// into ShadowCardLifted.tsx. jsdom has no real layout engine, but every
// coordinate this mechanic touches (mouse clientX/clientY, getBoundingClientRect
// rects) is a plain number the component reads directly — no CSS layout/paint
// is required to exercise it, so this is full RTL coverage, not a live-gate
// substitute. `getBoundingClientRect` is mocked per-element (workspace-bar vs.
// the card) since jsdom always returns an all-zero rect otherwise.
//
// `detectSnap` itself is not exported (private to the component, like desktop's
// own local function) — it is exercised indirectly through its only two call
// sites (the live drag-hint during mousemove and the commit decision on
// mouseup), which is the same coverage a real user drag would produce.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { useEffect } from 'react'
import { render, fireEvent } from '@testing-library/react'
import { ShadowCard, DOCKED_WIDTH } from '../ShadowCardLifted'
import type { ShadowV1Api } from '../../hooks/useShadowV1'
import { useVideoPlayerStore } from '../video-player-store'

function mkShadow(overrides: Partial<ShadowV1Api> = {}): ShadowV1Api {
  return {
    active: true,
    phase: 'idle',
    errorCode: null,
    remainingSec: 60,
    referenceText: 'hello world',
    cueIndex: 0,
    lastMarks: null,
    lastMatchPct: null,
    lastSpoken: null,
    capped: false,
    recordAudioUrl: null,
    analyserNode: null,
    shadowAttempts: {},
    recordings: [],
    activate: vi.fn(),
    deactivate: vi.fn(),
    toggle: vi.fn(),
    startRecording: vi.fn(async () => {}),
    stopRecording: vi.fn(),
    dismissResult: vi.fn(),
    selectRecording: vi.fn(),
    deleteRecording: vi.fn(),
    ...overrides,
  }
}

// Fixed rects for the two elements the drag mechanic reads via
// getBoundingClientRect: the workspace bar (barRect, polled via
// `[data-workspace-bar]`) and the card container itself (read once on
// mousedown to seed the drag's initX/initY).
const BAR_RECT = { left: 200, top: 800, right: 1200, bottom: 900, width: 1000, height: 100 }
const CARD_RECT = { left: 900, top: 300, right: 1320, bottom: 900, width: 420, height: 600 }

function domRect(r: typeof BAR_RECT): DOMRect {
  return { ...r, x: r.left, y: r.top, toJSON: () => r } as DOMRect
}

function mockRects() {
  const bar = domRect(BAR_RECT)
  const card = domRect(CARD_RECT)
  return vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute('data-workspace-bar') ? bar : card
  })
}

// Test-only reset — same idiom as ShadowCardLifted.test.tsx's SelectSetter:
// no direct setter export from the store, so a tiny probe component reaches
// the hook to clear T8's new fields between tests.
function ResetDockState() {
  const setDock = useVideoPlayerStore(s => s.setShadowChatDock)
  const setFreePos = useVideoPlayerStore(s => s.setShadowChatFreePos)
  const setDockHint = useVideoPlayerStore(s => s.setShadowChatDockHint)
  useEffect(() => { setDock(null); setFreePos(null); setDockHint(null) }, [setDock, setFreePos, setDockHint])
  return null
}

afterEach(() => {
  vi.restoreAllMocks()
  const { unmount } = render(<ResetDockState />)
  unmount()
  localStorage.removeItem('videoPlayer.shadowChatDock')
})

function renderCard(shadow: ShadowV1Api = mkShadow()) {
  return render(
    <>
      <div data-workspace-bar />
      <ShadowCard shadow={shadow} />
    </>,
  )
}

function drag(header: HTMLElement, opts: {
  start: [number, number]
  arm: [number, number]
  move?: [number, number]
  up: [number, number]
}) {
  // ТЗ №6 п.5 [ID:P-tz6]: header-драг переведён на POINTER-события + capture
  // (было mouse). Хелпер обновлён соответственно.
  fireEvent.pointerDown(header, { button: 0, pointerId: 1, clientX: opts.start[0], clientY: opts.start[1] })
  // First move past DRAG_THRESHOLD (6px) — this move only ARMS the drag
  // (sets `started=true` + seeds livePos from the container's own rect); it
  // does not itself evaluate detectSnap (verbatim ShadowChat.tsx :603-609).
  fireEvent.pointerMove(window, { clientX: opts.arm[0], clientY: opts.arm[1] })
  if (opts.move) {
    fireEvent.pointerMove(window, { clientX: opts.move[0], clientY: opts.move[1] })
  }
  fireEvent.pointerUp(window, { clientX: opts.up[0], clientY: opts.up[1] })
}

describe('T8 drag-to-dock (ShadowCardLifted, lifted from ShadowChat.tsx :491-695)', () => {
  it('DRAG_THRESHOLD: a mousedown + mouseup within 6px never arms the drag — no dock, no freePos, pristine anchor untouched', () => {
    mockRects()
    const { getByTestId } = renderCard()
    const card = getByTestId('shadow-card')
    const header = card.firstElementChild as HTMLElement

    fireEvent.pointerDown(header, { button: 0, pointerId: 1, clientX: 1000, clientY: 400 })
    fireEvent.pointerMove(window, { clientX: 1003, clientY: 403 }) // 3px < DRAG_THRESHOLD
    fireEvent.pointerUp(window, { clientX: 1003, clientY: 403 })

    // Pristine default anchor (right:12/bottom:220, position:absolute) is
    // exactly what pre-T8 rendered — proves the sub-threshold move was a
    // total no-op on dock/freePos.
    expect(card.style.position).toBe('absolute')
    expect(card.style.right).toBe('12px')
    expect(card.style.bottom).toBe('220px')
  })

  it('detectSnap edge (left): dropping near the bar\'s left edge docks left — container switches to fixed/left=barRect.left, spans the bar height, square corners', () => {
    mockRects()
    const { getByTestId } = renderCard()
    const card = getByTestId('shadow-card')
    const header = card.firstElementChild as HTMLElement

    // Drop point: clientX=210 (10px inside BAR_RECT.left=200, well within the
    // 36px SNAP_ZONE_PX), clientY=850 (inside the bar's vertical span 800-900).
    drag(header, { start: [1000, 400], arm: [1010, 410], up: [210, 850] })

    expect(card.style.position).toBe('fixed')
    expect(card.style.left).toBe('200px') // barRect.left
    expect(card.style.top).toBe('800px')  // barRect.top
    expect(card.style.height).toBe('100px') // barRect.height
    expect(card.style.borderRadius).toBe('0')
  })

  it('detectSnap edge (right): dropping near the bar\'s right edge docks right — left = barRect.right - DOCKED_WIDTH', () => {
    mockRects()
    const { getByTestId } = renderCard()
    const card = getByTestId('shadow-card')
    const header = card.firstElementChild as HTMLElement

    // Drop point: clientX=1190 (10px inside BAR_RECT.right=1200).
    drag(header, { start: [1000, 400], arm: [990, 390], up: [1190, 850] })

    expect(card.style.position).toBe('fixed')
    expect(card.style.left).toBe(`${BAR_RECT.right - DOCKED_WIDTH}px`)
    expect(card.style.top).toBe('800px')
    expect(card.style.borderRadius).toBe('0')
  })

  it('detectSnap center: dropping in the bar\'s vertical range but away from both edge zones does NOT dock — card free-floats at the dragged-to position instead', () => {
    mockRects()
    const { getByTestId } = renderCard()
    const card = getByTestId('shadow-card')
    const header = card.firstElementChild as HTMLElement

    // Dead-center of the bar (bar spans x:200-1200; edge zones only reach to
    // 200+0.7*420=494 and 1200-294=906 — 700 is clear of both).
    drag(header, { start: [1000, 400], arm: [1010, 410], move: [700, 850], up: [700, 850] })

    // Never docked — square-corner/height styling from the docked branches
    // must be absent.
    expect(card.style.borderRadius).not.toBe('0')
    expect(card.style.height).toBe('')
    // Free-floats at the computed drop position (fixed, not the pristine
    // right/bottom anchor) — proves setFreePos actually committed and
    // containerStyle picked it up on the very next render of this instance.
    expect(card.style.position).toBe('fixed')
    // initX(900) + (700-1000) = 600; initY(300) + (850-400) = 750.
    expect(card.style.left).toBe('600px')
    expect(card.style.top).toBe('750px')
  })

  it('detectSnap outside: dropping below the bar\'s vertical range never docks, even directly over the left edge column', () => {
    mockRects()
    const { getByTestId } = renderCard()
    const card = getByTestId('shadow-card')
    const header = card.firstElementChild as HTMLElement

    // clientX=210 would satisfy the left-edge snap zone on its own, but
    // clientY=950 is below BAR_RECT.bottom=900 — vertical range fails first.
    drag(header, { start: [1000, 400], arm: [1010, 410], move: [210, 950], up: [210, 950] })

    expect(card.style.borderRadius).not.toBe('0')
    expect(card.style.height).toBe('')
    expect(card.style.position).toBe('fixed') // free-floated, not docked
  })

  it('redock cycle: dock left, then a second drag to the dead-center undocks back to free-float', () => {
    mockRects()
    const { getByTestId } = renderCard()
    const card = getByTestId('shadow-card')

    drag(card.firstElementChild as HTMLElement, { start: [1000, 400], arm: [1010, 410], up: [210, 850] })
    expect(card.style.left).toBe('200px')
    expect(card.style.borderRadius).toBe('0')

    // Second drag starts from wherever the (now docked) header currently is —
    // CARD_RECT is a static mock so containerRef.getBoundingClientRect() still
    // reports the same initX/initY regardless of the dock; only the drop
    // point (700,850, dead-center) matters for this assertion.
    drag(card.firstElementChild as HTMLElement, { start: [1000, 400], arm: [1010, 410], move: [700, 850], up: [700, 850] })
    expect(card.style.borderRadius).not.toBe('0')
    expect(card.style.left).toBe('600px')
    expect(card.style.top).toBe('750px')
  })

  it('dock persists in the store across a remount (localStorage-backed, like desktop)', () => {
    mockRects()
    const first = renderCard()
    const card1 = first.getByTestId('shadow-card')
    drag(card1.firstElementChild as HTMLElement, { start: [1000, 400], arm: [1010, 410], up: [1190, 850] })
    expect(card1.style.left).toBe(`${BAR_RECT.right - DOCKED_WIDTH}px`)
    first.unmount()

    // A brand new ShadowCard instance (same module-level store) restores the
    // committed dock immediately, with no drag needed.
    const second = renderCard()
    const card2 = second.getByTestId('shadow-card')
    expect(card2.style.position).toBe('fixed')
    expect(card2.style.left).toBe(`${BAR_RECT.right - DOCKED_WIDTH}px`)
    expect(card2.style.borderRadius).toBe('0')
    second.unmount()
  })
})

// ТЗ №6 п.5 [ID:P-tz6] — pointer capture на заголовке (быстрый undock-драг не
// «залипает»: захваченные pointerup/move приходят даже за пределами окна).
describe('ТЗ №6 п.5 — header drag захватывает указатель [ID:P-tz6]', () => {
  it('pointerDown на заголовке зовёт setPointerCapture(pointerId) на ЭТОМ заголовке', () => {
    mockRects()
    // jsdom не реализует setPointerCapture — определяем перед spy (иначе spyOn на
    // отсутствующем методе бросает), ловим this+arg.
    const calls: Array<{ el: HTMLElement; id: number }> = []
    ;(HTMLElement.prototype as unknown as { setPointerCapture: (id: number) => void }).setPointerCapture =
      function (this: HTMLElement, id: number) { calls.push({ el: this, id }) }
    const { getByTestId } = renderCard()
    const card = getByTestId('shadow-card')
    const header = card.firstElementChild as HTMLElement

    fireEvent.pointerDown(header, { button: 0, pointerId: 7, clientX: 1000, clientY: 400 })

    expect(calls.length).toBe(1)
    expect(calls[0].id).toBe(7)
    expect(calls[0].el).toBe(header) // «на правильном элементе» (владелец)
    delete (HTMLElement.prototype as unknown as { setPointerCapture?: unknown }).setPointerCapture
  })

  it('полный pointer-драг всё ещё докает (событийная модель работает после конверсии)', () => {
    mockRects()
    const { getByTestId } = renderCard()
    const card = getByTestId('shadow-card')
    drag(card.firstElementChild as HTMLElement, { start: [1000, 400], arm: [1010, 410], up: [210, 850] })
    expect(card.style.position).toBe('fixed')
    expect(card.style.left).toBe('200px')
    expect(card.style.borderRadius).toBe('0')
  })
})

// ТЗ №8 п.3 [ID:P-tz8] — драг НИКОГДА не деактивирует shadowing. Заголовок берёт
// pointer-capture (ТЗ №6 п.5); браузер после дропа синтезирует `click`, который по
// capture-пути бьёт по крестику × (onClick=deactivate) ВНУТРИ заголовка → карта
// unmount, пилюля off (live-репро оркестратора: header-drag → дроп над видео).
// LIVE-МОДЕЛЬ: реальный драг (started) + последующий click по × не должен звать
// deactivate; click БЕЗ драга — должен (осознанное закрытие не сломано).
describe('ТЗ №8 п.3 — драг не деактивирует shadowing [ID:P-tz8]', () => {
  it('после РЕАЛЬНОГО драга (дроп вне снап-зоны, free-float) синтетический click по × НЕ зовёт deactivate', () => {
    mockRects()
    const deactivate = vi.fn()
    const { getByTestId } = renderCard(mkShadow({ deactivate }))
    const card = getByTestId('shadow-card')
    const header = card.firstElementChild as HTMLElement
    const closeBtn = getByTestId('shadow-close')

    // Драг из float в dead-center (вне снап-зоны) → free-float, НЕ док.
    drag(header, { start: [1000, 400], arm: [1010, 410], move: [700, 850], up: [700, 850] })
    // Драг сам по себе не деактивировал (только freePos):
    expect(deactivate).not.toHaveBeenCalled()
    // Браузер синтезирует post-drag click по × (pointer-capture-путь). Модель:
    fireEvent.click(closeBtn)
    // Подавлено onClickCapture'ом контейнера — deactivate НЕ вызван.
    expect(deactivate).not.toHaveBeenCalled()
  })

  it('post-drag click, пойманный на самом заголовке (не по ×), тоже подавляется — capture на контейнере', () => {
    mockRects()
    const deactivate = vi.fn()
    const { getByTestId } = renderCard(mkShadow({ deactivate }))
    const card = getByTestId('shadow-card')
    const header = card.firstElementChild as HTMLElement
    drag(header, { start: [1000, 400], arm: [1010, 410], move: [700, 850], up: [700, 850] })
    // Единственный синтетический post-drag click приходит на заголовок (capture
    // ретаргетит его на элемент-захватчик) — он съедается, флаг сбрасывается.
    fireEvent.click(header)
    // Последующий ОСОЗНАННЫЙ click по × проходит (это уже новый жест).
    fireEvent.click(getByTestId('shadow-close'))
    expect(deactivate).toHaveBeenCalledTimes(1)
  })

  it('click по × БЕЗ предшествующего драга ДЕАКТИВИРУЕТ (осознанное закрытие не сломано)', () => {
    mockRects()
    const deactivate = vi.fn()
    const { getByTestId } = renderCard(mkShadow({ deactivate }))
    const closeBtn = getByTestId('shadow-close')
    fireEvent.click(closeBtn)
    expect(deactivate).toHaveBeenCalledTimes(1)
  })

  it('sub-threshold pointer-жест (НЕ драг) не подавляет последующий click по × — закрытие работает', () => {
    mockRects()
    const deactivate = vi.fn()
    const { getByTestId } = renderCard(mkShadow({ deactivate }))
    const card = getByTestId('shadow-card')
    const header = card.firstElementChild as HTMLElement
    // pointerdown + микродвижение <6px + up → drag.started НИКОГДА не true.
    fireEvent.pointerDown(header, { button: 0, pointerId: 1, clientX: 1000, clientY: 400 })
    fireEvent.pointerMove(window, { clientX: 1002, clientY: 401 })
    fireEvent.pointerUp(window, { clientX: 1002, clientY: 401 })
    fireEvent.click(getByTestId('shadow-close'))
    expect(deactivate).toHaveBeenCalledTimes(1) // не подавлено (драга не было)
  })

  it('ВТОРОЙ осознанный click по × (уже после того, как post-drag click был съеден) деактивирует', () => {
    mockRects()
    const deactivate = vi.fn()
    const { getByTestId } = renderCard(mkShadow({ deactivate }))
    const card = getByTestId('shadow-card')
    const header = card.firstElementChild as HTMLElement
    drag(header, { start: [1000, 400], arm: [1010, 410], move: [700, 850], up: [700, 850] })
    fireEvent.click(getByTestId('shadow-close')) // post-drag click — съеден
    expect(deactivate).not.toHaveBeenCalled()
    fireEvent.click(getByTestId('shadow-close')) // следующий осознанный — проходит
    expect(deactivate).toHaveBeenCalledTimes(1)
  })
})
