import type { PlayerTheme, DuskVariant } from './player-theme';

// Dusk — ported from the live Electron desktop app
// (electron/renderer/theme/player-themes/dusk.ts). Sub-variants per
// designer token map; 'site' (палитра сайта, ПО УМОЛЧАНИЮ) добавлен 2026-11-25:
//   • 'site'     (default) — палитра кабинета flib.club
//   • 'refined' — warm bordeaux, amber accent
//   • 'indigo'   — cool plum, gold accent
//   • 'mono'     — graphite slate, amber accent
//
// The desktop source also ships a legacy 'original' variant for migration.
// It is intentionally NOT ported here — this web port's public API only
// ever surfaces 'refined' | 'indigo' | 'mono' (see DUSK_VARIANTS).
//
// Each variant ships a full PlayerTheme. JS-level fields (cueBlocks.bgActive,
// bar.highlightGradient, tracks.shadow.color, …) are derived from the
// variant's accent palette, while cssVars carry the full CSS-variable
// contract (--surface, --panel, --region-*, --caption-plate-*, …) that
// child components read directly via var().

interface DuskPalette {
  accent: string;          // primary accent (playhead, primary play, region pin, seg-on)
  accentFg: string;        // foreground over accent (e.g. play icon on amber)
  surface: string;         // base bg
  panel: string;           // panel bg
  railBg: string;          // left rail
  topbarBg: string;        // top bar
  drawerBg: string;        // right drawer
  timelineBg: string;      // timeline container
  btnBg: string;
  btnActive: string;
  inputBg: string;
  fg: string;
  fgDim: string;
  fgMute: string;
  border: string;          // neutral, NOT accent-tinted (per token spec)
  borderStrong: string;
  region: { dictation: string; shadow: string; loop: string; stt: string };
  cueActiveBg: string;        // ≥ 20% opacity — drawer cue list
  cueActiveBgStrong: string;  // active cue ribbon on timeline
  trackAudBg: string;
  trackAudBorder: string;
  trackAudWave: string;
  cueRestBg: string;
  cueRestBorder: string;
  segOn: string;
  segOnFg: string;
  danger: string;
  dangerBorder: string;
  // Optional caption plate (subtitle glass background)
  captionPlateBg?: string;
  captionPlatePad?: string;
  captionPlateRadius?: string;
  captionPlateBlur?: string;
  captionEnFg?: string;
  ok?: string;                // --ok (по умолчанию #86D27A; у 'site' — #9ab87a)
}

