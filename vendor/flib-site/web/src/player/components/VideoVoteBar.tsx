// VideoVoteBar.tsx — feedback-2 п.3 (владелец, транскрипт screencast3,
// 02:30–03:53): голосование за КАЖДОЕ видео — лайк/дизлайк/"!"-с-
// комментарием. «эти кнопки должно быть явно видно... над субтитрами, кнопка
// лайк в виде пальца вверх, дизлайк и восклицательный знак рядом» (03:21–03:53).
//
// САМОДОСТАТОЧНЫЙ компонент (тот же минимально-инвазивный паттерн, что
// RouteStepBar, Э5): PlayerPage передаёт ТОЛЬКО videoId, ничего не знает про
// сеть/anon_id/состояние выбора. Монтируется ВНУТРИ PlayerRoot рядом с
// SubtitleOverlay/SubtitleL1Overlay (см. PlayerPage.tsx) — позиционирована
// (CSS) в правом верхнем углу видео, т.е. физически НАД субтитрами
// (SubtitleOverlay якорится снизу, DEFAULT_POSITION y:90%) и не перекрывает их.
//
// v1: копим вердикт локально на бэке (POST /api/feedback/video, см.
// internal/bff/video_feedback.go) — передача в маршрутный движок с профилем
// пользователя (интересы) — следующий этап (владелец, 04:20–04:36: интересы
// пока не собираются на сайте). Дедуп на бэке не нужен (append-лог) — смена
// вердикта просто пишет новую строку, поэтому повторный клик "лайк→дизлайк"
// шлёт новое событие БЕЗ проверки предыдущего состояния на сервере.
//
// Ошибки сети глотаем в console.warn — тот же принцип, что ab-events.ts
// (reportRouteNext): это телеметрия голосования, не должна ломать UX
// пользователю, который уже увидел визуальный отклик на клик.
//
// feedback-forms [ID:P-feedback-forms] — аналитика попросила структурные
// причины вместо голого текста: 👎 дизлайк больше НЕ шлётся мгновенно,
// открывает форму (шкала 0..10 «насколько видео могло бы подходить» +
// мультивыбор причин); ❗ флаг остался с обязательным текстом, но получил
// такой же мультивыбор причин-кнопок и увеличенное поле (textarea). Обе
// формы шлют, помимо comment (человекочитаемый текст — совместимость с уже
// читающими лог людьми), структурные score/reasons — бэк валидирует их
// отдельно (internal/bff/video_feedback.go). 👍 лайк — без изменений,
// мгновенная отправка.
import type React from 'react'
import { useState, type FormEvent, type MouseEvent, useEffect, useRef } from 'react'
import { ensureAnonId } from '../../site/route-state'
import { DislikeReasons, DISLIKE_REASON_LABELS } from '../../site/cabinet/route/DislikeReasons'
import type { ClipDislikeReason } from '../route-events/mapper'
import { CabI } from '../../site/cabinet/cab-icons'
import { round2, watchedPct } from '../player-telemetry'
import './video-vote-bar.css'

type LikeVerdict = 'like' | 'dislike'
type Verdict = LikeVerdict | 'flag'

const COMMENT_MAX_LEN = 500

// DISLIKE_SCALE — дискретный ряд баллов 0..10 [ID:P-feedback-audit]. Аудит
// (MED-1) забраковал <input type="range">: (а) слайдер ПРИМАНИВАЕТ к своей
// стартовой позиции (priming — визуально «предложенный» ответ искажает
// аналитику), (б) контролируемый range имеет React-гочу с крайним
// значением (onChange не всплывает, если позиция не изменилась — 0 у левого
// края было недостижимо как «выбор»). Ряд из 11 отдельных кнопок снимает
// оба: НИЧЕГО не преселекчено, каждый клик — явный set конкретного числа
// (0 — полноценный выбор, а не falsy-скип), никакой value-tracker-гочи.
const DISLIKE_SCALE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const

// DISLIKE_REASONS/FLAG_REASONS — тексты кнопок-причин (порядок = порядок
// кнопок в UI, задан задачей дословно). Тексты — они же значения,
// отправляемые в reasons[] (аналитика читает reasons как есть, без
// отдельных кодов — v1, как и verdict/comment всей ручки).
const DISLIKE_REASONS = [
  'Очень быстрый темп',
  'Не понимаю содержание видео (не мой словарь)',
  'Слишком детская',
  'Нет попадания в мои интересы',
  'Точно не знаю, но видео не понравилось',
  'Нет субтитров',
  'Видео не на английском языке',
] as const

