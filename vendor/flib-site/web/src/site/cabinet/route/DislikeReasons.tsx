// DislikeReasons.tsx — строка причин «Не нравится» (спека 2026-11-17 §4.6
// «Оценка и замена», §4.12 «Замена»; план B10b, её же использует VideoVoteBar B9).
//
// Как диалог приложения (`ClipDislikeDialog.tsx`, подписи `i18n/ru.ts:2223-2239`):
// заголовок «Что не так с роликом?», восемь причин дословно (одна на выбор, порядок
// `AC/clip-rating.ts:25-28`), галка «Заменить ролик», включённая по умолчанию,
// [Отправить] неактивна до выбора причины, [Отмена]. Галки нет, когда замена
// недоступна (до Г7, у `kept`, у урока слов): тогда «Отправить» только оценивает.
// Без модального окна: раскрывается под нажатой кнопкой.
import { useId, useState } from 'react'
import { CLIP_DISLIKE_REASONS, type ClipDislikeReason } from '../../../player/route-events/mapper'

export const DISLIKE_REASON_LABELS: Record<ClipDislikeReason, string> = {
  subs_mismatch: 'Субтитры неполные или не совпадают с речью',
  subs_misaligned: 'Субтитры не попадают во время',
  speech_not_english: 'Речь не на английском',
  lost_in_clip: 'Запутался, слишком сложно',
  content: 'Не интересно',
  video_quality: 'Плохое видео или звук',
  video_unavailable: 'Видео не открывается',
  age_restricted: 'Ограничение по возрасту',
}

export interface DislikeReasonsProps {
  canReplace: boolean
  onSubmit: (reason: ClipDislikeReason, replace: boolean) => void
  onCancel: () => void
  className?: string
  buttonClass?: string
}

export function DislikeReasons({ canReplace, onSubmit, onCancel, className = 'confirm soft', buttonClass = 'btn sm' }: DislikeReasonsProps) {
  const id = useId()
  const [reason, setReason] = useState<ClipDislikeReason | null>(null)
  const [replace, setReplace] = useState(true)
  const titleId = `${id}-t`
  return (
    <div className={className} role="group" aria-labelledby={titleId} data-testid="dislike-reasons">
      <p id={titleId}>Что не так с роликом?</p>
      <fieldset className="reasons">
        {CLIP_DISLIKE_REASONS.map(code => (
          <label key={code}>
            <input type="radio" name={`${id}-reason`} value={code} checked={reason === code} onChange={() => setReason(code)} />
            <span>{DISLIKE_REASON_LABELS[code]}</span>
          </label>
        ))}
        {canReplace && (
          <label className="replace-tick">
            <input type="checkbox" checked={replace} onChange={e => setReplace(e.target.checked)} />
            <span>Заменить ролик</span>
          </label>
        )}
      </fieldset>
      <div className="row">
        <button type="button" className={buttonClass + ' primary'} disabled={reason === null}
          onClick={() => { if (reason) onSubmit(reason, canReplace && replace) }}>Отправить</button>
        <button type="button" className={buttonClass} onClick={onCancel}>Отмена</button>
      </div>
    </div>
  )
}
