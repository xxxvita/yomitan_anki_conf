// ImportPage.test.tsx — RTL с фейковым File: превью после парсинга + сохранение точки А.
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { ImportPage } from '../ImportPage'

function renderImport() {
  return render(
    <MemoryRouter initialEntries={['/import']}>
      <Routes>
        <Route path="/import" element={<ImportPage />} />
        <Route path="/route" element={<div>Ваш маршрут (плейсхолдер)</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

function makeFile(content: string, name: string, type = 'text/plain'): File {
  return new File([content], name, { type })
}

describe('ImportPage', () => {
  beforeEach(() => { window.localStorage.clear() })

  it('submit button starts disabled', () => {
    renderImport()
    const submit = screen.getByRole('button', { name: /Построить маршрут/ }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
  })

  it('parses a dropped/selected file and shows a preview with a word count and chips', async () => {
    renderImport()
    const input = screen.getByLabelText('Загрузить файл словаря') as HTMLInputElement
    const file = makeFile('cat\ndog\nmouse', 'known-words.json', 'application/json')

    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => expect(screen.getByText(/Распознано 3 слова/)).toBeTruthy())
    expect(screen.getByText('cat')).toBeTruthy()
    expect(screen.getByText('dog')).toBeTruthy()
    expect(screen.getByText('mouse')).toBeTruthy()
    // Слова есть, но цель ещё не выбрана (Э3 п.4б) — кнопка остаётся disabled.
    const submit = screen.getByRole('button', { name: /Построить маршрут/ }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Friends' }))
    expect(submit.disabled).toBe(false)
  })

  it('submit stays disabled with words but no goal, and with a goal but no words', async () => {
    renderImport()
    fireEvent.click(screen.getByRole('button', { name: 'Friends' }))
    const submit = screen.getByRole('button', { name: /Построить маршрут/ }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)

    const input = screen.getByLabelText('Загрузить файл словаря') as HTMLInputElement
    const file = makeFile('cat\ndog', 'known-words.json', 'application/json')
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => expect(submit.disabled).toBe(false))
  })

  it('on submit saves flib:pointA (kind=words, with goals) and navigates to /route', async () => {
    renderImport()
    const input = screen.getByLabelText('Загрузить файл словаря') as HTMLInputElement
    const file = makeFile('["cat", "dog"]', 'vocab.json', 'application/json')

    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => expect(screen.getByText(/Распознано 2/)).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Friends' }))
    fireEvent.click(screen.getByRole('button', { name: 'Zootopia' }))

    const submit = screen.getByRole('button', { name: /Построить маршрут/ }) as HTMLButtonElement
    expect(submit.disabled).toBe(false)
    fireEvent.click(submit)

    expect(screen.getByText('Ваш маршрут (плейсхолдер)')).toBeTruthy()
    const saved = JSON.parse(window.localStorage.getItem('flib:pointA') as string)
    expect(saved.kind).toBe('words')
    expect(saved.words).toEqual(['cat', 'dog'])
    expect(saved.goals).toEqual(['friends', 'zootopia'])
    // source:'upload' — задача P-profile-feed: различает «загрузил словарь»
    // от «прошёл тест» (test-page/ResultScreen.tsx), нужен бэку для
    // profile_meta.vocab_source (см. api.ts/RoutePage.tsx toProfileMeta).
    expect(saved.source).toBe('upload')
  })

  it('shows errors from the parser without crashing on malformed JSON', async () => {
    renderImport()
    const input = screen.getByLabelText('Загрузить файл словаря') as HTMLInputElement
    const file = makeFile('[cat, dog', 'broken.json', 'application/json')

    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => expect(screen.getByText(/Слова не распознаны/)).toBeTruthy())
    const submit = screen.getByRole('button', { name: /Построить маршрут/ }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
  })
})
