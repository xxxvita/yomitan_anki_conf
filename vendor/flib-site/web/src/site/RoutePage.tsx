// RoutePage.tsx — /route, твой маршрут.
//
// Порт temp/flib/route.jsx — только вариант отображения RouteListView
// (route.jsx:117-144, вертикальный список-путь). Варианты RouteTrackView
// (горизонтальная дорожка) и RouteMapView (карта-восхождение) — черновики,
// не переносим (план, Э2 п.3). Секции "богатой" страницы вернувшегося
// пользователя из оригинала (route-hero/route-stats/assistant/probe-strip —
// route.jsx:202-248) тоже не переносим: они завязаны на WEEK_DIFF/PROBES/
// ROUTE_META, которых нет в нашей модели RouteState (route-state.ts) — план
// Э2 их не требует, только список + FreshBanner + настройки.
//
// Состояния (план, Э2 п.3 + Э3): 1) нет flib:route И нет flib:pointA →
// empty-state, кнопка на /fork. 2) нет flib:route, есть flib:pointA →
// реальный buildRoute (api.ts) + saveRoute, показ с FreshBanner
// (route.jsx:258-281). 3) есть flib:route → список без баннера, заголовок +
// прогресс. Э3 добавляет ДВА сквозных состояния поверх любого из трёх:
// «строим» (спиннер, пока buildRoute поллит джобу) и «ошибка» (сеть/failed/
// таймаут) — buildMockRoute (route-state.ts) больше не вызывается отсюда,
// но остаётся экспортирован для route-state.test.ts.
//
// Тёмп «сл/мин» НЕ рендерится нигде на странице — решение владельца (план,
// «Открытые вопросы — ЗАКРЫТЫ» п.2): в макетах есть, в RouteStep поля нет.
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate, Link, Navigate } from 'react-router-dom'
import { useSession } from './useSession'
import { cabinetMarked } from './session'
import { cabinetRouteMarked } from './cabinet/route/route-storage'
import { BrandMark } from './BrandMark'
import { buildRoute, type ApiPointA, type BuildRoutePhase, type ProfileMeta, type RouteGoal } from './api'
import { loadPointA, clearPointA, type PointA } from './pointA'
import { goalOf } from './route-goal'
import {
  loadRoute, saveRoute, clearRoute, ensureAnonId, visibleSteps, hasMore, markStepDone, spliceReplaceFrom,
  addExcludedVideo,
  type RouteState, type RouteStep, type RouteStepStatus, type RouteProfile,
} from './route-state'
import { reportRouteNext } from './ab-events'
import { plural } from './plural'
import { materializeVocabFromPointA } from './materialize-vocab'
import { addWords, exportKnoWords, importWords, loadVocab, vocabCount } from './vocab'
import { parseVocabFile } from './parse-vocab'
import { useVideoChat } from '../player/hooks/useVideoChat'
import { VideoChatPanel } from '../player/components/VideoChatPanel'
import { parseVideoId } from '../lib/parse-video-id'

const PHASE_LABEL: Record<BuildRoutePhase, string> = {
  pending: 'В очереди…',
  running: 'Строим шаги маршрута…',
}

function toApiPointA(pointA: PointA): ApiPointA {
  if (pointA.kind === 'cefr') return { kind: 'cefr', level: pointA.level }
  return { kind: 'words', words: pointA.words }
}

// toProfileMeta — задача P-profile-feed (2026-07-14): собирает profile_meta
// тела POST /api/route из pointA. kind='cefr' (TryPage.tsx) — всегда несёт
// уровень и возраст (слайдер age со значением по умолчанию, не пуст).
// kind='words' — либо ResultScreen.tsx (source:'test', есть только
// levelEstimate, возраста тест не собирает), либо ImportPage.tsx
// (source:'upload', нет ни возраста, ни оценки уровня). source может быть
// undefined только у СТАРЫХ localStorage-записей pointA (до этой задачи) —
// тогда честно шлём 'unknown', не угадывая upload/test по форме данных.
function toProfileMeta(pointA: PointA): ProfileMeta {
  if (pointA.kind === 'cefr') {
    return { vocab_source: 'cefr', level: pointA.level, age: pointA.ageBand }
  }
  return { vocab_source: pointA.source ?? 'unknown', level: pointA.levelEstimate }
}

const STATUS_LABEL: Record<RouteStepStatus, string> = {
  done: 'пройдено',
  current: 'сейчас',
  next: 'дальше',
  locked: '🔒',
}

const PROFILES: { id: RouteProfile; title: string; sub: string }[] = [
  { id: 'comfort', title: 'Комфорт', sub: '5% нового' },
  { id: 'balance', title: 'Баланс', sub: 'между 5 и 15%' },
  { id: 'learning', title: 'Обучение', sub: 'до 15% нового' },
]

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

// T3 (докс владельца, скрин шапки маршрута): кнопка-ссылка на скачивание
// Flibooster по центру шапки — между лого и "← на главную". Общий компонент
// вместо инлайна в каждой из 5 веток рендера RoutePage (building/error/
// empty/target-reached/main) — иначе кнопку пришлось бы дублировать 5 раз
// и она рисковала бы разъехаться (забыли добавить в одну из веток).
// page-topbar-dl — CSS-модификатор (site-theme.css), не трогает обычный
// .page-topbar (2 элемента, flex space-between) — им пользуются ImportPage/
// TryPage/ForkPage без кнопки скачивания.
function PageTopbar() {
  return (
    <div className="page-topbar page-topbar-dl">
      <BrandMark />
      <a
        className="btn btn-ghost btn-sm dl-app-btn"
        href="/download.html"
        target="_blank"
        rel="noopener noreferrer"
      >
        Скачать приложение Flibooster
      </a>
      <Link className="back-link" to="/">← на главную</Link>
    </div>
  )
}

