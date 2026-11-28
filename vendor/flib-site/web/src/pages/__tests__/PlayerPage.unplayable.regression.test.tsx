// PlayerPage.unplayable.regression.test.tsx — ДОКАЗАТЕЛЬСТВО прод-регрессии
// PR#32 (вопрос владельца «по коду видел или доказал?»): оверлей бот-стены,
// показанный по 'unplayable', обязан ИСЧЕЗНУТЬ, если видео всё-таки заиграло
// (state='playing'). На коде до fix/botwall-false-positive этот тест ПАДАЕТ
// (оверлей висит поверх играющего видео до смены ролика — то, что телефонный
// Chrome друга владельца читал как «YouTube требует регистрацию»).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { PlayerPage } from '../PlayerPage'

const mockAdapterHolder = vi.hoisted(() => ({ adapter: null as any }))

vi.mock('../../adapter/IFrameAdapter', () => ({
  createIFrameAdapter: async () => {
    const { makeFakeAdapter } = await import('../../adapter/__tests__/fake')
    mockAdapterHolder.adapter = makeFakeAdapter({ duration: 120, t: 1 })
    return mockAdapterHolder.adapter
  },
}))

// Сеть (субтитры/волна) — тишина, не предмет теста.
beforeEach(() => {
  window.localStorage.clear()
  mockAdapterHolder.adapter = null
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: false, status: 404, json: async () => ({}), text: async () => '',
  }))
})
afterEach(() => vi.unstubAllGlobals())

function renderPlayer() {
  return render(
    <MemoryRouter initialEntries={['/player?v=abcdefghijk']}>
      <Routes><Route path="/player" element={<PlayerPage />} /></Routes>
    </MemoryRouter>,
  )
}

describe('unplayable-оверлей × заигравшее видео (прод-регрессия PR#32)', () => {
  it('оверлей показан по unplayable и СКРЫВАЕТСЯ, когда приходит state=playing', async () => {
    renderPlayer()
    await waitFor(() => expect(mockAdapterHolder.adapter).toBeTruthy())

    act(() => { mockAdapterHolder.adapter._emit('unplayable', { reason: 'botwall-suspect' }) })
    expect(await screen.findByTestId('unplayable-overlay')).toBeTruthy()

    // Видео всё-таки пошло (медленный мобильный старт) — оверлей обязан уйти.
    act(() => { mockAdapterHolder.adapter._emit('state', 'playing') })
    await waitFor(() => expect(screen.queryByTestId('unplayable-overlay')).toBeNull())
  })

  it('пока playing не пришёл — оверлей остаётся (нет самопроизвольного скрытия)', async () => {
    renderPlayer()
    await waitFor(() => expect(mockAdapterHolder.adapter).toBeTruthy())
    act(() => { mockAdapterHolder.adapter._emit('unplayable', { reason: 'botwall-suspect' }) })
    expect(await screen.findByTestId('unplayable-overlay')).toBeTruthy()
    act(() => { mockAdapterHolder.adapter._emit('state', 'buffering') })
    expect(screen.queryByTestId('unplayable-overlay')).toBeTruthy()
  })
})
