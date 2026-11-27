// LessonExamplePlayer.tsx — встроенный пример слова урока (спека 2026-11-17
// §4.13 п.5; план B10f): существующий адаптер YouTube сайта (IFrameAdapter, без
// своих кнопок — `controls:0`), старт с `start_ms`, пауза на `end_ms`. Пример
// «просмотрен», когда позиция дошла до `end_ms − 250 мс` или ролик кончился раньше
// окна (событие адаптера `ended`). Ролик не встраивается (`error` и
// `unplayable {reason:'embed-error'}`: коды 100/101/150 и прочие) — onFail:
// страница берёт следующий элемент ответа.
//
// «Не начат» (`unplayable {reason:'botwall-suspect'}` — таймер адаптера 15 с, а
// состояние всё ещё «не начат») — НЕ отказ: так выглядит и заблокированный
// браузером автозапуск (мобильные браузеры, iOS; живой прогон B12, L12). Считать
// его «не встраивается» значило бы засчитать урок без единого просмотра (все
// слова выпадают из M, доля 1). Пример остаётся, под ним — подсказка нажать на
// видео; нажатие внутри iframe запускает ролик, и дальше всё как обычно.
// Рядом с подсказкой — кнопка «Следующий пример» (финальное ревью PR-B, M1): так
// же выглядит и «стена бота» YouTube, где нажатие на видео ничего не даёт, и без
// выхода урок стал бы незасчитываемым. Кнопка зовёт тот же onFail, что и отказ
// встраивания (следующий элемент ответа; элементы кончились — «Этот пример не
// открывается», слово выходит из M), но ТОЛЬКО нажатием человека — сама «не начат»
// по-прежнему никуда не ведёт: без просмотра зачёта нет, пока человек не сказал,
// что пример не открывается.
import { useEffect, useId, useRef, useState } from 'react'
import { createIFrameAdapter } from '../../../adapter/IFrameAdapter'
import type { PlayerAdapter } from '../../../adapter/PlayerAdapter'
import type { ExampleItem } from './words-lesson'

export const EXAMPLE_END_MARGIN_SEC = 0.25
export const LESSON_TAP_HINT = 'Нажмите ▶ на видео, чтобы запустить пример'
export const LESSON_SKIP_TEXT = 'Следующий пример'
const POLL_MS = 200
// IN_WINDOW_EPS_SEC — позиция на `ended` дальше начала окна хотя бы на столько:
// проигрывание в окне было (окно за концом ролика YouTube обрезает до конца — позиция
// на `ended` = длительность ролика, то есть раньше начала окна).
const IN_WINDOW_EPS_SEC = 0.05

export function LessonExamplePlayer({ item, onEnd, onFail }: { item: ExampleItem; onEnd: () => void; onFail: () => void }) {
  const elId = 'lesson-ex-' + useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const cb = useRef({ onEnd, onFail })
  cb.current = { onEnd, onFail }
  const [needsTap, setNeedsTap] = useState(false)
  // skip — «Следующий пример» этого запуска (тот же fail, что у отказа встраивания).
  const skip = useRef<() => void>(() => {})
  useEffect(() => {
    let cancelled = false
    let adapter: PlayerAdapter | null = null
    let timer: ReturnType<typeof setInterval> | null = null
    let done = false
    const endAt = item.end_ms / 1000 - EXAMPLE_END_MARGIN_SEC
    const startAt = item.start_ms / 1000
    const fail = () => { if (!done) { done = true; cb.current.onFail() } }
    skip.current = () => { if (!cancelled) fail() }
    void createIFrameAdapter(elId, item.video_id, { startSeconds: item.start_ms / 1000 }, () => cancelled).then(a => {
      if (cancelled) { a.destroy(); return }
      adapter = a
      a.on('unplayable', p => {
        if ((p as { reason?: string } | undefined)?.reason === 'botwall-suspect') { if (!cancelled && !done) setNeedsTap(true) } else fail()
      })
      a.on('error', fail)
      a.on('ready', () => { if (!done) a.play() })
      // Ролик кончился раньше окна (end_ms позже конца видео) — пример досмотрен
      // целиком: «просмотрен» (ревью 3b, L3). Но только если проигрывание В ОКНЕ
      // было (ревью 3b, R1-L2): окно, начинающееся на конце ролика или позже, даёт
      // `ended` без единого кадра — это «не встраивается», следующий элемент.
      a.on('state', p => {
        if (p === 'playing' && !cancelled) setNeedsTap(false)
        if (p !== 'ended' || done) return
        if (a.currentTime() > startAt + IN_WINDOW_EPS_SEC) { done = true; cb.current.onEnd() } else fail()
      })
      a.play()
      timer = setInterval(() => {
        if (done) return
        if (a.currentTime() >= endAt) {
          done = true
          a.pause()
          cb.current.onEnd()
        }
      }, POLL_MS)
    }).catch(fail)
    return () => {
      cancelled = true
      skip.current = () => {}
      if (timer) clearInterval(timer)
      adapter?.destroy()
    }
  }, [elId, item.video_id, item.start_ms, item.end_ms])
  return (
    <>
      <div className="lesson-player" data-testid="lesson-player"><div id={elId} className="lesson-player-host" /></div>
      {needsTap && (
        <p className="mute lesson-player-hint" role="status">
          {LESSON_TAP_HINT}{' '}
          <button type="button" className="btn sm" onClick={() => skip.current()}>{LESSON_SKIP_TEXT}</button>
        </p>
      )}
    </>
  )
}
