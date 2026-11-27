// Player theme — ported verbatim (contract-wise) from the live Electron
// desktop app: electron/renderer/theme/player-theme.ts. Controls the
// appearance of the video-player workspace only.
//
// This web port ships ONLY the Dusk theme (3 variants: refined / indigo /
// mono). The desktop app additionally has parchment/graphite/blueprint/
// atelier — those are intentionally NOT ported here (PR#3 scope is Dusk
// only). The `PlayerVariant` id space is therefore trimmed to 'dusk'.

import { buildDuskPlayerTheme } from './dusk';

export type PlayerVariant = 'dusk';

export type TrackStyle = 'dots' | 'bars';

export interface TrackConfig {
  visible: boolean;
  y: number;        // px from top of range-bar
  height: number;
  color: string;
  style: TrackStyle;
}

export type PlayheadShape = 'line' | 'needle' | 'circle' | 'crosshair' | 'ribbon';
export type HandleShape = 'bar' | 'chevron' | 'hidden' | 'double-hairline' | 'wax-seal';
export type VisibilityMode = 'opacity' | 'stagger';

export interface PlayerTheme {
  id: PlayerVariant;
  name: string;

  panel: {
    // undefined = content-driven height (classic default).
    height?: number;
    paddingTop: number;
    paddingBottom: number;
    paddingX: number;
    background: string;
    borderTop: string;
    backdropBlur?: string;
    gap: number;
    // Optional light-panel overrides — default values are dark-theme-tuned.
    tooltipBg?: string;    // default 'rgba(0,0,0,0.85)'
    tooltipFg?: string;    // default theme.handles.color
    timeRowFg?: string;    // default '#fff'
    timeRowMuted?: string; // default '#aaa'
    // Optional decorative background pattern (applied as CSS background-image
    // over panel.background). Useful for blueprint-style grid paper.
    patternImage?: string;
    patternSize?: string;
  };

  bar: {
    height: number;
    trackHeight: number;
    trackColor: string;
    trackDimColor: string;
    highlightGradient: string;
    highlightGlow: string;
    // When set, the in-range highlight keeps the specified margin from the
    // top and bottom of the bar (so it sits inside the outer frame).
    highlightInsetY?: number;
    // Optional capsule frame around the in-range highlight rectangle. Dusk
    // uses this to mimic the designer's "golden bookplate" look — a thick
    // amber border with rounded corners on all 4 sides; the A/Б handles sit
    // on its top edge.
    highlightBorder?: string;
    highlightBorderRadius?: number;
    // Optional vertical alignment of the boundary handles relative to the
    // highlight frame. 'top' makes them sit on the top edge, half-above /
    // half-below — matches designer WaxHead spec. Default 'center'.
    handleAlign?: 'center' | 'top';
  };

  playhead: {
    width: number;
    color: string;
    glow?: string;
    shape: PlayheadShape;
    fullHeight: boolean;
    // Only used when shape === 'circle'.
    handleSize: number;
    handleBorder: string;
    // Optional: render a tiny SVG running/sitting person in the playhead
    // crosshair (Blueprint variant). Animates when playing, sits otherwise.
    runningMan?: boolean;
  };

  cueBlocks: {
    height: number;
    bottom: number;
    bgIdle: string;
    bgInRange: string;
    bgActive: string;
    borderIdle: string;
    borderInRange: string;
    borderActive: string;
    borderStyleIdle: 'solid' | 'dashed' | 'none';
    borderRadius: number;
    fontSize: number;
    // 0 = one row; 1 = alternating 2 lanes; 2 = free-stagger via packer.
    offsetLevel: 0 | 1 | 2;
    glossy: boolean;
    // Optional explicit foreground colours — required for light panels where
    // the default white-on-dark contrast would be invisible.
    textIdle?: string;     // default 'rgba(255,255,255,0.62)'
    textInRange?: string;  // default 'rgba(255,255,255,0.88)'
    textActive?: string;   // default '#fff'
  };

  handles: {
    shape: HandleShape;
    width: number;
    height: number;
    color: string;
    colorActive: string;
    // e.g. "4px 1px 1px 4px" for the classic asymmetric look.
    borderRadiusLeft: string;
    borderRadiusRight: string;
    // Wax-seal only: single characters stamped inside each seal.
    sealLeftLabel?: string;  // default 'A'
    sealRightLabel?: string; // default 'B'
    sealFg?: string;         // seal letter colour (default theme panel bg)
    // Double-hairline only: gap (px) between the two parallel lines.
    hairlineGap?: number;    // default width
    hairlineThickness?: number; // default 1
  };

  tracks: {
    shadow: TrackConfig;
    dictation: TrackConfig;
    subtitles: TrackConfig;
  };

  // Right-side panel (SettingsDrawer + cue list). Applied only while
  // `activePanel === 'video-player'`. Each variant fills this with values
  // derived from its own accent palette — no separate design needed.
  rightPanel: {
    background: string;             // drawer bg
    border: string;                  // drawer left border
    labelFg: string;                 // section labels (uppercase)
    selectBg: string;
    selectFg: string;
    selectBorder: string;
    pickerBg: string;
    pickerActiveFg: string;
    button: {                        // default tool button (Clip / Screenshot / shift)
      bg: string;
      border: string;
      fg: string;
    };
    modeButtonActive: {              // En / En+L1 / Скрыто when selected
      bg: string;
      border: string;
      fg: string;
    };
    primaryButton: {                 // "Начать тренировку"
      bg: string;
      border: string;
      fg: string;
    };
    secondaryButton: {               // "Рабочая область"
      bgIdle: string;
      bgActive: string;
      border: string;
      fg: string;
    };
    annotateButtonActive: {
      bg: string;
      border: string;
      fg: string;
    };
    shiftAdjustedFg: string;         // shift input colour when offset != 0
    checkboxAccent: string;
    cueList: {
      bg: string;
      rowBg: string;
      rowBgActive: string;
      rowBorderLeftActive: string;
      timestampFg: string;
      timestampFgActive: string;
      textFg: string;
      textFgActive: string;
      scrollbar: string;
    };
  };

