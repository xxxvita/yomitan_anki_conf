// heard-check-core.test.ts — чистые части теста после ролика: память долей и
// отправленных id, событие (форма как у проверки шлюза), решение о показе и
// порядок «поставить → выгрузить → дальше».
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  HEARD_FRAC_KEY, HEARD_FRAC_MAX, HEARD_SENT_KEY, HEARD_SENT_MAX, isHeardCheckSent, maxHeardFrac, noteHeardCheckSent,
  noteHeardFrac, resetHeardCheckMemory, retainHeardFrac,
} from '../heard-check/heard-check-memory'
import { buildHeardCheckEvent, heardQuestionFor, shownWords } from '../heard-check/heard-check-event'
import { __resetHeardCheckFlowForTests, runHeardCheck, type HeardCheckDeps } from '../heard-check/heard-check-flow'
import { eraseRouteStorage } from '../route-storage'
import type { HeardOutcome } from '../heard-check/heard-check-store'
import type { HeardQuestion, RouteState } from '../route-api'
import type { RouteEvent } from '../outbox'

const RID = '11111111-1111-4111-8111-111111111111'
// модульная память пуста, а localStorage оставлен как есть («перезагрузка»)
function resetHeardCheckMemoryKeepStorage(): void {
  const a = localStorage.getItem(HEARD_SENT_KEY)
  resetHeardCheckMemory()
  if (a !== null) localStorage.setItem(HEARD_SENT_KEY, a)
}
const PID = 'youtube::abc123XYZ_1'
const Q: HeardQuestion = { id: `hc:2026-11-18:${PID}`, kind: 'heard_check', puzzle_id: PID, words: ['alpha', 'beta', 'gamma'] }
const state = (over: Partial<RouteState> = {}): RouteState => ({
  started: true, route_id: RID, revision: 4, snapshot_date: '2026-11-18', started_at: null, goal_label: 'g',
  params: { daily_listening_budget_min: 20, daily_new_words: 15 }, day: null, next_clip: null, current_puzzle_id: PID,
  replace_available: false, stop_reason: null, active_exchange: null, heard_check_questions: [Q], ...over,
})

beforeEach(() => { localStorage.clear(); resetHeardCheckMemory(); __resetHeardCheckFlowForTests() })

// Порт проверки шлюза checkHeardCheckAnswer (turmalin_getaway internal/routestate/events.go).
function gatewayCheck(e: RouteEvent): string | null {
  const re = /^hc:\d{4}-\d{2}-\d{2}:.+/
  if (e.type !== 'question_answered') return 'type'
  if (typeof e.question_id !== 'string' || !re.test(e.question_id)) return 'question_id'
  if (e.answer_outcome !== 'answered' && e.answer_outcome !== 'declined') return 'answer_outcome'
  if ('answer_value' in e) return 'answer_value'
  const shown = (e.shown ?? []) as string[]
  if (shown.length > 6 || new Set(shown).size !== shown.length || shown.some(w => w === '')) return 'shown'
  const marked = (e.marked ?? []) as string[]
  if (new Set(marked).size !== marked.length || marked.some(w => !shown.includes(w))) return 'marked'
  if (e.answer_outcome === 'declined' && marked.length > 0) return 'declined+marked'
  return null
}

describe('память: доли', () => {
  it('максимум только растёт, переживает «перезагрузку» (чтение из хранилища)', () => {
    noteHeardFrac(PID, 0.4)
    noteHeardFrac(PID, 0.7)
    noteHeardFrac(PID, 0.5)
    expect(maxHeardFrac(PID)).toBe(0.7)
    // «перезагрузка»: память модуля пуста, остался только localStorage
    const raw = localStorage.getItem(HEARD_FRAC_KEY)
    resetHeardCheckMemory()
    localStorage.setItem(HEARD_FRAC_KEY, raw!)
    expect(maxHeardFrac(PID)).toBe(0.7)
  })
  it('пересечение порога 0.6 и конец записываются сразу, мелкий рост — только в памяти, но виден', () => {
    noteHeardFrac(PID, 0.595)
    noteHeardFrac(PID, 0.601)
    expect(JSON.parse(localStorage.getItem(HEARD_FRAC_KEY)!).items[PID]).toBe(0.601)
    noteHeardFrac(PID, 0.605)
    expect(maxHeardFrac(PID)).toBe(0.605)
  })
  it('ограничен восемью, вытесняются самые старые; неизвестный и пустой id — 0', () => {
    for (let i = 0; i < HEARD_FRAC_MAX + 3; i++) noteHeardFrac(`p${i}`, 0.9)
    expect(Object.keys(JSON.parse(localStorage.getItem(HEARD_FRAC_KEY)!).items)).toHaveLength(HEARD_FRAC_MAX)
    expect(maxHeardFrac('p0')).toBe(0)
    expect(maxHeardFrac('')).toBe(0)
    expect(maxHeardFrac('nope')).toBe(0)
  })
  it('retainHeardFrac оставляет только активный ролик', () => {
    noteHeardFrac('a', 0.9); noteHeardFrac('b', 0.8)
    retainHeardFrac('b')
    expect(maxHeardFrac('a')).toBe(0)
    expect(maxHeardFrac('b')).toBe(0.8)
  })
  it('битое хранилище не роняет', () => {
    localStorage.setItem(HEARD_FRAC_KEY, '{oops')
    expect(maxHeardFrac(PID)).toBe(0)
    noteHeardFrac(PID, 0.9)
    expect(maxHeardFrac(PID)).toBe(0.9)
  })
})

