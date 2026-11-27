import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PlayerPage } from '../PlayerPage'

// createIFrameAdapter грузит YT API (в jsdom не резолвится) → adapter=null; fetch субтитров отклоняется (перехвачено в useSubtitles)
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no net'))))
  // Э6 (Shadowing-гейт): пилюля «Шадоуинг» теперь disabled + другой title без
  // flib:access — сидим доступ, несколько тестов ниже проверяют/кликают
  // title 'Старт Шадоуинг' для сценариев, не связанных с гейтом.
  window.localStorage.clear()
  window.localStorage.setItem('flib:access', JSON.stringify({ shadowing: true, keyPrefix: 'tpk_test', checkedAt: new Date().toISOString() }))
})

describe('PlayerPage smoke (hooks-order both branches)', () => {
  it('renders player stage with a videoId, no crash', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    expect(container.querySelector('#yt-player')).toBeTruthy()
    // old <Timeline> root (data-testid="timeline") replaced by the lifted
    // WorkspacePanel; its root carries data-workspace-bar instead.
    expect(container.querySelector('[data-workspace-bar]')).toBeTruthy()
  })
  it('renders no-video message without a videoId (hook count unchanged → no hook-order error)', () => {
    const { getByText } = render(
      <MemoryRouter initialEntries={['/player']}><PlayerPage /></MemoryRouter>
    )
    expect(getByText(/Нет видео/)).toBeTruthy()
  })
})

// PLAYER_PAGE_INTEGRATION_SMOKE (P1 T4, mandatory): mounts the REAL assembled
// island — PlayerPage → PlayerRoot → WorkspacePanel → WorkspacePanelThemed —
// with a fake (not null) adapter, and proves a plain pointerdown→pointerup
// (no move) on the lifted bar reaches `adapter.seek`.
//
// What this test DOES prove: (1) end-to-end wiring from PlayerPage all the
// way through to adapter.seek, (2) pointerdown→up bubbling path is unbroken
// (no stopPropagation regressions), (3) old <Timeline> testid gone.
//
// What this test DOES NOT prove: CSS pointer-events::none or overlay
// click-capture regressions. fireEvent.pointerDown(bar, ...) calls
// dispatchEvent on the node directly — no hit-testing occurs, so CSS
// pointer-events doesn't affect it. To catch CSS regressions, run Playwright
// or manual browser testing (TODO(e2e): add overlay-catch e2e).
//
// `mockAdapterHolder` is created via vi.hoisted so the vi.mock factory below
// (which itself is hoisted above this file's imports) can write into it — the
// factory does a self-contained dynamic import of the shared test fake, so
// it never references a statically-hoisted binding across the mock boundary.
const mockAdapterHolder = vi.hoisted(() => ({ adapter: null as any }))

vi.mock('../../adapter/IFrameAdapter', () => ({
  createIFrameAdapter: async () => {
    const { makeFakeAdapter } = await import('../../adapter/__tests__/fake')
    mockAdapterHolder.adapter = makeFakeAdapter({ duration: 120, t: 30 })
    return mockAdapterHolder.adapter
  },
}))

describe('PlayerPage integration smoke — assembled island (mandatory, P1 T4)', () => {
  it('pointerdown→pointerup (no move) on [data-workspace-bar] routes a seek to adapter.seek; old timeline gone', async () => {
    // Non-zero rect so xToTime() resolves a real time instead of NaN
    // (jsdom's default getBoundingClientRect is all-zero) — makes the
    // seek-was-routed assertion meaningful rather than an artifact of
    // division-by-zero still happening to call the function.
    const rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, width: 1000, height: 40, top: 0, left: 0, right: 1000, bottom: 40,
      toJSON() { return {} },
    } as DOMRect)

    try {
      const { container } = render(
        <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
      )

      await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })

      const bar = container.querySelector('[data-workspace-bar]') as HTMLElement
      expect(bar).toBeTruthy()
      // Old hand-written <Timeline> is fully removed (T3) — its root
      // carried this testid; the lifted panel never renders it.
      expect(container.querySelector('[data-testid="timeline"]')).toBeNull()

      const seekCountBefore = mockAdapterHolder.adapter._seekCount as number
      fireEvent.pointerDown(bar, { clientX: 500, clientY: 10, bubbles: true, button: 0 })
      fireEvent.pointerUp(bar, { clientX: 500, clientY: 10, bubbles: true, button: 0 })

      expect(mockAdapterHolder.adapter._seekCount).toBeGreaterThan(seekCountBefore)
    } finally {
      rectSpy.mockRestore()
    }
  })
})

