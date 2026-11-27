// Карточка «Старт · Сейчас» над экраном теста (спека §5.3, R6): «Старт» — первый валидный прогон (пока
// валидных нет — первый принятый, «неточный»); «Сейчас» — прогон из pt_results/last. П5: истории есть,
// pt_results/last нет («Удалить и данные модуля») — «Сейчас» пусто, у «Старта» пометка «результат удалён».
import { t, type Lang } from '../i18n'
import type { HistoryRow } from '../store'
import { fmtDate, fmtNum } from './format'

function Cell({ lang, label, row, deleted }: { lang: Lang; label: string; row?: HistoryRow; deleted?: boolean }) {
  return (
    <div className="pt-sn-cell" data-sn>
      <span className="pt-eyebrow">{t(lang, label)}</span>{' '}
      <span className="pt-sn-val">
        {row ? t(lang, 'pt.sn.row', { level: row.level, n: fmtNum(lang, row.vocab_size), date: fmtDate(row.taken_at) }) : t(lang, 'pt.sn.none')}
      </span>
      {row && !row.valid && <span className="pt-mark">{t(lang, 'pt.mark.inexact')}</span>}
      {row && deleted && <span className="pt-mark">{t(lang, 'pt.mark.deleted')}</span>}
    </div>
  )
}

export function StartNow({ lang, start, now, lastRunId }: { lang: Lang; start?: HistoryRow; now?: HistoryRow; lastRunId?: string }) {
  if (!start && !now) return null
  return (
    <div className="pt-sn">
      <Cell lang={lang} label="pt.sn.start" row={start} deleted={lastRunId === undefined} />
      <span className="pt-sn-sep" aria-hidden>—</span>
      <Cell lang={lang} label="pt.sn.now" row={now} />
    </div>
  )
}
