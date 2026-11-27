// S3 (meaning_mc): слово звучит, выбор русского перевода из 4: верный (ru банка v2) + 3 дистрактора.
// Порядок — ГСЧ интерфейса от run_id и номера задания (engine/ui-rng): поток движка не трогается, и
// повтор прогона при восстановлении показывает те же позиции. Слова без ru движок в S3 не даёт (r3).
import { useEffect, useMemo, useRef } from 'react'
import type { Word } from '../engine/bank'
import { optionOrder } from '../engine/ui-rng'
import { t } from '../i18n'
import { AudioNote, type ItemProps } from './AuralYesNo'
import { digitOf, useKeys } from './keys'
import { useItemAudio } from './useItemAudio'

export interface MeaningProps extends ItemProps {
  word: Word
  runId: string
}

export function MeaningMC({ lang, item, n, url, player, busy, word, runId, onAnswer, onAbort }: MeaningProps) {
  const { state, replay, netFails, heard } = useItemAudio(player, url, item.id, () => onAnswer({ skipped: true }))
  const locked = busy || !heard // как в AuralYesNo: ответ — только после первого прослушивания
  const head = useRef<HTMLHeadingElement>(null)
  useEffect(() => { head.current?.focus() }, [])
  const options = useMemo(() => {
    const texts = [word.ru ?? '', ...(word.distractors ?? [])]
    return optionOrder(runId, n, texts.length).map((i) => ({ i, text: texts[i] }))
  }, [word, runId, n])
  const pick = (k: number) => { if (!locked && options[k]) onAnswer({ correct: options[k].i === 0 }) }
  useKeys((e) => {
    const d = digitOf(e)
    if (d >= 1 && d <= options.length) pick(d - 1)
    else if (e.code === 'KeyR') replay()
  })
  return (
    <section className="pt-item" aria-busy={busy}>
      <p className="pt-muted">{t(lang, 'pt.item.n', { n })}</p>
      <h2 className="pt-q" tabIndex={-1} ref={head}>{t(lang, 'pt.mc.q')}</h2>
      <div className="pt-options">
        {options.map((o, k) => (
          <button type="button" key={o.i} data-opt={k} disabled={locked} onClick={() => pick(k)}>
            <span className="pt-optkey">{k + 1}</span> {o.text}
          </button>
        ))}
      </div>
      <div className="pt-actions">
        <button type="button" className="pt-link" onClick={replay}>{t(lang, 'pt.replay')}</button>
      </div>
      <AudioNote lang={lang} state={state} netFails={netFails} onRetry={replay} onAbort={onAbort} />
      <p className="pt-keys">{t(lang, 'pt.keys.mc')}</p>
    </section>
  )
}