const FLAG_REASONS = [
  'Видео не соответствует интересам',
  'Отсутствует звук',
  'Непонятно на моём уровне',
  'Слишком быстрый темп речи',
  'Видео нечёткое',
] as const

function reportVideoFeedback(payload: {
  anonId: string
  videoId: string
  verdict: Verdict
  comment?: string
  // score — ТОЛЬКО у формы дизлайка, 0 валидное значение (проверяем
  // `!== undefined`, а не truthy — иначе 0 молча потерялся бы, тот же
  // класс бага, что omitempty на голом int вместо *int на бэке).
  score?: number
  reasons?: string[]
  // Контекст плеера на момент отправки (телеметрия-обогащение): таймкод и доля
  // просмотра. Опциональны — если PlayerPage не прокинул время, поля не уходят
  // (бэк принимает их omitempty, старые клиенты не ломаются).
  timecode?: number
  watchedPct?: number
}): void {
  fetch('/api/feedback/video', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      anon_id: payload.anonId,
      video_id: payload.videoId,
      verdict: payload.verdict,
      comment: payload.comment ?? '',
      ...(payload.score !== undefined ? { score: payload.score } : {}),
      ...(payload.reasons && payload.reasons.length > 0 ? { reasons: payload.reasons } : {}),
      ...(payload.timecode !== undefined ? { timecode: payload.timecode } : {}),
      ...(payload.watchedPct !== undefined ? { watched_pct: payload.watchedPct } : {}),
    }),
  }).then(res => {
    if (!res.ok) console.warn('[feedback] video feedback non-ok response', res.status)
  }).catch(err => {
    console.warn('[feedback] video feedback failed', err)
  })
}

// appendReasonLine/removeReasonLine — как кнопки-причины флага двигают
// textarea. Решение (простой вариант из задачи, а не пометка строк
// скрытыми маркерами): кнопка ВСЕГДА добавляет свою строку в конец при
// включении; toggle-состояние ("нажата ли сейчас кнопка") живёт ОТДЕЛЬНО
// от текста, в flagReasons — тексту мы не доверяем как источнику истины.
// При выключении убираем ОДНУ строку, точно равную тексту причины, ищем с
// КОНЦА (последнее вхождение) — типовой кейс "нажал → передумал, нажал
// ещё раз" убирает именно свою, только что добавленную строку, а не более
// раннюю ручную строку с тем же текстом (если пользователь случайно
// продублировал его руками). Если совпадения не нашли (пользователь успел
// стереть/отредактировать свою строку руками) — текст не трогаем, только
// снимаем toggle: пользователь так же может обратно нажать кнопку и
// получить её текст заново.
// slice(0, COMMENT_MAX_LEN) — appendReasonLine пишет в React-state напрямую,
// МИМО HTML maxLength у <textarea> (тот атрибут ограничивает только ручной
// набор клавишами, не программную установку value) — без клампа здесь
// пользователь мог бы руками почти забить 500-символьный textarea, потом
// дожать кнопками причин и улететь за videoFeedbackCommentMaxLen на бэке:
// итоговый POST молча схватил бы 400 (ошибки сети/не-2xx глотаются в
// console.warn по всей ручке) — форма бы закрылась, а событие не записалось
// бы, и пользователь не узнал бы об этом.
function appendReasonLine(text: string, line: string): string {
  const trimmed = text.replace(/\s+$/, '')
  const combined = trimmed ? `${trimmed}\n${line}` : line
  return combined.slice(0, COMMENT_MAX_LEN)
}

function removeLastReasonLine(text: string, line: string): string {
  const lines = text.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim() === line) {
      lines.splice(i, 1)
      return lines.join('\n')
    }
  }
  return text
}

