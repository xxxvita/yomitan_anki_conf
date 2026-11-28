// UnplayableOverlay.test.tsx [ID:P-unplayable] — покрываем: null-guards (нет
// payload/videoId), тексты по embed-error коду (100 vs 101/150 vs
// прочие/2/5), «Открыть в YouTube» ссылка (href/target/rel), «Пропустить
// шаг» рендерится только при наличии route_step в URL и делает тот же
// переход, что RouteStepBar (advanceRouteStep), botwall-suspect layout
// (пояснение + 4 кнопки + retry вызывает onRetry), «✕ скрыть» прячет
// оверлей до следующего (нового объекта) payload, телеметрия — один POST
// verdict=unplayable за появление, ошибки сети/не-2xx глотаются.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { UnplayableOverlay, pickBrowserRecipe } from '../UnplayableOverlay'
import { saveRoute, loadRoute, type RouteState, type RouteStep } from '../../../site/route-state'
import type { UnplayablePayload } from '../../../adapter/PlayerAdapter'

const navigateMock = vi.fn()
vi.mock('react-router-dom', async importOriginal => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => navigateMock }
})

function jsonResponse(ok: boolean, status = 204) {
  return { ok, status }
}

function step(overrides: Partial<RouteStep> = {}): RouteStep {
  return {
    id: 'r1', kind: 'video', videoId: 'vid00000001', title: 'Step', source: 'Source',
    durationSec: 300, newLemmas: 8, words: [], status: 'current', ...overrides,
  }
}

function seedRoute(steps: RouteStep[]): RouteState {
  const route: RouteState = {
    v: 1, goalLabel: 'Friends без субтитров', steps, createdAt: new Date().toISOString(),
    settings: { profile: 'balance' }, revealedBatches: 1,
  }
  saveRoute(route)
  return route
}

