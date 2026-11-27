// Вопрос R16 (спека §5.4): невалидный прогон при прошлом результате ждёт ответа. Да — pt_results/last
// заменяется, Нет — прогон остаётся только в истории (store.answerReplace). Шторку закрыли, не ответив —
// вопрос повторится при следующем открытии; поэтому Esc здесь не перехватывается (закрывает шторку).
import { t, type Lang } from '../i18n'
import type { HistoryRow } from '../store'
import { fmtDate } from './format'

export function ReplacePrompt({ lang, row, busy, onAnswer }: { lang: Lang; row: HistoryRow; busy: boolean; onAnswer: (yes: boolean) => void }) {
  const why = row.flags.map((f) => t(lang, `pt.flagname.${f}`)).join(', ')
  return (
    <section className="pt-replace" role="group" aria-labelledby="pt-replace-h">
      <h2 id="pt-replace-h">{t(lang, 'pt.replace.title')}</h2>
      <p>{t(lang, 'pt.replace.body', { date: fmtDate(row.taken_at), why })}</p>
      <div className="pt-actions">
        <button type="button" className="pt-primary" disabled={busy} onClick={() => onAnswer(true)}>{t(lang, 'pt.replace.yes')}</button>
        <button type="button" disabled={busy} onClick={() => onAnswer(false)}>{t(lang, 'pt.replace.no')}</button>
      </div>
    </section>
  )
}
