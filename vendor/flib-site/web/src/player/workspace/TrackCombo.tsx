// TrackCombo — div-based combobox for the AUD / YOU workspace tracks.
//
// User design 2026-05-27: native <select> can't host per-option delete
// buttons, AND its rendering is platform-specific (looks alien against
// the player theme). We build a fully custom combobox:
//
//   - Closed: shows the current option's label.
//   - Open: portal-style dropdown anchored to the trigger, listing every
//           option with optional per-item delete (×) buttons.
//   - Click outside / Esc closes. Enter activates focused item.
//   - EVERY pointer + key event stops propagation so the player's
//     global handlers (play/pause on click, ←/→/Space on key) stay
//     quiet while the combo is open. Same playbook as ConfirmModal.
//
// Used twice in WorkspacePanelThemed: once for the AUD-track gutter
// (Original + Dub languages) and once for the YOU-track gutter
// (voice recordings + their delete buttons).

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface TrackComboOption {
  id: string;
  label: string;
  /** Optional secondary line shown beneath the label. */
  sub?: string;
  /** When true, the row gets a tiny × delete button. */
  deletable?: boolean;
  /** When true, the row gets a tiny ↑ promote button. */
  promotable?: boolean;
}

export interface TrackComboProps {
  /** Whatever the trigger button renders — usually the current option's
   *  short label. Pass null to render the trigger as "—". */
  triggerLabel: string;
  options: TrackComboOption[];
  /** ID of the currently selected option (matches one of options[].id). */
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Fires when the user clicks × on a deletable option. Caller mutates
   *  the underlying store; the combo just relays the gesture. */
  onDelete?: (id: string) => void;
  /** Fires when the user clicks ↑ on a promotable option. */
  onPromote?: (id: string) => void;
  /** Optional title attribute for the trigger button. */
  title?: string;
  /** Disabled trigger — combo never opens. */
  disabled?: boolean;
  /** ARIA label for screen readers. */
  ariaLabel?: string;
  /** Inline style overrides for the trigger button. */
  triggerStyle?: React.CSSProperties;
  /** Class name appended to the trigger button. */
  triggerClassName?: string;
}