const PALETTES: Record<DuskVariant, DuskPalette> = {
  site: {
    // Палитра основного сайта (кабинет, site/cabinet/cabinet.css:19-24): тёплый
    // графит, янтарь #d4a574. Вариант по умолчанию (решение владельца 2026-11-25);
    // refined/indigo/mono остаются для будущего переключателя (доска #434).
    accent: '#d4a574', accentFg: '#16140f',
    surface: '#16140f', panel: '#1d1a14',
    railBg: '#16140f', topbarBg: '#16140f',
    drawerBg: '#1d1a14', timelineBg: '#16140f',
    btnBg: 'rgba(0,0,0,0.28)', btnActive: 'rgba(212,165,116,0.18)',
    inputBg: 'rgba(0,0,0,0.45)',
    fg: '#e8e2d3', fgDim: '#a39c86', fgMute: '#857d69',
    border: 'rgba(163,156,134,0.16)', borderStrong: 'rgba(163,156,134,0.30)',
    region: { dictation: '#dfb389', shadow: '#d4a574', loop: '#a9845c', stt: '#7a5e3f' },
    cueActiveBg: 'rgba(212,165,116,0.16)',
    cueActiveBgStrong: 'rgba(212,165,116,0.28)',
    trackAudBg: '#16140f', trackAudBorder: 'rgba(163,156,134,0.16)', trackAudWave: '#8a7f68',
    cueRestBg: 'rgba(232,226,211,0.06)', cueRestBorder: 'rgba(163,156,134,0.16)',
    segOn: '#d4a574', segOnFg: '#16140f',
    danger: '#d9826f', dangerBorder: 'rgba(217,130,111,0.45)',
    ok: '#9ab87a',
    captionPlateBg: 'rgba(15,13,10,0.62)',
    captionPlatePad: '6px 18px', captionPlateRadius: '4px',
    captionPlateBlur: 'blur(8px)', captionEnFg: '#f0e2c6',
  },
  refined: {
    // Warm bordeaux. Panel/drawer raised one notch in luminance + chroma so
    // the warmth reads at a glance against the typical dark video frame.
    accent: '#E8B84A', accentFg: '#100707',
    surface: '#160B0D', panel: '#2A1419',
    railBg: '#1C0F11', topbarBg: '#150A0C',
    drawerBg: '#2A1419', timelineBg: '#1F1014',
    btnBg: 'rgba(0,0,0,0.32)', btnActive: 'rgba(232,184,74,0.18)',
    inputBg: 'rgba(0,0,0,0.5)',
    fg: '#F3E6CC', fgDim: '#B89C7A', fgMute: '#7A6248',
    border: 'rgba(184,156,122,0.16)', borderStrong: 'rgba(184,156,122,0.30)',
    region: { dictation: '#FFCF6B', shadow: '#E8B84A', loop: '#B88A2A', stt: '#7A5C1C' },
    cueActiveBg: 'rgba(232,184,74,0.22)',
    cueActiveBgStrong: 'rgba(232,184,74,0.28)',
    trackAudBg: '#1A1012', trackAudBorder: 'rgba(184,156,122,0.14)', trackAudWave: '#8A6E55',
    cueRestBg: 'rgba(243,230,204,0.06)', cueRestBorder: 'rgba(184,156,122,0.16)',
    segOn: '#E8B84A', segOnFg: '#0A0607',
    danger: '#D85050', dangerBorder: 'rgba(216,80,80,0.40)',
    captionPlateBg: 'rgba(10,6,7,0.62)',
    captionPlatePad: '6px 18px', captionPlateRadius: '4px',
    captionPlateBlur: 'blur(8px)', captionEnFg: '#FFE8B5',
  },
  indigo: {
    // Cool plum. Panel/drawer are fully opaque deeper plum so the hue is
    // unambiguous (transparent rgba(22,20,38,.92) read as black on dark
    // video → couldn't distinguish from mono).
    accent: '#F0B441', accentFg: '#0E0B1C',
    surface: '#120F22', panel: '#1F1A36',
    railBg: '#15112A', topbarBg: '#100D22',
    drawerBg: '#1F1A36', timelineBg: '#161226',
    btnBg: 'rgba(255,255,255,0.04)', btnActive: 'rgba(240,180,65,0.18)',
    inputBg: 'rgba(0,0,0,0.45)',
    fg: '#E8E4F0', fgDim: '#9A93B5', fgMute: '#5E5876',
    border: 'rgba(154,147,181,0.18)', borderStrong: 'rgba(154,147,181,0.32)',
    region: { dictation: '#FFD27A', shadow: '#F0B441', loop: '#C8902A', stt: '#9A6E1F' },
    cueActiveBg: 'rgba(240,180,65,0.22)',
    cueActiveBgStrong: 'rgba(240,180,65,0.28)',
    trackAudBg: 'rgba(255,255,255,0.025)', trackAudBorder: 'rgba(154,147,181,0.14)', trackAudWave: '#6E658A',
    cueRestBg: 'rgba(232,228,240,0.05)', cueRestBorder: 'rgba(154,147,181,0.18)',
    segOn: '#F0B441', segOnFg: '#0A0913',
    danger: '#E4666B', dangerBorder: 'rgba(228,102,107,0.38)',
    captionPlateBg: 'rgba(10,9,19,0.62)',
    captionPlatePad: '6px 18px', captionPlateRadius: '4px',
    captionPlateBlur: 'blur(8px)', captionEnFg: '#F0B441',
  },
  mono: {
    // Graphite slate. Panel/drawer lifted to a clearly grey tone so it sits
    // above the indigo's plum and the refined's bordeaux without ambiguity.
    accent: '#E8B84A', accentFg: '#0F1013',
    surface: '#15171B', panel: '#1F2228',
    railBg: '#181A1F', topbarBg: '#13151A',
    drawerBg: '#1F2228', timelineBg: '#181B20',
    btnBg: 'rgba(255,255,255,0.035)', btnActive: 'rgba(232,184,74,0.16)',
    inputBg: 'rgba(0,0,0,0.4)',
    fg: '#EDEEF0', fgDim: '#8B8E94', fgMute: '#55585E',
    border: 'rgba(255,255,255,0.07)', borderStrong: 'rgba(255,255,255,0.14)',
    region: { dictation: '#FFD37A', shadow: '#E8B84A', loop: '#B8902F', stt: '#7E6420' },
    cueActiveBg: 'rgba(232,184,74,0.20)',
    cueActiveBgStrong: 'rgba(232,184,74,0.26)',
    trackAudBg: '#191B1F', trackAudBorder: 'rgba(255,255,255,0.05)', trackAudWave: '#6F727A',
    cueRestBg: 'rgba(237,238,240,0.05)', cueRestBorder: 'rgba(255,255,255,0.07)',
    segOn: '#E8B84A', segOnFg: '#0C0D0F',
    danger: '#D4575C', dangerBorder: 'rgba(212,87,92,0.38)',
    captionPlateBg: 'rgba(12,13,15,0.68)',
    captionPlatePad: '6px 18px', captionPlateRadius: '4px',
    captionPlateBlur: 'blur(8px)', captionEnFg: '#FFFFFF',
  },
};