// ---- модалка настроек маршрута (route.jsx:5-73, упрощена под RouteState —
// только профиль сложности; minutes/words/interests-слайдеры оригинала не
// портируются, в нашей модели RouteSettings им нет соответствия) ----
function RouteSettingsModal({
  current, onClose, onRebuild, onReset,
}: {
  current: RouteProfile
  onClose: () => void
  onRebuild: (profile: RouteProfile) => void
  onReset: () => void
}) {
  const [profile, setProfile] = useState<RouteProfile>(current)
  // feedback-2 п.2 (владелец, транскрипт screencast3, 04:51–05:11): «Сбросить
  // маршрут» — двухшаговое подтверждение ВНУТРИ самой кнопки, БЕЗ
  // window.confirm. Первый клик армирует (resetArmed=true, подпись меняется
  // на предупреждение, кнопка красится в --danger); второй клик по армированной
  // кнопке реально выполняет сброс (onReset). Клик где-либо ещё в модалке
  // (rs-modal onClick ниже) ИЛИ Esc (onKey ниже) разоружает без действия.
  const [resetArmed, setResetArmed] = useState(false)
  const resetBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (resetArmed) { setResetArmed(false); return }
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, resetArmed])

  function handleResetClick() {
    if (!resetArmed) { setResetArmed(true); return }
    onReset()
  }

  return (
    <div className="rs-overlay" onClick={onClose}>
      <div
        className="rs-modal"
        onClick={e => {
          e.stopPropagation()
          // Любой клик внутри модалки, КРОМЕ самой кнопки сброса (первый клик
          // по ней армирует и не должен сам себя тут же разоружать) —
          // разоружает подтверждение (профиль-чипы, Отмена, Пересобрать, тело).
          if (resetArmed && !resetBtnRef.current?.contains(e.target as Node)) {
            setResetArmed(false)
          }
        }}
      >
        <div className="rs-head">
          <div>
            <div className="eyebrow">Настройки маршрута</div>
            <h2>Под Ваш темп и вкус</h2>
            <p>Маршрут пересоберётся под новый профиль — цель останется прежней.</p>
          </div>
          <button type="button" className="rs-x" onClick={onClose} aria-label="закрыть">✕</button>
        </div>
        <div className="rs-body">
          <div className="rs-field">
            <div className="rf-top"><span className="rf-lbl">Сложность роликов</span></div>
            <div className="rs-seg">
              {PROFILES.map(p => (
                <button
                  key={p.id}
                  type="button"
                  className={`rs-seg-btn ${profile === p.id ? 'on' : ''}`}
                  onClick={() => setProfile(p.id)}
                >
                  <div className="st">{p.title}</div>
                  <div className="ss">{p.sub}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="rs-foot">
          <button
            type="button"
            ref={resetBtnRef}
            className={`btn btn-ghost rs-reset-btn${resetArmed ? ' is-armed' : ''}`}
            onClick={handleResetClick}
          >
            {resetArmed ? 'Точно сбросить? Данные пропадут' : 'Сбросить маршрут'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Отмена</button>
          <button type="button" className="btn btn-amber" onClick={() => onRebuild(profile)}>Пересобрать маршрут</button>
        </div>
      </div>
    </div>
  )
}

// ReplaceVideoModal — ТЗ-replace-video (владелец-бриф): попап «Почему вы
// хотите заменить это видео?» — ОДНА надпись + textarea (в отличие от
// VideoVoteBar-флага, у которого сверху ещё мультивыбор кнопок-причин: ТЗ
// прямо просит "как у дизлайка, но одна надпись + текст", кнопки-причины не
// переносим). Переиспользует rs-overlay/rs-modal/rs-head/rs-body/rs-foot —
// это ОБЩИЙ модальный каркас темы (тот же, что RouteSettingsModal), а не
// специфика настроек — заводить отдельный набор классов ради одной надписи
// было бы дублированием.
function ReplaceVideoModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (reason: string, blockChannel: boolean) => void }) {
  const [reason, setReason] = useState('')
  // blockChannel — галка «убрать весь канал автора» [ID:P-exclude-video].
  // Дефолт false: замена одного видео — обычный случай; исключить целый канал —
  // осознанный опт-ин пользователя, не должен стоять по умолчанию.
  const [blockChannel, setBlockChannel] = useState(false)

  // Аудит MED: Escape закрывает окошко — та же конвенция, что у соседней
  // RouteSettingsModal в этом файле (без обработчика Esc окно закрывалось бы
  // только кликом по оверлею/✕/«Отмена» — рассинхрон с уже принятым в файле
  // паттерном модалок).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = reason.trim()
    if (!trimmed) return // кнопка и так задизейблена — защита от программного submit (тот же принцип, что VideoVoteBar)
    onSubmit(trimmed, blockChannel)
  }

  return (
    <div className="rs-overlay" onClick={onClose}>
      <div className="rs-modal" onClick={e => e.stopPropagation()}>
        <div className="rs-head">
          <div>
            <div className="eyebrow">Заменить видео</div>
            <h2>Почему Вы хотите заменить это видео?</h2>
          </div>
          <button type="button" className="rs-x" onClick={onClose} aria-label="закрыть">✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="rs-body">
            <textarea
              className="rp-reason-textarea"
              placeholder="Расскажите, что не так — учтём при подборе следующего видео"
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={4}
              maxLength={500}
              autoFocus
              aria-label="Причина замены"
            />
            {/* Галка [ID:P-exclude-video]: помимо текущего видео исключить ВЕСЬ
             *  канал автора. Клиент шлёт только video_id (channel_id тут нет) —
             *  демон резолвит канал сам. */}
            <label className="rp-block-channel">
              <input
                type="checkbox"
                checked={blockChannel}
                onChange={e => setBlockChannel(e.target.checked)}
              />
              <span>Больше не показывать видео этого автора в маршруте</span>
            </label>
          </div>
          <div className="rs-foot">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Отмена</button>
            <button type="submit" className="btn btn-amber" disabled={!reason.trim()}>Заменить</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function FreshBanner({ route, onStart, onSettings }: { route: RouteState; onStart: () => void; onSettings: () => void }) {
  const totalCount = route.steps.length
  const totalSec = route.steps.reduce((sum, s) => sum + s.durationSec, 0)
  // feedback-1 п.5б: маршрут короче часа показывал «≈0 часов» — бессмысленно
  // (владелец воспроизвёл на The Wire, транскрипт 2026-07-14, 07:10–07:15).
  // Ниже часа показываем минуты, от часа — часы; оба со склонением (п.5а).
  const useMinutes = totalSec < 3600
  const durationValue = useMinutes ? Math.round(totalSec / 60) : Math.round(totalSec / 3600)
  const durationUnit = useMinutes
    ? plural(durationValue, 'минута', 'минуты', 'минут')
    : plural(durationValue, 'час', 'часа', 'часов')
  const stepsWord = plural(totalCount, 'шаг', 'шага', 'шагов')
  // Аудит MED #6: если во всём маршруте нет ни одного видео-шага с videoId
  // (напр. маршрут целиком из words-шагов), «Смотреть первое видео» была
  // кликабельна, но handleStartFirst — молчаливый no-op. Дизейблим честно,
  // не прячем кнопку — состояние видно, а не "ничего не произошло".
  const hasFirstVideo = route.steps.some(s => s.kind === 'video' && s.videoId)
  return (
    <>
      <div className="fresh-banner">
        <div className="fb-l">
          <div className="eyebrow" style={{ marginBottom: 8 }}>Маршрут готов</div>
          <h2>{route.goalLabel}</h2>
          <p>Кратчайшая цепочка из {totalCount} {stepsWord}. Начните с первого — дальше откроется по ходу.</p>
        </div>
        <div className="fb-stats">
          <div className="s"><b>{totalCount}</b><span>{stepsWord}</span></div>
          <div className="s"><b>≈{durationValue}</b><span>{durationUnit}</span></div>
        </div>
      </div>
      <div className="fresh-actions">
        <button type="button" className="btn btn-amber btn-lg" disabled={!hasFirstVideo} onClick={onStart}>▶ Смотреть первое видео</button>
        <button type="button" className="route-settings-btn" onClick={onSettings}>⚙ Настройки маршрута</button>
      </div>
    </>
  )
}

function VideoStepCard({ step, onOpen }: { step: RouteStep; onOpen: (step: RouteStep) => void }) {
  const locked = step.status === 'locked'
  // Аудит MED #6: video-шаг без videoId — клик был мёртвым (openStep молча
  // ничего не делал), но кнопка выглядела рабочей. Дизейблим честно.
  const disabled = locked || !step.videoId
  return (
    <button type="button" className="rl-card" disabled={disabled} onClick={() => onOpen(step)}>
      <div className="rl-thumb" aria-hidden="true">{locked ? '🔒' : '▶'}</div>
      <div className="rl-info">
        <div className="rl-t">{step.title}</div>
        <div className="rl-ch">{step.source} · {formatDuration(step.durationSec)}</div>
      </div>
      <div className="rl-metrics">
        <div className="m">+{step.newLemmas} слов</div>
      </div>
      <span className={`rl-status ${step.status}`}>{STATUS_LABEL[step.status]}</span>
    </button>
  )
}

// Карточка kind='words' — решение владельца (план, «Открытые вопросы —
// ЗАКРЫТЫ» п.5): простой список слов КАК ЕСТЬ, без перевода, без дизайна
// (его нет).
// Кнопка-действие — ТОЛЬКО у current-шага, ghost-стиль и глагольный текст:
// прод-инцидент 2026-07-14 (скрин друга владельца с телефона) — ярко-жёлтая
// кнопка «Пройдено» на КАЖДОЙ words-карточке читалась как статус-бейдж
// («у него все элементы маршрута в статусе пройдено»), хотя реальные статусы
// в данных были корректны. Действие не должно выглядеть как состояние.
function WordsStepCard({ step, onDone }: { step: RouteStep; onDone: (stepId: string) => void }) {
  const canComplete = step.status === 'current'
  return (
    <div className="words-card">
      <div className="wc-head">
        <div className="wc-title">Слова к маршруту</div>
        <span className={`rl-status ${step.status}`}>{STATUS_LABEL[step.status]}</span>
      </div>
      <div className="chip-row">
        {step.words.map(w => <span key={w} className="chip" style={{ cursor: 'default' }}>{w}</span>)}
      </div>
      {canComplete && (
        <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 14 }} onClick={() => onDone(step.id)}>
          Отметить пройденным ✓
        </button>
      )}
    </div>
  )
}

