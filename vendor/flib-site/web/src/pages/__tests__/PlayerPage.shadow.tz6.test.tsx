// PlayerPage.shadow.tz6.test.tsx — ТЗ №6 (видео-прогон 23-39), пункты 1 и 2:
//   п.1 — B1-разбор НЕ ИСЧЕЗАЕТ (владелец: «пускай висит, никуда не исчезает»).
//         verdictOutcome обнуляется на границе петли (handleLog 'loop-boundary'),
//         из-за чего последний B1 мигал/пропадал между попытками. Фикс: PlayerPage
//         держит persistent-снапшот последнего ФИНАЛА; заменяется только новым
//         финалом; чистится на разоружении.
//   п.2 — B1 показывается и БЕЗ автоперехода. runtime.setArmedGrading(true) ВСЕГДА
//         на арме; тумблер advanceEnabled управляет только advance/restart через
//         reduceLoopOutcome.
//
// Та же капчур-мок-обвязка, что PlayerPage.shadow.feeddead.test.tsx / .tz5.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, waitFor, act, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PlayerPage } from '../PlayerPage'
import type { WorkspaceApi } from '../../player/hooks/useWorkspace'

const CUES = [
  { start: 0, end: 2, text_en: 'hello world', text_ru: 'привет мир' },
  { start: 2, end: 4, text_en: 'second cue', text_ru: 'вторая реплика' },
]

const mockAdapterHolder = vi.hoisted(() => ({ adapter: null as any }))
const wsWrap = vi.hoisted(() => ({ lastArgs: null as unknown[] | null, lastReturn: null as WorkspaceApi | null }))
const rtWrap = vi.hoisted(() => ({ lastArgs: null as any, lastReturn: null as any }))
const ssWrap = vi.hoisted(() => ({ lastReturn: null as any }))

vi.mock('../../adapter/IFrameAdapter', () => ({
  createIFrameAdapter: async () => {
    const { makeFakeAdapter } = await import('../../adapter/__tests__/fake')
    mockAdapterHolder.adapter = makeFakeAdapter({ duration: 120, t: 1 })
    return mockAdapterHolder.adapter
  },
}))
vi.mock('../../player/workspace/shadow-recorder', () => ({
  ShadowRecorder: class { start() { return Promise.resolve() } stop() { const b = new ArrayBuffer(4); new Int16Array(b).set([1, -1]); return [b] } },
}))
vi.mock('../../player/hooks/useWorkspace', async (io) => {
  const a = await io<typeof import('../../player/hooks/useWorkspace')>()
  return { ...a, useWorkspace: (...args: unknown[]) => { wsWrap.lastArgs = args; const r = (a.useWorkspace as any)(...args); wsWrap.lastReturn = r; return r } }
})
vi.mock('../../player/hooks/useShadowState', async (io) => {
  const a = await io<typeof import('../../player/hooks/useShadowState')>()
  return { ...a, useShadowState: (...args: unknown[]) => { const r = (a.useShadowState as any)(...args); ssWrap.lastReturn = r; return r } }
})
vi.mock('../../player/hooks/useShadowRuntime', async (io) => {
  const a = await io<typeof import('../../player/hooks/useShadowRuntime')>()
  return { ...a, useShadowRuntime: (args: any) => { const r = a.useShadowRuntime(args); rtWrap.lastArgs = args; rtWrap.lastReturn = r; return r } }
})
vi.mock('../../player/hooks/useShadowMicStream', () => ({ useShadowMicStream: () => {} }))

beforeEach(() => {
  localStorage.clear()
  // Э6 (Shadowing-гейт): пилюля «Шадоуинг» теперь disabled без flib:access —
  // сидим доступ, чтобы армы этого теста (не про гейт) доходили до onToggleShadow.
  localStorage.setItem('flib:access', JSON.stringify({ shadowing: true, keyPrefix: 'tpk_test', checkedAt: new Date().toISOString() }))
  wsWrap.lastArgs = null; wsWrap.lastReturn = null; rtWrap.lastArgs = null; rtWrap.lastReturn = null; ssWrap.lastReturn = null
  vi.stubGlobal('fetch', vi.fn((url: unknown) => {
    const u = String(url)
    if (u.includes('/api/youtube/subtitles')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ video_id: 'abc123XYZ_1', source_language: 'en', cues: CUES }) } as Response)
    if (u.includes('/api/stt')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ text: 'x' }) } as Response)
    return Promise.reject(new Error(`unmocked ${u}`))
  }))
})

async function twoRaf() { await act(async () => { await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))) }) }
function boundary() { act(() => { (wsWrap.lastArgs![4] as () => void)() }) }
async function arm() { act(() => { rtWrap.lastReturn!.handleShadowKey() }); await twoRaf() }
// Арм через ПИЛЮЛЮ (onToggleShadow → onShadowKeyActivateOnArm) — реальный
// продовый путь, где живёт setArmedGrading(true) (ТЗ №6 п.2). Прямой
// handleShadowKey (arm() выше) его минует.
async function armPill(getByTitle: (t: string) => HTMLElement) {
  act(() => { fireEvent.click(getByTitle('Старт Шадоуинг')) }); await twoRaf()
}
async function mount() {
  const utils = render(<MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>)
  await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
  await twoRaf()
  return utils
}

