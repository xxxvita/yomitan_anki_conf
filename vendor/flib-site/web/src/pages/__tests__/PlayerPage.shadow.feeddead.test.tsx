// PlayerPage.shadow.feeddead.test.tsx — РЕГРЕССИЯ ТЗ-5 [ID:P-feed-dead]:
// «лента попыток МЕРТВА» на ЭФЕМЕРНОМ арме. Владелец (видео-прогон, билд с ТЗ-5):
// партиалы живые, фраза сказана, петля крутится — но ни одной строки «повтор N»
// за 3.5 мин; ДО ТЗ-5 попытки копились до 10.
//
// КОРЕНЬ (подозреваемый №3): аккумулятор ПИШЕТ попытку под `armCueIndexRef.current`
// (голый, может быть -1, когда resolveArmCaptureIndex честно вернул -1 — gap-арм /
// activeIndex=-1 + armedRange не пересёк cue), а карта ЧИТАЕТ бакет по
// `armCue >= 0 ? armCue : activeIndex`. АСИММЕТРИЯ: при armCue=-1 запись уходит в
// НЕВИДИМЫЙ бакет "-1" (toPanel/mergeShadowAttemptsForPanel пропускают cue_index<0),
// а чтение падает на activeIndex → бакет ЗАПИСИ != бакет ЧТЕНИЯ → лента вечно пуста.
// latest-B1 (shadow-diff) всё ещё виден (синтез из lastMarks, бакет-независим) — но
// НИ ОДНОЙ исторической строки «повтор N».
//
// Та же капчур-мок-обвязка, что PlayerPage.shadow.tz5.test.tsx.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, waitFor, act, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PlayerPage } from '../PlayerPage'
import type { WorkspaceApi } from '../../player/hooks/useWorkspace'
import type { ShadowAttemptStored } from '../../player/workspace/shadow-attempts'

const CUES = [
  { start: 0, end: 2, text_en: 'hello world', text_ru: 'привет мир' },
  { start: 2, end: 4, text_en: 'second cue', text_ru: 'вторая реплика' },
]

// Форс armCue: null → реальный resolveArmCaptureIndex; число → форсим (репро корня
// с armCue=-1, которое resolveArmCaptureIndex честно отдаёт на gap-арме).
const armCueMock = vi.hoisted(() => ({ force: null as number | null }))
vi.mock('../../player/workspace/shadow-arm-cue-index', async (io) => {
  const actual = await io<typeof import('../../player/workspace/shadow-arm-cue-index')>()
  return {
    ...actual,
    resolveArmCaptureIndex: (args: any) =>
      armCueMock.force != null ? armCueMock.force : actual.resolveArmCaptureIndex(args),
  }
})

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

const KEY_A = 'flib:shadow:abc123XYZ_1'
function readA(): ShadowAttemptStored[] { const raw = localStorage.getItem(KEY_A); return raw ? JSON.parse(raw) : [] }

// [ID:P-feed-dead-fix] MED — естественный репро (без мока resolveArmCaptureIndex):
// субтитры-фетч управляется вручную (defer=true) — резолвится ТОЛЬКО когда тест
// явно дёргает resolve(), чтобы арм реально успел произойти на cues=[] (pending
// fetch), как в бою (медленная сеть / холодный старт страницы).
const subtitleGate = vi.hoisted(() => ({ defer: false, resolve: null as (() => void) | null }))

beforeEach(() => {
  localStorage.clear()
  // Э6 (Shadowing-гейт): пилюля «Шадоуинг» теперь disabled без flib:access —
  // сидим доступ, чтобы армы этого теста (не про гейт) доходили до onToggleShadow.
  localStorage.setItem('flib:access', JSON.stringify({ shadowing: true, keyPrefix: 'tpk_test', checkedAt: new Date().toISOString() }))
  armCueMock.force = null
  subtitleGate.defer = false; subtitleGate.resolve = null
  wsWrap.lastArgs = null; wsWrap.lastReturn = null; rtWrap.lastArgs = null; rtWrap.lastReturn = null; ssWrap.lastReturn = null
  vi.stubGlobal('fetch', vi.fn((url: unknown) => {
    const u = String(url)
    if (u.includes('/api/youtube/subtitles')) {
      const body = { ok: true, status: 200, json: async () => ({ video_id: 'abc123XYZ_1', source_language: 'en', cues: CUES }) } as Response
      if (subtitleGate.defer) return new Promise<Response>(resolve => { subtitleGate.resolve = () => resolve(body) })
      return Promise.resolve(body)
    }
    if (u.includes('/api/stt')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ text: 'x' }) } as Response)
    return Promise.reject(new Error(`unmocked ${u}`))
  }))
})

