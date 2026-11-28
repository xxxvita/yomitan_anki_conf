// web/src/player/hooks/useWorkspace.ts
// REWRITE под poll-часы YouTube IFrame. Loop-ядро (A-B / line) + rAF-драйвер
// границы поверх adapter.currentTime() (интерполяция clock-shim). Pause-at-end
// и отсчёт добавляются в Task 4 (reachBoundary дополняется).
// В Task 3 отсчёт НЕ используется → из useCountdown берём только value+cancel
// (иначе unused startCountdown упадёт под noUnusedLocals, если запустить tsc
// между Task 3 и Task 4). start добавляется в Task 4.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PlayerAdapter } from '../../adapter/PlayerAdapter'
import { useCountdown } from './useCountdown'
import { boundaryMonitorStep, initialMonitorState, type MonitorState } from '../../lib/boundary-monitor'

// T2-review fix #1: per-field validation for a restored localStorage entry.
// `{"looping":true}` alone used to pass the old `saved && typeof saved === 'object'`
// gate, so setRangeStart(undefined) etc. leaked `undefined`/NaN into seek/zoom math
// (Math.min(dur, undefined) === NaN, and the reachBoundary NaN-guard never catches
// it because it only checks `rangeEnd <= rangeStart`, which is false when one side
// is NaN). Desktop canon (workspace-init.ts computeRestoreParams:62-82) validates
// each field with `typeof x === 'number' && x > 0`-style guards; we mirror that
// shape here as a single reusable predicate.
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

export interface WorkspaceApi {
  rangeStart: number
  rangeEnd: number
  looping: boolean
  pauseAtEnd: number
  countdownValue: number | null
  viewStart: number
  viewEnd: number
  setABLoop(a: number, b: number): void
  toggleABLoop(cueIdx: number): void
  onPlayCommand(): void
  onUserSeek(t: number): void
  setPauseAtEnd(secs: number): void
  stopLoop(): void
  setView(s: number, e: number): void
  zoom(factor: number, anchorT: number): void
  fitToRange(): void
  setRange(a: number, b: number): void
  _boundaryTickForTest(): void
  // T0 (IM9) — coordinator actuators, paritet desktop useWorkspace :493-549.
  /** task #1068 desktop canon: 3·2·1 отсчёт (pauseAtEnd) ПЕРЕД play. Зовётся
   *  координатором на ПЕРВОМ arm упражнения. secs<=0 → play сразу. */
  countdownThenPlay(pauseAtEndOverride?: number): void
  /** Возобновление после grading-паузы на границе (shouldPauseAtBoundary===true,
   *  reachBoundary встал на B). 'advance' → снять петлю, play вперёд (без seek A).
   *  'restart' → seek(A) + отсчёт(pauseAtEnd) + play. */
  resumeFromBoundary(action: 'advance' | 'restart'): void
  /** Атомарно восстановить весь workspace (range/view/loop/pauseAtEnd), клампя
   *  к duration. Паритет desktop restore() — НЕ сикает плейхед (звонящий сикает сам). */
  restoreWorkspace(p: {
    rangeStart: number
    rangeEnd: number
    viewStart: number
    viewEnd: number
    looping: boolean
    pauseAtEnd?: number
    trustExtent?: boolean
  }): void
  /** WEB-SEAM: web не имеет отдельного бита "панель открыта/закрыта" (нет `active`
   *  в WorkspaceApi). Координатор зовёт deactivateWorkspace() вместо restoreWorkspace()
   *  когда прогон стартовал с getWorkspaceSnapshot().active===false (нет реального
   *  AB-диапазона до прогона) — тут это гарантирует нейтраль: луп/отсчёт/failsafe
   *  сняты, диапазон/вид НЕ трогаются (сбрасывать нечего — они уже вырождены). */
  deactivateWorkspace(): void
  /** Снимок для координатора (T2 endRun). `active` СИНТЕЗИРОВАН (WEB-SEAM) как
   *  `rangeEnd > rangeStart` — на web нет отдельного панельного бита `active`. */
  getWorkspaceSnapshot(): WorkspaceSnapshot
}

/** WEB-SEAM: паритет desktop `WorkspaceSnapshot` (useShadowLoopCoordinator.ts:34-42),
 *  но `active` синтезирован — см. getWorkspaceSnapshot(). */
export interface WorkspaceSnapshot {
  rangeStart: number
  rangeEnd: number
  viewStart: number
  viewEnd: number
  looping: boolean
  pauseAtEnd: number
  active: boolean
}

// Мин. отступ ниже B для снятия restartingRef на очень коротких петлях (когда
// (B−A)/2 < этого — берём пол).
const CLEAR_FLOOR = 0.05

