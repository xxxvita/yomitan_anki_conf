// annotation-store.ts — T-A (A1): persist shadow-exercise annotations.
// localStorage today, server later (interface is the seam that swap targets).
// WEB-SEAM: no desktop equivalent — desktop persists exercises inline in the
// per-video JSON annotations file written by its own file-store; the web P1
// slice has no file-store, so this is a new adapter, key convention borrowed
// from useShadowAttempts (`flib:shadow:<videoId>`) per task-A-brief.md A1.
import type { ShadowExerciseAnnotation } from './panel-types'

export interface AnnotationStore {
  load(videoKey: string): ShadowExerciseAnnotation[]
  save(videoKey: string, anns: ShadowExerciseAnnotation[]): void
}

const KEY = (videoKey: string) => `flib:shadow-exercises:${videoKey}`

// G1-strict (project convention, see anki_conf CLAUDE.md G1): this store backs
// a read-modify-write path (T2's useAnnotations: load → CRUD → save). A corrupt
// read must NOT fall back to [] — that empty result would become the base of
// the next save() and silently wipe the user's real exercises on disk. Instead
// load() throws AnnotationStoreCorruptError; the caller (T2) must catch it and
// refuse to schedule a save rather than paper over it with an empty list.
export class AnnotationStoreCorruptError extends Error {
  constructor(videoKey: string, cause?: unknown) {
    super(`AnnotationStore: corrupt data for videoKey=${videoKey}`)
    this.name = 'AnnotationStoreCorruptError'
    this.cause = cause
  }
}

export class LocalAnnotationStore implements AnnotationStore {
  load(videoKey: string): ShadowExerciseAnnotation[] {
    const raw = localStorage.getItem(KEY(videoKey))
    // No key at all = "empty", a normal/expected state — NOT corrupt. Distinct
    // from a key that exists but fails to parse/shape-check (see below).
    if (raw === null) return []
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (cause) {
      throw new AnnotationStoreCorruptError(videoKey, cause)
    }
    if (!Array.isArray(parsed)) {
      throw new AnnotationStoreCorruptError(videoKey)
    }
    return parsed as ShadowExerciseAnnotation[]
  }

  save(videoKey: string, anns: ShadowExerciseAnnotation[]): void {
    // Debounce lives in T2's useAnnotations (scheduleSave) — this is a plain
    // synchronous write, matching the LocalAnnotationStore/`localStorage`
    // contract other adapters in this file use (best-effort, quota/private
    // mode failures are swallowed rather than crashing the caller).
    try {
      localStorage.setItem(KEY(videoKey), JSON.stringify(anns))
    } catch {
      /* quota/private mode — in-memory caller state remains source of truth */
    }
  }
}
