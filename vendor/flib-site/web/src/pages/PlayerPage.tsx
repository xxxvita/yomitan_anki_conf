import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useSearchParams, useNavigate, Link } from 'react-router-dom'
import { Maximize2, Minimize2, Menu, Route as RouteIcon } from 'lucide-react'
import type { PlayerAdapter, UnplayablePayload } from '../adapter/PlayerAdapter'
import { PlayerRoot } from '../player/PlayerRoot'
// [ID:P-hybrid]: ДЕШЁВЫЙ ВРЕМЕННЫЙ гибрид — see doc у useState(transport) ниже
// и video-transport.ts (pure read/write seam, sessionStorage-персистентность
// выбора на остаток браузерной сессии).
import { parseLinkStart } from '../player/link-start'
import { resolveInitialTransport, writeStoredTransport, clearStoredTransport } from '../player/video-transport'
import { hasShadowingAccess } from '../player/shadow-access'
import { FullscreenContainer, type FullscreenHandle } from '../player/components/FullscreenContainer'
import { SubtitleOverlay } from '../player/components/SubtitleOverlay'
import { SubtitleL1Overlay } from '../player/components/SubtitleL1Overlay'
import { CountdownOverlay } from '../player/components/CountdownOverlay'
import { ShadowHoldOverlay } from '../player/components/ShadowHoldOverlay'
import { VideoControlsBar } from '../player/components/VideoControlsBar'
import { SettingsDrawer, SUBTITLE_MODE_OPTIONS } from '../player/components/SettingsDrawer'
import { useT } from '../player/i18n'
import { CueList } from '../player/components/CueList'
import { SubtitleSearch } from '../player/components/SubtitleSearch'
import { MiniToast, useMiniToast } from '../player/components/MiniToast'
import { LeftRail } from '../player/components/LeftRail'
// Э5 (план, docs/plan-2026-07-13-design-transfer.md): «шаг маршрута» + CTA
// «Отметить пройденным». Самодостаточный — читает flib:route сам, PlayerPage
// только даёт ей stepId из query `route_step` (см. монтирование ниже).
import { RouteStepBar } from '../player/components/RouteStepBar'
// Маршрут кабинета (спека 2026-11-17 §4.7, план B8b): маршрутный режим и гейт
// субтитров первого прохода. Без метки маршрута (CABINET_ROUTE_ENABLED) режим
// всегда 'off' — плеер ровно как до этапа 2.
import { useRouteMode } from '../player/route-events/route-mode'
import { useClipListened, useExtraListened } from '../player/route-events/clip-listened'
import { ackSubsWarning, forcedBlur, ruHidden, subsModeForClip, subsPillIntent, type SubsGateFacts } from '../player/route-events/subs-gate'
import { SubsFirstPassWarning } from '../player/components/SubsFirstPassWarning'
import { useRouteEvents, конецРолика } from '../player/route-events/useRouteEvents'
import { useRouteProgress } from '../player/route-events/progress'
import type { Счётчик } from '../player/route-events/subtitle-counter'
// feedback-2 п.3: лайк/дизлайк/"!" на каждом видео. Тот же самодостаточный
// паттерн, что RouteStepBar — PlayerPage передаёт только videoId, компонент
// сам знает про anon_id/сеть/выбор. Монтируется рядом с SubtitleOverlay ниже.
import { VideoVoteBar } from '../player/components/VideoVoteBar'
import { RouteEndCard, type EndCardVariant } from '../player/components/RouteEndCard'
import { BackToRouteLink, usePlayerRouteVote, useRouteHref, useVideoEnded } from '../player/route-events/player-route'
import { cabinetRouteMarked } from '../site/cabinet/route/route-storage'
import { minutesOf } from '../site/cabinet/route/day-actions'
import { useMediaQuery } from '../player/hooks/useMediaQuery'
import { getRouteOutbox } from '../site/cabinet/route/outbox'
import { runHeardCheck } from '../site/cabinet/route/heard-check/heard-check-flow'
import { confirmNextClip, SKIP_HC_PARAM } from '../site/cabinet/route/heard-check/next-warning-flow'
import { HeardCheckHost } from '../site/cabinet/route/heard-check/HeardCheckModal'
// T1a «видео-примеры по слову» [ID:P-video-chat] (docs/contract-2026-07-15-
// examples-by-word.md): клик по слову субтитра → WordPopup → «Чат: Видео»
// (VideoChatPanel). useVideoChat — самодостаточный хук (тот же принцип, что
// VideoVoteBar/RouteStepBar): PlayerPage только держит "какое слово сейчас
// показывает попап" (wordPopup, локальный UI-стейт), сеть/статус/карточки —
// внутри хука.
import { WordPopup, type WordPopupPosition } from '../player/components/WordPopup'
import { VideoChatPanel } from '../player/components/VideoChatPanel'
import { useVideoChat } from '../player/hooks/useVideoChat'
// P-unplayable: бот-стена/embed-запрет/удалено оверлей. Самодостаточный, тот
// же паттерн — PlayerPage только держит payload (из adapter.on('unplayable'))
// и даёт onRetry (пересоздать адаптер). См. монтирование внутри PlayerRoot ниже.
import { UnplayableOverlay } from '../player/components/UnplayableOverlay'
// Phase 2, п.G: «Мой маршрут» — ссылка слева вверху в .video-topbar (вернуться
// на /route). Обычная react-router Link, не самодостаточный компонент —
// нечего инкапсулировать (ни сети, ни своего состояния), в отличие от
// RouteStepBar/VideoVoteBar рядом. Своя css рядом (route-link.css), app.css
// (video-topbar/tb-btn) не трогаем.
import '../player/components/route-link.css'
import { WorkspacePanel } from '../player/workspace/WorkspacePanel'
import { ShadowCard } from '../player/workspace/ShadowCardLifted'
import { ShadowSettingsRow } from '../player/workspace/ShadowSettingsRow'
import type { ShadowV1Api } from '../player/hooks/useShadowV1'
// Срез A (п.2): bind-проводка карточки строится композицией useAnnotations
// CRUD + этих двух чистых хелперов (десктоп-канон index.tsx:4467-4499).
import { cuesIntersectingRange } from '../player/workspace/bind-range'
import { dropTimeFromFraction } from '../player/workspace/drop-time'
// Срез B (§2/§3): каналы b/c доставки live-настроек в армленное упражнение —
// чистый хелпер (эфемерный in-place + persisted fresh-spread), мутационно тестируем.
import { persistArmedSettings, type ArmedSettingsPatch } from '../player/workspace/shadow-settings-delivery'
import { effectiveShadowSettings } from '../player/workspace/shadow-settings'
import type { ShadowExerciseAnnotation, ShadowMode } from '../player/workspace/panel-types'
import type { SubtitleMode } from '../player/components/subtitle-drag'
import { useSubtitles } from '../player/hooks/useSubtitles'
import { useWorkspace } from '../player/hooks/useWorkspace'
import { usePlayerState } from '../player/hooks/usePlayerState'
import { track, subLineHash, onTerminalFlush } from '../site/telemetry'
import { createRewindTracker, round2, watchProgressPayload, createAbLoopTracker, buildAbLoopPayload, type AbLoopEnded } from '../player/player-telemetry'
import { translateWindow, type TranslateResult } from '../player/translate-api'
import { selectionIndices, windowForIndices, matchTranslatedCues, isPluralLabel, menuTargetIndices } from '../player/translate-window'
import { translateReducer, initialTranslateState, isTranslateDisabled } from '../player/translate-state'
import { capsuleVisible, shouldReveal, buildLineRevealPayload, type RevealResult, type RevealSurface } from '../player/translate-capsule'
import { TranslateMenu, type TranslateMenuState } from '../player/components/TranslateMenu'
import { loadRoute } from '../site/route-state'
// Срез E [ID:P-E]: автостарт по playhead для размещённых (persisted) упражнений.
import { useShadowAutoStart } from '../player/hooks/useShadowAutoStart'
// S3-7: useShadowV1 (push-to-record vertical slice) is REMOVED from PlayerPage —
// owner decision CONCERN #1 (handoff-2026-07-07): the shadowing card is
// runtime-driven, V1/push-to-record is retired ("окончательно мёртв"). The
// useShadowV1 hook file itself is left in place (still unit-tested standalone
// + imported by DebugShadowCard); it is simply no longer wired into the live
// player. Deleting the hook + the now-dormant V1 ShadowCard component is a
// cleanup follow-up gated on S3-7c/S3-7d (which own the customText/bind tests
// still bound to that component).
import { useShadowRuntime, type ShadowRuntimeWorkspaceActuators } from '../player/hooks/useShadowRuntime'
import { useShadowState } from '../player/hooks/useShadowState'
import type { CoordinatorEvaluate } from '../player/hooks/useShadowLoopCoordinator'
import type { EvaluationDecision } from '../player/components/AwaitingEvaluationOverlay'
import { selectAnswerSource, isRealtimeAnswerEnabled } from '../player/workspace/realtime-answer-source'
// Session mic-consent (owner decision 2026-07-10): autostart-arm must not
// silently open the mic — first autostart-arm/session shows a one-shot prompt.
import { readStoredMicConsent, writeStoredMicConsent, type MicConsent } from '../player/workspace/shadow-mic-consent'
import type { AnswerOutcomeEvent } from '../player/workspace/answer-source'
// Срез C (п.1): переиспользуем V1's useShadowAttempts (localStorage
// flib:shadow:<videoId>, precedent useShadowV1.ts:98/:362) — the runtime
// card's history feed, not the retired V1 record/transcribe flow.
import { useShadowAttempts } from '../player/hooks/useShadowAttempts'
// Срез C (п.2-3): чистый аккумулятор (дедуп + пустой-текст-канон + поля) —
// вынесен для мутационной тестируемости, см. его собственную доку.
import { accumulateShadowAttempt } from '../player/workspace/shadow-attempts-accumulate'
// S3-10 (phase ii, LAST build task): wires the REAL microphone into
// shadowAnswerSource.pushAudio, gated by runtime.armedSegmentId() (sync,
// carry S3-2/S3-6b) — see useShadowMicStream.ts top doc for the full
// mic-gate/lifecycle rationale. No-op in Fake mode (prod default).
import { useShadowMicStream } from '../player/hooks/useShadowMicStream'
import { matchWordsDetailed } from '../player/workspace/word-matcher'
import type { WordMark } from '../player/workspace/word-matcher'
// Срез A (M-2): порядок фаз карточки вынесен в чистый резолвер (мутационно-тестируем).
import { computeShadowPhase, computeShadowTransmitEnabled } from '../player/workspace/shadow-phase'
// Срез D: фильтр живого партиала по армленному exerciseId (мутационно-тестируем).
import { acceptArmedPartial } from '../player/workspace/shadow-partial'
// Срез C+D фикс-волна [ID:P-CD-fix]: резолвер cue_index на момент арма
// (H2-кламп при activeIndex=-1 + M2-детектор смены id1→id2), мутационно-тестируем.
import { resolveArmCaptureIndex, resolveAttemptBucket } from '../player/workspace/shadow-arm-cue-index'
import { usePlayerTheme } from '../player/theme/usePlayerTheme'
import { useHotkeys } from '../player/hooks/useHotkeys'
import { useClearSelectionOutsidePlates } from '../player/hooks/useClearSelectionOutsidePlates'
import { useMuteRegions, useMuteDriver } from '../player/hooks/useMuteRegions'
import { mutedTracksAt } from '../player/workspace/mute-regions'
// [ID:P-mobile]: мобильная раскладка плеера — видео на весь экран, тонкий
// автоскрывающийся control-bar, workspace как bottom-sheet, псевдо-фуллскрин
// (см. FullscreenContainer.tsx doc). Единственный JS-детектор мобилы во всём
// плеере — matchMedia('(pointer: coarse)'), НЕ UA-сниффинг (владелец: только
// адаптив, без отдельного мобильного бандла/сабдомена).
import { prefersCoarsePointer, useCoarsePointer } from '../player/hooks/useCoarsePointer'
import { useAutoHideControls } from '../player/hooks/useAutoHideControls'

// W3: testid suffix per SubtitleMode literal for the .video-topbar segments
// (drawer uses a different testid scheme, `sd-mode-${value}` — kept separate
// on purpose so the two call sites don't collide in the DOM).
const TOPBAR_MODE_TESTID: Record<SubtitleMode, string> = { l2: 'sub-mode-en', l2l1: 'sub-mode-enru', hidden: 'sub-mode-off' }
const SUB_MODE_STORAGE_KEY = 'flib:subMode'
const DEFAULT_SUB_MODE: SubtitleMode = 'l2l1'
// watch_progress: периодический тик удержания. ~15с — редко (не heartbeat <10с,
// который по ТЗ шум), но достаточно, чтобы при внезапном mobile task-kill без
// pagehide потерять максимум ~интервал прогресса.
const WATCH_PROGRESS_INTERVAL_MS = 15000

// Срез A (п.2): формат таймкода рядом с сегмент-контролом ПРИВЯЗКА
// (десктоп-канон index.tsx:4494-4498 — formatTime(seconds) = "M:SS").
function formatTC(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec))
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

function loadSubMode(): SubtitleMode {
  try {
    const raw = localStorage.getItem(SUB_MODE_STORAGE_KEY)
    if (raw === 'l2' || raw === 'l2l1' || raw === 'hidden') return raw
  } catch { /* storage unavailable — fall back to default */ }
  return DEFAULT_SUB_MODE
}

// Стабильная пустая ссылка для гейта автостарта (идентичность не меняется между рендерами).
const NO_EXERCISES: ShadowExerciseAnnotation[] = []