export function useWorkspace(
  adapter: PlayerAdapter | null,
  cues: { start: number; end: number }[],
  videoId: string = '',
  enforcementSuspended: boolean = false,
  /**
   * T0 — inbound (coordinator supplies these; T2 wires them from
   * useShadowLoopCoordinator). Paritet desktop useWorkspace :26/:44.
   * Fired once per boundary hit (archive-the-attempt hook), regardless of
   * which branch (native restart vs grading-pause) follows.
   */
  onLoopBoundary?: () => void,
  /**
   * Read SYNCHRONOUSLY at the boundary (must be a ref-backed getter — a
   * plain reactive prop would be stale at the tick that matters, same
   * rationale as desktop :36-43). true → reachBoundary archives (via
   * onLoopBoundary) and PARKS at B (clamp + failsafe, no seek(A)/countdown/
   * play) — hands off to the coordinator's resumeFromBoundary(). false/
   * undefined → native A-B restart (existing web behaviour, unchanged).
   */
  shouldPauseAtBoundary?: () => boolean,
  /**
   * FIX2 (fix-wave review) — paritet desktop useWorkspace :35/:367/:517. Fired at
   * the moment a loop actually RESTARTS (seek(A) + play has just happened), i.e.
   * after both the native reachBoundary restart-finish AND resumeFromBoundary
   * ('restart'). NOT called on 'advance' (no restart happens there) and NOT
   * called from countdownThenPlay (first-arm — desktop :527 explicitly excludes
   * it: rearm is only for repeats). This is a sim only in T0 — T2 wires the
   * loop-recorder to it.
   */
  onLoopRestart?: () => void,
  /**
   * Ожидающий старт из ссылки (/player?t=, ещё не «съеден»). Только для восстановления сохранённой
   * петли: если t вне [A,B) (и ролик длиннее t) — диапазон восстанавливаем, но looping=false —
   * тот же смысл, что у onUserSeek (старт вне петли её выключает). Иначе первый кадр монитора на
   * t ≥ B сам сделал бы pause→seek(A)→play без клика. Читается через ref, не в deps.
   */
  linkStart?: number,
): WorkspaceApi {
  const linkStartRef = useRef(linkStart)
  useLayoutEffect(() => { linkStartRef.current = linkStart }, [linkStart])
  const [rangeStart, setRangeStart] = useState(0)
  const [rangeEnd, setRangeEnd] = useState(0)
  const [looping, setLooping] = useState(false)
  const [pauseAtEnd, setPauseAtEndState] = useState(0)
  const [viewStart, setViewStart] = useState(0)
  const [viewEnd, setViewEnd] = useState(0)
  const { value: countdownValue, start: startCountdown, cancel: cancelCountdown } = useCountdown()

  // Зеркало loop-состояния для чтения из rAF-драйвера/reachBoundary (stale-closure fix).
  // Пишем в useLayoutEffect (commit-safe), а не во время рендера — устраняет весь
  // класс concurrent/StrictMode-рисков; к следующему event-handler/act() свежо.
  const stateRef = useRef({ rangeStart, rangeEnd, looping, pauseAtEnd })
  useLayoutEffect(() => {
    stateRef.current = { rangeStart, rangeEnd, looping, pauseAtEnd }
  }, [rangeStart, rangeEnd, looping, pauseAtEnd])

  // T2-review fix #2: full workspace snapshot (superset of stateRef, adds view*)
  // for the flush-on-switch effect below. Kept in a separate ref (rather than
  // widening stateRef) so reachBoundary/rAF-driver callers are unaffected.
  // I-2: also carries enforcementSuspended so the flush-on-unmount write (which
  // reads only this ref, not the reactive `enforcementSuspended` param) can apply
  // the same "hidden panel = don't persist an active loop" rule as the debounce write.
  const wsSnapshotRef = useRef({ rangeStart, rangeEnd, viewStart, viewEnd, looping, pauseAtEnd, enforcementSuspended })
  useLayoutEffect(() => {
    wsSnapshotRef.current = { rangeStart, rangeEnd, viewStart, viewEnd, looping, pauseAtEnd, enforcementSuspended }
  }, [rangeStart, rangeEnd, viewStart, viewEnd, looping, pauseAtEnd, enforcementSuspended])

  const restartingRef = useRef(false)
  const restartFailsafeRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // T0 (WEB-SEAM, paritet desktop boundarySuppressRef :314): после resumeFromBoundary
  // ('advance') looping flips async (setLooping — React state). Одно-тиковое окно, где
  // stateRef.current.looping ещё true (useLayoutEffect не отработал), могло бы позволить
  // ПОВТОРНЫЙ reachBoundary() (тест-шов _boundaryTickForTest вызван синхронно сразу после,
  // не гейтится restartingRef — resumeFromBoundary уже снял его). boundarySuppressRef
  // блокирует этот конкретный тик; снимается эффектом ниже, когда looping реально false.
  const boundarySuppressRef = useRef(false)
  // T0 (WEB-SEAM, нет аналога на десктопе — специфично для web rAF-драйвера ниже):
  // true, пока мы "припаркованы" на границе (shouldPauseAtBoundary===true, ждём
  // resumeFromBoundary от координатора). Драйверный clearMargin-автосброс restartingRef
  // (ниже) написан для НАТИВНОГО рестарта (seek далеко к A) — при парковке клампим
  // ВСЕГО на rangeEnd-0.1, что может ложно попасть в clearMargin-окно на коротких петлях
  // и снять restartingRef раньше времени (двойной onLoopBoundary/clamp). parkedRef
  // отключает автосброс, пока мы припаркованы — снимается ТОЛЬКО resumeFromBoundary
  // или 15000мс-failsafe.
  const parkedRef = useRef(false)
  // Монитор границы — в ref, чтобы reachBoundary/reset могли его перевзвести (fix B1).
  const monitorRef = useRef<MonitorState>(initialMonitorState)
  // Идемпотентность seed/restore эффекта: хранит videoId, для которого уже был
  // применён init/restore. null = ещё не сидировали (стартовое состояние ИЛИ
  // сброшено reset-эффектом ниже при смене адаптера — иначе guard заблокирует
  // повторный seed на том же videoId и rangeEnd/viewEnd зависнут в нулях, T2 I4).
  const seededRef = useRef<string | null>(null)

  // Clamp конца лупа к длительности видео, когда она известна: суб-дорожка из gateway
  // может быть ДЛИННЕЕ ролика → иначе boundary по rangeEnd за пределами видео никогда
  // не сработает, луп зависнет (fix A1). 'ended'-safety-net ниже — второй эшелон.
  const clampEnd = useCallback((end: number) => {
    const dur = adapter?.duration() ?? 0
    return dur > 0 ? Math.min(end, dur) : end
  }, [adapter])

  // setRange — side-effect-free A/B range setter for handle-drag / rubber-band
  // (Task B6). Unlike setABLoop it does NOT force looping, reset the boundary
  // monitor, or rewind-seek. A3/A6: clamp BOTH ends to [0, dur] with a 0.1s gap
  // (desktop useWorkspace.ts:246-253) — raw minStart/maxEnd from an inverted
  // rubber-band (subs longer than the clip) would otherwise flip the range and
  // make fitToRange compute a negative pad, throwing view/labels off-bar.
  // NB: guard differs from desktop — desktop clamps to duration||60, we clamp to
  // Infinity (preserves existing web convention with clampEnd, not a 1:1 copy).
  const setRange = useCallback((a: number, b: number) => {
    const dur = adapter?.duration() ?? 0
    const cap = dur > 0 ? dur : Infinity
    // WEB-SEAM deviation: desktop-формула (246-253) наследует эту дыру (a,b>dur →
    // инверсия); мы дополнительно капим start — [99.9,100] вместо [150,100].
    const start = Math.max(0, Math.min(Math.min(a, b - 0.1), cap - 0.1))
    const end = Math.min(cap, Math.max(b, a + 0.1))
    setRangeStart(start); setRangeEnd(end)
  }, [adapter])

  const clearRestart = useCallback(() => {
    restartingRef.current = false
    // T0: also release the parked-at-boundary flag — stopLoop/deactivate/adapter-reset
    // must not leave it stuck true (it would be a stale no-op today since it only gates
    // the clearMargin branch while restartingRef is true, but staying strict here avoids
    // relying on that coupling implicitly).
    parkedRef.current = false
    if (restartFailsafeRef.current) { clearTimeout(restartFailsafeRef.current); restartFailsafeRef.current = null }
  }, [])

  const setABLoop = useCallback((a: number, b: number) => {
    const bb = clampEnd(b)
    setRangeStart(a); setRangeEnd(bb); setLooping(true)
    monitorRef.current = initialMonitorState // свежий подход к новой границе
    // rewind-on-enable: watcher ловит только подход к B, поэтому если playhead
    // уже за B — прыгаем на A вручную.
    if (adapter && adapter.currentTime() >= bb) adapter.seek(a)
  }, [adapter, clampEnd])

  const toggleABLoop = useCallback((cueIdx: number) => {
    const cue = cues[cueIdx]
    if (!cue) return
    const end = clampEnd(cue.end)
    const s = stateRef.current
    // line-loop = range-loop с диапазоном в ОДИН cue (не второй движок).
    if (s.looping && s.rangeStart === cue.start && s.rangeEnd === end) {
      setLooping(false) // OFF: флип без снапа, границы остаются закладкой
      return
    }
    setRangeStart(cue.start); setRangeEnd(end); setLooping(true)
    monitorRef.current = initialMonitorState
    // ON: seek(A) только если playhead вне cue
    if (adapter) {
      const t = adapter.currentTime()
      if (t < cue.start || t >= end) adapter.seek(cue.start)
    }
  }, [adapter, cues, clampEnd])

  const onUserSeek = useCallback((t: number) => {
    // auto-disable ТОЛЬКО при user click-seek вне [A,B]; программный seek(A) сюда не идёт
    const s = stateRef.current
    if (s.looping && (t < s.rangeStart || t > s.rangeEnd)) setLooping(false)
  }, [])

  const stopLoop = useCallback(() => {
    setLooping(false)
    cancelCountdown()
    clearRestart() // STOP мид-отсчёта не должен оставлять залипший restartingRef/failsafe
  }, [cancelCountdown, clearRestart])

  const setPauseAtEnd = useCallback((secs: number) => {
    setPauseAtEndState(Math.max(0, Math.min(2.5, secs)))
  }, [])

  const setView = useCallback((s: number, e: number) => {
    const dur = adapter?.duration() || e
    // Десктоп-канон (useWorkspace.ts:255-260): длина фиксируется ИЗ запроса, клампится
    // только позиция — pan у границы «упирается и стоит», а не сжимает вью (баг
    // «колесо зумит без Ctrl у начала ролика», фидбек №4 5:53-9:00).
    const len = Math.min(dur, Math.max(0.1, e - s))
    const ss = Math.max(0, Math.min(s, dur - len))
    setViewStart(ss); setViewEnd(ss + len)
  }, [adapter])

  const zoom = useCallback((factor: number, anchorT: number) => {
    const span = (viewEnd - viewStart) * factor
    const frac = (anchorT - viewStart) / Math.max(1e-6, viewEnd - viewStart)
    setView(anchorT - span * frac, anchorT + span * (1 - frac))
  }, [viewStart, viewEnd, setView])

  const fitToRange = useCallback(() => {
    const pad = (rangeEnd - rangeStart) * 0.15
    setView(rangeStart - pad, rangeEnd + pad)
  }, [rangeStart, rangeEnd, setView])

  // reachBoundary — вызывается драйвером/тест-швом при достижении rangeEnd.
  // Native A-B restart (pause→seek(A)→countdown→play) — ЕСЛИ shouldPauseAtBoundary
  // не гейтит (T0: паритет desktop useWorkspace :320-371 — grading-gate встаёт на B).
  const reachBoundary = useCallback(() => {
    const s = stateRef.current
    if (!s.looping || s.rangeEnd <= s.rangeStart) return // C: только внутри активного лупа
    if (restartingRef.current) return                    // C: идемпотентность (окно «замёрз-за-B» на poll)
    if (boundarySuppressRef.current) return               // T0: advance в полёте — async looping окно
    if (!adapter) return
    restartingRef.current = true
    // Archive попытки на B — в момент достижения границы, ДО ветвления (для grading И нативного).
    onLoopBoundary?.()
    adapter.pause()

    // T0 — G3+G4 grading-gate: хендофф координатору. НЕ seek(A)/countdown/play — стоим
    // у границы (restartingRef true → драйвер не пере-фаерит). Координатор зовёт
    // resumeFromBoundary('advance'|'restart') по вердикту.
    if (shouldPauseAtBoundary?.()) {
      parkedRef.current = true
      // Кламп кадра внутрь отрезка (desktop :334-338): даже при предиктивной паузе держим
      // currentTime < rangeEnd, чтобы кадр не покидал упражнение.
      const clampTo = Math.max(s.rangeStart, s.rangeEnd - 0.1)
      adapter.seek(clampTo)
      // Backstop 15000мс (> координаторского eval-таймаута 10с, десктоп :339-347/:191-195):
      // если координатор не резюмировал — деградируем к restart, а не морозим навсегда.
      if (restartFailsafeRef.current) clearTimeout(restartFailsafeRef.current)
      restartFailsafeRef.current = setTimeout(() => {
        restartFailsafeRef.current = null
        restartingRef.current = false
        parkedRef.current = false
        // FIX1 (fix-wave review): must re-arm the boundary monitor here too, same as
        // the native failsafe (:307-310 below) and the driver's clearMargin autoreset
        // (:341-342). Without this, a short loop (B−A <= 0.25s, i.e. <= REARM_MARGIN
        // in boundary-monitor.ts) degrades to grading-park, the 15s failsafe fires,
        // and monitorRef stays `armed:false` forever — boundaryMonitorStep only
        // re-arms when the boundary itself changes OR cur < boundary-0.25, neither of
        // which a short loop after a fresh seek(A) can satisfy — so the boundary never
        // fires again on subsequent passes.
        monitorRef.current = initialMonitorState
        adapter.seek(stateRef.current.rangeStart)
        adapter.play()
      }, 15000)
      return
    }

    // Нативный A-B рестарт (без оценки, без изменений — Task 3/4 поведение сохранено).
    const secs = Math.max(0, Math.round(s.pauseAtEnd))   // целые; 0 = мгновенно
    adapter.seek(s.rangeStart)                            // seek(A) — ре-буферизация маскируется отсчётом
    const resume = () => { adapter.play(); onLoopRestart?.() } // play — ПОСЛЕ отсчёта; FIX2: rearm sim
    // failsafe: снять restartingRef даже если resume/poll не пришли. Также перевзвести
    // монитор — на случай floor-defeated рестарта (петля ≤ CLEAR_FLOOR).
    if (restartFailsafeRef.current) clearTimeout(restartFailsafeRef.current)
    restartFailsafeRef.current = setTimeout(() => {
      restartingRef.current = false
      monitorRef.current = initialMonitorState
    }, secs * 1000 + 4000)
    if (secs <= 0) resume()                               // 0 → без отсчёта
    else startCountdown(secs, resume)                     // отсчёт AT A
    // restartingRef НЕ снимается здесь — драйвер снимет по polled < B−clearMargin, или failsafe
  }, [adapter, startCountdown, onLoopBoundary, shouldPauseAtBoundary, onLoopRestart])

  // rAF-драйвер границы. КЛЮЧ (fix B1/B2): пока restartingRef=true — границу НЕ мониторим
  // (restartingRef — настоящий гард замёрзшего poll-окна «за B», а не monitor.armed).
  // Снимаем restartingRef, когда polled currentTime опустился ниже B на АДАПТИВНЫЙ отступ
  // min(0.25, (B−A)/2) (seek(A) отражён), и СБРАСЫВАЕМ монитор → перевзвод для любой длины
  // петли: короткие петли ≤0.25с больше не умирают после первого цикла.
  // T2-review fix: десктоп-канон (useWorkspace.ts:384): скрытая панель приостанавливает
  // enforcement лупа, не сбрасывая looping — reopen восстанавливает как было.
  useEffect(() => {
    if (!adapter || !looping || enforcementSuspended) return
    let raf = 0
    let prevWall = performance.now()
    const tick = () => {
      const s = stateRef.current
      const now = performance.now()
      const dtMs = Math.min(100, Math.max(1, now - prevWall)) // кламп сверху: stall в фоне не должен раздувать lookahead (L2)
      prevWall = now
      const cur = adapter.currentTime()
      if (restartingRef.current) {
        // T0: пока припаркованы на границе (grading-gate) — НЕ автосбрасывать
        // restartingRef по clearMargin (это детектор "seek(A) отражён в polled",
        // не применим к парковке-у-B). Освобождает только resumeFromBoundary
        // или 15000мс-failsafe в reachBoundary.
        if (!parkedRef.current) {
          const clearMargin = Math.min(0.25, Math.max(CLEAR_FLOOR, (s.rangeEnd - s.rangeStart) * 0.5))
          if (cur < s.rangeEnd - clearMargin) {
            clearRestart()
            monitorRef.current = initialMonitorState // перевзвод монитора для следующего подхода
          }
        }
        raf = requestAnimationFrame(tick)
        return // во время рестарта границу не мониторим
      }
      const r = boundaryMonitorStep(monitorRef.current, cur, dtMs, adapter.rate(), s.rangeEnd, 2)
      monitorRef.current = r.state
      if (r.fire) reachBoundary()
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [adapter, looping, enforcementSuspended, reachBoundary, clearRestart])

  // T2-review fix (Minor): 'ended' is an event-subscription callback, not a
  // render-time read, so it needs its own "latest value" ref — stateRef above
  // already covers rangeStart/rangeEnd/looping/pauseAtEnd but not this prop.
  // Updated in the render body (not an effect): cheap, idempotent assignment,
  // same pattern as the other latest-value refs in this hook.
  const suspendedRef = useRef(enforcementSuspended)
  suspendedRef.current = enforcementSuspended

  // Safety-net (fix A1): суб-дорожка длиннее видео → boundary по rangeEnd не сработает,
  // но YT эмитит 'ended'. Если луп активен — перезапустить с A через reachBoundary.
  // Gated on enforcementSuspended (T2-review fix): mirrors the rAF-driver gate
  // above (enforcementSuspended check) — a hidden panel must freeze ALL
  // boundary enforcement, not just the rAF path, or B>=video-end loops would
  // still seek via 'ended' while the panel is suspended.
  useEffect(() => {
    if (!adapter) return
    return adapter.on('state', (p) => {
      if (suspendedRef.current) return
      if (p === 'ended' && stateRef.current.looping) reachBoundary()
    })
  }, [adapter, reachBoundary])

  // T0 (paritet desktop useWorkspace :418-420): снять boundarySuppress, как только
  // looping реально стал false — дальше границу блокирует нативный !looping-гард
  // в reachBoundary (закрывает async-окно advance). StrictMode-safe: idempotent
  // ref-write, no subscription/timer to leak on the dev double-invoke.
  useEffect(() => {
    if (!looping) boundarySuppressRef.current = false
  }, [looping])

  // Reset loop-состояния при смене адаптера (смена videoId без ремаунта, fix E1): иначе
  // stale rangeEnd от прошлого видео → boundary по чужим координатам в новом ролике.
  useEffect(() => {
    setLooping(false); setRangeStart(0); setRangeEnd(0)
    setViewStart(0); setViewEnd(0)
    cancelCountdown(); clearRestart()
    monitorRef.current = initialMonitorState
    // T2 I4: адаптер может быть recreated БЕЗ смены videoId (e.g. remount под тем
    // же videoId) — без сброса seededRef guard в seed-эффекте посчитает видео уже
    // засиженным и не восстановит rangeEnd/viewEnd после этого reset-в-нули.
    seededRef.current = null
  }, [adapter, cancelCountdown, clearRestart])

  // Seed/restore A-B + view when duration becomes known. duration() returns 0 on live
  // YouTube until the IFrame fires 'ready'. IMPORTANT: 'ready' is NOT a reliable trigger
  // in prod — the real IFrameAdapter emits it synchronously right after its internal
  // resolve(), which can land before `adapter.on('ready', init)` below has even run (the
  // adapter reaches React state a microtask later than construction), so the subscription
  // is frequently too late and never fires. The two things that actually do the work are:
  // (1) the synchronous init() call on every effect run (covers duration already known at
  // mount — fake adapters, fast connections), and (2) subscribing to the 'state' event,
  // which the adapter keeps emitting on every playback state change and is not subject to
  // the same race — so if duration was still 0 at mount (slow network, cued live video),
  // the next 'state' event re-runs init() and unsticks the view. init() is idempotent
  // (guarded by `seededRef.current === videoId`), so redundant firings are harmless.
  // Declared AFTER the reset-on-adapter-change effect above so that on adapter swap the
  // reset (seededRef=null) commits first and this init can react to it within the same
  // effect pass.
  //
  // T2: seed formula matches desktop canon (workspace-init.ts computeDefaultParams:89-98 /
  // computeRestoreParams:62-82) — A=0, B=max(1%·dur, 5s) capped at dur, view=Fit the whole
  // clip, looping=false for a fresh video. A saved per-video session (localStorage
  // 'flib:ws:'+videoId) WINS over the default seed and is applied WITHOUT seeking the
  // playhead (restore must never clobber where the user currently is).
  useEffect(() => {
    if (!adapter) return
    const init = () => {
      const d = adapter.duration()
      if (d <= 0) return
      if (seededRef.current === videoId) return // already seeded/restored for this video

      if (videoId) {
        const raw = localStorage.getItem('flib:ws:' + videoId)
        if (raw) {
          try {
            const saved = JSON.parse(raw)
            // T2-review fix #1: apply the restore ONLY if all four required
            // numeric fields are actually finite numbers. looping/pauseAtEnd are
            // soft (coerced to a safe default) since they can never poison
            // downstream seek/zoom math the way a NaN range/view bound can.
            // Any required field missing/malformed → fall through to the
            // default seed below, exactly like a corrupt/legacy entry.
            // Minor M3 (final review): finiteness alone doesn't rule out an
            // inverted/degenerate span (viewEnd<=viewStart, rangeEnd<rangeStart,
            // or a negative rangeStart) — such a saved entry passed the old
            // guard and got applied verbatim, handing the timeline a backwards
            // view/range. Require the span invariants too; any violation falls
            // through to the default seed below, same as a corrupt entry.
            // Minor M2 (final review, pre-existing): a saved session from a
            // LONGER video (or a stale entry after re-encoding shrank the
            // duration) can have viewStart already past the new, shorter `d`.
            // Only viewEnd was being clamped to `d` — viewStart sailed through
            // unclamped, handing the timeline a view window that starts past
            // the clip's own end. Require viewStart < d too; a violation falls
            // through to the default seed below, same as a corrupt entry.
            if (saved && typeof saved === 'object' &&
                num(saved.rangeStart) && num(saved.rangeEnd) &&
                num(saved.viewStart) && num(saved.viewEnd) &&
                saved.viewEnd > saved.viewStart &&
                saved.rangeEnd >= saved.rangeStart &&
                saved.rangeStart >= 0 &&
                saved.viewStart < d) {
              setRangeStart(saved.rangeStart); setRangeEnd(Math.min(d, saved.rangeEnd))
              setViewStart(saved.viewStart); setViewEnd(Math.min(d, saved.viewEnd))
              const rEnd = Math.min(d, saved.rangeEnd)
              const ls = linkStartRef.current
              const startOutside = ls !== undefined && ls < d && (ls < saved.rangeStart || ls >= rEnd)
              setLooping(!!saved.looping && !startOutside)
              setPauseAtEndState(num(saved.pauseAtEnd) ? saved.pauseAtEnd : 0)
              seededRef.current = videoId
              return
            }
          } catch { /* corrupt/legacy entry → fall through to default seed */ }
        }
      }

      const B = Math.min(d, Math.max(5, d * 0.01))
      setRangeStart(0); setRangeEnd(B); setViewStart(0); setViewEnd(d); setLooping(false)
      // Minor M1 (final review): desktop computeDefaultParams canon seeds
      // pauseAtEnd:0 for a fresh video. Without this, an in-place videoId
      // switch (same hook instance, new adapter) to a video with no saved
      // session would leak the PREVIOUS video's pauseAtEnd forward.
      setPauseAtEndState(0)
      seededRef.current = videoId
    }
    init()
    const offReady = adapter.on('ready', init)
    const offState = adapter.on('state', init)
    return () => { offReady(); offState() }
  }, [adapter, videoId])

  // Persist per-video A-B/view/loop state, debounced 400ms. Guarded on seededRef so the
  // reset-window between adapter swap (rangeEnd/viewEnd zeroed) and the next seed/restore
  // never clobbers the previously saved session with zeros.
  // NB (T2-review #4): a video switch can itself invalidate this effect's own deps
  // (rangeStart/rangeEnd/... get reset to 0 by the adapter-reset effect above) BEFORE
  // the 400ms debounce fires — that re-run's cleanup just clearTimeout()s the stale
  // write, which is correct/harmless (self-healing race): the flush effect below is
  // what guarantees the outgoing video's last edit still reaches localStorage.
  useEffect(() => {
    if (!videoId || seededRef.current !== videoId) return
    const id = setTimeout(() => {
      try {
        // решение: скрытая панель = «луп не нужен в следующей сессии»; restore не
        // оживит луп из закрытого состояния (владелец подтвердит на приёмке)
        localStorage.setItem('flib:ws:' + videoId, JSON.stringify(
          { rangeStart, rangeEnd, viewStart, viewEnd, looping: looping && !enforcementSuspended, pauseAtEnd }))
      } catch { /* storage unavailable/full — best-effort persist */ }
    }, 400)
    return () => clearTimeout(id)
  }, [videoId, rangeStart, rangeEnd, viewStart, viewEnd, looping, pauseAtEnd, enforcementSuspended])

  // T2-review fix #2: flush-on-switch. The persist-effect's cleanup above only
  // clearTimeout()s the pending debounce — an edit made <400ms before a video
  // switch/unmount was being silently dropped (desktop canon flushes this in
  // index.tsx:2758-2773). This effect's cleanup runs with the OLD videoId closure
  // (React tears down a passive effect whose deps changed — or on unmount — BEFORE
  // committing the new render), so it fires exactly once per outgoing video and
  // writes wsSnapshotRef's LATEST values synchronously, bypassing the debounce.
  //
  // Ordering check (why seededRef.current still reads the OUTGOING videoId here):
  // React runs ALL passive-effect cleanups for a commit (in declared order) before
  // running any of the new setups. The "reset loop-state on adapter change" effect
  // above is keyed on `adapter`, not `videoId`, and its body (which nulls seededRef)
  // is a *new setup*, not a cleanup — so even when videoId and adapter change in the
  // same commit, this cleanup still observes the pre-switch seededRef/videoId pairing.
  // The adapter itself is documented (see the seed/restore effect comment above,
  // T2 I4) to change asynchronously later than the videoId prop in real usage, which
  // only widens this window further in our favour.
  useEffect(() => {
    return () => {
      if (videoId && seededRef.current === videoId) {
        try {
          // решение: скрытая панель = «луп не нужен в следующей сессии»; restore не
          // оживит луп из закрытого состояния (владелец подтвердит на приёмке)
          const { enforcementSuspended: wasSuspended, ...snap } = wsSnapshotRef.current
          localStorage.setItem('flib:ws:' + videoId, JSON.stringify(
            { ...snap, looping: snap.looping && !wasSuspended }))
        } catch { /* storage unavailable/full — best-effort persist */ }
      }
    }
  }, [videoId])

  // cleanup failsafe при размонтировании
  useEffect(() => () => { if (restartFailsafeRef.current) clearTimeout(restartFailsafeRef.current) }, [])

  // WEB-NATIVE (фидбек №7, 2026-07-05): единая точка «Play → в луп». Десктоп-
  // прецедента «Play заводит A/B-луп» НЕТ (десктоп сикает к A только при ВКЛЮЧЕНИИ
  // лупа — shouldRewindOnLoopEnable, index.tsx:1798, критерий там ТОЛЬКО
  // t>=rangeEnd, без проверки rangeStart — utils/loop-toggle.ts:13-20); это
  // веб-нативное поведение по прямому запросу владельца. НЕ лифт → тег WEB-SEAM
  // не нужен. Критерий «вне [A,B]» — тот же, что в toggleABLoop:146
  // (t < rangeStart || t >= rangeEnd); у setABLoop гард односторонний (t >= end).
  // Это веб-канон, НЕ портирован с десктопа. Оба входа Play (Space в useHotkeys,
  // кнопка панели в WorkspacePanel) идут СЮДА; pause-ветка без изменений.
  // reachBoundary / pauseAtEnd / Z-suspend НЕ трогаем — читаем suspendedRef как rAF-драйвер.
  const onPlayCommand = useCallback(() => {
    if (!adapter) return
    if (!adapter.paused()) { adapter.pause(); return }
    const s = stateRef.current
    const t = adapter.currentTime()
    // сик к A ТОЛЬКО если луп активен, enforcement не приостановлен и playhead вне [A,B]
    if (s.looping && !suspendedRef.current && (t < s.rangeStart || t >= s.rangeEnd)) {
      adapter.seek(s.rangeStart)
    }
    adapter.play()
  }, [adapter])

  // T2-review fix: mirrors the rAF-driver's suspend-gate so a suspended-panel test
  // can drive the boundary via this synchronous shim instead of needing real rAF ticks.
  const _boundaryTickForTest = useCallback(() => {
    if (enforcementSuspended) return
    if (adapter && adapter.currentTime() >= stateRef.current.rangeEnd) reachBoundary()
  }, [adapter, enforcementSuspended, reachBoundary])

  // T0 (paritet desktop useWorkspace :493-522) — resumeFromBoundary. Единственный
  // "хозяин" рестарта после reachBoundary встал на B (shouldPauseAtBoundary===true).
  //   'advance' → снять looping (если реально было включено — иначе boundarySuppress
  //               не нужен, LOW-фикс десктопа), play ВПЕРЁД от текущей (B) позиции.
  //               НЕ сикаем A.
  //   'restart' → seek(A) + отсчёт(pauseAtEnd) + play (петля снова).
  const resumeFromBoundary = useCallback((action: 'advance' | 'restart') => {
    if (restartFailsafeRef.current) { clearTimeout(restartFailsafeRef.current); restartFailsafeRef.current = null }
    parkedRef.current = false
    if (!adapter) { restartingRef.current = false; return }
    if (action === 'advance') {
      // suppress-гард нужен ТОЛЬКО если реально флипаем looping (есть async-окно
      // до commit'а useLayoutEffect stateRef). Если looping уже false — не ставим
      // suppress (иначе [looping]-эффект не сработает и suppress залипнет true).
      if (stateRef.current.looping) {
        boundarySuppressRef.current = true
        setLooping(false)
      }
      restartingRef.current = false
      adapter.play()
    } else {
      // restart: seek(A) + отсчёт 3·2·1 (pauseAtEnd) ПЕРЕД повтором, затем play.
      // Во время отсчёта видео на паузе → restartingRef держится до play (finish()).
      adapter.seek(stateRef.current.rangeStart)
      const secs = Math.max(0, Math.round(stateRef.current.pauseAtEnd))
      const finish = () => { restartingRef.current = false; adapter.play(); onLoopRestart?.() } // FIX2
      if (secs > 0) { adapter.pause(); startCountdown(secs, finish) }
      else finish()
    }
  }, [adapter, startCountdown, onLoopRestart])

  // T0 (paritet desktop useWorkspace :529-541) — 3·2·1 отсчёт (pauseAtEnd) ПЕРЕД
  // проигрыванием петли, затем play. Зовётся координатором на ПЕРВОМ arm упражнения.
  // pauseAtEndOverride: координатор передаёт pauseAtEnd упражнения ЯВНО, т.к. на
  // ПЕРВОМ arm stateRef.current.pauseAtEnd ещё СТАРЫЙ (restoreWorkspace — async
  // setState, не применился в этом тике) — иначе secs=0 и отсчёт пропадал (десктоп-баг
  // из живого теста, задокументирован в исходнике :530-533).
  const countdownThenPlay = useCallback((pauseAtEndOverride?: number) => {
    if (!adapter) return
    const pae = pauseAtEndOverride ?? stateRef.current.pauseAtEnd
    const secs = Math.max(0, Math.round(pae))
    if (secs > 0) {
      adapter.pause()
      startCountdown(secs, () => { adapter.play() })
    } else {
      adapter.play()
    }
  }, [adapter, startCountdown])

  // T0 (IM9, paritet desktop restore() :173-216) — атомарно восстановить весь
  // workspace. Клампит к LIVE duration адаптера (не к stale duration-пропу), как
  // на десктопе (там — videoRef.current?.duration, не duration-prop). trustExtent:
  // не клампить range/view ниже запрошенного (нужен на onArm упражнения — длительность
  // может быть стейл/флакующей на загрузке нового видео).
  const restoreWorkspace = useCallback((p: {
    rangeStart: number
    rangeEnd: number
    viewStart: number
    viewEnd: number
    looping: boolean
    pauseAtEnd?: number
    trustExtent?: boolean
  }) => {
    // Self-review fix: desktop falls back to a hardcoded `duration || 60` because its
    // `duration` REACT PROP always has a stable non-zero source upstream. Web's
    // adapter.duration() can legitimately be 0/NaN before 'ready' fires, and web's OWN
    // conventions elsewhere (setRange → Infinity cap, setView → falls back to the
    // caller's own `e`) never invent a magic-60 bound. Blindly porting "60" here would
    // silently truncate a real exercise segment longer than 60s while duration is still
    // pending. When live duration is unknown, trust the caller's requested extent
    // outright (no clamp) instead — same effect trustExtent already has, just applied
    // unconditionally in the "we have zero size information" case.
    const live = adapter?.duration()
    const knownDur = (typeof live === 'number' && Number.isFinite(live) && live > 0) ? live : 0
    let dur = knownDur > 0 ? knownDur : Math.max(p.rangeEnd, p.viewEnd, 0.1)
    if (p.trustExtent) dur = Math.max(dur, p.rangeEnd, p.viewEnd)
    const re = Math.min(dur, Math.max(p.rangeEnd, p.rangeStart + 0.1))
    const rs = Math.max(0, Math.min(p.rangeStart, re - 0.1))
    // 0.1 — тот же view-floor, что и в setView/setRange выше (веб-конвенция; десктоп
    // использует MIN_VIEW=0.5 — сохраняем внутреннюю консистентность с этим файлом,
    // а не 1:1 с десктопным числом, т.к. это не часть таймаут-цепочки).
    const len = Math.min(Math.max(0.1, p.viewEnd - p.viewStart), dur)
    const vs = Math.max(0, Math.min(p.viewStart, dur - len))
    setRangeStart(rs); setRangeEnd(re)
    setViewStart(vs); setViewEnd(vs + len)
    setLooping(p.looping)
    setPauseAtEndState(p.pauseAtEnd ?? 0)
  }, [adapter])

  // T0 (IM9) — WEB-SEAM: see WorkspaceApi.deactivateWorkspace doc above. Neutral
  // teardown (no seek, no range/view reset — nothing meaningful to reset when the
  // run started from a degenerate rangeEnd<=rangeStart workspace).
  const deactivateWorkspace = useCallback(() => {
    setLooping(false)
    cancelCountdown()
    clearRestart()
  }, [cancelCountdown, clearRestart])

  // T0 (IM9) — see WorkspaceSnapshot doc above for the `active` synthesis contract.
  const getWorkspaceSnapshot = useCallback((): WorkspaceSnapshot => {
    const s = wsSnapshotRef.current
    return {
      rangeStart: s.rangeStart,
      rangeEnd: s.rangeEnd,
      viewStart: s.viewStart,
      viewEnd: s.viewEnd,
      looping: s.looping,
      pauseAtEnd: s.pauseAtEnd,
      // WEB-SEAM: synthesized — web has no separate panel-visibility `active` bit.
      active: s.rangeEnd > s.rangeStart,
    }
  }, [])

  return {
    rangeStart, rangeEnd, looping, pauseAtEnd, countdownValue, viewStart, viewEnd,
    setABLoop, toggleABLoop, onPlayCommand, onUserSeek, setPauseAtEnd, stopLoop,
    setView, zoom, fitToRange, setRange, _boundaryTickForTest,
    countdownThenPlay, resumeFromBoundary, restoreWorkspace, deactivateWorkspace,
    getWorkspaceSnapshot,
  }
}
