// GoalHarvestPanel.tsx — «Мои цели»: сбор слов из роликов пользователя (спека
// 2026-11-23 §6.1–§6.3, §11). Панель сама опрашивает запрос шлюза (цепочка
// setTimeout: первые 2 минуты раз в 10 с, дальше раз в 30 с; стоп на
// ready|partial|failed) и показывает прогресс, статусы роликов и тексты ошибок.
// Решение «начать маршрут» принимает родитель по `onView`.
import { useEffect, useRef, useState } from 'react'
import { getGoal, type GoalResult, type GoalView, type GoalVideoView } from './route-api'

export const POLL_FAST_MS = 10_000
export const POLL_FAST_COUNT = 12
export const POLL_SLOW_MS = 30_000

export const COPY_COLLECTING = 'Собираем слова из Ваших роликов'
export const COPY_OFFLINE_CREATE = 'Сервис сбора временно недоступен. Попробуйте через минуту.'
export const COPY_OFFLINE_WAIT = 'Сервис сбора временно недоступен — продолжим, когда он вернётся.'
export const COPY_EMPTY = 'Ни из одного ролика не удалось взять слова'
export const COPY_DEMO = 'Свои ролики как цель — в платной версии'
export const COPY_SKIP = 'Начать без сбора слов'

export type GoalFailure = Extract<GoalResult, { ok: false }>

export function isTerminal(v: GoalView | null): boolean {
  return !!v && (v.status === 'ready' || v.status === 'partial' || v.status === 'failed')
}
// Есть ли из чего начинать: ready|partial и хотя бы один готовый ролик.
export function harvestUsable(v: GoalView | null): boolean {
  return !!v && (v.status === 'ready' || v.status === 'partial') && v.ready_count > 0
}
export function harvestEmpty(v: GoalView | null): boolean {
  return !!v && (v.status === 'ready' || v.status === 'partial') && v.ready_count === 0
}

function resetText(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  const t = `${p(d.getHours())}:${p(d.getMinutes())}`
  const now = new Date()
  const same = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  return same ? t : `${p(d.getDate())}.${p(d.getMonth() + 1)} ${t}`
}

export function createErrorText(f: GoalFailure): string {
  switch (f.code) {
    case 'worker_offline': return COPY_OFFLINE_CREATE
    case 'daily_limit': {
      const at = resetText(f.resetsAt)
      return 'Сегодня запросы закончились (5 в сутки).' + (at ? ` Новые — после ${at}.` : '')
    }
    case 'too_many_videos': return 'Слишком много роликов — не больше 50.'
    case 'no_videos': return 'Добавьте хотя бы одну ссылку на ролик.'
    case 'bad_url': return 'Одна из ссылок не подходит — проверьте её.'
    case 'channel_not_supported': return 'Ссылки на каналы пока не поддерживаются — добавьте ссылки на ролики.'
    case 'plan_not_allowed':
    case 'demo_forbidden': return COPY_DEMO
    default: return 'Не удалось запустить сбор слов. Попробуйте ещё раз.'
  }
}

export function videoStatusText(s: string): string {
  switch (s) {
    case 'ready': return 'готово'
    case 'skipped_not_english': return 'нет английских субтитров'
    case 'no_english_captions': return 'нет английских субтитров — пока не получилось'
    case 'too_long': return 'длиннее часа'
    case 'unavailable': return 'недоступен'
    case 'failed': return 'пока не получилось'
    default: return 'в обработке'
  }
}

export const COPY_TITLE_LOADING = 'Загружаем название…'

interface TitleProps {
  /** Название ролика, узнанное BFF; null — нет. Название шлюза (`v.title`) главнее. */
  titleOf?: (id: string) => string | null
  titleLoading?: (id: string) => boolean
}

function VideoRow({ v, titleOf, titleLoading }: { v: GoalVideoView } & TitleProps) {
  const known = v.title || titleOf?.(v.video_id) || ''
  const loadingNow = !known && !!titleLoading?.(v.video_id)
  const text = known || (loadingNow ? COPY_TITLE_LOADING : v.video_id)
  return (
    <li className={'gh-v' + (v.status === 'ready' ? ' ok' : '')}>
      <span className="gh-vt" title={loadingNow ? undefined : text}>{text}</span>
      <span className="mute">{videoStatusText(v.status)}</span>
    </li>
  )
}