function renderOverlay(opts: {
  videoId: string
  payload: UnplayablePayload | null
  onRetry?: () => void
  onSwitchToNative?: () => void
  onSwitchToIframe?: () => void
  entry?: string
}) {
  const onRetry = opts.onRetry ?? vi.fn()
  const utils = render(
    <MemoryRouter initialEntries={[opts.entry ?? `/player?v=${opts.videoId}`]}>
      <Routes>
        <Route
          path="/player"
          element={
            <UnplayableOverlay
              videoId={opts.videoId}
              payload={opts.payload}
              onRetry={onRetry}
              onSwitchToNative={opts.onSwitchToNative}
              onSwitchToIframe={opts.onSwitchToIframe}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  )
  return { ...utils, onRetry }
}

describe('UnplayableOverlay', () => {
  beforeEach(() => {
    window.localStorage.clear()
    navigateMock.mockClear()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(true)))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('renders nothing when payload is null', () => {
    const { container } = renderOverlay({ videoId: 'abcdef123', payload: null })
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when videoId is empty', () => {
    const { container } = renderOverlay({ videoId: '', payload: { reason: 'botwall-suspect' } })
    expect(container.firstChild).toBeNull()
  })

  it('embed-error code 100: "unavailable" text, no "Open in YouTube" link, no skip button without route_step', () => {
    renderOverlay({ videoId: 'abcdef123', payload: { reason: 'embed-error', code: 100 } })
    expect(screen.getByText('Видео недоступно (удалено или скрыто)')).toBeTruthy()
    expect(screen.queryByRole('link', { name: /Открыть в YouTube/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Пропустить шаг/ })).toBeNull()
  })

  // Прод-факт 2026-07-14 (скрин владельца, Firefox): YouTube отдаёт 150 и для
  // браузеров без YouTube-сессии — то же видео в Chrome играло. По коду
  // настоящий запрет владельца неотличим от кукис-отказа → 101/150 получают
  // botwall-вариант (вход → «Попробовать снова»), НЕ «владелец запретил».
  it('embed-error code 101: botwall-вариант — вход/попробовать снова/открыть в YouTube, БЕЗ «владелец запретил»', () => {
    renderOverlay({ videoId: 'abcdef123', payload: { reason: 'embed-error', code: 101 } })
    expect(screen.queryByText(/Владелец видео запретил/)).toBeNull()
    expect(screen.getByText('YouTube не даёт воспроизвести видео в этом браузере')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Попробовать снова' })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Открыть youtube.com/ })).toBeTruthy()
    const link = screen.getByRole('link', { name: /Открыть в YouTube/ }) as HTMLAnchorElement
    expect(link.href).toBe('https://youtu.be/abcdef123')
    expect(link.target).toBe('_blank')
    expect(link.rel).toContain('noopener')
  })

  it('embed-error code 150: тот же botwall-вариант, что 101', () => {
    renderOverlay({ videoId: 'abcdef123', payload: { reason: 'embed-error', code: 150 } })
    expect(screen.getByText('YouTube не даёт воспроизвести видео в этом браузере')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Попробовать снова' })).toBeTruthy()
  })

  it('embed-error other codes (2, 5): generic fallback text, still offers "Open in YouTube"', () => {
    renderOverlay({ videoId: 'abcdef123', payload: { reason: 'embed-error', code: 2 } })
    expect(screen.getByText('Не удалось воспроизвести видео')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Открыть в YouTube/ })).toBeTruthy()
  })

  it('"Пропустить шаг" renders only when route_step is present in the URL', () => {
    seedRoute([step({ id: 'r1' })])
    renderOverlay({
      videoId: 'vid00000001',
      payload: { reason: 'embed-error', code: 101 },
      entry: '/player?v=vid00000001&route_step=r1',
    })
    expect(screen.getByRole('button', { name: /Пропустить шаг/ })).toBeTruthy()
  })

  it('"Пропустить шаг" performs the same transition as RouteStepBar CTA (advanceRouteStep)', () => {
    seedRoute([
      step({ id: 'r1', status: 'current', videoId: 'vid00000001' }),
      step({ id: 'r2', status: 'next', videoId: 'vid00000002', title: 'Step2' }),
    ])
    renderOverlay({
      videoId: 'vid00000001',
      payload: { reason: 'embed-error', code: 100 },
      entry: '/player?v=vid00000001&route_step=r1',
    })
    fireEvent.click(screen.getByRole('button', { name: /Пропустить шаг/ }))

    const stored = loadRoute()
    expect(stored?.steps.find(s => s.id === 'r1')?.status).toBe('done')
    expect(navigateMock).toHaveBeenCalledWith('/player?v=vid00000002&route_step=r2')
  })

  it('botwall-suspect: title + 2-line explanation + 4 action buttons; "Попробовать снова" calls onRetry', () => {
    seedRoute([step({ id: 'r1', videoId: 'vid00000001' })])
    const onRetry = vi.fn()
    renderOverlay({
      videoId: 'vid00000001',
      payload: { reason: 'botwall-suspect' },
      onRetry,
      entry: '/player?v=vid00000001&route_step=r1',
    })
    expect(screen.getByText('YouTube не даёт воспроизвести видео в этом браузере')).toBeTruthy()
    expect(screen.getByText(/откройте youtube\.com в новой вкладке/)).toBeTruthy()

    const openYoutubeCom = screen.getByRole('link', { name: /Открыть youtube\.com/ }) as HTMLAnchorElement
    expect(openYoutubeCom.href).toBe('https://youtube.com/')
    expect(openYoutubeCom.target).toBe('_blank')

    const openVideo = screen.getByRole('link', { name: /Открыть в YouTube/ }) as HTMLAnchorElement
    expect(openVideo.href).toBe('https://youtu.be/vid00000001')

    expect(screen.getByRole('button', { name: /Пропустить шаг/ })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Попробовать снова' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('"✕ скрыть" hides the overlay (dismissed) — only offered on botwall-suspect', () => {
    renderOverlay({ videoId: 'abcdef123', payload: { reason: 'botwall-suspect' } })
    expect(screen.getByTestId('unplayable-overlay')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /скрыть/ }))
    expect(screen.queryByTestId('unplayable-overlay')).toBeNull()
  })

  it('embed-error overlay has no "✕ скрыть" button (hard failure, not a maybe-just-slow case)', () => {
    renderOverlay({ videoId: 'abcdef123', payload: { reason: 'embed-error', code: 100 } })
    expect(screen.queryByRole('button', { name: /скрыть/ })).toBeNull()
  })

  it('a NEW payload object un-dismisses the overlay (rerender with a fresh payload after a prior dismiss)', () => {
    const { rerender } = renderOverlay({ videoId: 'abcdef123', payload: { reason: 'botwall-suspect' } })
    fireEvent.click(screen.getByRole('button', { name: /скрыть/ }))
    expect(screen.queryByTestId('unplayable-overlay')).toBeNull()

    rerender(
      <MemoryRouter initialEntries={['/player?v=abcdef123']}>
        <Routes>
          <Route
            path="/player"
            element={<UnplayableOverlay videoId="abcdef123" payload={{ reason: 'embed-error', code: 101 }} onRetry={() => {}} />}
          />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByTestId('unplayable-overlay')).toBeTruthy()
  })

  it('telemetry: fires exactly one POST /api/feedback/video with verdict=unplayable when the overlay first shows', () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(true))
    vi.stubGlobal('fetch', fetchMock)
    renderOverlay({ videoId: 'abcdef123', payload: { reason: 'embed-error', code: 101 } })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/feedback/video')
    const body = JSON.parse(opts.body)
    expect(body.video_id).toBe('abcdef123')
    expect(body.verdict).toBe('unplayable')
    expect(body.comment).toBe('embed-error:101 other')
    expect(typeof body.anon_id).toBe('string')
    expect(body.anon_id.length).toBeGreaterThan(0)
  })

  it('telemetry comment: reason без кода + браузер-тег', () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(true))
    vi.stubGlobal('fetch', fetchMock)
    renderOverlay({ videoId: 'abcdef123', payload: { reason: 'botwall-suspect' } })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.comment).toBe('botwall-suspect other')
  })

  it('network failure during telemetry is swallowed via console.warn, not thrown', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    expect(() => renderOverlay({ videoId: 'abcdef123', payload: { reason: 'botwall-suspect' } })).not.toThrow()
    await waitFor(() => expect(warnSpy).toHaveBeenCalled())
  })
})

