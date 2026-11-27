// ForkPage.test.tsx — три карточки развилки + навигация по клику.
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { ForkPage } from '../ForkPage'
import { TryPage } from '../TryPage'
import { ImportPage } from '../ImportPage'

function renderFork(initialEntries = ['/fork']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route path="/fork" element={<ForkPage />} />
        <Route path="/try" element={<TryPage />} />
        <Route path="/import" element={<ImportPage />} />
        <Route path="/test" element={<div>Тест на слух (плейсхолдер)</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ForkPage', () => {
  it('renders the heading and three cards with routing targets', () => {
    renderFork()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Как быстро уточним Ваш уровень?')
    expect(screen.getByRole('button', { name: /Попробовать/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Быстрый тест/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Загрузить словарь/ })).toBeTruthy()
  })

  it('navigates to /try when "Попробовать" is clicked', async () => {
    renderFork()
    fireEvent.click(screen.getByRole('button', { name: /Попробовать/ }))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Три шага — и маршрут готов')
  })

  it('navigates to /test when "Быстрый тест" is clicked', async () => {
    renderFork()
    fireEvent.click(screen.getByRole('button', { name: /Быстрый тест/ }))
    expect(screen.getByText('Тест на слух (плейсхолдер)')).toBeTruthy()
  })

  it('navigates to /import when "Загрузить словарь" is clicked', async () => {
    renderFork()
    fireEvent.click(screen.getByRole('button', { name: /Загрузить словарь/ }))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Отдайте, что уже знаете')
  })

  it('the "На главную" link points at /', () => {
    renderFork()
    expect(screen.getByTitle('На главную').getAttribute('href')).toBe('/')
  })
})
