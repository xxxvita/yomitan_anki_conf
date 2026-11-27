// RoutePage.test.tsx — /route (Э2+Э3): empty-state, реальная сборка маршрута
// через buildRoute (fetch-моки под BFF-контракт), фаза загрузки/ошибка+ретрай,
// клики по шагам, «Дальше»/A-B seam, карточка слов, настройки-модалка.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { RoutePage } from '../RoutePage'
import { savePointA } from '../pointA'
import { saveRoute, loadRoute, type RouteState, type RouteStep } from '../route-state'
import { loadVocab, addWords } from '../vocab'

const navigateMock = vi.fn()
vi.mock('react-router-dom', async importOriginal => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => navigateMock }
})

const reportRouteNextMock = vi.fn()
// Мокаем seam-функцию напрямую (а не console.info) — план, Э2 п.3: seam
// существует именно затем, чтобы тесты могли подменить его без завязки на
// побочный эффект логирования.
vi.mock('../ab-events', () => ({ reportRouteNext: (...args: unknown[]) => reportRouteNextMock(...args) }))

function renderRoute() {
  return render(
    <MemoryRouter initialEntries={['/route']}>
      <Routes>
        <Route path="/route" element={<RoutePage />} />
        <Route path="/fork" element={<div>fork placeholder</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

function step(overrides: Partial<RouteStep> = {}): RouteStep {
  return {
    id: 'r1',
    kind: 'video',
    videoId: 'abcdefghijk',
    title: 'Step',
    source: 'Source',
    durationSec: 300,
    newLemmas: 10,
    words: [],
    status: 'next',
    ...overrides,
  }
}

function seedRoute(steps: RouteStep[], extra: Partial<RouteState> = {}): RouteState {
  const route: RouteState = {
    v: 1,
    goalLabel: 'Friends без субтитров',
    steps,
    createdAt: new Date().toISOString(),
    settings: { profile: 'balance' },
    revealedBatches: 1,
    ...extra,
  }
  saveRoute(route)
  return route
}

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body }
}

// Мок BFF-цикла /api/route → /api/route/jobs/{id} с сразу 'done' на первом
// поллинге — сама механика поллинга (pending/running/таймаут) покрыта
// api.test.ts, здесь важна только интеграция с RoutePage.
function stubBuildRouteDone(jobId: string, goalLabel: string, dtoSteps: unknown[]) {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(jsonResponse({ job_id: jobId }, true, 202))
    .mockResolvedValueOnce(jsonResponse({ status: 'done', route: { goal_label: goalLabel, steps: dtoSteps }, error: '' }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const oneVideoStepDTO = (videoId: string, title = 'Step1') => ([
  { kind: 'video', video_id: videoId, title, source: 'Src', duration_sec: 300, new_lemmas: 5, words: [] },
])

describe('RoutePage', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.localStorage.setItem('flib:anon', 'anon-test')
    navigateMock.mockClear()
    reportRouteNextMock.mockClear()
    // Дефолт: неожиданный fetch в тесте, который его не настроил, должен
    // громко упасть (reject), а не тихо зависнуть/попасть в сеть.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('unexpected fetch call in this test')))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('zero-step route (target already covered): explains instead of empty list, offers new goal + settings', () => {
    seedRoute([], { goalLabel: 'Friends' })
    renderRoute()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('уже покрывает')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Friends')
    // Пустого списка шагов и «шаг за шагом»-заголовка быть не должно
    expect(screen.queryByText(/шаг за шагом/i)).toBeNull()
    // Выходы: другая цель и настройки (пересборка)
    expect(screen.getByRole('link', { name: /Выбрать другую цель/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Настройки маршрута/ })).toBeTruthy()
  })

  it('empty state: no flib:route and no flib:pointA → CTA to /fork', () => {
    renderRoute()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Маршрута пока нет')
    fireEvent.click(screen.getByRole('button', { name: /Собрать маршрут/ }))
    expect(navigateMock).toHaveBeenCalledWith('/fork')
  })

  it('loading → success: no flib:route but flib:pointA present → shows a loading state, then builds via buildRoute and shows FreshBanner', async () => {
    savePointA({ kind: 'cefr', level: 'B1', ageBand: 20, goals: ['friends'], savedAt: new Date().toISOString() })
    const fetchMock = stubBuildRouteDone('job-1', 'Friends', oneVideoStepDTO('vid00000001'))

    renderRoute()
    // Синхронно с первым рендером — building=true с самого начала (иначе
    // между монтированием и запуском эффекта мелькнёт empty-state).
    expect(screen.getByText('Собираем маршрут…')).toBeTruthy()

    await waitFor(() => expect(screen.getByText('Маршрут готов')).toBeTruthy())
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Friends')

    // signal: AbortSignal — HIGH #3, RoutePage передаёт controller.signal в buildRoute.
    // profile_meta — задача P-profile-feed: kind='cefr' → vocab_source:'cefr'
    // + level из pointA.level + age из pointA.ageBand (слайдер).
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        point_a: { kind: 'cefr', level: 'B1' }, goal_ids: ['friends'], profile: 'balance',
        profile_meta: { vocab_source: 'cefr', level: 'B1', age: 20 },
        anon_id: 'anon-test',
      }),
      signal: expect.any(AbortSignal),
    })

    const stored = loadRoute()
    expect(stored).not.toBeNull()
    expect(stored?.goalLabel).toBe('Friends')
    expect(stored?.revealedBatches).toBe(1)
    expect(stored?.steps[0].status).toBe('current')

    fireEvent.click(screen.getByRole('button', { name: /Смотреть первое видео/ }))
    expect(navigateMock).toHaveBeenCalledWith('/player?v=vid00000001&route_step=route-step-0')
  })

  // feedback-1 п.5: FreshBanner — правильное склонение «шаг/шага/шагов» и
  // часы/минуты вместо бессмысленного «≈0 часов» на коротких маршрутах
  // (владелец воспроизвёл на The Wire, транскрипт 2026-07-14, 07:10–07:15).
  it('FreshBanner: маршрут короче часа показывает минуты со склонением, а не "≈0 часов"', async () => {
    savePointA({ kind: 'cefr', level: 'B1', ageBand: 20, goals: ['friends'], savedAt: new Date().toISOString() })
    const dto = [
      { kind: 'video', video_id: 'vid00000001', title: 'Step1', source: 'Src', duration_sec: 40 * 60, new_lemmas: 5, words: [] },
    ]
    stubBuildRouteDone('job-min', 'The Wire', dto)
    renderRoute()
    await waitFor(() => expect(screen.getByText('Маршрут готов')).toBeTruthy())

    expect(screen.getByText('≈40')).toBeTruthy()
    expect(screen.getByText('минут')).toBeTruthy()
    expect(screen.queryByText(/часов/)).toBeNull()
    expect(screen.getByText('1')).toBeTruthy()
    expect(screen.getByText('шаг')).toBeTruthy() // 1 шаг, не "1 шагов"
    expect(screen.getByText(/Кратчайшая цепочка из 1 шаг\./)).toBeTruthy()
  })

  it('FreshBanner: маршрут длиннее часа показывает часы со склонением ("2 часа", не "2 часов")', async () => {
    savePointA({ kind: 'cefr', level: 'B1', ageBand: 20, goals: ['friends'], savedAt: new Date().toISOString() })
    const dto = [
      { kind: 'video', video_id: 'vid00000001', title: 'Step1', source: 'Src', duration_sec: 2 * 3600, new_lemmas: 5, words: [] },
      { kind: 'video', video_id: 'vid00000002', title: 'Step2', source: 'Src', duration_sec: 5, new_lemmas: 5, words: [] },
    ]
    stubBuildRouteDone('job-hrs', 'The Wire', dto)
    renderRoute()
    await waitFor(() => expect(screen.getByText('Маршрут готов')).toBeTruthy())

    expect(screen.getByText('≈2')).toBeTruthy()
    expect(screen.getByText('часа')).toBeTruthy()
    expect(screen.getByText('2')).toBeTruthy()
    expect(screen.getByText('шага')).toBeTruthy() // 2 шага
  })

  it('loading → error → retry: shows a human-readable error with retry/back-to-fork, retry rebuilds via buildRoute again', async () => {
    savePointA({ kind: 'cefr', level: 'B1', ageBand: 20, goals: ['friends'], savedAt: new Date().toISOString() })
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({}, false, 500))
    vi.stubGlobal('fetch', fetchMock)

    renderRoute()
    await waitFor(() => expect(screen.getByText('Не получилось собрать маршрут')).toBeTruthy())
    expect(screen.getByText(/500/)).toBeTruthy()

    fetchMock
      .mockResolvedValueOnce(jsonResponse({ job_id: 'job-2' }, true, 202))
      .mockResolvedValueOnce(jsonResponse({ status: 'done', route: { goal_label: 'Office', steps: oneVideoStepDTO('vid00000002') }, error: '' }))

    fireEvent.click(screen.getByRole('button', { name: 'Попробовать снова' }))
    await waitFor(() => expect(screen.getByText('Маршрут готов')).toBeTruthy())
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Office')
  })

  it('loading → error → "← изменить настройки" navigates to /fork', async () => {
    savePointA({ kind: 'cefr', level: 'B1', ageBand: 20, goals: ['friends'], savedAt: new Date().toISOString() })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({}, false, 500)))

    renderRoute()
    await waitFor(() => expect(screen.getByText('Не получилось собрать маршрут')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /изменить настройки/ }))
    expect(navigateMock).toHaveBeenCalledWith('/fork')
  })

  it('аудит HIGH #3: render→unmount→render (имитация StrictMode) — первый цикл сборки абортится до второго GET, второй достраивается и пишет один route', async () => {
    savePointA({ kind: 'cefr', level: 'B1', ageBand: 20, goals: ['friends'], savedAt: new Date().toISOString() })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ job_id: 'job-a' }, true, 202)) // POST от первого (абортится) mount
      .mockResolvedValueOnce(jsonResponse({ job_id: 'job-b' }, true, 202)) // POST от второго mount
      .mockResolvedValueOnce(jsonResponse({ status: 'done', route: { goal_label: 'Second', steps: oneVideoStepDTO('vid00000002') }, error: '' }))
    vi.stubGlobal('fetch', fetchMock)

    const first = renderRoute()
    first.unmount()
    renderRoute()

    await waitFor(() => expect(loadRoute()?.goalLabel).toBe('Second'))
    // Абортнутый первый цикл ни разу не дошёл до GET /api/route/jobs/job-a —
    // POST×2 + GET×1 (первый цикл проверяет signal.aborted на входе в петлю
    // поллинга и выходит раньше первого GET) + 1 запрос материализации
    // flib:vocab (Phase 2, п.C: успешная сборка kind='cefr' → GET
    // /api/dicts/cefr) = 4, не 3.
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('аудит HIGH #3: unmount посреди поллинга абортит цикл — нет записи в localStorage и нет React-варнингов после unmount', async () => {
    savePointA({ kind: 'cefr', level: 'B1', ageBand: 20, goals: ['friends'], savedAt: new Date().toISOString() })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ job_id: 'job-1' }, true, 202))
      .mockResolvedValueOnce(jsonResponse({ status: 'pending', route: null, error: '' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'done', route: { goal_label: 'Late', steps: oneVideoStepDTO('vid00000009') }, error: '' }))
    vi.stubGlobal('fetch', fetchMock)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    vi.useFakeTimers()
    try {
      const { unmount } = renderRoute()
      await vi.advanceTimersByTimeAsync(0) // прогоняем микротаски POST + первого pending-GET
      expect(fetchMock).toHaveBeenCalledTimes(2)

      unmount() // абортит controller посреди 3с delay() перед следующим GET

      await vi.advanceTimersByTimeAsync(3100) // даём поллингу "проснуться" после таймера
      expect(fetchMock).toHaveBeenCalledTimes(2) // третий (done) GET так и не случился — цикл абортился раньше
      expect(loadRoute()).toBeNull()
      expect(errorSpy).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
      errorSpy.mockRestore()
    }
  })

  it('аудит MED #5: пересборка без сохранённой точки А показывает человекочитаемую ошибку вместо тихого no-op', () => {
    seedRoute([step({ id: 'r1', status: 'current' })]) // без savePointA — pointA=null
    renderRoute()
    fireEvent.click(screen.getByRole('button', { name: /Настройки маршрута/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Пересобрать маршрут' }))
    expect(screen.getByText('Не получилось собрать маршрут')).toBeTruthy()
    expect(screen.getByText('Точка А не найдена — соберите маршрут заново')).toBeTruthy()
    // Кнопка выхода на /fork из error-стейта уже есть — просто убеждаемся, что она есть.
    expect(screen.getByRole('button', { name: /изменить настройки/ })).toBeTruthy()
  })

  it('аудит MED #6: видео-шаг без videoId не кликабелен (был мёртвый клик)', () => {
    seedRoute([step({ id: 'r1', status: 'current', videoId: null })])
    renderRoute()
    const button = screen.getByText('Step').closest('button') as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('аудит MED #6: «Смотреть первое видео» дизейблена, если во всём свежесобранном маршруте нет ни одного видео-шага', async () => {
    savePointA({ kind: 'cefr', level: 'B1', ageBand: 20, goals: ['friends'], savedAt: new Date().toISOString() })
    const wordsOnlyStepDTO = [
      { kind: 'words', video_id: null, title: 'Words', source: 'Src', duration_sec: 0, new_lemmas: 5, words: ['a', 'b'] },
    ]
    stubBuildRouteDone('job-w', 'Friends', wordsOnlyStepDTO)
    renderRoute()
    await waitFor(() => expect(screen.getByText('Маршрут готов')).toBeTruthy())

    const startBtn = screen.getByRole('button', { name: /Смотреть первое видео/ }) as HTMLButtonElement
    expect(startBtn.disabled).toBe(true)
    fireEvent.click(startBtn)
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('existing route: clicking a done/current/next video step navigates to /player?v=<videoId>&route_step=<id>', () => {
    seedRoute([step({ id: 'r1', status: 'current', videoId: 'vid00000001' })])
    renderRoute()
    fireEvent.click(screen.getByText('Step'))
    expect(navigateMock).toHaveBeenCalledWith('/player?v=vid00000001&route_step=r1')
  })

  it('a locked video step is not clickable', () => {
    seedRoute([step({ id: 'r1', status: 'locked' })])
    renderRoute()
    const button = screen.getByText('Step').closest('button') as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('"Дальше" reveals the next batch and reports the A/B seam event', () => {
    const HOUR = 3600
    const steps = [
      step({ id: 'r1', status: 'current', durationSec: 10 * HOUR }),
      step({ id: 'r2', status: 'locked', durationSec: 10 * HOUR, title: 'Step2' }),
    ]
    seedRoute(steps, { revealedBatches: 1 })
    renderRoute()
    expect(screen.queryByText('Step2')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Дальше' }))

    expect(screen.getByText('Step2')).toBeTruthy()
    expect(reportRouteNextMock).toHaveBeenCalledWith(
      expect.objectContaining({ batch: 2, routeGoal: 'Friends без субтитров' }),
    )
    expect(loadRoute()?.revealedBatches).toBe(2)
  })

  it('words-step "Пройдено" marks it done and advances the next visible step to current', () => {
    const steps = [
      step({ id: 'r1', kind: 'words', videoId: null, status: 'current', words: ['cat', 'dog'], title: 'w1' }),
      step({ id: 'r2', status: 'next', title: 'Step2' }),
    ]
    seedRoute(steps)
    renderRoute()

    expect(screen.getByText('cat')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Отметить пройденным/ }))

    const stored = loadRoute()
    expect(stored?.steps.find(s => s.id === 'r1')?.status).toBe('done')
    expect(stored?.steps.find(s => s.id === 'r2')?.status).toBe('current')
  })

  it('кнопка-действие words-карточки — только у current (прод-инцидент: у next/locked читалась как статус «пройдено»)', () => {
    seedRoute([
      step({ id: 'r1', kind: 'words', videoId: null, status: 'current', words: ['a'] }),
      step({ id: 'r2', kind: 'words', videoId: null, status: 'next', words: ['b'] }),
      step({ id: 'r3', kind: 'words', videoId: null, status: 'locked', words: ['c'] }),
    ])
    renderRoute()
    expect(screen.getAllByRole('button', { name: /Отметить пройденным/ })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Пройдено' })).toBeNull()
  })

  it('settings modal rebuilds the route with the chosen profile via buildRoute and resets revealedBatches to 1', async () => {
    savePointA({ kind: 'cefr', level: 'B1', ageBand: 20, goals: ['friends'], savedAt: new Date().toISOString() })
    seedRoute([step({ id: 'r1', status: 'current' })], { revealedBatches: 3, settings: { profile: 'comfort' } })
    const fetchMock = stubBuildRouteDone('job-9', 'Friends', oneVideoStepDTO('vid00000009', 'Rebuilt'))

    renderRoute()
    // route уже есть → рендер не в building-стейте сразу.
    expect(screen.queryByText('Собираем маршрут…')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Настройки маршрута/ }))
    fireEvent.click(screen.getByRole('button', { name: /Обучение/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Пересобрать маршрут' }))

    await waitFor(() => {
      const stored = loadRoute()
      expect(stored?.goalLabel).toBe('Friends')
      expect(stored?.steps[0].title).toBe('Rebuilt')
    })
    const stored = loadRoute()
    expect(stored?.settings.profile).toBe('learning')
    expect(stored?.revealedBatches).toBe(1)

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        point_a: { kind: 'cefr', level: 'B1' }, goal_ids: ['friends'], profile: 'learning',
        profile_meta: { vocab_source: 'cefr', level: 'B1', age: 20 },
        anon_id: 'anon-test',
      }),
      signal: expect.any(AbortSignal),
    })
  })

  it('closes the settings modal on Escape', () => {
    seedRoute([step({ id: 'r1', status: 'current' })])
    renderRoute()
    fireEvent.click(screen.getByRole('button', { name: /Настройки маршрута/ }))
    expect(screen.getByText('Под Ваш темп и вкус')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByText('Под Ваш темп и вкус')).toBeNull()
  })

  it('closes the settings modal on an outside click (overlay), not on inner clicks', () => {
    seedRoute([step({ id: 'r1', status: 'current' })])
    renderRoute()
    fireEvent.click(screen.getByRole('button', { name: /Настройки маршрута/ }))
    const overlay = document.querySelector('.rs-overlay') as HTMLElement
    fireEvent.click(overlay)
    expect(screen.queryByText('Под Ваш темп и вкус')).toBeNull()
  })

  it('shows progress "X из N пройдено" for an already-existing route', () => {
    seedRoute([
      step({ id: 'r1', status: 'done' }),
      step({ id: 'r2', status: 'current', title: 'Step2' }),
      step({ id: 'r3', status: 'next', title: 'Step3' }),
    ])
    renderRoute()
    expect(screen.getByText('1 из 3 пройдено')).toBeTruthy()
  })

  // feedback-1 п.6: разрыв (⋮) + «Дальше» — только пока есть нераскрытые
  // шаги; карточка-цель — всегда последней строкой маршрута.
  it('всегда показывает карточку-цель финальной строкой, даже когда весь маршрут раскрыт (без разрыва/кнопки)', () => {
    seedRoute([step({ id: 'r1', status: 'current' })], { goalLabel: 'The Wire' })
    renderRoute()
    const list = document.querySelector('.route-list') as HTMLElement
    expect(list.querySelector('.rl-goal-item')).toBeTruthy()
    expect(list.querySelector('.rl-goal-title')?.textContent).toBe('The Wire')
    expect(list.querySelector('.rl-goal-caption')?.textContent).toBe('Ваша цель')
    // Весь маршрут виден -> нет разрыва и нет кнопки «Дальше».
    expect(list.querySelector('.rl-gap')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Дальше' })).toBeNull()
  })

  it('когда есть скрытые шаги — рендерит разрыв (⋮) с кнопкой «Дальше» между видимой порцией и целью, кнопка не внутри rl-card', () => {
    const HOUR = 3600
    seedRoute([
      step({ id: 'r1', status: 'current', durationSec: 2 * HOUR }),
      step({ id: 'r2', status: 'locked', durationSec: 2 * HOUR, title: 'Step2' }),
    ], { revealedBatches: 1 })
    renderRoute()

    const list = document.querySelector('.route-list') as HTMLElement
    const children = Array.from(list.children)
    const gapIdx = children.findIndex(el => el.classList.contains('rl-gap'))
    const goalIdx = children.findIndex(el => el.classList.contains('rl-goal-item'))
    expect(gapIdx).toBeGreaterThan(-1)
    expect(goalIdx).toBe(children.length - 1) // цель — всегда последняя строка
    expect(gapIdx).toBeLessThan(goalIdx) // разрыв идёт до цели

    const nextBtn = screen.getByRole('button', { name: 'Дальше' })
    expect(nextBtn.closest('.rl-card')).toBeNull() // не карточка шага — отдельный элемент
    expect(list.querySelector('.rl-gap-dots')?.textContent).toBe('⋮')
  })

  // feedback-2 п.2 (владелец, транскрипт screencast3, 04:51–05:11): «Сбросить
  // маршрут» в настройках — двухшаговое подтверждение внутри кнопки (без
  // window.confirm), очистка ОБОИХ ключей localStorage и навигация на '/'.
  describe('«Сбросить маршрут» в настройках', () => {
    function openSettings() {
      fireEvent.click(screen.getByRole('button', { name: /Настройки маршрута/ }))
    }

    it('первый клик армирует подтверждение (не сбрасывает), второй — выполняет сброс: чистит flib:route И flib:pointA, закрывает модалку, navigate("/")', () => {
      savePointA({ kind: 'cefr', level: 'B1', ageBand: 20, goals: ['friends'], savedAt: new Date().toISOString() })
      seedRoute([step({ id: 'r1', status: 'current' })])
      renderRoute()
      openSettings()

      const resetBtn = screen.getByRole('button', { name: 'Сбросить маршрут' })
      fireEvent.click(resetBtn)

      // Первый клик — только армирует, ничего не сброшено, модалка ещё открыта.
      expect(loadRoute()).not.toBeNull()
      expect(window.localStorage.getItem('flib:pointA')).not.toBeNull()
      expect(navigateMock).not.toHaveBeenCalledWith('/')
      const armedBtn = screen.getByRole('button', { name: /Точно сбросить\?/ })
      expect(armedBtn).toBeTruthy()

      fireEvent.click(armedBtn)

      expect(loadRoute()).toBeNull()
      expect(window.localStorage.getItem('flib:pointA')).toBeNull()
      expect(navigateMock).toHaveBeenCalledWith('/')
      expect(screen.queryByText('Под Ваш темп и вкус')).toBeNull() // модалка закрыта
    })

    it('клик мимо кнопки сброса (внутри модалки) разоружает подтверждение без действия', () => {
      seedRoute([step({ id: 'r1', status: 'current' })])
      renderRoute()
      openSettings()

      fireEvent.click(screen.getByRole('button', { name: 'Сбросить маршрут' }))
      expect(screen.getByRole('button', { name: /Точно сбросить\?/ })).toBeTruthy()

      // Клик по профиль-чипу — "мимо" кнопки сброса, но всё ещё внутри модалки.
      fireEvent.click(screen.getByRole('button', { name: /Обучение/ }))

      expect(screen.getByRole('button', { name: 'Сбросить маршрут' })).toBeTruthy()
      expect(screen.queryByRole('button', { name: /Точно сбросить\?/ })).toBeNull()
      expect(loadRoute()).not.toBeNull()
      expect(navigateMock).not.toHaveBeenCalledWith('/')
    })

    it('Esc разоружает подтверждение (не закрывает модалку) когда кнопка армирована; второй Esc закрывает модалку', () => {
      seedRoute([step({ id: 'r1', status: 'current' })])
      renderRoute()
      openSettings()

      fireEvent.click(screen.getByRole('button', { name: 'Сбросить маршрут' }))
      expect(screen.getByRole('button', { name: /Точно сбросить\?/ })).toBeTruthy()

      fireEvent.keyDown(window, { key: 'Escape' })
      expect(screen.getByText('Под Ваш темп и вкус')).toBeTruthy() // модалка всё ещё открыта
      expect(screen.getByRole('button', { name: 'Сбросить маршрут' })).toBeTruthy() // разоружена

      fireEvent.keyDown(window, { key: 'Escape' })
      expect(screen.queryByText('Под Ваш темп и вкус')).toBeNull() // теперь закрыта
    })
  })

  // profile_meta (задача P-profile-feed, 2026-07-14): RoutePage.tsx
  // toProfileMeta() выводит vocab_source/level/age из pointA — покрываем все
  // источники словаря отдельно от общих тестов сборки маршрута выше.
  describe('profile_meta в теле POST /api/route', () => {
    it('kind=words, source=test (прошёл тест): vocab_source:"test" + level из levelEstimate, БЕЗ age', async () => {
      savePointA({ kind: 'words', words: ['cat'], goals: ['friends'], source: 'test', levelEstimate: 'B1', savedAt: new Date().toISOString() })
      const fetchMock = stubBuildRouteDone('job-test', 'Friends', oneVideoStepDTO('vid00000001'))
      renderRoute()
      await waitFor(() => expect(screen.getByText('Маршрут готов')).toBeTruthy())

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
      expect(body.profile_meta).toEqual({ vocab_source: 'test', level: 'B1' })
    })

    it('kind=words, source=upload (загрузил словарь): vocab_source:"upload", БЕЗ level и БЕЗ age', async () => {
      savePointA({ kind: 'words', words: ['cat'], goals: ['friends'], source: 'upload', savedAt: new Date().toISOString() })
      const fetchMock = stubBuildRouteDone('job-upload', 'Friends', oneVideoStepDTO('vid00000001'))
      renderRoute()
      await waitFor(() => expect(screen.getByText('Маршрут готов')).toBeTruthy())

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
      expect(body.profile_meta).toEqual({ vocab_source: 'upload' })
    })

    it('старая localStorage-запись pointA (kind=words) БЕЗ source: vocab_source:"unknown", не угадываем', async () => {
      // Пишем "сырую" старую запись напрямую в localStorage — до задачи
      // P-profile-feed source не существовал вовсе.
      window.localStorage.setItem('flib:pointA', JSON.stringify({
        kind: 'words', words: ['cat'], goals: ['friends'], savedAt: new Date().toISOString(),
      }))
      const fetchMock = stubBuildRouteDone('job-legacy', 'Friends', oneVideoStepDTO('vid00000001'))
      renderRoute()
      await waitFor(() => expect(screen.getByText('Маршрут готов')).toBeTruthy())

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
      expect(body.profile_meta).toEqual({ vocab_source: 'unknown' })
    })

    it('kind=cefr (TryPage): vocab_source:"cefr" + level + age всегда присутствуют', async () => {
      savePointA({ kind: 'cefr', level: 'A2', ageBand: 45, goals: ['friends'], savedAt: new Date().toISOString() })
      const fetchMock = stubBuildRouteDone('job-cefr', 'Friends', oneVideoStepDTO('vid00000001'))
      renderRoute()
      await waitFor(() => expect(screen.getByText('Маршрут готов')).toBeTruthy())

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
      expect(body.profile_meta).toEqual({ vocab_source: 'cefr', level: 'A2', age: 45 })
    })
  })

  // T3 (докс владельца, скрин шапки маршрута): кнопка-ссылка на скачивание
  // Flibooster по центру шапки, между лого и "← на главную". Проверяем на
  // empty-state — шапка (PageTopbar) общая для всех веток рендера страницы.
  it('T3: шапка маршрута содержит кнопку "Скачать приложение Flibooster" → страница скачивания, в новой вкладке', () => {
    renderRoute()
    const dl = screen.getByRole('link', { name: 'Скачать приложение Flibooster' })
    expect(dl.getAttribute('href')).toBe('/download.html')
    expect(dl.getAttribute('target')).toBe('_blank')
    expect(dl.getAttribute('rel')).toBe('noopener noreferrer')
    // Ещё жива и остальная шапка — лого и "на главную" не потеряны.
    expect(screen.getByTitle('На главную')).toBeTruthy()
    expect(screen.getByText('← на главную')).toBeTruthy()
  })

  // Phase 2: словарь (скачать/загрузить), «Перестроить маршрут», «свой URL»
  // + подписи-примеры на RoutePage (RouteToolsPanel).
  describe('Phase 2 — RouteToolsPanel (словарь/перестроить/URL/примеры)', () => {
    it('п.D: «Скачать словарь» триггерит скачивание flib-vocab.json (активна и на пустом словаре)', () => {
      seedRoute([step({ id: 'r1', status: 'current' })])
      const anchorClickSpy = vi.fn()
      const realCreateElement = document.createElement.bind(document)
      const createSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const el = realCreateElement(tag)
        if (tag === 'a') el.click = anchorClickSpy
        return el
      })
      renderRoute()

      fireEvent.click(screen.getByRole('button', { name: /Скачать словарь/ }))

      expect(anchorClickSpy).toHaveBeenCalledTimes(1)
      createSpy.mockRestore()
    })

    it('п.D: «Загрузить словарь» через файл добавляет слова в flib:vocab и показывает сколько добавлено', async () => {
      seedRoute([step({ id: 'r1', status: 'current' })])
      renderRoute()

      const file = new File(['cat, dog, fox'], 'my-words.txt', { type: 'text/plain' })
      const input = screen.getByLabelText('Загрузить файл словаря') as HTMLInputElement
      fireEvent.change(input, { target: { files: [file] } })

      await waitFor(() => expect(screen.getByText(/Добавлено 3 слова/)).toBeTruthy())
      const vocab = loadVocab()
      expect(Object.keys(vocab.words).sort()).toEqual(['cat', 'dog', 'fox'])
      expect(vocab.words.cat.source).toBe('upload')
    })

    it('п.E: «↻ Перестроить» у current-шага собирает маршрут с point_a=слова из flib:vocab, goal_ids из flib:pointA', async () => {
      savePointA({ kind: 'cefr', level: 'B1', ageBand: 20, goals: ['friends'], savedAt: new Date().toISOString() })
      seedRoute([step({ id: 'r1', status: 'current' })], { settings: { profile: 'comfort' } })
      addWords(['cat', 'dog'], 'learned')
      const fetchMock = stubBuildRouteDone('job-restructure', 'Friends', oneVideoStepDTO('vid00000001', 'Rebuilt'))

      renderRoute()
      fireEvent.click(screen.getByRole('button', { name: /Перестроить/ }))

      await waitFor(() => expect(screen.getByText('Маршрут готов')).toBeTruthy())
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
      expect(body.point_a).toEqual({ kind: 'words', words: ['cat', 'dog'] })
      expect(body.goal_ids).toEqual(['friends'])
      expect(body.profile).toBe('comfort') // профиль уже собранного маршрута, не дефолтный
    })

    it('п.F: валидная ссылка YouTube в поле + «Открыть» → navigate("/player?v=<id>")', () => {
      seedRoute([step({ id: 'r1', status: 'current' })])
      renderRoute()

      const input = screen.getByPlaceholderText(/Своя ссылка YouTube/)
      fireEvent.change(input, { target: { value: 'https://youtu.be/dQw4w9WgXcQ' } })
      fireEvent.click(screen.getByRole('button', { name: 'Открыть' }))

      expect(navigateMock).toHaveBeenCalledWith('/player?v=dQw4w9WgXcQ')
    })

    it('п.F: кривой ввод в «Открыть» — мягкая ошибка, без navigate', () => {
      seedRoute([step({ id: 'r1', status: 'current' })])
      renderRoute()

      const input = screen.getByPlaceholderText(/Своя ссылка YouTube/)
      fireEvent.change(input, { target: { value: 'не ссылка и не id' } })
      fireEvent.click(screen.getByRole('button', { name: 'Открыть' }))

      expect(navigateMock).not.toHaveBeenCalled()
      expect(screen.getByText(/Не похоже на ссылку YouTube/)).toBeTruthy()
    })

    it('п.F: пустое поле + клик по подписи-примеру → подсказка «введи слово», без сети', () => {
      seedRoute([step({ id: 'r1', status: 'current' })])
      renderRoute()

      fireEvent.click(screen.getByRole('button', { name: 'Примеры YouTube' }))

      expect(screen.getByText('Сначала введите слово')).toBeTruthy()
    })

    it('п.F: слово в поле + клик «Примеры YouTube» открывает «Чат: Видео» с этим словом', async () => {
      seedRoute([step({ id: 'r1', status: 'current' })])
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ word: 'controlled', items: [] })))
      renderRoute()

      const input = screen.getByPlaceholderText(/Своя ссылка YouTube/)
      fireEvent.change(input, { target: { value: 'controlled' } })
      fireEvent.click(screen.getByRole('button', { name: 'Примеры YouTube' }))

      await waitFor(() => expect(screen.getByTestId('vcp-message').textContent).toContain('controlled'))
      expect(screen.getByTestId('video-chat-panel').className).toContain('open')
    })

    it('«↻ Перестроить» рендерится только у current-шага, не у done/next/locked', () => {
      seedRoute([
        step({ id: 'r1', status: 'done' }),
        step({ id: 'r2', status: 'current', title: 'Step2' }),
        step({ id: 'r3', status: 'next', title: 'Step3' }),
      ])
      renderRoute()
      expect(screen.getAllByRole('button', { name: /Перестроить/ })).toHaveLength(1)
    })
  })

  // ТЗ-replace-video [ID:P-replace-video]: кнопка ↻ «Заменить» на video-шаге
  // маршрута → окошко с причиной → фидбек verdict='replace' + перестройка
  // маршрута С ЭТОГО МЕСТА (префикс сохраняется).
  describe('«↻ Заменить» видео с причиной (ТЗ-replace-video)', () => {
    function jobDoneStub(jobId: string, goalLabel: string, dtoSteps: unknown[], feedbackOk = true) {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(jsonResponse({}, feedbackOk, feedbackOk ? 204 : 500)) // POST /api/feedback/video
        .mockResolvedValueOnce(jsonResponse({ job_id: jobId }, true, 202)) // POST /api/route
        .mockResolvedValueOnce(jsonResponse({ status: 'done', route: { goal_label: goalLabel, steps: dtoSteps }, error: '' })) // GET job
      vi.stubGlobal('fetch', fetchMock)
      return fetchMock
    }

    it('«↻ Заменить» есть у непройденных video-шагов (current/next), НЕТ у done/words/цели', () => {
      seedRoute([
        step({ id: 'r1', status: 'done', title: 'Done' }),
        step({ id: 'r2', status: 'current', title: 'Current' }),
        step({ id: 'r3', status: 'next', title: 'Next' }),
        step({ id: 'r4', kind: 'words', videoId: null, status: 'next', words: ['a'], title: 'Words' }),
      ])
      renderRoute()
      // ровно 2 кнопки «Заменить» — Current и Next, не Done и не Words.
      expect(screen.getAllByRole('button', { name: /Заменить/ })).toHaveLength(2)
      // карточка цели — отдельный блок (rl-goal-item), не должна нести кнопку.
      const goalItem = document.querySelector('.rl-goal-item') as HTMLElement
      expect(goalItem.querySelector('.rl-replace-btn')).toBeNull()
    })

    it('видео-шаг без videoId — кнопка «Заменить» присутствует, но задизейблена', () => {
      seedRoute([step({ id: 'r1', status: 'current', videoId: null })])
      renderRoute()
      const btn = screen.getByRole('button', { name: /Заменить/ }) as HTMLButtonElement
      expect(btn.disabled).toBe(true)
    })

    it('клик по «↻ Заменить» открывает окошко «Почему Вы хотите заменить это видео?»', () => {
      seedRoute([step({ id: 'r1', status: 'current' })])
      renderRoute()
      fireEvent.click(screen.getByRole('button', { name: /Заменить/ }))
      expect(screen.getByText('Почему Вы хотите заменить это видео?')).toBeTruthy()
      // Submit задизейблен, пока причина пуста.
      const submitBtn = screen.getByRole('button', { name: 'Заменить' })
      expect((submitBtn as HTMLButtonElement).disabled).toBe(true)
    })

    it('отмена модалки не шлёт ничего (ни фидбек, ни сборку)', () => {
      seedRoute([step({ id: 'r1', status: 'current' })])
      renderRoute()
      fireEvent.click(screen.getByRole('button', { name: /Заменить/ }))
      expect(screen.getByText('Почему Вы хотите заменить это видео?')).toBeTruthy()

      fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))

      expect(screen.queryByText('Почему Вы хотите заменить это видео?')).toBeNull()
      // Дефолтный fetch-мок из beforeEach реджектит — если бы ушёл хоть один
      // вызов, тест упал бы асинхронно (необработанный reject проверяем
      // синхронно через отсутствие building-состояния).
      expect(screen.queryByText('Собираем маршрут…')).toBeNull()
    })

    // [ID:P-exclude-video] галка «убрать весь канал автора» + проброс
    // exclude_video_ids / exclude_channels_of_video_ids в тело сборки.
    it('галка «Больше не показывать видео этого автора» присутствует и по умолчанию НЕ отмечена', () => {
      seedRoute([step({ id: 'r1', status: 'current', videoId: 'vidreplace1' })])
      renderRoute()
      fireEvent.click(screen.getByRole('button', { name: /Заменить/ }))
      const cb = screen.getByRole('checkbox', { name: /Больше не показывать видео этого автора/ }) as HTMLInputElement
      expect(cb.checked).toBe(false)
    })

    it('submit БЕЗ галки → exclude_video_ids несёт видео, exclude_channels_of_video_ids НЕ шлётся', async () => {
      savePointA({ kind: 'cefr', level: 'B1', ageBand: 20, goals: ['friends'], savedAt: new Date().toISOString() })
      seedRoute([step({ id: 'r1', status: 'current', videoId: 'vidreplace1' })])
      const fetchMock = jobDoneStub('job-excl1', 'Friends', oneVideoStepDTO('vidnew00001', 'Repl'))

      renderRoute()
      fireEvent.click(screen.getByRole('button', { name: /Заменить/ }))
      fireEvent.change(screen.getByLabelText('Причина замены'), { target: { value: 'не то' } })
      fireEvent.click(screen.getByRole('button', { name: 'Заменить' }))

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
      const body = JSON.parse(fetchMock.mock.calls[1][1].body as string)
      expect(body.exclude_video_ids).toEqual(['vidreplace1'])
      // Галка не стояла → канальный ключ вообще не в теле (omit, не пустой массив).
      expect('exclude_channels_of_video_ids' in body).toBe(false)
    })

    it('submit С галкой → exclude_channels_of_video_ids несёт тот же video_id (демон резолвит канал)', async () => {
      savePointA({ kind: 'cefr', level: 'B1', ageBand: 20, goals: ['friends'], savedAt: new Date().toISOString() })
      seedRoute([step({ id: 'r1', status: 'current', videoId: 'vidreplace1' })])
      const fetchMock = jobDoneStub('job-excl2', 'Friends', oneVideoStepDTO('vidnew00002', 'Repl'))

      renderRoute()
      fireEvent.click(screen.getByRole('button', { name: /Заменить/ }))
      fireEvent.change(screen.getByLabelText('Причина замены'), { target: { value: 'канал не мой' } })
      fireEvent.click(screen.getByRole('checkbox', { name: /Больше не показывать видео этого автора/ }))
      fireEvent.click(screen.getByRole('button', { name: 'Заменить' }))

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
      const body = JSON.parse(fetchMock.mock.calls[1][1].body as string)
      expect(body.exclude_video_ids).toEqual(['vidreplace1'])
      expect(body.exclude_channels_of_video_ids).toEqual(['vidreplace1'])
    })

    it('submit шлёт И фидбек verdict="replace"+comment, И запускает сборку с point_a=слова из flib:vocab', async () => {
      savePointA({ kind: 'cefr', level: 'B1', ageBand: 20, goals: ['friends'], savedAt: new Date().toISOString() })
      seedRoute([step({ id: 'r1', status: 'current', videoId: 'vidreplace1' })], { settings: { profile: 'comfort' } })
      addWords(['cat', 'dog'], 'learned')
      const fetchMock = jobDoneStub('job-replace', 'Friends', oneVideoStepDTO('vidnew00001', 'Replacement'))

      renderRoute()
      fireEvent.click(screen.getByRole('button', { name: /Заменить/ }))
      const textarea = screen.getByLabelText('Причина замены')
      fireEvent.change(textarea, { target: { value: 'Слишком быстрый темп речи' } })
      fireEvent.click(screen.getByRole('button', { name: 'Заменить' }))

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))

      // Вызов 1 — фидбек.
      expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/feedback/video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          anon_id: 'anon-test', video_id: 'vidreplace1', verdict: 'replace', comment: 'Слишком быстрый темп речи',
        }),
      })

      // Вызов 2 — сборка с этого места: point_a = слова из flib:vocab (НЕ
      // исходная точка А), profile — из уже собранного маршрута.
      const body = JSON.parse(fetchMock.mock.calls[1][1].body as string)
      expect(body.point_a).toEqual({ kind: 'words', words: ['cat', 'dog'] })
      expect(body.goal_ids).toEqual(['friends'])
      expect(body.profile).toBe('comfort')

      await waitFor(() => {
        const stored = loadRoute()
        expect(stored?.steps.some(s => s.title === 'Replacement')).toBe(true)
      })
      // Окошко закрылось сразу на submit.
      expect(screen.queryByText('Почему Вы хотите заменить это видео?')).toBeNull()
    })

    it('замена сразу после ПЕРВОЙ сборки (fresh=true) убирает FreshBanner, показывает обычный route-head (аудит MED)', async () => {
      // Без seedRoute: маршрута ещё нет, есть только точка А → mount-эффект
      // строит маршрут с нуля, fresh становится true, показывается
      // FreshBanner. Список шагов с кнопками ↻ рендерится ПОД баннером.
      savePointA({ kind: 'cefr', level: 'B1', ageBand: 20, goals: ['friends'], savedAt: new Date().toISOString() })
      const fetchMock = vi.fn()
        // Первая сборка (mount-эффект): POST /api/route + GET job + materialize (cefr)
        .mockResolvedValueOnce(jsonResponse({ job_id: 'job-first' }, true, 202))
        .mockResolvedValueOnce(jsonResponse({ status: 'done', route: { goal_label: 'Friends', steps: oneVideoStepDTO('vid00000001', 'FirstVid') }, error: '' }))
        .mockResolvedValueOnce(jsonResponse({ level: 'B1', words: [] })) // materializeVocabFromPointA (cefr dict)
        // Замена: фидбек + POST /api/route + GET job
        .mockResolvedValueOnce(jsonResponse({}, true, 204))
        .mockResolvedValueOnce(jsonResponse({ job_id: 'job-repl' }, true, 202))
        .mockResolvedValueOnce(jsonResponse({ status: 'done', route: { goal_label: 'Friends', steps: oneVideoStepDTO('vid00000002', 'ReplVid') }, error: '' }))
      vi.stubGlobal('fetch', fetchMock)

      renderRoute()
      await waitFor(() => expect(screen.getByText('Маршрут готов')).toBeTruthy()) // FreshBanner виден

      fireEvent.click(screen.getByRole('button', { name: /Заменить/ }))
      fireEvent.change(screen.getByLabelText('Причина замены'), { target: { value: 'не то' } })
      fireEvent.click(screen.getByRole('button', { name: 'Заменить' }))

      await waitFor(() => expect(loadRoute()?.steps.some(s => s.title === 'ReplVid')).toBe(true))
      // После замены FreshBanner исчез — обычный route-head с прогрессом.
      expect(screen.queryByText('Маршрут готов')).toBeNull()
      expect(screen.queryByRole('button', { name: /Смотреть первое видео/ })).toBeNull()
    })

    it('Escape закрывает окошко замены (аудит MED — конвенция модалок файла)', () => {
      seedRoute([step({ id: 'r1', status: 'current' })])
      renderRoute()
      fireEvent.click(screen.getByRole('button', { name: /Заменить/ }))
      expect(screen.getByText('Почему Вы хотите заменить это видео?')).toBeTruthy()
      fireEvent.keyDown(window, { key: 'Escape' })
      expect(screen.queryByText('Почему Вы хотите заменить это видео?')).toBeNull()
    })

    it('склейка: заменяется ТОЛЬКО заменяемый шаг и всё после него — префикс (пройденное) остаётся', async () => {
      savePointA({ kind: 'cefr', level: 'B1', ageBand: 20, goals: ['friends'], savedAt: new Date().toISOString() })
      seedRoute([
        step({ id: 'r1', status: 'done', title: 'Done1', durationSec: 60 }),
        step({ id: 'r2', status: 'current', title: 'ToReplace', durationSec: 60 }),
      ])
      const fetchMock = jobDoneStub('job-splice', 'Friends', oneVideoStepDTO('vidnew00002', 'NewOne'))

      renderRoute()
      fireEvent.click(screen.getByRole('button', { name: /Заменить/ }))
      fireEvent.change(screen.getByLabelText('Причина замены'), { target: { value: 'не мой уровень' } })
      fireEvent.click(screen.getByRole('button', { name: 'Заменить' }))

      await waitFor(() => {
        const stored = loadRoute()
        expect(stored?.steps.map(s => s.title)).toEqual(['Done1', 'NewOne'])
      })
      const stored = loadRoute()
      expect(stored?.steps[0].status).toBe('done') // префикс не тронут
      expect(stored?.steps[1].status).toBe('current') // первый не-done видимый шаг
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })
  })

  // [ID:P-film-picker] contract v2 2026-07-16 §3.7 — CRIT [R2]: filmTargetOf(pointA)
  // ДОЛЖЕН протаскиваться во ВСЕ ТРИ call site (runBuild/handleRestructure/
  // handleReplaceVideo), иначе «Перестроить»/«Заменить» на film-маршруте шлют
  // goal_ids:[]+targets:[] → BFF 400 missing_target. Регресс-тест на этот CRIT.
  describe('targets threading — filmGoal во ВСЕХ 3 путях сборки (contract §3.7 CRIT)', () => {
    function filmPointA() {
      savePointA({
        kind: 'cefr', level: 'B1', ageBand: 20, goals: [], interests: [],
        filmGoal: { slug: 'the-wire', title: 'The Wire', kind: 'series', target: 'the-wire' },
        savedAt: new Date().toISOString(),
      })
    }

    it('1) runBuild (mount-эффект): body.targets несёт filmGoal.target, goal_ids пуст', async () => {
      filmPointA()
      const fetchMock = stubBuildRouteDone('job-film-1', 'The Wire', oneVideoStepDTO('vid00000001'))
      renderRoute()
      await waitFor(() => expect(screen.getByText('Маршрут готов')).toBeTruthy())

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
      expect(body.targets).toEqual(['the-wire'])
      expect(body.goal_ids).toEqual([])
    })

    it('2) handleRestructure («↻ Перестроить»): body.targets несёт filmGoal.target', async () => {
      filmPointA()
      seedRoute([step({ id: 'r1', status: 'current' })], { settings: { profile: 'comfort' } })
      const fetchMock = stubBuildRouteDone('job-film-2', 'The Wire', oneVideoStepDTO('vid00000002', 'Rebuilt'))

      renderRoute()
      fireEvent.click(screen.getByRole('button', { name: /Перестроить/ }))

      await waitFor(() => expect(screen.getByText('Маршрут готов')).toBeTruthy())
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
      expect(body.targets).toEqual(['the-wire'])
      expect(body.goal_ids).toEqual([])
    })

    it('3) handleReplaceVideo («↻ Заменить»): body.targets несёт filmGoal.target (второй fetch — сборка, первый — фидбек)', async () => {
      filmPointA()
      seedRoute([step({ id: 'r1', status: 'current', videoId: 'vidreplace1' })])
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(jsonResponse({}, true, 204)) // POST /api/feedback/video
        .mockResolvedValueOnce(jsonResponse({ job_id: 'job-film-3' }, true, 202)) // POST /api/route
        .mockResolvedValueOnce(jsonResponse({ status: 'done', route: { goal_label: 'The Wire', steps: oneVideoStepDTO('vidnew00003', 'Repl') }, error: '' }))
      vi.stubGlobal('fetch', fetchMock)

      renderRoute()
      fireEvent.click(screen.getByRole('button', { name: /Заменить/ }))
      fireEvent.change(screen.getByLabelText('Причина замены'), { target: { value: 'не то' } })
      fireEvent.click(screen.getByRole('button', { name: 'Заменить' }))

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
      const body = JSON.parse(fetchMock.mock.calls[1][1].body as string) // 2-й вызов — сборка
      expect(body.targets).toEqual(['the-wire'])
      expect(body.goal_ids).toEqual([])
    })

    it('regular (non-film) pointA: targets key stays OMITTED in all paths — no regression on the fixed-goal flow', async () => {
      savePointA({ kind: 'cefr', level: 'B1', ageBand: 20, goals: ['friends'], savedAt: new Date().toISOString() })
      const fetchMock = stubBuildRouteDone('job-nofilm', 'Friends', oneVideoStepDTO('vid00000001'))
      renderRoute()
      await waitFor(() => expect(screen.getByText('Маршрут готов')).toBeTruthy())

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
      expect('targets' in body).toBe(false)
      expect(body.goal_ids).toEqual(['friends'])
    })
  })

  // [ID:P-abstract-goals] contract §1 §2.5 — CRIT (тот же класс, что §3.7
  // filmTargetOf выше): goalOf(pointA).goal ДОЛЖЕН протаскиваться во ВСЕ ТРИ
  // call site (runBuild/handleRestructure/handleReplaceVideo), иначе
  // «Перестроить»/«Заменить» на мультицели молча теряют цель.
  describe('goalsV2 → goal block threading (contract §1 §2.5, golden fixture)', () => {
    // Golden fixture (docs/impl-contract-2026-07-16-phase1-wizard-goals.md,
    // scratchpad/golden-goal-fixture.md) — ДОСЛОВНО тот же вход/выход, что
    // ассертит BFF-агент (рассинхрон ловится именно тут).
    const GOLDEN_GOALS_V2 = [
      { type: 'puzzle' as const, slug: 'the-wire', title: 'Прослушка', kind: 'series' as const, target: 'the-wire' },
      { type: 'puzzle' as const, slug: 'casino-1995', title: 'Казино', kind: 'film' as const, target: 'casino-1995/casino-1995' },
      { type: 'category' as const, key: 'science', title: 'Наука' },
      { type: 'youtube' as const, videoId: 'dQw4w9WgXcQ', url: 'https://youtu.be/dQw4w9WgXcQ' },
      { type: 'custom' as const, id: 'c1', text: 'хочу понимать лекции по ML' },
    ]
    const GOLDEN_GOAL_BLOCK = {
      puzzle_ids: ['the-wire', 'casino-1995/casino-1995', 'youtube::dQw4w9WgXcQ'],
      categories: ['science'],
      text_queries: ['хочу понимать лекции по ML'],
      // Правка 3 [ID:P-abstract-goals]: D3 «фронт не шлёт label» отменена —
      // русские названия (goalsV2[].title) есть ТОЛЬКО у клиента, BFF-фолбэк
      // prettySlugTitle даёт английские. golden-goal-fixture.md §«Выход (BFF
      // → демон)» — join(' + ') в порядке goalsV2, youtube→"YouTube: <id>".
      label: 'Прослушка + Казино + Наука + Мои ролики (1) + «хочу понимать лекции по ML»',
    }

    function goalsV2PointA() {
      savePointA({
        kind: 'cefr', level: 'B1', ageBand: 20, interests: [],
        goalsV2: GOLDEN_GOALS_V2, goals: [], filmGoal: undefined,
        savedAt: new Date().toISOString(),
      })
    }

    it('1) runBuild (mount-эффект): body.goal — точно golden fixture, goal_ids:[], no "targets" key', async () => {
      goalsV2PointA()
      const fetchMock = stubBuildRouteDone('job-goalsv2-1', 'Смешанный маршрут', oneVideoStepDTO('vid00000001'))
      renderRoute()
      await waitFor(() => expect(screen.getByText('Маршрут готов')).toBeTruthy())

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
      expect(body.goal).toEqual(GOLDEN_GOAL_BLOCK)
      expect(body.goal_ids).toEqual([])
      expect('targets' in body).toBe(false)
    })

    it('2) handleRestructure («↻ Перестроить»): body.goal — golden fixture', async () => {
      goalsV2PointA()
      seedRoute([step({ id: 'r1', status: 'current' })], { settings: { profile: 'comfort' } })
      const fetchMock = stubBuildRouteDone('job-goalsv2-2', 'Смешанный маршрут', oneVideoStepDTO('vid00000002', 'Rebuilt'))

      renderRoute()
      fireEvent.click(screen.getByRole('button', { name: /Перестроить/ }))

      await waitFor(() => expect(screen.getByText('Маршрут готов')).toBeTruthy())
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
      expect(body.goal).toEqual(GOLDEN_GOAL_BLOCK)
      expect(body.goal_ids).toEqual([])
    })

    it('3) handleReplaceVideo («↻ Заменить»): body.goal — golden fixture (второй fetch — сборка)', async () => {
      goalsV2PointA()
      seedRoute([step({ id: 'r1', status: 'current', videoId: 'vidreplace1' })])
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(jsonResponse({}, true, 204)) // POST /api/feedback/video
        .mockResolvedValueOnce(jsonResponse({ job_id: 'job-goalsv2-3' }, true, 202)) // POST /api/route
        .mockResolvedValueOnce(jsonResponse({ status: 'done', route: { goal_label: 'Смешанный маршрут', steps: oneVideoStepDTO('vidnew00003', 'Repl') }, error: '' }))
      vi.stubGlobal('fetch', fetchMock)

      renderRoute()
      fireEvent.click(screen.getByRole('button', { name: /Заменить/ }))
      fireEvent.change(screen.getByLabelText('Причина замены'), { target: { value: 'не то' } })
      fireEvent.click(screen.getByRole('button', { name: 'Заменить' }))

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
      const body = JSON.parse(fetchMock.mock.calls[1][1].body as string)
      expect(body.goal).toEqual(GOLDEN_GOAL_BLOCK)
      expect(body.goal_ids).toEqual([])
    })

    // [ID:P-abstract-goals] Правка 2 (аудит HIGH): раньше catalog-fallback
    // целей (Q5-b) был отдельный `{type:'goal'}` вариант, уходивший как
    // legacy `goal_ids` МИМО блока `goal` — смешанный случай «фолбэк-цель +
    // категория» терял фолбэк-цель молча (BFF при Goal!=nil legacy goal_ids
    // не читает вовсе) и давал 400 unknown_goal_id (STATIC_GOALS id'шники не
    // существуют на сервере). Вариант `goal` УДАЛЁН из GoalItemV2 — теперь
    // fetchGoals()-фолбэк это ОБЫЧНЫЙ `puzzle` (TryPage.tsx toggleFallbackGoal),
    // поэтому смешанный кейс просто работает через один и тот же `goal` блок,
    // никакой спец-ветки/потери цели.
    it('catalog-fallback puzzle item (from fetchGoals, real target) mixed with a category → single "goal" block, both survive', async () => {
      savePointA({
        kind: 'cefr', level: 'B1', ageBand: 20, interests: [],
        goalsV2: [
          { type: 'puzzle', slug: 'friends', title: 'Friends', kind: 'series', target: 'friends-light/s01e01' },
          { type: 'category', key: 'science', title: 'Наука' },
        ],
        goals: [], filmGoal: undefined, savedAt: new Date().toISOString(),
      })
      const fetchMock = stubBuildRouteDone('job-fallback', 'Friends + Наука', oneVideoStepDTO('vid00000001'))
      renderRoute()
      await waitFor(() => expect(screen.getByText('Маршрут готов')).toBeTruthy())

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
      expect(body.goal).toEqual({
        puzzle_ids: ['friends-light/s01e01'],
        categories: ['science'],
        label: 'Friends + Наука',
      })
      expect(body.goal_ids).toEqual([])
      expect('targets' in body).toBe(false)
    })

    it('empty goalsV2 array: falls back fully to legacy filmGoal/goals (no regression on old records)', async () => {
      savePointA({
        kind: 'cefr', level: 'B1', ageBand: 20, interests: [],
        goalsV2: [], goals: ['friends'], filmGoal: undefined, savedAt: new Date().toISOString(),
      })
      const fetchMock = stubBuildRouteDone('job-empty-goalsv2', 'Friends', oneVideoStepDTO('vid00000001'))
      renderRoute()
      await waitFor(() => expect(screen.getByText('Маршрут готов')).toBeTruthy())

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
      expect(body.goal_ids).toEqual(['friends'])
      expect('goal' in body).toBe(false)
    })
  })
})