describe('память: отправленные', () => {
  it('помнит последние 20, сброс и «Выход» стирают', () => {
    for (let i = 0; i < HEARD_SENT_MAX + 5; i++) noteHeardCheckSent(`hc:2026-11-18:p${i}`, RID)
    expect(JSON.parse(localStorage.getItem(HEARD_SENT_KEY)!)).toHaveLength(HEARD_SENT_MAX)
    expect(isHeardCheckSent('hc:2026-11-18:p0', RID)).toBe(false)
    expect(isHeardCheckSent(`hc:2026-11-18:p${HEARD_SENT_MAX + 4}`, RID)).toBe(true)
    resetHeardCheckMemory()
    expect(isHeardCheckSent(`hc:2026-11-18:p${HEARD_SENT_MAX + 4}`, RID)).toBe(false)
    noteHeardCheckSent('x', RID); noteHeardFrac('y', 0.9)
    eraseRouteStorage()
    expect(isHeardCheckSent('x', RID)).toBe(false)
    expect(maxHeardFrac('y')).toBe(0)
    expect(localStorage.getItem(HEARD_SENT_KEY)).toBeNull()
  })
})

describe('память: стирание в другой вкладке (LOW-2)', () => {
  it('ключ долей стёрт снаружи — старые доли из памяти модуля не оживают', () => {
    noteHeardFrac(PID, 0.9)
    expect(maxHeardFrac(PID)).toBe(0.9)
    localStorage.removeItem(HEARD_FRAC_KEY)
    expect(maxHeardFrac(PID)).toBe(0)
  })
  it('ключ отправленных стёрт снаружи — id забыты', () => {
    noteHeardCheckSent('hc:2026-11-18:x', RID)
    expect(isHeardCheckSent('hc:2026-11-18:x', RID)).toBe(true)
    localStorage.removeItem(HEARD_SENT_KEY)
    expect(isHeardCheckSent('hc:2026-11-18:x', RID)).toBe(false)
  })
  it('хранилище не пишется (setItem бросает) — живём на памяти, не сбрасываемся', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    try {
      noteHeardFrac(PID, 0.9); noteHeardCheckSent('hc:2026-11-18:y', RID)
      expect(maxHeardFrac(PID)).toBe(0.9)
      expect(isHeardCheckSent('hc:2026-11-18:y', RID)).toBe(true)
    } finally { spy.mockRestore() }
  })
})

describe('память: разбор JSON один раз (LOW-3)', () => {
  it('шаги времени без роста не разбирают JSON и не пишут в хранилище', () => {
    noteHeardFrac(PID, 0.9)
    const parse = vi.spyOn(JSON, 'parse')
    const set = vi.spyOn(Storage.prototype, 'setItem')
    try {
      for (let i = 0; i < 50; i++) noteHeardFrac(PID, 0.5)
      for (let i = 0; i < 50; i++) maxHeardFrac(PID)
      expect(parse).not.toHaveBeenCalled()
      expect(set).not.toHaveBeenCalled()
    } finally { parse.mockRestore(); set.mockRestore() }
  })
  it('чужая запись в хранилище (другая вкладка) подхватывается', () => {
    noteHeardFrac(PID, 0.5)
    localStorage.setItem(HEARD_FRAC_KEY, JSON.stringify({ v: 1, items: { [PID]: 0.8 } }))
    expect(maxHeardFrac(PID)).toBe(0.8)
  })
})