// ──────────────────────────────────────────────────────────────────────
// Builder
// ──────────────────────────────────────────────────────────────────────

// Cache keyed by variant so getPlayerTheme() returns a stable reference —
// without this, a React selector reading `.cssVars` would rerender on
// every read (new object identity each call).
const _buildCache = new Map<DuskVariant, PlayerTheme>();

export function buildDuskPlayerTheme(variant: DuskVariant = 'site'): PlayerTheme {
  const cached = _buildCache.get(variant);
  if (cached) return cached;
  const built = _build(variant);
  _buildCache.set(variant, built);
  return built;
}

function _build(variant: DuskVariant): PlayerTheme {
  const p = PALETTES[variant] || PALETTES.site;

  // Helper for the gloss gradient on cue blocks (uses accent + region.shadow).
  const cueGradientIdle    = `linear-gradient(180deg, ${alpha(p.accent, 0.22)} 0%, ${alpha(p.accent, 0.10)} 100%)`;
  const cueGradientInRange = `linear-gradient(180deg, ${alpha(p.region.shadow, 0.30)} 0%, ${alpha(p.region.shadow, 0.16)} 100%)`;
  const cueGradientActive  = `linear-gradient(180deg, ${alpha(p.region.shadow, 0.55)} 0%, ${alpha(p.region.shadow, 0.32)} 100%)`;

  const cssVars: Record<string, string> = {
    '--surface':             p.surface,
    '--panel':               p.panel,
    '--rail-bg':             p.railBg,
    '--topbar-bg':           p.topbarBg,
    '--drawer-bg':           p.drawerBg,
    '--timeline-bg':         p.timelineBg,
    '--btn-bg':              p.btnBg,
    '--btn-active':          p.btnActive,
    '--input-bg':            p.inputBg,
    '--fg':                  p.fg,
    '--fg-dim':              p.fgDim,
    '--fg-mute':             p.fgMute,
    '--border':              p.border,
    '--border-strong':       p.borderStrong,
    '--accent':              p.accent,
    '--accent-fg':           p.accentFg,
    '--region-shadow':       p.region.shadow,
    '--region-dictation':    p.region.dictation,
    '--region-loop':         p.region.loop,
    '--region-stt':          p.region.stt,
    '--cue-active-bg':        p.cueActiveBg,
    '--cue-active-bg-strong': p.cueActiveBgStrong,
    '--track-aud-bg':        p.trackAudBg,
    '--track-aud-border':    p.trackAudBorder,
    '--track-aud-wave':      p.trackAudWave,
    '--cue-rest-bg':         p.cueRestBg,
    '--cue-rest-border':     p.cueRestBorder,
    '--seg-on':              p.segOn,
    '--seg-on-fg':           p.segOnFg,
    '--danger':              p.danger,
    '--danger-border':       p.dangerBorder,
    '--ok':                  p.ok ?? '#86D27A',
    '--warn':                p.accent,
    '--ui-font':             '"IBM Plex Sans", system-ui, sans-serif',
    '--caption-font-en':     '"IBM Plex Sans", system-ui, sans-serif',
    '--caption-font-ru':     '"PT Serif", Georgia, serif',
  };
  if (p.captionPlateBg) {
    cssVars['--caption-plate-bg']     = p.captionPlateBg;
    cssVars['--caption-plate-pad']    = p.captionPlatePad || '0';
    cssVars['--caption-plate-radius'] = p.captionPlateRadius || '0';
    cssVars['--caption-plate-blur']   = p.captionPlateBlur || 'none';
  }
  if (p.captionEnFg) cssVars['--caption-en-fg'] = p.captionEnFg;

  return {
    id: 'dusk',
    name: 'Dusk',
    panel: {
      paddingTop: 12,
      paddingBottom: 16,
      paddingX: 18,
      background: p.panel,
      borderTop: `1px solid ${p.border}`,
      backdropBlur: 'blur(10px)',
      gap: 10,
    },
    bar: {
      height: 60,
      trackHeight: 4,
      trackColor: alpha(p.accent, 0.15),
      trackDimColor: alpha(p.surface, 0.4),
      // Highlight: subtle warm wash inside the capsule (the heavy work is
      // done by the gold frame below). Lower the alpha so the cue text on
      // top stays readable.
      highlightGradient: `linear-gradient(180deg, ${alpha(p.accent, 0.16)} 0%, ${alpha(p.region.shadow, 0.10)} 100%)`,
      highlightGlow: `0 0 14px ${alpha(p.accent, 0.18)}`,
      // Designer's "golden bookplate" frame around the active region:
      // 2px solid amber, 10px rounded corners, A/Б sit on the top edge.
      highlightBorder: `2px solid ${p.accent}`,
      highlightBorderRadius: 10,
      handleAlign: 'top',
    },
    playhead: {
      // Designer Dusk needle = thin 1px stem (the 3px legacy was too heavy
      // next to the diamond head). Glow stays for a subtle amber halo.
      width: 1,
      color: p.accent,
      glow: `0 0 6px ${alpha(p.accent, 0.55)}`,
      shape: 'needle',
      fullHeight: true,
      handleSize: 0,
      handleBorder: 'none',
    },
    cueBlocks: {
      height: 44,
      bottom: 4,
      bgIdle: cueGradientIdle,
      bgInRange: cueGradientInRange,
      bgActive: cueGradientActive,
      borderIdle: alpha(p.accent, 0.5),
      borderInRange: alpha(p.region.shadow, 0.65),
      borderActive: p.region.shadow,
      borderStyleIdle: 'solid',
      borderRadius: 8,
      fontSize: 11,
      offsetLevel: 0,
      glossy: true,
    },
    handles: {
      // Designer's WaxHead spec: round amber discs with A/Б labels and a
      // soft surface-coloured ring. The wax-seal renderer handles the gloss
      // + shadow stack — we just supply colour, size and labels.
      shape: 'wax-seal',
      width: 22,
      height: 22,
      color: p.accent,
      colorActive: lighten(p.accent),
      borderRadiusLeft: '50%',
      borderRadiusRight: '50%',
      sealLeftLabel: 'A',
      sealRightLabel: 'Б',
      sealFg: p.accentFg,
    },
    tracks: {
      shadow:    { visible: true,  y: 2,  height: 6,  color: p.region.shadow, style: 'bars' },
      dictation: { visible: false, y: 0,  height: 0,  color: p.region.dictation, style: 'bars' },
      subtitles: { visible: true,  y: 12, height: 44, color: p.accent, style: 'bars' },
    },
    visibilityTiers: {
      mode: 'opacity',
      shownOpacity: 1,
      hiddenOpacity: 0.35,
    },
    timeRuler: {
      visible: true,
      height: 18,
      font: 'italic 12px Georgia, "Playfair Display", "Times New Roman", serif',
      color: p.fgDim,
      tickColor: alpha(p.fgDim, 0.55),
      labelSize: 12,
      minorTicks: 2,
    },
    rightPanel: {
      background: p.drawerBg,
      border: `1px solid ${p.border}`,
      labelFg: p.fgMute,
      selectBg: alpha(p.surface, 0.6),
      selectFg: p.fg,
      selectBorder: alpha(p.accent, 0.35),
      pickerBg: p.surface,
      pickerActiveFg: p.accent,
      button: {
        bg: alpha(p.accent, 0.12),
        border: alpha(p.accent, 0.35),
        fg: p.fg,
      },
      modeButtonActive: {
        bg: `linear-gradient(180deg, ${alpha(p.region.shadow, 0.4)}, ${alpha(p.region.shadow, 0.2)})`,
        border: p.region.shadow,
        fg: p.fg,
      },
      primaryButton: {
        bg: `linear-gradient(180deg, ${alpha(p.accent, 0.32)}, ${alpha(p.region.shadow, 0.25)})`,
        border: p.accent,
        fg: '#fff9e6',
      },
      secondaryButton: {
        bgIdle: alpha(p.region.shadow, 0.15),
        bgActive: alpha(p.region.shadow, 0.38),
        border: alpha(p.region.shadow, 0.55),
        fg: p.fg,
      },
      annotateButtonActive: {
        bg: alpha(p.accent, 0.3),
        border: p.accent,
        fg: p.fg,
      },
      shiftAdjustedFg: p.region.shadow,
      checkboxAccent: p.accent,
      cueList: {
        bg: 'transparent',
        rowBg: 'transparent',
        rowBgActive: p.cueActiveBg,
        rowBorderLeftActive: p.region.shadow,
        timestampFg: p.fgMute,
        timestampFgActive: p.accent,
        textFg: p.fgDim,
        textFgActive: p.fg,
        scrollbar: alpha(p.accent, 0.35),
      },
    },
    cssVars,
  };
}

// rgba string from #hex + opacity. Best-effort: returns rgba() for #rrggbb,
// falls back to original string for already-rgba values.
function alpha(c: string, a: number): string {
  if (c.startsWith('#') && c.length === 7) {
    const r = parseInt(c.slice(1, 3), 16);
    const g = parseInt(c.slice(3, 5), 16);
    const b = parseInt(c.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
  }
  return c;
}

// Lighter accent for active handle hover. Bumps each channel toward white.
function lighten(c: string): string {
  if (c.startsWith('#') && c.length === 7) {
    const r = Math.min(255, parseInt(c.slice(1, 3), 16) + 30);
    const g = Math.min(255, parseInt(c.slice(3, 5), 16) + 30);
    const b = Math.min(255, parseInt(c.slice(5, 7), 16) + 30);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }
  return c;
}
