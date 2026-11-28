// PlayerPage.transport.test.tsx [ID:P-hybrid] — ДЕШЁВЫЙ ВРЕМЕННЫЙ гибрид:
// дефолт остаётся iframe; клик «Смотреть через flib-плеер (бета)» в
// UnplayableOverlay переключает транспорт на native И ремаунтит плеер
// (createNativeVideoAdapter вместо createIFrameAdapter); выбор персистится в
// sessionStorage на остаток сессии; ?transport=native форсит native с
// первого монтажа (ручной тест, владелец п.3). Тот же мок-паттерн, что
// PlayerPage.unplayable.regression.test.tsx — фейковые адаптеры вместо
// реального YouTube IFrame API / <video>.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { PlayerPage } from '../PlayerPage'
import { TRANSPORT_STORAGE_KEY } from '../../player/video-transport'

const adapters = vi.hoisted(() => ({
  iframe: null as any,
  native: null as any,
  iframeCreateCalls: 0,
  nativeCreateCalls: 0,
}))

vi.mock('../../adapter/IFrameAdapter', () => ({
  createIFrameAdapter: async () => {
    const { makeFakeAdapter } = await import('../../adapter/__tests__/fake')
    adapters.iframeCreateCalls++
    adapters.iframe = makeFakeAdapter({ duration: 120, t: 1 })
    return adapters.iframe
  },
}))

vi.mock('../../adapter/NativeVideoAdapter', () => ({
  createNativeVideoAdapter: async () => {
    const { makeFakeAdapter } = await import('../../adapter/__tests__/fake')
    adapters.nativeCreateCalls++
    adapters.native = makeFakeAdapter({ duration: 90, t: 0 })
    return adapters.native
  },
}))

function stubFetch(videoProbeStatus: number) {
  vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
    if (typeof url === 'string' && url.startsWith('/api/video/')) {
      return Promise.resolve({ ok: videoProbeStatus < 400, status: videoProbeStatus })
    }
    return Promise.resolve({ ok: false, status: 404, json: async () => ({}), text: async () => '' })
  }))
}

beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  adapters.iframe = null
  adapters.native = null
  adapters.iframeCreateCalls = 0
  adapters.nativeCreateCalls = 0
})
afterEach(() => vi.unstubAllGlobals())

function renderPlayer(entry = '/player?v=abcdefghijk') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes><Route path="/player" element={<PlayerPage />} /></Routes>
    </MemoryRouter>,
  )
}

describe('PlayerPage — transport switch [ID:P-hybrid]', () => {
  it('дефолт: монтируется на iframe-транспорте (createIFrameAdapter, НЕ native)', async () => {
    stubFetch(404)
    renderPlayer()
    await waitFor(() => expect(adapters.iframe).toBeTruthy())
    expect(adapters.nativeCreateCalls).toBe(0)
  })

  it('клик "Смотреть через flib-плеер (бета)" переключает транспорт → ремаунт на native', async () => {
    stubFetch(200) // зонд /api/video/{id} доступен → кнопка появится
    renderPlayer()
    await waitFor(() => expect(adapters.iframe).toBeTruthy())

    act(() => { adapters.iframe._emit('unplayable', { reason: 'botwall-suspect' }) })
    const btn = await screen.findByRole('button', { name: /flib-плеер/ })
    act(() => { btn.click() })

    await waitFor(() => expect(adapters.nativeCreateCalls).toBe(1))
    expect(adapters.native).toBeTruthy()
    // Старый iframe-адаптер разрушен ремаунтом (PlayerRoot key сменился —
    // remountNonce++, см. PlayerPage.tsx switchToNative).
    expect(adapters.iframeCreateCalls).toBe(1) // не создавался повторно
  })

  it('sessionStorage: персистентный выбор ЭТОЙ сессии открывает СЛЕДУЮЩИЙ шаг сразу нативно', async () => {
    window.sessionStorage.setItem(TRANSPORT_STORAGE_KEY, 'native')
    stubFetch(200)
    renderPlayer()
    await waitFor(() => expect(adapters.native).toBeTruthy())
    expect(adapters.iframeCreateCalls).toBe(0)
  })

  it('?transport=native форсит native-транспорт с первого монтажа (ручной тест)', async () => {
    stubFetch(200)
    renderPlayer('/player?v=abcdefghijk&transport=native')
    await waitFor(() => expect(adapters.native).toBeTruthy())
    expect(adapters.iframeCreateCalls).toBe(0)
  })

  // Аудит MED-3/5b [ID:P-hybrid-audit]: ?transport=iframe перекрывает
  // персистентный native И чистит sessionStorage — принудительный откат.
  it('?transport=iframe перекрывает sessionStorage-native и снимает залипание', async () => {
    window.sessionStorage.setItem(TRANSPORT_STORAGE_KEY, 'native')
    stubFetch(200)
    renderPlayer('/player?v=abcdefghijk&transport=iframe')
    await waitFor(() => expect(adapters.iframe).toBeTruthy())
    expect(adapters.nativeCreateCalls).toBe(0)
    expect(window.sessionStorage.getItem(TRANSPORT_STORAGE_KEY)).toBeNull()
  })

  // Аудит MED-3/5b [ID:P-hybrid-audit]: native-error → «Вернуться на
  // YouTube-плеер» → remount на iframe + sessionStorage очищен (следующий
  // шаг маршрута откроется iframe'ом, а не снова сломанным native).
  it('native-error: кнопка возврата ремаунтит на iframe и чистит sessionStorage', async () => {
    window.sessionStorage.setItem(TRANSPORT_STORAGE_KEY, 'native')
    stubFetch(200)
    renderPlayer()
    await waitFor(() => expect(adapters.native).toBeTruthy())
    expect(adapters.iframeCreateCalls).toBe(0)

    act(() => { adapters.native._emit('unplayable', { reason: 'native-error' }) })
    const btn = await screen.findByRole('button', { name: /Вернуться на YouTube-плеер/ })
    act(() => { btn.click() })

    await waitFor(() => expect(adapters.iframeCreateCalls).toBe(1))
    expect(window.sessionStorage.getItem(TRANSPORT_STORAGE_KEY)).toBeNull()
    expect(adapters.nativeCreateCalls).toBe(1) // native не пересоздавался
  })
})
