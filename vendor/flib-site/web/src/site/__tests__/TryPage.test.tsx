// TryPage.test.tsx — /try, 3-шаговый визард (contract v2 2026-07-16
// [ID:P-abstract-goals] §1 D7/§2.2). Заменяет ПОЛНОСТЬЮ старые TryPage.test.tsx
// (single-select FilmPicker-модалка) и interests.test.tsx (их сценарии
// либо больше не применимы к новому UI, либо перенесены сюда как часть
// шага 3 визарда) — TryPage переписан на другую модель (мультивыбор целей,
// шаги вместо одностраничной анкеты).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { TryPage } from '../TryPage'
import { resetPuzzleCatalogCache } from '../usePuzzleCatalog'
import { INTERESTS, GOAL_CATEGORIES } from '../data'

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body }
}

/** Роутер по URL — TryPage бьёт по ДВУМ разным ручкам (/api/goals,
 *  /api/puzzle/catalog) через один и тот же global fetch. */
function routedFetch(handlers: Record<string, () => unknown>) {
  return vi.fn((url: string) => {
    const h = handlers[url]
    if (!h) return Promise.reject(new Error(`unexpected fetch in test: ${url}`))
    return Promise.resolve(h())
  })
}

// title_ru пуст — displayTitle предпочитает title_ru, ассерты завязаны на
// английские названия.
const CATALOG_ITEMS = [
  { slug: 'the-wire', title_en: 'The Wire', title_ru: '', media_type: 2, release_year: 2002, popularity: 90, seasons: 5, episodes: 60 },
  { slug: 'inception-2010', title_en: 'Inception', title_ru: '', media_type: 3, release_year: 2010, popularity: 80, seasons: 0, episodes: 0 },
]

const navigateMock = vi.fn()
vi.mock('react-router-dom', async importOriginal => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => navigateMock }
})

