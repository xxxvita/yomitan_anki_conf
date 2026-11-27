// TestPage.test.tsx — FSM start→survey→vocab→dictation→ei→result, выход с
// подтверждением (BrandMark + «✕ выйти»), полный рестарт.
//
// Экраны замоканы стабами (их собственное поведение — предмет их
// собственных тестов: VocabScreen.test.tsx, DictationScreen.test.tsx,
// EiScreen.test.tsx, ResultScreen.test.tsx, StartScreen.test.tsx). Здесь
// под тестом — только оркестрация TestPage: какой экран рендерится на каком
// шаге, что летит между экранами (prior/vocabResult/decResult/eiResult →
// synthesize), выход и рестарт.
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { TestPage } from '../TestPage'

// vi.hoisted(): vi.mock(...) факtory ниже хостится над обычными top-level
// const — см. комментарий в DictationScreen.test.tsx. Реst-параметр
// (...args: unknown[]) вместо конкретных типов — эти моки не обязаны
// повторять реальную сигнатуру math.ts, они лишь фиксируют, ЧТО TestPage
// передаёт между экранами (assert через toHaveBeenCalledWith).
const { priorFromSurvey, synthesize } = vi.hoisted(() => ({
  priorFromSurvey: vi.fn((..._args: unknown[]) => ({ mu: 2.5, sigma: 1.1 })),
  synthesize: vi.fn((..._args: unknown[]) => ({ profile: { cefr: 'B1' }, presets: [], fit: { route: 'standard' } })),
}))

vi.mock('../math', () => ({ priorFromSurvey, synthesize }))

vi.mock('../StartScreen', () => ({
  StartScreen: ({ onNext }: { onNext: () => void }) => <button onClick={onNext}>STUB start next</button>,
}))
vi.mock('../SurveyScreen', () => ({
  SurveyScreen: ({ onNext }: { onNext: (a: unknown, t: unknown) => void }) => (
    <button onClick={() => onNext({ exam: 'ege_mid' }, undefined)}>STUB survey next</button>
  ),
}))
vi.mock('../VocabScreen', () => ({
  VocabScreen: ({ prior, onDone }: { prior: { mu: number }; onDone: (r: unknown) => void }) => (
    <div>
      <span data-testid="vocab-prior-mu">{prior.mu}</span>
      <button onClick={() => onDone({ sizeLemmas: 640, ci90: [560, 720], finalMu: 3.4, flags: [] })}>STUB vocab done</button>
    </div>
  ),
}))
vi.mock('../DictationScreen', () => ({
  DictationScreen: ({ vocabResult, onDone }: { vocabResult: { sizeLemmas: number }; onDone: (r: unknown) => void }) => (
    <div>
      <span data-testid="dict-vocab-size">{vocabResult.sizeLemmas}</span>
      <button onClick={() => onDone({ theta: 2.9 })}>STUB dict done</button>
    </div>
  ),
}))
vi.mock('../EiScreen', () => ({
  EiScreen: ({ vocabResult, onDone }: { vocabResult: { sizeLemmas: number }; onDone: (r: unknown) => void }) => (
    <div>
      <span data-testid="ei-vocab-size">{vocabResult.sizeLemmas}</span>
      <button onClick={() => onDone({ theta: 3.1, skipped: false })}>STUB ei done</button>
    </div>
  ),
}))
vi.mock('../ResultScreen', () => ({
  ResultScreen: ({ onRestart, onRouteCreated, synthResult }: { onRestart: () => void; onRouteCreated: () => void; synthResult: { profile: { cefr: string } } }) => (
    <div>
      <span data-testid="result-cefr">{synthResult.profile.cefr}</span>
      <button onClick={onRouteCreated}>STUB go route</button>
      <button onClick={onRestart}>STUB restart</button>
    </div>
  ),
}))

