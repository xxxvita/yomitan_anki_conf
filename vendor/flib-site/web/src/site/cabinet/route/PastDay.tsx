// PastDay.tsx — прошлый день из календаря (спека 2026-11-17 §4.12 «Прошлый
// день», §4.2 `GET /days`, I12, Г6, §7 случаи 42в и 50; план B10c).
//
// Только то, что API знает: выданные ролики строки дня шлюза (невыданных BFF не
// отдаёт), «M роликов · T мин» по ним; НИ галочек «просмотрен», ни «k из M», ни
// минут занятий (до Г5 `played` строки прошлого дня врёт про последний ролик).
// «+N сл.» — только если шлюз отдал `words` (Г6). «Пересмотреть» открывает плеер
// БЕЗ признака маршрута (`back=route`, без `rc` и `rp`) — событий нет (Р10).
// Строка урока слов — «Урок слов · N слов» (без `words` — «Урок слов») с подписью
// «Урок прошедшего дня», без кнопки урока: демон отбросил бы событие (`off_plan`).
// Строки `kept_local` этого устройства здесь нет и быть не может: её нет в строке
// дня шлюза (§7 случай 42в).
import { Link } from 'react-router-dom'
import type { DaysEntry } from './calendar-model'
import { playerBackUrl } from './day-model'
import { lessonTitle, minutesOf } from './day-actions'
import { WordsBlock, WordsToggle } from './ClipWords'
import { plural } from '../../plural'

// pastDayLabel — «Пятница, 13 ноября» из YYYY-MM-DD.
export function pastDayLabel(date: string): { weekday: string; day: string } {
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  const wd = dt.toLocaleDateString('ru-RU', { weekday: 'long', timeZone: 'UTC' })
  return { weekday: wd.charAt(0).toUpperCase() + wd.slice(1), day: dt.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' }) }
}

export function PastDayHead({ entry, label, onBack }: { entry: DaysEntry; label?: string; onBack: () => void }) {
  const l = pastDayLabel(entry.date)
  return (
    <div className="ph">
      <span className="mono">{label ? `Маршрут · ${label}` : 'Маршрут'}</span>
      <h1>{l.weekday}, <em>{l.day}</em></h1>
      <div className="route-meta" data-testid="past-meta">
        <span>{pastDayMeta(entry)}</span>
        <button type="button" className="link" style={{ fontFamily: 'var(--sans)' }} onClick={onBack}>← Вернуться к сегодня</button>
      </div>
    </div>
  )
}

export function pastDayMeta(entry: DaysEntry): string {
  const n = entry.clips.length
  const sec = entry.clips.reduce((s, c) => s + (typeof c.duration_sec === 'number' && c.duration_sec > 0 ? c.duration_sec : 0), 0)
  return `${n} ${plural(n, 'ролик', 'ролика', 'роликов')} · ${Math.round(sec / 60)} мин`
}

export function PastDay({ entry, openWords, toggleWords }: { entry: DaysEntry; openWords: number | null; toggleWords: (i: number) => void }) {
  return (
    <div className="vlist" data-testid="past-day">
      {entry.clips.map((c, i) => {
        const idx = i + 1
        const words = Array.isArray(c.words) ? c.words.filter(w => typeof w === 'string') : null
        const lesson = c.puzzle_id.startsWith('words::')
        const min = minutesOf(typeof c.duration_sec === 'number' ? c.duration_sec : 0)
        const open = openWords === idx && !!words && words.length > 0
        const toggle = words && words.length > 0 ? <WordsToggle n={words.length} open={openWords === idx} onToggle={() => toggleWords(idx)} /> : null
        if (lesson) {
          return (
            <div key={idx} className="vrow passed" data-testid={`past-row-${idx}`}>
              <span className="n">{String(idx).padStart(2, '0')}</span>
              <div style={{ minWidth: 0 }}>
                <div className="t">{words ? lessonTitle(words.length) : 'Урок слов'}</div>
                <div className="s">Урок прошедшего дня{toggle && <> · {toggle}</>}</div>
              </div>
              <span />
              {open && <WordsBlock words={words!} />}
            </div>
          )
        }
        const yt = c.kind === 'youtube' && !!c.video_id
        const src = c.series_title ? `${c.series_title} · ${c.source ?? ''}`.replace(/ · $/, '') : (c.source || (yt ? 'YouTube' : ''))
        return (
          <div key={idx} className="vrow" data-testid={`past-row-${idx}`}>
            <span className="n">{String(idx).padStart(2, '0')}</span>
            <div style={{ minWidth: 0 }}>
              <div className="t">{c.title || (yt ? 'Ролик YouTube' : 'Ролик')}</div>
              <div className="s">
                {[src, min ? `${min} мин` : ''].filter(Boolean).join(' · ')}
                {toggle && <>{src || min ? ' · ' : ''}{toggle}</>}
              </div>
            </div>
            <div className="vrow-acts">
              {yt && <Link className="btn sm" to={playerBackUrl(c.video_id!)}>Пересмотреть</Link>}
            </div>
            {open && <WordsBlock words={words!} />}
          </div>
        )
      })}
    </div>
  )
}
