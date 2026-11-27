// web/src/player/hooks/useHotkeys.ts
// F6 — global keyboard hotkeys ported verbatim from the desktop player. Single
// document-level keydown listener (added once); reads FRESH adapter/ws/cues/
// activeIndex via a "latest ref" written during render (no extra effect, no
// listener re-registration on every render — avoids stale-closure bugs while
// keeping exactly one addEventListener/removeEventListener pair per mount).
import { useEffect, useRef } from 'react'
import type { PlayerAdapter } from '../../adapter/PlayerAdapter'
import type { WorkspaceApi } from './useWorkspace'
import type { Cue } from './useSubtitles'

export interface UseHotkeysOpts {
  adapter: PlayerAdapter | null
  ws: WorkspaceApi
  cues: Cue[]
  activeIndex: number
  /** A7: клавиша M — применить mute-регион к текущему [A,B]. */
  onApplyMute?: (t1: number, t2: number, cueIndex: number) => void
  /** Z — toggle the workspace/timeline panel (desktop canon index.tsx:3091). */
  onToggleTimeline?: () => void
  /** F — toggle fullscreen (desktop canon index.tsx:3153, guards: !ctrlKey && !metaKey && !shiftKey). */
  onToggleFullscreen?: () => void
  /**
   * T4 — клавиша S: hands-free старт/резюм shadowing. Десктопный S — тупой
   * boolean-тоггл; веб-семантика (AB-логика + ЭФЕМЕРНЫЙ арм + resume-from-hold)
   * целиком живёт в useShadowRuntime.handleShadowKey — сюда прокидывается ТОЛЬКО
   * как этот колбэк. useHotkeys НЕ знает про ephemeralArmRef/координатор: он лишь
   * слотит клавишу (гард isTypingTarget/модификаторов) и делегирует весь порядок
   * ветвлений (held→resumeFromHold / metadata→no-op / AB|cue→armRange) в runtime.
   * Опц. — production-плеер (PlayerPage) ещё не поднимает useShadowRuntime (как и
   * весь coordinator-driven runtime, T2/T3), поэтому без колбэка S — no-op.
   */
  onShadowKey?: () => void
  /**
   * Срез A (п.7) — клавиша R: тот же toggle, что пилюля «Шадоуинг» (десктоп-канон
   * index.tsx:3187-3193, где R === S === activate/deactivate). На вебе toggle =
   * «неактивно → arm-путь S; активно → deactivateShadow()» — вся логика живёт в
   * PlayerPage (onToggleShadow), сюда прокидывается ТОЛЬКО как этот колбэк.
   * useHotkeys лишь слотит клавишу (гард isTypingTarget/модификаторов). Опц. —
   * без колбэка R = no-op (паритет onShadowKey).
   */
  onShadowToggle?: () => void
  /**
   * S3-5 — маршрут ВСЕХ user-сиков (стрелки/ctrl-стрелки) через
   * useShadowRuntime's `observedSeek` (carry T4/F3 forward-escape). Опционален
   * и по умолчанию падает на `adapter.seek` — байт-в-байт старое поведение для
   * caller'ов, которые ещё не подняли runtime (и для существующих тестов).
   * PlayerPage передаёт сюда `runtime.seek`; при пустом эфемерном арме
   * observedSeek делает ранний return и просто зовёт `adapter.seek` — для
   * обычного юзера это идентично прежнему прямому вызову.
   */
  seek?: (t: number) => void
}

function isTypingTarget(el: Element | null): boolean {
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement).isContentEditable === true
}