function renderTest() {
  return render(
    <MemoryRouter initialEntries={['/test']}>
      <Routes>
        <Route path="/test" element={<TestPage />} />
        <Route path="/route" element={<div>ROUTE PAGE STUB</div>} />
        <Route path="/" element={<div>HOME PAGE STUB</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('TestPage FSM', () => {
  it('walks start → survey → vocab → dictation → ei → result, wiring prior/vocab/dec/ei through', () => {
    const { getByText, getByTestId } = renderTest()

    expect(getByText('STUB start next')).toBeTruthy()
    fireEvent.click(getByText('STUB start next'))

    expect(getByText('STUB survey next')).toBeTruthy()
    fireEvent.click(getByText('STUB survey next'))
    expect(priorFromSurvey).toHaveBeenCalledWith({ exam: 'ege_mid' })

    expect(getByTestId('vocab-prior-mu').textContent).toBe('2.5')
    fireEvent.click(getByText('STUB vocab done'))

    expect(getByTestId('dict-vocab-size').textContent).toBe('640')
    fireEvent.click(getByText('STUB dict done'))

    expect(getByTestId('ei-vocab-size').textContent).toBe('640')
    fireEvent.click(getByText('STUB ei done'))

    // synthesize зовётся с clipResults=undefined (v1 без клип-верификации, TODO в TestPage.tsx),
    // target=undefined (SurveyScreen-стаб не выбрал цель).
    expect(synthesize).toHaveBeenCalledWith(
      { mu: 2.5, sigma: 1.1 },
      { sizeLemmas: 640, ci90: [560, 720], finalMu: 3.4, flags: [] },
      { theta: 2.9 },
      { theta: 3.1, skipped: false },
      undefined,
      undefined,
    )
    expect(getByTestId('result-cefr').textContent).toBe('B1')
  })

  it('"Показать мой маршрут" on the result screen navigates to /route', () => {
    const { getByText } = renderTest()
    fireEvent.click(getByText('STUB start next'))
    fireEvent.click(getByText('STUB survey next'))
    fireEvent.click(getByText('STUB vocab done'))
    fireEvent.click(getByText('STUB dict done'))
    fireEvent.click(getByText('STUB ei done'))
    fireEvent.click(getByText('STUB go route'))
    expect(getByText('ROUTE PAGE STUB')).toBeTruthy()
  })

  it('"Пройти заново" from result resets the FSM back to start', () => {
    const { getByText } = renderTest()
    fireEvent.click(getByText('STUB start next'))
    fireEvent.click(getByText('STUB survey next'))
    fireEvent.click(getByText('STUB vocab done'))
    fireEvent.click(getByText('STUB dict done'))
    fireEvent.click(getByText('STUB ei done'))
    fireEvent.click(getByText('STUB restart'))
    expect(getByText('STUB start next')).toBeTruthy()
  })

  it('exiting from the "start" step navigates home immediately (no confirm — nothing to lose)', () => {
    const { getByText, queryByText } = renderTest()
    fireEvent.click(getByText('✕ выйти'))
    expect(queryByText('Прогресс пропадёт')).toBeNull()
    expect(getByText('HOME PAGE STUB')).toBeTruthy()
  })

  it('exiting mid-test via "✕ выйти" opens a confirm modal; "Остаться" cancels, "Выйти" navigates home', () => {
    const { getByText, queryByText } = renderTest()
    fireEvent.click(getByText('STUB start next')) // на 'survey'

    fireEvent.click(getByText('✕ выйти'))
    expect(getByText('Прогресс пропадёт')).toBeTruthy()

    fireEvent.click(getByText('Остаться'))
    expect(queryByText('Прогресс пропадёт')).toBeNull()
    expect(getByText('STUB survey next')).toBeTruthy() // всё ещё на анкете

    fireEvent.click(getByText('✕ выйти'))
    fireEvent.click(getByText('Выйти'))
    expect(getByText('HOME PAGE STUB')).toBeTruthy()
  })

  it('clicking the BrandMark logo mid-test opens the same confirm modal instead of navigating away', () => {
    const { getByText, getByTitle, queryByText } = renderTest()
    fireEvent.click(getByText('STUB start next')) // на 'survey'

    fireEvent.click(getByTitle('На главную'))
    expect(getByText('Прогресс пропадёт')).toBeTruthy()
    expect(queryByText('HOME PAGE STUB')).toBeNull()
  })
})
