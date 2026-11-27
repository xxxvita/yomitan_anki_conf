import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react'

export interface FullscreenHandle { toggleFullscreen: () => void; isFullscreen: boolean }

type FsMode = 'off' | 'native' | 'pseudo'

// Оборачивает ВЕСЬ плеер-стек (видео+оверлеи+control-bar+таймлайн). FS на внешний
// контейнер → в фуллскрине видно всё, не только iframe. Своей кнопки НЕТ — тумблер
// зовётся императивно (control-bar / хоткей F) через ref.
//
// [ID:P-mobile] ПСЕВДО-ФУЛЛСКРИН — iOS Chrome/Safari-фикс (владелец: "на весь
// экран не работает"). iOS WebKit НЕ поддерживает Fullscreen API на <div>
// (requestFullscreen либо отсутствует, либо промис реджектится) — webkitEnterFullscreen
// ЕСТЬ, но только на <video> и УБИВАЕТ наш оверлей (субтитры/控controls), поэтому
// НЕ используется. Вместо родного API — CSS-фолбэк: класс fs-pseudo на .fs-root
// (position:fixed inset:0, см. app.css), который занимает весь вьюпорт БЕЗ ухода
// в browser fullscreen — наш оверлей остаётся в обычном DOM-потоке страницы и
// продолжает рендериться поверх видео как обычно.
//
// Три состояния (не два): off / native / pseudo — native пробуется ПЕРВЫМ везде,
// где API реально поддержан (desktop/Android), pseudo — ТОЛЬКО фолбэк (iOS).
// Один и тот же toggleFullscreen()/кнопка/хоткей ведут оба пути прозрачно для
// вызывающего кода (PlayerPage не знает, какой режим сейчас активен).
// onModeChange — вызывается при входе / выходе из полноэкранного режима (любого):
// плеер v2 в полноэкранном режиме показывает оценку поверх видео.
export const FullscreenContainer = forwardRef<FullscreenHandle, { children: ReactNode; onModeChange?: (fullscreen: boolean) => void }>(
  function FullscreenContainer({ children, onModeChange }, ref) {
    const elRef = useRef<HTMLDivElement>(null)
    const [mode, setMode] = useState<FsMode>('off')
    const modeRef = useRef<FsMode>('off')
    modeRef.current = mode
    // Взведённая history-запись под псевдо-режимом (Android back = попап-выход,
    // владелец п. "Escape/back выходят из псевдофуллскрина"). true только пока
    // ЭТОТ инстанс сам зазвал pushState — popstate от НЕ-нашей навигации (обычный
    // переход по SPA) не должен внезапно "сожрать" запись, которой не взводили.
    const pushedRef = useRef(false)

    // Выход из псевдо ПОЛЬЗОВАТЕЛЕМ (кнопка/Escape) — а не сама Android-back-
    // навигация: если МЫ взвели history-запись, откатываем её сами (history.back()),
    // иначе она осталась бы в стеке навигации мёртвым грузом (следующий "назад"
    // пользователя увёл бы в никуда/на пустое состояние). history.back() сам
    // поднимет popstate — но modeRef.current к этому моменту уже 'off', так что
    // обработчик popstate ниже — no-op (без двойного тоггла).
    const exitPseudoByUser = useCallback(() => {
      setMode('off')
      if (pushedRef.current) { pushedRef.current = false; window.history.back() }
    }, [])

    const enterPseudo = useCallback(() => {
      setMode('pseudo')
      window.history.pushState({ __fsPseudo: true }, '')
      pushedRef.current = true
    }, [])

    useEffect(() => {
      // Android-back / любая другая popstate-навигация, пока мы в псевдо-режиме
      // (см. exitPseudoByUser doc — namespaced по modeRef, не по event.state,
      // чтобы работать и если сторонний код тоже толкает history).
      const onPopState = () => {
        if (modeRef.current === 'pseudo') { pushedRef.current = false; setMode('off') }
      }
      // Escape — тот же UX, что нативный browser-fullscreen (Esc выходит).
      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape' && modeRef.current === 'pseudo') exitPseudoByUser()
      }
      // Нативный FS мог закрыться В ОБХОД нашей кнопки (системный жест/другая
      // вкладка в FS) — синкаем mode обратно на 'off', иначе кнопка "думает",
      // что мы всё ещё в fullscreen, и следующий клик молча no-op'ит exitFullscreen.
      const onFsChange = () => {
        if (!document.fullscreenElement && modeRef.current === 'native') setMode('off')
      }
      window.addEventListener('popstate', onPopState)
      window.addEventListener('keydown', onKeyDown)
      document.addEventListener('fullscreenchange', onFsChange)
      return () => {
        window.removeEventListener('popstate', onPopState)
        window.removeEventListener('keydown', onKeyDown)
        document.removeEventListener('fullscreenchange', onFsChange)
      }
    }, [exitPseudoByUser])

    const toggleFullscreen = useCallback(() => {
      if (modeRef.current === 'native') { document.exitFullscreen?.().catch(() => {}); return }
      if (modeRef.current === 'pseudo') { exitPseudoByUser(); return }
      // off → пробуем нативный ПЕРВЫМ (desktop/Android): requestFullscreen может
      // просто ОТСУТСТВОВАТЬ на элементе (некоторые iOS-сборки) — в этом случае
      // даже не пытаемся звать undefined как функцию, сразу псевдо-путь.
      const rfs = elRef.current?.requestFullscreen
      if (typeof rfs === 'function') {
        rfs.call(elRef.current)
          .then(() => setMode('native'))
          .catch(() => enterPseudo()) // API есть, но промис реджектнулся (iOS WebKit) — фолбэк
      } else {
        enterPseudo()
      }
    }, [enterPseudo, exitPseudoByUser])

    useImperativeHandle(ref, () => ({ toggleFullscreen, isFullscreen: mode !== 'off' }), [toggleFullscreen, mode])
    const onModeRef = useRef(onModeChange)
    onModeRef.current = onModeChange
    useEffect(() => { onModeRef.current?.(mode !== 'off') }, [mode])

    return (
      <div
        ref={elRef}
        data-testid="fs-root"
        data-fs-mode={mode}
        className={'fs-root' + (mode === 'pseudo' ? ' fs-pseudo' : '')}
      >
        {children}
      </div>
    )
  }
)
