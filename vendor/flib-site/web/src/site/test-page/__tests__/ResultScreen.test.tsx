// ResultScreen.test.tsx — выбор пресета + обязательной цели → сохранён
// flib:pointA (kind='words') и вызван onRouteCreated (TestPage делает
// navigate('/route') из него). Плюс: UNVERIFIED-ветка скрывает числа и
// пресеты (DESIGN_SPEC.md §7 «Ошибки на итоге»).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, waitFor } from '@testing-library/react'
import { ResultScreen } from '../ResultScreen'

vi.mock('../math', () => ({
  topNWords: (freq: string[], n: number) => freq.slice(0, n),
}))

const CORPUS_WORDS = Array.from({ length: 1000 }, (_, i) => `word${i}`)

const synthResult = {
  profile: { vocabBand: 3.4, vocabSize: 640, vocabCi: [560, 720], cefr: 'B1', decodingBand: 2.9, decodingGap: 0.5, decodingProfile: 'balanced', eiBand: 3.1, listeningSkew: 0.1, reliable: true, flags: [] },
  presets: [
    { name: 'Безопасный низ', lemmas: 480, band: 2.5, note: 'уверенно знаешь' },
    { name: 'По оценке', lemmas: 640, band: 3.4, rec: true, icp: 'рекомендуем' },
    { name: 'Растяжка', lemmas: 820, band: 4.2, note: 'с запасом' },
  ],
  fit: { reliable: true, show: true, route: 'standard' as const, fit: 'good' as const, msg: 'Друзья Вам почти по силам' },
} as any

const vocabResult = { sizeLemmas: 640, ci90: [560, 720] as [number, number], finalMu: 3.4, flags: [] as string[] } as any

function stubCorpusFetch() {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ level: 'C1', words: CORPUS_WORDS }),
  }))
}

