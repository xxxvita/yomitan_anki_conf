// Ревью v2a R2-C1: на телефоне тап по видео уходит ВНУТРЬ <iframe> YouTube и до
// .player-stage onPointerDown не доходит — скрытые бары было не вернуть. Пока бары
// скрыты, PlayerRoot кладёт над видео прозрачный слой-ловушку (stage-reveal): тап
// по нему только показывает бары. Тесты бьют ПО САМОМУ слою, а не по div-заглушке.
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { PlayerRoot } from '../PlayerRoot'

vi.mock('../../adapter/IFrameAdapter', () => ({
  createIFrameAdapter: () => new Promise(() => {}), // адаптер не нужен — только разметка сцены
}))

describe('PlayerRoot — слой-ловушка тапа при скрытых барах (R2-C1)', () => {
  it('нет слоя, пока бары видимы (revealCatcher не задан/false) — тапы идут в YouTube как раньше', () => {
    const { queryByTestId, rerender } = render(<PlayerRoot videoId="abc123XYZ_1" onTapStage={() => {}} />)
    expect(queryByTestId('stage-reveal')).toBeNull()
    rerender(<PlayerRoot videoId="abc123XYZ_1" onTapStage={() => {}} revealCatcher={false} />)
    expect(queryByTestId('stage-reveal')).toBeNull()
  })

  it('слой есть, когда бары скрыты; лежит над видео, но ПОД оверлеем (субтитры и капсула оценки остаются кликабельными)', () => {
    const { getByTestId, container } = render(
      <PlayerRoot videoId="abc123XYZ_1" onTapStage={() => {}} revealCatcher>
        <button data-testid="overlay-child">x</button>
      </PlayerRoot>,
    )
    const catcher = getByTestId('stage-reveal')
    const media = getByTestId('stage-media')
    const overlay = container.querySelector('.overlay') as HTMLElement
    expect(catcher.parentElement).toBe(media)
    expect(catcher.style.position).toBe('absolute')
    for (const side of ['top', 'left', 'right', 'bottom'] as const) expect(catcher.style[side]).toBe('0px')
    // Порядок наложения: видео (#yt-player, без z-index) < ловушка < оверлей (z 5).
    const kids = Array.from(media.children)
    expect(kids.indexOf(catcher)).toBeGreaterThan(kids.indexOf(media.querySelector('#yt-player') as Element))
    expect(kids.indexOf(catcher)).toBeLessThan(kids.indexOf(overlay))
    expect(Number(catcher.style.zIndex)).toBeGreaterThan(0)
    expect(Number(catcher.style.zIndex)).toBeLessThan(Number(overlay.style.zIndex))
    expect(catcher.style.pointerEvents).not.toBe('none')
  })

  it('тап по слою (pointerdown → pointerup → click) вызывает onTapStage ровно один раз', () => {
    const onTapStage = vi.fn()
    const { getByTestId } = render(<PlayerRoot videoId="abc123XYZ_1" onTapStage={onTapStage} revealCatcher />)
    const catcher = getByTestId('stage-reveal')
    fireEvent.pointerDown(catcher)
    fireEvent.pointerUp(catcher)
    fireEvent.click(catcher)
    expect(onTapStage).toHaveBeenCalledTimes(1)
  })

  it('показ — по click, не по pointerdown: иначе слой исчез бы посреди касания и click того же тапа упал бы на кнопку проявившегося бара (mute/seek/fullscreen)', () => {
    const onTapStage = vi.fn()
    const { getByTestId } = render(<PlayerRoot videoId="abc123XYZ_1" onTapStage={onTapStage} revealCatcher />)
    fireEvent.pointerDown(getByTestId('stage-reveal'))
    expect(onTapStage).not.toHaveBeenCalled()
  })

  it('click по слою не всплывает выше сцены (никакой посторонний обработчик тапа не срабатывает)', () => {
    const outer = vi.fn()
    const { getByTestId } = render(
      <div onClick={outer}><PlayerRoot videoId="abc123XYZ_1" onTapStage={() => {}} revealCatcher /></div>,
    )
    fireEvent.click(getByTestId('stage-reveal'))
    expect(outer).not.toHaveBeenCalled()
  })

  it('тап по сцене мимо слоя (напр. по проявленному видео без iframe) по-прежнему зовёт onTapStage по pointerdown', () => {
    const onTapStage = vi.fn()
    const { container } = render(<PlayerRoot videoId="abc123XYZ_1" onTapStage={onTapStage} />)
    fireEvent.pointerDown(container.querySelector('.player-stage') as HTMLElement)
    expect(onTapStage).toHaveBeenCalledTimes(1)
  })
})