export const TrackCombo: React.FC<TrackComboProps> = ({
  triggerLabel, options, selectedId, onSelect, onDelete, onPromote,
  title, disabled, ariaLabel, triggerStyle, triggerClassName,
}) => {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  // Position dropdown below trigger, clamp to viewport. Bug
  // 2026-05-28: combo лежит в нижней рабочей панели плеера —
  // r.bottom + 4 часто оказывается ниже window.innerHeight, и
  // dropdown рендерится за нижний край viewport. Поэтому если
  // оценочная высота меню (max 320, см. maxHeight ниже) не
  // влезает под trigger — flip ABOVE: top = r.top - height - 4.
  useEffect(() => {
    if (!open) return;
    const recompute = () => {
      const btn = triggerRef.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      // Dropdown min width 240 — must fit «Перенести в AUD» и «Удалить»
      // even when the trigger itself shrinks to a few pixels at zoom-out.
      const width = Math.max(240, Math.min(360, r.width + 60));
      let left = r.left;
      if (left + width > window.innerWidth - 8) left = window.innerWidth - 8 - width;
      if (left < 8) left = 8;
      // Estimate dropdown height: ≤320 (matches maxHeight on the
      // dropdown root). Probe live size after first render via a
      // second recompute would be slicker, but the estimate is enough
      // to pick the correct side reliably.
      const estHeight = 320;
      const spaceBelow = window.innerHeight - r.bottom;
      const spaceAbove = r.top;
      let top: number;
      if (spaceBelow >= estHeight + 8 || spaceBelow >= spaceAbove) {
        top = r.bottom + 4;
      } else {
        top = Math.max(8, r.top - estHeight - 4);
      }
      setPos({ top, left, width });
    };
    recompute();
    window.addEventListener('resize', recompute);
    window.addEventListener('scroll', recompute, true);
    return () => {
      window.removeEventListener('resize', recompute);
      window.removeEventListener('scroll', recompute, true);
    };
  }, [open]);

  // Outside click + Esc to close.
  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (target && (triggerRef.current?.contains(target) || dropdownRef.current?.contains(target))) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const stopAll = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={title}
        disabled={disabled}
        className={triggerClassName}
        // Bug 16 (2026-05-28) — open on pointerDown (left button only),
        // not on click. The bar's drag-and-pan logic uses pointer events
        // too; if anything in the parent tree consumes pointerdown before
        // React's click can fire, the combo would never open. Triggering
        // on the very first pointerdown sidesteps the whole question.
        // Audit h (a11y): preventDefault on pointerdown would strip the
        // browser's default focus behavior — bad for Tab navigation and
        // screen readers. We restore focus manually via the ref.
        onPointerDown={(e) => {
          if (e.button !== 0) return; // ignore middle/right here
          e.stopPropagation();
          e.preventDefault();
          if (disabled) return;
          setOpen((v) => !v);
          // Manual focus restore — preventDefault above swallowed the
          // browser's auto-focus on click. Without this, keyboard
          // navigation after opening is broken.
          try { triggerRef.current?.focus(); } catch { /* SSR */ }
        }}
        onClick={(e) => { e.stopPropagation(); }}
        onMouseDown={stopAll}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.stopPropagation();
            e.preventDefault();
            if (!disabled) setOpen((v) => !v);
          }
        }}
        style={{
          ...triggerStyle,
          // Hover affordance — when caller styled `background:transparent`
          // the combo is otherwise invisible until pointer enters. Brief
          // tinted wash + outline says «здесь кликабельно».
          ...(hovered ? {
            background: 'color-mix(in srgb, var(--accent, #E0B341) 14%, transparent)',
            outline: '1px solid color-mix(in srgb, var(--accent, #E0B341) 40%, transparent)',
            outlineOffset: -1,
          } : {}),
        }}
      >
        {triggerLabel}
      </button>

      {open && pos && createPortal(
        <div
          ref={dropdownRef}
          role="listbox"
          onMouseDown={stopAll}
          onPointerDown={stopAll}
          onClick={stopAll}
          onContextMenu={stopAll}
          onWheel={stopAll}
          style={{
            position: 'fixed',
            top: pos.top, left: pos.left, width: pos.width,
            maxHeight: 320, overflowY: 'auto',
            zIndex: 9100,
            background: 'var(--panel, var(--surface, rgba(20,20,20,0.96)))',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            border: '1px solid var(--border, rgba(255,255,255,0.20))',
            borderRadius: 8,
            boxShadow: '0 12px 36px rgba(0,0,0,0.55)',
            color: 'var(--fg, #eee)',
            padding: 4,
            fontFamily: 'var(--ui-font, system-ui), sans-serif',
            fontSize: 12.5,
          }}
        >
          {options.length === 0 && (
            <div style={{ padding: '10px 12px', color: 'var(--fg-dim, #999)', fontStyle: 'italic' }}>
              — пусто —
            </div>
          )}
          {options.map((opt) => {
            const isSelected = opt.id === selectedId;
            return (
              <div
                key={opt.id}
                role="option"
                aria-selected={isSelected}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(opt.id);
                  setOpen(false);
                }}
                onMouseDown={stopAll}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '7px 10px',
                  borderRadius: 5,
                  cursor: 'pointer',
                  background: isSelected ? 'var(--accent-dim, rgba(224,179,65,0.18))' : 'transparent',
                  color: isSelected ? 'var(--accent, #E0B341)' : 'var(--fg, #eee)',
                  transition: 'background 120ms',
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-hover, rgba(255,255,255,0.06))';
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = 'transparent';
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 12.5, fontWeight: isSelected ? 700 : 500,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {opt.label}
                  </div>
                  {opt.sub && (
                    <div style={{
                      fontSize: 10, color: 'var(--fg-dim, #888)',
                      marginTop: 2,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {opt.sub}
                    </div>
                  )}
                </div>
                {opt.promotable && onPromote && (
                  <button
                    type="button"
                    aria-label={`Перенести в AUD ${opt.label}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      onPromote(opt.id);
                      // Audit b: close dropdown — otherwise ConfirmModal
                      // opens on top of an unclosed dropdown (focus trap
                      // + visual mess).
                      setOpen(false);
                    }}
                    onMouseDown={stopAll}
                    title="Перенести в AUD"
                    style={{
                      flexShrink: 0,
                      width: 22, height: 22,
                      borderRadius: 4,
                      background: 'transparent',
                      color: 'var(--fg-dim, #888)',
                      border: '1px solid var(--border, rgba(255,255,255,0.14))',
                      cursor: 'pointer',
                      fontSize: 13, lineHeight: 1,
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      fontFamily: 'inherit',
                      transition: 'background 120ms, color 120ms, border-color 120ms',
                    }}
                    onMouseEnter={(e) => {
                      const el = e.currentTarget as HTMLButtonElement;
                      el.style.background = 'var(--accent, #E0B341)';
                      el.style.color = 'var(--accent-fg, #1A0A0C)';
                      el.style.borderColor = 'var(--accent, #E0B341)';
                    }}
                    onMouseLeave={(e) => {
                      const el = e.currentTarget as HTMLButtonElement;
                      el.style.background = 'transparent';
                      el.style.color = 'var(--fg-dim, #888)';
                      el.style.borderColor = 'var(--border, rgba(255,255,255,0.14))';
                    }}
                  >
                    ↑
                  </button>
                )}
                {opt.deletable && onDelete && (
                  <button
                    type="button"
                    aria-label={`Удалить ${opt.label}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      onDelete(opt.id);
                      // Audit b: close after destructive action so the
                      // shrinking option list doesn't get re-rendered
                      // under the user's cursor mid-click.
                      setOpen(false);
                    }}
                    onMouseDown={stopAll}
                    title="Удалить запись"
                    style={{
                      flexShrink: 0,
                      width: 22, height: 22,
                      borderRadius: 4,
                      background: 'transparent',
                      color: 'var(--fg-dim, #888)',
                      border: '1px solid var(--border, rgba(255,255,255,0.14))',
                      cursor: 'pointer',
                      fontSize: 14, lineHeight: 1,
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      fontFamily: 'inherit',
                      transition: 'background 120ms, color 120ms, border-color 120ms',
                    }}
                    onMouseEnter={(e) => {
                      const el = e.currentTarget as HTMLButtonElement;
                      el.style.background = '#c44';
                      el.style.color = '#fff';
                      el.style.borderColor = '#c44';
                    }}
                    onMouseLeave={(e) => {
                      const el = e.currentTarget as HTMLButtonElement;
                      el.style.background = 'transparent';
                      el.style.color = 'var(--fg-dim, #888)';
                      el.style.borderColor = 'var(--border, rgba(255,255,255,0.14))';
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
};
