// shadow-card-feed.test.tsx — ТЗ №3 п.2/п.3: zero-scroll attempts feed. The feed
// container's measured height (mocked here — jsdom runs no layout) drives how
// many history one-liners render vs. collapse into "+K ранних". This is the
// component-level mutation gate for "убери вычисление N → скролл-тест red".
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render } from '@testing-library/react'
import { ShadowCard } from '../ShadowCardLifted'
import type { ShadowV1Api } from '../../hooks/useShadowV1'
import { setLocale } from '../../i18n'

afterEach(() => { vi.restoreAllMocks(); setLocale('ru') })

function mkShadow(overrides: Partial<ShadowV1Api> = {}): ShadowV1Api {
  return {
    active: true, phase: 'idle', errorCode: null, remainingSec: 60,
    referenceText: 'hello world', cueIndex: 0, lastMarks: null, lastMatchPct: null,
    lastSpoken: null, capped: false, recordAudioUrl: null, analyserNode: null,
    shadowAttempts: {}, recordings: [],
    activate: vi.fn(), deactivate: vi.fn(), toggle: vi.fn(),
    startRecording: vi.fn(async () => {}), stopRecording: vi.fn(),
    dismissResult: vi.fn(), selectRecording: vi.fn(), deleteRecording: vi.fn(),
    ...overrides,
  }
}

// 10 scored history attempts on cue 0, each carrying a heard `text`.
const tenAttempts = {
  '0': { attempts: Array.from({ length: 10 }, (_, i) => ({ match_pct: 50 + i, text: `try ${i + 1}` })) },
}

describe('ТЗ №3 п.2 — zero-scroll feed (N computed from measured height)', () => {
  it('unmeasured (jsdom height 0) → shows ALL history, no "+K" (never a premature collapse)', () => {
    const { getAllByTestId, queryByTestId } = render(<ShadowCard shadow={mkShadow({ shadowAttempts: tenAttempts })} />)
    expect(getAllByTestId('shadow-history-row')).toHaveLength(10)
    expect(queryByTestId('shadow-feed-more')).toBeNull()
  })

  it('small measured height → only N-1 rows render, the rest collapse into "+K ранних", NO scroll', () => {
    // Feed measures 120px; FEED_ROW_H=26 → 4 slots; 10 rows > 4 → show 3, +7.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      { width: 400, height: 120, top: 0, left: 0, right: 400, bottom: 120, x: 0, y: 0, toJSON: () => {} } as DOMRect,
    )
    const { getAllByTestId, getByTestId } = render(<ShadowCard shadow={mkShadow({ shadowAttempts: tenAttempts })} />)
    expect(getAllByTestId('shadow-history-row')).toHaveLength(3)
    expect(getByTestId('shadow-feed-more').textContent).toBe('+7 ранних')
    // No scrollbar — the container clips, the "+K" collapse replaces scrolling.
    expect(getByTestId('shadow-feed').style.overflowY).toBe('hidden')
  })

  it('newest-first: the visible rows are the most recent attempts', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      { width: 400, height: 120, top: 0, left: 0, right: 400, bottom: 120, x: 0, y: 0, toJSON: () => {} } as DOMRect,
    )
    const { getAllByTestId } = render(<ShadowCard shadow={mkShadow({ shadowAttempts: tenAttempts })} />)
    const rows = getAllByTestId('shadow-history-row')
    expect(rows[0].textContent).toContain('повтор 10')
    expect(rows[0].textContent).toContain('try 10')
    expect(rows[2].textContent).toContain('повтор 8')
  })
})

describe('HIGH-1 — feed measurement re-attaches when the feed APPEARS (not only at mount)', () => {
  it('mount empty → later arm with 10 attempts at a 120px budget → 3 rows + "+7 ранних"', () => {
    // The feed element exists only while there ARE attempts. The prior
    // useLayoutEffect(…, []) measured once at mount, when the feed was still
    // absent (el===null → early return) → feedH stayed +Infinity → all 10 rows.
    // A callback ref must measure the feed the instant it mounts on the arm.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      { width: 400, height: 120, top: 0, left: 0, right: 400, bottom: 120, x: 0, y: 0, toJSON: () => {} } as DOMRect,
    )
    const { rerender, getAllByTestId, getByTestId, queryByTestId } = render(<ShadowCard shadow={mkShadow()} />)
    expect(queryByTestId('shadow-feed')).toBeNull() // no attempts → no feed element yet
    rerender(<ShadowCard shadow={mkShadow({ shadowAttempts: tenAttempts })} />)
    expect(getAllByTestId('shadow-history-row')).toHaveLength(3)
    expect(getByTestId('shadow-feed-more').textContent).toBe('+7 ранних')
  })
})

