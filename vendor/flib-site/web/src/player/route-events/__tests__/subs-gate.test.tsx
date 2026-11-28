// subs-gate.test.tsx — гейт субтитров первого прохода (спека §4.7, план B8b):
// тест на каждый из пяти пунктов, отметка «прослушан», маршрутный режим (rp/rc,
// повторы на 429/503 ≤ 3 и ≤ 15 с, «пока проверка не ответила — гейт включён»).
import { describe, it, expect, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import {
  __forgetSubsWarningsForTests, ackSubsWarning, firstPass, forcedBlur, ruHidden, subsModeForClip, subsPillIntent, type SubsGateFacts,
} from '../subs-gate'
import { __resetClipListenedForTests, isClipListened, markClipListened, shouldMarkListened, ROUTE_LISTENED_KEY, ROUTE_LISTENED_MAX } from '../clip-listened'
import { checkRouteMode, initialRouteMode, resolveRouteMode, type RouteModeDeps } from '../route-mode'
import { завестиСчётчик, шаг, ключСнимка, type Реплика, type Счётчик } from '../subtitle-counter'
import { SubtitleOverlay } from '../../components/SubtitleOverlay'
import { SubtitleL1Overlay } from '../../components/SubtitleL1Overlay'
import { CueList } from '../../components/CueList'
import { SubtitleSearch } from '../../components/SubtitleSearch'
import type { RouteState } from '../../../site/cabinet/route/route-api'
import type { StateRead } from '../../../site/cabinet/route/use-route-state'

const PID = 'youtube::abc123XYZ_1'
const facts = (o: Partial<SubsGateFacts> = {}): SubsGateFacts => ({ routeMode: 'confirmed', played: false, listened: false, puzzleId: PID, ...o })

beforeEach(() => { __forgetSubsWarningsForTests(); __resetClipListenedForTests(); localStorage.clear() })

describe('п.1 — когда действует', () => {
  it('маршрутный режим и первый проход', () => {
    expect(firstPass(facts())).toBe(true)
    expect(firstPass(facts({ routeMode: 'off' }))).toBe(false)
    expect(firstPass(facts({ played: true }))).toBe(false)
    expect(firstPass(facts({ listened: true }))).toBe(false)
  })
  it('пока проверка режима не ответила (pending) — гейт включён', () => {
    expect(firstPass(facts({ routeMode: 'pending' }))).toBe(true)
    expect(initialRouteMode('abc123XYZ_1', PID, true)).toEqual({ kind: 'pending', puzzleId: PID })
    expect(initialRouteMode('abc123XYZ_1', PID, false)).toEqual({ kind: 'off' })
    expect(initialRouteMode('abc123XYZ_1', 'youtube::other_video', true)).toEqual({ kind: 'off' })
  })
  it('пятисекундный заход (queued_played) гейт не снимает: played берётся только из строки дня', () => {
    const st = stateWith({ puzzle_id: PID, kind: 'youtube', delivered: true, played: false, queued_played: true, new_words: 0, words: [] })
    const v = resolveRouteMode(st, 'abc123XYZ_1', PID, null)
    expect(v.kind).toBe('confirmed')
    const played = v.kind === 'confirmed' ? !!v.row?.played : true
    expect(firstPass(facts({ played }))).toBe(true)
  })
})

describe('п.2 — предупреждение и согласие на ролик', () => {
  it('включение без согласия — предупреждение; «Скрыть» — сразу; после согласия — сразу', () => {
    expect(subsPillIntent('l2', facts())).toBe('warn')
    expect(subsPillIntent('l2l1', facts())).toBe('warn')
    expect(subsPillIntent('hidden', facts())).toBe('apply')
    ackSubsWarning(PID)
    expect(subsPillIntent('l2', facts())).toBe('apply')
    expect(subsPillIntent('l2', facts({ puzzleId: 'youtube::other_video' }))).toBe('warn')
  })
})

describe('п.3 — режим заслоняется, а не перезаписывается', () => {
  it('на первом проходе показ hidden, сохранённый режим не трогается; после согласия — сохранённый', () => {
    localStorage.setItem('flib:subMode', 'l2l1')
    expect(subsModeForClip(facts(), 'l2l1')).toBe('hidden')
    expect(localStorage.getItem('flib:subMode')).toBe('l2l1')
    ackSubsWarning(PID)
    expect(subsModeForClip(facts(), 'l2l1')).toBe('l2l1')
    expect(subsModeForClip(facts({ routeMode: 'off' }), 'l2')).toBe('l2')
  })
})

describe('п.4 — размытие по словам (SubtitleOverlay)', () => {
  const cues = [
    { start: 0, end: 2, text_en: 'Hello brave world', text_ru: 'Привет' },
    { start: 2, end: 4, text_en: 'Second line', text_ru: 'Вторая' },
  ]
  it('нажатие на размытое слово открывает только его, без окна примеров; повторное — окно примеров', () => {
    const revealed: Array<[number, string[]]> = []
    const clicks: string[] = []
    const { container } = render(<SubtitleOverlay cues={cues} activeIndex={0} mode="l2" blur onWordsRevealed={(i, w) => revealed.push([i, w])} onWordClick={w => clicks.push(w)} />)
    const words = () => Array.from(container.querySelectorAll('.sub-word')) as HTMLElement[]
    expect(words().every(w => w.classList.contains('sub-word--blur'))).toBe(true)
    fireEvent.click(words()[1])
    expect(revealed).toEqual([[0, ['brave']]])
    expect(clicks).toEqual([])
    expect(words()[1].classList.contains('sub-word--blur')).toBe(false)
    expect(words()[0].classList.contains('sub-word--blur')).toBe(true)
    fireEvent.click(words()[1])
    expect(clicks).toEqual(['brave'])
    expect(revealed.length).toBe(1)
  })
  it('правая кнопка мыши — вся строка, в обработчик только ещё размытые слова; меню перевода не открывается', () => {
    const revealed: Array<[number, string[]]> = []
    let menu = 0
    const { container } = render(<SubtitleOverlay cues={cues} activeIndex={0} mode="l2" blur onWordsRevealed={(i, w) => revealed.push([i, w])} onPlateContextMenu={() => { menu++ }} />)
    fireEvent.click(container.querySelectorAll('.sub-word')[0])
    fireEvent.contextMenu(container.querySelector('[data-testid="subtitle-overlay"]')!)
    expect(revealed).toEqual([[0, ['Hello']], [0, ['brave', 'world']]])
    expect(menu).toBe(0)
    expect(container.querySelectorAll('.sub-word--blur').length).toBe(0)
  })
  it('долгое нажатие на сенсорном экране — вся строка', async () => {
    const revealed: Array<[number, string[]]> = []
    const { container } = render(<SubtitleOverlay cues={cues} activeIndex={0} mode="l2" blur onWordsRevealed={(i, w) => revealed.push([i, w])} />)
    fireEvent.touchStart(container.querySelector('[data-testid="subtitle-overlay"]')!)
    await new Promise(r => setTimeout(r, 600))
    expect(revealed).toEqual([[0, ['Hello', 'brave', 'world']]])
  })
  it('открытые слова снова размываются при смене реплики; наведение не открывает', () => {
    const { container, rerender } = render(<SubtitleOverlay cues={cues} activeIndex={0} mode="l2" blur onWordsRevealed={() => {}} />)
    fireEvent.click(container.querySelectorAll('.sub-word')[0])
    rerender(<SubtitleOverlay cues={cues} activeIndex={1} mode="l2" blur onWordsRevealed={() => {}} />)
    expect(Array.from(container.querySelectorAll('.sub-word')).every(w => w.classList.contains('sub-word--blur'))).toBe(true)
    const w = container.querySelectorAll('.sub-word')[0]
    fireEvent.mouseEnter(w); fireEvent.mouseOver(w); fireEvent.mouseMove(w)
    expect(w.classList.contains('sub-word--blur')).toBe(true)
  })
  it('L8: возврат к той же реплике — слова снова размыты; долгое нажатие отменяется сменой реплики', async () => {
    const revealed: Array<[number, string[]]> = []
    const { container, rerender } = render(<SubtitleOverlay cues={cues} activeIndex={0} mode="l2" blur onWordsRevealed={(i, w) => revealed.push([i, w])} />)
    fireEvent.click(container.querySelectorAll('.sub-word')[0])
    rerender(<SubtitleOverlay cues={cues} activeIndex={1} mode="l2" blur onWordsRevealed={(i, w) => revealed.push([i, w])} />)
    rerender(<SubtitleOverlay cues={cues} activeIndex={0} mode="l2" blur onWordsRevealed={(i, w) => revealed.push([i, w])} />)
    expect(container.querySelectorAll('.sub-word--blur').length).toBe(3)
    fireEvent.touchStart(container.querySelector('[data-testid="subtitle-overlay"]')!)
    rerender(<SubtitleOverlay cues={cues} activeIndex={1} mode="l2" blur onWordsRevealed={(i, w) => revealed.push([i, w])} />)
    await new Promise(r => setTimeout(r, 600))
    expect(revealed).toEqual([[0, ['Hello']]])
  })
  it('звуковые метки ([Music], (laughs), ♪) — не слова: не размыты, нажатие ничего не рождает, ПКМ их не сообщает', () => {
    const noisy = [{ start: 0, end: 2, text_en: '♪ [Music] Teresa, (laughs) go [Light music] home ♪', text_ru: '' }]
    const revealed: Array<[number, string[]]> = []
    const clicks: string[] = []
    const { container } = render(<SubtitleOverlay cues={noisy} activeIndex={0} mode="l2" blur onWordsRevealed={(i, w) => revealed.push([i, w])} onWordClick={w => clicks.push(w)} />)
    const spans = Array.from(container.querySelectorAll('.sub-word')) as HTMLElement[]
    const blurred = spans.filter(s => s.classList.contains('sub-word--blur')).map(s => s.textContent!.trim())
    expect(blurred).toEqual(['Teresa,', 'go', 'home'])
    const noise = spans.filter(s => !s.classList.contains('sub-word--blur'))
    expect(noise.map(s => s.textContent!.trim())).toEqual(['♪', '[Music]', '(laughs)', '[Light', 'music]', '♪'])
    for (const n of noise) { expect(n.hasAttribute('data-word')).toBe(false); fireEvent.click(n) }
    expect(revealed).toEqual([])
    expect(clicks).toEqual([])
    fireEvent.contextMenu(container.querySelector('[data-testid="subtitle-overlay"]')!)
    expect(revealed).toEqual([[0, ['Teresa', 'go', 'home']]])
  })
  it('слово, слипшееся с меткой («word[Music]»), — слово: размыто', () => {
    const c = [{ start: 0, end: 2, text_en: 'hey[Music] (unclosed bracket', text_ru: '' }]
    const { container } = render(<SubtitleOverlay cues={c} activeIndex={0} mode="l2" blur onWordsRevealed={() => {}} />)
    expect(container.querySelectorAll('.sub-word--blur').length).toBe(3)
  })
  it('без размытия (гость, просмотренный ролик) метка — обычное слово, как раньше', () => {
    const clicks: string[] = []
    const c = [{ start: 0, end: 2, text_en: '[Music] Teresa', text_ru: '' }]
    const { container } = render(<SubtitleOverlay cues={c} activeIndex={0} mode="l2" onWordClick={w => clicks.push(w)} />)
    const words = Array.from(container.querySelectorAll('[data-word]')) as HTMLElement[]
    expect(words.length).toBe(2)
    fireEvent.click(words[0])
    expect(clicks).toEqual(['Music'])
  })
  it('forcedBlur — на первом проходе, при любом режиме человека', () => {
    expect(forcedBlur(facts())).toBe(true)
    expect(forcedBlur(facts({ played: true }))).toBe(false)
  })
})

describe('п.5 — русская строка скрыта весь первый проход, до и после согласия', () => {
  const cues = [{ start: 0, end: 2, text_en: 'Hello', text_ru: 'Привет' }]
  it('ruHidden: и до, и после согласия', () => {
    expect(ruHidden(facts())).toBe(true)
    ackSubsWarning(PID)
    expect(ruHidden(facts())).toBe(true)
    expect(ruHidden(facts({ listened: true }))).toBe(false)
  })
  it('оверлей перевода, список реплик (с капсулой и ПКМ), поиск по субтитрам — без русского', () => {
    const l1 = render(<SubtitleL1Overlay cues={cues} activeIndex={0} mode="l2l1" ruHidden revealedByIndex={new Set([0])} />)
    expect(l1.container.textContent).not.toContain('Привет')
    let menu = 0
    const list = render(<CueList cues={cues} activeIndex={0} onSelect={() => {}} ruByIndex={{ 0: 'Привет' }} onTranslateLine={() => {}} onCueContextMenu={() => { menu++ }} ruHidden />)
    expect(list.container.textContent).not.toContain('Привет')
    expect(list.container.querySelector('button[aria-label="Перевести эту строку"]')).toBeNull()
    fireEvent.contextMenu(list.container.querySelector('.cue-seek')!)
    expect(menu).toBe(0)
    const search = render(<SubtitleSearch cues={cues} onPick={() => {}} ruHidden />)
    fireEvent.change(search.getByTestId('search-input'), { target: { value: 'Привет' } })
    expect(search.queryByTestId('search-results')).toBeNull()
  })
})

describe('отметка «прослушан» (flib:route-listened)', () => {
  const cues: Реплика[] = [{ start: 0, end: 2, text: 'Hello there' }, { start: 2, end: 3, text: '[Music]' }]
  const snap = { puzzleID: PID, ключ: ключСнимка(cues), реплики: cues }
  function heardAll(): Счётчик {
    let c = завестиСчётчик(snap)
    for (let t = 0; t <= 3; t += 0.25) c = шаг(c, { время: t, сдвиг: 0, идётПеремотка: false, ставка: 1 })
    return c
  }
  it('все нешумовые реплики услышаны — прослушан', () => {
    expect(shouldMarkListened({ counter: heardAll(), trackResolved: true, cues, atEnd: false })).toBe(true)
  })
  it('конец ролика без речевых реплик — прослушан, только если дорожка получена', () => {
    expect(shouldMarkListened({ counter: null, trackResolved: true, cues: [], atEnd: true })).toBe(true)
    expect(shouldMarkListened({ counter: null, trackResolved: true, cues: [{ start: 0, end: 1, text: '♪ ♪' }], atEnd: true })).toBe(true)
  })
  it('503 субтитров (дорожка не получена) + конец ролика — отметки нет', () => {
    expect(shouldMarkListened({ counter: null, trackResolved: false, cues: [], atEnd: true })).toBe(false)
  })
  it('речь есть, не всё услышано, конец ролика — отметки нет', () => {
    expect(shouldMarkListened({ counter: завестиСчётчик(snap), trackResolved: true, cues, atEnd: true })).toBe(false)
  })
  it('однажды — навсегда; ≤ 5000, старшие вытесняются', () => {
    markClipListened(PID)
    __resetClipListenedForTests()
    expect(isClipListened(PID)).toBe(true)
    for (let i = 0; i < ROUTE_LISTENED_MAX; i++) markClipListened(`youtube::${i}`)
    expect(isClipListened(PID)).toBe(false)
    expect(JSON.parse(localStorage.getItem(ROUTE_LISTENED_KEY)!).length).toBe(ROUTE_LISTENED_MAX)
  })
})

function stateWith(...clips: RouteState['day'] extends infer D ? D extends { clips: infer C } ? C extends Array<infer X> ? X[] : never : never : never): RouteState {
  return {
    started: true, route_id: 'r', revision: 3, snapshot_date: '2026-11-18', started_at: null, goal_label: '',
    params: { daily_listening_budget_min: 20, daily_new_words: 15 },
    day: { date: '2026-11-18', clips }, next_clip: null,
    current_puzzle_id: clips.filter(c => c.delivered).map(c => (c as { puzzle_id: string }).puzzle_id).pop() ?? null,
    replace_available: true, stop_reason: null, active_exchange: null,
  }
}

describe('маршрутный режим (§4.7)', () => {
  const cur = { puzzle_id: PID, kind: 'youtube', video_id: 'abc123XYZ_1', delivered: true as const, played: false, queued_played: false, new_words: 2, words: ['a', 'b'] }
  const other = { puzzle_id: 'youtube::otherVideo1', kind: 'youtube', delivered: true as const, played: true, queued_played: false, new_words: 0, words: [] }
  function deps(results: Array<StateRead['result']>, o: Partial<RouteModeDeps> = {}): RouteModeDeps & { slept: number[] } {
    let t = 0
    const slept: number[] = []
    let i = 0
    return {
      marked: () => true, session: async () => true,
      read: async () => ({ result: results[Math.min(i++, results.length - 1)], sent: { watchedSeq: 0, pendingClipPlayed: new Set() } }),
      sleep: async ms => { slept.push(ms); t += ms }, now: () => t, slept, ...o,
    }
  }
  const ok = (s: RouteState) => ({ ok: true as const, status: 200, data: s })
  const fail = (status: number, ra: number | null = null) => ({ ok: false as const, status, code: 'x', retryAfterSec: ra, cls: 'temporary' as const, body: null })

  it('rp = current_puzzle_id — маршрутный; иначе гостевой (закладка со старым rp)', async () => {
    expect((await checkRouteMode('abc123XYZ_1', PID, null, deps([ok(stateWith(other, cur))]))).kind).toBe('confirmed')
    expect((await checkRouteMode('abc123XYZ_1', PID, null, deps([ok(stateWith(cur, other))]))).kind).toBe('off')
  })
  it('rp ≠ "youtube::"+v, нет метки, нет сессии — гостевой без запроса', async () => {
    let reads = 0
    const d = deps([ok(stateWith(cur))], { read: async () => { reads++; return { result: ok(stateWith(cur)), sent: { watchedSeq: 0, pendingClipPlayed: new Set() } } } })
    expect((await checkRouteMode('abc123XYZ_1', 'youtube::zzz', null, d)).kind).toBe('off')
    expect((await checkRouteMode('abc123XYZ_1', PID, null, { ...d, marked: () => false })).kind).toBe('off')
    expect((await checkRouteMode('abc123XYZ_1', PID, null, { ...d, session: async () => false })).kind).toBe('off')
    expect(reads).toBe(0)
  })
  it('503 на первом вызове и 200 на втором — маршрутный', async () => {
    const d = deps([fail(503, 2), ok(stateWith(cur))])
    expect((await checkRouteMode('abc123XYZ_1', PID, null, d)).kind).toBe('confirmed')
    expect(d.slept).toEqual([2000])
  })
  it('429/503 — не больше 3 повторов и 15 с в сумме, затем гостевой', async () => {
    const d = deps([fail(429, 1)])
    expect((await checkRouteMode('abc123XYZ_1', PID, null, d)).kind).toBe('off')
    expect(d.slept).toEqual([1000, 1000, 1000])
    const d2 = deps([fail(503, 10)])
    expect((await checkRouteMode('abc123XYZ_1', PID, null, d2)).kind).toBe('off')
    expect(d2.slept).toEqual([10000])
  })
  it('rc — выданный ролик дня (или kept); устаревший rc — без кнопок; rc маршрутного режима не включает', async () => {
    const st = stateWith(other, cur)
    const v = await checkRouteMode('otherVideo1', null, 'youtube::otherVideo1', deps([ok(st)]))
    expect(v.kind).toBe('rc')
    expect((await checkRouteMode('goneVideo11', null, 'youtube::goneVideo11', deps([ok(st)]))).kind).toBe('off')
  })
})
