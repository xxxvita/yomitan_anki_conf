// WordsLessonRow.tsx — строка урока слов (спека 2026-11-17 §4.12 «Строки списка»
// и «Урок слов», §4.13 п.8; Д2 решено «Урок слов на сайте»). Вид — как у
// просмотренной / текущей / «пройден без зачёта» по тем же признакам §4.2;
// название «Урок слов · N слов», без обложки. Кнопка урока — у ЛЮБОГО выданного
// урока текущего плана: «Пройти урок» / «Продолжить урок» / «Повторить урок» →
// `/app/route/words?rw=<puzzle_id>` (страница урока — B10f). Урок среди
// `kept` / `kept_local` — галочка и оценка, БЕЗ кнопки урока (его нет в плане,
// демон отбросил бы событие `off_plan`). «Заменить» и галки у урока нет.
// Отсылки в программу Flibooster у урока нет.
import { Link } from 'react-router-dom'
import type { DayModel, DayRow } from './day-model'
import { lessonLabelOf, lessonUrl } from './day-model'
import { lessonTitle, type DayActions } from './day-actions'
import { RateButtons } from './RateButtons'
import { RowPanel } from './RowPanel'
import { WordsBlock, WordsToggle } from './ClipWords'
import { RowMark, rowClass } from './DayClipList'

export function WordsLessonRow({ row, a, openWords, toggleWords }: { row: DayRow; model: DayModel; a: DayActions; openWords: boolean; toggleWords: () => void }) {
  const n = row.words.length || row.newWords
  const label = lessonLabelOf(row, row.puzzleId ? a.lessonHeard(row.puzzleId) : 0)
  return (
    <div className={rowClass(row)} data-testid={`row-${row.index}`} data-kind={row.kind}>
      <RowMark row={row} />
      <div style={{ minWidth: 0 }}>
        <div className="t">{lessonTitle(n)}</div>
        <div className="s">
          Урок слов
          {row.words.length > 0 && <> · <WordsToggle n={row.words.length} open={openWords} onToggle={toggleWords} /></>}
        </div>
      </div>
      <div className="vrow-acts">
        {row.inPlan && row.puzzleId && (
          <Link className={'btn sm' + (row.kind === 'current' && !row.watched ? ' primary' : '')} to={lessonUrl(row.puzzleId)}>{label}</Link>
        )}
        <RateButtons row={row} a={a} sm where="row" />
      </div>
      {openWords && row.words.length > 0 && <WordsBlock words={row.words} />}
      <RowPanel row={row} a={a} where="row" />
    </div>
  )
}
