/*
 * Copyright (C) 2023-2025  Yomitan Authors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */
// Hotkeys of the copied player win over YouTube's while the panel is shown (spec §3 item 10).
//
// The copy listens for keys on `document` and `window`, in both phases (useHotkeys.ts:157,
// WorkspacePanelThemed.tsx:404/427, useTrackSelection.ts:29-31, TranslateMenu.tsx:26,
// RegionMenu.tsx:22, TrackCombo.tsx:126, FullscreenContainer.tsx:73, LeftRail.tsx:86), and React
// listens on its root and portal containers (the copy's onKeyDown props). YouTube listens on nodes
// of the same DOM. Stopping the event anywhere would starve the copy as well, so:
//
// 1. The key gate (installKeyGate) is the FIRST keydown/keyup/keypress listener on `window` in the
//    capture phase: keys.js, a tiny script of the extension's isolated world registered at
//    `document_start`, installs it before any page script runs. Nothing in a DOM dispatch comes
//    before the first window-capture listener, so no YouTube listener - window or document, capture
//    or bubble - can precede it.
// 2. The gate also replaces `addEventListener` / `removeEventListener` of `window` and `document`
//    (own properties, in the isolated world only: page scripts have their own wrappers of these
//    nodes and never see them; the copy's react-dom root and portal nodes are added with track()).
//    Every key listener of the extension's world is still registered with the DOM as it was given
//    (the copy's behind a thin wrapper, for F below), and also noted in a registry.
// 3. On a panel key (isPanelKey: the copy's own guards) while the panel is shown and the focus is
//    not in a text field, the arbiter stops the event right there (stopImmediatePropagation - the
//    page never sees it) and replays it to the registry along the event's path, in DOM order:
//    capture listeners from window inwards, then bubble listeners from the target outwards;
//    stopPropagation ends the path after the current node, stopImmediatePropagation at once;
//    preventDefault acts on the real event (the default action - page scroll, button activation -
//    is still the browser's to skip). The copy thus receives the same event object as on the site:
//    target, key, modifiers, defaultPrevented, document.activeElement. Only currentTarget and
//    eventPhase are window/capture during the replay; nothing in the copy reads them.
// Any other key passes untouched to every listener of both worlds, with one exception: a plain F
// (keydown/keyup, no modifiers) while the panel is mounted is YouTube's full screen alone. It is not
// intercepted, and listeners the extension added while the panel was mounted (the copy's) skip it.
// Listeners added before the panel mounted (Yomitan's) still get it; one Yomitan adds while the
// panel is mounted is taken for the copy's and skips plain F too (Yomitan binds no plain F).
//
// Limitation: without keys.js (the panel injected into a tab that was open before the beta was
// switched on), the panel installs the gate itself, late; a YouTube window-capture listener
// registered before that still sees panel keys (no other YouTube listener does), and key listeners
// the extension registered before it are not replayed. The next page load has keys.js.

const KEY_TYPES: ReadonlySet<string> = new Set(['keydown', 'keyup', 'keypress']);
const GATE_KEY = '__flibYtKeyGate';

type AddFn = (type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) => void;
type RemoveFn = (type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) => void;

type ListenerRecord = {
    type: string,
    listener: EventListenerOrEventListenerObject,
    capture: boolean,
    passive: boolean,
    once: boolean,
    removed: boolean,
    /** Registered while the panel was mounted: the copy's (see KeyGate.isPanelRegistration). */
    panel: boolean,
    /** What the DOM holds: the listener itself, or (`once`, panel) a wrapper. */
    native: EventListenerOrEventListenerObject,
};

export type KeyGate = {
    /** Decides about each key event first; null: every key event passes. */
    arbiter: ((e: KeyboardEvent) => void) | null,
    /** Asked when a key listener is added: true marks it as the panel's (the copy's). */
    isPanelRegistration: (() => boolean) | null,
    /** True: a key event the panel's listeners must not get in native dispatch (F, owned by YouTube). */
    hideFromPanel: ((e: Event) => boolean) | null,
    /** Notes key listeners added to `target` from now on (react-dom root and portal containers). */
    track(target: EventTarget): void,
    /** Runs the noted listeners of the event's path, in DOM order, for an event already stopped. */
    replay(e: Event): void,
    /** Tests only: removes the gate and the wrappers of window and document. Pages keep the gate. */
    dispose(): void,
};