interface PanelProps extends TitleProps {
  /** Запрос шлюза; null — запроса ещё нет (идёт создание или ошибка создания). */
  requestId: string | null
  /** Ответ создания (если есть): первый опрос тогда через 10 с, а не сразу. */
  initial: GoalView | null
  creating: boolean
  createError: GoalFailure | null
  skipDisabled: boolean
  onView: (v: GoalView) => void
  onGone: () => void
  onPageError: (status: number, code: string) => void
  /** Старт с источником получил 409 goal_empty: слов у роликов нет, остаётся «без сбора». */
  forceEmpty?: boolean
  onRetry: () => void
  onSkip: () => void
}

export function GoalHarvestPanel({ requestId, initial, creating, createError, skipDisabled, onView, onGone, onPageError, forceEmpty, onRetry, onSkip, titleOf, titleLoading }: PanelProps) {
  const cb = useRef({ onView, onGone, onPageError })
  cb.current = { onView, onGone, onPageError }
  const [view, setView] = useState<GoalView | null>(initial)
  const [pollErr, setPollErr] = useState<GoalFailure | null>(null)

  useEffect(() => {
    setView(initial)
    setPollErr(null)
    if (!requestId || isTerminal(initial)) return
    let alive = true
    let timer: ReturnType<typeof setTimeout> | null = null
    let timed = 0
    const next = () => {
      const delay = timed < POLL_FAST_COUNT ? POLL_FAST_MS : POLL_SLOW_MS
      timed += 1
      timer = setTimeout(() => { void poll() }, delay)
    }
    async function poll() {
      const r = await getGoal(requestId as string)
      if (!alive) return
      if (r.ok) {
        setView(r.goal)
        cb.current.onView(r.goal)
        if (isTerminal(r.goal)) return
      } else if (r.status === 404 || r.code === 'goal_not_found') {
        cb.current.onGone()
        return
      } else if (r.code === 'demo_forbidden' || r.code === 'plan_not_allowed') {
        setPollErr(r) // ключ стал демо: текст платной версии, опрос прекращается
        return
      } else if (r.status === 401 || r.status === 403) {
        cb.current.onPageError(r.status, r.code) // сессия/ключ истекли или отозваны: общий разбор страницы
        return
      }
      next()
    }
    if (initial) next(); else void poll()
    return () => { alive = false; if (timer) clearTimeout(timer) }
    // Запрос меняется только вместе с requestId; initial — его ответ создания.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId])

  const shownErr = createError ?? pollErr
  if (shownErr) {
    const demo = pollErr !== null || shownErr.code === 'plan_not_allowed' || shownErr.code === 'demo_forbidden'
    return (
      <div className="gh">
        <p className="gh-t" role="status" aria-live="polite">{createErrorText(shownErr)}</p>
        <div className="gh-a">
          {!demo && <button type="button" className="btn" onClick={onRetry}>Повторить</button>}
          <button type="button" className="btn" disabled={skipDisabled} onClick={onSkip}>{COPY_SKIP}</button>
        </div>
      </div>
    )
  }
  if (!requestId) {
    return creating ? <div className="gh"><p className="gh-t" role="status" aria-live="polite"><span className="spin" />{COPY_COLLECTING}</p></div> : null
  }

  const waiting = !isTerminal(view)
  const empty = harvestEmpty(view) || (!!forceEmpty && isTerminal(view))
  const failed = view?.status === 'failed'
  return (
    <div className="gh">
      {waiting && <p className="gh-t" role="status" aria-live="polite"><span className="spin" />{COPY_COLLECTING}{view ? ` — ${view.ready_count} из ${view.total}` : ''}</p>}
      {waiting && view && view.worker_online === false && <p className="gh-n mute">{COPY_OFFLINE_WAIT}</p>}
      {failed && <p className="gh-t" role="status" aria-live="polite">Не удалось собрать слова из роликов.</p>}
      {empty && <p className="gh-t" role="status" aria-live="polite">{COPY_EMPTY}</p>}
      {harvestUsable(view) && !forceEmpty && <p className="gh-t" role="status" aria-live="polite">Готово: {view!.ready_count} из {view!.total}</p>}
      {view && view.videos.length > 0 && <ul className="gh-l">{view.videos.map(v => <VideoRow key={v.video_id} v={v} titleOf={titleOf} titleLoading={titleLoading} />)}</ul>}
      {(waiting || failed || empty) && (
        <div className="gh-a">
          <button type="button" className="btn" disabled={skipDisabled} onClick={onSkip}>{COPY_SKIP}</button>
        </div>
      )}
    </div>
  )
}