// T4-REVIEW SMOKE (mandatory, spec-gap fix): PlayerPage-level coverage for the
// callbacks wired to WorkspacePanel — stub-pill toast, Exit collapse/reopen.
//
// T2-REVIEW (this file's last block below): the old "Exit-stops-active-loop"
// test here compensated for a MISSING suspend-gate by calling ws.stopLoop()
// from onExit — that dropped the loop entirely instead of just freezing it,
// an asymmetry vs. the Z hotkey (pure toggle, no stopLoop). Desktop canon
// (useWorkspace.ts:384 on the desktop side) treats hiding the panel as a
// visibility flip ONLY: the loop survives, only the boundary driver freezes.
// The old test is REWRITTEN below (see "T2 review smoke") to assert that new
// contract instead of the old stop-on-exit one.
describe('PlayerPage — T4 review smoke (toast / collapse-reopen)', () => {
  // S3-7 (was T5): V1/push-to-record is retired — the Шадоуинг pill no longer
  // toggles a card. Activation moved to the runtime S-key arm (see
  // PlayerPage.shadow.integration.test.tsx for the full runtime flow).
  // Срез A (п.1): the Шадоуинг pill is REVIVED — a live hands-free toggle
  // (onToggleShadow wired from PlayerPage, un-gating the `{onToggleShadow && …}`
  // pill in WorkspacePanelThemed:2811). It is NOT a "Скоро" stub and has NO V1
  // push-to-record surface. Dictation/Puzzle are untouched — still "Скоро" stubs.
  it('the Шадоуинг pill is a live toggle (Срез A) — present, not a "Скоро" stub, no V1 record surface, no card until armed', async () => {
    const { container, getByTitle, queryByTestId } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    expect(container.querySelector('[data-workspace-bar]')).toBeTruthy()
    // Pill present (title reflects inactive state), card not mounted yet.
    expect(getByTitle('Старт Шадоуинг')).toBeTruthy()
    expect(queryByTestId('shadow-card')).toBeNull()
    expect(queryByTestId('mini-toast')?.textContent ?? '').not.toBe('Скоро')
    // No V1 push-to-record surface exists anywhere on the page.
    expect(queryByTestId('shadow-record')).toBeNull()
  })

  it('Диктант/Пазлы pills are still "Скоро" stubs (out of V1 scope)', async () => {
    const { getByTitle, getByTestId } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })

    fireEvent.click(getByTitle('Старт Диктант'))
    expect(getByTestId('mini-toast').textContent).toBe('Скоро')

    fireEvent.click(getByTitle('Пазлы (тренировка)'))
    expect(getByTestId('mini-toast').textContent).toBe('Скоро')
  })

  it('Exit hides WorkspacePanel and shows the reopen button; clicking it brings the panel back', async () => {
    const { container, getByTitle, getByTestId } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })

    fireEvent.click(getByTitle('Закрыть'))
    expect(container.querySelector('[data-workspace-bar]')).toBeNull()
    expect(getByTestId('timeline-reopen')).toBeTruthy()

    fireEvent.click(getByTestId('timeline-reopen'))
    expect(container.querySelector('[data-workspace-bar]')).toBeTruthy()
    expect(container.querySelector('[data-testid="timeline-reopen"]')).toBeNull()
  })

})