// Phase 2, п.E: «Перестроить маршрут» — кнопка СПРАВА от карточки, но ТОЛЬКО
// у current-шага (столько же карточек одновременно current, сколько markStepDone
// проставляет — максимум одна, route-state.ts). rl-item уже flex-row (rail +
// card) — третий flex-child естественно встаёт справа от карточки, без правок
// .rl-rail/.rl-card.
// canReplaceStep — ТЗ-replace-video: ↻ «Заменить» — ЛЮБОЙ video-шаг, который
// ещё НЕ 'done' (current ИЛИ предстоящий next/locked). Заменять пройденный
// шаг бессмысленно — его слова уже осели в flib:vocab (addWords в
// handleWordsDone/route-step-nav.ts), замена задним числом их не отнимет.
// words-шаги и карточка цели (rl-goal-item, отдельный блок в RoutePage,
// сюда не попадает) кнопки не получают — ТЗ прямо говорит "у видео на
// маршруте".
function canReplaceStep(step: RouteStep): boolean {
  return step.kind === 'video' && step.status !== 'done'
}

function RouteListItem({
  step, onOpen, onWordsDone, onRestructure, onReplace,
}: {
  step: RouteStep
  onOpen: (step: RouteStep) => void
  onWordsDone: (stepId: string) => void
  onRestructure: () => void
  onReplace: (step: RouteStep) => void
}) {
  return (
    <div className={`rl-item ${step.status}`}>
      <div className="rl-rail"><div className="rl-dot" /></div>
      {step.kind === 'words'
        ? <WordsStepCard step={step} onDone={onWordsDone} />
        : <VideoStepCard step={step} onOpen={onOpen} />}
      {step.status === 'current' && (
        <button
          type="button"
          className="rl-restructure-btn"
          onClick={onRestructure}
          title="Пересобрать маршрут из текущего накопленного словаря"
        >
          ↻ Перестроить
        </button>
      )}
      {/* rl-replace-btn — ДРУГАЯ кнопка, не альтернативная подпись
       *  rl-restructure-btn: «Перестроить» пересобирает ВЕСЬ маршрут с
       *  нуля и живёт ТОЛЬКО у current-шага; «Заменить» трогает ОДИН этот
       *  шаг (+ всё после него, сборка "с этого места", см.
       *  spliceReplaceFrom) и живёт у ЛЮБОГО непройденного видео-шага — на
       *  current-шаге они рендерятся РЯДОМ, это два независимых действия,
       *  не взаимоисключающих. Визуально приглушённее (site-theme.css:
       *  soft/line, не amber) — точечное действие не должно перетягивать
       *  внимание с более заметной «Перестроить». disabled без videoId —
       *  тот же принцип, что VideoStepCard (аудит MED #6): без videoId
       *  нечего слать в video_id фидбека. */}
      {canReplaceStep(step) && (
        <button
          type="button"
          className="rl-replace-btn"
          disabled={!step.videoId}
          onClick={() => onReplace(step)}
          title="Заменить это видео (маршрут перестроится с этого места)"
        >
          ↻ Заменить
        </button>
      )}
    </div>
  )
}