// RouteVote — маршрут кабинета (спека §4.6 «Оценка и замена», §4.7; план B9):
// ролик открыт из маршрута (rp подтверждён или rc выданного ролика сегодня).
// «Нравится» ещё и ставит clip_rated; «Не нравится» открывает строку причин
// приложения (8 кодов, галка «Заменить ролик» — только при canReplace) вместо
// формы со шкалой. Подсветка — `flib:route-ratings` (rating); нажатие на
// выбранную оценку ничего не шлёт (L14). Без route — поведение прежнее.
export interface RouteVote {
  rating: 'like' | 'dislike' | null
  canReplace: boolean
  busy: boolean
  status?: string | null
  onLike: () => void
  onDislike: (reason: ClipDislikeReason, replace: boolean) => void
  // onRetry — повторить проверку маршрута и замену после неудачного чтения (R2-L6).
  onRetry?: () => void
}

// raised — поверх карточки конца ролика маршрута (ревью 3а, L6): оценка доступна и
// на ней.
// inline — плеер v2 (дизайн 2026-11-19 §4): в режиме маршрута оценка стоит ПОД
// видео, в потоке (класс vvb-inline), кнопки — квадраты 40×40 с линейными
// иконками кабинета вместо эмодзи; подписи и поведение те же.
export function VideoVoteBar({ videoId, currentTime, duration, route, raised, inline }: { videoId: string; currentTime?: number; duration?: number; route?: RouteVote; raised?: boolean; inline?: boolean }) {
  // Контекст плеера на момент клика — таймкод и доля просмотра для обогащения
  // фидбека (аналитике важно, НА КАКОМ месте ролика пользователь голосует).
  // Оба поля опциональны: если currentTime не прокинут, ничего не добавляем.
  function playerCtx(): { timecode?: number; watchedPct?: number } {
    if (currentTime === undefined) return {}
    return {
      timecode: round2(currentTime),
      ...(duration !== undefined ? { watchedPct: watchedPct(currentTime, duration) } : {}),
    }
  }
  // Состояние выбора — на время сессии страницы, persist не нужен v1
  // (владелец не просил переживать перезагрузку — только визуальный отклик
  // "здесь и сейчас" на клик).
  const [selectedLocal, setSelected] = useState<LikeVerdict | null>(null)
  // В маршруте подсветка — из `flib:route-ratings` (переживает перезагрузку).
  const selected = route ? (route.rating ?? selectedLocal) : selectedLocal

  // Дизлайк и флаг взаимоисключающие формы (задача: "открытие одной
  // закрывает другую") — два независимых bool, а не общий enum, потому что
  // у каждой формы своё локальное состояние ниже, которое НЕ обнуляется
  // при простом закрытии (только при явном submit) — пользователь может
  // передумать, закрыть форму кликом по другой кнопке и вернуться к
  // черновику.
  const [dislikeOpen, setDislikeOpen] = useState(false)
  // dislikeScore=null — «ещё не выбрано» (ни одна кнопка 0..10 не нажата).
  // Теперь это надёжно отличимо от выбора 0: 0 — это явно нажатая кнопка,
  // null — вообще ничего (см. DISLIKE_SCALE — отдельный флаг «тронул» больше
  // не нужен, дискретные кнопки убрали слайдерную гочу).
  const [dislikeScore, setDislikeScore] = useState<number | null>(null)
  const [dislikeReasons, setDislikeReasons] = useState<string[]>([])

  const [flagOpen, setFlagOpen] = useState(false)
  const [comment, setComment] = useState('')
  const [flagReasons, setFlagReasons] = useState<string[]>([])

  // inline (плеер v2, под видео): формы — всплывающая панель над кнопками
  // (поверх видео, не в потоке — ревью v2a H-2: в потоке они сжимали видео до
  // полоски). Открылась — фокус в неё; Esc закрывает и возвращает фокус на кнопку.
  const popRef = useRef<HTMLDivElement>(null)
  const dislikeBtn = useRef<HTMLButtonElement>(null)
  const flagBtn = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!inline || !(dislikeOpen || flagOpen)) return
    const first = popRef.current?.querySelector<HTMLElement>('button, textarea, input, [tabindex]:not([tabindex="-1"])')
    first?.focus()
  }, [inline, dislikeOpen, flagOpen])

  if (!videoId) return null

  function onPopKey(e: React.KeyboardEvent) {
    if (e.key !== 'Escape' || !(dislikeOpen || flagOpen)) return
    e.stopPropagation()
    const back = dislikeOpen ? dislikeBtn.current : flagBtn.current
    setDislikeOpen(false)
    setFlagOpen(false)
    back?.focus()
  }

  // stopPropagation — кнопки/капсула сидят поверх видео-канвы плеера;
  // клики по ним не должны доходить до play/pause-обработчиков видео под ней.
  function stop(e: MouseEvent) {
    e.stopPropagation()
  }

  function resetDislikeForm() {
    setDislikeScore(null)
    setDislikeReasons([])
  }

  function handleLikeClick(e: MouseEvent) {
    stop(e)
    if (route && (route.rating === 'like' || route.busy)) return
    // Повторный клик на уже выбранный вердикт — смена не нужна, но клик всё
    // равно шлёт новое событие (владелец: "отправляется... как и маршрут
    // построение"; дедуп — забота читающей стороны лога, не этой ручки).
    setSelected('like')
    setDislikeOpen(false)
    setFlagOpen(false)
    reportVideoFeedback({ anonId: ensureAnonId(), videoId, verdict: 'like', ...playerCtx() })
    route?.onLike()
  }

  function handleDislikeToggle(e: MouseEvent) {
    stop(e)
    if (route && (route.rating === 'dislike' || route.busy)) return
    setFlagOpen(false) // формы взаимоисключающие
    setDislikeOpen(o => !o)
  }

  function handleFlagToggle(e: MouseEvent) {
    stop(e)
    setDislikeOpen(false) // формы взаимоисключающие
    setFlagOpen(o => !o)
  }

  function toggleDislikeReason(reason: string) {
    setDislikeReasons(prev =>
      prev.includes(reason) ? prev.filter(r => r !== reason) : [...prev, reason],
    )
  }

  function toggleFlagReason(reason: string) {
    const isOn = flagReasons.includes(reason)
    setComment(c => (isOn ? removeLastReasonLine(c, reason) : appendReasonLine(c, reason)))
    setFlagReasons(prev => (isOn ? prev.filter(r => r !== reason) : [...prev, reason]))
  }

  function handleDislikeSubmit(e: FormEvent) {
    e.preventDefault()
    e.stopPropagation()
    // score===null → ничего не выбрано; кнопка «Отправить» задизейблена, но
    // защищаемся и от программного submit. 0 сюда проходит штатно (это НЕ
    // null) — валидный балл, не falsy-скип.
    if (dislikeScore === null) return
    const score = dislikeScore
    const reasonsText = dislikeReasons.length ? ` Причины: ${dislikeReasons.join('; ')}` : ''
    // .slice — тот же кламп, что appendReasonLine у флага: при максимуме
    // выбранных причин (7) composedComment остаётся заведомо короче 500, но
    // граница держится на всякий случай тем же способом, не полагаясь на
    // "сегодня список коротких кнопок" как на инвариант навсегда.
    const composedComment = `Оценка соответствия: ${score}/10.${reasonsText}`.slice(0, COMMENT_MAX_LEN)
    reportVideoFeedback({
      anonId: ensureAnonId(),
      videoId,
      verdict: 'dislike',
      comment: composedComment,
      score,
      reasons: dislikeReasons.length ? dislikeReasons : undefined,
      ...playerCtx(),
    })
    setSelected('dislike')
    setDislikeOpen(false)
    resetDislikeForm()
  }

  // handleRouteDislike — «Отправить» строки причин маршрута: JSONL пишется по-
  // прежнему (его читает владелец), затем clip_rated и (при галке) замена.
  function handleRouteDislike(reason: ClipDislikeReason, replace: boolean) {
    reportVideoFeedback({ anonId: ensureAnonId(), videoId, verdict: 'dislike', reasons: [DISLIKE_REASON_LABELS[reason]], ...playerCtx() })
    setSelected('dislike')
    setDislikeOpen(false)
    route?.onDislike(reason, replace)
  }

  function handleFlagSubmit(e: FormEvent) {
    e.preventDefault()
    e.stopPropagation()
    const trimmed = comment.trim()
    if (!trimmed) return // verdict=flag требует непустой комментарий (контракт бэка)
    reportVideoFeedback({
      anonId: ensureAnonId(),
      videoId,
      verdict: 'flag',
      comment: trimmed,
      reasons: flagReasons.length ? flagReasons : undefined,
      ...playerCtx(),
    })
    setFlagOpen(false)
    setComment('')
    setFlagReasons([])
  }

  return (
    <div className={'video-vote-bar' + (raised ? ' vvb-raised' : '') + (inline ? ' vvb-inline' : '')} data-testid="video-vote-bar" onMouseDown={stop} onClick={stop} onKeyDown={inline ? onPopKey : undefined}>
      <div className="vvb-row">
        <button
          type="button"
          className={`vvb-btn${selected === 'like' ? ' is-active vvb-like' : ''}`}
          aria-label="Понравилось"
          aria-pressed={selected === 'like'}
          onClick={handleLikeClick}
        >
          {inline ? <CabI.like /> : '👍'}
        </button>
        <button
          type="button"
          className={`vvb-btn${selected === 'dislike' || dislikeOpen ? ' is-active vvb-dislike' : ''}`}
          aria-label="Не понравилось"
          // aria-pressed отражает ОБА состояния — открытую форму (ещё не
          // отправлено) и уже зафиксированный вердикт (форма закрылась
          // после submit), тот же паттерн, что у ❗ (aria-pressed={flagOpen}) —
          // визуально кнопка не должна "гаснуть" на время заполнения формы.
          aria-pressed={selected === 'dislike' || dislikeOpen}
          aria-expanded={inline ? dislikeOpen : undefined}
          ref={dislikeBtn}
          onClick={handleDislikeToggle}
        >
          {inline ? <CabI.dislike /> : '👎'}
        </button>
        <button
          type="button"
          className={`vvb-btn${flagOpen ? ' is-active vvb-flag' : ''}`}
          aria-label="Обратить внимание и написать комментарий"
          aria-pressed={flagOpen}
          aria-expanded={inline ? flagOpen : undefined}
          ref={flagBtn}
          onClick={handleFlagToggle}
        >
          {inline ? <CabI.alert /> : '❗'}
        </button>
      </div>

      {inline ? ((dislikeOpen || flagOpen || !!route?.status) && (
        <div className="vvb-pop" ref={popRef} role="group" aria-label="Оценка ролика">
      {dislikeOpen && route && (
          <div className="vvb-form vvb-route-reasons" onClick={stop}>
            <DislikeReasons canReplace={route.canReplace} className="vvb-reasons" buttonClass="vvb-form-send"
              onSubmit={handleRouteDislike} onCancel={() => setDislikeOpen(false)} />
          </div>
        )}
        {route?.status && <p className="vvb-route-status" role="status">{route.status}</p>}
        {route?.status && route.onRetry && (
          <button type="button" className="vvb-form-send vvb-route-retry" onClick={e => { stop(e); route.onRetry?.() }}>Повторить</button>
        )}

        {dislikeOpen && !route && (
          <form className="vvb-form vvb-dislike-form" onSubmit={handleDislikeSubmit} onClick={stop}>
            <p className="vvb-form-title">Насколько это видео могло бы Вам подходить?</p>
            <div className="vvb-scale" role="radiogroup" aria-label="Оценка соответствия видео, от 0 до 10">
              <div className="vvb-scale-btns">
                {DISLIKE_SCALE.map(n => (
                  <button
                    key={n}
                    type="button"
                    className={`vvb-scale-btn${dislikeScore === n ? ' is-active' : ''}`}
                    role="radio"
                    aria-checked={dislikeScore === n}
                    aria-label={`${n} из 10`}
                    onClick={e => { stop(e); setDislikeScore(n) }}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <div className="vvb-scale-labels">
                <span>0 — абсолютно не подходит</span>
                <span>10 — точно подходит</span>
              </div>
            </div>
            <div className="vvb-reason-list">
              {DISLIKE_REASONS.map(reason => (
                <button
                  key={reason}
                  type="button"
                  className={`vvb-reason-btn${dislikeReasons.includes(reason) ? ' is-active' : ''}`}
                  aria-pressed={dislikeReasons.includes(reason)}
                  onClick={e => { stop(e); toggleDislikeReason(reason) }}
                >
                  {reason}
                </button>
              ))}
            </div>
            <button type="submit" className="vvb-form-send" disabled={dislikeScore === null}>
              Отправить
            </button>
          </form>
        )}

        {flagOpen && (
          <form className="vvb-form vvb-flag-form" onSubmit={handleFlagSubmit} onClick={stop}>
            <div className="vvb-reason-list">
              {FLAG_REASONS.map(reason => (
                <button
                  key={reason}
                  type="button"
                  className={`vvb-reason-btn${flagReasons.includes(reason) ? ' is-active' : ''}`}
                  aria-pressed={flagReasons.includes(reason)}
                  onClick={e => { stop(e); toggleFlagReason(reason) }}
                >
                  {reason}
                </button>
              ))}
            </div>
            <textarea
              className="vvb-flag-textarea"
              placeholder="Что не так? (обязательно)"
              value={comment}
              maxLength={COMMENT_MAX_LEN}
              rows={4}
              onChange={e => setComment(e.target.value)}
              aria-label="Комментарий"
            />
            <button type="submit" className="vvb-form-send" disabled={!comment.trim()}>
              Отправить
            </button>
          </form>
        )}
        </div>
      )) : (
        <>
      {dislikeOpen && route && (
          <div className="vvb-form vvb-route-reasons" onClick={stop}>
            <DislikeReasons canReplace={route.canReplace} className="vvb-reasons" buttonClass="vvb-form-send"
              onSubmit={handleRouteDislike} onCancel={() => setDislikeOpen(false)} />
          </div>
        )}
        {route?.status && <p className="vvb-route-status" role="status">{route.status}</p>}
        {route?.status && route.onRetry && (
          <button type="button" className="vvb-form-send vvb-route-retry" onClick={e => { stop(e); route.onRetry?.() }}>Повторить</button>
        )}

        {dislikeOpen && !route && (
          <form className="vvb-form vvb-dislike-form" onSubmit={handleDislikeSubmit} onClick={stop}>
            <p className="vvb-form-title">Насколько это видео могло бы Вам подходить?</p>
            <div className="vvb-scale" role="radiogroup" aria-label="Оценка соответствия видео, от 0 до 10">
              <div className="vvb-scale-btns">
                {DISLIKE_SCALE.map(n => (
                  <button
                    key={n}
                    type="button"
                    className={`vvb-scale-btn${dislikeScore === n ? ' is-active' : ''}`}
                    role="radio"
                    aria-checked={dislikeScore === n}
                    aria-label={`${n} из 10`}
                    onClick={e => { stop(e); setDislikeScore(n) }}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <div className="vvb-scale-labels">
                <span>0 — абсолютно не подходит</span>
                <span>10 — точно подходит</span>
              </div>
            </div>
            <div className="vvb-reason-list">
              {DISLIKE_REASONS.map(reason => (
                <button
                  key={reason}
                  type="button"
                  className={`vvb-reason-btn${dislikeReasons.includes(reason) ? ' is-active' : ''}`}
                  aria-pressed={dislikeReasons.includes(reason)}
                  onClick={e => { stop(e); toggleDislikeReason(reason) }}
                >
                  {reason}
                </button>
              ))}
            </div>
            <button type="submit" className="vvb-form-send" disabled={dislikeScore === null}>
              Отправить
            </button>
          </form>
        )}

        {flagOpen && (
          <form className="vvb-form vvb-flag-form" onSubmit={handleFlagSubmit} onClick={stop}>
            <div className="vvb-reason-list">
              {FLAG_REASONS.map(reason => (
                <button
                  key={reason}
                  type="button"
                  className={`vvb-reason-btn${flagReasons.includes(reason) ? ' is-active' : ''}`}
                  aria-pressed={flagReasons.includes(reason)}
                  onClick={e => { stop(e); toggleFlagReason(reason) }}
                >
                  {reason}
                </button>
              ))}
            </div>
            <textarea
              className="vvb-flag-textarea"
              placeholder="Что не так? (обязательно)"
              value={comment}
              maxLength={COMMENT_MAX_LEN}
              rows={4}
              onChange={e => setComment(e.target.value)}
              aria-label="Комментарий"
            />
            <button type="submit" className="vvb-form-send" disabled={!comment.trim()}>
              Отправить
            </button>
          </form>
        )}
        </>
      )}
    </div>
  )
}
