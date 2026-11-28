// shadow-gate.test.tsx — Э6-гейт пилюли «Шадоуинг»: интеграционное покрытие,
// которого требовал независимый аудит (HIGH: 10 посевов flib:access в тестах
// заставили существующие сценарии проходить СКВОЗЬ гейт, но ни один тест не
// проверял сам гейт — ни запертый старт, ни, главное, НЕзапертый стоп).
//
// Правило гейта (аудит Э6, CRIT-фикс): гейтится ТОЛЬКО старт. При активной
// сессии пилюля — это «Стоп», и она обязана работать даже если доступ отозван
// посреди записи (логаут в другой вкладке): иначе пользователь заперт в идущей
// записи с открытым микрофоном и тикающими токенами.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, act } from '@testing-library/react'
import { WorkspacePanel } from '../WorkspacePanel'
import { makeFakeAdapter } from '../../../adapter/__tests__/fake'
import { __resetSessionForTests, __setSessionForTests, refreshSession } from '../../../site/session'

function makeWs() {
  return {
    rangeStart: 0, rangeEnd: 0, looping: false, pauseAtEnd: 0, viewStart: 0, viewEnd: 60,
    setABLoop() {}, toggleABLoop() {}, onUserSeek() {}, setPauseAtEnd() {}, stopLoop() {},
    setView() {}, zoom() {}, fitToRange() {}, setRange() {}, _boundaryTickForTest() {}, countdownValue: null,
  } as any
}

function renderPanel(opts: { shadowActive: boolean; onToggleShadow: () => void }) {
  const adapter = makeFakeAdapter({ duration: 100, t: 0 })
  return render(
    <WorkspacePanel ws={makeWs()} cues={[]} adapter={adapter} activeIndex={-1} waveform={null}
      variant="refined" currentTime={0} playing={false} muted={false}
      shadowActive={opts.shadowActive} onToggleShadow={opts.onToggleShadow}
    />
  )
}

describe('Шадоуинг-пилюля — Э6 гейт (только старт, никогда — стоп)', () => {
  beforeEach(() => {
    window.localStorage.clear() // дефолт = доступа НЕТ (default-deny)
  })

  it('без доступа и БЕЗ активной сессии: пилюля disabled+🔒, клик не долетает', () => {
    const onToggleShadow = vi.fn()
    const { getByTitle } = renderPanel({ shadowActive: false, onToggleShadow })
    const pill = getByTitle('Для выполнения упражнения Shadowing нужно ввести ключ на главной странице. Нажмите «Войти» и введите свой ключ.') as HTMLButtonElement
    expect(pill.disabled).toBe(true)
    expect(pill.textContent).toContain('🔒')
    fireEvent.click(pill)
    expect(onToggleShadow).not.toHaveBeenCalled()
  })

  it('доступ отозван ПРИ АКТИВНОЙ сессии: пилюля остаётся живым «Стоп» (CRIT-регрессия)', () => {
    const onToggleShadow = vi.fn()
    const { getByTitle } = renderPanel({ shadowActive: true, onToggleShadow })
    const pill = getByTitle('Стоп Шадоуинг') as HTMLButtonElement
    expect(pill.disabled).toBe(false)
    expect(pill.textContent).not.toContain('🔒')
    fireEvent.click(pill)
    expect(onToggleShadow).toHaveBeenCalledTimes(1)
  })

  it('с доступом: пилюля — обычный «Старт», кликается', () => {
    window.localStorage.setItem('flib:access', JSON.stringify({ shadowing: true, keyPrefix: 'tpk_test', checkedAt: new Date().toISOString() }))
    const onToggleShadow = vi.fn()
    const { getByTitle } = renderPanel({ shadowActive: false, onToggleShadow })
    const pill = getByTitle('Старт Шадоуинг') as HTMLButtonElement
    expect(pill.disabled).toBe(false)
    fireEvent.click(pill)
    expect(onToggleShadow).toHaveBeenCalledTimes(1)
  })

  // Кабинет включён (метка BFF): подсказка запертой пилюли — по сессии, а не
  // «введите ключ на главной» (на главной кабинета ключ не вводят).
  describe('подсказка при включённом кабинете', () => {
    function withMark(fn: () => Promise<void> | void) {
      return async () => {
        const m = document.createElement('meta')
        m.name = 'flib-cabinet'
        m.content = '1'
        document.head.appendChild(m)
        __resetSessionForTests()
        try { await fn() } finally {
          m.remove()
          __resetSessionForTests()
        }
      }
    }

    it('активная сессия без Shadowing — «Shadowing не входит в Ваш ключ.»', withMark(() => {
      __setSessionForTests({ authenticated: true, state: 'active', cabinet: true, shadowing: false })
      const { getByTitle } = renderPanel({ shadowActive: false, onToggleShadow: vi.fn() })
      const pill = getByTitle('Shadowing не входит в Ваш ключ.') as HTMLButtonElement
      expect(pill.disabled).toBe(true)
      expect(pill.textContent).toContain('🔒')
    }))

    it('вошёл, шлюз недоступен — «Не удалось проверить доступ. Попробуйте позже.»', withMark(() => {
      __setSessionForTests({ authenticated: true, state: 'unknown', cabinet: true })
      const { getByTitle } = renderPanel({ shadowActive: false, onToggleShadow: vi.fn() })
      expect((getByTitle('Не удалось проверить доступ. Попробуйте позже.') as HTMLButtonElement).disabled).toBe(true)
    }))

    it('не вошёл — «Войдите по ключу, чтобы открыть Shadowing.»', withMark(() => {
      __setSessionForTests({ authenticated: false, cabinet: true })
      const { getByTitle } = renderPanel({ shadowActive: false, onToggleShadow: vi.fn() })
      expect((getByTitle('Войдите по ключу, чтобы открыть Shadowing.') as HTMLButtonElement).disabled).toBe(true)
    }))
  })

  // Ревью A5–A8 M-2 (мутант W01): снимок сессии кабинета приходит ПОСЛЕ первого
  // рендера плеера; без подписки пилюля осталась бы запертой у перенесённого
  // пользователя (ключа в flib:access уже нет).
  it('снимок активной сессии пришёл после рендера — пилюля открывается без перезагрузки', async () => {
    __resetSessionForTests()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      authenticated: true, state: 'active', cabinet: true, key_prefix: 'tpk_aaaa', demo: false, key_expires_at: null, shadowing: true, route_allowed: true,
    }), { status: 200 })))
    const { getByTitle, queryByTitle } = renderPanel({ shadowActive: false, onToggleShadow: vi.fn() })
    expect(queryByTitle('Старт Шадоуинг')).toBeNull()
    await act(async () => { await refreshSession() })
    expect((getByTitle('Старт Шадоуинг') as HTMLButtonElement).disabled).toBe(false)
    vi.unstubAllGlobals()
    __resetSessionForTests()
  })
})