  visibilityTiers: {
    mode: VisibilityMode;
    shownOpacity: number;
    hiddenOpacity: number;
    // Used when mode === 'stagger'.
    shownYOffset?: number;
    hiddenYOffset?: number;
  };

  // Optional decorative outer frame rendered around the timeline interior.
  // The playhead extends beyond it, creating the "stick with caps" look.
  outerFrame?: {
    insetTop: number;
    insetBottom: number;
    border: string;
    borderRadius: number;
    // Optional inset double-border (e.g. Blueprint's inner rule).
    innerBorder?: string;
    innerInset?: number;
  };

  // Optional caps drawn at the top and bottom of the playhead (outside the
  // outer frame). `shape`='none' skips rendering.
  playheadCaps?: {
    top?: { shape: 'ring' | 'square' | 'flag' | 'plaque-top' | 'none'; color: string; size: number };
    bottom?: { shape: 'ring' | 'square' | 'flag' | 'plaque-bottom' | 'none'; color: string; size: number };
  };

  // Optional overlay rendering the currently-active cue's text inside the
  // in-range highlight band (Atelier / Blueprint). When set, the style here
  // controls colour + font — typography should match the variant.
  activeCueLabel?: {
    font: string;
    color: string;
    padding?: string;
  };

  // Optional ruler row with tick marks and numeric mm:ss labels above the bar.
  timeRuler?: {
    visible: boolean;
    height: number;
    font: string;         // full CSS font shorthand
    color: string;
    tickColor: string;
    labelSize: number;
    // Minor ticks per major (1 = none, 2 = midpoint, 5 = quarter & midpoint).
    minorTicks: number;
  };

  /**
   * Optional bottom-bar control palette. When omitted, the workspace panel
   * renders neutral defaults derived from `panel`/`handles`/`bar` tokens.
   * Each variant fills only the fields it needs; missing fields fall back
   * to the generic look — so a half-defined section is fine.
   */
  bottomControls?: {
    /** Plain nav icon buttons: prev cue / cue-start / cue-end / next cue +
     *  Zoom+/-/Fit. Borderless, minimal — typically inherit the panel fg. */
    navButton?: {
      background?: string;
      border?: string;
      fg?: string;
      radius?: number | string; // px number or '50%' for round icons
      size?: number;            // square px (height & padding-derived width)
      iconSize?: number;
    };
    /** ▶/⏸ — typically more prominent than the rest of the nav cluster. */
    playButton?: {
      background?: string;
      border?: string;
      fg?: string;
      radius?: number | string;
      size?: number;
      glow?: string;
      iconSize?: number;
    };
    /** Pill-shaped buttons (training tabs Шадоуинг/Диктант/Пазлы, A-B). */
    pillButton?: {
      background?: string;
      border?: string;
      fg?: string;
      activeBackground?: string;
      activeBorder?: string;
      activeFg?: string;
      radius?: number;
      fontFamily?: string;
      fontStyle?: 'italic' | 'normal';
      fontWeight?: number | string;
      padding?: string;
    };
    /** Time read-out (current / total). */
    time?: {
      font?: string;       // full CSS font shorthand
      fg?: string;
      mutedFg?: string;
      /** Static separator string. Leave undefined and supply
       *  `separatorKey` instead for proper i18n. */
      separator?: string;
      /** i18n key resolved at render time (preferred over `separator`). */
      separatorKey?: string;
    };
    /** Exit button override — themes can supply a custom label
     *  (e.g. Atelier's "Close book") and palette. */
    exitButton?: {
      background?: string;
      border?: string;
      fg?: string;
      /** Static label. Leave undefined and supply `labelKey` for i18n. */
      label?: string;
      /** i18n key resolved at render time (preferred over `label`). */
      labelKey?: string;
    };
  };

  /**
   * CSS-variable contract from the Studio handoff (v1, 2026-04-29). Components
   * may reference these as `var(--surface)`, `var(--btn-bg)` etc. Keys mirror
   * the Designer doc (Player Handoff _standalone_.html, page 2):
   *
   *   --surface, --panel, --rail-bg, --topbar-bg, --drawer-bg, --timeline-bg,
   *   --btn-bg, --btn-active, --input-bg,
   *   --fg, --fg-dim, --fg-mute,
   *   --border, --border-strong, --accent, --accent-fg,
   *   --region-stt, --region-shadow, --region-dictation, --region-loop,
   *   --cue-active-bg, --seg-on, --seg-on-fg, --danger, --danger-border,
   *   --ui-font, --caption-font-en, --caption-font-ru
   *
   * Applied SCOPED to the player root element (NOT `:root`), unprefixed
   * (no `--player-` prefix) — set via `el.style.setProperty()` per key. See
   * `usePlayerTheme.ts`. (The desktop source comment claiming a `--player-`
   * prefix on `:root` is stale/inaccurate — the live app applies these
   * inline on the root element without a prefix.)
   */
  cssVars?: Record<string, string>;
}

// ── Dusk public API ─────────────────────────────────────────────────────

export type DuskVariant = 'site' | 'refined' | 'indigo' | 'mono';

export const DUSK_VARIANTS: DuskVariant[] = ['site', 'refined', 'indigo', 'mono'];

export function getPlayerTheme(variant: DuskVariant = 'site'): PlayerTheme {
  return buildDuskPlayerTheme(variant);
}