describe('MED-10 — the latest B1 block height is MEASURED, not a fixed FEED_LATEST_H', () => {
  it('a tall measured latest block reserves more space → fewer rows than the 84px constant would', () => {
    // feed container 300px; the latest B1 block measures 200px (long reply/wrap).
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const height = this.dataset.testid === 'shadow-diff' ? 200 : 300
      return { width: 400, height, top: 0, left: 0, right: 400, bottom: height, x: 0, y: 0, toJSON: () => {} } as DOMRect
    })
    // 7 scored attempts + a latest (lastMarks) → historyScored = 6 one-liners.
    const shadow = mkShadow({
      shadowAttempts: { '0': { attempts: Array.from({ length: 7 }, (_, i) => ({ match_pct: 50, text: `t${i}` })) } },
      lastMarks: [{ w: 'hello', kind: 'ok' }, { w: 'world', kind: 'ok' }],
      lastMatchPct: 90, lastSpoken: 'hello world',
    })
    const { getAllByTestId, getByTestId } = render(<ShadowCard shadow={shadow} />)
    // usable = 300 - 200 = 100; rowH 26 → 3 slots; 6 > 3 → show 2, collapse 4.
    // (With the old fixed 84: usable=216 → 8 slots ≥ 6 → all 6, no "+K" — the
    //  mutation gate for reverting latestReservedH to FEED_LATEST_H.)
    expect(getAllByTestId('shadow-history-row')).toHaveLength(2)
    expect(getByTestId('shadow-feed-more').textContent).toBe('+4 ранних')
  })
})

// ТЗ №5 п.3 — карта читает бакет попыток СТРОГО по shadow.cueIndex. PlayerPage
// теперь подаёт сюда armCueIndex (cue на момент арма — тот же, куда пишет
// аккумулятор), а НЕ activeIndex. Этот тест фиксирует контракт: строки берутся
// из bucket[String(cueIndex)] и «повтор N» нумеруется по НЕМУ. Мутационный
// сентинел для регресса «карта читала activeIndex → чужой/пустой бакет».
describe('ТЗ №5 п.3 — feed keyed strictly by shadow.cueIndex (armCue bucket)', () => {
  it('cueIndex=0: показывает бакет "0" (все попытки рана), «повтор N» монотонна', () => {
    const shadow = mkShadow({
      cueIndex: 0,
      shadowAttempts: { '0': { attempts: Array.from({ length: 4 }, (_, i) => ({ match_pct: 40 + i, text: `t${i}` })) } },
    })
    const { getAllByTestId } = render(<ShadowCard shadow={shadow} />)
    const rows = getAllByTestId('shadow-history-row')
    expect(rows).toHaveLength(4) // весь бакет виден (unmeasured height → show all)
    // newest-first: верхняя строка = повтор 4, нижняя = повтор 1 (монотонно).
    expect(rows[0].textContent).toContain('повтор 4')
    expect(rows[3].textContent).toContain('повтор 1')
  })

  it('cueIndex указывает на бакет, куда реально писались попытки — НЕ на пустой сосед', () => {
    // Попытки лежат в бакете "0" (armCue). Если карта читала бы activeIndex=1
    // (playhead ушёл в след. cue), лента была бы ПУСТА («строки пропали»). При
    // cueIndex=0 (armCue) — 3 строки видны.
    const attempts = { '0': { attempts: [{ match_pct: 50, text: 'a' }, { match_pct: 60, text: 'b' }, { match_pct: 70, text: 'c' }] } }
    const empty = render(<ShadowCard shadow={mkShadow({ cueIndex: 1, shadowAttempts: attempts })} />)
    expect(empty.queryAllByTestId('shadow-history-row')).toHaveLength(0) // чужой бакет "1" пуст
    empty.unmount()
    const armed = render(<ShadowCard shadow={mkShadow({ cueIndex: 0, shadowAttempts: attempts })} />)
    expect(armed.getAllByTestId('shadow-history-row')).toHaveLength(3) // armCue-бакет "0" виден
  })
})

describe('ТЗ №3 п.3 — history one-liner carries heard text with ellipsis', () => {
  it('renders "повтор N · % · услышано: {text}" and ellipsis-clips the text span', () => {
    const long = 'a very long transcript that would overflow the narrow card horizontally without an ellipsis clip'
    const { getByTestId } = render(<ShadowCard shadow={mkShadow({
      shadowAttempts: { '0': { attempts: [{ match_pct: 72, text: long }] } },
    })} />)
    const row = getByTestId('shadow-history-row')
    expect(row.textContent).toContain('повтор 1')
    expect(row.textContent).toContain('72%')
    expect(row.textContent).toContain('услышано')
    expect(row.textContent).toContain(long)
    // The row itself never scrolls horizontally (nowrap + hidden overflow).
    expect(row.style.overflow).toBe('hidden')
    expect(row.style.whiteSpace).toBe('nowrap')
  })
})