// ─────────────────────────────────────────────────────────────────────────────
// ТЗ №6 п.1 — persistent B1
// ─────────────────────────────────────────────────────────────────────────────
describe('ТЗ №6 п.1: B1 не исчезает [ID:P-tz6]', () => {
  it('B1 остаётся виден после НЕ-final исхода (no-response) — не мигает/не пропадает', async () => {
    const { getByTestId } = await mount()
    await arm()
    const src = rtWrap.lastArgs!.answerSource
    src.forceOnce({ status: 'final', text: 'hello world' })
    boundary(); await twoRaf()
    const card = getByTestId('shadow-card')
    await waitFor(() => { expect(within(card).queryByTestId('shadow-verdict-notation')).toBeTruthy() })
    // Услышано в latest-блоке (shadow-diff, НЕ панель «ОЖИДАЕТСЯ», где target тоже 'hello world').
    expect(within(card).getByTestId('shadow-diff').textContent).toContain('hello world')

    // Следующая попытка — НЕ финал (нет ответа): verdictOutcome становится не-final,
    // а граница петли ДО этого обнулила прошлый final. Без persist B1 бы пропал.
    src.forceOnce({ status: 'no-response', reason: 'no-audio' })
    boundary(); await twoRaf()

    // ГЛАВНОЕ: последний B1-разбор ВСЁ ЕЩЁ виден (persist последнего финала).
    expect(within(card).queryByTestId('shadow-verdict-notation')).toBeTruthy()
    expect(within(card).getByTestId('shadow-diff').textContent).toContain('hello world')
  })

  it('новый ФИНАЛ заменяет прошлый B1 (не накапливается стейл)', async () => {
    const { getByTestId } = await mount()
    await arm()
    const src = rtWrap.lastArgs!.answerSource
    // Не-100% (retry, НЕ advance) → grading остаётся, петля даёт второй вердикт.
    src.forceOnce({ status: 'final', text: 'hello there' })
    boundary(); await twoRaf()
    const card = getByTestId('shadow-card')
    await waitFor(() => { expect(within(card).getByTestId('shadow-diff').textContent).toContain('hello there') })

    src.forceOnce({ status: 'final', text: 'goodbye moon' })
    boundary(); await twoRaf()
    // Заменён: услышано теперь новое; старого heard в latest-блоке (shadow-diff) нет.
    await waitFor(() => { expect(within(card).getByTestId('shadow-diff').textContent).toContain('goodbye moon') })
    const diff = within(card).getByTestId('shadow-diff')
    expect(diff.textContent).not.toContain('hello there')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// ТЗ №6 п.2 — B1 без автоперехода; grading всегда, тумблер = только advance
// ─────────────────────────────────────────────────────────────────────────────
describe('ТЗ №6 п.2: вердикт без автоперехода [ID:P-tz6]', () => {
  it('автопереход ВЫКЛ → B1 всё равно оценивается и показывается; петля НЕ advance (арм цел)', async () => {
    const { getByTestId, getByTitle } = await mount()
    // Выключаем автопереход ДО арма — без фикса grading=false → границе нечего оценивать.
    act(() => { ssWrap.lastReturn!.setShadowState({ advanceEnabled: false }) })
    // Арм через пилюлю (реальный путь onShadowKeyActivateOnArm → setArmedGrading(true)).
    await armPill(getByTitle)
    expect(rtWrap.lastReturn!.armedSegmentId()).not.toBeNull()

    const src = rtWrap.lastArgs!.answerSource
    src.forceOnce({ status: 'final', text: 'hello world' }) // 100% vs 'hello world'
    boundary(); await twoRaf()

    const card = getByTestId('shadow-card')
    // Оценка прошла несмотря на выключенный автопереход → B1 показан.
    await waitFor(() => { expect(within(card).queryByTestId('shadow-verdict-notation')).toBeTruthy() })
    // advance ВЫКЛ → петля рестартует/hold (арм остаётся), НЕ уходит вперёд.
    expect(rtWrap.lastReturn!.armedSegmentId()).not.toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// ТЗ №6 п.6 — «серая дрянь вне карточки»: над-видео вердикт-слот НЕ дублирует
// карту, когда карта видима.
// ─────────────────────────────────────────────────────────────────────────────
describe('ТЗ №6 п.6: нет дубля вердикта вне карты [ID:P-tz6]', () => {
  it('карта видима + вердикт → B1 в карте, а над-видео слот (вне карты) СКРЫТ', async () => {
    const { getByTestId, queryByTestId } = await mount()
    await arm()
    const src = rtWrap.lastArgs!.answerSource
    src.forceOnce({ status: 'final', text: 'hello world' })
    boundary(); await twoRaf()
    // Карта (единственный источник разбора) показывает B1.
    await waitFor(() => { expect(within(getByTestId('shadow-card')).queryByTestId('shadow-verdict-notation')).toBeTruthy() })
    // Дублирующий над-видео слот ВНЕ карты — скрыт (cardVisible гейт).
    expect(queryByTestId('shadow-verdict-slot')).toBeNull()
  })
})
