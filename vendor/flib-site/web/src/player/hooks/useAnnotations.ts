import { useState, useCallback, useRef, useEffect } from 'react';
// WEB-SEAM: import-path reprice (T2 §3.1) — '../types' → T1's panel-types.ts.
import type {
  Annotation, AnnotationProject, AnnotationTool, Cue, ShadowExerciseAnnotation,
} from '../workspace/panel-types';
// WEB-SEAM: persist → AnnotationStore (T2 §Часть2.5). Desktop's `../utils/api`
// (loadAnnotations/saveAnnotations) is an ASYNC Core-file-store round-trip for
// the WHOLE AnnotationProject (freehand drawing annotations + shadowExercises
// + v1→v2 migration). Web's AnnotationStore (T-A) is SYNCHRONOUS (localStorage)
// and covers ONLY ShadowExerciseAnnotation[] — the freehand drawing-canvas tool
// is out of scope for the web wholelift slice (no UI on web consumes
// project.annotations/tool/color/etc.), so the v1-migration branch and full-
// project persistence below are dropped; shadowExercises round-trips, the rest
// of `project` stays in-memory-only for this slice.
import { LocalAnnotationStore, AnnotationStoreCorruptError } from '../workspace/annotation-store';
import { resolveExerciseOverlap } from '../workspace/exercise-overlap';

const EMPTY_PROJECT: AnnotationProject = { version: 2, videoPath: '', annotations: [] };
const DEFAULT_COLORS = ['#ff3333', '#3388ff', '#33cc33', '#ffcc00', '#ffffff', '#000000', '#ff8800', '#aa44ff'];
// WEB-SEAM: persist → AnnotationStore. Stateless class, module-scoped instance
// (mirrors desktop's module-level loadAnnotations/saveAnnotations functions).
const annotationStore = new LocalAnnotationStore();