// [ID:P-hybrid] fallback-кнопка «Смотреть через flib-плеер (бета)»: ленивый
// зонд GET /api/video/{id} (один раз при показе botwall-оверлея), кнопка
// видна только когда зонд подтвердил "не 404" И вызывающий дал onSwitchToNative.
describe('UnplayableOverlay — [ID:P-hybrid] native fallback probe/button', () => {
  beforeEach(() => {
    window.localStorage.clear()
    navigateMock.mockClear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('без onSwitchToNative: не зондирует /api/video и не показывает кнопку, даже для botwall-suspect', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(true))
    vi.stubGlobal('fetch', fetchMock)
    renderOverlay({ videoId: 'abcdef123', payload: { reason: 'botwall-suspect' } })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1)) // только телеметрия
    expect(screen.queryByRole('button', { name: /flib-плеер/ })).toBeNull()
  })

  it('с onSwitchToNative, зонд 200 → кнопка появляется и вызывает onSwitchToNative по клику', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.startsWith('/api/video/')) return Promise.resolve({ ok: true, status: 200 })
      return Promise.resolve(jsonResponse(true)) // телеметрия
    })
    vi.stubGlobal('fetch', fetchMock)
    const onSwitchToNative = vi.fn()
    renderOverlay({ videoId: 'abcdef123', payload: { reason: 'botwall-suspect' }, onSwitchToNative })

    const btn = await screen.findByRole('button', { name: /flib-плеер/ })
    fireEvent.click(btn)
    expect(onSwitchToNative).toHaveBeenCalledTimes(1)
  })

  it('зонд 202 (warming) тоже считается "доступно" — кнопка появляется', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.startsWith('/api/video/')) return Promise.resolve({ ok: false, status: 202 })
      return Promise.resolve(jsonResponse(true))
    })
    vi.stubGlobal('fetch', fetchMock)
    renderOverlay({ videoId: 'abcdef123', payload: { reason: 'botwall-suspect' }, onSwitchToNative: vi.fn() })
    expect(await screen.findByRole('button', { name: /flib-плеер/ })).toBeTruthy()
  })

  it('зонд 404 (флаг выключен) → кнопка НЕ появляется', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.startsWith('/api/video/')) return Promise.resolve({ ok: false, status: 404 })
      return Promise.resolve(jsonResponse(true))
    })
    vi.stubGlobal('fetch', fetchMock)
    renderOverlay({ videoId: 'abcdef123', payload: { reason: 'botwall-suspect' }, onSwitchToNative: vi.fn() })
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /flib-плеер/ })).toBeNull()
  })

  it('embed-error хард-фейл (код 100) НЕ зондирует /api/video даже с onSwitchToNative (не botwall-ветка)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(true))
    vi.stubGlobal('fetch', fetchMock)
    renderOverlay({
      videoId: 'abcdef123',
      payload: { reason: 'embed-error', code: 100 },
      onSwitchToNative: vi.fn(),
    })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1)) // только телеметрия
    const videoProbeCalls = fetchMock.mock.calls.filter(c => typeof c[0] === 'string' && c[0].startsWith('/api/video/'))
    expect(videoProbeCalls).toHaveLength(0)
  })

  it('reason=native-error: свой заголовок, "Попробовать снова" + опциональный skip, НЕТ кнопки fallback (уже на native)', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(true))) // телеметрия — не предмет теста
    seedRoute([step({ id: 'r1', videoId: 'vid00000001' })])
    const onRetry = vi.fn()
    renderOverlay({
      videoId: 'vid00000001',
      payload: { reason: 'native-error' },
      onRetry,
      entry: '/player?v=vid00000001&route_step=r1',
    })
    expect(screen.getByText('Не удалось воспроизвести видео через flib-плеер')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /flib-плеер \(бета\)/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Попробовать снова' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: /Пропустить шаг/ })).toBeTruthy()
  })

  // Аудит MED-2 [ID:P-hybrid-audit]: зонд НЕ должен запускать прогрев — ходит
  // строго с ?probe=1 (read-only режим ручки, video_proxy.go).
  it('зонд ходит с ?probe=1 (read-only) — показ стены не триггерит скачивание', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.startsWith('/api/video/')) return Promise.resolve({ ok: true, status: 200 })
      return Promise.resolve(jsonResponse(true))
    })
    vi.stubGlobal('fetch', fetchMock)
    renderOverlay({ videoId: 'abcdef123', payload: { reason: 'botwall-suspect' }, onSwitchToNative: vi.fn() })
    await screen.findByRole('button', { name: /flib-плеер/ })

    const probeCalls = fetchMock.mock.calls.filter(c => typeof c[0] === 'string' && c[0].startsWith('/api/video/'))
    expect(probeCalls).toHaveLength(1)
    expect(probeCalls[0][0]).toBe('/api/video/abcdef123?probe=1')
  })

  // Аудит MED-3/5b [ID:P-hybrid-audit]: из native-error есть путь назад.
  it('reason=native-error + onSwitchToIframe: кнопка «Вернуться на YouTube-плеер» вызывает колбэк', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(true)))
    const onSwitchToIframe = vi.fn()
    renderOverlay({
      videoId: 'vid00000001',
      payload: { reason: 'native-error' },
      onSwitchToIframe,
    })
    const btn = screen.getByRole('button', { name: /Вернуться на YouTube-плеер/ })
    fireEvent.click(btn)
    expect(onSwitchToIframe).toHaveBeenCalledTimes(1)
  })

  it('reason=native-error БЕЗ onSwitchToIframe: кнопки возврата нет (опциональный проп)', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(true)))
    renderOverlay({ videoId: 'vid00000001', payload: { reason: 'native-error' } })
    expect(screen.queryByRole('button', { name: /Вернуться на YouTube-плеер/ })).toBeNull()
  })
})

