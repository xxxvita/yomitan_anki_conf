// S1–S2 (aural_yesno): слово только на слух (лемму и признак псевдослова не показываем). «Знаю / Не знаю»,
// клавиши 1 / 2, R — повтор звука. Звук ни разу не проигрался — skipped (движок после MaxSkipRun подряд
// ставит no_audio). Файл не скачан (network) — ответ не пишется: «Повторить», после трёх подряд —
// «Прервать тест». busy — ответ пишется, кнопки и клавиши закрыты (двойной ответ — stale в run.ts).
import type { Player } from '../audio'
import type { Item, Response } from '../engine/session'
import { useEffect, useRef } from 'react'
import { t, type Lang } from '../i18n'
import { digitOf, useKeys } from './keys'
import { useItemAudio } from './useItemAudio'

export interface ItemProps {
  lang: Lang
  item: Item
  /** Номер задания (из id it_N) — для «Задание N». */
  n: number
  url: string
  player: Player
  busy: boolean
  onAnswer: (r: Response) => void
  /** «Прервать тест» после трёх сетевых сбоев подряд; нет — кнопки нет. */
  onAbort?: () => void
}

export const NET_FAILS_BEFORE_ABORT = 3

export function AudioNote({ lang, state, netFails = 0, onRetry, onAbort }: {
  lang: Lang; state: string; netFails?: number; onRetry?: () => void; onAbort?: () => void
}) {
  // Область живая всегда (смонтирована постоянно): скринридер озвучивает смену текста, а не появление узла.
  return (
    <div className="pt-audio-note" aria-live="polite">
      {state === 'loading' && <p className="pt-muted">{t(lang, 'pt.audio.loading')}</p>}
      {state === 'paused' && <p className="pt-warn">{t(lang, 'pt.audio.paused')}</p>}
      {state === 'failed' && <p className="pt-warn">{t(lang, 'pt.audio.failed')}</p>}
      {state === 'network' && (
        <div className="pt-netfail">
          <p className="pt-warn">{t(lang, 'pt.audio.network')}</p>
          <div className="pt-actions">
            <button type="button" className="pt-primary" onClick={onRetry}>{t(lang, 'pt.audio.network.retry')}</button>
            {netFails >= NET_FAILS_BEFORE_ABORT && onAbort && (
              <button type="button" onClick={onAbort}>{t(lang, 'pt.audio.abort')}</button>
            )}
          </div>
          {netFails >= NET_FAILS_BEFORE_ABORT && onAbort && <p className="pt-muted">{t(lang, 'pt.audio.abort.note')}</p>}
        </div>
      )}
    </div>
  )
}

export function AuralYesNo({ lang, item, n, url, player, busy, onAnswer, onAbort }: ItemProps) {
  const { state, replay, netFails, heard } = useItemAudio(player, url, item.id, () => onAnswer({ skipped: true }))
  // Пока слово не прозвучало целиком хотя бы раз (загрузка, сеть, пауза до первого воспроизведения),
  // отвечать нечем: ответ без слова записал бы случайное «знаю/не знаю». После первого прослушивания
  // ответы открыты и во время повтора. Двойной щелчок: страница пишет ответ под busyRef, а следующее задание
  // снова закрыто до первого прослушивания — второй щелчок на нём не отвечает.
  const locked = busy || !heard
  const head = useRef<HTMLHeadingElement>(null)
  useEffect(() => { head.current?.focus() }, []) // новое задание — фокус на заголовок (клавиатура и скринридер)
  const answer = (yes: boolean) => { if (!locked) onAnswer({ yes }) }
  useKeys((e) => {
    const d = digitOf(e)
    if (d === 1) answer(true)
    else if (d === 2) answer(false)
    else if (e.code === 'KeyR') replay()
  })
  return (
    <section className="pt-item" aria-busy={busy}>
      <p className="pt-muted">{t(lang, 'pt.item.n', { n })}</p>
      <h2 className="pt-q" tabIndex={-1} ref={head}>{t(lang, 'pt.yn.q')}</h2>
      <div className="pt-actions pt-big">
        <button type="button" className="pt-primary" disabled={locked} onClick={() => answer(true)}>{t(lang, 'pt.yn.yes')}</button>
        <button type="button" disabled={locked} onClick={() => answer(false)}>{t(lang, 'pt.yn.no')}</button>
      </div>
      <div className="pt-actions">
        <button type="button" className="pt-link" onClick={replay}>{t(lang, 'pt.replay')}</button>
      </div>
      <AudioNote lang={lang} state={state} netFails={netFails} onRetry={replay} onAbort={onAbort} />
      <p className="pt-keys">{t(lang, 'pt.keys.yn')}</p>
    </section>
  )
}