// WEB-SEAM: import-path reprice — `currentTime` is unused in this file on
// desktop TOO (grep confirms — accepted for signature-shape parity with
// sibling hooks, never read in the body). Desktop's tsconfig tolerates an
// unused parameter; web's does not (`noUnusedParameters: true`). Renamed to
// `_currentTime` — a parameter rename only, no behavioural change (callers
// pass it positionally either way).
export function useAnnotations(videoPath: string, cues: Cue[], _currentTime: number) {
  const [project, setProject] = useState<AnnotationProject>(EMPTY_PROJECT);
  const [active, setActive] = useState(false);
  const [tool, setTool] = useState<AnnotationTool>('freehand');
  const [color, setColor] = useState('#ff3333');
  const [lineWidth, setLineWidth] = useState(4);
  const [fontSize, setFontSize] = useState(24);
  const [opacity, setOpacity] = useState(1);
  const [fill, setFill] = useState(false);
  const [bold, setBold] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const undoStack = useRef<AnnotationProject[]>([]);
  const redoStack = useRef<AnnotationProject[]>([]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedPath = useRef<string>('');

  // WEB-SEAM: persist → AnnotationStore. Load annotations when video changes.
  // annotationStore.load() is SYNCHRONOUS (no .then/.catch — localStorage, not
  // a Core file round-trip) and G1-strict: a corrupt entry THROWS
  // AnnotationStoreCorruptError instead of silently returning []. Catching it
  // here and seeding an EMPTY in-memory project WITHOUT calling scheduleSave
  // is what satisfies G1 — nothing is written back to storage until the next
  // explicit user mutation (add/update/delete/upsert), so a mere page
  // load/reload never silently overwrites the corrupt-but-still-on-disk data.
  useEffect(() => {
    if (!videoPath || videoPath === loadedPath.current) return;
    loadedPath.current = videoPath;
    try {
      const shadowExercises = annotationStore.load(videoPath);
      setProject({ ...EMPTY_PROJECT, videoPath, shadowExercises });
    } catch (e) {
      if (!(e instanceof AnnotationStoreCorruptError)) {
        // T2-fix (audit MINOR — safe-degrade on non-corrupt load errors):
        // this used to `throw e` — an uncaught render-phase exception with
        // no error boundary on this seam (e.g. a SecurityError from a
        // locked-down/private-mode localStorage, or a quota error). Desktop
        // has no equivalent failure mode to mirror (its load is a Core
        // file-store round-trip, not localStorage) so there's no "canon"
        // behaviour to carry over here — degrade safely instead of crashing:
        // warn and leave the CURRENT in-memory project untouched. Do NOT
        // seed an empty project (that would read as an intentional "no
        // exercises yet" state) and do NOT schedule a save (never overwrite
        // on-disk data because of a read failure we don't understand).
        console.warn('[useAnnotations] non-corrupt annotation load error — leaving in-memory state untouched', e);
        return;
      }
      // G1: corrupt load error → empty in-memory project, NO save initiated
      // here (see comment above).
      setProject({ ...EMPTY_PROJECT, videoPath });
    }
    undoStack.current = [];
    redoStack.current = [];
  }, [videoPath]);

  // WEB-SEAM: persist → AnnotationStore. Auto-save (debounced 1s, UNCHANGED
  // timing from desktop :62-67). Only `shadowExercises` persists — see the
  // import-block comment above for why the rest of `project` is in-memory-only
  // on web.
  const scheduleSave = useCallback((proj: AnnotationProject) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      annotationStore.save(proj.videoPath || videoPath, proj.shadowExercises ?? []);
    }, 1000);
  }, [videoPath]);

  const undo = useCallback(() => {
    if (undoStack.current.length === 0) return;
    setProject(current => {
      redoStack.current.push(JSON.parse(JSON.stringify(current)));
      const prev = undoStack.current.pop()!;
      scheduleSave(prev);
      return prev;
    });
  }, [scheduleSave]);

  const redo = useCallback(() => {
    if (redoStack.current.length === 0) return;
    setProject(current => {
      undoStack.current.push(JSON.parse(JSON.stringify(current)));
      const next = redoStack.current.pop()!;
      scheduleSave(next);
      return next;
    });
  }, [scheduleSave]);

  // Compute default endTime from current subtitle cue
  const getDefaultEndTime = useCallback((time: number): number => {
    if (cues.length === 0) return time + 5;
    const cue = cues.find(c => time >= c.startTime && time < c.endTime);
    if (cue) return cue.endTime;
    // Find next cue
    const next = cues.find(c => c.startTime > time);
    if (next) return next.endTime;
    return time + 5;
  }, [cues]);

  // Add annotation with per-annotation timing
  const addAnnotation = useCallback((time: number, ann: Omit<Annotation, 'id' | 'startTime' | 'endTime'>): string => {
    const id = crypto.randomUUID();
    const annotation: Annotation = {
      ...ann,
      id,
      startTime: time,
      endTime: getDefaultEndTime(time),
    };

    setProject(prev => {
      undoStack.current.push(JSON.parse(JSON.stringify(prev)));
      if (undoStack.current.length > 50) undoStack.current.shift();
      redoStack.current = [];
      const updated: AnnotationProject = {
        ...prev,
        annotations: [...prev.annotations, annotation],
      };
      scheduleSave(updated);
      return updated;
    });

    return id;
  }, [getDefaultEndTime, scheduleSave]);

  // Delete annotation(s)
  const deleteAnnotation = useCallback((annId: string) => {
    setProject(prev => {
      undoStack.current.push(JSON.parse(JSON.stringify(prev)));
      redoStack.current = [];
      const updated: AnnotationProject = {
        ...prev,
        annotations: prev.annotations.filter(a => a.id !== annId),
      };
      scheduleSave(updated);
      return updated;
    });
    setSelectedIds(prev => { const next = new Set(prev); next.delete(annId); return next; });
  }, [scheduleSave]);

  const deleteSelected = useCallback(() => {
    if (selectedIds.size === 0) return;
    setProject(prev => {
      undoStack.current.push(JSON.parse(JSON.stringify(prev)));
      redoStack.current = [];
      const updated: AnnotationProject = {
        ...prev,
        annotations: prev.annotations.filter(a => !selectedIds.has(a.id)),
      };
      scheduleSave(updated);
      return updated;
    });
    setSelectedIds(new Set());
  }, [selectedIds, scheduleSave]);

  // Update annotation (no undo — for live drag)
  const updateAnnotation = useCallback((annId: string, patch: Partial<Annotation>) => {
    setProject(prev => {
      const updated: AnnotationProject = {
        ...prev,
        annotations: prev.annotations.map(a => a.id === annId ? { ...a, ...patch } : a),
      };
      scheduleSave(updated);
      return updated;
    });
  }, [scheduleSave]);

  // Update timing for selected annotations (with undo)
  const updateSelectedTiming = useCallback((startTime: number, endTime: number) => {
    if (selectedIds.size === 0) return;
    setProject(prev => {
      undoStack.current.push(JSON.parse(JSON.stringify(prev)));
      redoStack.current = [];

      // Get current merged range
      const selected = prev.annotations.filter(a => selectedIds.has(a.id));
      const oldStart = Math.min(...selected.map(a => a.startTime));
      const oldEnd = Math.max(...selected.map(a => a.endTime));
      const startDelta = startTime - oldStart;
      const endDelta = endTime - oldEnd;

      const updated: AnnotationProject = {
        ...prev,
        annotations: prev.annotations.map(a => {
          if (!selectedIds.has(a.id)) return a;
          return {
            ...a,
            startTime: a.startTime + startDelta,
            endTime: a.endTime + endDelta,
          };
        }),
      };
      scheduleSave(updated);
      return updated;
    });
  }, [selectedIds, scheduleSave]);

  // Push undo (external call before multi-step operations)
  const pushUndo = useCallback(() => {
    setProject(current => {
      undoStack.current.push(JSON.parse(JSON.stringify(current)));
      if (undoStack.current.length > 50) undoStack.current.shift();
      redoStack.current = [];
      return current;
    });
  }, []);

  // Selection
  const selectAnnotation = useCallback((id: string | null, addToSelection = false) => {
    if (!id) { setSelectedIds(new Set()); return; }
    if (addToSelection) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      });
    } else {
      setSelectedIds(new Set([id]));
    }
  }, []);

  const activate = useCallback(() => {
    setActive(true);
    setTool('freehand');
    setSelectedIds(new Set());
  }, []);

  const deactivate = useCallback(() => {
    setActive(false);
    setSelectedIds(new Set());
  }, []);

  // Get visible annotations at a given time
  const getVisibleAnnotations = useCallback((time: number): Annotation[] => {
    return project.annotations.filter(a => time >= a.startTime && time < a.endTime);
  }, [project]);

  // ── Shadow exercises (P3) ───────────────────────────────────────────
  // Stored alongside `annotations[]` in `project.shadowExercises`. Mutations
  // share the same scheduleSave/undo plumbing so the on-disk JSON remains a
  // single source of truth.

  const shadowExercises: ShadowExerciseAnnotation[] = project.shadowExercises ?? [];

  // Add — caller computes startTime/endTime/anchor; we stamp id + timestamps
  // and run the conflict check (no overlapping exercises allowed except
  // exact-boundary touch). Returns the new id, or null if a conflict exists
  // and `replaceConflicting` is false.
  // opts.ephemeral (БF2): упражнение живёт только в памяти (project), но НЕ
  // персистится на диск (scheduleSave пропускается). Для авто-упражнений
  // speak-пака — они эфемерны, не должны засорять AnnotationProject JSON урока.
  const addShadowExercise = useCallback((
    exercise: Omit<ShadowExerciseAnnotation, 'id' | 'createdAt' | 'updatedAt'>,
    opts: { replaceConflicting?: boolean; ephemeral?: boolean } = {},
  ): string | null => {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const newEx: ShadowExerciseAnnotation = { ...exercise, id, createdAt: now, updatedAt: now };
    const overlap = (a: ShadowExerciseAnnotation, b: ShadowExerciseAnnotation) =>
      a.startTime < b.endTime && b.startTime < a.endTime;

    let inserted = false;
    setProject(prev => {
      // Эфемерные (speak-пак) НЕ кладём в undo-стек: системные упражнения не
      // должны удаляться пользовательским Ctrl-Z и ломать авто-старт прогона.
      if (!opts.ephemeral) {
        undoStack.current.push(JSON.parse(JSON.stringify(prev)));
        if (undoStack.current.length > 50) undoStack.current.shift();
        redoStack.current = [];
      }
      const existing = prev.shadowExercises ?? [];
      const conflicts = existing.filter(e => overlap(e, newEx));
      if (conflicts.length > 0 && !opts.replaceConflicting) {
        // Caller didn't acknowledge — skip insertion silently. UI should
        // call back with replaceConflicting:true after user confirms.
        return prev;
      }
      const filtered = resolveExerciseOverlap(existing, newEx);
      const updated: AnnotationProject = {
        ...prev,
        shadowExercises: [...filtered, newEx].sort((a, b) => a.startTime - b.startTime),
      };
      if (!opts.ephemeral) scheduleSave(updated); // ephemeral → только в памяти
      inserted = true;
      return updated;
    });
    return inserted ? id : null;
  }, [scheduleSave]);

  const updateShadowExercise = useCallback((
    id: string, patch: Partial<Omit<ShadowExerciseAnnotation, 'id' | 'createdAt'>>,
    opts: { resolveConflicts?: boolean } = {},
  ) => {
    setProject(prev => {
      const existing = prev.shadowExercises ?? [];
      const idx = existing.findIndex(e => e.id === id);
      if (idx < 0) return prev;
      const next = [...existing];
      next[idx] = { ...next[idx], ...patch, updatedAt: new Date().toISOString() };
      // Аудит B1/B2: позиционные патчи (body-drag move / перепривязка к cue)
      // обязаны резолвить пересечения, как add-путь — иначе стор персистит
      // перекрывающиеся упражнения и автостарт недетерминирован. Соседи
      // ужимаются от обновлённого (resolveExerciseOverlap), сжатые в ноль —
      // дропаются.
      let list: ShadowExerciseAnnotation[] = next;
      if (opts.resolveConflicts) {
        // Резолюция может МОЛЧА ужать/удалить соседа — деструктивно, поэтому
        // кладём снимок в undo-стек (паритет с add/delete-путями): Ctrl-Z
        // возвращает и позицию, и накрытого соседа.
        undoStack.current.push(JSON.parse(JSON.stringify(prev)));
        if (undoStack.current.length > 50) undoStack.current.shift();
        redoStack.current = [];
        const updatedEx = next[idx];
        list = [...resolveExerciseOverlap(next.filter(e => e.id !== id), updatedEx), updatedEx];
      }
      const updated: AnnotationProject = {
        ...prev,
        shadowExercises: list.sort((a, b) => a.startTime - b.startTime),
      };
      scheduleSave(updated);
      return updated;
    });
  }, [scheduleSave]);

  const deleteShadowExercise = useCallback((id: string) => {
    setProject(prev => {
      undoStack.current.push(JSON.parse(JSON.stringify(prev)));
      redoStack.current = [];
      const updated: AnnotationProject = {
        ...prev,
        shadowExercises: (prev.shadowExercises ?? []).filter(e => e.id !== id),
      };
      scheduleSave(updated);
      return updated;
    });
  }, [scheduleSave]);

  // Ф2 (task #1068): batch-upsert speak-упражнений с СОХРАНЕНИЕМ настроек.
  // Speak-упражнения деривуются из манифеста при каждом открытии (позиции), но
  // их settings (providerPrompts, useProviderForScoring, advanceThreshold, ...)
  // персистятся и НЕ должны затираться при пересборке. Детерминированный id
  // `speak:<lessonId>:<subIndex>` сопоставляет записи между открытиями.
  // Merge: сохраняем ВЕСЬ existing.settings (правки юзера), из payload берём
  // ТОЛЬКО позиции. Cleanup осиротевших — только по префиксу `speak:<lessonId>:`
  // (ручные UUID-записи и drawing не трогаются). Персист (scheduleSave), НЕ undo
  // (системные). НЕ прогоняем resolveExerciseOverlap (отрезки идут встык).
  const upsertSpeakExercises = useCallback((
    payloads: Omit<ShadowExerciseAnnotation, 'id' | 'createdAt' | 'updatedAt'>[],
    opts: { lessonId: string },
  ) => {
    const prefix = `speak:${opts.lessonId}:`;
    const idFor = (subIndex?: number) => `${prefix}${subIndex ?? 0}`;
    // Инвариант: payloads имеют уникальный subIndex (buildSpeak гарантирует).
    const seen = new Set<string>();
    for (const p of payloads) {
      const sid = idFor(p.subIndex);
      if (seen.has(sid)) {
        console.warn('[SPEAK-Ф2] duplicate subIndex in payloads — затирание', { id: sid });
      }
      seen.add(sid);
    }
    setProject(prev => {
      const now = new Date().toISOString();
      const existing = prev.shadowExercises ?? [];
      const byId = new Map(existing.map(e => [e.id, e]));
      const upserted: ShadowExerciseAnnotation[] = payloads.map(p => {
        const id = idFor(p.subIndex);
        const prevEx = byId.get(id);
        if (prevEx) {
          // Позиции: из манифеста (payload) — КРОМЕ случая, когда пользователь
          // вручную подвинул границы (positionsCustomized) → сохраняем его start/end
          // (task #1068). settings — ВЕСЬ existing поверх payload-дефолтов (новые
          // поля схемы дотекут из payload, ранее сохранённые значения юзера
          // выигрывают). createdAt сохраняем.
          const keepPos = prevEx.positionsCustomized === true;
          return {
            ...prevEx,
            startTime: keepPos ? prevEx.startTime : p.startTime,
            endTime: keepPos ? prevEx.endTime : p.endTime,
            subIndex: p.subIndex,
            anchorMode: p.anchorMode,
            settings: { ...p.settings, ...prevEx.settings },
            updatedAt: now,
          };
        }
        return { ...p, id, createdAt: now, updatedAt: now };
      });
      // НЕ-speak (другой префикс/UUID) + speak ДРУГИХ уроков — сохраняем как есть.
      const kept = existing.filter(e => !e.id.startsWith(prefix));
      const updated: AnnotationProject = {
        ...prev,
        shadowExercises: [...kept, ...upserted].sort((a, b) => a.startTime - b.startTime),
      };
      scheduleSave(updated);
      return updated;
    });
  }, [scheduleSave]);

  // Find the exercise that contains the given time (or null if none).
  const getShadowExerciseAt = useCallback((time: number): ShadowExerciseAnnotation | null => {
    const list = project.shadowExercises ?? [];
    return list.find(e => time >= e.startTime && time < e.endTime) ?? null;
  }, [project.shadowExercises]);

  // Find exercise bound to a specific subtitle index (anchorMode==='subtitle').
  const getShadowExerciseForSub = useCallback((subIdx: number): ShadowExerciseAnnotation | null => {
    const list = project.shadowExercises ?? [];
    return list.find(e => e.anchorMode === 'subtitle' && e.subIndex === subIdx) ?? null;
  }, [project.shadowExercises]);

  // Get selected annotation time range (merged)
  const selectedTimeRange = (() => {
    if (selectedIds.size === 0) return null;
    const selected = project.annotations.filter(a => selectedIds.has(a.id));
    if (selected.length === 0) return null;
    return {
      startTime: Math.min(...selected.map(a => a.startTime)),
      endTime: Math.max(...selected.map(a => a.endTime)),
    };
  })();

  return {
    project, active, tool, color, lineWidth, fontSize, opacity, fill, bold,
    selectedIds, selectedTimeRange,
    canUndo: undoStack.current.length > 0,
    canRedo: redoStack.current.length > 0,
    colors: DEFAULT_COLORS,
    setTool, setColor, setLineWidth, setFontSize, setOpacity, setFill, setBold,
    selectAnnotation, setSelectedIds,
    activate, deactivate, addAnnotation, deleteAnnotation, deleteSelected,
    updateAnnotation, updateSelectedTiming, pushUndo,
    undo, redo, getVisibleAnnotations,
    // Shadow exercises (P3)
    shadowExercises,
    addShadowExercise, updateShadowExercise, deleteShadowExercise,
    upsertSpeakExercises,
    getShadowExerciseAt, getShadowExerciseForSub,
  };
}
