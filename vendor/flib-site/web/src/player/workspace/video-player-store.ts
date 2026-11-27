// web/src/player/workspace/video-player-store.ts
// WEB-SEAM: replaces desktop zustand useVideoPlayerStore. P1 has no ShadowChat,
// no dubbing → those fields are inert stubs. youTrackRecordingId became a real
// field in T3 (shadowing V1): useShadowV1.selectRecording writes it so the YOU
// track combo (WorkspacePanelThemed) can highlight/select a specific recording.
// notifyRecordingSaved (T-A / A2): desktop's useShadow (:95) reads this off the
// store to announce a freshly-uploaded recording. Web attempts are ephemeral
// (A2 WEB-CUT, api.ts) — no recording is ever actually saved server-side — so
// this is a permanent no-op kept only so the lifted hook compiles unmodified.
//
// T8: shadowChatDock/shadowChatDockHint/shadowChatFreePos were hardcoded `null`
// stubs ("P1 has no ShadowChat" — stale even before this pass, since T3 already
// added a real ShadowCard). They are now real state, wired by ShadowCardLifted's
// drag-dock mechanic (lifted from desktop ShadowChat.tsx :491-695) and consumed
// by WorkspacePanelThemed's dockReserve/effectiveDock (already ported, T2/T-RULE
// — see that file's WEB-SEAM comment at ~:518-526) to inset the timeline. Same
// persistence split as desktop's store (electron/renderer/store/video-player-
// store.ts :164-178): shadowChatDock survives reload via localStorage (key
// 'videoPlayer.shadowChatDock', same string — WEB-SEAM: shared convention, not
// a shared origin); shadowChatFreePos/shadowChatDockHint are in-memory only,
// exactly like desktop (freePos resets on reload — the last known screen
// position is a nice-to-have, not a data-loss risk; dockHint is a live-drag
// preview, meaningless after reload).
import { useSyncExternalStore } from 'react'
import { clampShadowSize } from './shadow-card-size'

export type DockSide = 'left' | 'right' | null

const DOCK_STORAGE_KEY = 'videoPlayer.shadowChatDock'
// ТЗ №3 п.1 — persisted resize {w,h}. Unlike freePos (in-memory only), the
// user's chosen SIZE survives reload (same rationale as dock: a data-cheap,
// high-value preference) AND feeds the docked-inset width the timeline reserves.
const SIZE_STORAGE_KEY = 'videoPlayer.shadowChatSize'

function readPersistedDock(): DockSide {
  if (typeof window === 'undefined') return null
  let v = localStorage.getItem(DOCK_STORAGE_KEY)
  if (v == null) return null
  // ТЗ №8 п.2 — LIVE-факт оркестратора: LS='"left"' (JSON-кавычки) после reload
  // рендерило карту FLOAT, т.к. сверка `"left"` === 'left' была false → null →
  // store.dock=null → приоритет freePos → float. Наш собственный сеттер пишет
  // ГОЛУЮ строку ('left'), но десктопный zustand-persist и любая ручная инъекция
  // через JSON.stringify пишут В КАВЫЧКАХ. Читатель обязан принять ОБА формата:
  // снимаем ровно одну пару обрамляющих кавычек (не полноценный JSON.parse —
  // достаточно и безопаснее; над-принятие мусора вроде '"up"' по-прежнему → null).
  if (v.length >= 2 && v.charCodeAt(0) === 34 /* " */ && v.charCodeAt(v.length - 1) === 34) {
    v = v.slice(1, -1)
  }
  return v === 'left' || v === 'right' ? v : null
}

function readPersistedSize(): { w: number; h: number } | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(SIZE_STORAGE_KEY)
    if (!raw) return null
    const o = JSON.parse(raw) as { w?: unknown; h?: unknown }
    if (typeof o?.w === 'number' && typeof o?.h === 'number'
        && Number.isFinite(o.w) && Number.isFinite(o.h)) {
      // LOW: clamp on READ so a corrupt/undersized persisted value (e.g. {w:5,h:5}
      // from an old bug or hand-edited storage) can never render a 5px card — the
      // clamp floors to SHADOW_MIN_* and caps at the viewport.
      const vw = typeof window !== 'undefined' ? window.innerWidth : 1920
      const vh = typeof window !== 'undefined' ? window.innerHeight : 1080
      return clampShadowSize(o.w, o.h, vw, vh)
    }
    return null
  } catch { return null }
}

let state = {
  youTrackForceShown: false, youAudible: true, youTrackRecordingId: null as string | null,
  shadowChatDock: readPersistedDock(),
  shadowChatDockHint: null as DockSide,
  shadowChatFreePos: null as { x: number; y: number } | null,
  shadowChatSize: readPersistedSize(),
  // ТЗ №5 п.1 — ЖИВОЙ размер во время resize-драга. Emit-only (НЕ пишется в
  // localStorage — иначе шторм записей на каждый pointermove, MED-7). Читают ОБА:
  // карта (визуальный рост) И таймлайн-резерв WorkspacePanelThemed (чтобы резерв
  // ТРЕКАЛ ширину вживую, а не только на pointerup — владелец: «меняю ширину,
  // резерв не меняется»). null = драга нет → потребители падают на shadowChatSize.
  shadowChatSizeLive: null as { w: number; h: number } | null,
}
const subs = new Set<() => void>()
const emit = () => { for (const s of subs) s() }
const subscribe = (cb: () => void) => { subs.add(cb); return () => subs.delete(cb) }