// RouteToolsPanel — Phase 2, п.D+F: словарь (скачать/загрузить) + "свой
// URL"/слово-запрос с примерами YouTube/фильмов через тот же VideoChatPanel/
// useVideoChat, что уже работает в плеере (T1a) — самодостаточный блок (тот
// же принцип, что RouteStepBar/VideoVoteBar), RoutePage передаёт только
// goalLabel для подписи "Твой маршрут / <цель>" — F просит разместить блок
// "сверху справа, у «Твой маршрут / The Office»"; вместо дублирования этой
// подписи в ОБЕИХ ветках рендера заголовка (FreshBanner/route-head — разные
// компоненты, разный текст цели) блок несёт собственную компактную подпись и
// живёт одним местом сразу после PageTopbar.
//
// ИНТЕРПРЕТАЦИЯ поля ввода (документируется по требованию ТЗ п.F, т.к. в
// тексте задачи не сказано явно): ОДНО поле — ДВЕ роли по контексту действия.
// Кнопка «Открыть» трактует текст как YouTube-ссылку/video_id. Клик по одной
// из двух подписей ниже трактует ТОТ ЖЕ текст как слово-запрос для «Чат:
// Видео» — эти два намерения не сталкиваются: пользователь либо жмёт
// «Открыть», либо кликает подпись, не оба одновременно над одним значением.
function RouteToolsPanel({ goalLabel }: { goalLabel: string }) {
  const navigate = useNavigate()
  const videoChat = useVideoChat()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [urlOrWord, setUrlOrWord] = useState('')
  const [hint, setHint] = useState<string | null>(null)
  const [importMsg, setImportMsg] = useState<string | null>(null)

  // handleDownload — D: скачивает flib-vocab.json (Blob) с round-trip-
  // совместимой формой exportKnoWords ([{word,added_at,source}] — parse-vocab.ts
  // читает такую же форму обратно). Пустой словарь — валидный []-файл, кнопка
  // ПО ТЗ остаётся активной (не дизейблена на пустом словаре).
  function handleDownload() {
    const data = exportKnoWords()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'flib-vocab.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  // handleFileChange — D: тот же паттерн чтения файла, что ImportPage.tsx
  // (FileReader, не File.text() — jsdom 25.x его не реализует, см. doc-
  // комментарий ImportPage.tsx). e.target.value сбрасываем ПОСЛЕ чтения —
  // иначе повторный выбор ТОГО ЖЕ файла подряд не породил бы новый onChange.
  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const text = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result ?? ''))
        reader.onerror = () => reject(reader.error ?? new Error('file read error'))
        reader.readAsText(file)
      })
      const { words, errors } = parseVocabFile(text, file.name)
      if (words.length > 0) {
        importWords(words, 'upload')
        setImportMsg(`Добавлено ${words.length} ${plural(words.length, 'слово', 'слова', 'слов')}`)
      } else {
        setImportMsg(errors[0] ?? 'Слова не распознаны')
      }
    } catch {
      setImportMsg('Не удалось прочитать файл')
    }
  }

  function handleOpen() {
    // parseVideoId — та же утилита, что StartPage.tsx (lib/parse-video-id.ts):
    // youtu.be/<id>, youtube.com/…?v=<id>, /embed/<id> и голый 11-символьный
    // id. Не дублируем разбор ссылки второй раз в кодовой базе.
    const id = parseVideoId(urlOrWord)
    if (!id) {
      setHint('Не похоже на ссылку YouTube — вставьте youtu.be/… или youtube.com/watch?v=…')
      return
    }
    setHint(null)
    navigate(`/player?v=${id}`)
  }

  function handleExamples(kind: 'youtube' | 'film') {
    const word = urlOrWord.trim()
    if (!word) {
      setHint('Сначала введите слово')
      return
    }
    setHint(null)
    videoChat.requestExamples(word, kind)
  }

  return (
    <div className="route-tools">
      <div className="route-tools-eyebrow">Ваш маршрут · {goalLabel}</div>

      <div className="route-tools-row">
        <button type="button" className="btn btn-ghost btn-sm" onClick={handleDownload}>
          ⬇ Скачать словарь ({vocabCount()})
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => fileInputRef.current?.click()}>
          ⬆ Загрузить словарь
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,.txt,.csv"
          className="route-tools-file-input"
          aria-label="Загрузить файл словаря"
          onChange={e => void handleFileChange(e)}
        />
        {importMsg && <span className="route-tools-msg">{importMsg}</span>}
      </div>

      <div className="route-tools-row">
        <input
          type="text"
          className="route-url-input"
          placeholder="Своя ссылка YouTube или слово для примеров"
          value={urlOrWord}
          onChange={e => { setUrlOrWord(e.target.value); setHint(null) }}
        />
        <button type="button" className="btn btn-ghost btn-sm" onClick={handleOpen}>Открыть</button>
      </div>
      <div className="route-tools-row route-examples-row">
        <button type="button" className="route-examples-link" onClick={() => handleExamples('youtube')}>Примеры YouTube</button>
        <button type="button" className="route-examples-link" onClick={() => handleExamples('film')}>Учебные примеры из фильмов</button>
      </div>
      {hint && <div className="route-tools-hint">{hint}</div>}

      {/* .route-vcp-host — позиционирующий предок для .video-chat-panel
       *  (video-chat-panel.css: position:absolute якорится на ближайший
       *  positioned-предок; в плеере это .fs-root, здесь своего нет) —
       *  fixed-инсет на весь вьюпорт даёт тот же полноэкранный
       *  drawer/оверлей на мобиле, что и в плеере, без правок самого
       *  video-chat-panel.css (общий с плеером файл не трогаем). */}
      <div className="route-vcp-host">
        <VideoChatPanel
          open={videoChat.state.open}
          word={videoChat.state.word}
          status={videoChat.state.status}
          items={videoChat.state.items}
          errorMessage={videoChat.state.errorMessage}
          onClose={videoChat.close}
        />
      </div>
    </div>
  )
}

