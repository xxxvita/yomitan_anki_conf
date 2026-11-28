import { useCallback, useMemo } from 'react'
import type { PlayerAdapter } from '../../adapter/PlayerAdapter'
import type { WorkspaceApi } from '../hooks/useWorkspace'
import type { Cue as SubtitleCue } from '../hooks/useSubtitles'
import { WorkspacePanelThemed } from './WorkspacePanelThemed'
import { buildDuskPlayerTheme, type DuskVariant } from './theme/dusk'
import { toWorkspaceState, toPanelCues } from './panel-map'
import type { MuteRegion } from './mute-regions'
import type { RecordingEntry } from './api-types'
import type { WorkspacePanelProps } from './types'
import type { ShadowExerciseAnnotation } from './panel-types'

// WEB-SEAM: @keyframes slideUp + wsReconnectPulse live in desktop index.tsx's
// inline <style>, not in the panel file. Re-inject them here or the panel's
// slide-up animation silently no-ops.
const KEYFRAMES = `
@keyframes slideUp { from { transform: translateY(8px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
@keyframes wsReconnectPulse { 0%,100% { opacity: 1 } 50% { opacity: 0.4 } }
`

export function WorkspacePanel(props: {
  ws: WorkspaceApi
  cues: SubtitleCue[]
  adapter: PlayerAdapter | null
  // S3-5: маршрут user-сиков (timeline scrub/handle-drag/±5s/cue-click) через
  // useShadowRuntime's observedSeek (carry T4/F3 forward-escape). Опционален,
  // без него падает на adapter.seek — байт-в-байт прежнее поведение
  // (транспарентность для caller'ов без runtime + существующих тестов).
  seek?: (t: number) => void
  activeIndex: number
  waveform: { peaks: number[]; windowMs: number } | null
  variant: DuskVariant
  currentTime: number
  playing: boolean // из playerState.paused — реактивно, не adapter.paused() per-render (S-I5)
  muted: boolean // A5: реактивный playerState.muted; с A7-драйвером отражает mute-регионы + ручной интент
  // A7: родитель владеет ручным mute-интентом (manualMuted) — панель больше не пишет в адаптер.
  onToggleMute?: () => void
  muteRegions?: MuteRegion[]
  onToggleMuteRegion?: (id: string) => void
  onDeleteMuteRegion?: (id: string) => void
  // T4: canon pill callbacks — parent (PlayerPage) owns the real logic
  // (onToggleLoop drives the LIVE ws, not a snapshot; the training pills are
  // stubs that show a "Скоро" toast; onExit collapses the timeline panel).
  onToggleLoop?: () => void
  onToggleShadow?: () => void
  onToggleDictation?: () => void
  onStartPuzzle?: () => void
  onExit?: () => void
  // [ID:P-subtitle-translate] — пилюля «Перевести» (проброс к WorkspacePanelThemed).
  onTranslate?: () => void
  translatePlural?: boolean
  translateDisabled?: boolean
  translateTitle?: string
  onCueContextMenu?: (cueIndex: number, x: number, y: number) => void
  translateMenuOpen?: boolean
  // T5: shadowing V1 wiring — activation state + attempts/recordings for the
  // YOU track + recording-select/delete. All of these already exist on
  // WorkspacePanelProps (WorkspacePanelThemed's prop type) — this thin
  // wrapper only needs to forward them through.
  shadowActive?: boolean
  shadowAttempts?: WorkspacePanelProps['shadowAttempts']
  recordings?: RecordingEntry[]
  recordingsForCombo?: RecordingEntry[]
  onSelectYouRecording?: (id: string) => void
  onDeleteYouRecording?: (id: string, filename: string) => void
  // S3-4: exercise-lane forwarding (T6 built the lane in WorkspacePanelThemed,
  // this wrapper never carried the props to it). shadowExercises undefined/[]
  // → WorkspacePanelThemed's `shadowExercises && shadowExercises.map(...)`
  // renders zero elements (no wrapping lane div reserves space either) — so a
  // non-shadowing user's timeline is byte-for-byte the same as before this
  // task (DORMANT-safety, S3-2 lesson). onExerciseClick here is SELECT only
  // (Themed already owns the visual `selectedExerciseId` internally and calls
  // this prop only as an extra notification hook) — arm-on-select lands in
  // S3-6 (S-key), not here.
  shadowExercises?: ShadowExerciseAnnotation[]
  onExerciseClick?: WorkspacePanelProps['onExerciseClick']
  onExerciseDelete?: WorkspacePanelProps['onExerciseDelete']
  onExerciseUpdate?: WorkspacePanelProps['onExerciseUpdate']
  // ТЗ №3 п.4 — Shadowing settings-row slot forwarded to the bar (active-only).
  trainingInlinePanel?: WorkspacePanelProps['trainingInlinePanel']
  // [ID:P-mobile-ws]: PlayerPage's единственный useCoarsePointer() детектор,
  // тот же прототип, что VideoControlsBar's `mobile` (см. его доку) — гейтит
  // ТОЛЬКО JS-рендер close-аффорданса ниже (bottom-sheet header), никакой
  // визуал/позиционирование самой панели тут не решается (это чистый CSS —
  // .workspace-lift под @media(pointer:coarse) в app.css). Десктоп (mobile
  // не передан/false) не рендерит ни один новый узел — байт-в-байт прежний DOM.
  mobile?: boolean
  // hideCueText — первый проход ролика маршрута (спека кабинета §4.7 п.1–2, п.4):
  // пока субтитры скрыты или размыты гейтом, дорожка SUB не печатает текст
  // реплик (живая проверка на проде 2026-11-19: «Teresa go …» читалось открыто
  // под скрытыми субтитрами). Блоки реплик с их временем остаются — клик по
  // блоку, диапазон A-B и шадоуинг работают как раньше. Не передан — прежний вид.
  hideCueText?: boolean
}) {
  // PLAN-BUG FIX: `activeIndex` kept in the prop type for call-site API parity
  // with the old <Timeline> (PlayerPage still passes it), but WorkspacePanelThemed
  // derives the active cue from `currentTime` internally and never reads an
  // index prop — destructuring it here would trip noUnusedLocals.
  const {
    ws, cues, adapter, seek, waveform, variant, currentTime, playing, muted,
    onToggleMute, muteRegions, onToggleMuteRegion, onDeleteMuteRegion,
    onToggleLoop, onToggleShadow, onToggleDictation, onStartPuzzle, onExit,
    onTranslate, translatePlural, translateDisabled, translateTitle, onCueContextMenu, translateMenuOpen,
    shadowActive, shadowAttempts, recordings, recordingsForCombo,
    onSelectYouRecording, onDeleteYouRecording,
    shadowExercises, onExerciseClick, onExerciseDelete, onExerciseUpdate,
    trainingInlinePanel, mobile, hideCueText,
  } = props
  // S3-5: единый резолв — doSeek зовёт переданный runtime.seek/observedSeek,
  // а без него (caller ещё не поднял runtime, старые тесты) падает на
  // adapter.seek — байт-в-байт прежнее поведение.
  const doSeek = useCallback((t: number) => { (seek ?? ((tt: number) => adapter?.seek(tt)))(t) }, [seek, adapter])
  const theme = useMemo(() => buildDuskPlayerTheme(variant), [variant])
  // PLAN-BUG FIX (brief WebCue = {start,end,text} vs actual useSubtitles.Cue =
  // {start,end,text_en,text_ru}): web subtitle cues have no `.text` field, so
  // map text_en (the L2/target-language line, same source CueBlocks used to
  // read before deletion) into the `.text` slot toPanelCues expects.
  const panelCues = useMemo(
    () => toPanelCues(cues.map(c => ({ start: c.start, end: c.end, text: hideCueText ? '' : c.text_en }))),
    [cues, hideCueText],
  )
  const workspace = toWorkspaceState(ws)

  const getTime = useCallback(() => adapter?.currentTime() ?? 0, [adapter])
  const onSeek = useCallback((t: number) => { doSeek(t) }, [doSeek]) // panel owns loop-off via onSetLooping
  const onSetLooping = useCallback((next: boolean) => { if (!next) ws.stopLoop() }, [ws])
  // T4: onToggleLoop теперь передаётся — канон живёт в PlayerPage против ЖИВОГО ws
  // (looping ? ws.stopLoop() : ws.setABLoop(ws.rangeStart, ws.rangeEnd)), не снапшота.
  // Десктопный toggleLoop (toggle на текущем [A,B]) и ws.toggleABLoop(cueIdx)
  // (перецеливание range на cue) — разная семантика, поэтому канон живёт у родителя,
  // а не здесь.
  const onCueClick = useCallback((idx: number, shift: boolean, clickTime?: number, ctrl?: boolean) => {
    const c = cues[idx]; if (!c || !adapter) return
    // WEB-SEAM: Ctrl+click re-targets the A-B range onto this single cue
    // (owner 3:02-3:52). Must run before the inside-[A,B] seek branch below.
    if (ctrl) { ws.setRange(c.start, c.end); doSeek(c.start); return }
    if (shift) { ws.setRange(Math.min(ws.rangeStart, c.start), Math.max(ws.rangeEnd, c.end)); return }
    const inside = ws.rangeEnd > ws.rangeStart && clickTime != null && clickTime >= ws.rangeStart && clickTime <= ws.rangeEnd
    if (inside) { doSeek(clickTime!) }
    else { ws.setRange(c.start, c.end); doSeek(c.start) }
  }, [cues, adapter, ws, doSeek])

  const noop = useCallback(() => {}, [])

  return (
    // [ID:P-mobile-ws] BUG-1 fix: `position` used to be forced inline to
    // 'relative' here, unconditionally — an inline style ALWAYS wins over any
    // stylesheet rule regardless of specificity/media query, so it silently
    // defeated app.css's `.workspace-lift { position: absolute; … }` under
    // `@media (pointer: coarse)` (that rule was dead code — never actually
    // applied). Result on a real phone: the "mobile bottom-sheet" panel
    // stayed `position: relative` = IN FLOW, stealing ~205px of height from
    // the flex column (.player-stage shrank 744px→539px on prod), collapsing
    // the video to a strip in landscape (owner-reported "переворот уменьшает
    // видео"). Dropping the inline override lets the cascade decide: the
    // base (non-media) `.workspace-lift` rule in app.css already sets
    // `position: relative` for desktop — byte-identical desktop behaviour —
    // while the `@media (pointer: coarse)` rule now actually takes effect on
    // mobile (`position: absolute`, bottom-pinned, out of flow, over the
    // video instead of squeezing it).
    <div className="workspace-lift" style={{ ...(theme.cssVars ?? {}) }}>
      <style>{KEYFRAMES}</style>
      {mobile && (
        // BUG-2 fix: cb-ws-btn (VideoControlsBar) already toggles this panel
        // open/closed (PlayerPage's timelineCollapsed), but the bottom-sheet
        // itself carried no visible close affordance of its own — on a real
        // phone the ONLY way to shut it was to find that thin control-bar
        // button again, buried under an autohidden, coarse-pointer-only bar
        // (owner-reported "кнопки убрать нашу панельку нет"). Native
        // bottom-sheet convention: a drag-handle/"collapse" affordance lives
        // at the TOP of the sheet, always reachable without scrolling the
        // (potentially tall) SUB/AUD track content beneath it — `position:
        // sticky` keeps it pinned while `.workspace-lift`'s own
        // `overflow-y: auto` scrolls the rest. Same `onExit` the desktop
        // Exit pill (WorkspacePanelThemed, bottom of the transport row) and
        // Z/Exit hotkey already use — ONE state (workspaceOpen/
        // timelineCollapsed in PlayerPage), not a second parallel flag.
        <button
          type="button"
          className="ws-sheet-close"
          data-testid="ws-sheet-close"
          onClick={onExit}
          aria-label="Свернуть панель упражнений"
          title="Свернуть панель упражнений"
        >
          <span className="ws-sheet-handle" aria-hidden="true" />
          Свернуть ▾
        </button>
      )}
      {/* WEB-SEAM: клип-контейнер таймлайна (fb#6, десктоп-канон
          anki_conf .../VideoPlayerPanel/index.tsx:3718 = overflow:hidden на видео-зоне).
          В вебе панель = вся ширина .fs-root, поэтому вместо hidden берём
          overflow-x:clip + overflow-y:visible (клип ТОЛЬКО по X: вертикальный выступ
          печатей A/Б и playhead-caps над баром сохранён; спец: пара {clip,visible}
          не деградирует, обе оси в множестве {visible,clip}). Асимметричный
          margin/padding-трюк сдвигает клип-бокс по X в [X0−40, X1]: правый край = край
          панели (cue/палки за 100% срезаны), слева +40px запаса под gutter-лейблы на
          left:-38 (X0−20, pointerEvents:none — сохранены). marginLeft:-40 гасится
          paddingLeft:40 → панель визуально не двигается. TrackCombo/RegionMenu — портал
          в body, клипом не задеты. */}
      <div
        data-timeline-clip=""
        style={{
          position: 'relative',
          marginLeft: -40, marginRight: 0,
          paddingLeft: 40, paddingRight: 0,
          overflowX: 'clip',
          overflowY: 'visible',
        }}
      >
      <WorkspacePanelThemed
        theme={theme}
        workspace={workspace}
        cues={panelCues}
        currentTime={currentTime}
        getTime={getTime}
        duration={adapter?.duration() ?? 0}
        playing={playing}
        muted={muted}
        offset={0}
        getEffectiveStart={(_i, startTime) => startTime}
        getEffectiveEnd={(_i, endTime) => endTime}
        onSetRange={(a, b) => ws.setRange(a, b)}
        onSetView={(s, e) => ws.setView(s, e)}
        onZoom={(f, anchor) => ws.zoom(f, anchor)}
        onFitToRange={() => ws.fitToRange()}
        onSeek={onSeek}
        onSetLooping={onSetLooping}
        onSetPauseAtEnd={(n) => ws.setPauseAtEnd(n)}
        onCueClick={onCueClick}
        onHandleClick={noop}
        // A7: wrapper больше не пишет в адаптер — родитель (manualMuted) владеет интентом,
        // rAF-драйвер (useMuteDriver) — единственный писатель adapter.mute()/unmute().
        onToggleMute={onToggleMute ?? noop}
        onPlayPause={() => ws.onPlayCommand()}
        onExit={onExit ?? noop}
        shadowActive={shadowActive ?? false}
        // S3-7-fix: no more `?? noop` fallback — WorkspacePanelThemed now
        // gates the pill's render on this prop being present (see its own
        // comment), so passing a synthetic noop here would defeat the gate
        // and keep rendering the retired, permanently-inert pill.
        onToggleShadow={onToggleShadow}
        onToggleDictation={onToggleDictation}
        onStartPuzzle={onStartPuzzle}
        onToggleLoop={onToggleLoop}
        onTranslate={onTranslate}
        translatePlural={translatePlural}
        translateDisabled={translateDisabled}
        translateTitle={translateTitle}
        onCueContextMenu={onCueContextMenu}
        translateMenuOpen={translateMenuOpen}
        waveform={waveform}
        muteRegions={muteRegions}
        onToggleMuteRegion={onToggleMuteRegion}
        onDeleteMuteRegion={onDeleteMuteRegion}
        // onCreateMuteRegion НЕ передаём — G-drag-создание регионов = P4 (не в этом скоупе)
        shadowAttempts={shadowAttempts}
        recordings={recordings}
        recordingsForCombo={recordingsForCombo ?? recordings}
        onSelectYouRecording={onSelectYouRecording}
        onDeleteYouRecording={onDeleteYouRecording}
        shadowExercises={shadowExercises}
        onExerciseClick={onExerciseClick}
        onExerciseDelete={onExerciseDelete}
        onExerciseUpdate={onExerciseUpdate}
        trainingInlinePanel={trainingInlinePanel}
      />
      </div>
    </div>
  )
}
