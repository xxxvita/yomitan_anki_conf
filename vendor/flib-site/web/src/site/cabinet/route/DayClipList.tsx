// DayClipList.tsx — список роликов дня (спека 2026-11-17 §4.12 «Строки списка»,
// H4, Г7, Р24; макет `cab-route.jsx:219-242`). Пять видов строк сверху вниз:
// просмотренный до замены (`kept` шлюза, затем `kept_local` этого устройства),
// просмотренный, текущий, «пройден без зачёта», невыданный (замок, без названия).
// У каждой выданной строки — оценка; у выданных строк текущего плана (кроме урока
// слов) — «Заменить» при `replace_available`. Урок слов — WordsLessonRow.
import { Link } from 'react-router-dom'
import { CabI } from '../cab-icons'
import type { DayModel, DayRow } from './day-model'
import { heroButtons, playerBackUrl, playerRcUrl, playerRouteUrl } from './day-model'
import { canReplaceRow, minutesOf, type DayActions } from './day-actions'
import { RateButtons } from './RateButtons'
import { RowPanel } from './RowPanel'
import { WordsBlock, WordsToggle } from './ClipWords'
import { WordsLessonRow } from './WordsLessonRow'

export interface ListProps {
  model: DayModel
  a: DayActions
  openWords: number | null
  toggleWords: (index: number) => void
}

export function DayClipList({ model, a, openWords, toggleWords }: ListProps) {
  return (
    <div className="vlist">
      {model.rows.map(r => (r.lesson
        ? <WordsLessonRow key={r.index} row={r} model={model} a={a} openWords={openWords === r.index} toggleWords={() => toggleWords(r.index)} />
        : <ClipRow key={r.index} row={r} model={model} a={a} openWords={openWords === r.index} toggleWords={() => toggleWords(r.index)} />))}
    </div>
  )
}

export function RowMark({ row }: { row: DayRow }) {
  const checked = row.kind === 'kept' || row.kind === 'kept_local' || row.kind === 'watched'
  return checked ? <span className="ck" aria-label="Просмотрен"><CabI.check /></span> : <span className="n">{String(row.index).padStart(2, '0')}</span>
}

export function rowClass(row: DayRow): string {
  return 'vrow' + (row.kind === 'current' ? ' cur' : '') + (row.kind === 'locked' ? ' locked' : '') + (row.kind === 'passed' ? ' passed' : '')
}

function ClipRow({ row, model, a, openWords, toggleWords }: { row: DayRow; model: DayModel; a: DayActions; openWords: boolean; toggleWords: () => void }) {
  if (row.kind === 'locked') {
    return (
      <div className={rowClass(row)} data-testid={`row-${row.index}`} data-kind="locked">
        <span className="n">{String(row.index).padStart(2, '0')}</span>
        <div style={{ minWidth: 0 }}>
          <div className="t">Следующий ролик</div>
          <div className="s">Откроется после текущего</div>
        </div>
        <CabI.lock />
      </div>
    )
  }
  const min = minutesOf(row.durationSec)
  const src = row.seriesTitle ? `${row.seriesTitle} · ${row.source ?? ''}`.replace(/ · $/, '') : (row.source || (row.clipKind === 'youtube' ? 'YouTube' : ''))
  return (
    <div className={rowClass(row)} data-testid={`row-${row.index}`} data-kind={row.kind}>
      <RowMark row={row} />
      <div style={{ minWidth: 0 }}>
        <div className="t">{row.title || (row.clipKind === 'youtube' ? 'Ролик YouTube' : 'Ролик')}</div>
        <div className="s">
          {[src, min ? `${min} мин` : ''].filter(Boolean).join(' · ')}
          {row.newWords > 0 && row.words.length > 0 && <>{src || min ? ' · ' : ''}<WordsToggle n={row.newWords} open={openWords} onToggle={toggleWords} /></>}
        </div>
      </div>
      <div className="vrow-acts">
        <MainButton row={row} model={model} a={a} />
        <RateButtons row={row} a={a} sm where="row" />
        {canReplaceRow(row, a.replaceAvailable) && (
          <button type="button" className="btn sm" disabled={a.busy} onClick={() => a.replace(row, 'row')}>Заменить</button>
        )}
      </div>
      {openWords && row.words.length > 0 && <WordsBlock words={row.words} />}
      <RowPanel row={row} a={a} where="row" />
    </div>
  )
}

// MainButton — основная кнопка строки ролика (не урока): «Пересмотреть» (kept —
// с rc; kept_local — без rc; просмотренный и «пройден без зачёта» — с rc),
// текущий — главная кнопка героя по таблице; у `other` «Пересмотреть» нет.
function MainButton({ row, model, a }: { row: DayRow; model: DayModel; a: DayActions }) {
  const pid = row.puzzleId!
  const yt = row.clipKind === 'youtube' && !!row.videoId
  if (row.kind === 'current') {
    if (row.clipKind === 'other') {
      return model.hasUndelivered ? <button type="button" className="btn sm primary" disabled={a.busy} onClick={a.next}>Следующий ролик</button> : null
    }
    if (!yt) return null
    const hb = heroButtons(model)
    if (!row.opened) return <Link className="btn sm primary" to={playerRouteUrl(row.videoId!, pid)}>Смотреть</Link>
    if (hb.primary === 'next') return <button type="button" className="btn sm primary" disabled={a.busy} onClick={a.next}>Следующий ролик</button>
    return <Link className="btn sm primary" to={playerRouteUrl(row.videoId!, pid)}>Смотреть снова</Link>
  }
  if (!yt) return null
  if (row.kind === 'kept_local') return <Link className="btn sm" to={playerBackUrl(row.videoId!)}>Пересмотреть</Link>
  return <Link className="btn sm" to={playerRcUrl(row.videoId!, pid)}>Пересмотреть</Link>
}