// RoutePage — старый путь /route (план B11; спека §4.9, Р17). Залогиненный при
// включённых кабинете и маршруте (обе метки BFF в index.html) уходит на
// /app/route; пока снимок сессии не прочитан — ни старой страницы, ни перехода,
// а спиннер загрузки этой же страницы (ревью 3b, L6: не пустой экран). Чтение
// сессии ограничено своим сроком (session.ts) — после него старая страница.
// Без меток — старая страница сразу, без чтения сессии (как до кабинета).
export function RoutePage() {
  const marked = cabinetMarked() && cabinetRouteMarked()
  const s = useSession({ passive: !marked })
  if (marked && s.status === 'loading') return <RouteSessionLoading />
  if (marked && s.status === 'ready' && s.authenticated) return <Navigate to="/app/route" replace />
  return <RoutePageGuest />
}

function RouteSessionLoading() {
  return (
    <div className="site">
      <div className="view">
        <div className="page page-narrow">
          <PageTopbar />
          <div className="route-loading" data-testid="route-session-loading" aria-busy="true">
            <div className="spinner" aria-hidden="true" />
          </div>
        </div>
      </div>
    </div>
  )
}

function RoutePageGuest() {
  const navigate = useNavigate()
  const [initialRoute] = useState<RouteState | null>(() => loadRoute())
  const [pointA] = useState<PointA | null>(() => loadPointA())
  const [route, setRoute] = useState<RouteState | null>(initialRoute)
  const [fresh, setFresh] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // building=true с первого рендера, если маршрута ещё нет, но точка А есть —
  // иначе между монтированием и запуском эффекта мелькнёт empty-state
  // (план, Э2 п.3, состояние 1) вместо спиннера сборки (Э3).
  const [building, setBuilding] = useState<boolean>(() => !initialRoute && Boolean(pointA))
  const [phase, setPhase] = useState<BuildRoutePhase>('pending')
  const [buildError, setBuildError] = useState<string | null>(null)
  const [pendingProfile, setPendingProfile] = useState<RouteProfile>('balance')
  // replaceStep — ТЗ-replace-video: какой шаг сейчас "в работе" у окошка
  // «Почему Вы хотите заменить это видео?» (null — окошко закрыто). Сам шаг,
  // не просто id/boolean — handleReplaceVideo нужен step.videoId для
  // фидбека и step.id для поиска индекса в route.steps на момент submit.
  const [replaceStep, setReplaceStep] = useState<RouteStep | null>(null)
  // Аудит HIGH #3: контроллер текущего незавершённого билда — abort() на
  // unmount эффекта сборки (StrictMode-двойной POST/поллинг, переживающий
  // unmount) и на каждый новый вызов runBuild (пересборка отменяет
  // предыдущую незавершённую, а не гоняет их параллельно).
  const buildControllerRef = useRef<AbortController | null>(null)

  // runBuildCore — общее тело "построить маршрут через buildRoute + записать
  // в стейт/localStorage + обработать отмену/ошибку" (Аудит HIGH #3: тот же
  // AbortController-снаряд). Вынесено из runBuild в Phase 2, п.E: «Перестроить
  // маршрут» (handleRestructure ниже) — ДРУГОЙ point_a (слова из flib:vocab,
  // не исходная точка А), но goal_ids/profile/profile_meta/весь спиннер-флоу
  // (building/phase/buildError/FreshBanner) — тот же самый, дублировать его
  // ради одного другого аргумента было бы риском разъехаться при следующей
  // правке (как и было с батч-логикой computeBatchIndexes).
  async function runBuildCore(
    apiPointA: ApiPointA, goalIds: string[], profile: RouteProfile,
    opts: {
      interests?: string[]
      profileMeta?: ProfileMeta
      // excludeVideoIds/excludeChannelsOfVideoIds — [ID:P-exclude-video]:
      // отклонённые видео (и видео, чьи каналы юзер выключил галкой) —
      // прокидываются в buildRoute → params джобы демона. Пусто → не шлём.
      excludeVideoIds?: string[]
      excludeChannelsOfVideoIds?: string[]
      // targets — [ID:P-film-picker] contract §3.7: FilmPicker-цель
      // (filmTargetOf(pointA)), пробрасывается ВО ВСЕ ТРИ call site ниже —
      // тот же принцип, что excludeVideoIds чуть выше.
      targets?: string[]
      // goal — [ID:P-abstract-goals] contract §1 §2.5: блок `goal`
      // (goalOf(pointA).goal), ТОЖЕ пробрасывается во все три call site ниже
      // — пропуск здесь означал бы, что «Перестроить»/«Заменить» на
      // goalsV2-маршруте молча растеряли бы цель (тот же класс CRIT, что
      // filmTargetOf выше, contract §2.5 Q1-c).
      goal?: RouteGoal
      // combine — ТЗ-replace-video: handleReplaceVideo не хочет ЦЕЛИКОМ
      // заменять route.steps результатом билда (это делает handleRestructure
      // по умолчанию, identity ниже) — ему нужна СКЛЕЙКА префикса с новым
      // хвостом (spliceReplaceFrom). Опционально — оба остальных вызывающих
      // (runBuild/handleRestructure) его не передают, ведут себя как раньше.
      combine?: (built: RouteState) => RouteState
      // skipFresh — та же задача: FreshBanner ("Маршрут готов" + «Смотреть
      // первое видео») предполагает, что ВЕСЬ маршрут только что собран с
      // нуля — handleStartFirst берёт ПЕРВЫЙ video-шаг маршрута БЕЗ учёта
      // статуса, что после частичной склейки (замена НЕ первого шага) увело
      // бы «Смотреть первое видео» на уже пройденный/старый префикс, не на
      // только что заменённое видео. Для replace показываем обычный
      // route-head (заголовок + прогресс), не баннер.
      skipFresh?: boolean
    },
    onSuccess?: () => void,
  ) {
    buildControllerRef.current?.abort()
    const controller = new AbortController()
    buildControllerRef.current = controller
    setPendingProfile(profile)
    setBuilding(true)
    setBuildError(null)
    setPhase('pending')
    try {
      const built = await buildRoute(apiPointA, goalIds, profile, {
        onPhase: setPhase, signal: controller.signal, interests: opts.interests, profileMeta: opts.profileMeta,
        excludeVideoIds: opts.excludeVideoIds, excludeChannelsOfVideoIds: opts.excludeChannelsOfVideoIds,
        targets: opts.targets, goal: opts.goal,
      })
      const finalRoute = opts.combine ? opts.combine(built) : built
      saveRoute(finalRoute)
      setRoute(finalRoute)
      // Аудит MED: setFresh(!skipFresh), а НЕ "if (!skipFresh) setFresh(true)" —
      // замену можно нажать сразу после первой сборки, пока fresh ещё true и
      // виден FreshBanner (список шагов с кнопками ↻ рендерится ПОД баннером).
      // Без явного сброса в false баннер «Маршрут готов»/«Смотреть первое
      // видео» остался бы после замены (а первое видео там — старый префикс,
      // не заменённое), вопреки обещанию skipFresh показывать обычный route-head.
      setFresh(!opts.skipFresh)
      setBuilding(false)
      onSuccess?.()
    } catch (err) {
      // Отмена (unmount/повторный runBuild) — не сбой, а сама механика
      // отмены: молча игнорируем, не показываем как buildError.
      if (err instanceof DOMException && err.name === 'AbortError') return
      setBuilding(false)
      setBuildError(err instanceof Error ? err.message : 'Не удалось собрать маршрут')
    }
  }

  async function runBuild(profile: RouteProfile) {
    if (!pointA) {
      // Аудит MED #5: раньше — тихий no-op (модалка настроек закрывалась, и
      // ничего не происходило). Теперь — явная ошибка с выходом на /fork
      // (кнопка уже есть в error-стейте ниже).
      setBuildError('Точка А не найдена — соберите маршрут заново')
      return
    }
    const resolved = goalOf(pointA)
    await runBuildCore(
      toApiPointA(pointA), resolved.goalIds, profile,
      { interests: pointA.interests, profileMeta: toProfileMeta(pointA), targets: resolved.targets, goal: resolved.goal },
      // Phase 2, п.C: точка А → flib:vocab ТОЛЬКО при УСПЕШНОЙ сборке (не на
      // каждый рендер/каждую точку А "просто лежащую" в localStorage) — не
      // ждём (fire-and-forget): обогащение словаря вторично, не должно
      // задерживать переход в "Маршрут готов".
      () => void materializeVocabFromPointA(pointA),
    )
  }

  // handleRestructure — Phase 2, п.E: «Перестроить маршрут» у current-шага.
  // point_a = ВЕСЬ накопленный словарь (flib:vocab), а не исходная точка А —
  // маршрут пересобирается с учётом уже пройденного/загруженного/материа-
  // лизованного, не с нуля. goal_ids/profile/interests/profile_meta берём из
  // ТОЙ ЖЕ сохранённой точки А (она несёт цель — сам факт "словами" не несёт
  // цели, см. toApiPointA/pointA.ts) — профиль берём из уже собранного
  // маршрута (route.settings.profile), не из pendingProfile (тот отражает
  // последний ЗАПРОШЕННЫЙ билд, а не обязательно активный, если billed ещё не
  // случился). Материализацию НЕ зовём — все слова здесь и так уже из vocab.
  async function handleRestructure() {
    if (!pointA) {
      setBuildError('Точка А не найдена — соберите маршрут заново')
      return
    }
    const vocabWords = Object.keys(loadVocab().words)
    const profile = route?.settings.profile ?? pendingProfile
    // [ID:P-exclude-video] полный пересбор ТОГО ЖЕ маршрута — исключения
    // остаются в силе (пользователь всё ещё не хочет эти видео) и должны
    // пережить пересборку: тянем их из текущего маршрута и переносим на новый
    // (identity-combine, т.к. handleRestructure заменяет весь маршрут — без
    // combine excludedVideos потерялись бы вместе со старым объектом).
    const exclusions = route?.excludedVideos ?? []
    const excludeVideoIds = exclusions.map(e => e.videoId)
    const excludeChannelsOfVideoIds = exclusions.filter(e => e.blockChannel).map(e => e.videoId)
    const resolved = goalOf(pointA)
    await runBuildCore(
      { kind: 'words', words: vocabWords }, resolved.goalIds, profile,
      {
        interests: pointA.interests,
        profileMeta: toProfileMeta(pointA),
        excludeVideoIds,
        excludeChannelsOfVideoIds,
        targets: resolved.targets,
        goal: resolved.goal,
        combine: exclusions.length > 0 ? built => ({ ...built, excludedVideos: exclusions }) : undefined,
      },
    )
  }

  // handleReplaceVideo — владелец-бриф «Заменить это видео»: (а) кладём
  // причину как фидбек verdict='replace' (internal/bff/video_feedback.go —
  // comment там ОБЯЗАТЕЛЕН, форма и так не даст submit пустой reason), (б)
  // перестраиваем маршрут "с этого места вперёд" — point_a/goal_ids/profile/
  // interests/profile_meta ТЕ ЖЕ, что у handleRestructure (текущий
  // накопленный словарь, не исходная точка А — заменяемое видео тоже
  // подбирается ИЗ АКТУАЛЬНОГО словаря, не из точки А на момент первой
  // сборки), но результат билда НЕ заменяет весь маршрут — склеивается с
  // префиксом через spliceReplaceFrom (route-state.ts), см. её doc-
  // комментарий за подробностями по id/статусам/revealedBatches.
  //
  // k ищем в route.steps НА МОМЕНТ клика (baseRoute), не в route на момент
  // завершения билда — пока идёт сборка, интерактивный список шагов вообще
  // не смонтирован: `if (building) return <спиннер>` (ниже) подменяет всю
  // страницу на "Собираем маршрут…", поэтому «Дальше»/«Отметить пройденным»
  // (единственные другие мутаторы route помимо сборок) физически недоступны
  // в окне сборки — baseRoute не может разойтись с актуальным route.
  async function handleReplaceVideo(step: RouteStep, reason: string, blockChannel: boolean) {
    // (1) фидбек — fire-and-forget, ошибку глотаем (тот же принцип, что
    // VideoVoteBar.reportVideoFeedback): это телеметрия причины замены, не
    // должна блокировать саму перестройку маршрута. videoId гарантирован
    // непустым — кнопка ↻ Заменить задизейблена без него (RouteListItem).
    if (step.videoId) {
      fetch('/api/feedback/video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ anon_id: ensureAnonId(), video_id: step.videoId, verdict: 'replace', comment: reason }),
      }).then(res => {
        if (!res.ok) console.warn('[feedback] replace feedback non-ok response', res.status)
      }).catch(err => {
        console.warn('[feedback] replace feedback failed', err)
      })
    }
    if (!route || !pointA) {
      setBuildError('Точка А не найдена — соберите маршрут заново')
      return
    }
    const baseRoute = route
    const k = baseRoute.steps.findIndex(s => s.id === step.id)
    // EDGE: шаг уже не в маршруте (двойной клик успел закрыть модалку и
    // склеить маршрут ДО этого второго submit, либо шаг ушёл под "Сбросить
    // маршрут"/пересборку между открытием окошка и submit) — молчаливый
    // no-op, нечего перестраивать (тот же принцип, что markStepDone на
    // неизвестном stepId).
    if (k === -1) return
    // (2) [ID:P-exclude-video] копим отклонённое видео в маршруте (дедуп по
    // videoId, blockChannel «липнет»). nextExclusions — то, что и уйдёт в
    // сборку, и осядет на новом маршруте (стирается при сбросе маршрута).
    const nextExclusions = addExcludedVideo(baseRoute.excludedVideos, step.videoId, blockChannel)
    const excludeVideoIds = nextExclusions.map(e => e.videoId)
    const excludeChannelsOfVideoIds = nextExclusions.filter(e => e.blockChannel).map(e => e.videoId)
    const vocabWords = Object.keys(loadVocab().words)
    const profile = baseRoute.settings.profile
    const resolved = goalOf(pointA)
    await runBuildCore(
      { kind: 'words', words: vocabWords }, resolved.goalIds, profile,
      {
        interests: pointA.interests,
        profileMeta: toProfileMeta(pointA),
        excludeVideoIds,
        excludeChannelsOfVideoIds,
        targets: resolved.targets,
        goal: resolved.goal,
        // combine: склейка префикса + перенос накопленных исключений на новый
        // маршрут (spliceReplaceFrom спредит ...baseRoute, но там СТАРЫЙ список
        // без только что добавленного видео — перекрываем свежим nextExclusions).
        combine: built => ({ ...spliceReplaceFrom(baseRoute, k, built.steps), excludedVideos: nextExclusions }),
        skipFresh: true,
      },
    )
  }

  // Состояние 2 (план, Э2 п.3 + Э3): маршрута ещё нет, но точка А есть —
  // реальная сборка через buildRoute (api.ts), не мок. Эффект, не
  // lazy-инициализатор useState — сборка пишет в localStorage (saveRoute) и
  // ходит в сеть, это побочный эффект, не чтение.
  useEffect(() => {
    if (initialRoute || !pointA) return
    void runBuild('balance')
    return () => { buildControllerRef.current?.abort() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (building) {
    return (
      <div className="site">
        <div className="view">
          <div className="page page-narrow">
            <PageTopbar />
            <div className="route-loading">
              <div className="spinner" aria-hidden="true" />
              <div className="eyebrow">{PHASE_LABEL[phase]}</div>
              <h1>Собираем маршрут…</h1>
              <p>Это может занять минуту — не закрывайте страницу.</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (buildError) {
    return (
      <div className="site">
        <div className="view">
          <div className="page page-narrow">
            <PageTopbar />
            <div className="route-empty">
              <div className="eyebrow">Ваш маршрут</div>
              <h1>Не получилось собрать маршрут</h1>
              <p>{buildError}</p>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-amber btn-lg" onClick={() => void runBuild(pendingProfile)}>
                  Попробовать снова
                </button>
                <button type="button" className="btn btn-ghost btn-lg" onClick={() => navigate('/fork')}>
                  ← изменить настройки
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!route) {
    // Состояние 1: ни маршрута, ни точки А.
    return (
      <div className="site">
        <div className="view">
          <div className="page page-narrow">
            <PageTopbar />
            <div className="route-empty">
              <div className="eyebrow">Ваш маршрут</div>
              <h1>Маршрута пока нет</h1>
              <p>Соберите маршрут за 60 секунд — выберите, как быстро хотите уточнить точку А.</p>
              <button type="button" className="btn btn-amber btn-lg" onClick={() => navigate('/fork')}>Собрать маршрут →</button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  function openStep(step: RouteStep) {
    if (step.status === 'locked') return
    if (step.kind === 'video' && step.videoId) {
      // Э5: route_step в query — плеер монтирует RouteStepBar (её самодостаточный
      // loadRoute() находит этот же шаг по id), см. player/components/RouteStepBar.tsx.
      navigate(`/player?v=${step.videoId}&route_step=${step.id}`)
    }
  }

  // Phase 2, п.B: words-шаги (kind='words') отмечаются пройденными ТОЛЬКО
  // здесь — advanceRouteStep (player/route-step-nav.ts) обслуживает только
  // video-путь (RouteStepBar/UnplayableOverlay), у words-шага нет отдельного
  // видео, где он мог бы жить. Тот же принцип накопления: пройденный шаг →
  // его слова в flib:vocab (source='learned') — иначе единственный путь
  // прохождения words-шага молча не питал бы словарь, в отличие от video-пути.
  function handleWordsDone(stepId: string) {
    if (!route) return
    const passedStep = route.steps.find(s => s.id === stepId)
    if (passedStep) addWords(passedStep.words, 'learned')
    const next = markStepDone(route, stepId)
    saveRoute(next)
    setRoute(next)
  }

  function handleNext() {
    if (!route) return
    const next: RouteState = { ...route, revealedBatches: route.revealedBatches + 1 }
    saveRoute(next)
    setRoute(next)
    // A/B-метрика: факт нажатия «Дальше» (план, «Архитектурные решения» п.4,
    // Э3: реальный POST /api/route/next (ab-events.ts), keepalive — клик
    // может быть последним перед переходом на первое видео нового батча.
    reportRouteNext({ anonId: ensureAnonId(), routeGoal: route.goalLabel, batch: next.revealedBatches })
  }

  // Пересборка из модалки настроек (план, Э3 п.2): реальный buildRoute с
  // выбранным профилем, тот же loading/error-стейт, что и первое построение
  // (runBuild). Цель остаётся прежней — берётся всё из того же pointA.
  function handleRebuild(profile: RouteProfile) {
    setSettingsOpen(false)
    setFresh(false)
    void runBuild(profile)
  }

  // feedback-2 п.2 (владелец, транскрипт screencast3, 04:51–05:11): «Сбросить
  // маршрут» — уходим "с нуля": оба ключа localStorage долой (маршрут +
  // точка А, см. clearRoute/clearPointA), модалка закрыта, навигация на
  // главную — там пользователь заново пройдёт /fork и получит маршрут.
  function handleResetRoute() {
    clearRoute()
    clearPointA()
    setSettingsOpen(false)
    navigate('/')
  }

  function handleStartFirst() {
    // route уже сужен к non-null веткой раннего return выше, но TS не
    // протаскивает это сужение во вложенные function-объявления (замыкания
    // могут пережить следующий рендер) — явная проверка для компилятора.
    if (!route) return
    const firstVideo = route.steps.find(s => s.kind === 'video')
    if (firstVideo?.videoId) navigate(`/player?v=${firstVideo.videoId}&route_step=${firstVideo.id}`)
  }

  const doneCount = route.steps.filter(s => s.status === 'done').length
  const totalCount = route.steps.length
  const visible = visibleSteps(route)
  const more = hasMore(route)

  // Пустой маршрут — НЕ ошибка: движок счёл, что словарь пользователя уже
  // покрывает цель (target_reached при baseline ≥ target_coverage, шагов не
  // нужно). Живой кейс: точка А ~2000 лемм + Friends. Пустой список под
  // баннером «Маршрут готов» выглядел бы как поломка — показываем честное
  // объяснение и выходы: другая цель (воронка) или другой профиль.
  if (totalCount === 0) {
    return (
      <div className="site">
        <div className="view">
          {settingsOpen && (
            <RouteSettingsModal
              current={route.settings.profile}
              onClose={() => setSettingsOpen(false)}
              onRebuild={handleRebuild}
              onReset={handleResetRoute}
            />
          )}
          <div className="page page-narrow">
            <PageTopbar />
            <div className="route-empty">
              <div className="eyebrow">Маршрут не понадобился</div>
              <h1>Ваш словарь уже покрывает «{route.goalLabel}»</h1>
              <p className="soft">
                Мы сравнили Вашу точку А с целью — промежуточные видео не нужны,
                можно смотреть цель сразу. Хотите замахнуться на что-то посложнее —
                выберите другую цель.
              </p>
              <div className="fresh-actions">
                <Link className="btn btn-amber btn-lg" to="/fork">Выбрать другую цель →</Link>
                <button type="button" className="route-settings-btn" onClick={() => setSettingsOpen(true)}>⚙ Настройки маршрута</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="site">
      <div className="view">
        {settingsOpen && (
          <RouteSettingsModal
            current={route.settings.profile}
            onClose={() => setSettingsOpen(false)}
            onRebuild={handleRebuild}
            onReset={handleResetRoute}
          />
        )}
        {replaceStep && (
          <ReplaceVideoModal
            onClose={() => setReplaceStep(null)}
            onSubmit={(reason, blockChannel) => {
              // Закрываем модалку СРАЗУ на submit (тот же принцип, что
              // VideoVoteBar-флаг: setFlagOpen(false) до/во время отправки) —
              // клик по «Заменить» — единственная точка, где реально
              // запускается перестройка; повторный submit того же
              // окна невозможен, окно уже размонтировано.
              const target = replaceStep
              setReplaceStep(null)
              void handleReplaceVideo(target, reason, blockChannel)
            }}
          />
        )}
        <div className="page">
          <PageTopbar />
          <RouteToolsPanel goalLabel={route.goalLabel} />

          {fresh ? (
            <FreshBanner route={route} onStart={handleStartFirst} onSettings={() => setSettingsOpen(true)} />
          ) : (
            <div className="route-head">
              <div>
                <div className="eyebrow">Ваш маршрут</div>
                <h1>{route.goalLabel}</h1>
                <div className="route-progress-label">{doneCount} из {totalCount} пройдено</div>
              </div>
              <button type="button" className="route-settings-btn" onClick={() => setSettingsOpen(true)}>⚙ Настройки маршрута</button>
            </div>
          )}

          <div className="section-label">Маршрут · шаг за шагом</div>
          {/* feedback-1 п.6: «Дальше» вынесена из карточек шагов — она живёт
           *  в разрыве (rl-gap) между видимой порцией и целью, отдельным
           *  элементом, не rl-card (владелец, транскрипт 2026-07-14,
           *  06:19–11:17). Разрыв (⋮) рисуется, только пока hasMore — есть
           *  ещё нераскрытые шаги. Карточка цели (rl-goal-item) — финальная
           *  строка маршрута — рендерится ВСЕГДА, даже когда весь маршрут уже
           *  раскрыт (пользователь должен всегда видеть свою точку Б). */}
          <div className="route-list">
            {visible.map(step => (
              <RouteListItem
                key={step.id} step={step} onOpen={openStep} onWordsDone={handleWordsDone}
                onRestructure={() => void handleRestructure()}
                onReplace={s => setReplaceStep(s)}
              />
            ))}
            {more && (
              <div className="rl-item rl-gap">
                <div className="rl-rail"><span className="rl-gap-dots" aria-hidden="true">⋮</span></div>
                <div className="rl-gap-next">
                  <button type="button" className="btn btn-ghost btn-lg" onClick={handleNext}>Дальше</button>
                </div>
              </div>
            )}
            <div className="rl-item rl-goal-item">
              <div className="rl-rail"><span className="rl-dot rl-dot-goal" aria-hidden="true">🏁</span></div>
              <div className="rl-goal-card">
                <div className="rl-goal-title">{route.goalLabel}</div>
                <div className="rl-goal-caption">Ваша цель</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
