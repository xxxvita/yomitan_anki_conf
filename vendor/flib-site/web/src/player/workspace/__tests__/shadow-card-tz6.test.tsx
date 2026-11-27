// shadow-card-tz6.test.tsx — ТЗ №6 пункты 3 и 7 (раскладка карты Shadowing):
//   п.3 — ПРИВЯЗКА прижата к низу карты ВСЕГДА: при пустой ленте панель раньше
//         болталась в центре/сверху. Feed-плейсхолдер тянется (flex:1) → bind-row
//         анкор к низу.
//   п.7 — inset (docked): «подвал» ПРИВЯЗКА скрыт, окно повтора (лента) забирает
//         высоту — пользователь ОБЯЗАН видеть B1.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { useEffect } from 'react'
import { render } from '@testing-library/react'
import { ShadowCard } from '../ShadowCardLifted'
import { useVideoPlayerStore } from '../video-player-store'
import type { ShadowV1Api } from '../../hooks/useShadowV1'

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

function DockSetter({ dock }: { dock: 'left' | 'right' | null }) {
  const set = useVideoPlayerStore(s => s.setShadowChatDock)
  useEffect(() => { set(dock) }, [dock, set])
  return null
}

afterEach(() => {
  const { unmount } = render(<DockSetter dock={null} />); unmount()
  localStorage.removeItem('videoPlayer.shadowChatDock')
})

describe('ТЗ №6 п.3 — ПРИВЯЗКА анкор к низу карты [ID:P-tz6]', () => {
  it('пустая лента → feed-плейсхолдер тянется (flex:1), ПРИВЯЗКА уходит вниз', () => {
    const { getByTestId } = render(<ShadowCard shadow={mkShadow()} handsFree />)
    const empty = getByTestId('shadow-feed-empty')
    // Растягивающийся плейсхолдер съедает свободную высоту → bind-row прижат к низу.
    expect(empty.style.flexGrow || empty.style.flex).toContain('1')
    // bind-row — ПОСЛЕДНИЙ ребёнок внутреннего flex-column-контейнера.
    const bindRow = getByTestId('shadow-bind-row')
    expect(bindRow.parentElement?.lastElementChild).toBe(bindRow)
  })

  it('непустая лента → feed(flex:1) тянется, ПРИВЯЗКА тоже внизу', () => {
    const { getByTestId } = render(
      <ShadowCard shadow={mkShadow({ shadowAttempts: { '0': { attempts: [{ match_pct: 50 }] } } })} handsFree />,
    )
    const feed = getByTestId('shadow-feed')
    expect(feed.style.flex).toContain('1')
    const bindRow = getByTestId('shadow-bind-row')
    expect(bindRow.parentElement?.lastElementChild).toBe(bindRow)
  })
})

describe('ТЗ №6 п.7 — docked прячет ПРИВЯЗКУ, высота ленте [ID:P-tz6]', () => {
  it('undocked → ПРИВЯЗКА видна', () => {
    const { getByTestId } = render(<ShadowCard shadow={mkShadow()} handsFree />)
    expect(getByTestId('shadow-bind-row')).toBeTruthy()
  })

  it('docked (left) → ПРИВЯЗКА (bind-row) скрыта, лента остаётся', () => {
    const { queryByTestId, getByTestId } = render(
      <><DockSetter dock="left" /><ShadowCard shadow={mkShadow({ shadowAttempts: { '0': { attempts: [{ match_pct: 50 }] } } })} handsFree /></>,
    )
    expect(queryByTestId('shadow-bind-row')).toBeNull()
    expect(getByTestId('shadow-feed')).toBeTruthy()
  })

  it('docked (right) → ПРИВЯЗКА скрыта', () => {
    const { queryByTestId } = render(
      <><DockSetter dock="right" /><ShadowCard shadow={mkShadow({ shadowAttempts: { '0': { attempts: [{ match_pct: 50 }] } } })} handsFree /></>,
    )
    expect(queryByTestId('shadow-bind-row')).toBeNull()
  })
})