// T2 REVIEW SMOKE (this fix): replaces the old "Exit-stops-active-loop" test
// that used to live here (see comment on the describe block above) — that
// test asserted Exit turned an active loop OFF; that was the PRIOR sprint's
// compensation for a missing suspend-gate. The new contract (desktop canon
// useWorkspace.ts:384): Exit/Z are a pure visibility flip — the loop stays
// ON, only the boundary driver suspends while the panel is hidden, and it
// resumes exactly where it left off on reopen. Two round-trips are covered:
// Exit→reopen (button) and Z→Z (hotkey) — onExit and Z share the same
// setTimelineCollapsed plumbing, but Z is a separate code path (useHotkeys),
// so it gets its own assertion rather than being inferred from Exit's.
async function waitTwoAnimationFrames() {
  await act(async () => {
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(null))))
  })
}

describe('PlayerPage — T2 review smoke (Exit/Z = visibility flip, loop enforcement suspends not stops)', () => {
  it('Exit while an A-B loop is active: no seek while hidden, loop still ON after reopen', async () => {
    const { container, getByTitle, getByTestId } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    const adapter = mockAdapterHolder.adapter

    // Put the playhead INSIDE the default seeded range [0,5) before arming the
    // loop, so enabling it does not itself trigger a rewind-on-enable seek —
    // isolates the seek-count assertions below to the boundary driver alone.
    adapter._setTime(0)
    fireEvent.click(getByTitle('A-B повтор: вкл'))
    expect(container.querySelector('[data-tour="player-loop"]')?.getAttribute('data-loop-active')).toBe('true')
    await waitTwoAnimationFrames()
    const seekCountArmed = adapter._seekCount as number

    // Exit — panel hides, but (T2 fix) the loop is NOT stopped.
    fireEvent.click(getByTitle('Закрыть'))
    expect(container.querySelector('[data-workspace-bar]')).toBeNull()
    expect(getByTestId('timeline-reopen')).toBeTruthy()

    // Playhead crosses past B while the panel stays hidden — enforcement must
    // be frozen (suspended), so no restart-seek happens.
    adapter._setTime(999)
    await waitTwoAnimationFrames()
    expect(adapter._seekCount).toBe(seekCountArmed) // frozen: no seek while hidden

    // Reopen — enforcement resumes; assert the loop survived the round-trip
    // (this is the inverse of the OLD test's assertion, which expected 'false').
    fireEvent.click(getByTestId('timeline-reopen'))
    const loopPill = container.querySelector('[data-tour="player-loop"]')
    expect(loopPill?.getAttribute('data-loop-active')).toBe('true')

    // With the panel back open, the still-overshot playhead is now enforced
    // again — a restart-seek fires (proves suspend/resume actually re-arms the
    // driver, not just that state.looping was preserved).
    await waitTwoAnimationFrames()
    expect(adapter._seekCount).toBeGreaterThan(seekCountArmed)
  })

  it('Z hotkey while an A-B loop is active: same visibility-flip contract as Exit', async () => {
    const { container, getByTitle } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    const adapter = mockAdapterHolder.adapter

    adapter._setTime(0)
    fireEvent.click(getByTitle('A-B повтор: вкл'))
    expect(container.querySelector('[data-tour="player-loop"]')?.getAttribute('data-loop-active')).toBe('true')
    await waitTwoAnimationFrames()
    const seekCountArmed = adapter._seekCount as number

    // Z — hides the panel (same setTimelineCollapsed plumbing as Exit).
    fireEvent.keyDown(document, { key: 'z', code: 'KeyZ' })
    expect(container.querySelector('[data-workspace-bar]')).toBeNull()

    adapter._setTime(999)
    await waitTwoAnimationFrames()
    expect(adapter._seekCount).toBe(seekCountArmed) // frozen while hidden via Z too

    // Z again — reopens; loop still ON.
    fireEvent.keyDown(document, { key: 'z', code: 'KeyZ' })
    expect(container.querySelector('[data-tour="player-loop"]')?.getAttribute('data-loop-active')).toBe('true')
  })
})