describe('память: отправленные привязаны к маршруту (LOW-4)', () => {
  it('тот же id вопроса в другом маршруте не считается отправленным', () => {
    noteHeardCheckSent(Q.id, RID)
    expect(isHeardCheckSent(Q.id, RID)).toBe(true)
    expect(isHeardCheckSent(Q.id, '22222222-2222-4222-8222-222222222222')).toBe(false)
  })
  it('старые записи без маршрута игнорируются и вытесняются; размер ≤ 20', () => {
    localStorage.setItem(HEARD_SENT_KEY, JSON.stringify([Q.id, 'hc:2026-11-18:old']))
    resetHeardCheckMemoryKeepStorage()
    expect(isHeardCheckSent(Q.id, RID)).toBe(false)
    noteHeardCheckSent(Q.id, RID)
    expect(JSON.parse(localStorage.getItem(HEARD_SENT_KEY)!)).toEqual([`${RID}|${Q.id}`])
  })
  it('runHeardCheck: после сброса маршрута (новый route_id) тот же вопрос спрашивается снова', async () => {
    noteHeardFrac(PID, 1)
    const d1 = deps().d
    expect(await runHeardCheck(state(), { deps: d1 })).toBe('sent')
    const d2 = deps().d
    expect(await runHeardCheck(state(), { deps: d2 })).toBe('none')
    expect(await runHeardCheck(state({ route_id: '33333333-3333-4333-8333-333333333333' }), { deps: d2 })).toBe('sent')
  })
})

describe('событие', () => {
  const day = '2026-11-18'
  it('answered: форма проходит проверку шлюза; marked ⊆ shown в порядке показа', () => {
    const ev = buildHeardCheckEvent(Q, { outcome: 'answered', marked: ['gamma', 'alpha', 'ghost'] }, day)
    expect(gatewayCheck(ev)).toBeNull()
    expect(ev).toMatchObject({ type: 'question_answered', puzzle_id: PID, question_id: Q.id, answer_outcome: 'answered', shown: ['alpha', 'beta', 'gamma'], marked: ['alpha', 'gamma'], learning_day: day })
    expect(ev.event_id).toMatch(/^web:/)
    expect(typeof ev.client_ts).toBe('string')
  })
  it('ноль отмеченных — answered без marked', () => {
    const ev = buildHeardCheckEvent(Q, { outcome: 'answered', marked: [] }, day)
    expect(gatewayCheck(ev)).toBeNull()
    expect('marked' in ev).toBe(false)
    expect(ev.answer_outcome).toBe('answered')
  })
  it('declined: без marked', () => {
    const ev = buildHeardCheckEvent(Q, { outcome: 'declined' }, day)
    expect(gatewayCheck(ev)).toBeNull()
    expect(ev.answer_outcome).toBe('declined')
    expect('marked' in ev).toBe(false)
  })
  it('shown: ≤ 6, без пустых и повторов', () => {
    const q = { ...Q, words: ['a', '', 'b', 'a', 'c', 'd', 'e', 'f', 'g'] }
    expect(shownWords(q)).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
    expect(gatewayCheck(buildHeardCheckEvent(q, { outcome: 'answered', marked: ['a', 'g'] }, day))).toBeNull()
  })
  it('heardQuestionFor: активный ролик, род, слова (E6)', () => {
    expect(heardQuestionFor([Q], PID)).toBe(Q)
    expect(heardQuestionFor([Q], 'other')).toBeNull()
    expect(heardQuestionFor([{ ...Q, kind: 'other' }], PID)).toBeNull()
    expect(heardQuestionFor([{ ...Q, words: [] }], PID)).toBeNull()
    expect(heardQuestionFor(undefined, PID)).toBeNull()
    expect(heardQuestionFor([Q], null)).toBeNull()
  })
})

// --- решение и порядок --------------------------------------------------------

function deps(over: Partial<HeardCheckDeps> = {}) {
  const log: string[] = []
  const events: RouteEvent[] = []
  const d: HeardCheckDeps = {
    ask: vi.fn(async (): Promise<HeardOutcome> => ({ outcome: 'answered', marked: ['alpha'] })),
    outbox: {
      isClosed: () => false,
      enqueueDurable: vi.fn(async (_r: string, e: RouteEvent) => { log.push('enqueue'); events.push(e) }),
      flush: vi.fn(async () => { log.push('flush'); return 'sent' as const }),
    },
    now: () => new Date('2026-11-18T12:00:00Z'),
    flushTimeoutMs: 5000,
    ...over,
  }
  return { d, log, events }
}

