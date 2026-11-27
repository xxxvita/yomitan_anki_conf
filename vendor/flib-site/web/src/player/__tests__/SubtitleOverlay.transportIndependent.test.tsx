// [ID:P-mobile] ЗАДАЧА 4 — страховочный тест транспорт-независимости.
// Диагностика владельца: субтитры не показывались на iOS native-транспорте
// НЕ из-за логики (useSubtitles грузит по videoId, синкает опросом
// adapter.currentTime() — транспорт-агностично уже сегодня), а из-за
// композитинга (iframe получал position:absolute через app.css, голый
// <video> — нет, инлайн-видео перекрывало HTML-оверлей на iOS). Задача 1
// чинит композитинг (см. `.player-stage video` в app.css + zIndex/isolation/
// translateZ на .overlay в PlayerRoot.tsx). Этот файл фиксирует РОВНО то, что
// НЕ должно было измениться и не изменилось: SubtitleOverlay/SubtitleL1Overlay
// не принимают transport/adapter вовсе — рендер зависит ТОЛЬКО от cues/
// activeIndex/mode, так что смена транспорта структурно не может их погасить.
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { PlayerRoot } from '../PlayerRoot'
import { SubtitleOverlay } from '../components/SubtitleOverlay'
import { SubtitleL1Overlay } from '../components/SubtitleL1Overlay'
import type { Cue } from '../hooks/useSubtitles'

const cues: Cue[] = [{ start: 0, end: 2, text_en: 'Hello world', text_ru: 'Привет мир' }]

describe('SubtitleOverlay/SubtitleL1Overlay — транспорт-независимость (P-mobile Задача 4)', () => {
  it('оба компонента рендерят активный cue БЕЗ какого-либо adapter/transport-пропа (никакого transport-гейта в сигнатуре)', () => {
    const { getByTestId } = render(
      <>
        <SubtitleOverlay cues={cues} activeIndex={0} mode="l2l1" />
        <SubtitleL1Overlay cues={cues} activeIndex={0} mode="l2l1" />
      </>
    )
    expect(getByTestId('subtitle-overlay').textContent).toContain('Hello world')
    expect(getByTestId('subtitle-l1-overlay').textContent).toContain('Привет мир')
  })

  it('смонтированы внутри PlayerRoot с transport="native" (тот самый iOS-путь) — оверлей всё равно в DOM, до/независимо от готовности video-адаптера', () => {
    // createNativeVideoAdapter асинхронно резолвится (fetch/warming-поллинг) —
    // намеренно НЕ ждём его здесь: если бы субтитры зависели от готовности
    // native-адаптера (регрессия к транспорт-гейту), их не было бы в DOM сразу
    // после первого рендера, а они есть — cues/activeIndex идут ИЗВНЕ PlayerRoot
    // (PlayerPage передаёт их как children), не из адаптера.
    const { getByTestId } = render(
      <PlayerRoot videoId="abc123XYZ_1" transport="native">
        <SubtitleOverlay cues={cues} activeIndex={0} mode="l2l1" />
        <SubtitleL1Overlay cues={cues} activeIndex={0} mode="l2l1" />
      </PlayerRoot>
    )
    expect(getByTestId('subtitle-overlay').textContent).toContain('Hello world')
    expect(getByTestId('subtitle-l1-overlay').textContent).toContain('Привет мир')
  })

  it('и внутри PlayerRoot с transport="iframe" (паритет — тот же children-контракт, не зависит от того, какой транспорт выбран)', () => {
    const { getByTestId } = render(
      <PlayerRoot videoId="abc123XYZ_1" transport="iframe">
        <SubtitleOverlay cues={cues} activeIndex={0} mode="l2l1" />
      </PlayerRoot>
    )
    expect(getByTestId('subtitle-overlay').textContent).toContain('Hello world')
  })
})