describe('ResultScreen', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('shows the vocab range and CEFR reference from vocabResult/synthResult', async () => {
    stubCorpusFetch()
    const { getAllByText, getByText } = render(
      <ResultScreen vocabResult={vocabResult} synthResult={synthResult} eiResult={null} onRestart={vi.fn()} onRouteCreated={vi.fn()} />,
    )
    // Диапазон 560–720 показан дважды (крупно вверху + мелко в profile-row) —
    // именно поэтому "всегда диапазон, не точка" (DESIGN_SPEC.md §7.1).
    expect(getAllByText(/560–720/).length).toBeGreaterThan(0)
    expect(getByText(/CEFR B1/)).toBeTruthy()
  })

  it('pre-selects the recommended preset, requires a goal, then saves pointA and calls onRouteCreated', async () => {
    stubCorpusFetch()
    const onRouteCreated = vi.fn()
    const { getByRole, getByText } = render(
      <ResultScreen vocabResult={vocabResult} synthResult={synthResult} eiResult={null} onRestart={vi.fn()} onRouteCreated={onRouteCreated} />,
    )

    await waitFor(() => expect((getByRole('button', { name: /Показать мой маршрут/ }) as HTMLButtonElement).disabled).toBe(true))

    fireEvent.click(getByText('Friends'))
    await waitFor(() => expect((getByRole('button', { name: /Показать мой маршрут/ }) as HTMLButtonElement).disabled).toBe(false))

    fireEvent.click(getByRole('button', { name: /Показать мой маршрут/ }))

    await waitFor(() => expect(onRouteCreated).toHaveBeenCalled())
    const saved = JSON.parse(window.localStorage.getItem('flib:pointA') as string)
    expect(saved.kind).toBe('words')
    expect(saved.words).toEqual(CORPUS_WORDS.slice(0, 640)) // «По оценке» — рекомендованный пресет, 640 лемм
    expect(saved.goals).toEqual(['friends'])
    // source:'test' + levelEstimate — задача P-profile-feed: различает
    // «прошёл тест» от «загрузил словарь» (ImportPage.tsx), levelEstimate —
    // synthResult.profile.cefr ("справочная" CEFR-оценка теста).
    expect(saved.source).toBe('test')
    expect(saved.levelEstimate).toBe('B1')
  })

  it('selecting a different preset changes which words get saved', async () => {
    stubCorpusFetch()
    const onRouteCreated = vi.fn()
    const { getByRole, getByText } = render(
      <ResultScreen vocabResult={vocabResult} synthResult={synthResult} eiResult={null} onRestart={vi.fn()} onRouteCreated={onRouteCreated} />,
    )
    await waitFor(() => expect(getByText('Безопасный низ')).toBeTruthy())

    // Карточка "Безопасный низ" — кнопка "Выбрать" внутри неё (не сама карточка — см. ResultScreen.tsx).
    const cards = getByText('Безопасный низ').closest('.preset') as HTMLElement
    fireEvent.click(cards.querySelector('button') as HTMLButtonElement)

    fireEvent.click(getByText('Friends'))
    fireEvent.click(getByRole('button', { name: /Показать мой маршрут/ }))

    await waitFor(() => expect(onRouteCreated).toHaveBeenCalled())
    const saved = JSON.parse(window.localStorage.getItem('flib:pointA') as string)
    expect(saved.words).toEqual(CORPUS_WORDS.slice(0, 480))
  })

  it('аудит HIGH #1: "known-words.json" is disabled until the corpus has loaded (no silent empty-file download)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => { /* never resolves — corpus still loading */ })))
    const { getAllByRole } = render(
      <ResultScreen vocabResult={vocabResult} synthResult={synthResult} eiResult={null} onRestart={vi.fn()} onRouteCreated={vi.fn()} />,
    )
    const downloadButtons = getAllByRole('button', { name: /known-words\.json/ })
    expect(downloadButtons.length).toBeGreaterThan(0)
    downloadButtons.forEach(btn => expect((btn as HTMLButtonElement).disabled).toBe(true))
  })

  it('аудит HIGH #1: "known-words.json" becomes enabled once the corpus loads', async () => {
    stubCorpusFetch()
    const { getAllByRole } = render(
      <ResultScreen vocabResult={vocabResult} synthResult={synthResult} eiResult={null} onRestart={vi.fn()} onRouteCreated={vi.fn()} />,
    )
    await waitFor(() => {
      const downloadButtons = getAllByRole('button', { name: /known-words\.json/ })
      downloadButtons.forEach(btn => expect((btn as HTMLButtonElement).disabled).toBe(false))
    })
  })

  it('аудит HIGH #2: 200 {words:[]} (empty corpus) shows the corpus-error state, disables submit and download instead of a silent empty pointA', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ level: 'C1', words: [] }) }))
    const { getByRole, getAllByRole, getByText } = render(
      <ResultScreen vocabResult={vocabResult} synthResult={synthResult} eiResult={null} onRestart={vi.fn()} onRouteCreated={vi.fn()} />,
    )
    await waitFor(() => expect(getByText(/Не удалось загрузить частотный словарь/)).toBeTruthy())

    fireEvent.click(getByText('Friends'))
    expect((getByRole('button', { name: /Показать мой маршрут/ }) as HTMLButtonElement).disabled).toBe(true)
    getAllByRole('button', { name: /known-words\.json/ }).forEach(btn => expect((btn as HTMLButtonElement).disabled).toBe(true))
  })

  it('unreliable profile (synth.ts sets reliable=false + empty presets on UNVERIFIED_*) hides the vocab number, offers "Пересдать"', () => {
    stubCorpusFetch()
    const onRestart = vi.fn()
    const unreliable = {
      ...synthResult,
      profile: { ...synthResult.profile, reliable: false, flags: ['UNVERIFIED_YEASAYER'] },
      presets: [], // buildCore() в synth.ts обнуляет presets, когда !reliable
      fit: { reliable: false, show: false, route: 'retest', msg: 'Нам не хватило чистого сигнала — короткий блок, и соберём заново.' },
    }
    const { getByText, queryByText } = render(
      <ResultScreen vocabResult={vocabResult} synthResult={unreliable} eiResult={null} onRestart={onRestart} onRouteCreated={vi.fn()} />,
    )
    expect(getByText('Не удалось надёжно измерить')).toBeTruthy()
    expect(queryByText(/560–720/)).toBeNull()
    fireEvent.click(getByText('Пересдать короткий блок'))
    expect(onRestart).toHaveBeenCalled()
  })
})
