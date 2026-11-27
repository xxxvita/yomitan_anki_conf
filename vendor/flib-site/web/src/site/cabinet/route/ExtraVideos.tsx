// ExtraVideos.tsx — строки «дополнительных видео» и кнопка подбора под списком
// дня (спека extra-video §6). Без номера, слов, оценок и замены; метка «+».
import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import type { ExtraRow } from './route-api'
import type { ExtraVideoView } from './use-extra-video'
import { playerExtraUrl } from './day-model'
import { minutesOf } from './day-actions'
import { useVideoTitles } from './use-video-titles'

export function ExtraVideos({ rows, view, demo }: { rows: ExtraRow[]; view: ExtraVideoView; demo: boolean }) {
  const ids = rows.filter(r => r.kind === 'youtube' && !!r.video_id && !r.title).map(r => r.video_id!)
  const vt = useVideoTitles(ids, !demo)
  const focusRef = useRef<HTMLAnchorElement | null>(null)
  const { focusPid, focusDone } = view
  useEffect(() => {
    if (!focusPid) return
    // Фокус уходит на новую строку, только если он свободен или внутри блока и поверх нет окна.
    const ae = document.activeElement
    const free = !ae || ae === document.body || !!ae.closest('.extra')
    if (free && !document.querySelector('[aria-modal="true"]')) {
      // Строка ещё не нарисована — цель держится, пока она не появится (эффект зависит от rows);
      // сбрасывает её следующее нажатие, смена маршрута или дня.
      if (!focusRef.current) return
      focusRef.current.focus()
    }
    focusDone()
  }, [focusPid, focusDone, rows])
  if (rows.length === 0 && !view.visible) return null
  return (
    <div className="extra">
      {rows.length > 0 && (
        <div className="vlist extra-list">
          {rows.map(r => <ExtraRowView key={r.puzzle_id} row={r} vt={vt} focusRef={r.puzzle_id === focusPid ? (el => { focusRef.current = el }) : undefined} />)}
        </div>
      )}
      {view.visible && (
        <div className="extra-add">
          <button type="button" className="btn" disabled={view.disabled && !view.busy} aria-disabled={view.busy ? 'true' : undefined} aria-busy={view.busy ? 'true' : undefined} onClick={() => { if (!view.busy) view.start() }}>
            {view.busy ? 'Подбираем…' : 'Дополнительное видео'}
          </button>
          <div className="extra-note" data-testid="extra-note" role="status">{view.note ?? ''}</div>
        </div>
      )}
    </div>
  )
}

function ExtraRowView({ row, vt, focusRef }: { row: ExtraRow; vt: ReturnType<typeof useVideoTitles>; focusRef?: (el: HTMLAnchorElement | null) => void }) {
  const yt = row.kind === 'youtube' && !!row.video_id
  const title = row.title || (yt ? vt.titleOf(row.video_id!) : null) || (yt && vt.loading(row.video_id!) ? 'Загружаем название…' : yt ? 'Ролик YouTube' : 'Ролик')
  const min = minutesOf(row.duration_sec ?? 0)
  const src = row.series_title ? `${row.series_title} · ${row.source ?? ''}`.replace(/ · $/, '') : (row.source || (yt ? 'YouTube' : ''))
  return (
    <div className="vrow extra-row" data-testid="extra-row" data-kind={row.kind}>
      <span className="n" aria-hidden="true">+</span>
      <div style={{ minWidth: 0 }}>
        <div className="t">{title}</div>
        <div className="s">
          {[src, min ? `${min} мин` : ''].filter(Boolean).join(' · ')}
          {!yt && <>{src || min ? ' · ' : ''}Этот ролик открывается в программе Flibooster</>}
        </div>
      </div>
      {yt && (
        <div className="vrow-acts">
          <Link ref={focusRef} className="btn sm" to={playerExtraUrl(row.video_id!, row.puzzle_id)}
            aria-label={`${row.played ? 'Пересмотреть' : 'Смотреть'}: ${title}`}>{row.played ? 'Пересмотреть' : 'Смотреть'}</Link>
        </div>
      )}
    </div>
  )
}