// W3 (feedback #5, owner: "панель, которая исчезла, тоже чинить надо"): gear +
// inset move OFF the video overlay (.stage-tools removed entirely — JSX/CSS/
// tests) and onto a new .video-topbar strip that is the FIRST child of
// .fs-root, in-flow ABOVE .player-stage (flex-shrink:0) — visible in
// fullscreen too, since it lives inside the fullscreened element. The topbar
// also gains the subtitle-mode segments (same SubtitleMode literals + labels
// as the drawer, single unified `mode` state) so mode/gear/inset are all
// reachable without opening the drawer, including in fullscreen.
describe('PlayerPage — T4/W3 video-topbar (gear/inset/mode segments off the stage, in-flow above the video), videoBoxed inset', () => {
  beforeEach(() => { localStorage.clear() })

  it('gear-btn lives in .video-topbar (.stage-tools removed) and still opens the drawer', async () => {
    const { container, getByTestId } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })

    expect(container.querySelector('.player-topbar')).toBeNull()
    expect(container.querySelector('.stage-tools')).toBeNull()
    const topbar = container.querySelector('.video-topbar')
    expect(topbar).toBeTruthy()
    const gear = getByTestId('gear-btn')
    expect(topbar?.contains(gear)).toBe(true)
    expect(container.querySelector('.player-gear')).toBeNull()

    const drawer = container.querySelector('.settings-drawer')
    expect(drawer?.className.split(' ')).not.toContain('open')
    fireEvent.click(gear)
    expect(drawer?.className.split(' ')).toContain('open')
  })

  // W3-ревью (drawer overlapped .video-topbar, gear became unclickable/unable to
  // close its own drawer): .settings-drawer now starts at top:var(--vtb-h)
  // instead of top:0, so it sits BELOW the topbar in the stacking order the
  // user sees, and gear stays reachable to close what it opened.
  //
  // What this test DOES prove: gear-btn's onClick handler is a real toggle —
  // click 1 adds .open, click 2 removes it again (drawerOpen state flips both
  // ways, not just open-only wiring).
  //
  // What this test DOES NOT prove: that the gear button is actually
  // hit-testable/clickable on screen once the drawer is open. jsdom's fireEvent.click()
  // dispatches straight to the node and never runs layout or hit-testing, so a
  // CSS regression that puts the drawer back on top of the topbar (z-index/top)
  // would NOT fail this test — it would still "pass" on the old, broken CSS.
  // That part of the W3 finding was confirmed by live-browser accessibility
  // (owner report), not by this suite; see app.css .settings-drawer comment.
  it('gear-btn is a toggle: second click closes the drawer it just opened', async () => {
    const { container, getByTestId } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })

    const gear = getByTestId('gear-btn')
    const drawer = container.querySelector('.settings-drawer')
    expect(drawer?.className.split(' ')).not.toContain('open')

    fireEvent.click(gear)
    expect(drawer?.className.split(' ')).toContain('open')

    fireEvent.click(gear)
    expect(drawer?.className.split(' ')).not.toContain('open')
  })

  it('.video-topbar is the FIRST child of .fs-root, above .player-stage, and is reachable in fullscreen', async () => {
    const { container, getByTestId } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })

    const fsRoot = container.querySelector('.fs-root')
    expect(fsRoot?.firstElementChild?.className).toContain('video-topbar')
    expect(fsRoot?.contains(getByTestId('gear-btn'))).toBe(true)
    expect(fsRoot?.contains(getByTestId('inset-btn'))).toBe(true)
    expect(fsRoot?.contains(getByTestId('sub-mode-enru'))).toBe(true)
  })

  // Phase 2, п.G: «Мой маршрут» — ссылка слева вверху в .video-topbar,
  // ведёт назад на /route. Живёт внутри .video-topbar (не нарушает W3-тест
  // выше — .video-topbar остаётся первым ребёнком .fs-root).
  it('п.G: «Мой маршрут» — ссылка на /route внутри .video-topbar', async () => {
    const { container, getByTestId } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })

    const topbar = container.querySelector('.video-topbar')
    const link = getByTestId('my-route-link')
    expect(topbar?.contains(link)).toBe(true)
    expect(link.getAttribute('href')).toBe('/route')
  })

  it('subtitle-mode segments toggle the unified mode state (aria-pressed/is-active) and stay in sync with the drawer', async () => {
    const { getByTestId } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })

    // default mode is 'l2l1' (EN + RU) — no prior localStorage value
    const enru = getByTestId('sub-mode-enru')
    const en = getByTestId('sub-mode-en')
    const off = getByTestId('sub-mode-off')
    expect(enru.getAttribute('aria-pressed')).toBe('true')
    expect(enru.className.split(' ')).toContain('is-active')
    expect(en.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(en)
    expect(en.getAttribute('aria-pressed')).toBe('true')
    expect(en.className.split(' ')).toContain('is-active')
    expect(enru.getAttribute('aria-pressed')).toBe('false')
    expect(enru.className.split(' ')).not.toContain('is-active')

    // drawer reflects the same state (single mode, opened via gear so the
    // drawer's own testids are exercised through the real toggle path)
    fireEvent.click(getByTestId('gear-btn'))
    expect(getByTestId('sd-mode-l2').getAttribute('data-active')).toBe('true')

    // clicking the drawer's own mode button updates the topbar segment too
    fireEvent.click(getByTestId('sd-mode-hidden'))
    expect(off.getAttribute('aria-pressed')).toBe('true')
    expect(off.className.split(' ')).toContain('is-active')
  })

  it('subtitle mode persists to localStorage[flib:subMode] and restores across a remount', async () => {
    const { unmount, getByTestId } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })

    fireEvent.click(getByTestId('sub-mode-en'))
    expect(localStorage.getItem('flib:subMode')).toBe('l2')
    unmount()

    mockAdapterHolder.adapter = null
    const { getByTestId: getByTestId2 } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    expect(getByTestId2('sub-mode-en').className.split(' ')).toContain('is-active')
  })

  it('a corrupt/unknown localStorage[flib:subMode] value falls back to the default mode (l2l1)', async () => {
    localStorage.setItem('flib:subMode', 'not-a-real-mode')
    const { getByTestId } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    expect(getByTestId('sub-mode-enru').className.split(' ')).toContain('is-active')
  })

  it('inset-btn toggles videoBoxed, persists it to localStorage, and reflects is-active', async () => {
    const { getByTestId } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })

    const insetBtn = getByTestId('inset-btn')
    expect(insetBtn.className.split(' ')).not.toContain('is-active')

    fireEvent.click(insetBtn)
    expect(insetBtn.className.split(' ')).toContain('is-active')
    expect(localStorage.getItem('flib:shell:videoBoxed')).toBe('true')

    fireEvent.click(insetBtn)
    expect(insetBtn.className.split(' ')).not.toContain('is-active')
    expect(localStorage.getItem('flib:shell:videoBoxed')).toBe('false')
  })

  it('stage-media right tracks videoBoxed && drawerOpen (340px when both, 0px otherwise)', async () => {
    const { getByTestId } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })

    const stageMedia = getByTestId('stage-media')
    expect(stageMedia.style.right).toBe('0px') // closed drawer, not boxed

    fireEvent.click(getByTestId('inset-btn')) // videoBoxed=true, drawer still closed
    expect(stageMedia.style.right).toBe('0px')

    fireEvent.click(getByTestId('gear-btn')) // drawer opens, videoBoxed true → inset
    expect(stageMedia.style.right).toBe('340px')

    fireEvent.click(getByTestId('gear-btn')) // drawer closes again → 0
    expect(stageMedia.style.right).toBe('0px')
  })
})