type VPState = {
  shadowChatDock: DockSide
  setShadowChatDock: (d: DockSide) => void
  shadowChatDockHint: DockSide
  setShadowChatDockHint: (d: DockSide) => void
  shadowChatFreePos: { x: number; y: number } | null
  setShadowChatFreePos: (p: { x: number; y: number } | null) => void
  shadowChatSize: { w: number; h: number } | null
  setShadowChatSize: (s: { w: number; h: number } | null) => void
  shadowChatSizeLive: { w: number; h: number } | null
  setShadowChatSizeLive: (s: { w: number; h: number } | null) => void
  youTrackForceShown: boolean
  setYouTrackForceShown: (b: boolean) => void
  youTrackRecordingId: string | null
  setYouTrackRecordingId: (id: string | null) => void
  youAudible: boolean
  setYouAudible: (b: boolean) => void
  /** WEB-CUT: recording-saved notify (attempts ephemeral) — always a no-op. */
  notifyRecordingSaved: () => void
}
// WEB-SEAM plan-bug fix (found live-mounting PlayerPage, T3): these setters
// must be STABLE references across snapshot() calls. useSyncExternalStore
// compares the selected slice by identity — a selector that projects out
// `s.setYouTrackForceShown` while snapshot() minted a fresh closure every
// call looked "changed" on every render, tripping React's nested-update
// limit (infinite re-render loop). Only surfaced once the panel was actually
// mounted in the real app tree, not in isolated component tests.
function setYouTrackForceShown(b: boolean) { state = { ...state, youTrackForceShown: b }; emit() }
function setYouAudible(b: boolean) { state = { ...state, youAudible: b }; emit() }
function setYouTrackRecordingId(id: string | null) { state = { ...state, youTrackRecordingId: id }; emit() }
function setShadowChatDock(d: DockSide) {
  if (typeof window !== 'undefined') {
    if (d) localStorage.setItem(DOCK_STORAGE_KEY, d)
    else localStorage.removeItem(DOCK_STORAGE_KEY)
  }
  state = { ...state, shadowChatDock: d }
  emit()
}
function setShadowChatDockHint(d: DockSide) { state = { ...state, shadowChatDockHint: d }; emit() }
function setShadowChatFreePos(p: { x: number; y: number } | null) { state = { ...state, shadowChatFreePos: p }; emit() }
function setShadowChatSize(s: { w: number; h: number } | null) {
  if (typeof window !== 'undefined') {
    try {
      if (s) localStorage.setItem(SIZE_STORAGE_KEY, JSON.stringify(s))
      else localStorage.removeItem(SIZE_STORAGE_KEY)
    } catch { /* quota/private — live state stays source of truth */ }
  }
  state = { ...state, shadowChatSize: s }
  emit()
}
// ТЗ №5 п.1 — emit-only live setter (никакого localStorage). Карта зовёт его на
// каждый pointermove resize-драга; на pointerup — setShadowChatSize (персист) +
// setShadowChatSizeLive(null). Резерв бара читает shadowChatSizeLive ?? size.
function setShadowChatSizeLive(s: { w: number; h: number } | null) {
  state = { ...state, shadowChatSizeLive: s }
  emit()
}
// Stable module-level reference (see GUARD comment below) — no-op body.
function notifyRecordingSaved() { /* WEB-CUT: attempts ephemeral, no persistence */ }

function snapshot(): VPState {
  return {
    shadowChatDock: state.shadowChatDock,
    setShadowChatDock,
    shadowChatDockHint: state.shadowChatDockHint,
    setShadowChatDockHint,
    shadowChatFreePos: state.shadowChatFreePos,
    setShadowChatFreePos,
    shadowChatSize: state.shadowChatSize,
    setShadowChatSize,
    shadowChatSizeLive: state.shadowChatSizeLive,
    setShadowChatSizeLive,
    youTrackForceShown: state.youTrackForceShown,
    setYouTrackForceShown,
    youTrackRecordingId: state.youTrackRecordingId,
    setYouTrackRecordingId,
    youAudible: state.youAudible,
    setYouAudible,
    notifyRecordingSaved,
  }
}
// GUARD: selectors passed to useVideoPlayerStore MUST return primitives or
// stable refs (e.g. `s.youAudible`, `s.setYouAudible` — a module-level named
// function, not a closure minted per snapshot() call). `useSyncExternalStore`
// compares the selector's result across renders with `Object.is`. A selector
// like `s => s` or one that returns a fresh object literal (`s => ({...})`)
// never compares equal to its previous result, so every render is seen as
// "changed" — this is an infinite re-render loop (React's nested-update
// limit trips), not a performance nit. See the `setYouTrackForceShown`/
// `setYouAudible` comment above for the exact bug this guards against.
export function useVideoPlayerStore<T>(selector: (s: VPState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(snapshot()), () => selector(snapshot()))
}
