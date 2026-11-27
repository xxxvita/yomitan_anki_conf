// shadow-card-size.ts — ТЗ №3 pure geometry helpers for the Shadowing card.
// Kept JSX-free so the resize-clamp, docked-width and zero-scroll feed math are
// unit-testable without RTL (same idiom as shadow-phase.ts / shadow-arm-cue-
// index.ts). ShadowCardLifted re-exports DOCKED_WIDTH from here so the single
// source of truth lives in a lightweight module WorkspacePanelThemed can import
// WITHOUT pulling in the whole React card component (avoids a heavy/cyclic dep).

/** Persisted free-float / docked size of the card. */
export interface ShadowSize { w: number; h: number }

// ТЗ №3 п.1 — resize floor. Docked width falls back to DOCKED_WIDTH (420) when
// no size is saved yet; the resize floor (320) is intentionally SMALLER so a
// user who deliberately shrinks the card below 420 keeps that width when docked
// ("420 = дефолт/минимум" means default, not a hard resize floor).
export const SHADOW_MIN_W = 320
export const SHADOW_MIN_H = 240

// WEB-SEAM: exported so WorkspacePanelThemed can import the single source of
// truth for the docked-inset width (desktop: index.tsx:47 imports it the same
// way). 420 is the pristine default when the user has never resized.
export const DOCKED_WIDTH = 420

// ТЗ №5 п.1 — минимальная ширина, которую резерв ОБЯЗАН оставить бару под
// контролы (транспорт/пилюли/слоты — они переносятся в 2-3 ряда через уже
// имеющийся flexWrap). Владелец (видео-прогон 2026-07-10): «панель shadowing
// займёт вот такое место, а СПРАВА останется маленькая наша панелька с
// управлением». Прежний кламп floor(bar/2) ЗАПРЕЩАЛ карте занять >50% → при
// попытке сделать её шире И карта, И резерв замерзали на ~50% («меняю ширину —
// резерв не меняется»). Теперь потолок = barWidth − этот минимум.
export const SHADOW_MIN_CONTROLS_W = 280

/**
 * Clamp a proposed size to [min .. viewport]. Viewport bounds guard against a
 * drag flinging the card larger than the screen; the min floor keeps it usable.
 * Non-finite inputs (NaN from a bad pointer delta) collapse to the min.
 */
export function clampShadowSize(w: number, h: number, vw: number, vh: number): ShadowSize {
  const maxW = Math.max(SHADOW_MIN_W, Number.isFinite(vw) ? vw : SHADOW_MIN_W)
  const maxH = Math.max(SHADOW_MIN_H, Number.isFinite(vh) ? vh : SHADOW_MIN_H)
  const cw = Number.isFinite(w) ? w : SHADOW_MIN_W
  const ch = Number.isFinite(h) ? h : SHADOW_MIN_H
  return {
    w: Math.min(Math.max(cw, SHADOW_MIN_W), maxW),
    h: Math.min(Math.max(ch, SHADOW_MIN_H), maxH),
  }
}

/** Docked-inset width the timeline reserves: the user's saved width, or 420. */
export function dockedWidth(size: ShadowSize | null | undefined): number {
  return size && Number.isFinite(size.w) ? size.w : DOCKED_WIDTH
}

/**
 * ТЗ №4 п.1 — ЕДИНЫЙ источник истины docked-ширины. И видимая ширина карты в доке
 * (ShadowCardLifted.containerStyle), и таймлайн-резерв (WorkspacePanelThemed
 * dockReserve) считают ОДНО значение через эту функцию с ОДНИМ и тем же barWidth
 * ([data-workspace-bar]) → reserve ВСЕГДА == видимой ширине карты.
 *
 * Диагноз бага (Screenshot_20260710_182753): раньше карта рисовалась на raw
 * `dockedWidth(size)` (например 800), а резерв клампился bar/2 (например 640)
 * ОТДЕЛЬНОЙ inline-формулой (MED-9). При широкой карте (size.w > bar/2) резерв
 * оказывался МЕНЬШЕ карты → карта перекрывала таймлайн/транспорт на разницу.
 * Фикс: тот же кламп bar/2 применяется к ОБОИМ через этот helper.
 *
 * barWidth<=0 (неизмерено / jsdom no-layout) → без клампа (raw dockedWidth), как
 * и прежнее поведение резерва до измерения.
 *
 * ТЗ №5 п.1 — ПОТОЛОК изменён с floor(bar/2) на (barWidth − SHADOW_MIN_CONTROLS_W):
 * владелец потребовал, чтобы докнутая карта могла занять БОЛЬШЕ половины бара, а
 * контролам оставался лишь минимальный кусок (они переносятся в 2-3 ряда через
 * flexWrap транспорт-ряда). Прежний кламп bar/2 замораживал и карту, и резерв на
 * 50% («меняю ширину — резерв/карта не меняются»). Пол резерва = SHADOW_MIN_W
 * (320): при УЗКОМ баре (bar − controls < 320) резерв держится на 320 (карта чуть
 * перекрывает — приемлемо против непригодной полоски). Порядок max(320, min(...))
 * сохранён: пол выигрывает у потолка на узком баре. barWidth<=0 → raw (до layout).
 */
export function dockedReserveWidth(size: ShadowSize | null | undefined, barWidth: number): number {
  const raw = dockedWidth(size)
  if (!(barWidth > 0)) return raw
  return Math.max(SHADOW_MIN_W, Math.min(raw, barWidth - SHADOW_MIN_CONTROLS_W))
}

export interface VisibleFeed {
  /** How many history one-liners to render (newest first). */
  visibleHistory: number
  /** How many older attempts are collapsed into the "+K ранних" line (0 = none). */
  hiddenEarly: number
}

/**
 * ТЗ №3 п.2 — zero-scroll feed: given the pixel budget of the feed container,
 * decide how many compact history rows fit and how many collapse into a single
 * "+K ранних" line. The latest attempt renders as a full B1 block ABOVE the
 * history, so its height is reserved up front (`latestReservedH`).
 *
 *   slots = floor((availH - latestReservedH) / rowH)
 *   - historyCount <= slots        → show all, no "+K".
 *   - otherwise                    → the last slot is spent on the "+K" line,
 *                                    so show (slots-1) newest, collapse the rest.
 *
 * Guards: 0 history → nothing; rowH<=0 (unmeasured) → show all (never hide until
 * a real measurement lands, avoids a "+K" flash before layout).
 */
export function computeVisibleFeed(
  historyCount: number,
  availH: number,
  rowH: number,
  latestReservedH: number,
): VisibleFeed {
  if (historyCount <= 0) return { visibleHistory: 0, hiddenEarly: 0 }
  if (!(rowH > 0) || !Number.isFinite(availH)) return { visibleHistory: historyCount, hiddenEarly: 0 }
  const usable = Math.max(0, availH - Math.max(0, latestReservedH))
  const slots = Math.floor(usable / rowH)
  if (slots >= historyCount) return { visibleHistory: historyCount, hiddenEarly: 0 }
  const visibleHistory = Math.max(0, slots - 1) // one slot spent on the "+K" line
  return { visibleHistory, hiddenEarly: historyCount - visibleHistory }
}