// Браузер-специфичные рецепты бот-стены (рецепт Firefox ПРОВЕРЕН владельцем:
// щиток ETP выключен → видео завелось; «войти в новой вкладке» в Firefox не
// работает из-за партиционирования куки).
describe('pickBrowserRecipe', () => {
  const FF_DESKTOP = 'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0'
  const FF_ANDROID = 'Mozilla/5.0 (Android 14; Mobile; rv:128.0) Gecko/128.0 Firefox/128.0'
  const SAFARI_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
  const CHROME_ANDROID = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'
  const CHROME_DESKTOP = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

  it('Firefox (desktop и Android) → рецепт щитка ETP', () => {
    expect(pickBrowserRecipe(FF_DESKTOP).browser).toBe('firefox')
    expect(pickBrowserRecipe(FF_ANDROID).browser).toBe('firefox')
    expect(pickBrowserRecipe(FF_DESKTOP).lines[0]).toContain('щиток')
  })

  it('Safari iOS → рецепт Storage Access/настроек; Chrome (Safari в UA) — НЕ safari', () => {
    expect(pickBrowserRecipe(SAFARI_IOS).browser).toBe('safari')
    expect(pickBrowserRecipe(CHROME_ANDROID).browser).toBe('other')
    expect(pickBrowserRecipe(CHROME_DESKTOP).browser).toBe('other')
  })
})