export function PlayerPage() {
  // ВСЕ хуки — ВЫШЕ раннего return (правило хуков). Не переносить ниже.
  const [params] = useSearchParams()
  const videoId = params.get('v') ?? ''
  // Э5: присутствие route_step ⇒ мы пришли из /route (RoutePage.openStep/
  // handleStartFirst) — RouteStepBar сама решает, показываться ли (null-guards
  // внутри неё), здесь только читаем параметр, ничего больше не трогаем.
  const routeStepId = params.get('route_step')
  // route_goal для телеметрии — человекочитаемая цель маршрута (та же, что уходит
  // в /api/route/next). Стабильна на сессию плеера: между шагами одного маршрута
  // не меняется, а смена маршрута — это новый вход на страницу.
  const routeGoal = useMemo(() => loadRoute()?.goalLabel, [])
  const [adapter, setAdapter] = useState<PlayerAdapter | null>(null)
  // Старт из ссылки (?t=): один раз на открытие ролика. Храним только «съедено для videoId»
  // (state: от него зависит и гейт автостарта шэдоинга); сам t всегда берётся из ТЕКУЩИХ params —
  // смена query на том же ролике (rp=…, другой t) старого t не оживляет. «Съедается» первым
  // 'playing' или нашим seek до него (эффект ниже). Ремаунт (retry/смена транспорта) до первого
  // play t сохраняет. Смена videoId сама сбрасывает: съедено было для другого ролика.
  const [linkConsumedFor, setLinkConsumedFor] = useState<string | null>(null)
  const cueStart = linkConsumedFor === videoId ? undefined : parseLinkStart(params) ?? undefined
  // P-unplayable: retry = самый дешёвый способ пересоздать YT.Player без
  // трогания PlayerRoot-логики — сменить его React key. Инкремент здесь →
  // React полностью размонтирует/примонтирует PlayerRoot → свежий
  // createIFrameAdapter → onAdapter даёт НОВЫЙ adapter → эффект ниже (по
  // [adapter]) сам обнуляет unplayablePayload устаревшего инстанса.
  const [remountNonce, setRemountNonce] = useState(0)
  // transport [ID:P-hybrid] — ДЕШЁВЫЙ ВРЕМЕННЫЙ гибрид «YouTube-embed по
  // умолчанию + свой видео-стрим fallback при бот-стене» (владелец задачи
  // P-hybrid), нужен ТОЛЬКО чтобы тестеры с телефонами (iOS — embed там
  // структурно ловит бот-стену) прошли A/B-тест маршрута. После A/B гибрид
  // ВЫКЛЮЧАТ фиче-флагом на бэке (VIDEO_FALLBACK_ENABLED=0 → /api/video/{id}
  // всегда 404 → UnplayableOverlay никогда не покажет кнопку fallback,
  // NativeVideoAdapter никогда не выбирается) — эта строка кода останется
  // мёртвой, но безвредной, трогать её отдельно не придётся.
  // Инициализация — ОДИН раз при монтаже (см. resolveInitialTransport): (1)
  // ?transport=native в URL (ручной тест, владелец п.3), иначе (2)
  // персистентный выбор ЭТОЙ сессии (sessionStorage, см. switchToNative
  // ниже), иначе (3) дефолт 'iframe' (Track A всегда дефолт).
  const [transport, setTransport] = useState<'iframe' | 'native'>(
    () => resolveInitialTransport(params.get('transport')),
  )
  // switchToNative — единственный писатель transport→'native' (кнопка
  // UnplayableOverlay «Смотреть через flib-плеер (бета)»). remountNonce++ —
  // тот же паттерн, что onRetry (см. doc ниже): PlayerRoot полностью
  // пересоздаёт adapter (createNativeVideoAdapter вместо createIFrameAdapter,
  // см. PlayerRoot.tsx). sessionStorage-запись ДО setState — следующий рендер
  // этого же компонента (или переход на следующий шаг маршрута) уже видит
  // персистентный выбор, даже если что-то прервёт сам React-коммит.
  const switchToNative = useCallback(() => {
    writeStoredTransport()
    setTransport('native')
    setRemountNonce(n => n + 1)
  }, [])
  // switchToIframe (аудит MED-3/5b [ID:P-hybrid-audit]) — обратный путь:
  // кнопка «Вернуться на YouTube-плеер» в native-error ветке оверлея.
  // Симметрично switchToNative: СНАЧАЛА чистим sessionStorage (иначе
  // следующий шаг маршрута снова открылся бы native), затем remount на iframe.
  const switchToIframe = useCallback(() => {
    clearStoredTransport()
    setTransport('iframe')
    setRemountNonce(n => n + 1)
  }, [])
  const [unplayablePayload, setUnplayablePayload] = useState<UnplayablePayload | null>(null)
  // «latest ref» для контекста телеметрии — читается из эффектов с deps=[adapter]
  // и из терминального хука, чтобы не ловить устаревшие videoId/routeGoal (тот же
  // приём, что latest.current в useHotkeys).
  // linkPending — старт из ссылки (t) ещё не съеден: ролик на этой странице не играл и не перематывался.
  const telemetryCtxRef = useRef({ videoId, routeGoal, linkPending: cueStart !== undefined })
  telemetryCtxRef.current = { videoId, routeGoal, linkPending: cueStart !== undefined }
  // video_open (телеметрия): фиксируем ОДИН раз на первую фактическую игру
  // ролика; ttff_ms = от открытия (смена videoId) до первого 'playing'.
  const videoOpenRef = useRef<{ openTs: number; fired: boolean }>({ openTs: Date.now(), fired: false })
  useEffect(() => { videoOpenRef.current = { openTs: Date.now(), fired: false } }, [videoId])
  useEffect(() => {
    if (!adapter) return
    // ролик берём из латест-рефа, а не из deps: смена videoId не должна пере-оборачивать
    // (уже уничтоженный) старый адаптер — его seek не имеет права «съесть» t нового ролика.
    const consume = () => setLinkConsumedFor(telemetryCtxRef.current.videoId)
    const origSeek = adapter.seek
    adapter.seek = (t: number) => { consume(); origSeek.call(adapter, t) }
    const off = adapter.on('state', (st) => { if (st === 'playing') consume() })
    return () => { off(); adapter.seek = origSeek }
  }, [adapter])
  useEffect(() => {
    setUnplayablePayload(null) // новый adapter (смена видео ИЛИ retry) — сброс устаревшего состояния
    if (!adapter) return
    const offUnplayable = adapter.on('unplayable', (p) => setUnplayablePayload(p as UnplayablePayload))
    // Прод-регрессия 2026-07-14: если видео ВСЁ-ТАКИ заиграло (медленный
    // мобильный старт > порога эвристики), ложный оверлей обязан исчезнуть
    // сам — раньше он висел поверх играющего видео до смены ролика, и
    // пользователи читали его как «YouTube требует регистрацию».
    const offState = adapter.on('state', (st) => {
      if (st === 'playing') {
        setUnplayablePayload(null)
        // Первый реальный play → video_open с ttff (латест-реф: свежие videoId/goal).
        const vo = videoOpenRef.current
        if (!vo.fired) {
          vo.fired = true
          const { videoId: vid, routeGoal: goal } = telemetryCtxRef.current
          track('video_open', { video_id: vid, route_goal: goal, ttff_ms: Date.now() - vo.openTs })
        }
      }
    })
    return () => { offUnplayable(); offState() }
  }, [adapter])
  // watch_progress: периодический тик удержания + ФИНАЛЬНОЕ событие на уходе
  // (точка броска, через onTerminalFlush → тот же pagehide-бикон). Читаем adapter
  // напрямую (живые currentTime/duration), контекст — из латест-рефа.
  useEffect(() => {
    if (!adapter) return
    let lastFinalCt: number | null = null
    const emit = (final: boolean) => {
      const dur = adapter.duration()
      if (dur <= 0) return
      // Ссылка с t, ролик на странице так и не играл: часы стоят на t, но это не просмотр — как без t (0).
      const ct = telemetryCtxRef.current.linkPending ? 0 : adapter.currentTime()
      // Дедуп финального события: и visibilitychange(hidden), и pagehide могут
      // прийти на ОДНОМ уходе → два final на той же позиции. Шлём новый final
      // только если позиция реально сдвинулась (юзер свернул, вернулся,
      // досмотрел и ушёл снова) — иначе один уход = один final (точка броска).
      if (final) {
        if (lastFinalCt !== null && Math.abs(ct - lastFinalCt) < 0.5) return
        lastFinalCt = ct
      }
      const { videoId: vid, routeGoal: goal } = telemetryCtxRef.current
      track('watch_progress', watchProgressPayload({ videoId: vid, routeGoal: goal, currentTime: ct, duration: dur, final }))
    }
    const id = setInterval(() => emit(false), WATCH_PROGRESS_INTERVAL_MS)
    const offTerminal = onTerminalFlush(() => emit(true))
    return () => { clearInterval(id); offTerminal() }
  }, [adapter])
  // Локальный симулятор оверлея («наиграть до деплоя», владелец 2026-07-14):
  // ?sim_unplayable=botwall|150|101|100|2 форсит payload БЕЗ YouTube. Только
  // localhost — на проде параметр мёртв. Телеметрия при симуляции тоже
  // уходит (в локальный DATA_DIR) — видно всю цепочку. `adapter` в deps —
  // эффект выше сбрасывает payload при каждом приходе адаптера, симулятор
  // должен пере-примениться ПОСЛЕ этого сброса (порядок объявления ниже =
  // порядок исполнения эффектов в React).
  useEffect(() => {
    if (window.location.hostname !== 'localhost') return
    const sim = params.get('sim_unplayable')
    if (!sim) return
    setUnplayablePayload(sim === 'botwall'
      ? { reason: 'botwall-suspect' }
      : { reason: 'embed-error', code: Number(sim) || undefined })
  }, [params, adapter])
  // [ID:P-subs-503]: status различает 'no_subtitles' (404, у видео правда нет
  // субтитров — постоянно) от 'unavailable' (503, egress-пул на cooldown —
  // временно, хук сам поллит короткие retry_after внутри сессии, см.
  // useSubtitles.ts). retrying — идёт ли ещё поллинг (для текста индикатора
  // ниже). Видео не блокируется ни тем, ни другим статусом.
  const { cues, activeIndex, status: subsStatus, retrying: subsRetrying, source: subsSource } = useSubtitles(videoId, adapter)
  // ── Маршрут кабинета: режим (rp / rc / rx) и факты гейта субтитров (§4.7) ─────────
  // rx — дополнительное видео (extra-video §9): своё открытие `extra` — первый проход без прогресса, без
  // оценки; «прослушан» ведёт собственная отметка (маршрут|ролик). Собственный `rp` сильнее `rx`.
  const rx = params.get('rx')
  const routeMode = useRouteMode(videoId, params.get('rp'), params.get('rc'), undefined, rx)
  // Оценки нет у rx, пока режим не стал дневным `confirmed` (rp сильнее rx).
  const hideVoteForExtra = !!rx && routeMode.kind !== 'confirmed'
  const gatePuzzleId = routeMode.kind === 'pending' || routeMode.kind === 'confirmed' || routeMode.kind === 'extra' ? routeMode.puzzleId : ''
  const gateExtra = routeMode.kind === 'extra' || (routeMode.kind === 'pending' && !!routeMode.extra)
  const clipListened = useClipListened(gatePuzzleId)
  // Отметка дополнительного видео — на пару (маршрут, ролик); пока pending(extra), маршрут неизвестен — гейт включён.
  const extraRouteId = routeMode.kind === 'extra' ? routeMode.state.route_id ?? '' : ''
  const extraListened = useExtraListened(extraRouteId, gatePuzzleId)
  // ackTick — согласие «Всё равно показать» живёт в памяти модуля: перерисовка.
  const [ackTick, setAckTick] = useState(0)
  const gateFacts: SubsGateFacts = useMemo(() => ({
    routeMode: routeMode.kind === 'pending' ? 'pending' : routeMode.kind === 'confirmed' || routeMode.kind === 'extra' ? 'confirmed' : 'off',
    // extra: `played` всегда false (строка `played` от любого отчёта, хоть секундного, открыла бы субтитры
    // на втором заходе до конца первого прохода); снимает только своя отметка `flib:route-extra-listened`.
    played: routeMode.kind === 'confirmed' ? !!routeMode.row?.played : false,
    listened: gateExtra ? extraListened : clipListened,
    puzzleId: gatePuzzleId,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [routeMode, clipListened, extraListened, gateExtra, gatePuzzleId, ackTick])
  const gateRuHidden = ruHidden(gateFacts)
  const gateRuHiddenRef = useRef(gateRuHidden); gateRuHiddenRef.current = gateRuHidden
  const [subsWarning, setSubsWarning] = useState<SubtitleMode | null>(null)
  // T2-review fix: timelineCollapsed must exist BEFORE the useWorkspace call so it
  // can be passed as the enforcementSuspended gate (desktop-канон useWorkspace.ts:384:
  // a hidden panel suspends loop-boundary enforcement instead of stopping the loop).
  // [ID:P-mobile]: на мобиле тяжёлый workspace свёрнут ПО УМОЛЧАНИЮ (владелец:
  // "видео на весь экран" — панель отнимает высоту в потоке, пока не свёрнута;
  // мобильный CSS дополнительно выносит её в оверлей-bottom-sheet, см. app.css
  // и cb-ws-btn ниже, но дефолтное состояние экономит первый рендер от лишнего
  // мигания "открыто→сразу закрывается"). Ленивый initializer — читает
  // matchMedia ОДИН раз на mount, десктоп (matchMedia отсутствует/fine) видит
  // byte-identical false, как было до этой задачи.
  const [timelineCollapsed, setTimelineCollapsed] = useState(prefersCoarsePointer)
  // S3-2 (hook-order): usePlayerState HOISTED above useWorkspace — useShadowRuntime
  // needs a reactive `currentTime` (its G5 grading-boundary sentinel keys off it),
  // and usePlayerState depends only on `adapter`, not on `ws`. Nothing between
  // here and useWorkspace reads `ws`, so the hoist is safe (stable hook order).
  const playerState = usePlayerState(adapter)
  // Прогресс ролика маршрута (план B8d): GET до первого PUT, восстановление
  // счёта, PUT не чаще раза в 20 с. Счётчик — у useRouteEvents (через ref).
  const routeCounterRef = useRef<() => Счётчик | null>(() => null)
  const routeProgress = useRouteProgress({
    routeMode, cues, counter: () => routeCounterRef.current(),
    currentTime: playerState.currentTime, paused: playerState.paused,
  })
  // События плеера → очередь маршрута (спека кабинета §4.8, план B8c). Вне
  // маршрутного режима — пустые обработчики, ничего не шлётся.
  // Плеер открыт со страницы маршрута (B9): rp, rc или back=route — и только при
  // метке маршрута; без неё плеер как до этапа 2 (флаг выключен — no-op).
  const fromRoute = useMemo(() => cabinetRouteMarked() && (!!params.get('rp') || !!params.get('rc') || !!params.get('rx') || params.get('back') === 'route'), [params])
  const navigate = useNavigate()
  const routeHref = useRouteHref()
  const routeEvents = useRouteEvents({
    videoId, routeMode, cues, subsStatus, subsSource: subsSource ?? null,
    currentTime: playerState.currentTime, duration: playerState.duration, rate: playerState.rate,
    seeking: () => adapter?.isOurSeekInFlight() ?? false,
    // extra: сессия сама строит отчёт как первое открытие и не ждёт прогресс (useRouteEvents, Session.extra).
    progress: routeProgress.info, progressSettled: routeMode.kind === 'confirmed' ? routeProgress.settled : false,
    restoreHeard: routeProgress.restoreHeard,
  })
  routeCounterRef.current = routeEvents.counter
  const routeVote = usePlayerRouteVote(routeMode, routeEvents, url => navigate(url))
  // fsOn — полноэкранный режим (родной или псевдо iOS); landscapeTouch — телефон
  // боком. В обоих случаях оценка маршрута — поверх видео (ревью v2a H-3, M-1).
  const [fsOn, setFsOn] = useState(false)
  const landscapeTouch = useMediaQuery('(pointer: coarse) and (orientation: landscape)')
  // routeClip — выданный ролик маршрута, открытый в плеере: название и метки под видео.
  const routeClip = routeMode.kind === 'confirmed' || routeMode.kind === 'rc' || routeMode.kind === 'extra' ? routeMode.row : null
  // voteInline — оценка под видео (плеер v2): режим маршрута, не полноэкранный режим и
  // не телефон боком (там блок отнимал треть высоты видео).
  const voteInline = fromRoute && !fsOn && !landscapeTouch
  const [videoEnded, clearEnded] = useVideoEnded(adapter)
  // Конец ролика (§4.7): событие 'ended' адаптера ИЛИ пауза в окне 0,75 с у
  // конца (порт `конецРолика`). «Смотреть снова» прячет карточку, пока время не
  // уйдёт из окна конца.
  const [replayed, setReplayed] = useState(false)
  const inEndWindow = конецРолика(playerState.currentTime, playerState.duration)
  useEffect(() => { if (replayed && !inEndWindow) setReplayed(false) }, [replayed, inEndWindow])
  const atEnd = !replayed && (videoEnded || (playerState.paused && inEndWindow))
  const [nextBusy, setNextBusy] = useState(false)
  // Вариант карточки конца ролика (§4.12 элемент 11): по состоянию гейта rp.
  const endVariant: EndCardVariant | null = !fromRoute || routeMode.kind === 'pending'
    ? null
    : routeMode.kind === 'confirmed' ? (routeMode.state.next_clip ? 'next' : 'done') : 'back'
  // Карточка конца ролика закрывает предупреждение первого прохода (§4.7 п.2):
  // оно стояло поверх карточки (z 60 против 30) и заслоняло её кнопки (живая
  // проверка на проде 2026-11-19). Закрытие — как «Хорошо»: субтитры остаются
  // скрытыми, согласия нет; «Смотреть снова» предупреждение не возвращает.
  // subsWarning в зависимостях (ревью L-1): нажатие на режим, пока карточка на
  // экране, иначе оставалось в состоянии и всплывало после выхода из конца.
  const endCardShown = atEnd && !!endVariant
  useEffect(() => { if (endCardShown && subsWarning) setSubsWarning(null) }, [endCardShown, subsWarning])
  const onEndNext = useCallback(async () => {
    if (routeMode.kind !== 'confirmed' || nextBusy) return
    setNextBusy(true)
    // «Тест после ролика» (если он есть и ролик досмотрен ≥ 60 %) — ДО выгрузки и
    // запроса следующего: ответ ставится в очередь и уходит вместе с ней. Пауза и
    // выход из полного экрана — перед показом. Закрыли без ответа (ушли со
    // страницы) — дальше не идём, ничего не отправлено.
    const beforeShow = () => {
      adapter?.pause()
      if (fsRef.current?.isFullscreen) fsRef.current.toggleFullscreen()
    }
    // Непрослушанный ролик: сначала предупреждение. «Вернуться» — остаёмся, ничего
    // не шлём; «Всё равно перейти» — без теста после ролика, решение едет в ?skip_hc=1.
    const dec = await confirmNextClip(routeMode.puzzleId, { beforeShow })
    if (dec === 'stay') { setNextBusy(false); return }
    if (dec === 'listened') {
      const hc = await runHeardCheck(routeMode.state, { beforeShow })
      if (hc === 'abandoned') { setNextBusy(false); return }
    }
    // Выгрузка очереди (потолок как у обмена, 5 с), затем страница маршрута по
    // ?next= — обмен запускает она, через сторож §4.7.
    try { await getRouteOutbox().flush({ timeoutMs: 5000 }) } catch { /* обмен идёт и без выгрузки */ }
    navigate(`/app/route?next=${encodeURIComponent(routeMode.puzzleId)}${dec === 'skip_check' ? `&${SKIP_HC_PARAM}=1` : ''}`)
  }, [routeMode, nextBusy, navigate, adapter])
  // «Продолжить с M:SS» — предложение позиции из прогресса (§4.8), до перемотки.
  const [resumeDismissed, setResumeDismissed] = useState<string | null>(null)
  const resumeSec = routeMode.kind === 'confirmed' && routeProgress.resumeMs !== null && resumeDismissed !== routeMode.puzzleId
    && playerState.currentTime < routeProgress.resumeMs / 1000 - 5 ? routeProgress.resumeMs / 1000 : null
  // onWordsRevealed — снятие размытия на первом проходе → subtitles_shown.
  const onWordsRevealed = routeEvents.onWordsRevealed
  // S3-1: canonical ShadowState owner — supplies getShadowState/setShadowState to
  // the coordinator. S3-7: `shadowState` (reactive) now ALSO gates the card's
  // visibility — the card shows by runtime-active (`shadowState.active`, flipped
  // by S3-6b activate-on-arm), NOT by the retired V1 `shadow.active`.
  const { shadowState, getShadowState, setShadowState } = useShadowState()
  // S3-2 forward-ref idiom (useShadowRuntime.ts top doc): the runtime is built
  // BEFORE useWorkspace (it supplies onLoopBoundary/shouldPauseAtBoundary/
  // onLoopRestart to it), but the coordinator needs ws's actuators as ITS OWN
  // inputs — a circular dependency. The ref is populated in a useLayoutEffect
  // right AFTER useWorkspace below (NEVER a passive useEffect — carry T2/T4
  // ref-fill race fix: layout effects flush before any passive effect of the
  // same commit, so a future passive-effect arm can't observe a null ref).
  const wsActuatorsRef = useRef<ShadowRuntimeWorkspaceActuators | null>(null)
  // S3-2 stub evaluate (fake phase); real scorer later — deterministic word-diff
  // of the finalized answer text vs the exercise target. matchPct>=80 → pass,
  // else retry (the coordinator re-gates advance by its own advanceThreshold via
  // reduceLoopOutcome, so `decision` here is cosmetic; `score` is the real gate).
  const shadowStubEvaluate = useCallback<CoordinatorEvaluate>((req) => {
    const { matchPct } = matchWordsDetailed(req.answer, req.target)
    const decision: EvaluationDecision = {
      decision: matchPct >= 80 ? 'pass' : 'retry',
      score: matchPct,
      source: 'shadow-stub-fake',
    }
    return Promise.resolve(decision)
  }, [])
  // S3-2/S3-9: the coordinator consumes ONE `answerSource` prop; which
  // implementation fills it is a build-time dev-switch (selectAnswerSource),
  // NOT a coordinator concern. DEFAULT = FakeAnswerSource — deterministic
  // {status:'final'} so the whole hands-free machinery (coordinator →
  // answer-seam → verdict → hold/advance matrix) runs WITHOUT mic/network/
  // gateway, autonomously testable. VITE_SHADOW_REALTIME=1 swaps in the real Ф2
  // RealtimeAnswerSource (S3-9) for the owner's mic E2E (S3-10/S3-11) — it lands
  // on this SAME prop, the coordinator unchanged. Stable ref (never re-created).
  // Срез D: ref-паттерн для onPartial — источник создаётся ОДИН раз (стабильная
  // ссылка ниже), но живой колбэк должен читать СВЕЖИЙ armedSegmentId/setPartialText.
  // Мемо-опция замыкает только стабильный ref; актуальный обработчик переустанав-
  // ливается каждый рендер (ниже, после runtimeRef). Fake-режим onPartial не зовёт.
  const partialCbRef = useRef<(exerciseId: string, text: string) => void>(() => {})
  // ТЗ №2 [ID:P-hotfix-quota-ux]: баннер недоступности источника (quota/недоступность).
  // Взводится onUnavailable ниже (переход gate→dead в RealtimeAnswerSource); сброс —
  // на арм НОВОГО упражнения (свежий gate = свежая попытка) в prevArmedIdRef-эффекте.
  const [unavailableNotice, setUnavailableNotice] =
    useState<{ reason: 'quota_exhausted' | 'unavailable'; resetsAt?: string } | null>(null)
  const shadowAnswerSource = useMemo(() => selectAnswerSource({
    onPartial: (exerciseId, text) => partialCbRef.current(exerciseId, text),
    // ТЗ №2 [ID:P-hotfix-quota-ux]: gate→dead (quota/недоступность) → баннер в карте.
    // setUnavailableNotice — стабильный setState (React), безопасно замкнуть в мемо [].
    onUnavailable: (info) => setUnavailableNotice(info),
  }), [])
  // S3-10: SAME dev-switch selectAnswerSource() itself reads (no override
  // here — the mic hook must agree with which concrete instance
  // shadowAnswerSource actually is). Computed once; Vite statically
  // replaces import.meta.env at build so this is zero runtime cost in prod.
  const shadowRealtimeEnabled = useMemo(() => isRealtimeAnswerEnabled(), [])
  // S3-6b: phase (i) recorder = NO-OP. The runtime's own recorder slot
  // (onLoopRestart→start(), S3-2 T2a rearm-half) used to hold a REAL
  // `ShadowRecorder` (getUserMedia) here, gated behind the S3-2-fix
  // active-check below. Now that S3-6b makes `active` actually flip true on a
  // real S-arm (activate-on-arm, below), that gate would otherwise start
  // opening the real mic on every armed loop restart — but phase (i)'s whole
  // point (per the brief) is a fully mic-less, hands-free-armable demo; real
  // capture/streaming is phase (ii) (S3-10). So the recorder itself is
  // replaced with a no-op — `getUserMedia` is never reached from this slot,
  // regardless of `active`. The S3-2-fix gate is kept in place (harmless,
  // moot) rather than removed, to minimize churn and keep the "is shadowing
  // on" contract visible at this call site for whoever wires the real
  // recorder in phase (ii).
  const shadowRecorderAdapter = useMemo<{ start(): void }>(() => ({
    start() {
      if (!getShadowState().active) return // shadowing OFF — no-op anyway (belt-and-suspenders)
      // phase (i): no-op — real mic/streaming = phase (ii) S3-10.
    },
  }), [getShadowState])
  // S3-2-fix MED: memoized so identity is stable across renders (matches
  // evaluate/answerSource/recorder above, all useCallback/useMemo). Before
  // this fix these were inline arrows recreated on every PlayerPage render,
  // which made useShadowRuntime's internal `observedSeek` (built from `seek`)
  // recreate every render too — harmless today (runtime is dormant) but a
  // latent perf/identity footgun once the arm path (S3-6) starts driving this
  // on every video-clock tick.
  const getCurrentTime = useCallback(() => adapter?.currentTime() ?? 0, [adapter])
  const pauseVideo = useCallback(() => adapter?.pause(), [adapter])
  const seek = useCallback((t: number) => adapter?.seek(t), [adapter])
  // S3-2: mount the coordinator-driven runtime ALONGSIDE useShadowV1 (V1 keeps
  // owning record/transcribe/diff; runtime owns loops/arm/hold on FakeAnswerSource).
  // Dormant until a future task wires an arm trigger (S key = S3-6, autostart
  // later) — S3-2 is plumbing + wiring into useWorkspace only.
  const runtime = useShadowRuntime({
    videoId,
    liveCues: cues,
    currentTime: playerState.currentTime,
    getCurrentTime,
    pauseVideo,
    seek,
    getShadowState,
    setShadowState,
    wsActuatorsRef,
    answerSource: shadowAnswerSource,
    answerBudgetMs: 3000,
    evaluate: shadowStubEvaluate,
    recorder: shadowRecorderAdapter,
  })
  // Срез A (п.4): композиционный флаг «Анализ» (transcribing). `evalOverlayVisible`
  // эмитится координатором ТОЛЬКО после flush-резолва finalizeLoop (до 3с спустя
  // границы), поэтому окно «граница достигнута → ждём финал ASR» осталось бы
  // «Говорите». Обёртка onLoopBoundary на АРМЛЕННОЙ грейдинговой границе ставит
  // analyzing=true СИНХРОННО (гейт по isEvalInFlight — аудит M2); сброс — на
  // ПРИХОДЕ verdictOutcome (non-null, аудит H1) или разарме/deactivate (эффекты
  // ниже). Стабильная идентичность (useCallback []) через runtimeRef —
  // useWorkspace кэширует этот колбэк, лишняя churn перезапускала бы её эффект.
  const [analyzing, setAnalyzing] = useState(false)
  // Срез D: живой partial из RealtimeAnswerSource (пусто в Fake-режиме — onPartial
  // никогда не зовётся). Карта показывает его в dashed-блоке; сбросы — на границе
  // (analyzing-старт, ниже), на вердикте и на разоружении (эффекты ниже).
  const [partialText, setPartialText] = useState('')
  // ТЗ №6 п.1 [ID:P-tz6]: persistent-снапшот последнего ФИНАЛА. runtime.verdictOutcome
  // обнуляется на КАЖДОЙ границе петли (handleLog 'loop-boundary' → setVerdictOutcome(
  // null), useShadowRuntime.ts:528-537), поэтому карта, читавшая B1 прямо из него,
  // мигала/теряла разбор между попытками (окно «граница→новый финал ASR» до 3с).
  // Владелец (видео-прогон 23-39, 1:04–2:55): «пускай висит, никуда не исчезает».
  // Держим последний final; заменяем ТОЛЬКО новым final; чистим на разоружении
  // (эффекты ниже). Композиционно, координатор byte-identical.
  const [persistentVerdict, setPersistentVerdict] =
    useState<{ marks: WordMark[]; matchPct: number; spoken: string } | null>(null)
  const runtimeRef = useRef(runtime)
  runtimeRef.current = runtime
  // rewind-телеметрия: единая seek-обёртка вокруг runtime.seek — эмитит событие
  // ТОЛЬКО на перемотку НАЗАД (createRewindTracker хранит хэш последней
  // перемотанной строки для repeat_on_same_line), сохраняя forward-escape/
  // observedSeek-семантику runtime.seek без изменений. Прокидывается в useHotkeys
  // (ArrowLeft/Ctrl+ArrowLeft) и в сик-бар VideoControlsBar — именно источники из
  // ТЗ; таймлайн/драверный CueList оставлены на голом runtime.seek (навигация по
  // списку — не «перемотка назад по трудной реплике»).
  const rewindTracker = useRef(createRewindTracker())
  const seekTracked = useCallback((toTime: number) => {
    const fromTime = adapter?.currentTime() ?? 0
    // clip_replayed маршрута: перемотка назад ≥ 1,5 с внутри того же ролика.
    routeEvents.onSeek(fromTime, toTime)
    const payload = rewindTracker.current({
      fromTime, toTime,
      videoId, routeGoal,
      lineText: cues[activeIndex]?.text_en,
    })
    if (payload) track('rewind', payload)
    runtime.seek(toTime)
  }, [adapter, videoId, routeGoal, cues, activeIndex, runtime, routeEvents])
  // ab_loop-телеметрия (Option B: логика — в player-telemetry.ts createAbLoopTracker,
  // useWorkspace НЕ трогаем). Контекст эмита — через latest-ref (терминальный хук
  // регистрируется в стабильном эффекте и читал бы устаревшие cues/videoId иначе,
  // Fable MED-1). Хэши резолвит buildAbLoopPayload на эмите из ТЕКУЩИХ cues.
  const abTrackerRef = useRef(createAbLoopTracker())
  const abEmitCtxRef = useRef({ videoId, routeGoal, cues })
  abEmitCtxRef.current = { videoId, routeGoal, cues }
  const emitAbLoop = useCallback((ended: AbLoopEnded) => {
    const { videoId: vid, routeGoal: goal, cues: cs } = abEmitCtxRef.current
    track('ab_loop', buildAbLoopPayload(ended, vid, cs, goal))
  }, [])
  // Обёртка рестарта — СТАБИЛЬНАЯ identity (useCallback([]), runtime через ref):
  // инлайн-функция чурнила бы reachBoundary→rAF-драйвер границы каждый рендер
  // (~4/с при полле currentTime), сбивая тайминг лупа (Fable HIGH-2). runtime
  // ПЕРВЫМ — рекордер-рерарм не должен зависеть от телеметрии (инкремент не бросает).
  const onLoopRestartTracked = useCallback(() => {
    runtimeRef.current.onLoopRestart()
    abTrackerRef.current.noteRestart()
  }, [])
  // Срез D: актуальный обработчик onPartial (переустанавливается каждый рендер).
  // Фильтр по ТЕКУЩЕМУ армленному exerciseId (acceptArmedPartial) — партиал чужой/
  // старой (ещё не закрытой continuous-listen) сессии при быстром re-arm НЕ утекает.
  // armedSegmentId() — синхронная правда координатора (ref-геттер, не React-state).
  partialCbRef.current = (exerciseId, text) => {
    const next = acceptArmedPartial(exerciseId, runtimeRef.current.armedSegmentId(), text)
    if (next != null) setPartialText(next)
  }
  const onLoopBoundaryWrapped = useCallback(() => {
    const wasArmed = runtimeRef.current.armedSegmentId() != null
    runtimeRef.current.onLoopBoundary()
    // Аудит M2: analyzing ставим ТОЛЬКО если граница реально запустила eval —
    // startEval выставляет evalInFlight СИНХРОННО (координатор :466), поэтому
    // после делегирования его видно. Не-грейдинговая армленная граница
    // (advanceEnabled=false) вердикта не даст никогда — безусловный set залипал
    // бы в 'transcribing' навсегда.
    if (wasArmed && runtimeRef.current.isEvalInFlight()) {
      setAnalyzing(true)
      // Срез D: граница достигнута → записи конец → живой партиал текущей попытки
      // отработал. Сброс, чтобы «Анализ» не показывал застывший interim и чтобы
      // партиал петли N не протёк в «Говорите» петли N+1 до первого нового interim.
      setPartialText('')
    }
  }, [])
  // #1: useWorkspace now receives the runtime's 3 loop-callbacks (previously
  // undefined → native A-B restart only). onLoopBoundary archives + (if grading)
  // triggers eval; shouldPauseAtBoundary parks at B for grading; onLoopRestart
  // re-arms the recorder for the next loop iteration.
  // Срез A (п.4): onLoopBoundary отдаётся ЧЕРЕЗ analyzing-обёртку (см. выше) —
  // shouldPauseAtBoundary/onLoopRestart идут напрямую (их фазы не касаются).
  const ws = useWorkspace(
    adapter, cues, videoId, timelineCollapsed,
    onLoopBoundaryWrapped, runtime.shouldPauseAtBoundary, onLoopRestartTracked, cueStart,
  )
  // ab_loop: наблюдаем сессию лупа. active сворачивает looping+suspend(панель
  // свёрнута)+degenerate в один предикат (Fable MED-3). Только refs+track, без
  // setState → без лишних рендеров. Date.now() снаружи (трекер детерминирован).
  useEffect(() => {
    const active = ws.looping && !timelineCollapsed && ws.rangeEnd > ws.rangeStart
    const ended = abTrackerRef.current.noteState({
      active, rangeStart: ws.rangeStart, rangeEnd: ws.rangeEnd, videoId, now: Date.now(),
    })
    if (ended) emitAbLoop(ended)
  }, [ws.looping, ws.rangeStart, ws.rangeEnd, timelineCollapsed, videoId, emitAbLoop])
  // Финальный флаш активной сессии на уходе вкладки (дедуп двойного terminal — в трекере).
  useEffect(() => onTerminalFlush(() => {
    const ended = abTrackerRef.current.noteTerminal({ now: Date.now() })
    if (ended) emitAbLoop(ended)
  }), [emitAbLoop])
  // SPA-навигация ПРОЧЬ с плеера (клик на /route, /каталог) не даёт pagehide —
  // без этого весь класс выходов «ушёл со страницы посреди лупа» терялся бы
  // (Fable финал MED-1). Флашим на размонтировании; модульный флаш-таймер
  // телеметрии живёт дольше PlayerPage и доставит событие. На реальном закрытии
  // вкладки pagehide уже закрыл сессию (open=null) → тут noteTerminal вернёт null,
  // дубля нет. Смена видео идёт БЕЗ ремаунта PlayerPage → этот cleanup не сработает.
  // ⚠️ Только-на-размонтировании держится на emitAbLoop=useCallback([]): если у
  // него появится dep, cleanup станет срабатывать посреди жизни и эмитить ложный
  // 'terminal' на живой сессии (+закрывать её). Держать emitAbLoop без deps.
  useEffect(() => () => {
    const ended = abTrackerRef.current.noteTerminal({ now: Date.now() })
    if (ended) emitAbLoop(ended)
  }, [emitAbLoop])
  // S3-2 forward-ref fill — useLayoutEffect (NOT useEffect): see wsActuatorsRef
  // doc above. No deps → refills every commit with the LATEST ws actuator
  // identities (runtime reads `.current` lazily, so identity churn is inert).
  useLayoutEffect(() => {
    wsActuatorsRef.current = {
      restoreWorkspace: ws.restoreWorkspace,
      resumeFromBoundary: ws.resumeFromBoundary,
      deactivateWorkspace: ws.deactivateWorkspace,
      countdownThenPlay: ws.countdownThenPlay,
      getWorkspaceSnapshot: ws.getWorkspaceSnapshot,
    }
  })
  // S3-7: useShadowV1 was mounted here (record/transcribe/diff + the collapse→
  // deactivate privacy effect that stopped its mic). Both are GONE — the card is
  // runtime-driven now and phase (i) has no mic at all (the runtime recorder
  // slot is a no-op, S3-6b), so there is no unattended-microphone privacy
  // concern to guard on collapse. Collapsing the timeline simply unmounts the
  // card via the `!timelineCollapsed` gate on <ShadowCard> below; the
  // runtime arm itself is left intact (reopening the panel re-shows the card in
  // its current state).
  const { themeRef, variant } = usePlayerTheme()
  const fsRef = useRef<FullscreenHandle>(null)
  // [ID:P-mobile]: `mobile` — единственный переключатель раскладки ниже (тонкий
  // control-bar/video-topbar-оверлей/workspace bottom-sheet). autoHideControls —
  // видимость control-bar+video-topbar по тапу/таймеру/драгу сик-бара; enabled=
  // mobile ⇒ на десктопе (mobile=false) visible всегда true, таймер не взводится
  // (useAutoHideControls.ts doc) — ноль поведенческой разницы для десктопа.
  const mobile = useCoarsePointer()
  const autoHideControls = useAutoHideControls(mobile)
  // W3: mode persists to localStorage['flib:subMode'] (validated on read) so it
  // survives reloads/remounts; setMode is the single writer shared by the
  // .video-topbar segments AND the drawer's own mode buttons (unified state).
  const [mode, setModeState] = useState<SubtitleMode>(loadSubMode)
  // shownMode — режим на экране: на первом проходе ролика маршрута сохранённый
  // режим ЗАСЛОНЯЕТСЯ скрытым (в flib:subMode гейт не пишет ничего, §4.7 п.3).
  const shownMode = subsModeForClip(gateFacts, mode)
  const gateBlur = forcedBlur(gateFacts) && shownMode !== 'hidden'
  const setMode = (m: SubtitleMode) => {
    // subtitle_mode_change (телеметрия) — только на РЕАЛЬНУЮ смену режима
    // (l2/l2l1/hidden). Сюда же по ТЗ сворачивается «показ RU»: отдельного
    // per-line reveal-по-клику в плеере нет, включение l2l1 = RU показан.
    if (m !== mode) {
      track('subtitle_mode_change', { video_id: videoId, route_goal: routeGoal, mode: m, prev_mode: mode, timecode: round2(playerState.currentTime) })
    }
    setModeState(m)
    try { localStorage.setItem(SUB_MODE_STORAGE_KEY, m) } catch { /* quota/denied — just won't persist */ }
  }
  // requestMode — нажатие на режим: на первом проходе маршрута включение сперва
  // показывает предупреждение (§4.7 п.2); иначе — прежний setMode.
  const requestMode = (m: SubtitleMode) => {
    if (subsPillIntent(m, gateFacts) === 'warn') { setSubsWarning(m); return }
    setMode(m)
  }
  const [drawerOpen, setDrawerOpen] = useState(false)
  // railDrawer — плеер v2 (дизайн 2026-11-19 §4): на телефоне левое меню скрыто и
  // выезжает по ☰ из верхней строки.
  const [railDrawer, setRailDrawer] = useState(false)
  const closeRailDrawer = useCallback(() => setRailDrawer(false), [])
  // T1a [ID:P-video-chat]: попап у слова — чисто UI-стейт (какое слово,
  // где на экране показать попап), живёт здесь; сеть/статус/карточки —
  // внутри useVideoChat (см. импорт выше).
  const [wordPopup, setWordPopup] = useState<{ word: string; position: WordPopupPosition } | null>(null)
  const videoChat = useVideoChat()
  // T6 (audit §7 / desktop index.tsx:3512-3524, 'ui-video-boxed'): when boxed,
  // the settings drawer moves the video (insetRight) instead of overlaying it.
  const [videoBoxed, setVideoBoxed] = useState<boolean>(() => {
    try { return localStorage.getItem('flib:shell:videoBoxed') === 'true' } catch { return false }
  })
  const toggleBoxed = () => {
    setVideoBoxed(v => {
      const next = !v
      try { localStorage.setItem('flib:shell:videoBoxed', String(next)) } catch { /* ignore */ }
      return next
    })
  }
  const { msg: toastMsg, show: showToast } = useMiniToast()
  // A7: manualMuted — единственный источник ручного mute-интента (не adapter.muted()).
  const [manualMuted, setManualMuted] = useState(false)
  const muteApi = useMuteRegions(videoId)
  useMuteDriver(adapter, muteApi.muteRegions, manualMuted)
  // Лаг ≤250мс между currentTime и скрытием плашки принят оркестратором для MVP.
  const inMuteRegion = mutedTracksAt(playerState.currentTime, muteApi.muteRegions).aud

  // ─── [ID:P-subtitle-translate] on-demand перевод субтитра ──────────────────
  const [translateState, dispatchTranslate] = useReducer(translateReducer, initialTranslateState)
  const [translatedRu, setTranslatedRu] = useState<Record<number, string>>({})
  // [ID:P-subtitle-translate-capsule] индексы строк, раскрытых КАПСУЛОЙ. Отдельно
  // от translatedRu (тот общий с пилюлей): гейтим RU-плашку по НЕМУ, иначе
  // диапазонные переводы пилюли всплыли бы в l2 нескрываемо (SPEC §2).
  const [revealedByIndex, setRevealedByIndex] = useState<Set<number>>(new Set())
  // sr-only анонс появившегося перевода (a11y — вместо aria-live на постоянной
  // RU-плашке, которая спамила бы каждой сменой строки в l2l1).
  const [revealMsg, setRevealMsg] = useState('')
  const revealRegionRef = useRef<HTMLDivElement | null>(null)
  // announceReveal — SR-анонс + перенос клавфокуса на status-регион. Капсула
  // размонтируется после reveal (RU показан → капсулы нет) → без переноса фокус
  // упал бы на body (спека §3 a11y). Зовём ТОЛЬКО когда RU РЕАЛЬНО раскрыт —
  // честный анонс, не «показан» вслепую на любой ok (финал-ревью MED).
  const announceReveal = useCallback((text: string) => {
    setRevealMsg(text || 'Перевод показан')
    revealRegionRef.current?.focus()
  }, [])
  const translateInFlightRef = useRef(false) // синхронный single-flight (Fable MED-1)
  const [, bumpTranslateNow] = useState(0)    // ре-энейбл по истечении Retry-After (Fable MED-3)
  // Live-refs для гарда устаревшего ответа (Fable H1: reqVideoId и videoId в .then —
  // ОДНА и та же замыкающая привязка, прямое сравнение всегда false; ref даёт
  // ТЕКУЩИЙ videoId к моменту резолва) и для гейта setMode (mode мог смениться
  // за секунды перевода, Fable M1).
  const videoIdRef = useRef(videoId); videoIdRef.current = videoId
  const modeRef = useRef(mode); modeRef.current = mode
  // on-demand переводы привязаны к ИНДЕКСУ cue → сброс на смене видео (cues
  // переиндексируются); заодно закрываем ПКМ-меню (stale cueIndex против новых cues).
  useEffect(() => { setTranslatedRu({}); setRevealedByIndex(new Set()); setTranslateMenu(null) }, [videoId])
  // таймер ре-энейбла: бампим рендер ровно к disabledUntilMs.
  useEffect(() => {
    const remaining = translateState.disabledUntilMs - Date.now()
    if (remaining <= 0) return
    const id = window.setTimeout(() => bumpTranslateNow((n) => n + 1), remaining)
    return () => window.clearTimeout(id)
  }, [translateState.disabledUntilMs])
  // Выборка блоков: A-B-диапазон при АКТИВНОМ лупе (Fable HIGH-1), иначе активная строка.
  const translateSelection = useMemo(
    () => selectionIndices(cues, { looping: ws.looping, rangeStart: ws.rangeStart, rangeEnd: ws.rangeEnd }, activeIndex),
    [cues, ws.looping, ws.rangeStart, ws.rangeEnd, activeIndex],
  )
  // doTranslate(indices, {flipMode}) — переводит окно, покрывающее блоки. Один вход
  // для пилюли (flipMode:true — флипает режим на l2l1, прежнее поведение) И капсулы
  // (flipMode:false — раскрывает строки через revealedByIndex, БЕЗ флипа). Синхронный
  // ref-лок против гонки. Возвращает Promise<результат> | null (null = запрос НЕ
  // стартовал: лок / Retry-дизейбл / пустое окно — капсула по этому различает, эмитить
  // ли телеметрию). Юнион с {status:'corpus'} — синтетический статус L2-guard-ветки.
  const doTranslate = useCallback((indices: number[], opts: { flipMode: boolean }): Promise<TranslateResult | { status: 'corpus' }> | null => {
    if (translateInFlightRef.current) return null
    // Первый проход маршрута: перевод не вызывается вовсе (§4.7 п.5).
    if (gateRuHiddenRef.current) return null
    if (isTranslateDisabled(translateState, videoId, Date.now())) return null
    const win = windowForIndices(cues, indices)
    if (!win) return null
    // L2-guard: все выбранные блоки уже с RU (корпусным ИЛИ уже переведённым
    // on-demand, Fable M2) → не жечь общий бюджет 6/мин. Но если юзер в l2/hidden —
    // RU есть, просто не виден → показать его.
    if (win.includedIdx.length > 0 && win.includedIdx.every((i) => cues[i]?.text_ru || translatedRu[i])) {
      if (opts.flipMode) {
        if (modeRef.current !== 'l2l1') setMode('l2l1')
        showToast('Уже переведено')
      } else {
        // Капсула: локальный reveal БЕЗ флипа/тоста (RU гарантирован условием ветки).
        setRevealedByIndex((s) => { const n = new Set(s); indices.forEach((i) => n.add(i)); return n })
      }
      return Promise.resolve({ status: 'corpus' as const })
    }
    translateInFlightRef.current = true
    dispatchTranslate({ type: 'request' })
    const reqVideoId = videoId
    return translateWindow(videoId, win.fromMs, win.toMs).then((res) => {
      // Fable финал MED-1: СОСТОЯНИЕ (reducer) обновляем ВСЕГДА — busy(429/503) и
      // forbidden site-wide/сессионные, not_in_corpus несёт свой videoId, ok/error
      // просто снимают inFlight. А вот РЕНДЕР для чужого видео (merge/setMode/тосты/
      // reveal) подавляем: ответ на прошлый ролик не должен рисовать RU на текущем.
      const stale = reqVideoId !== videoIdRef.current
      switch (res.status) {
        case 'ok': {
          if (!stale) {
            const matched = matchTranslatedCues(cues, res.cues)
            // Показ/смена режима ТОЛЬКО если реально что-то сматчилось (Fable M1).
            if (Object.keys(matched).length > 0) {
              setTranslatedRu((prev) => ({ ...prev, ...matched }))
              if (opts.flipMode) {
                if (modeRef.current !== 'l2l1') setMode('l2l1') // иначе RU есть, но не виден
              } else {
                // Капсула: раскрыть ТОЛЬКО реально сматчившиеся индексы (shouldReveal —
                // не «matched непуст»: иная сегментация шлюза не должна раскрыть
                // строку без её RU → пустая видимая плашка). Под !stale.
                const revealedNow = indices.filter((i) => shouldReveal(matched, i, cues[i]?.text_ru ?? ''))
                if (revealedNow.length > 0) {
                  setRevealedByIndex((s) => { const n = new Set(s); revealedNow.forEach((i) => n.add(i)); return n })
                  // Честный анонс/фокус ТОЛЬКО при реальном раскрытии (под !stale).
                  announceReveal(matched[revealedNow[0]] ?? cues[revealedNow[0]]?.text_ru ?? '')
                }
              }
            }
            if (win.truncatedCount > 0) {
              showToast(`Переведены первые ${win.includedIdx.length} из ${win.includedIdx.length + win.truncatedCount} блоков`)
            }
          }
          dispatchTranslate({ type: 'ok' })
          break
        }
        case 'empty':
          dispatchTranslate({ type: 'empty' }); if (!stale) showToast('Нет текста для перевода в этом фрагменте'); break
        case 'busy':
          dispatchTranslate({ type: 'busy', retryAfterSec: res.retryAfterSec, nowMs: Date.now() })
          if (!stale) showToast(res.kind === '429'
            ? `Слишком часто — попробуйте через ${res.retryAfterSec} с`
            : `Переводчик занят — попробуйте через ${res.retryAfterSec} с`)
          break
        case 'not_in_corpus':
          dispatchTranslate({ type: 'not_in_corpus', videoId: reqVideoId }); if (!stale) showToast('Перевод недоступен для этого видео'); break
        case 'forbidden':
          dispatchTranslate({ type: 'forbidden' }); console.warn('[translate] forbidden — оператору выдать allow_youtube_translate на tpk BFF'); break
        case 'error':
          dispatchTranslate({ type: 'error' }); console.warn('[translate] error'); break
      }
      return res // капсула читает res.status для телеметрии result
    }).finally(() => { translateInFlightRef.current = false })
  }, [cues, videoId, translateState, translatedRu, setMode, showToast, announceReveal])
  // ПКМ-меню «Перевести блок(и)» (хосты: таймлайн-cue, CueList, плашка на видео).
  const [translateMenu, setTranslateMenu] = useState<TranslateMenuState | null>(null)
  const openTranslateMenu = useCallback((cueIndex: number, x: number, y: number) => {
    if (cueIndex < 0) return
    setTranslateMenu({ cueIndex, x, y })
  }, [])
  const closeTranslateMenu = useCallback(() => setTranslateMenu(null), [])
  // Состояние пилюли/меню (пересчитывается каждый рендер; таймер выше бампит к истечению).
  const translateNowMs = Date.now()
  const translateBusy = isTranslateDisabled(translateState, videoId, translateNowMs) // in-flight/Retry-After/404/403
  const translatePlural = isPluralLabel(translateSelection.length)
  const translateDisabled = windowForIndices(cues, translateSelection) === null || translateBusy || gateRuHidden
  const translateTitle = ((): string | undefined => {
    if (translateState.forbidden) return 'Перевод сейчас недоступен'
    if (translateState.notInCorpus.has(videoId)) return 'Перевод недоступен для этого видео'
    if (translateNowMs < translateState.disabledUntilMs) return `Переводчик занят — подождите ${Math.ceil((translateState.disabledUntilMs - translateNowMs) / 1000)} с`
    return undefined
  })()

  // [ID:P-subtitle-translate-capsule] onTranslateLine — обработчик капсулы одной
  // строки. surface('plate'|'list') знает хост. Всё захватываем СИНХРОННО на клике
  // (cue/mode/routeGoal) — playback может уйти на другую реплику за время запроса.
  const onTranslateLine = useCallback((index: number, surface: RevealSurface) => {
    const cue = cues[index]
    if (!cue || gateRuHiddenRef.current) return
    const modeAtClick = modeRef.current
    // Гард дубля corpus: двойной клик мимо HTTP-лока (corpus-путь HTTP не трогает).
    if (revealedByIndex.has(index)) return
    const emit = (result: RevealResult) => {
      track('subtitle_line_reveal', buildLineRevealPayload({
        videoId, routeGoal, cue: { start: cue.start, text_en: cue.text_en }, mode: modeAtClick, surface, result,
      }))
      // line_translated маршрута: исход corpus или успех (§4.8).
      if (result === 'corpus' || result === 'ok') routeEvents.onLineTranslated(index)
    }
    // Corpus-ветка: RU уже готов (корпусный text_ru ИЛИ пилюльный translatedRu) →
    // локальное раскрытие БЕЗ HTTP, разрешено даже при translateBusy (анти-инстр #10).
    if (cue.text_ru || translatedRu[index]) {
      setRevealedByIndex((s) => new Set(s).add(index))
      announceReveal(cue.text_ru || translatedRu[index] || '')
      emit('corpus')
      return
    }
    // HTTP-путь: doTranslate вернёт null (не стартовал: лок/дизейбл) → НЕ эмитим.
    // Анонс/фокус — внутри doTranslate ТОЛЬКО при реальном раскрытии (честно), не тут.
    const r = doTranslate([index], { flipMode: false })
    if (r) r.then((res) => emit(res.status as RevealResult))
  }, [cues, videoId, routeGoal, revealedByIndex, translatedRu, doTranslate, announceReveal, routeEvents])

  // Видимость/дизейбл капсулы на ВИДЕО-ПЛАШКЕ (активная строка).
  const plateRuVisible = (shownMode === 'l2l1' || (shownMode !== 'hidden' && revealedByIndex.has(activeIndex)))
    && !!(cues[activeIndex]?.text_ru || translatedRu[activeIndex])
  // activeIndex в [0, cues.length) ПЕРЕД windowForIndices: та негардит cues[i].start
  // → OOB (в т.ч. верхняя граница) = TypeError всего рендера. Нет строки — нет капсулы.
  const plateShowCapsule = activeIndex >= 0 && activeIndex < cues.length && capsuleVisible({
    textEn: cues[activeIndex]?.text_en ?? '',
    hasVisibleRu: plateRuVisible,
    windowOk: windowForIndices(cues, [activeIndex]) !== null,
  })
  // busy для плашки — дизейблить ТОЛЬКО HTTP-путь: corpus-строка (RU уже есть)
  // должна кликаться и при busy (анти-инстр #10 / F1).
  const plateTranslateBusy = translateBusy && !(cues[activeIndex]?.text_ru || translatedRu[activeIndex])
  // ───────────────────────────────────────────────────────────────────────────
  // S3-6b: activate-on-arm. The coordinator (useShadowLoopCoordinator.ts
  // :661/665/686) only grades — and therefore only ever produces a verdict/
  // hold/overlay — while `getShadowState().active===true`. S3-6's
  // handleShadowKey→armRange→coordinator.onArm never wrote that flag itself
  // (see the git-blame'd comment this replaces), so a REAL S-arm produced no
  // verdict at all for an actual user; only the test suites flipped `active`
  // externally to exercise the coordinator in isolation. This task makes
  // ShadowState.active reactively track "is anything armed right now"
  // WITHOUT touching useShadowRuntime.ts/useShadowLoopCoordinator.ts (out of
  // scope) — `runtime.armedSegmentId()` is a plain ref-backed getter, not
  // React state, so there is nothing to subscribe to; instead:
  //   (a) the catch-all effect below (no deps array — see its own doc)
  //       re-syncs `active` after EVERY PlayerPage render, which covers
  //       every transition the runtime/useWorkspace drive on their own
  //       (natural playhead-exit teardown, advance/complete, hold/resume) —
  //       all of those already trigger a PlayerPage re-render via the
  //       runtime's own or useWorkspace's state setters, so no
  //       currentTime-polling proxy is needed;
  //   (b) the S key itself is wrapped (onShadowKeyActivateOnArm below)
  //       because a FRESH arm from idle can leave every OTHER piece of
  //       runtime/ws state at its already-equal value (no re-render fires
  //       on its own) — re-checking synchronously right after
  //       handleShadowKey() makes the S-press itself deterministic/
  //       immediate instead of waiting on (a) to catch up on some later
  //       render.
  // Phase (i) has no mic to protect (shadowRecorderAdapter above is a
  // no-op regardless of `active`) — Оверлей/вердикт (T3) по-прежнему гонятся
  // от runtime.holding/verdictOutcome, `active` здесь только отпирает
  // грейдинг координатора.
  useEffect(() => {
    const armed = runtime.armedSegmentId() != null
    if (getShadowState().active !== armed) setShadowState({ active: armed })
  })
  // Срез A (п.4): сброс analyzing. (a) verdictOutcome ПРИШЁЛ (non-null) → финал
  // ASR получен → окно «Анализ» закрыто. Аудит H1: гард `!= null` обязателен —
  // на петлях ≥2 handleLog('loop-boundary') обнуляет ПРЕДЫДУЩИЙ verdictOutcome
  // (non-null→null) в ТОМ ЖЕ коммите, где обёртка ставит analyzing=true;
  // безусловный сброс убивал бы окно в момент открытия (карта показывала бы
  // «Говорите» вместо «Анализ» весь boundary→final гэп). (b) shadowing разоружён
  // (active→false) → флаг не «протекает» в следующую сессию. Оба — setState к
  // тому же значению для дормант-юзера ⇒ React бейлит, ноль лишних ре-рендеров.
  useEffect(() => { if (runtime.verdictOutcome != null) setAnalyzing(false) }, [runtime.verdictOutcome])
  useEffect(() => { if (!shadowState.active) setAnalyzing(false) }, [shadowState.active])
  // Срез D: сброс живого партиала. (a) вердикт пришёл → финал показан (карта
  // рисует lastSpoken) → застывший interim не должен его перекрывать
  // (edge «partial после final — stale»). (b) разоружение → партиал не протекает в
  // следующую сессию (edge «unarm mid-partial»). Оба — setState('') к тому же
  // значению для дормант-юзера ⇒ React бейлит, ноль лишних ре-рендеров.
  useEffect(() => { if (runtime.verdictOutcome != null) setPartialText('') }, [runtime.verdictOutcome])
  useEffect(() => { if (!shadowState.active) setPartialText('') }, [shadowState.active])
  // ТЗ №6 п.1 [ID:P-tz6]: обновление persistent-снапшота B1. Пишем ТОЛЬКО на
  // ФИНАЛЬНЫЙ непустой вердикт (тот же гейт, что аккумулятор ленты и старый
  // shadowCardData: пустой финал «тишина/таймаут» не синтезирует B1). Не-final
  // (no-response/timeout/non-final/error) снапшот НЕ трогает → прошлый разбор
  // «висит». Границы петли обнуляют runtime.verdictOutcome, но снапшот их
  // переживает. Дормант-безопасно: без вердикта setState не зовётся.
  useEffect(() => {
    const oc = runtime.verdictOutcome
    const target = runtime.verdictTargetSnapshot ?? ''
    if (oc && oc.outcome.status === 'final' && target && oc.outcome.text.trim()) {
      const d = matchWordsDetailed(oc.outcome.text, target)
      setPersistentVerdict({ marks: d.marks, matchPct: d.matchPct, spoken: oc.outcome.text })
    }
  }, [runtime.verdictOutcome, runtime.verdictTargetSnapshot])
  // Разоружение → снапшот не «протекает» в следующий арм (как сброс analyzing/
  // partial выше). setState(null) при уже-null → React bail-out (дормант ноль-churn).
  useEffect(() => { if (!shadowState.active) setPersistentVerdict(null) }, [shadowState.active])
  // S3-10: real mic wiring — see useShadowMicStream.ts top doc. Gated on
  // runtime.armedSegmentId() (NOT the `active` state synced just above,
  // which can lag by one render) + shadowRealtimeEnabled + timelineCollapsed
  // (privacy: collapsing the timeline stops the mic even while still armed).
  // FIX (2026-07-07): live mic AnalyserNode → the ShadowCard's Oscillograph
  // waveform ("видно, что нас слушают" — restored per owner). null when mic closed.
  const [micAnalyser, setMicAnalyser] = useState<AnalyserNode | null>(null)
  // ── Session mic-consent (owner decision 2026-07-10) ────────────────────────
  // An AUTOSTART arm must not silently open the mic. The first autostart-arm per
  // session (realtime only) shows a one-shot "Начать практику с микрофоном?"
  // prompt; after "Начать" the rest of the session is hands-free. A MANUAL arm
  // (S / R / pill) is an explicit action → grants consent directly (no prompt).
  //   null      — nobody asked (dormant / fresh)
  //   'pending' — autostart armed w/o consent → prompt shown, mic still shut
  //   'granted' — consent given (manual arm / "Начать" / prior-visit persist)
  //   'declined'— "Не сейчас": no mic + no prompt THIS session (React-only), arm
  //               still runs; a new tab (no sessionStorage) asks again.
  // Seeded from sessionStorage so a prior grant this session is hands-free at once.
  const [micConsent, setMicConsent] = useState<MicConsent>(() => readStoredMicConsent())
  // Ref mirror: autostart's onArm (stable []-dep callback) reads the LIVE consent
  // without re-creating, and a grant is visible synchronously to code that runs
  // right after it in the same tick.
  const micConsentRef = useRef<MicConsent>(micConsent)
  micConsentRef.current = micConsent
  // Explicit consent: persist (session) + flip state + ref (immediate). Called on
  // a manual arm and on the prompt's "Начать".
  const grantMicConsent = useCallback(() => {
    writeStoredMicConsent()
    micConsentRef.current = 'granted'
    setMicConsent('granted')
  }, [])
  useShadowMicStream({
    armedSegmentId: runtime.armedSegmentId,
    answerSource: shadowAnswerSource,
    realtimeEnabled: shadowRealtimeEnabled,
    timelineCollapsed,
    // Mic opens ONLY on granted consent (Fake/realtime-off never opens anyway).
    micConsentGranted: micConsent === 'granted',
    // ТЗ №4 п.3 (+ фикс-волна CRIT-1 [ID:P-tz4-fix]): пауза видео = стоп аудио-
    // стрима (не жжём токены на паузе). НО окно «граница→финал» НЕ рвём: на
    // грейдинговой границе видео паузится ДО eval-start (evalOverlayVisible ещё
    // false), поэтому передачу держит СИНХРОННЫЙ `analyzing` (веб-эквивалент
    // desktop listenHoldForFinal) — иначе reconcile закрыл бы пайплайн +
    // closeSession → resolveAll убил бы pending-waiter ЭТОЙ границы, а мик
    // закрылся бы до дострима хвоста фразы («Нет ответа» в штатном сценарии).
    // `holding` в формулу НЕ входит (HIGH-3: hold-парк = вечный стрим).
    transmitEnabled: computeShadowTransmitEnabled({
      playing: !playerState.paused,
      analyzing,
      evalOverlayVisible: runtime.evalOverlayVisible,
    }),
    onAnalyser: setMicAnalyser,
  })
  // Срез A (п.4): elapsed-таймер записи. Считает вверх посекундно, ПОКА мик открыт
  // (micAnalyser!=null); обнуляется на закрытии мика. Карта рендерит M:SS в
  // rec-strip при recording (formatMmSs(remainingSec)). Дормант-безопасно: мик
  // закрыт ⇒ эффект делает setRecElapsed(0) (React бейлит) и НЕ ставит интервал.
  const [recElapsed, setRecElapsed] = useState(0)
  useEffect(() => {
    if (!micAnalyser) { setRecElapsed(0); return }
    setRecElapsed(0)
    const id = window.setInterval(() => setRecElapsed(e => e + 1), 1000)
    return () => window.clearInterval(id)
  }, [micAnalyser])
  // ── Срез C (п.1-3): история попыток — useShadowAttempts reuse ──────────────
  // Тот же localStorage-контракт flib:shadow:<videoId>, что и V1 (прецедент
  // useShadowV1.ts:98/:362). Аккумулятор ниже пишет ОДНУ запись на каждый
  // ФИНАЛЬНЫЙ verdictOutcome (дедуп по object-identity, п.3).
  const attempts = useShadowAttempts(videoId)
  // cue_index ФИКСИРУЕТСЯ на момент АРМА (смена armedSegmentId), НЕ на момент
  // вердикта (ТЗ Срез C п.2, ⚠️-правка фактчека: seq в AnswerOutcomeEvent не
  // существует, а playhead/activeIndex к моменту финала мог уже уйти за границу
  // армленного отрезка). `armedSegmentId()` — обычный ref-геттер координатора,
  // НЕ React state (не на что подписаться) — тот же catch-all-по-рендеру
  // паттерн, что active-sync эффект выше (:298-301): без deps-массива эффект
  // перечитывает armedSegmentId() ПОСЛЕ каждого рендера.
  // Фикс-волна [ID:P-CD-fix]: логика пересъёмки/клампа вынесена в чистый
  // resolveArmCaptureIndex — M2: ловим ЛЮБУЮ смену id (в т.ч. id1→id2 без null,
  // как заармит срез E), не только null→id; H2: при activeIndex=-1 (playhead в
  // паузе между cue при A-B/time-range-арме) кламп на первый пересекающий cue,
  // иначе cue_index:-1 → запись невидима в ленте навсегда.
  const prevArmedIdRef = useRef<string | null>(null)
  const armCueIndexRef = useRef<number>(-1)
  useEffect(() => {
    const armedId = runtime.armedSegmentId()
    const armedEx = armedId != null
      ? (runtime.getEphemeralArm()
          ?? runtime.annotations.shadowExercises.find(e => e.id === armedId)
          ?? null)
      : null
    armCueIndexRef.current = resolveArmCaptureIndex({
      prevArmedId: prevArmedIdRef.current,
      armedId,
      prevCaptured: armCueIndexRef.current,
      activeIndex,
      cues,
      armedRange: armedEx ? { startTime: armedEx.startTime, endTime: armedEx.endTime } : null,
    })
    // ТЗ №2 [ID:P-hotfix-quota-ux]: арм НОВОГО упражнения (смена armed id на не-null)
    // → свежий gate в RealtimeAnswerSource ⇒ свежая попытка; гасим стейл-баннер от
    // прошлого упражнения. setState(null) при уже-null → React bail-out (без цикла).
    if (armedId != null && armedId !== prevArmedIdRef.current) setUnavailableNotice(null)
    // ТЗ №5 п.2 — попытки ПЕР-РАН. ВХОД в НОВЫЙ ран извне (armedSegmentId меняется
    // на не-null: null→id ИЛИ id1→id2 = автостарт/S/пилюля) → лента ПУСТА: чистим
    // бакет ПРОШЛОГО рана этого видео (live+persisted+localStorage), в т.ч.
    // «вечную» историю прошлых сессий («только зашёл — а у меня уже 10» — этого
    // быть не должно). Ре-арм ВНУТРИ рана (петля restart) armedSegmentId НЕ меняет
    // → attempts НЕ трогаются (петля копит). Выход (id→null) НЕ чистит здесь —
    // карта размонтирована (не видно), а СЛЕДУЮЩИЙ вход и так очистит; так бакет
    // ДРУГОГО видео (иной localStorage-ключ) не задевается разармом текущего.
    // Идемпотентно: StrictMode double-invoke безопасен (clearAll на пустом no-op).
    if (armedId != null && armedId !== prevArmedIdRef.current) attempts.clearAll()
    prevArmedIdRef.current = armedId
  })
  // Дедуп (п.3): AnswerOutcomeEvent НЕ несёт seq (answer-source.ts:203-206) —
  // координатор минтит НОВЫЙ объект на каждый setVerdictOutcome, поэтому
  // object-identity ref однозначно отличает «уже обработанный» final от
  // нового. Вынесено в чистый хелпер (shadow-attempts-accumulate.ts, тот же
  // идиом, что shadow-phase.ts/shadow-settings-delivery.ts) — см. его доку
  // для того, ПОЧЕМУ дедуп-реф здесь defense-in-depth, а не буквальная
  // StrictMode-double-invoke защита (эмпирически подтверждено: React бьёт
  // эффект дважды ТОЛЬКО на первом mount-коммите, а verdictOutcome там
  // всегда null) — и для мутационно-чувствительных unit-тестов дедупа,
  // которые полноценный PlayerPage-mount под StrictMode воспроизвести не может.
  const consumedVerdictRef = useRef<AnswerOutcomeEvent | null>(null)
  useEffect(() => {
    accumulateShadowAttempt(
      consumedVerdictRef, runtime.verdictOutcome, runtime.verdictTargetSnapshot,
      // [ID:P-feed-dead] КОРЕНЬ: писать под ТЕМ ЖЕ резолвером бакета, каким карта
      // ЧИТАЕТ (ниже, shadowCardData.cueIndex) — иначе armCue=-1 (честный -1 от
      // resolveArmCaptureIndex на gap-арме) уводил запись в НЕВИДИМЫЙ бакет "-1"
      // (toPanel пропускает <0), а чтение падало на activeIndex → лента вечно пуста.
      resolveAttemptBucket(armCueIndexRef.current, activeIndex), attempts.add,
    )
  }, [runtime.verdictOutcome, runtime.verdictTargetSnapshot, attempts.add, activeIndex])
  const onShadowKeyActivateOnArm = useCallback(() => {
    runtime.handleShadowKey()
    const armed = runtime.armedSegmentId() != null
    if (getShadowState().active !== armed) setShadowState({ active: armed })
    if (armed) {
      // ТЗ №6 п.2 [ID:P-tz6]: оцениваем и показываем B1 ВСЕГДА — grading ВКЛ на
      // арме независимо от тумблера АВТОПЕРЕХОД. Координаторский onArm выставил
      // armedGradingRef = advanceEnabled && thr (useShadowLoopCoordinator.ts:351);
      // перекрываем на true ПОСЛЕ него. advanceEnabled продолжает управлять только
      // advance/restart через reduceLoopOutcome. Владелец (видео 23-39, 1:30–2:20).
      runtime.setArmedGrading(true)
      // Manual arm (S / R / pill) is an explicit user action → grant mic consent
      // (only in realtime — Fake has no mic). This makes any subsequent
      // autostart-arm this session hands-free (no prompt).
      if (shadowRealtimeEnabled) grantMicConsent()
    }
  }, [runtime, getShadowState, setShadowState, shadowRealtimeEnabled, grantMicConsent])
  // Срез A (п.9): единый deactivateShadow() — общий путь пилюли (актив→стоп),
  // клавиши R, крестика карты и hands-free «Стоп». runtime.deactivate() —
  // no-op пока eval-in-flight (гейт координатора). ПЕРЕ-чек armedSegmentId()
  // ПОСЛЕ deactivate: setShadowState({active: armed}) — при живом eval арм цел,
  // active остаётся true (нет флика через catch-all эффект выше). ws.stopLoop()
  // + сброс analyzing ТОЛЬКО при реальном разоружении.
  const deactivateShadow = useCallback(() => {
    runtime.deactivate()
    const stillArmed = runtime.armedSegmentId() != null
    setShadowState({ active: stillArmed })
    if (!stillArmed) { ws.stopLoop(); setAnalyzing(false) }
  }, [runtime, ws, setShadowState])
  // Срез A (п.1/п.7): единый toggle пилюли «Шадоуинг» и клавиши R. Неактивно →
  // тот же путь, что S (arm по субтитру/A-B; вне cue/A-B = no-op, паритет
  // useShadowRuntime handleShadowKey). Активно → deactivateShadow(). Читаем
  // getShadowState().active (live-геттер, не лагающий shadowState) — двойной клик
  // (toggle-гонка) остаётся консистентным: первый клик синхронно ставит active,
  // второй его видит и деактивирует.
  const onToggleShadow = useCallback(() => {
    if (getShadowState().active) deactivateShadow()
    else onShadowKeyActivateOnArm()
  }, [getShadowState, deactivateShadow, onShadowKeyActivateOnArm])

  // ── Срез E [ID:P-E]: автостарт по playhead для PERSISTED-упражнений ─────────
  // Канон desktop index.tsx:1854-1869. Вход playhead в регион РАЗМЕЩЁННОГО
  // (persisted) shadow-упражнения → арм+activate; выход → gated onLeave; ручное
  // закрытие внутри региона → suppression (редьюсер ведёт сам по shadowActive).
  //
  // Тикер = playerState.currentTime (usePlayerState, ~250мс poll) — тот же
  // существующий тикер, что питает runtime.currentTime/mute-регионы. НЕ заводим
  // новый rAF/интервал: sub-frame недолёт seek-в-A гасит EXERCISE_START_EPS в
  // самом редьюсере (useShadowAutoStart.ts:32/:40).
  //
  // exercises = runtime.annotations.shadowExercises (persisted-упражнения из
  // useAnnotations — источник регионов). Пусто у обычного юзера ⇒ редьюсер даёт
  // 'none' на каждом тике ⇒ эффект инертен (дормант-безопасно, mic-CRIT S3-2).
  const autoStartActivate = useCallback(() => {
    // no-op: активацию (флаг ShadowState.active) синкает S3-6b catch-all эффект
    // (:336) по armedSegmentId ПОСЛЕ побочных эффектов onArm (restoreWorkspace/
    // countdownThenPlay гарантируют ре-рендер) — НЕ дублируем setShadowState
    // здесь (леджер-carry S3-7: переиспользуем activate-on-arm, а не дублируем).
  }, [])
  const autoStartDeactivate = useCallback(() => {
    // no-op: teardown по playhead-EXIT ведёт ГЕЙТИРОВАННЫЙ onLeave (ниже).
    // runtime.deactivate() НАМЕРЕННО обходит loop-transient-гард координатора
    // (useShadowRuntime.ts:904 → setArmedLooping(false)+onLeave) — он для РУЧНОГО
    // закрытия (карта × / пилюля / R → deactivateShadow), которое НЕ идёт через
    // редьюсеровский 'deactivate' action (ручное = shadowActive→false ⇒
    // suppression, useShadowAutoStart.ts:55-62). Если бы playhead-exit звал
    // runtime.deactivate(), на КАЖДОЙ границе петли (t≥endTime на миг →
    // редьюсер 'deactivate') петля сносилась бы. Поэтому здесь — no-op.
  }, [])
  const autoStartOnArm = useCallback((ex: ShadowExerciseAnnotation) => {
    const rt = runtimeRef.current
    // Леджер-carry 2a: зеркалим координаторский onArm-гард (useShadowLoopCoordinator
    // .ts:336 — evalInFlight && sameId держит старый арм). Композиц-онный
    // runtime.onArm (useShadowRuntime.ts:772) делает clearHold()+setVerdictOutcome(
    // null) ДО делегации coordinator.onArm (чей собственный гард ТАМ бы no-op'нул),
    // поэтому вызов мид-eval стёр бы ЖИВОЙ вердикт/hold. Гардим ЗДЕСЬ, до вызова.
    if (rt.isEvalInFlight() && rt.armedSegmentId() === ex.id) return
    // PERSISTED-арм через ТОТ ЖЕ композиц-онный onArm, каким юзер армит упражнение
    // (не armRange!): armRange лепит ЭФЕМЕРНОЕ упражнение из ТЕКУЩЕГО ShadowState
    // (id 'ephemeral-N'), теряя персист-настройки размещённого упражнения;
    // effectiveShadowSettings у live-упражнения читает ex.settings. Публичный
    // persisted-арм есть (runtime.onArm с объектом из стора) ⇒ компромисс не нужен.
    rt.onArm(ex)
    // ТЗ №6 п.2 [ID:P-tz6]: grading ВКЛ на арме ВСЕГДА (см. onShadowKeyActivateOnArm) —
    // автостарт-упражнение тоже оценивается и показывает B1 при выключенном автопереходе.
    rt.setArmedGrading(true)
    // HIGH-1 (фикс-волна final): mirror desktop-канон useShadow.ts:139-152 —
    // activate(exercise) syncs the ShadowState settings-subset FROM the persisted
    // exercise.settings. Without it, after a page reload (annotations persist,
    // ShadowState resets to INITIAL defaults) the coordinator grades honestly by
    // ex.settings (thr / customText read via effectiveShadowSettings of the LIVE
    // exercise), while the UI lies: slider 80%, «ОЖИДАЕТСЯ» shows a subtitle cue.
    // This is the AUTOSTART path only (activate) — the MANUAL arm (S/pill) канон
    // does NOT sync (onShadowKeyActivateOnArm untouched), and the ephemeral arm
    // already carries its settings from ShadowState. active/recording/wsConnected
    // are NOT set here — the S3-6b catch-all effect (:336) flips `active` by
    // armedSegmentId; we only sync the settings-subset.
    const eff = effectiveShadowSettings(ex, getShadowState())
    setShadowState({
      loopMode: eff.loopMode,
      advanceEnabled: eff.advanceEnabled,
      advanceThreshold: eff.advanceThreshold,
      mode: eff.mode,
      customText: eff.customText ?? getShadowState().customText,
      saveAudio: eff.saveAudio,
      engines: eff.engines,
      documentPath: eff.documentPath,
    })
    // Owner decision 2026-07-10: this arm came from AUTOSTART (playhead), NOT an
    // explicit user action. In realtime, if consent is still UNASKED (null),
    // surface the one-shot prompt ('pending') — the arm/loop above still runs
    // (hands-free UX intact), but useShadowMicStream keeps the mic SHUT until the
    // user taps "Начать". 'declined' (sticky this session) and 'granted' (already
    // hands-free) both skip — the mic gate + prompt read micConsent directly.
    // Fake/realtime-off never prompts (shadowRealtimeEnabled short-circuits).
    if (shadowRealtimeEnabled && micConsentRef.current == null) {
      setMicConsent('pending')
    }
  }, [shadowRealtimeEnabled, getShadowState, setShadowState])
  const autoStartOnLeave = useCallback((armedId: string) => {
    // ГЕЙТИРОВАННЫЙ путь выхода (правка фактчека): coordinator.onLeave держит арм
    // на loop-transient (armedLooping && insideRegion/justPastEnd, useShadowLoop
    // Coordinator.ts:427-441), снимает — только на РЕАЛЬНОМ уходе. НЕ deactivate().
    runtimeRef.current.onLeave(armedId)
  }, [])
  useShadowAutoStart({
    currentTime: playerState.currentTime,
    // Пока старт из ссылки (?t=) не «съеден», автостарт молчит: плеер на паузе внутри сохранённого
    // упражнения только потому, что мы открыли ссылку, — это не вход плейхеда в регион (иначе play() без клика).
    exercises: cueStart !== undefined ? NO_EXERCISES : runtime.annotations.shadowExercises,
    shadowActive: shadowState.active,
    activate: autoStartActivate,
    deactivate: autoStartDeactivate,
    onArm: autoStartOnArm,
    onLeave: autoStartOnLeave,
  })
  // MED-3 (адверс-ревью фикс-волны E — задокументировано, фикс = follow-up):
  // интермиттентный re-arm после boundary-транзиента. 250мс-полл playerState.
  // currentTime может сэмплить t>=endTime → редьюсер даёт 'deactivate' на миг, а
  // если из буферизованных finals прилетел мгновенный eval → post-eval 'arm' →
  // clearHold стирает вердикт-нотацию через <=250мс. Наблюдаемо как «вердикт
  // мигнул и пропал» на грани петли. Фикс (follow-up): дебаунс teardown-тика или
  // сверка живого getCurrentTime в редьюсере, как в coordinator.onLeave-гарде.

  // ── HIGH-2 (фикс-волна E [ID:P-E-fix]): РАЗОРУЖЕНИЕ ПРИ УДАЛЕНИИ АРМЛЕННОГО ──
  // onExerciseDelete (:907) и bind-«выкл» (:665) зовут ГОЛЫЙ deleteShadowExercise
  // без разоружения. Арм остаётся на МЁРТВОМ снапшоте (coordinator.armedExerciseRef
  // хранит объект С МОМЕНТА arm, а не из стора). Следующий autostart-тик даёт
  // 'deactivate'→onLeave, НО coordinator.onLeave на ПЕТЛЕВОМ упражнении держит арм
  // по transient-гарду (armedLooping && playhead внутри СТАРЫХ границ мёртвого
  // снапшота, useShadowLoopCoordinator.ts:427-441) → ЗОМБИ: ws.looping вечно,
  // armedSegmentId жив, мик стримит, карта висит до ручного ×.
  // Фикс: армленный id ПРОПАЛ из стора И арм НЕ эфемерный → deactivateShadow()
  // (его ungated runtime.deactivate = setArmedLooping(false)+onLeave — здесь
  // ЛЕГИТИМЕН: упражнение мертво — + синк active + ws.stopLoop).
  //  • getEphemeralArm()!=null — ОБЯЗАТЕЛЬНЫЙ guard: эфемерный арм (id 'ephemeral-N')
  //    живёт ВНЕ стора, его id там НИКОГДА нет; без guard'а любая мутация стора
  //    (в т.ч. канал (c) доставки настроек) пришибала бы эфемерный арм.
  //  • Без deps-массива (идиом active-sync-эффекта :338): персист-id всё ещё в
  //    сторе ⇒ no-op на КАЖДОМ рендере (settings-update канала (c) — id цел — не
  //    трогаем). Удаление mid-eval: runtime.deactivate no-op'ит (eval владеет
  //    отрезком), эффект РЕТРАИТ на рендере резолва вердикта — самоизлечение.
  // РЕСАЙЗ (playhead вне НОВЫХ границ живого упражнения) — ИЗВЕСТНЫЙ GAP, НЕ
  // фиксится: тот же тригер (shadowExercises) делит канал (c) обновления настроек
  // (updateShadowExercise на КАЖДОЕ loop/advance/mode/customText), поэтому «playhead
  // вне границ» на justPastEnd-транзиенте петли ложно снёс бы петлю при простом
  // тумблере настройки. Отделить «границы уехали» от «настройка при транзиенте»
  // требует трекинга границ + окна транзиента координатора — риск > польза
  // (адверс-ревью фикс-волны E: delete-ветка). Follow-up при реальной жалобе.
  useEffect(() => {
    const armedId = runtime.armedSegmentId()
    if (armedId == null) return                    // ничего не армлено — дормант
    if (runtime.getEphemeralArm() != null) return  // эфемерный арм вне стора — не трогаем
    const stillPersisted = runtime.annotations.shadowExercises.some(e => e.id === armedId)
    if (!stillPersisted) deactivateShadow()        // persisted-упражнение удалено под армом
  })

  // ── Срез B (§2/§3): settingsRow delivery — ТРИ канала на каждое изменение ──
  // (a) setShadowState — базовый ShadowState (fallback-резолв без exercise.settings);
  // (b) эфемерный арм — in-place мутация held-объекта (persistArmedSettings);
  // (c) persisted арм — fresh-spread через updateShadowExercise (CRIT-1).
  // Каналы b/c — persistArmedSettings (чистый хелпер); runtimeRef.current —
  // стабильная свежая ссылка на рантайм (:193, обновляется каждый рендер).
  const deliverArmedSettings = useCallback((patch: ArmedSettingsPatch) => {
    persistArmedSettings({
      armedSegmentId: () => runtimeRef.current.armedSegmentId(),
      getEphemeralArm: () => runtimeRef.current.getEphemeralArm(),
      getExercises: () => runtimeRef.current.annotations.shadowExercises,
      updateShadowExercise: (id, p) => runtimeRef.current.annotations.updateShadowExercise(id, p),
    }, patch)
  }, [])
  const onAdvanceThresholdChange = useCallback((v: number) => {
    setShadowState({ advanceThreshold: v })          // a
    deliverArmedSettings({ advanceThreshold: v })    // b/c — перечитка на границе (:465/:494)
  }, [setShadowState, deliverArmedSettings])
  const onAdvanceEnabledChange = useCallback((v: boolean) => {
    setShadowState({ advanceEnabled: v })            // a
    deliverArmedSettings({ advanceEnabled: v })      // b/c
    // ТЗ №6 п.2 [ID:P-tz6]: тумблер БОЛЬШЕ НЕ трогает armedGradingRef — grading
    // ВКЛ всегда (setArmedGrading(true) на арме), оцениваем и показываем B1 при
    // любом положении тумблера. advanceEnabled управляет ТОЛЬКО advance/restart
    // (reduceLoopOutcome, каналы a/b/c). Это осознанно отменяет прежний desktop-
    // паттерн setAdvanceEnabledLive→setArmedGrading (index.tsx:1790-1796): владелец
    // решил, что оценка не должна зависеть от автоперехода (видео 23-39, 1:30–2:20).
  }, [setShadowState, deliverArmedSettings])
  // HIGH-1 / desktop index.tsx:1812-1847 (setLoopModeLive) ПОЛНОСТЬЮ. РЕАЛЬНУЮ
  // петлю гонит ws.looping, НЕ shadowState.loopMode — без этого chip не управлял
  // петлёй: (a) OFF на армленной no-grade петле оставлял ws.looping=true (петля
  // крутилась вечно при отжатой кнопке); (b) ON на армленном непетлевом grading-
  // отрезке оставлял ws.looping=false, а setArmedLooping(true) блокировал G5
  // (координатор :683) → конец отрезка без оценки вовсе.
  const onLoopModeChange = useCallback((v: boolean) => {
    setShadowState({ loopMode: v })                  // a
    deliverArmedSettings({ loopMode: v })            // b/c (persistSettingsToArmed)
    const rt = runtimeRef.current
    if (rt.armedSegmentId() != null) {
      // АРМЛЕН (desktop :1820-1830): переключить РЕАЛЬНУЮ ws-петлю + синк
      // armedLoopingRef координатора (иначе onLeave/G5-гарды рассинхронятся).
      if (v) {
        // ON: ws.setABLoop ≙ setLooping(true) + перевзвод монитора границы +
        // rewind #25 (внутренний seek к A, если playhead уже за rangeEnd —
        // критерий currentTime>=rangeEnd тождественен desktop
        // shouldRewindOnLoopEnable :1826-1829). На вебе нет голого setLooping:
        // петлю ставит только setABLoop, и он же ре-армит boundary-монитор
        // (голый флаг оставил бы monitorRef stale → граница бы не сработала).
        ws.setABLoop(ws.rangeStart, ws.rangeEnd)
      } else {
        ws.stopLoop() // OFF: снять реальную петлю (иначе крутится при отжатой кнопке)
      }
      rt.setArmedLooping(v)
    } else {
      // НЕ армлен (desktop :1831-1846): persistArmedSettings был no-op (канал b/c
      // ничего не пишет) → записать loopMode в упражнение ПОД playhead напрямую,
      // иначе re-arm воскресил бы старый loopMode из стейл-настройки упражнения
      // («снял повтор, а оно до сих пор возвращает в A»). Допуск ±0.5с (D2):
      // сразу после fail→resume playhead стоит НА МИГ ЗА endTime.
      const t = getCurrentTime()
      const ann = rt.annotations
      const ex = ann.getShadowExerciseAt(t)
        ?? ann.shadowExercises.find(e => t >= e.startTime - 0.5 && t <= e.endTime + 0.5)
        ?? null
      if (ex) ann.updateShadowExercise(ex.id, { settings: { ...ex.settings, loopMode: v } })
    }
  }, [setShadowState, deliverArmedSettings, ws, getCurrentTime])
  const onModeChange = useCallback((m: ShadowMode) => {
    setShadowState({ mode: m })                      // a — dual-write как setCustomText
    deliverArmedSettings({ mode: m })                // b/c
  }, [setShadowState, deliverArmedSettings])
  // HIGH-2: textarea-путь custom-текста. runtime.setCustomText на ПУСТУЮ строку
  // ставит mode:'subtitle' (T5-семантика right-click-меню «Clear») → гейт
  // settings?.mode==='custom' (ShadowCardLifted :1290) СИНХРОННО размонтировал бы
  // textarea в момент, когда юзер стёр текст (поле исчезало из-под курсора).
  // Десктоп: textarea пишет ГОЛЫЙ setCustomText (state-only, useShadow.ts:622) —
  // режим держится, mode меняется ТОЛЬКО чипом. Поэтому textarea пишет customText
  // во все 3 канала БЕЗ мод-флипа (a: setShadowState; b/c: persistArmedSettings),
  // а runtime.setCustomText остаётся за right-click-меню (там clear→subtitle легитимен).
  const onCustomTextInput = useCallback((text: string) => {
    setShadowState({ customText: text })             // a — БЕЗ смены mode
    deliverArmedSettings({ customText: text })       // b/c
  }, [setShadowState, deliverArmedSettings])

  // ── Срез A (п.2): bind-проводка ПРИВЯЗКА — реальный персист в useAnnotations ──
  // Готовых bind-хелперов в useAnnotations НЕТ (там только CRUD) — колбэки
  // строятся композицией add/update/delete/getShadowExerciseAt/ForSub +
  // cuesIntersectingRange (bind-range.ts) + dropTimeFromFraction (drop-time.ts),
  // по десктоп-канону index.tsx:4467-4499.
  const annotations = runtime.annotations
  const currentShadowExerciseSettings = useCallback((): ShadowExerciseAnnotation['settings'] => {
    const s = getShadowState()
    return {
      loopMode: s.loopMode, advanceEnabled: s.advanceEnabled, advanceThreshold: s.advanceThreshold,
      mode: s.mode, customText: s.customText, saveAudio: s.saveAudio,
      engines: s.engines, documentPath: s.documentPath,
    }
  }, [getShadowState])
  const bindShadowExerciseToCue = useCallback((cueIndex: number) => {
    const c = cues[cueIndex]; if (!c) return
    const existing = annotations.getShadowExerciseForSub(cueIndex)
    if (existing) {
      annotations.updateShadowExercise(existing.id, { startTime: c.start, endTime: c.end, anchorMode: 'subtitle', subIndex: cueIndex }, { resolveConflicts: true })
    } else {
      annotations.addShadowExercise({ startTime: c.start, endTime: c.end, anchorMode: 'subtitle', subIndex: cueIndex, settings: currentShadowExerciseSettings() }, { replaceConflicting: true })
    }
  }, [cues, annotations, currentShadowExerciseSettings])
  // Срез A (M-4, десктоп-канон index.tsx:3476-3495): попадание playhead ВНУТРЬ
  // cue → делегируем SUBTITLE-anchor (bindShadowExerciseToCue), а НЕ пишем
  // time-range; вне cue → time-range до nextCue.start, конец клампится
  // min-длиной 5с (Math.max(end, start+5)), fallback при отсутствии nextCue —
  // min(duration, start + max(5, remaining*0.01)).
  const bindShadowExerciseAtTime = useCallback((time: number) => {
    const hit = cues.findIndex(cc => time >= cc.start && time < cc.end)
    if (hit >= 0) { bindShadowExerciseToCue(hit); return }
    const nextCue = cues.find(cc => cc.start > time)
    const dur = adapter?.duration() ?? 0
    const remaining = Math.max(0, dur - time)
    const fallback = Math.min(dur, time + Math.max(5, remaining * 0.01))
    const rawEnd = nextCue ? nextCue.start : fallback
    const endTime = Math.max(rawEnd, time + 5)
    annotations.addShadowExercise({ startTime: time, endTime, anchorMode: 'time-range', settings: currentShadowExerciseSettings() }, { replaceConflicting: true })
  }, [cues, adapter, annotations, currentShadowExerciseSettings, bindShadowExerciseToCue])
  const onBindToSubtitle = useCallback(() => {
    // Десктоп-канон index.tsx:4467-4491: A-B охватывает >1 cue → привязать весь
    // диапазон (time-range); иначе — одиночный cue (subtitle-anchor).
    // Срез A (M-5): гейт по АКТИВНОСТИ ЛУПА (ws.looping ≙ desktop workspace.active),
    // а НЕ по `rangeEnd>rangeStart` — залежавшийся диапазон при выключенном лупе
    // не должен превращать «к субтитру» в time-range.
    if (ws.looping) {
      const spanned = cuesIntersectingRange(cues.map(c => ({ startTime: c.start, endTime: c.end })), ws.rangeStart, ws.rangeEnd)
      if (spanned.length > 1) {
        annotations.addShadowExercise({ startTime: ws.rangeStart, endTime: ws.rangeEnd, anchorMode: 'time-range', settings: currentShadowExerciseSettings() }, { replaceConflicting: true })
        return
      }
    }
    if (activeIndex < 0 || !cues[activeIndex]) return
    bindShadowExerciseToCue(activeIndex)
  }, [ws, cues, activeIndex, annotations, currentShadowExerciseSettings, bindShadowExerciseToCue])
  const onBindToTime = useCallback(() => { bindShadowExerciseAtTime(getCurrentTime()) }, [bindShadowExerciseAtTime, getCurrentTime])
  const onBindOff = useCallback(() => {
    // «выкл» = «этого упражнения не должно быть»: удалить перекрывающее playhead.
    const ex = annotations.getShadowExerciseAt(getCurrentTime())
    if (ex) annotations.deleteShadowExercise(ex.id)
  }, [annotations, getCurrentTime])
  const onAnchorDrop = useCallback((frac: number) => {
    // BL2 (audit/28): fraction → время по VIEW-окну (не по всему клипу).
    bindShadowExerciseAtTime(dropTimeFromFraction(frac, ws.viewStart, ws.viewEnd))
  }, [bindShadowExerciseAtTime, ws])
  const activeCue = cues[activeIndex]
  const bindTC = shadowState.bind === 'now'
    ? formatTC(playerState.currentTime)
    : (shadowState.bind === 'subStart' && activeCue ? formatTC(activeCue.start) : '')

  // ── Срез A (M-1): честный display-target для панели «ОЖИДАЕТСЯ» ──
  // Та же СЕМАНТИКА, что композиц-слой targetTextForExercise (useShadowRuntime:
  // custom→customText; иначе текст cue, покрывающих армленный отрезок; иначе
  // активный cue). runtime ЗАМОРОЖЕН → логика строится здесь на cuesIntersectingRange
  // (импорт из нового util в runtime запрещён), НЕ через `cues[activeIndex]` в лоб:
  // тот показывал ОДИН активный cue даже при A-B-арме на 2+ cue и игнорировал
  // customText до первого вердикта.
  const displayTarget = useMemo(() => {
    if (shadowState.mode === 'custom' && shadowState.customText && shadowState.customText.trim() !== '') {
      return shadowState.customText
    }
    const armedEx = runtime.getEphemeralArm()
      ?? runtime.annotations.shadowExercises.find(e => e.id === runtime.armedSegmentId())
      ?? null
    if (armedEx) {
      return cuesIntersectingRange(
        cues.map(c => ({ startTime: c.start, endTime: c.end, text_en: c.text_en })),
        armedEx.startTime, armedEx.endTime,
      ).map(c => c.text_en).join(' ')
    }
    return cues[activeIndex]?.text_en ?? ''
  }, [runtime, cues, activeIndex, shadowState.mode, shadowState.customText, shadowState.active])

  // Срез A: адаптер runtime-вердикт + live-мик + фазы → форма ShadowV1Api,
  // которую рендерит полная ShadowCard (осциллограф + rec-strip + лента). НЕТ
  // V1 push-to-record — мик = стриминг-пайплайн S3-10, «Стоп» = deactivateShadow
  // (hands-free, п.5). phase-маппинг — п.4.
  const shadowCardData = useMemo<ShadowV1Api>(() => {
    const target = runtime.verdictTargetSnapshot ?? ''
    // ТЗ №6 п.1 [ID:P-tz6]: latest-B1 читается из persistent-снапшота, НЕ из
    // эфемерного runtime.verdictOutcome (тот обнуляется на границе петли → B1
    // мигал). Снапшот держит последний ФИНАЛ и переживает границы; заменяется
    // только новым финалом; чистится на разоружении (эффекты выше). H-1/H1-гейт
    // (matchPct из того же matchWordsDetailed; пустой финал не пишется) уже
    // применён при ЗАПИСИ снапшота, поэтому здесь — прямое чтение.
    const lastMarks: ShadowV1Api['lastMarks'] = persistentVerdict?.marks ?? null
    const lastMatchPct: ShadowV1Api['lastMatchPct'] = persistentVerdict?.matchPct ?? null
    const lastSpoken: ShadowV1Api['lastSpoken'] = persistentVerdict?.spoken ?? null
    const finalVerdict = persistentVerdict != null
    // Срез A (M-2): порядок фаз через чистый резолвер — 'result' (финал+hold)
    // стоит ПЕРЕД 'recording' (открытый мик), иначе hold с живым реалтайм-миком
    // вечно залипал в 'recording' и вердикт был недостижим.
    const phase = computeShadowPhase({
      analyzing,
      evalOverlayVisible: runtime.evalOverlayVisible,
      micOpen: micAnalyser != null,
      finalVerdict,
      holding: runtime.holding,
    })
    return {
      active: shadowState.active,
      phase,
      errorCode: null,
      remainingSec: recElapsed,
      referenceText: target || displayTarget,
      lastMarks,
      lastMatchPct,
      lastSpoken,
      capped: false,
      recordAudioUrl: null,
      // ТЗ №5 п.3 — КОРЕНЬ бага «лента/B1 умирает, повтор N скачет»: карта читала
      // бакет попыток по `activeIndex` (cue ПОД playhead'ом), а аккумулятор пишет
      // их под `armCueIndexRef.current` (cue на МОМЕНТ АРМА, зафиксирован). Пока
      // playhead ходит по петле/за границей армленного отрезка, activeIndex ≠
      // armCue → карта читала ДРУГОЙ/пустой бакет: строки исчезали, «повтор N»
      // считался по чужому бакету (скакал), latest-B1 síntез вырезал не ту строку
      // (scored.slice(0,-1)). Карта ОБЯЗАНА читать ТОТ ЖЕ бакет, куда пишет
      // аккумулятор → cueIndex = armCue. Вне арма (idle, карта не показана) — фолбэк
      // на activeIndex. armCueIndexRef обновляется в арм-эффекте до этого мемо; мемо
      // пересчитывается на смене attempts.forPanel/active/activeIndex — свежесть ок.
      cueIndex: resolveAttemptBucket(armCueIndexRef.current, activeIndex),
      analyserNode: micAnalyser,
      // Срез C (п.4): merged persisted+live лента (mergeShadowAttemptsForPanel,
      // прецедент useShadowV1.ts:362 `attempts.forPanel`). recordings ОСТАЁТСЯ
      // [] — записей аудио попыток на вебе нет (нет стораджа), поэтому лента
      // истории рендерится score-only и НЕ кликабельна (ShadowCardLifted's
      // recordingId-join always misses — parity-компромисс, тест зафиксировал).
      shadowAttempts: attempts.forPanel,
      recordings: [],
      activate: () => {},
      deactivate: deactivateShadow,
      toggle: () => {},
      startRecording: async () => {},
      stopRecording: () => {},
      dismissResult: () => {},
      selectRecording: () => {},
      deleteRecording: () => {},
    }
  }, [runtime, shadowState.active, micAnalyser, analyzing, recElapsed, activeIndex, displayTarget, deactivateShadow, attempts.forPanel, persistentVerdict])
  // S3-5: user-сик-маршрут — стрелки/ctrl-стрелки идут через runtime.seek
  // (observedSeek, carry T4/F3 forward-escape), не напрямую в adapter.seek.
  // Срез A (п.7): R = onToggleShadow (тот же toggle, что пилюля).
  // Э6: хоткеи S/R гейтятся тем же hasShadowingAccess, что и пилюля Шадоуинг
  // в WorkspacePanelThemed — иначе клавиатура обходила бы гейт «не всем».
  // ГЕЙТИТСЯ ТОЛЬКО СТАРТ (getShadowState().active === false): при активной
  // сессии S = resume-from-hold, R = стоп — отзыв доступа посреди записи
  // (логаут в другой вкладке) НЕ должен отбирать у пользователя возможность
  // её остановить/довести (аудит Э6, CRIT: лок-аут при свёрнутом таймлайне).
  useHotkeys({ adapter, ws, cues, activeIndex, seek: seekTracked, onShadowKey: () => { if (getShadowState().active || hasShadowingAccess()) onShadowKeyActivateOnArm() }, onShadowToggle: () => { if (getShadowState().active || hasShadowingAccess()) onToggleShadow() }, onApplyMute: (t1, t2, ci) => muteApi.applyRange(t1, t2, ci), onToggleTimeline: () => setTimelineCollapsed(c => !c), onToggleFullscreen: () => fsRef.current?.toggleFullscreen() })
  useClearSelectionOutsidePlates()
  // T1a [ID:P-video-chat]: SubtitleOverlay эмитит слово+rect клика наверх,
  // мы просто показываем WordPopup у этой позиции (position:fixed, rect —
  // координаты viewport, конвертация не нужна). onExamples/onClose ниже
  // передаются в WordPopup при рендере (см. JSX).
  const onSubtitleWordClick = useCallback((word: string, rect: DOMRect) => {
    setWordPopup({ word, position: { x: rect.left, y: rect.bottom } })
    // hint_requested маршрута: окно примеров по слову (не на первом нажатии на
    // размытое слово — его SubtitleOverlay сюда не передаёт).
    routeEvents.onWordClick(word)
    // word_click (телеметрия): сырая surface_form + контент-хэш активной строки
    // + таймкод. Резолюция в лемму — на сервере позже, здесь только координаты.
    const line = cues[activeIndex]?.text_en
    track('word_click', {
      video_id: videoId,
      route_goal: routeGoal,
      surface_form: word,
      sub_line_hash: line && line.trim() ? subLineHash(line) : undefined,
      timecode: round2(adapter?.currentTime() ?? 0),
    })
  }, [videoId, routeGoal, cues, activeIndex, adapter, routeEvents])
  // F8: drawer cue-pick (CueList/SubtitleSearch) selects the cue AS the A-B range
  // AND brings it into timeline view (minimal shift, same geometry as Ctrl-arrow
  // goToCue in useHotkeys) — a deliberate flib enhancement over the desktop source,
  // which does not shift the view on list-click.
  const t = useT()
  // S3-4 (#5, brief §wiring-map): onExerciseClick = SELECT only. Themed already
  // owns visual selection internally (its own `selectedExerciseId` state, see
  // WorkspacePanelThemed.tsx) and calls this prop as an extra notification hook
  // — there is no runtime-side "selected exercise" concept to write into yet,
  // so this is intentionally a no-op hook point. Arm-on-click is a SEPARATE,
  // later concern (S key = S3-6) — NOT wired here on purpose.
  const onExerciseClick = useCallback((_id: string) => { /* select — arm via S-key lands in S3-6 */ }, [])
  const selectCue = (index: number) => {
    const c = cues[index]; if (!c || !adapter) return
    ws.setRange(c.start, c.end)
    const len = Math.max(0.5, ws.viewEnd - ws.viewStart)
    const dur = adapter.duration() || c.end + 1
    if (c.start < ws.viewStart) { const vs = Math.max(0, c.start); ws.setView(vs, vs + len) }
    else if (c.end > ws.viewEnd) { const ve = Math.min(dur, c.end); ws.setView(ve - len, ve) }
    // desktop canon: list-click does not auto-disable loop
    // S3-5: CueList/SubtitleSearch-выбор — user-сик, маршрут через runtime.seek.
    runtime.seek(c.start)
  }

  // Блок под видео в режиме маршрута (плеер v2, дизайн 2026-11-19 §4): название, метки
  // и «Нравится / Не нравится». Компьютер — сразу под видео, внутри .fs-root перед
  // панелью таймлайна (ревью v2a R1-M1); сенсорный экран — после .fs-root (M-1: внутри
  // него панель управления ложилась на блок). В полноэкранном режиме и на телефоне
  // боком блока нет — оценка поверх видео.
  const routeInfo = voteInline ? (
          <div className="plv2-info" data-testid="route-clip-info">
            <div className="pl-it">
              {routeClip?.title && <h2>{routeClip.title}</h2>}
              {routeClip && (
                <div className="tags">
                  <span className="tag">{routeClip.source || (routeClip.kind === 'youtube' ? 'YouTube' : 'Ролик')}</span>
                  {routeClip.series_title && <span>{routeClip.series_title}</span>}
                  {minutesOf(routeClip.duration_sec ?? 0) > 0 && <span>{minutesOf(routeClip.duration_sec ?? 0)} мин</span>}
                </div>
              )}
            </div>
            {!hideVoteForExtra && (
              <div className="pl-rate">
                <VideoVoteBar videoId={videoId} currentTime={playerState.currentTime} duration={playerState.duration} route={routeVote}
                  raised={atEnd && !!endVariant} inline />
              </div>
            )}
          </div>
  ) : null

  if (!videoId) return <div className="page-msg">Нет видео. Вернитесь на <a href="/">старт</a>.</div>

  return (
    <div className="player-shell">
      <HeardCheckHost />
      <LeftRail drawerOpen={railDrawer} onDrawerClose={closeRailDrawer} />
      <div className="player-main">
      <div className="player-page" data-dusk="site" ref={themeRef}>
      {/* Э5: над видео, ВНЕ FullscreenContainer — не перекрывает видео/таймлайн,
          не нужна внутри fullscreen (иммерсия), исчезает вместе с обычным UI
          при входе в fullscreen (тот же паттерн, что и .player-note ниже). */}
      {routeStepId && !fromRoute && <RouteStepBar stepId={routeStepId} />}
      <FullscreenContainer ref={fsRef} onModeChange={setFsOn}>
        {/* W3 (feedback #5): верхняя панель — ПЕРВЫЙ ребёнок .fs-root, в потоке
            flex-колонки НАД .player-stage (не оверлей видео) → видна и в
            fullscreen (живёт внутри самого fullscreened элемента). Заменяет
            снесённый .stage-tools: субтитр-режим + gear + inset теперь тут,
            spacer резервирует место под будущие кнопки (Aa/караоке/аннотации). */}
        {/* [ID:P-mobile]: на мобиле топбар — оверлей поверх видео (app.css,
            @media(pointer:coarse)), НЕ участник flex-колонки (владелец
            называл его "дико лишним" — здесь он хотя бы не отнимает высоту).
            Гасится/показывается тем же autoHideControls, что и control-bar —
            единое "тапнул видео → УК всё вместе появилось/исчезло" ощущение
            вместо двух независимо мигающих полос. */}
        <div className={'video-topbar' + (mobile && !autoHideControls.visible ? ' vtb-hidden' : '')} data-testid="video-topbar">
          {/* Phase 2, п.G: слева вверху — «Мой маршрут» (вернуться на /route).
              Живёт ВНУТРИ .video-topbar (первый flex-child, до .vtb-modes) —
              не сосед ему: тест W3 (PlayerPage.test.tsx) закрепляет, что
              .video-topbar остаётся ПЕРВЫМ ребёнком .fs-root, порядок узлов
              внутри самого .video-topbar этим тестом не ограничен. tb-btn —
              та же визуальная конвенция, что gear/inset/chat кнопки справа
              (app.css, не трогаем), .vtb-route-link — своя css рядом. */}
          {/* Плеер v2: ☰ — только на телефоне (player-v2.css), открывает левое меню. */}
          <button type="button" className="tb-btn pl-burger" data-testid="rail-burger" aria-label="Меню" title="Меню"
            onClick={() => setRailDrawer(true)}><Menu size={16} /></button>
          {fromRoute ? <BackToRouteLink /> : (
            <Link to="/route" className="tb-btn vtb-route-link" data-testid="my-route-link" title="Мой маршрут" aria-label="Мой маршрут">
              <RouteIcon size={14} className="vtb-ico" aria-hidden="true" /><span className="vtb-label">Мой маршрут</span>
            </Link>
          )}
          <div className="vtb-modes">
            {SUBTITLE_MODE_OPTIONS.map(m => (
              <button
                key={m.value}
                data-testid={TOPBAR_MODE_TESTID[m.value]}
                className={'tb-btn' + (shownMode === m.value ? ' is-active' : '')}
                aria-pressed={shownMode === m.value}
                onClick={() => requestMode(m.value)}
              >{t(m.labelKey)}</button>
            ))}
          </div>
          <div className="vtb-spacer" />
          <div className="vtb-tools">
            {/* T1a [ID:P-video-chat]: тумблер «Чат: Видео» — открывает/
                закрывает VideoChatPanel независимо от того, был ли уже клик
                по слову (useVideoChat.toggleOpen — см. doc там же). */}
            <button
              data-testid="video-chat-btn"
              className={'tb-btn' + (videoChat.state.open ? ' is-active' : '')}
              onClick={videoChat.toggleOpen}
              aria-label="Чат: Видео"
              title="Чат: Видео"
            >💬</button>
            <button
              data-testid="gear-btn"
              className="tb-btn"
              onClick={() => setDrawerOpen(o => !o)}
              aria-label="Настройки субтитров"
              title="Настройки"
            >⚙</button>
            <button
              data-testid="inset-btn"
              className={'tb-btn' + (videoBoxed ? ' is-active' : '')}
              onClick={toggleBoxed}
              aria-label="Масштаб видео"
              title={videoBoxed ? 'Вернуть видео на всю канву' : 'Встроить видео между панелями'}
            >
              {videoBoxed ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>
          </div>
        </div>
        <PlayerRoot
          key={`${videoId}:${remountNonce}`}
          videoId={videoId}
          transport={transport}
          cueStart={cueStart}
          onAdapter={setAdapter}
          insetRight={videoBoxed && drawerOpen ? 340 : 0}
          // [ID:P-mobile]: тап по видео показывает control-bar/video-topbar
          // (владелец: "появляется по тапу"). undefined на десктопе — PlayerRoot
          // не навешивает onPointerDown вовсе, ноль изменений там.
          // [ID:P-mobile-ws] решение по эдж-кейсу "тап по видео при открытой
          // workspace-панели": ИГНОР, не закрывает панель. Обоснование: (1)
          // лист — non-modal оверлей БЕЗ затемняющего backdrop, видимая часть
          // видео над ним остаётся полноценно интерактивной (play/pause по
          // тапу — обычный жест, который НЕ должен иметь неожиданный побочный
          // эффект "и заодно закрыть панель"); (2) для закрытия уже есть ДВА
          // явных пути (cb-ws-btn тоггл + close-аффорданс сверху листа,
          // WorkspacePanel.tsx `ws-sheet-close`) — третий неявный (tap-outside)
          // добавляет риск случайного закрытия без пользы. onTapStage не
          // трогает timelineCollapsed — только показывает автоскрытые бары.
          onTapStage={mobile ? autoHideControls.show : undefined}
          // Ревью v2a R2-C1: с настоящим iframe тап по видео до onTapStage не доходит —
          // пока бары скрыты, над видео слой-ловушка, тап по нему только их показывает.
          revealCatcher={mobile && !autoHideControls.visible}
        >
          {/* feedback-2 п.3 (владелец, 03:42–03:53): «над субтитрами» — capsule
              якорится в правом верхнем углу видео-канвы (video-vote-bar.css),
              субтитры якорятся снизу (SubtitleOverlay DEFAULT_POSITION y:90%) —
              не перекрываются ни в одной раскладке по умолчанию. */}
          {resumeSec !== null && routeMode.kind === 'confirmed' && (
            <button type="button" className="tb-btn route-resume" data-testid="route-resume"
              onClick={(e) => { e.stopPropagation(); setResumeDismissed(routeMode.puzzleId); runtime.seek(resumeSec) }}>
              Продолжить с {Math.floor(resumeSec / 60)}:{String(Math.floor(resumeSec % 60)).padStart(2, '0')}
            </button>
          )}
          {/* Плеер v2: в режиме маршрута оценка — под видео (блок route-clip-info ниже);
              в полноэкранном режиме и на телефоне боком — здесь, поверх видео. */}
          {!voteInline && !hideVoteForExtra && (
            <VideoVoteBar videoId={videoId} currentTime={playerState.currentTime} duration={playerState.duration} route={routeVote}
              raised={atEnd && !!endVariant} />
          )}
          {atEnd && endVariant && (
            <RouteEndCard variant={endVariant} routeHref={routeHref} busy={nextBusy} listened={clipListened}
              nextTitle={routeMode.kind === 'confirmed' ? routeMode.state.next_clip?.title : undefined}
              onNext={() => { void onEndNext() }}
              onReplay={() => { clearEnded(); setReplayed(true); runtime.seek(0); adapter?.play() }} />
          )}
          {/* P-unplayable: центрированный модал поверх сцены (в отличие от
              VideoVoteBar/субтитров — блокирующий, потому что видео реально
              не играет). onRetry = remountNonce++ (см. выше). onSwitchToNative
              [ID:P-hybrid] — только на iframe-транспорте (переход ТУДА);
              onSwitchToIframe (аудит MED-3 [ID:P-hybrid-audit]) — только на
              native (путь НАЗАД из native-error, снимает sessionStorage-
              залипание). Компонент сам решает, зондировать/показывать ли. */}
          <UnplayableOverlay
            videoId={videoId}
            payload={unplayablePayload}
            onRetry={() => setRemountNonce(n => n + 1)}
            onSwitchToNative={transport === 'iframe' ? switchToNative : undefined}
            onSwitchToIframe={transport === 'native' ? switchToIframe : undefined}
          />
          {/* [ID:P-hybrid]: пока Track B (native) прогревает /api/video/{id}
              (202 warming, см. NativeVideoAdapter.ts), голое видео-полотно
              выглядело бы как мёртвый экран — тот же принцип "не мёртвый
              экран", что уже применён к unplayable-эвристике. Гасим на
              unplayablePayload — тексты не должны накладываться друг на друга. */}
          {transport === 'native' && playerState.buffering && !unplayablePayload && (
            <div
              data-testid="native-warmup-hint"
              style={{
                position: 'absolute', inset: 0, zIndex: 60, pointerEvents: 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <div style={{
                padding: '10px 16px', borderRadius: 8, background: 'rgba(0,0,0,0.55)',
                color: 'var(--fg, #f5f6f8)', fontSize: 14, fontWeight: 600,
                fontFamily: 'var(--mono-font, "IBM Plex Mono", ui-monospace, monospace)',
              }}>
                Готовим видео, до пары минут…
              </div>
            </div>
          )}
          <SubtitleOverlay cues={cues} activeIndex={activeIndex} mode={shownMode} suppressed={inMuteRegion} onWordClick={onSubtitleWordClick} onPlateContextMenu={gateRuHidden ? undefined : (x, y) => openTranslateMenu(activeIndex, x, y)} onTranslateLine={gateRuHidden ? undefined : () => onTranslateLine(activeIndex, 'plate')} translateBusy={plateTranslateBusy} showCapsule={!gateRuHidden && plateShowCapsule} blur={gateBlur} onWordsRevealed={onWordsRevealed} />
          <SubtitleL1Overlay cues={cues} activeIndex={activeIndex} mode={shownMode} suppressed={inMuteRegion} ruByIndex={translatedRu} revealedByIndex={revealedByIndex} ruHidden={gateRuHidden} />
          {subsWarning && !endCardShown && (
            <SubsFirstPassWarning
              onKeep={() => setSubsWarning(null)}
              onShow={() => {
                const m = subsWarning
                ackSubsWarning(gatePuzzleId)
                setSubsWarning(null)
                setMode(m)
                setAckTick(n => n + 1)
              }}
            />
          )}
          {/* sr-only live-region: анонсирует появившийся капсульный перевод. Живёт
              постоянно (иначе свежесозданный live-region не анонсируется). tabIndex=-1
              — капсула размонтируется после reveal, переносим фокус СЮДА (не на body). */}
          <div ref={revealRegionRef} tabIndex={-1} role="status" aria-live="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', outline: 'none' }}>{revealMsg}</div>
          <CountdownOverlay value={ws.countdownValue} onStop={ws.stopLoop} />
          {/* S3-3: video-overlay mount of the runtime's hold/eval/verdict render-state
              (S3-2 plumbed the state, nothing rendered it yet). Dormant until a future
              arm-trigger (S key = S3-6) actually drives `holding`/`evalOverlayVisible`/
              `verdictOutcome` — until then all four stay at their S3-2 initial falsy
              values, so ShadowHoldOverlay's own early-returns (see that file) keep this
              a no-op for an ordinary, non-shadowing user. */}
          <ShadowHoldOverlay
            holding={runtime.holding}
            evalVisible={runtime.evalOverlayVisible}
            verdictOutcome={runtime.verdictOutcome}
            verdictTargetSnapshot={runtime.verdictTargetSnapshot}
            // ТЗ №6 п.6 [ID:P-tz6]: карта видима (armed && !collapsed) → она сама
            // рисует persistent-B1; над-видео вердикт-слот НЕ дублируем (был «серой
            // дрянью вне карты»). Свёрнут таймлайн (карта скрыта) → слот остаётся.
            cardVisible={shadowState.active && !timelineCollapsed}
          />
        </PlayerRoot>
        {adapter && (
          <VideoControlsBar
            adapter={adapter}
            state={playerState}
            ws={ws}
            // S3-5: scrub-bar pointer-up — user-сик, маршрут через runtime.seek.
            // seekTracked оборачивает его телеметрией rewind (перемотка назад).
            seek={seekTracked}
            // rate_change (телеметрия): снижение скорости = «слишком быстро».
            onRateChange={(r) => track('rate_change', { video_id: videoId, route_goal: routeGoal, rate: r, timecode: round2(playerState.currentTime) })}
            onFullscreen={() => fsRef.current?.toggleFullscreen()}
            // T4-ревью: бар не пишет в adapter.mute()/unmute() напрямую — только тоггл
            // ручного интента manualMuted, единственный писатель в адаптер = useMuteDriver.
            onToggleMute={() => setManualMuted(m => !m)}
            // [ID:P-mobile]: тонкий автоскрывающийся оверлей на мобиле (см.
            // useAutoHideControls doc) + кнопка bottom-sheet workspace —
            // единственный источник правды для открытия/закрытия остаётся
            // timelineCollapsed (тот же стейт, что Exit/Z-хоткей/timeline-reopen
            // на десктопе), эта кнопка — просто ещё один тумблер поверх него.
            mobile={mobile}
            visible={autoHideControls.visible}
            onScrubbingChange={autoHideControls.setDragging}
            onToggleWorkspace={mobile ? () => setTimelineCollapsed(c => !c) : undefined}
            workspaceOpen={!timelineCollapsed}
          />
        )}
        {!mobile && routeInfo}
        {!timelineCollapsed ? (
          <WorkspacePanel
            ws={ws}
            cues={cues}
            // §4.7: на первом проходе ролика маршрута дорожка SUB без текста реплик.
            hideCueText={forcedBlur(gateFacts)}
            adapter={adapter}
            // [ID:P-mobile-ws] BUG-2: same detector as VideoControlsBar's
            // `mobile` prop — gates ONLY the bottom-sheet's own close
            // affordance (rendered top-of-sheet). Desktop unaffected.
            mobile={mobile}
            // S3-5: timeline scrub/handle-drag/±5s + cue-click — user-сик, маршрут через runtime.seek.
            seek={runtime.seek}
            activeIndex={activeIndex}
            // Шлюз ручки /v1/youtube/waveform не имеет (всегда 404) — пиков нет, состояние «нет волны» постоянное.
            waveform={null}
            variant={variant}
            currentTime={playerState.currentTime}
            playing={!playerState.paused}
            // A7: с драйвером playerState.muted отражает фактический mute (регионы + ручной),
            // AUD-лейбл вешаем на ручной интент (desktop-паритет index.tsx:2843-2864).
            muted={manualMuted}
            onToggleMute={() => setManualMuted(m => !m)}
            muteRegions={muteApi.muteRegions}
            onToggleMuteRegion={muteApi.toggleRegion}
            onDeleteMuteRegion={muteApi.deleteRegion}
            // T4: канон-инвариант — onToggleLoop бьёт по ЖИВОМУ ws, не по снапшоту.
            onToggleLoop={() => (ws.looping ? ws.stopLoop() : ws.setABLoop(ws.rangeStart, ws.rangeEnd))}
            // [ID:P-subtitle-translate] — пилюля «Перевести» рядом с Shadowing.
            onTranslate={() => doTranslate(translateSelection, { flipMode: true })}
            translatePlural={translatePlural}
            translateDisabled={translateDisabled}
            translateTitle={translateTitle}
            onCueContextMenu={openTranslateMenu}
            translateMenuOpen={translateMenu !== null}
            // Срез A (п.1): пилюля «Шадоуинг» оживлена. shadowActive подсвечивает
            // её и меняет title (Старт/Стоп). onToggleShadow — единый toggle
            // (неактив→arm-путь S; актив→deactivateShadow). Наличие onToggleShadow
            // снимает гейт `{onToggleShadow && …}` (WorkspacePanelThemed:2811),
            // прятавший кнопку после ретайра V1.
            shadowActive={shadowState.active}
            onToggleShadow={onToggleShadow}
            onToggleDictation={() => showToast('Скоро')}
            onStartPuzzle={() => showToast('Скоро')}
            // S3-4 (#5): forward shadowExercises + CRUD from runtime.annotations
            // (S3-1/S3-2's useAnnotations instance) through to the Themed exercise
            // lane. For an ordinary user this array is empty (no exercises exist
            // until S3-6/S3-7 create them) — WorkspacePanel/Themed's own
            // `shadowExercises && shadowExercises.map(...)` renders nothing for an
            // empty array, so the timeline is unchanged (DORMANT-safe, S3-2 lesson).
            shadowExercises={runtime.annotations.shadowExercises}
            onExerciseClick={onExerciseClick}
            onExerciseDelete={runtime.annotations.deleteShadowExercise}
            onExerciseUpdate={runtime.annotations.updateShadowExercise}
            // ТЗ №3 п.4: settingsRow ушёл из карты в бар — рендерим его между
            // транспортом и пилюлями ТОЛЬКО пока shadow активен (те же снимок
            // ShadowState + 3-канальные хендлеры, что раньше шли в карту).
            trainingInlinePanel={shadowState.active ? (
              <ShadowSettingsRow
                settings={{
                  advanceEnabled: shadowState.advanceEnabled,
                  advanceThreshold: shadowState.advanceThreshold,
                  mode: shadowState.mode,
                  loopMode: shadowState.loopMode,
                }}
                onAdvanceEnabledChange={onAdvanceEnabledChange}
                onAdvanceThresholdChange={onAdvanceThresholdChange}
                onModeChange={onModeChange}
                onLoopModeChange={onLoopModeChange}
              />
            ) : undefined}
            // T2-ревью: десктоп-канон — Exit (как и хоткей Z) — это ЧИСТЫЙ visibility
            // flip, а не деактивация лупа. Прошлый спринт компенсировал отсутствие
            // suspend-гейта через ws.stopLoop() здесь (луп терялся при Exit, но не при
            // Z — асимметрия). Теперь enforcementSuspended=timelineCollapsed,
            // переданный в useWorkspace выше, сам приостанавливает driver, пока панель
            // скрыта — looping остаётся true и оживает при reopen.
            onExit={() => setTimelineCollapsed(true)}
          />
        ) : (
          <button
            className="timeline-reopen"
            data-testid="timeline-reopen"
            onClick={() => setTimelineCollapsed(false)}
          >▸ Таймлайн</button>
        )}
        {/* Срез A: полная ShadowCard, оживлённая проводка. Показ по RUNTIME-active
            (`shadowState.active`, flip через activate-on-arm), гейт
            `!timelineCollapsed` держит карту у видимой панели (collapse → карта
            скрыта, пилюля рефлектит active). Дормант: обычный юзер не трогает
            shadowing → active false → карта не монтируется, ноль регрессии.
            Проводка: handsFree (п.5 — «Стоп»→deactivateShadow, без «Записать»);
            customText → runtime.setCustomText (п.3); bind-колбэки → реальный
            персист в useAnnotations (п.2); крестик × карты → deactivateShadow
            (единый путь п.9). */}
        {shadowState.active && !timelineCollapsed && (
          <ShadowCard
            shadow={shadowCardData}
            handsFree
            customText={shadowState.customText}
            onSetCustomText={runtime.setCustomText}
            // HIGH-2: textarea пишет через этот путь (БЕЗ мод-флипа); onSetCustomText
            // (=runtime.setCustomText, clear→subtitle) остаётся за right-click-меню.
            onCustomTextInput={onCustomTextInput}
            onBindOff={onBindOff}
            onBindToSubtitle={onBindToSubtitle}
            onBindToTime={onBindToTime}
            onAnchorDrop={onAnchorDrop}
            bindTC={bindTC}
            setShadowState={setShadowState}
            // Срез A (L-6): сид локального bind-стейта карты из канонического
            // shadowState.bind (INITIAL_SHADOW_STATE.bind='subStart') — иначе
            // после remount подсветка сегмент-контрола врала ('off').
            initialBind={shadowState.bind}
            // ТЗ №3 п.4: settingsRow ушёл в бар (trainingInlinePanel выше). `settings`
            // ОСТАЁТСЯ проп карты, но теперь гейтит ТОЛЬКО custom-режим targetPanel
            // (mode==='custom' → textarea). Доставка живёт в ShadowSettingsRow-хендлерах.
            settings={{
              advanceEnabled: shadowState.advanceEnabled,
              advanceThreshold: shadowState.advanceThreshold,
              mode: shadowState.mode,
              loopMode: shadowState.loopMode,
            }}
            // Срез D: живой partial из RealtimeAnswerSource (пусто в Fake-режиме).
            // Карта показывает его в dashed-блоке поверх плейсхолдера/lastSpoken.
            partialText={partialText}
            // ТЗ №2 [ID:P-hotfix-quota-ux]: баннер недоступности (quota/сервис).
            unavailableNotice={unavailableNotice}
          />
        )}
        {/* Session mic-consent prompt (owner decision 2026-07-10). Shown ONLY when
            an autostart-arm set consent to 'pending' in realtime, near the card.
            "Начать" grants (mic opens via the reconcile gate, prompt disappears);
            "Не сейчас" declines — deactivateShadow() tears the arm down and the
            reducer suppresses re-arm inside the region; 'declined' stays in React
            (never persisted) so no re-prompt this session, but a new tab asks
            again. Fake/realtime-off never reaches 'pending', so this never renders. */}
        {shadowRealtimeEnabled && micConsent === 'pending' && shadowState.active && !timelineCollapsed && (
          <div
            data-testid="shadow-mic-consent"
            role="dialog"
            aria-label="Разрешение микрофона"
            style={{
              position: 'fixed', left: '50%', bottom: 96, transform: 'translateX(-50%)',
              zIndex: 60, display: 'flex', alignItems: 'center', gap: 12,
              padding: '10px 14px', borderRadius: 12,
              background: 'var(--panel, #1e2530)', color: 'var(--fg, #e2e8f0)',
              border: '1px solid var(--accent, #E8B84A)',
              boxShadow: '0 6px 22px rgba(0,0,0,0.5)', fontSize: 14,
            }}
          >
            <span>Начать практику с микрофоном?</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                data-testid="shadow-mic-consent-accept"
                onClick={grantMicConsent}
                style={{
                  padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
                  background: 'var(--accent, #E8B84A)', color: '#1a1a1a', fontWeight: 600,
                }}
              >Начать</button>
              <button
                type="button"
                data-testid="shadow-mic-consent-dismiss"
                onClick={() => { setMicConsent('declined'); deactivateShadow() }}
                style={{
                  padding: '6px 14px', borderRadius: 8, cursor: 'pointer',
                  background: 'transparent', color: 'var(--fg, #e2e8f0)',
                  border: '1px solid var(--border, #3a4453)',
                }}
              >Не сейчас</button>
            </div>
          </div>
        )}
        <SettingsDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          mode={shownMode}
          onMode={requestMode}
        >
          {/* enHidden — первый проход ролика маршрута (прод 2026-11-19, ревью M-1):
              панель не печатает английский транскрипт и поиск выключен, как
              дорожка SUB таймлайна (hideCueText). Гость и засчитанный ролик — как раньше. */}
          <SubtitleSearch cues={cues} onPick={selectCue} ruHidden={gateRuHidden} enHidden={forcedBlur(gateFacts)} />
          <CueList cues={cues} activeIndex={activeIndex} onSelect={selectCue} ruByIndex={translatedRu} onCueContextMenu={openTranslateMenu} onTranslateLine={(i) => onTranslateLine(i, 'list')} translateBusy={translateBusy} ruHidden={gateRuHidden} enHidden={forcedBlur(gateFacts)} />
        </SettingsDrawer>
        {/* T1a [ID:P-video-chat]: попап у слова — рендерится ТОЛЬКО пока
            wordPopup не null (клик по слову субтитра, см. onSubtitleWordClick
            выше). position:fixed внутри WordPopup — ставим сразу viewport-
            координаты из rect клика, конвертация под .fs-root не нужна. */}
        {wordPopup && (
          <WordPopup
            word={wordPopup.word}
            position={wordPopup.position}
            onExamples={kind => {
              videoChat.requestExamples(wordPopup.word, kind)
              setWordPopup(null)
            }}
            onClose={() => setWordPopup(null)}
          />
        )}
        {/* T1a: «Чат: Видео» — десктоп: правый drawer (video-chat-panel.css,
            паттерн .settings-drawer); мобила: fullscreen-оверлей поверх видео
            (@media pointer:coarse в том же файле). Film-карточка ("play") —
            заглушка T1b: тот же showToast('Скоро'), что уже применяется к
            onToggleDictation/onStartPuzzle (WorkspacePanel ниже) — ручки
            puzzle-cache-стриминга клипа пока нет. */}
        <VideoChatPanel
          open={videoChat.state.open}
          word={videoChat.state.word}
          status={videoChat.state.status}
          items={videoChat.state.items}
          errorMessage={videoChat.state.errorMessage}
          onClose={videoChat.close}
          onFilmPlay={() => showToast('Скоро')}
        />
      </FullscreenContainer>
      {mobile && routeInfo}
      {subsStatus === 'no_subtitles' && <div className="player-note">Субтитры недоступны для этого видео.</div>}
      {/* [ID:P-subs-503]: 'unavailable' (503) ≠ 'no_subtitles' (404) — временная
          недоступность egress-пула, не «у видео нет субтитров». retrying=true,
          пока хук ещё поллит короткий retry_after внутри окна сессии (см.
          SUBS_POLL_CAP/SUBS_POLL_WINDOW в useSubtitles.ts); false — гейтвей
          сказал ждать часами (или окно поллинга истекло) — честно сдаёмся. */}
      {subsStatus === 'unavailable' && (
        <div className="player-note">
          {subsRetrying
            ? 'Субтитры временно недоступны, скоро попробуем ещё'
            : 'Субтитры временно недоступны, попробуйте позже'}
        </div>
      )}
      </div>
      </div>
      <MiniToast msg={toastMsg} />
      {/* [ID:P-subtitle-translate] ПКМ-меню «Перевести блок(и)». Цель и лейбл
          считаются на КЛИК/рендер (activeIndex/луп могли сдвинуться при открытом
          меню, Fable commit-4 caution-b). disabled — только busy (у блока всегда
          есть окно, в отличие от пилюли). */}
      <TranslateMenu
        state={gateRuHidden ? null : translateMenu}
        disabled={translateBusy}
        label={
          translateMenu && isPluralLabel(menuTargetIndices(translateSelection, translateMenu.cueIndex).length)
            ? (t('player.translateLabelPlural') || 'Перевести блоки субтитров')
            : (t('player.translateBlock') || 'Перевести блок')
        }
        onTranslate={(cueIndex) => doTranslate(menuTargetIndices(translateSelection, cueIndex), { flipMode: true })}
        onClose={closeTranslateMenu}
      />
    </div>
  )
}
