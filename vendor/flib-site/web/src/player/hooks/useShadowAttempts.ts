// useShadowAttempts — shadowing attempts on a videoId, localStorage persist
// (flib:shadow:<videoId>), same convention as useMuteRegions. `persistedByCue` is
// the snapshot loaded at mount/videoId change; `live` are attempts added this
// session (they carry a blob-id, consumed by the YOU track). add() writes to both
// live state and localStorage so a reload re-reads it into persistedByCue (not
// doubled: on reload persistedByCue already contains everything, live starts empty).
//
// WEB-SEAM (deviation from the T3 brief pseudocode, documented): the brief sketched
// persisted via `useMemo(loadStored, [videoId])` and left live's videoId-swap reset
// as an open A/B choice. useMuteRegions (the established precedent in this codebase,
// hooks/useMuteRegions.ts) already answers this for the analogous case with
// `useEffect(() => setRegions(loadRegions(videoId)), [videoId])` — reusing that
// pattern here for both persisted and live keeps videoId-swap behavior consistent
// across the two localStorage-backed hooks instead of introducing a second scheme.
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  mergeShadowAttemptsForPanel,
  type ShadowAttemptStored, type PanelAttempts,
} from '../workspace/shadow-attempts'

const KEY = (videoId: string) => `flib:shadow:${videoId}`

function loadStored(videoId: string): ShadowAttemptStored[] {
  if (!videoId) return []
  try {
    const raw = localStorage.getItem(KEY(videoId))
    if (!raw) return []
    const arr = JSON.parse(raw) as ShadowAttemptStored[]
    return Array.isArray(arr) ? arr : []
  } catch { return [] }
}

function toPanel(list: ShadowAttemptStored[]): PanelAttempts {
  const out: PanelAttempts = {}
  for (const a of list) {
    if (a.cue_index < 0) continue
    const key = String(a.cue_index)
    const existing = out[key]?.attempts ?? []
    out[key] = { attempts: [...existing, { match_pct: a.match_pct, audio_start_sec: a.audio_start_sec, audio_end_sec: a.audio_end_sec, text: a.text }] }
  }
  return out
}

export interface ShadowAttemptsApi {
  /** persisted snapshot for this session (used for the merge), byCue form. */
  persistedByCue: PanelAttempts
  /** live attempts added this session (carry a blob-id). */
  live: ShadowAttemptStored[]
  /** merged persisted+live for the panel (port of shadowAttemptsForPanel). */
  forPanel: PanelAttempts
  add(a: ShadowAttemptStored): void
  remove(id: string): void
  /** ТЗ №5 п.2 — per-run сброс: чистит live + persisted + localStorage-бакет
   *  видео. Зовётся при входе в НОВЫЙ ран (смена armedSegmentId). Владелец
   *  явно потребовал НЕ хранить «вечную» историю — только попытки текущего рана. */
  clearAll(): void
}

export function useShadowAttempts(videoId: string): ShadowAttemptsApi {
  const [persisted, setPersisted] = useState<ShadowAttemptStored[]>(() => loadStored(videoId))
  const [live, setLive] = useState<ShadowAttemptStored[]>([])

  // videoId swap — re-read persisted for the new id, drop this-session live attempts.
  useEffect(() => {
    setPersisted(loadStored(videoId))
    setLive([])
  }, [videoId])

  const persistAll = useCallback((all: ShadowAttemptStored[]) => {
    if (!videoId) return
    try { localStorage.setItem(KEY(videoId), JSON.stringify(all)) }
    catch { /* quota/private mode — live state remains the source of truth */ }
  }, [videoId])

  const add = useCallback((a: ShadowAttemptStored) => {
    setLive(prev => {
      const nextLive = [...prev, a]
      persistAll([...persisted, ...nextLive])
      return nextLive
    })
  }, [persisted, persistAll])

  const remove = useCallback((id: string) => {
    setLive(prev => {
      const nextLive = prev.filter(a => a.id !== id)
      persistAll([...persisted, ...nextLive])
      return nextLive
    })
  }, [persisted, persistAll])

  // ТЗ №5 п.2 — per-run сброс. Чистит и live (этой сессии), и persisted (снимок
  // прошлых ранов), и localStorage-ключ видео, так что ПОСЛЕ входа в новый ран
  // лента ПУСТА («только зашёл — а у меня уже 10» — этого быть не должно).
  // Идемпотентно: повторный вызов на пустом бакете — no-op (важно для StrictMode
  // double-invoke эффекта-детектора арма).
  const clearAll = useCallback(() => {
    setLive([])
    setPersisted([])
    if (!videoId) return
    try { localStorage.removeItem(KEY(videoId)) } catch { /* private mode — state-сброса достаточно */ }
  }, [videoId])

  // M3 (perf): мемо по [persisted]/[persistedByCue,live] — Срез D зовёт
  // setPartialText несколько раз/сек, а этот хук общий с картой; без мемо
  // toPanel+merge пересобирались бы на КАЖДЫЙ рендер PlayerPage (новая identity
  // forPanel → лишняя работа downstream). persisted/live — обычный React-state
  // (стабильная ссылка между рендерами, пока не изменён), так что мемо честна.
  const persistedByCue = useMemo(() => toPanel(persisted), [persisted])
  const forPanel = useMemo(() => mergeShadowAttemptsForPanel(persistedByCue, live), [persistedByCue, live])

  return { persistedByCue, live, forPanel, add, remove, clearAll }
}