describe('runHeardCheck', () => {
  it('порог 0.6 по сохранённому максимуму: ниже — теста нет, кнопка как раньше', async () => {
    noteHeardFrac(PID, 0.59)
    const { d, log } = deps()
    expect(await runHeardCheck(state(), { deps: d })).toBe('none')
    expect(d.ask).not.toHaveBeenCalled()
    expect(log).toEqual([])
  })
  it('≥ 0.6: показ → постановка → выгрузка (в этом порядке); память отправленных', async () => {
    noteHeardFrac(PID, 0.6)
    const { d, log, events } = deps()
    const beforeShow = vi.fn(() => { log.push('pause') })
    expect(await runHeardCheck(state(), { deps: d, beforeShow })).toBe('sent')
    expect(log).toEqual(['pause', 'enqueue', 'flush'])
    expect(events).toHaveLength(1)
    expect(isHeardCheckSent(Q.id, RID)).toBe(true)
    // повторный вход: тот же вопрос ещё в состоянии — второй раз не спрашиваем
    expect(await runHeardCheck(state(), { deps: d })).toBe('none')
    expect(d.ask).toHaveBeenCalledTimes(1)
  })
  it('нет вопроса / другой ролик / нет route_id — теста нет', async () => {
    noteHeardFrac(PID, 1)
    const { d } = deps()
    expect(await runHeardCheck(state({ heard_check_questions: [] }), { deps: d })).toBe('none')
    expect(await runHeardCheck(state({ heard_check_questions: undefined }), { deps: d })).toBe('none')
    expect(await runHeardCheck(state({ current_puzzle_id: 'youtube::zzzzzzzzzzz' }), { deps: d })).toBe('none')
    expect(await runHeardCheck(state({ route_id: null }), { deps: d })).toBe('none')
    expect(await runHeardCheck(null, { deps: d })).toBe('none')
    expect(d.ask).not.toHaveBeenCalled()
  })
  it('закрыто без ответа (уход) — НИЧЕГО не отправлено, память не тронута (E4)', async () => {
    noteHeardFrac(PID, 1)
    const { d, log } = deps({ ask: vi.fn(async (): Promise<HeardOutcome> => 'abandoned') })
    expect(await runHeardCheck(state(), { deps: d })).toBe('abandoned')
    expect(log).toEqual([])
    expect(isHeardCheckSent(Q.id, RID)).toBe(false)
  })
  it('«Пропустить» шлёт declined', async () => {
    noteHeardFrac(PID, 1)
    const { d, events } = deps({ ask: vi.fn(async (): Promise<HeardOutcome> => ({ outcome: 'declined' })) })
    expect(await runHeardCheck(state(), { deps: d })).toBe('sent')
    expect(events[0].answer_outcome).toBe('declined')
  })
  it('сбой постановки: не блокируем, id не запоминаем (спросим ещё раз)', async () => {
    noteHeardFrac(PID, 1)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { d } = deps()
    ;(d.outbox.enqueueDurable as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'))
    expect(await runHeardCheck(state(), { deps: d })).toBe('send_failed')
    expect(isHeardCheckSent(Q.id, RID)).toBe(false)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
  it('очередь закрыта «Выходом» — теста нет; закрыта во время постановки — send_failed без записи id', async () => {
    noteHeardFrac(PID, 1)
    expect(await runHeardCheck(state(), { deps: deps({ outbox: { isClosed: () => true, enqueueDurable: vi.fn(), flush: vi.fn() } }).d })).toBe('none')
    let closed = false
    const { d } = deps({ outbox: { isClosed: () => closed, enqueueDurable: vi.fn(async () => { closed = true }), flush: vi.fn() } })
    expect(await runHeardCheck(state(), { deps: d })).toBe('send_failed')
    expect(isHeardCheckSent(Q.id, RID)).toBe(false)
  })
  it('один тест за раз: второй вход ждёт первый и сам не спрашивает (E5)', async () => {
    noteHeardFrac(PID, 1)
    let release!: (v: { outcome: 'declined' }) => void
    const { d, events } = deps({ ask: vi.fn(() => new Promise(r => { release = r as typeof release })) as HeardCheckDeps['ask'] })
    const first = runHeardCheck(state(), { deps: d })
    const second = runHeardCheck(state(), { deps: d })
    let secondDone = false
    void second.then(() => { secondDone = true })
    await Promise.resolve(); await Promise.resolve()
    expect(secondDone).toBe(false)
    release({ outcome: 'declined' })
    expect(await first).toBe('sent')
    expect(await second).toBe('sent')
    expect(d.ask).toHaveBeenCalledTimes(1)
    expect(events).toHaveLength(1)
  })
  it('LOW-1: ждущий второй вход получает итог первого — abandoned не превращается в none', async () => {
    noteHeardFrac(PID, 1)
    const { d } = deps({ ask: vi.fn(async () => 'abandoned' as const) as HeardCheckDeps['ask'] })
    const first = runHeardCheck(state(), { deps: d })
    const second = runHeardCheck(state(), { deps: d })
    expect(await first).toBe('abandoned')
    expect(await second).toBe('abandoned')
  })
  it('LOW-1: первый вход упал — ждущий не бросает, получает none', async () => {
    noteHeardFrac(PID, 1)
    const { d } = deps({ ask: vi.fn(async () => { throw new Error('boom') }) as HeardCheckDeps['ask'] })
    const first = runHeardCheck(state(), { deps: d })
    const second = runHeardCheck(state(), { deps: d })
    await expect(first).rejects.toThrow('boom')
    expect(await second).toBe('none')
  })
})