export function useHotkeys(opts: UseHotkeysOpts): void {
  const latest = useRef(opts)
  latest.current = opts // "latest ref" — safe, only read from event callbacks below, not during render

  useEffect(() => {
    const goToCue = (adapter: PlayerAdapter, doSeek: (t: number) => void, ws: WorkspaceApi, cues: Cue[], index: number) => {
      const c = cues[index]; if (!c) return
      const len = Math.max(0.5, ws.viewEnd - ws.viewStart)
      const dur = adapter.duration() || c.end + 1
      if (c.start < ws.viewStart) { const vs = Math.max(0, c.start); ws.setView(vs, vs + len) }
      else if (c.end > ws.viewEnd) { const ve = Math.min(dur, c.end); ws.setView(ve - len, ve) }
      // desktop canon: Ctrl-arrow cue-jump does not auto-disable loop (panel owns loop-off)
      doSeek(c.start)
    }

    const onKeyDown = (e: KeyboardEvent) => {
      const { adapter, ws, cues, activeIndex, onApplyMute, onToggleTimeline, onToggleFullscreen, onShadowKey, onShadowToggle, seek } = latest.current
      if (!adapter) return
      if (isTypingTarget(document.activeElement)) return // не мешаем печатать в поиске/полях настроек
      // S3-5: единый маршрут — доSeek зовёт переданный `seek` (runtime.seek/observedSeek),
      // а без него (caller ещё не поднял runtime, старые тесты) падает на adapter.seek —
      // байт-в-байт прежнее поведение.
      const doSeek = seek ?? ((t: number) => adapter.seek(t))

      if (e.key === ' ' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault() // не даём странице проскроллить
        ws.onPlayCommand() // WEB-NATIVE (fb#7): единая точка Play-в-луп в useWorkspace
        return
      }
      if (e.key === 'ArrowLeft' && e.ctrlKey) {
        e.preventDefault()
        goToCue(adapter, doSeek, ws, cues, activeIndex - 1)
        return
      }
      if (e.key === 'ArrowRight' && e.ctrlKey) {
        e.preventDefault()
        goToCue(adapter, doSeek, ws, cues, activeIndex + 1)
        return
      }
      if (e.key === 'ArrowLeft' && !e.ctrlKey) {
        e.preventDefault()
        const t = Math.max(0, adapter.currentTime() - 5)
        // desktop canon: arrow ±5s seek does not auto-disable loop
        doSeek(t)
        return
      }
      if (e.key === 'ArrowRight' && !e.ctrlKey) {
        e.preventDefault()
        const t = adapter.currentTime() + 5
        // desktop canon: arrow ±5s seek does not auto-disable loop
        doSeek(t)
        return
      }
      if (e.code === 'KeyB' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        ws.toggleABLoop(activeIndex) // no-op внутри toggleABLoop если activeIndex вне cues
        return
      }
      if (e.code === 'KeyM' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        // A7: M применяет mute-регион к текущему [A,B]; applyRange = toggle-vs-create.
        if (ws.rangeEnd > ws.rangeStart) onApplyMute?.(ws.rangeStart, ws.rangeEnd, activeIndex)
        return
      }
      if (e.code === 'KeyZ' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        e.preventDefault()
        onToggleTimeline?.()
        return
      }
      // Web-only: guard Alt+F so it doesn't fight the browser/OS menu key on
      // Windows (Alt+F opens the File menu there). Desktop canon lets
      // Alt+F through to fullscreen too — deliberate divergence for web
      // (финал-ревью fable M-3).
      if (e.code === 'KeyF' && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        onToggleFullscreen?.()
        return
      }
      // T4 — S: hands-free shadowing. Guard ВСЕ модификаторы: Ctrl/Meta+S = браузерный
      // "Сохранить страницу" (не перехватываем), Alt/Shift+S = чужие комбо. Чистая S
      // (isTypingTarget уже отсеян сверху) → делегируем весь порядок ветвлений в
      // useShadowRuntime.handleShadowKey. useHotkeys НЕ содержит AB/арм-логики.
      if (e.code === 'KeyS' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        e.preventDefault()
        onShadowKey?.()
        return
      }
      // Срез A (п.7) — R: тот же toggle, что пилюля «Шадоуинг». Гард всех
      // модификаторов (Ctrl/Meta+R = перезагрузка страницы — не перехватываем).
      if (e.code === 'KeyR' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        e.preventDefault()
        onShadowToggle?.()
        return
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, []) // once — свежие значения читаются из latest.current, не из замыкания
}
