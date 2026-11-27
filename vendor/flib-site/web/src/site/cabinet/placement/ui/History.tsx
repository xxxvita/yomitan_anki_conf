// «История» (спека §5.4, D3): по строке на прогон, новые сверху. Каждое поле строки истории читается
// здесь: дата, уровень, ≈ словарь, ci90, засчитано слов (known_count), длительность, флаги («неточный»
// у невалидного), bank_version ≠ текущего — «прежняя версия теста», listening_offset (≠ 0; в MVP всегда 0),
// accepted (null — ждёт ответа, false — не принят), «Старт» / «Сейчас». П5 — «результат удалён».
// Esc на этом экране — назад к тесту (preventDefault: шторка остаётся открытой).
import { t, type Lang } from '../i18n'
import type { HistoryRow } from '../store'
import { fmtDate, fmtNum, splitDuration } from './format'
import { useKeys } from './keys'

export interface HistoryProps {
  lang: Lang
  rows: HistoryRow[]
  lastRunId?: string
  startRunId?: string
  bankVersion: string
  onBack: () => void
}

export function History({ lang, rows, lastRunId, startRunId, bankVersion, onBack }: HistoryProps) {
  useKeys((e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onBack()
    }
  })
  // П5: pt_results/last нет — его место занимал последний принятый прогон.
  const deletedId = lastRunId === undefined ? [...rows].reverse().find((r) => r.accepted === true)?.run_id : undefined
  return (
    <section className="pt-history">
      <div className="pt-actions">
        <button type="button" className="pt-link" onClick={onBack}>{t(lang, 'pt.hist.back')}</button>
      </div>
      <h2>{t(lang, 'pt.hist.title')}</h2>
      {rows.length === 0 ? <p className="pt-muted">{t(lang, 'pt.hist.empty')}</p> : (
        <ul className="pt-hist">
          {[...rows].reverse().map((r) => {
            const d = splitDuration(r.duration_sec)
            return (
              <li key={r.run_id} className="pt-hist-row">
                <div className="pt-hist-main">
                  <span className="pt-hist-date">{fmtDate(r.taken_at)}</span>{' '}
                  <strong>{r.level}</strong>{' '}
                  <span>≈{fmtNum(lang, r.vocab_size)}</span>{' '}
                  <span className="pt-muted">({t(lang, 'pt.hist.ci', { lo: fmtNum(lang, r.ci90[0]), hi: fmtNum(lang, r.ci90[1]) })})</span>
                  {r.run_id === startRunId && <span className="pt-badge">{t(lang, 'pt.sn.start')}</span>}
                  {r.run_id === lastRunId && <span className="pt-badge">{t(lang, 'pt.sn.now')}</span>}
                </div>
                <div className="pt-hist-meta pt-muted">
                  <span>{t(lang, 'pt.hist.known', { n: fmtNum(lang, r.known_count) })}</span>
                  {' · '}
                  <span>{t(lang, 'pt.hist.duration', { m: d.m, s: d.s })}</span>
                  {r.listening_offset !== 0 && <>{' · '}<span>{t(lang, 'pt.hist.listening', { v: fmtNum(lang, r.listening_offset) })}</span></>}
                </div>
                <div className="pt-hist-marks">
                  {!r.valid && <span className="pt-mark">{t(lang, 'pt.mark.inexact')}</span>}
                  {r.flags.map((f) => <span key={f} className="pt-mark">{t(lang, `pt.flagname.${f}`)}</span>)}
                  {r.bank_version !== bankVersion && <span className="pt-mark">{t(lang, 'pt.hist.oldBank')}</span>}
                  {r.accepted === null && <span className="pt-mark">{t(lang, 'pt.hist.pending')}</span>}
                  {r.accepted === false && <span className="pt-mark">{t(lang, 'pt.hist.rejected')}</span>}
                  {r.run_id === deletedId && <span className="pt-mark">{t(lang, 'pt.mark.deleted')}</span>}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