export type HotkeyArbiter = {
    /** Uninstalls the arbiter (keys go to YouTube again); the gate stays, passive. */
    (): void,
    /** See KeyGate.track; call before react-dom registers its listeners on the node. */
    track(target: EventTarget): void,
};

const isGate = (x: unknown): x is KeyGate => typeof x === 'object' && x !== null && typeof (x as KeyGate).replay === 'function' && typeof (x as KeyGate).track === 'function';

function report(win: Window, error: unknown): void {
    const reportError = (win as unknown as {reportError?: (e: unknown) => void}).reportError;
    if (typeof reportError === 'function') {
        reportError.call(win, error);
    } else {
        console.error(error);
    }
}

function callListener(listener: EventListenerOrEventListenerObject, thisArg: EventTarget, e: Event): void {
    if (typeof listener === 'function') {
        listener.call(thisArg, e);
    } else {
        listener.handleEvent(e);
    }
}

/**
 * Installs the key gate on `win`, once per window (keys.js and the panel share it).
 */
export function installKeyGate(win: Window): KeyGate {
    const holder = win as unknown as Record<string, unknown>;
    const existing = holder[GATE_KEY];
    if (isGate(existing)) { return existing; }

    const proto = (win as unknown as {EventTarget: typeof EventTarget}).EventTarget.prototype;
    const records = new WeakMap<EventTarget, ListenerRecord[]>();
    const tracked = new WeakSet<EventTarget>();
    // The methods each wrapped node had (in a browser: EventTarget.prototype's).
    const originals = new WeakMap<EventTarget, {add: AddFn, remove: RemoveFn}>();
    const unwrap: Array<() => void> = [];
    const nativeAdd = (node: EventTarget) => originals.get(node)?.add ?? proto.addEventListener as AddFn;
    const nativeRemove = (node: EventTarget) => originals.get(node)?.remove ?? proto.removeEventListener as RemoveFn;
    // A window in an event path is `win` in a browser; jsdom under vitest gives its inner Window object.
    const keyOf = (node: EventTarget): EventTarget => (node !== win && (node as Partial<Window>).document === win.document ? win : node);

    const drop = (target: EventTarget, record: ListenerRecord) => {
        record.removed = true;
        const list = records.get(target);
        const i = list === undefined ? -1 : list.indexOf(record);
        if (list !== undefined && i >= 0) { list.splice(i, 1); }
    };
    const find = (target: EventTarget, type: string, listener: EventListenerOrEventListenerObject, capture: boolean) => records.get(target)?.find((r) => r.type === type && r.listener === listener && r.capture === capture);

    const wrap = (target: EventTarget) => {
        const own = target as unknown as Record<string, unknown>;
        const before = {
            add: Object.getOwnPropertyDescriptor(target, 'addEventListener'),
            remove: Object.getOwnPropertyDescriptor(target, 'removeEventListener'),
        };
        const add0 = target.addEventListener as AddFn;
        const remove0 = target.removeEventListener as RemoveFn;
        originals.set(target, {add: add0, remove: remove0});
        const self = (thisArg: unknown): EventTarget => (thisArg === undefined || thisArg === null ? target : thisArg as EventTarget);
        function addEventListener(this: unknown, type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void {
            const node = self(this);
            if (!KEY_TYPES.has(type) || listener === null || (typeof listener !== 'function' && typeof listener !== 'object')) {
                nativeAdd(node).call(node, type, listener, options);
                return;
            }
            const opts = typeof options === 'object' && options !== null ? options : null;
            const capture = typeof options === 'boolean' ? options : Boolean(opts?.capture);
            const signal = opts?.signal;
            // The DOM ignores an aborted signal and a duplicate (type, listener, capture).
            if (signal?.aborted === true || find(node, type, listener, capture) !== undefined) { return; }
            const record: ListenerRecord = {
                type, listener, capture,
                passive: Boolean(opts?.passive),
                once: Boolean(opts?.once),
                removed: false,
                panel: gate.isPanelRegistration?.() === true,
                native: listener,
            };
            if (record.once || record.panel) {
                record.native = function keyListener(this: EventTarget, e: Event) {
                    if (record.once) { drop(node, record); }
                    if (record.panel && gate.hideFromPanel?.(e) === true) { return; }
                    callListener(listener, this, e);
                };
            }
            nativeAdd(node).call(node, type, record.native, options);
            let list = records.get(node);
            if (list === undefined) {
                list = [];
                records.set(node, list);
            }
            list.push(record);
            signal?.addEventListener('abort', () => { drop(node, record); }, {once: true});
        }
        function removeEventListener(this: unknown, type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions): void {
            const node = self(this);
            if (!KEY_TYPES.has(type) || listener === null) {
                nativeRemove(node).call(node, type, listener, options);
                return;
            }
            const capture = typeof options === 'boolean' ? options : Boolean(options?.capture);
            const record = find(node, type, listener, capture);
            if (record === undefined) {
                nativeRemove(node).call(node, type, listener, options);
                return;
            }
            drop(node, record);
            nativeRemove(node).call(node, type, record.native, capture);
        }
        const descriptor = {configurable: true, writable: true, enumerable: false};
        Object.defineProperty(target, 'addEventListener', {...descriptor, value: addEventListener});
        Object.defineProperty(target, 'removeEventListener', {...descriptor, value: removeEventListener});
        const restore = (name: string, mine: unknown, descriptor: PropertyDescriptor | undefined) => {
            if (own[name] !== mine) { return; } // patched over since: leave it
            if (descriptor === undefined) {
                delete own[name];
            } else {
                Object.defineProperty(target, name, descriptor);
            }
        };
        return () => {
            restore('addEventListener', addEventListener, before.add);
            restore('removeEventListener', removeEventListener, before.remove);
        };
    };

    const track = (target: EventTarget) => {
        if (tracked.has(target)) { return; }
        tracked.add(target);
        const undo = wrap(target);
        if (target === win || target === win.document) { unwrap.push(undo); }
    };

    const replay = (e: Event) => {
        const path = e.composedPath();
        let stopped = false;
        let immediate = false;
        const own = e as unknown as Record<string, unknown>;
        const define = (name: string, value: () => void) => { Object.defineProperty(e, name, {configurable: true, writable: true, value}); };
        define('stopPropagation', () => { stopped = true; });
        define('stopImmediatePropagation', () => { stopped = true; immediate = true; });
        const invoke = (pathNode: EventTarget, capture: boolean) => {
            const node = keyOf(pathNode);
            const list = records.get(node);
            if (list === undefined) { return; }
            immediate = false;
            for (const record of list.filter((r) => r.type === e.type && r.capture === capture)) {
                if (record.removed) { continue; }
                if (record.once) {
                    drop(node, record);
                    nativeRemove(node).call(node, record.type, record.native, record.capture);
                }
                if (record.passive) { define('preventDefault', () => { /* passive listener */ }); }
                try {
                    callListener(record.listener, node, e);
                } catch (error) {
                    report(win, error);
                } finally {
                    if (record.passive) { delete own.preventDefault; }
                }
                if (immediate) { return; }
            }
        };
        try {
            // Capture: window inwards to the target; then bubble: the target outwards (DOM order at target).
            for (let i = path.length - 1; i >= 0 && !stopped; i--) { invoke(path[i], true); }
            for (let i = 0; i < path.length && !stopped; i++) {
                if (i > 0 && !e.bubbles) { break; }
                invoke(path[i], false);
            }
        } finally {
            delete own.stopPropagation;
            delete own.stopImmediatePropagation;
        }
    };

    const onKey = (e: Event) => {
        const arbiter = gate.arbiter;
        if (arbiter !== null) { arbiter(e as KeyboardEvent); }
    };

    const gate: KeyGate = {
        arbiter: null,
        isPanelRegistration: null,
        hideFromPanel: null,
        track,
        replay,
        dispose: () => {
            for (const type of KEY_TYPES) { nativeRemove(win).call(win, type, onKey, true); }
            for (const undo of unwrap.splice(0)) { undo(); }
            if (holder[GATE_KEY] === gate) { delete holder[GATE_KEY]; }
        },
    };

    // First window-capture listener (when installed at document_start), before the wrappers exist.
    const winAdd = win.addEventListener as AddFn;
    for (const type of KEY_TYPES) { winAdd.call(win, type, onKey, true); }
    track(win);
    track(win.document);
    Object.defineProperty(win, GATE_KEY, {configurable: true, writable: true, enumerable: false, value: gate});
    return gate;
}

/** Tests only: removes the gate of `win`, if any. */
export function uninstallKeyGate(win: Window): void {
    const gate = (win as unknown as Record<string, unknown>)[GATE_KEY];
    if (isGate(gate)) { gate.dispose(); }
}

/**
 * Whether the copy's player takes this key event as a hotkey: the guards of useHotkeys.ts:85-153,
 * useTrackSelection.ts:20-21 (G) and WorkspacePanelThemed.tsx:388/412 (Esc, Delete). F stays YouTube's.
 */
export function isPanelKey(e: KeyboardEvent): boolean {
    const {key, code, ctrlKey, metaKey, altKey, shiftKey} = e;
    if (key === ' ') { return !ctrlKey && !metaKey; }
    if (key === 'ArrowLeft' || key === 'ArrowRight') { return true; }
    if (code === 'KeyF') { return false; }
    if (code === 'KeyB' || code === 'KeyM') { return !ctrlKey && !metaKey && !altKey; }
    if (code === 'KeyZ' || code === 'KeyS' || code === 'KeyR') { return !ctrlKey && !metaKey && !altKey && !shiftKey; }
    if (key === 'g' || key === 'G') { return !ctrlKey && !metaKey && !altKey; }
    return key === 'Escape' || key === 'Delete';
}

/** keydown/keyup of F without modifiers: what the copy would take as its full-screen key (useHotkeys.ts:134). */
function isPlainF(e: Event): boolean {
    if (e.type !== 'keydown' && e.type !== 'keyup') { return false; }
    const k = e as KeyboardEvent;
    return k.code === 'KeyF' && !k.ctrlKey && !k.metaKey && !k.altKey && !k.shiftKey;
}

/** The copy's rule (useHotkeys.ts:55-59), applied to the focused element and to the event's origin. */
function isTypingTarget(node: unknown): boolean {
    if (typeof node !== 'object' || node === null || typeof (node as Element).tagName !== 'string') { return false; }
    const el = node as HTMLElement;
    return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable === true;
}

function deepActiveElement(doc: Document): Element | null {
    let active = doc.activeElement;
    while (active?.shadowRoot?.activeElement) { active = active.shadowRoot.activeElement; }
    return active;
}

/**
 * Makes the copy's hotkeys the panel's alone while `isPanelActive()` (the copy is mounted).
 * Install before the copy registers its listeners; call track() on the react-dom root and portal
 * containers before rendering into them.
 */
export function installHotkeyArbiter(win: Window, isPanelActive: () => boolean): HotkeyArbiter {
    const gate = installKeyGate(win); // keys.js installed it at document_start; else it starts now
    const arbiter = (e: KeyboardEvent) => {
        if (!isPanelActive() || !isPanelKey(e)) { return; }
        // Typing in a field (YouTube's search or comments, the copy's search): the copy ignores it
        // and YouTube gets it, as without the panel.
        if (isTypingTarget(deepActiveElement(win.document)) || isTypingTarget(e.composedPath()[0])) { return; }
        e.stopImmediatePropagation();
        gate.replay(e);
    };
    // F belongs to YouTube (spec §3.10): it is not intercepted, and the copy's own listeners - the
    // ones added while the panel is mounted - do not get a plain F (useHotkeys.ts:134 would also
    // toggle full screen, through env/fullscreen.ts, and the two toggles would cancel out). The
    // copy's ⛶ button still goes through the redirect. With modifiers the copy ignores F anyway.
    const isPanelRegistration = () => isPanelActive();
    const hideFromPanel = (e: Event) => isPanelActive() && isPlainF(e);
    gate.arbiter = arbiter;
    gate.isPanelRegistration = isPanelRegistration;
    gate.hideFromPanel = hideFromPanel;
    const uninstall = () => {
        if (gate.arbiter === arbiter) { gate.arbiter = null; }
        if (gate.isPanelRegistration === isPanelRegistration) { gate.isPanelRegistration = null; }
        if (gate.hideFromPanel === hideFromPanel) { gate.hideFromPanel = null; }
    };
    return Object.assign(uninstall, {track: (target: EventTarget) => { gate.track(target); }});
}