function renderTry(initialPath = '/try') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/try" element={<TryPage />} />
        <Route path="/route" element={<div>Ваш маршрут (плейсхолдер)</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

function goToStep2WithLiveCatalog() {
  vi.stubGlobal('fetch', routedFetch({
    '/api/goals': () => jsonResponse({ goals: [] }),
    '/api/puzzle/catalog': () => jsonResponse({ items: CATALOG_ITEMS, total: 2 }),
  }))
  renderTry()
  fireEvent.click(screen.getByRole('button', { name: /Далее/ }))
}

function goToStep2WithOfflineCatalog() {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
  renderTry()
  fireEvent.click(screen.getByRole('button', { name: /Далее/ }))
}

describe('TryPage — визард (contract v2 [ID:P-abstract-goals])', () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetPuzzleCatalogCache()
    navigateMock.mockClear()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('шаг 1 — уровень и возраст', () => {
    it('renders step 1 by default, "Назад" absent, "Далее" enabled (no gating on step 1)', () => {
      renderTry()
      expect(screen.getByText('Ваш уровень и возраст')).toBeTruthy()
      expect(screen.queryByRole('button', { name: /Назад/ })).toBeNull()
      const nextBtn = screen.getByRole('button', { name: /Далее/ }) as HTMLButtonElement
      expect(nextBtn.disabled).toBe(false)
    })

    it('CEFR chip toggles "on", age slider updates the displayed value', () => {
      renderTry()
      const c1 = screen.getByRole('button', { name: /^C1/ })
      fireEvent.click(c1)
      expect(c1.className).toContain('on')
      fireEvent.change(screen.getByLabelText('Возраст'), { target: { value: '40' } })
      expect(screen.getByText('40')).toBeTruthy()
    })

    it('"Далее" advances to step 2', () => {
      renderTry()
      fireEvent.click(screen.getByRole('button', { name: /Далее/ }))
      expect(screen.getByText('Что хотите понимать?')).toBeTruthy()
    })
  })

  describe('шаг 2 — цели: прямое добавление тапом (D7 Q3-a)', () => {
    it('"Далее" is disabled with zero goals, enabled once a goal is added', async () => {
      goToStep2WithLiveCatalog()
      const nextBtn = screen.getByRole('button', { name: /Далее/ }) as HTMLButtonElement
      expect(nextBtn.disabled).toBe(true)

      await waitFor(() => expect(screen.getByRole('button', { name: /Inception/ })).toBeTruthy())
      fireEvent.click(screen.getByRole('button', { name: /Inception/ }))
      expect(nextBtn.disabled).toBe(false)
    })

    it('tapping a title card adds it directly (no "Добавить" step) — chip appears immediately, card is visually selected', async () => {
      goToStep2WithLiveCatalog()
      await waitFor(() => expect(screen.getByRole('button', { name: /The Wire/ })).toBeTruthy())
      const card = screen.getByRole('button', { name: /The Wire/ })
      fireEvent.click(card)

      expect(card.className).toContain('selected')
      expect(screen.getByText('The Wire', { selector: '.fp-selchip' })).toBeTruthy()
    })

    it('tapping an already-selected title card again REMOVES it (toggle), chip disappears', async () => {
      goToStep2WithLiveCatalog()
      await waitFor(() => expect(screen.getByRole('button', { name: /The Wire/ })).toBeTruthy())
      const card = screen.getByRole('button', { name: /The Wire/ })
      fireEvent.click(card)
      expect(screen.getByText('The Wire', { selector: '.fp-selchip' })).toBeTruthy()

      fireEvent.click(card)
      expect(screen.queryByText('The Wire', { selector: '.fp-selchip' })).toBeNull()
      expect(card.className).not.toContain('selected')
    })

    it('the ✕ on a chip removes the goal (same effect as re-tapping the card)', async () => {
      goToStep2WithLiveCatalog()
      await waitFor(() => expect(screen.getByRole('button', { name: /The Wire/ })).toBeTruthy())
      fireEvent.click(screen.getByRole('button', { name: /The Wire/ }))
      expect(screen.getByText('The Wire', { selector: '.fp-selchip' })).toBeTruthy()

      fireEvent.click(screen.getByRole('button', { name: /убрать цель: The Wire/ }))
      expect(screen.queryByText('The Wire', { selector: '.fp-selchip' })).toBeNull()
    })

    it('multi-select: two DIFFERENT titles both accumulate as chips (not single-select, unlike the old FilmPicker)', async () => {
      goToStep2WithLiveCatalog()
      await waitFor(() => expect(screen.getByRole('button', { name: /The Wire/ })).toBeTruthy())
      fireEvent.click(screen.getByRole('button', { name: /The Wire/ }))
      fireEvent.click(screen.getByRole('button', { name: /Inception/ }))

      expect(screen.getByText('The Wire', { selector: '.fp-selchip' })).toBeTruthy()
      expect(screen.getByText('Inception', { selector: '.fp-selchip' })).toBeTruthy()
    })

    it('a category button in "Групповые цели" adds a chip directly on tap; second tap removes it', async () => {
      goToStep2WithLiveCatalog()
      fireEvent.click(screen.getByRole('tab', { name: 'Групповые цели' }))
      const scienceBtn = screen.getByRole('button', { name: 'Наука' })
      fireEvent.click(scienceBtn)
      expect(screen.getByText('Наука', { selector: '.fp-selchip' })).toBeTruthy()
      expect(scienceBtn.className).toContain('on')

      fireEvent.click(scienceBtn)
      expect(screen.queryByText('Наука', { selector: '.fp-selchip' })).toBeNull()
    })

    // Все 14 категорий показываются (contract D4-BIS, правка после сверки с
    // реальным демоном): демон goal.categories НЕ резолвит вообще (CAPTURED
    // ONLY) — любая кнопка работает лишь потому, что BFF подставляет ей слова
    // из ETL-словаря, а он готов для всех 14 ключей. Прежнее деление на
    // «сильные 9» и «слабые 5» было основано на несуществующей механике
    // (якобы демон агрегирует live-категории сам).
    it('all 14 category keys render as buttons', async () => {
      goToStep2WithLiveCatalog()
      fireEvent.click(screen.getByRole('tab', { name: 'Групповые цели' }))
      const grid = document.querySelector('.wizard-category-grid') as HTMLElement
      expect(within(grid).getAllByRole('button')).toHaveLength(14)
      expect(within(grid).getByRole('button', { name: 'Стендапы' })).toBeTruthy()
      expect(within(grid).getByRole('button', { name: 'Кулинария' })).toBeTruthy()
    })

    // Гарантия белого списка: каждый показанный ключ ОБЯЗАН иметь словарную
    // статью, иначе цель-одиночка получит 400 goal_not_resolved от BFF.
    // Синхронность GOAL_CATEGORIES ↔ category_dicts.json проверяется на
    // BFF-стороне (Go-тест), тут — что фронт не рисует ключей вне каталога.
    it('rendered category buttons match GOAL_CATEGORIES exactly', async () => {
      goToStep2WithLiveCatalog()
      fireEvent.click(screen.getByRole('tab', { name: 'Групповые цели' }))
      const grid = document.querySelector('.wizard-category-grid') as HTMLElement
      const rendered = within(grid).getAllByRole('button').map(b => b.textContent?.trim())
      expect(rendered).toEqual(GOAL_CATEGORIES.map(c => c.title))
    })

    it('switching tabs (titles ↔ groups) does NOT lose already-selected chips', async () => {
      goToStep2WithLiveCatalog()
      await waitFor(() => expect(screen.getByRole('button', { name: /The Wire/ })).toBeTruthy())
      fireEvent.click(screen.getByRole('button', { name: /The Wire/ }))

      fireEvent.click(screen.getByRole('tab', { name: 'Групповые цели' }))
      fireEvent.click(screen.getByRole('button', { name: 'Наука' }))

      fireEvent.click(screen.getByRole('tab', { name: 'По тайтлам' }))
      expect(screen.getByText('The Wire', { selector: '.fp-selchip' })).toBeTruthy()
      expect(screen.getByText('Наука', { selector: '.fp-selchip' })).toBeTruthy()
    })

    it('the "what is a goal" hint text matches the parent spec verbatim', async () => {
      goToStep2WithLiveCatalog()
      expect(screen.getByText('Цель — то, чему Вы научитесь, посмотрев несколько видео из нашего списка.')).toBeTruthy()
    })

    it('the "mixed route" hint appears only once ≥2 goals are selected', async () => {
      goToStep2WithLiveCatalog()
      expect(screen.queryByText(/несколько целей/i)).toBeNull()
      await waitFor(() => expect(screen.getByRole('button', { name: /The Wire/ })).toBeTruthy())
      fireEvent.click(screen.getByRole('button', { name: /The Wire/ }))
      expect(screen.queryByText(/несколько целей/i)).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: /Inception/ }))
      expect(screen.getByText(/несколько целей = один смешанный маршрут ко всем/i)).toBeTruthy()
    })
  })

  // [ID:P-abstract-goals] Правка 2 (аудит HIGH): фолбэк-карточки строятся
  // ТЕПЕРЬ ТОЛЬКО из живого fetchGoals() (реальные id+target) — STATIC_GOALS
  // (id'шники которых не существуют на сервере, configs/goals.json несёт
  // другой набор) БОЛЬШЕ НЕ используется как выбираемая цель маршрута.
  describe('шаг 2 — фолбэк каталога недоступен (Q5-b, edge #2, Правка 2)', () => {
    it('catalog down + fetchGoals ok → fallback note + fetched goals rendered as selectable PUZZLE-typed cards, addable to goalsV2', async () => {
      vi.stubGlobal('fetch', routedFetch({
        '/api/goals': () => jsonResponse({
          goals: [{ id: 'friends', title: 'Friends', kind: 'Ситком', level: 'B1', target: 'friends-light/s01e01' }],
        }),
        '/api/puzzle/catalog': () => Promise.reject(new Error('catalog down')),
      }))
      renderTry()
      fireEvent.click(screen.getByRole('button', { name: /Далее/ }))
      await waitFor(() => expect(screen.getByText(/каталог фильмов сейчас недоступен/i)).toBeTruthy())

      const friendsCard = screen.getByRole('button', { name: 'Friends' })
      fireEvent.click(friendsCard)
      expect(friendsCard.className).toContain('selected')
      expect(screen.getByText('Friends', { selector: '.fp-selchip' })).toBeTruthy()
      const nextBtn = screen.getByRole('button', { name: /Далее/ }) as HTMLButtonElement
      expect(nextBtn.disabled).toBe(false)
    })

    it('catalog down AND fetchGoals down (or empty) → honest "unavailable" message, NO cards (no STATIC_GOALS safety net, their ids 400 on the server)', async () => {
      goToStep2WithOfflineCatalog()
      await waitFor(() => expect(screen.getByText(/каталог сейчас недоступен — выберите групповую цель на соседней вкладке/i)).toBeTruthy())
      expect(screen.queryByRole('button', { name: 'Friends' })).toBeNull()
    })
  })

  describe('шаг 2 — «Свой пример (YouTube)» (contract D6)', () => {
    it('valid YouTube url adds a "YouTube: <ID>" chip', async () => {
      goToStep2WithLiveCatalog()
      fireEvent.click(screen.getByRole('tab', { name: 'Групповые цели' }))
      fireEvent.click(screen.getByRole('button', { name: /Свой пример/ }))

      fireEvent.change(screen.getByLabelText('Ссылка на YouTube'), { target: { value: 'https://youtu.be/dQw4w9WgXcQ' } })
      fireEvent.click(screen.getByRole('button', { name: 'Добавить' }))

      expect(screen.queryByText('Ссылка на YouTube', { selector: 'h2' })).toBeNull() // dialog closed
      expect(screen.getByText('YouTube: dQw4w9WgXcQ', { selector: '.fp-selchip' })).toBeTruthy()
    })

    it('invalid input shows an inline error, does not add a goal, dialog stays open', async () => {
      goToStep2WithLiveCatalog()
      fireEvent.click(screen.getByRole('tab', { name: 'Групповые цели' }))
      fireEvent.click(screen.getByRole('button', { name: /Свой пример/ }))

      fireEvent.change(screen.getByLabelText('Ссылка на YouTube'), { target: { value: 'not a youtube link' } })
      fireEvent.click(screen.getByRole('button', { name: 'Добавить' }))

      expect(screen.getByText(/Не похоже на ссылку YouTube/)).toBeTruthy()
      expect(screen.getByLabelText('Ссылка на YouTube')).toBeTruthy() // dialog still open
    })

    it('adding the SAME video id twice is a no-op (dedup by videoId)', async () => {
      goToStep2WithLiveCatalog()
      fireEvent.click(screen.getByRole('tab', { name: 'Групповые цели' }))
      fireEvent.click(screen.getByRole('button', { name: /Свой пример/ }))
      fireEvent.change(screen.getByLabelText('Ссылка на YouTube'), { target: { value: 'dQw4w9WgXcQ' } })
      fireEvent.click(screen.getByRole('button', { name: 'Добавить' }))

      fireEvent.click(screen.getByRole('button', { name: /Свой пример/ }))
      fireEvent.change(screen.getByLabelText('Ссылка на YouTube'), { target: { value: 'https://youtu.be/dQw4w9WgXcQ' } })
      fireEvent.click(screen.getByRole('button', { name: 'Добавить' }))

      expect(screen.getAllByText('YouTube: dQw4w9WgXcQ', { selector: '.fp-selchip' })).toHaveLength(1)
    })

    it('Escape / Отмена close the dialog without adding anything', async () => {
      goToStep2WithLiveCatalog()
      fireEvent.click(screen.getByRole('tab', { name: 'Групповые цели' }))
      fireEvent.click(screen.getByRole('button', { name: /Свой пример/ }))
      fireEvent.keyDown(window, { key: 'Escape' })
      expect(screen.queryByLabelText('Ссылка на YouTube')).toBeNull()
      expect(screen.getByText('Пока ничего не выбрано')).toBeTruthy()
    })
  })

  describe('шаг 2 — «Ещё» / свой текст (contract D5)', () => {
    it('non-empty text adds a custom-goal chip with the exact text', async () => {
      goToStep2WithLiveCatalog()
      fireEvent.click(screen.getByRole('tab', { name: 'Групповые цели' }))
      fireEvent.click(screen.getByRole('button', { name: /Ещё/ }))

      fireEvent.change(screen.getByLabelText('Своя цель'), { target: { value: 'хочу понимать лекции по ML' } })
      fireEvent.click(screen.getByRole('button', { name: 'Добавить' }))

      expect(screen.getByText('хочу понимать лекции по ML', { selector: '.fp-selchip' })).toBeTruthy()
    })

    it('"Добавить" is disabled while the textarea is empty or whitespace/zero-width only', async () => {
      goToStep2WithLiveCatalog()
      fireEvent.click(screen.getByRole('tab', { name: 'Групповые цели' }))
      fireEvent.click(screen.getByRole('button', { name: /Ещё/ }))

      const addBtn = screen.getByRole('button', { name: 'Добавить' }) as HTMLButtonElement
      expect(addBtn.disabled).toBe(true)

      fireEvent.change(screen.getByLabelText('Своя цель'), { target: { value: '   ' } })
      expect(addBtn.disabled).toBe(true)

      fireEvent.change(screen.getByLabelText('Своя цель'), { target: { value: '​﻿' } })
      expect(addBtn.disabled).toBe(true)

      fireEvent.change(screen.getByLabelText('Своя цель'), { target: { value: 'ok' } })
      expect(addBtn.disabled).toBe(false)
    })

    it('the textarea has maxLength=280 (native clamp, no server-side truncation needed)', async () => {
      goToStep2WithLiveCatalog()
      fireEvent.click(screen.getByRole('tab', { name: 'Групповые цели' }))
      fireEvent.click(screen.getByRole('button', { name: /Ещё/ }))
      expect((screen.getByLabelText('Своя цель') as HTMLTextAreaElement).maxLength).toBe(280)
    })

    it('two DIFFERENT custom texts both accumulate as separate chips (no dedup for custom)', async () => {
      goToStep2WithLiveCatalog()
      fireEvent.click(screen.getByRole('tab', { name: 'Групповые цели' }))
      fireEvent.click(screen.getByRole('button', { name: /Ещё/ }))
      fireEvent.change(screen.getByLabelText('Своя цель'), { target: { value: 'первая цель' } })
      fireEvent.click(screen.getByRole('button', { name: 'Добавить' }))

      fireEvent.click(screen.getByRole('button', { name: /Ещё/ }))
      fireEvent.change(screen.getByLabelText('Своя цель'), { target: { value: 'вторая цель' } })
      fireEvent.click(screen.getByRole('button', { name: 'Добавить' }))

      expect(screen.getByText('первая цель', { selector: '.fp-selchip' })).toBeTruthy()
      expect(screen.getByText('вторая цель', { selector: '.fp-selchip' })).toBeTruthy()
    })
  })

  describe('навигация: «Назад» сохраняет goalsV2, шаг 3, «Готово»', () => {
    it('"Назад" from step 2 returns to step 1 without losing the goalTab/goalsV2 state, "Далее" moves forward again with goals intact', async () => {
      goToStep2WithLiveCatalog()
      await waitFor(() => expect(screen.getByRole('button', { name: /The Wire/ })).toBeTruthy())
      fireEvent.click(screen.getByRole('button', { name: /The Wire/ }))

      fireEvent.click(screen.getByRole('button', { name: /Назад/ }))
      expect(screen.getByText('Ваш уровень и возраст')).toBeTruthy()

      fireEvent.click(screen.getByRole('button', { name: /Далее/ }))
      expect(screen.getByText('The Wire', { selector: '.fp-selchip' })).toBeTruthy()
    })

    it('reaches step 3 (interests) once ≥1 goal is selected, "Назад" goes back to step 2 with goals intact', async () => {
      goToStep2WithLiveCatalog()
      await waitFor(() => expect(screen.getByRole('button', { name: /The Wire/ })).toBeTruthy())
      fireEvent.click(screen.getByRole('button', { name: /The Wire/ }))
      fireEvent.click(screen.getByRole('button', { name: /Далее/ }))

      expect(screen.getByText('Что Вам интересно?')).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Готово' })).toBeTruthy()
      expect(screen.queryByRole('button', { name: /^Далее/ })).toBeNull()

      fireEvent.click(screen.getByRole('button', { name: /Назад/ }))
      expect(screen.getByText('Что хотите понимать?')).toBeTruthy()
      expect(screen.getByText('The Wire', { selector: '.fp-selchip' })).toBeTruthy()
    })

    it('"Готово" saves a fresh pointA object (goalsV2, empty goals[], no filmGoal key) and navigates to /route', async () => {
      vi.stubGlobal('fetch', routedFetch({
        '/api/goals': () => jsonResponse({ goals: [] }),
        '/api/puzzle/catalog': () => jsonResponse({ items: CATALOG_ITEMS, total: 2 }),
      }))
      renderTry()
      fireEvent.click(screen.getByRole('button', { name: /^B1/ }))
      fireEvent.click(screen.getByRole('button', { name: /Далее/ }))
      await waitFor(() => expect(screen.getByRole('button', { name: /The Wire/ })).toBeTruthy())
      fireEvent.click(screen.getByRole('button', { name: /The Wire/ }))
      fireEvent.click(screen.getByRole('button', { name: /Далее/ }))
      fireEvent.click(screen.getByRole('button', { name: 'Математика' }))
      fireEvent.click(screen.getByRole('button', { name: 'Готово' }))

      expect(navigateMock).toHaveBeenCalledWith('/route')
      const saved = JSON.parse(window.localStorage.getItem('flib:pointA') as string)
      expect(saved.kind).toBe('cefr')
      expect(saved.level).toBe('B1')
      expect(saved.goals).toEqual([])
      expect('filmGoal' in saved).toBe(false) // filmGoal:undefined — JSON.stringify опускает undefined-ключи
      expect(saved.interests).toEqual(['math'])
      expect(saved.goalsV2).toEqual([
        { type: 'puzzle', slug: 'the-wire', title: 'The Wire', kind: 'series', target: 'the-wire' },
      ])
    })

    it('interests are optional — "Готово" with none selected saves an empty interests array', async () => {
      goToStep2WithLiveCatalog()
      await waitFor(() => expect(screen.getByRole('button', { name: /The Wire/ })).toBeTruthy())
      fireEvent.click(screen.getByRole('button', { name: /The Wire/ }))
      fireEvent.click(screen.getByRole('button', { name: /Далее/ }))
      fireEvent.click(screen.getByRole('button', { name: 'Готово' }))

      const saved = JSON.parse(window.localStorage.getItem('flib:pointA') as string)
      expect(saved.interests).toEqual([])
    })

    // [ID:P-abstract-goals] Правка 5 (аудит MED): savePointA()===false
    // (Safari приватный режим/квота) — «Готово» показывает ошибку и НЕ
    // навигирует на /route (иначе RoutePage построил бы маршрут из старого
    // pointA прошлой сессии, юзер молча получил бы чужую цель).
    it('savePointA failure (quota/private mode) → error shown, does NOT navigate to /route', async () => {
      goToStep2WithLiveCatalog()
      await waitFor(() => expect(screen.getByRole('button', { name: /The Wire/ })).toBeTruthy())
      fireEvent.click(screen.getByRole('button', { name: /The Wire/ }))
      fireEvent.click(screen.getByRole('button', { name: /Далее/ }))

      const spy = vi.spyOn(window.localStorage.__proto__, 'setItem').mockImplementation(() => {
        throw new DOMException('QuotaExceededError')
      })
      try {
        fireEvent.click(screen.getByRole('button', { name: 'Готово' }))
        expect(screen.getByText(/не удалось сохранить/i)).toBeTruthy()
        expect(navigateMock).not.toHaveBeenCalled()
      } finally {
        spy.mockRestore()
      }
    })
  })

  describe('интересы (шаг 3, мультивыбор)', () => {
    it('в списке 20+ интересов и id уникальны', () => {
      expect(INTERESTS.length).toBeGreaterThanOrEqual(20)
      expect(new Set(INTERESTS.map(i => i.id)).size).toBe(INTERESTS.length)
    })
  })

  describe('goalChoices — GET /api/goals resolves AFTER navigating to step 2 (catalog still down)', () => {
    it('the fetched goal catalog becomes the titles-tab fallback once fetchGoals() resolves, selecting it adds a puzzle-typed goal with the real target', async () => {
      vi.stubGlobal('fetch', routedFetch({
        '/api/goals': () => jsonResponse({ goals: [{ id: 'api-goal', title: 'API Goal', kind: 'x', level: 'B1', target: 'api-goal/api-goal' }] }),
        '/api/puzzle/catalog': () => Promise.reject(new Error('catalog down')),
      }))
      renderTry()
      fireEvent.click(screen.getByRole('button', { name: /Далее/ }))
      await waitFor(() => expect(screen.getByRole('button', { name: 'API Goal' })).toBeTruthy())

      fireEvent.click(screen.getByRole('button', { name: 'API Goal' }))
      expect(screen.getByText('API Goal', { selector: '.fp-selchip' })).toBeTruthy()
    })
  })

  // [ID:P-abstract-goals] Правка 4 (MED): фронт капит custom-цели на 5,
  // зеркалит BFF abstractTextMaxCount — иначе юзер видит 8 чипов, а маршрут
  // молча учитывает только 5 (нечестный UX).
  describe('шаг 2 — кап 5 custom-целей (Правка 4, MED)', () => {
    it('after 5 custom goals, "Ещё" is disabled with a tooltip explaining the cap', async () => {
      goToStep2WithLiveCatalog()
      fireEvent.click(screen.getByRole('tab', { name: 'Групповые цели' }))

      for (let i = 1; i <= 5; i++) {
        fireEvent.click(screen.getByRole('button', { name: /Ещё/ }))
        fireEvent.change(screen.getByLabelText('Своя цель'), { target: { value: `цель номер ${i}` } })
        fireEvent.click(screen.getByRole('button', { name: 'Добавить' }))
      }

      const moreBtn = screen.getByRole('button', { name: /Ещё/ }) as HTMLButtonElement
      expect(moreBtn.disabled).toBe(true)
      expect(moreBtn.title).toMatch(/максимум 5 своих целей/)
      expect(screen.getAllByText(/цель номер/, { selector: '.fp-selchip' })).toHaveLength(5)
    })
  })

  // [ID:P-abstract-goals] Правка 6 (аудит MED) — покрытие потерянное с
  // удалением FilmPicker.test.tsx: поиск по каталогу в визарде фильтрует
  // ряд карточек только ПОСЛЕ 150мс debounce-окна, не на каждое нажатие.
  describe('шаг 2 — поиск по каталогу с debounce (Правка 6)', () => {
    // TryPage.tsx SEARCH_DEBOUNCE_MS не экспортирован (внутренняя деталь) —
    // 150 зеркалит contract §2.2 буквально, значение то же, что и debounce
    // /api/puzzle/preview у бывшего FilmPicker.
    const SEARCH_DEBOUNCE_MS = 150

    it('typing in the search box filters the row only AFTER the 150ms debounce window', async () => {
      goToStep2WithLiveCatalog()
      await waitFor(() => expect(screen.getByRole('button', { name: /The Wire/ })).toBeTruthy())
      expect(screen.getByRole('button', { name: /Inception/ })).toBeTruthy()

      vi.useFakeTimers()
      try {
        fireEvent.change(screen.getByLabelText('Поиск фильма или сериала'), { target: { value: 'wire' } })
        // до истечения debounce-окна — оба тайтла всё ещё в ряду.
        expect(screen.getByRole('button', { name: /Inception/ })).toBeTruthy()

        await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS)
        // после debounce — фильтр применился, Inception ушёл из ряда.
        expect(screen.queryByRole('button', { name: /Inception/ })).toBeNull()
        expect(screen.getByRole('button', { name: /The Wire/ })).toBeTruthy()
      } finally {
        vi.useRealTimers()
      }
    })
  })

  // [ID:P-abstract-goals] Правка 7 (a11y, MED минимум): диалоги несут
  // role="dialog"/aria-modal, поле — автофокус (нативный autoFocus), фокус
  // возвращается на кнопку-триггер при закрытии.
  describe('шаг 2 — диалоги: a11y минимум (Правка 7)', () => {
    it('YouTube dialog: role=dialog/aria-modal=true, closing returns focus to the trigger button', async () => {
      goToStep2WithLiveCatalog()
      fireEvent.click(screen.getByRole('tab', { name: 'Групповые цели' }))
      const trigger = screen.getByRole('button', { name: /Свой пример/ })
      fireEvent.click(trigger)

      const dialog = screen.getByRole('dialog', { name: /YouTube/ })
      expect(dialog.getAttribute('aria-modal')).toBe('true')
      expect(document.activeElement).toBe(screen.getByLabelText('Ссылка на YouTube'))

      fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
      expect(document.activeElement).toBe(trigger)
    })

    it('"Ещё" dialog: role=dialog/aria-modal=true, closing returns focus to the trigger button', async () => {
      goToStep2WithLiveCatalog()
      fireEvent.click(screen.getByRole('tab', { name: 'Групповые цели' }))
      const trigger = screen.getByRole('button', { name: /Ещё/ })
      fireEvent.click(trigger)

      const dialog = screen.getByRole('dialog', { name: /Опишите цель своими словами/ })
      expect(dialog.getAttribute('aria-modal')).toBe('true')
      expect(document.activeElement).toBe(screen.getByLabelText('Своя цель'))

      fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
      expect(document.activeElement).toBe(trigger)
    })
  })

  // [ID:P-try-goal-param] /try?goal=<key> — лендинг ссылается карточками
  // целей сюда напрямую. Резолв в ДВА захода: goalChoices (id из
  // configs/goals.json) первым, catalog.items (slug каталога) вторым —
  // catalog грузится только с шага 2, так что второй резолв обязан
  // дождаться его загрузки, а не сработать только на монтировании.
  // ⚠ ЭТОТ БЛОК НАМЕРЕННО НЕ СБРАСЫВАЕТ КЭШ КАТАЛОГА.
  //
  // Найдено адверсариальным аудитом (2026-07-17): usePuzzleCatalog держит
  // МОДУЛЬНЫЙ кэш на всю вкладку, поэтому у вернувшегося пользователя
  // catalog.items полон УЖЕ НА ПЕРВОМ РЕНДЕРЕ — раньше ответа fetchGoals.
  // Резолв ?goal= тогда уходил в ветку каталога и уводил цель на ДРУГУЮ
  // сущность корпуса: ключ `friends` в goals.json — это курируемый сериал
  // `friends-light/s01e01`, а в каталоге — одноимённый ФИЛЬМ (media_type=1)
  // → `friends/friends`.
  //
  // Весь остальной файл зовёт resetPuzzleCatalogCache() в beforeEach — из-за
  // этого тёплый кэш не тестировался НИ РАЗУ, и 6 «зелёных» тестов предвыбора
  // проходили только по холодному пути. Тест на удалённый баг обязан бить
  // именно туда, где его не было видно.
  describe('шаг 2 — предвыбор при ТЁПЛОМ кэше каталога (регресс, [ID:P-try-goal-param])', () => {
    const COLLIDING_CATALOG = [
      // Тот же ключ, что и id в goals.json, но ДРУГАЯ сущность: фильм, не сериал.
      { slug: 'friends', title_en: 'Friends', title_ru: '', media_type: 1, release_year: 1994, popularity: 99, seasons: 0, episodes: 0 },
      ...CATALOG_ITEMS,
    ]

    function warmCatalogCache() {
      vi.stubGlobal('fetch', routedFetch({
        '/api/goals': () => jsonResponse({ goals: [] }),
        '/api/puzzle/catalog': () => jsonResponse({ items: COLLIDING_CATALOG, total: 3 }),
      }))
      const { unmount } = renderTry()
      fireEvent.click(screen.getByRole('button', { name: /Далее/ })) // шаг 2 → каталог грузится
      return unmount
    }

    it('goals.json ВСЕГДА главнее одноимённого слага каталога: ?goal=friends даёт сериал friends-light/s01e01, а не одноимённый премиум-слаг каталога friends', async () => {
      const unmount = warmCatalogCache()
      await waitFor(() => expect(screen.getByRole('button', { name: /Inception/ })).toBeTruthy())
      unmount() // кэш каталога переживает размонтирование — в этом и суть

      vi.stubGlobal('fetch', routedFetch({
        '/api/goals': () => jsonResponse({
          goals: [{ id: 'friends', title: 'Friends', kind: 'Ситком', level: 'B1–B2', target: 'friends-light/s01e01' }],
        }),
        '/api/puzzle/catalog': () => jsonResponse({ items: COLLIDING_CATALOG, total: 3 }),
      }))
      renderTry('/try?goal=friends')

      await waitFor(() => {
        const next = screen.getByRole('button', { name: /Далее/ }) as HTMLButtonElement
        expect(next.disabled).toBe(false)
      })
      fireEvent.click(screen.getByRole('button', { name: /Далее/ }))
      fireEvent.click(screen.getByRole('button', { name: /Далее/ }))
      fireEvent.click(screen.getByRole('button', { name: 'Готово' }))

      const saved = JSON.parse(window.localStorage.getItem('flib:pointA') as string)
      expect(saved.goalsV2).toEqual([
        { type: 'puzzle', slug: 'friends', title: 'Friends', kind: 'series', target: 'friends-light/s01e01' },
      ])
    })

    it('ключа нет в goals.json — тёплый каталог его подхватывает (ветка (б) не сломана гейтом)', async () => {
      const unmount = warmCatalogCache()
      await waitFor(() => expect(screen.getByRole('button', { name: /Inception/ })).toBeTruthy())
      unmount()

      vi.stubGlobal('fetch', routedFetch({
        '/api/goals': () => jsonResponse({ goals: [] }),
        '/api/puzzle/catalog': () => jsonResponse({ items: COLLIDING_CATALOG, total: 3 }),
      }))
      renderTry('/try?goal=inception-2010')

      await waitFor(() => {
        const next = screen.getByRole('button', { name: /Далее/ }) as HTMLButtonElement
        expect(next.disabled).toBe(false)
      })
      fireEvent.click(screen.getByRole('button', { name: /Далее/ }))
      fireEvent.click(screen.getByRole('button', { name: /Далее/ }))
      fireEvent.click(screen.getByRole('button', { name: 'Готово' }))

      const saved = JSON.parse(window.localStorage.getItem('flib:pointA') as string)
      expect(saved.goalsV2).toEqual([
        { type: 'puzzle', slug: 'inception-2010', title: 'Inception', kind: 'film', target: 'inception-2010/inception-2010' },
      ])
    })

    // /api/goals упал → предвыбор обязан разблокироваться (.finally, не .then),
    // иначе карточка каталога молча не сработала бы вместе с чужим запросом.
    it('/api/goals упал — предвыбор по каталогу всё равно происходит', async () => {
      const unmount = warmCatalogCache()
      await waitFor(() => expect(screen.getByRole('button', { name: /Inception/ })).toBeTruthy())
      unmount()

      vi.stubGlobal('fetch', routedFetch({
        '/api/goals': () => { throw new Error('goals down') },
        '/api/puzzle/catalog': () => jsonResponse({ items: COLLIDING_CATALOG, total: 3 }),
      }))
      renderTry('/try?goal=inception-2010')

      await waitFor(() => {
        const next = screen.getByRole('button', { name: /Далее/ }) as HTMLButtonElement
        expect(next.disabled).toBe(false)
      })
    })
  })

  describe('шаг 2 — предвыбор цели из URL (?goal=, [ID:P-try-goal-param])', () => {
    it('?goal=friends резолвится по goalChoices (id из /api/goals) — чип "Friends" виден на шаге 2 сразу', async () => {
      vi.stubGlobal('fetch', routedFetch({
        '/api/goals': () => jsonResponse({
          goals: [{ id: 'friends', title: 'Friends', kind: 'Ситком', level: 'B1', target: 'friends-light/s01e01' }],
        }),
        '/api/puzzle/catalog': () => jsonResponse({ items: CATALOG_ITEMS, total: 2 }),
      }))
      renderTry('/try?goal=friends')

      // Резолв идёт по goalChoices ещё на шаге 1 (fetchGoals грузится всегда,
      // не привязан к шагу) — на шаге 2 чип уже должен быть на месте.
      await waitFor(() => {
        const nextBtn = screen.getByRole('button', { name: /Далее/ }) as HTMLButtonElement
        expect(nextBtn.disabled).toBe(false) // goalsV2 уже непусто
      })
      fireEvent.click(screen.getByRole('button', { name: /Далее/ }))
      expect(screen.getByText('Friends', { selector: '.fp-selchip' })).toBeTruthy()
    })

    it('?goal=zootopia-2016 (нет в goalChoices, есть в каталоге) — резолвится ПОСЛЕ загрузки каталога на шаге 2', async () => {
      vi.stubGlobal('fetch', routedFetch({
        '/api/goals': () => jsonResponse({ goals: [] }),
        '/api/puzzle/catalog': () => jsonResponse({
          items: [
            ...CATALOG_ITEMS,
            { slug: 'zootopia-2016', title_en: 'Zootopia', title_ru: '', media_type: 4, release_year: 2016, popularity: 70, seasons: 0, episodes: 0 },
          ],
          total: 3,
        }),
      }))
      renderTry('/try?goal=zootopia-2016')
      fireEvent.click(screen.getByRole('button', { name: /Далее/ }))

      // Пока каталог не приехал — корзина пуста (goalChoices не матчит).
      expect(screen.queryByText('Zootopia', { selector: '.fp-selchip' })).toBeNull()

      await waitFor(() => expect(screen.getByText('Zootopia', { selector: '.fp-selchip' })).toBeTruthy())
      const card = screen.getByRole('button', { name: /^Zootopia/ })
      expect(card.className).toContain('selected')
    })

    it('?goal=breaking-bad-rt — скрытая копия -rt не выбирается по ссылке (корзина пуста)', async () => {
      vi.stubGlobal('fetch', routedFetch({
        '/api/goals': () => jsonResponse({ goals: [] }),
        '/api/puzzle/catalog': () => jsonResponse({
          items: [
            ...CATALOG_ITEMS,
            { slug: 'breaking-bad-rt', title_en: 'Breaking Bad (RT)', title_ru: '', media_type: 2, release_year: 2008, popularity: 95, seasons: 5, episodes: 62 },
          ],
          total: 3,
        }),
      }))
      renderTry('/try?goal=breaking-bad-rt')
      fireEvent.click(screen.getByRole('button', { name: /Далее/ }))
      await waitFor(() => expect(screen.getByRole('button', { name: /Inception/ })).toBeTruthy())
      expect(screen.queryByText('Breaking Bad (RT)', { selector: '.fp-selchip' })).toBeNull()
      expect(screen.queryByRole('button', { name: /Breaking Bad/ })).toBeNull()
    })

    it('?goal=nonexistent-xyz — визард открывается нормально, корзина пуста, без ошибок', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        vi.stubGlobal('fetch', routedFetch({
          '/api/goals': () => jsonResponse({
            goals: [{ id: 'friends', title: 'Friends', kind: 'Ситком', level: 'B1', target: 'friends-light/s01e01' }],
          }),
          '/api/puzzle/catalog': () => jsonResponse({ items: CATALOG_ITEMS, total: 2 }),
        }))
        renderTry('/try?goal=nonexistent-xyz')
        fireEvent.click(screen.getByRole('button', { name: /Далее/ }))
        await waitFor(() => expect(screen.getByRole('button', { name: /The Wire/ })).toBeTruthy())

        expect(screen.getByText('Пока ничего не выбрано')).toBeTruthy()
        const nextBtn = screen.getByRole('button', { name: /Далее/ }) as HTMLButtonElement
        expect(nextBtn.disabled).toBe(true)
        expect(errorSpy).not.toHaveBeenCalled()
      } finally {
        errorSpy.mockRestore()
      }
    })

    it('переизбыточно длинный ключ (>100 симв.) не роняет визард и ничего не выбирает', async () => {
      vi.stubGlobal('fetch', routedFetch({
        '/api/goals': () => jsonResponse({ goals: [] }),
        '/api/puzzle/catalog': () => jsonResponse({ items: CATALOG_ITEMS, total: 2 }),
      }))
      renderTry(`/try?goal=${'a'.repeat(200)}`)
      fireEvent.click(screen.getByRole('button', { name: /Далее/ }))
      await waitFor(() => expect(screen.getByRole('button', { name: /The Wire/ })).toBeTruthy())
      expect(screen.getByText('Пока ничего не выбрано')).toBeTruthy()
    })

    it('снятие предвыбранной цели (✕ на чипе) НЕ возвращается после ре-рендера (one-shot, не re-add)', async () => {
      vi.stubGlobal('fetch', routedFetch({
        '/api/goals': () => jsonResponse({
          goals: [{ id: 'friends', title: 'Friends', kind: 'Ситком', level: 'B1', target: 'friends-light/s01e01' }],
        }),
        '/api/puzzle/catalog': () => jsonResponse({ items: CATALOG_ITEMS, total: 2 }),
      }))
      renderTry('/try?goal=friends')
      fireEvent.click(screen.getByRole('button', { name: /Далее/ }))
      await waitFor(() => expect(screen.getByText('Friends', { selector: '.fp-selchip' })).toBeTruthy())

      fireEvent.click(screen.getByRole('button', { name: /убрать цель: Friends/ }))
      expect(screen.queryByText('Friends', { selector: '.fp-selchip' })).toBeNull()

      // Форсируем дополнительные ре-рендеры (Назад/Далее между шагами,
      // ввод в поиск) — наивная реализация без one-shot-ref добавила бы
      // цель обратно на любом из них.
      fireEvent.click(screen.getByRole('button', { name: /Назад/ }))
      fireEvent.click(screen.getByRole('button', { name: /Далее/ }))
      fireEvent.change(screen.getByLabelText('Поиск фильма или сериала'), { target: { value: 'wire' } })

      expect(screen.queryByText('Friends', { selector: '.fp-selchip' })).toBeNull()
    })

    it('без ?goal= — поведение как раньше: корзина пуста на шаге 2, регресс не внесён', async () => {
      goToStep2WithLiveCatalog()
      await waitFor(() => expect(screen.getByRole('button', { name: /The Wire/ })).toBeTruthy())
      expect(screen.getByText('Пока ничего не выбрано')).toBeTruthy()
      const nextBtn = screen.getByRole('button', { name: /Далее/ }) as HTMLButtonElement
      expect(nextBtn.disabled).toBe(true)
    })
  })
})