async function twoRaf() { await act(async () => { await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))) }) }
function boundary() { act(() => { (wsWrap.lastArgs![4] as () => void)() }) }
async function arm() { act(() => { rtWrap.lastReturn!.handleShadowKey() }); await twoRaf() }
async function armPill(getByTitle: (t: string) => HTMLElement) { act(() => { fireEvent.click(getByTitle('Старт Шадоуинг')) }) }

// ─────────────────────────────────────────────────────────────────────────────
// КОРЕНЬ [ID:P-feed-dead] — armCue<0 → бакет ЗАПИСИ != бакет ЧТЕНИЯ → лента мертва
// ─────────────────────────────────────────────────────────────────────────────
describe('РЕГРЕССИЯ ТЗ-5 корень: armCue<0 → бакет записи == бакет чтения [ID:P-feed-dead]', () => {
  it('armCue=-1 (resolve честно отдал -1), playhead на cue0 → лента ВСЁ РАВНО растёт (запись видима)', async () => {
    armCueMock.force = -1 // gap-арм: resolveArmCaptureIndex вернул -1
    const { getByTestId } = render(<MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>)
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await twoRaf() // playhead t=1 → activeIndex=0
    await arm()
    expect(rtWrap.lastReturn!.armedSegmentId()).not.toBeNull()

    const src = rtWrap.lastArgs!.answerSource
    src.forceOnce({ status: 'final', text: 'hello world' })
    boundary(); await twoRaf()
    src.forceOnce({ status: 'final', text: 'hello there' })
    boundary(); await twoRaf()

    // Запись реально произошла.
    await waitFor(() => { expect(readA().length).toBeGreaterThanOrEqual(2) })
    // ГЛАВНОЕ: бакет ЗАПИСИ виден (cue_index >= 0, НЕ -1) — иначе toPanel его скроет.
    expect(readA().every(a => a.cue_index >= 0)).toBe(true)
    // И бакет записи == бакет чтения карты → карта показывает историю.
    const card = getByTestId('shadow-card')
    await waitFor(() => {
      expect(within(card).queryAllByTestId('shadow-history-row').length).toBeGreaterThanOrEqual(1)
    })
    expect(within(card).queryByTestId('shadow-diff')).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// [ID:P-feed-dead-fix] HIGH, естественный репро — БЕЗ мока resolveArmCaptureIndex.
// Арм на A-B (handleShadowKey шаг 4 не зависит от `cues`) успевает произойти ДО
// того, как субтитры-фетч резолвится (cues=[] pending) → resolveArmCaptureIndex
// честно captures -1 (клямповать не на что). Субтитры приходят ПОСЛЕ. Без латча
// («апгрейд без даунгрейда») armCueIndexRef держит ГОЛЫЙ prevCaptured=-1 весь ран
// → resolveAttemptBucket(-1, activeIndex) на каждой попытке падает на ЖИВОЙ
// activeIndex, который «дышит» вслед за playhead → попытки размазываются по
// РАЗНЫМ бакетам вместо накопления в одном. С латчем — первый живой activeIndex
// после прихода cues фиксируется НАВСЕГДА для этого рана.
// ─────────────────────────────────────────────────────────────────────────────
describe('РЕГРЕССИЯ [ID:P-feed-dead-fix] естественный репро: арм ДО прихода субтитров', () => {
  it('арм на A-B при cues=[] (fetch pending) → cues приходят позже → playhead гуляет по cue-границам → ВСЕ попытки в ОДНОМ (видимом) бакете', async () => {
    subtitleGate.defer = true
    const { getByTitle } = render(<MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>)
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await twoRaf()

    // Субтитры ещё НЕ пришли (cues=[]) — арм на A-B[0,10] от этого не зависит
    // (handleShadowKey шаг 4 проверяет только диапазон, не liveCuesRef).
    act(() => { wsWrap.lastReturn!.setABLoop(0, 10) })
    await armPill(getByTitle)
    expect(rtWrap.lastReturn!.armedSegmentId()).not.toBeNull()

    // Субтитры резолвятся ТОЛЬКО ТЕПЕРЬ — после арма (репро «арм до cues»).
    await act(async () => { subtitleGate.resolve!(); await Promise.resolve() })
    await twoRaf()

    const src = rtWrap.lastArgs!.answerSource

    // Попытка 1: playhead на cue#0.
    act(() => { mockAdapterHolder.adapter._setTime(1) })
    await twoRaf()
    src.forceOnce({ status: 'final', text: 'attempt one' })
    boundary(); await twoRaf()

    // Попытка 2: playhead уехал на cue#1 — БЕЗ латча бакет уехал бы вместе с ним.
    act(() => { mockAdapterHolder.adapter._setTime(3) })
    await twoRaf()
    src.forceOnce({ status: 'final', text: 'attempt two' })
    boundary(); await twoRaf()

    // Попытка 3: playhead снова на cue#0 (петля рестартнула, границы 2-3).
    act(() => { mockAdapterHolder.adapter._setTime(1) })
    await twoRaf()
    src.forceOnce({ status: 'final', text: 'attempt three' })
    boundary(); await twoRaf()

    await waitFor(() => { expect(readA().length).toBeGreaterThanOrEqual(3) })
    // Видимый бакет — не -1 (иначе toPanel/merge скрыли бы запись навсегда).
    expect(readA().every(a => a.cue_index >= 0)).toBe(true)
    // ГЛАВНОЕ: все записи рана легли в ОДИН И ТОТ ЖЕ бакет (латч на первый живой
    // cue рана), а не размазались по activeIndex, гуляющему за playhead.
    const buckets = new Set(readA().map(a => a.cue_index))
    expect(buckets.size).toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Регресс подозреваемого №1 — стабильный armedSegmentId в петле, clearAll ОДИН раз
// ─────────────────────────────────────────────────────────────────────────────
describe('РЕГРЕССИЯ ТЗ-5 №1: петля не пере-армит → лента копится [ID:P-feed-dead]', () => {
  it('эфемерный S-арм, Fake-петля границ → armedSegmentId стабилен, +1 строка на границу', async () => {
    const { getByTestId } = render(<MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>)
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await twoRaf()
    await arm()
    const armedId = rtWrap.lastReturn!.armedSegmentId()
    expect(armedId).not.toBeNull()
    const src = rtWrap.lastArgs!.answerSource
    for (let i = 0; i < 4; i++) {
      src.forceOnce({ status: 'final', text: `try ${i}` })
      boundary(); await twoRaf()
      // Петля НЕ пере-армит (нет нового ephemeral-N) → armedSegmentId стабилен →
      // clearAll НЕ срабатывает каждый цикл → попытки копятся.
      expect(rtWrap.lastReturn!.armedSegmentId()).toBe(armedId)
      await waitFor(() => { expect(readA().length).toBe(i + 1) })
    }
    const card = getByTestId('shadow-card')
    await waitFor(() => {
      expect(within(card).queryAllByTestId('shadow-history-row').length).toBeGreaterThanOrEqual(3)
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Регресс подозреваемого №2 — pre-seed «вечной» истории стирается на арме, затем
// НОВЫЕ копятся и видны на карте (add после clearAll не теряется — identity ok)
// ─────────────────────────────────────────────────────────────────────────────
describe('РЕГРЕССИЯ ТЗ-5 №2: pre-seed → clear на арме → новые копятся и видны [ID:P-feed-dead]', () => {
  it('10 старых в localStorage → арм чистит → новые попытки появляются на карте', async () => {
    localStorage.setItem(KEY_A, JSON.stringify(Array.from({ length: 10 }, (_, i) => ({
      id: `old${i}`, cue_index: 0, text: `old ${i}`, marks: [], match_pct: 50,
      audio_start_sec: 0, audio_end_sec: 0, created_at: '2026-01-01T00:00:00.000Z',
    }))))
    const { getByTestId } = render(<MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>)
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await twoRaf()
    await arm()
    // clearAll стёр «вечную» историю.
    await waitFor(() => { expect(readA().length).toBe(0) })
    const src = rtWrap.lastArgs!.answerSource
    src.forceOnce({ status: 'final', text: 'hello world' })
    boundary(); await twoRaf()
    src.forceOnce({ status: 'final', text: 'hello there' })
    boundary(); await twoRaf()
    // НОВЫЕ попытки (после clearAll) не теряются в stale-замыкании add.
    await waitFor(() => { expect(readA().length).toBe(2) })
    expect(readA().every(a => a.text.startsWith('hello'))).toBe(true)
    const card = getByTestId('shadow-card')
    await waitFor(() => {
      expect(within(card).queryAllByTestId('shadow-history-row').length).toBeGreaterThanOrEqual(1)
    })
  })
})
