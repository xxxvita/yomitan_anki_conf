/*
 * Copyright (C) 2026  Flib-club Authors (fork of Yomitan)
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

import {log} from '../core/log.js';

/** @typedef {import('anki-conf').ClipStatus | import('anki-conf').ClipsPersistedItem} PlayableClip */

const OVERLAY_CLASS = 'entry-video-examples-modal-overlay';

/**
 * Fullscreen-ish modal player for a single clip. One instance per popup; an
 * `open()` call while another clip is showing closes the previous one first.
 *
 * Subtitle handling: fetched as text, converted from SRT to VTT in-memory if
 * needed (Core may still serve `.srt` until C2 lands), wrapped in a Blob URL,
 * and mounted as `<track>` so the browser handles cue switching natively.
 * Blob URLs are revoked on close to avoid leaks.
 */
export class VideoExamplesModal {
    constructor() {
        /** @type {?HTMLElement} */
        this._overlay = null;
        /** @type {?HTMLVideoElement} */
        this._video = null;
        /** @type {?AbortController} */
        this._subtitleAbort = null;
        /**
         * Word forms to highlight inside captions. Set by `open()`, cleared
         * on close. Empty array disables highlighting. We accept multiple
         * forms (dictionary headword + inflected surface forms produced by
         * Yomitan deinflection) so the subtitle highlight survives when the
         * page text says "people" but the dictionary lemma is "person".
         * @type {string[]}
         */
        this._activeWords = [];
        /** @type {(e: KeyboardEvent) => void} */
        this._onEscapeBind = (e) => {
            if (e.key !== 'Escape') { return; }
            // When the user exits HTML5-fullscreen via Esc, the browser ALSO
            // fires Escape on the document; closing the modal at that moment
            // is jarring (player vanishes when they meant to leave fullscreen).
            // Bail if any element is still in fullscreen — Esc was for that.
            if (document.fullscreenElement !== null) { return; }
            this.close();
        };
    }

    /**
     * @param {PlayableClip} clip
     * @param {{word?: string, words?: string[]}} [options]
     */
    open(clip, options = {}) {
        // If another modal is up, swap atomically: close the old, open the new.
        this.close();
        /** @type {string[]} */
        let words = [];
        if (Array.isArray(options.words)) {
            words = options.words.filter((s) => typeof s === 'string' && s.length > 0);
        } else if (typeof options.word === 'string' && options.word.length > 0) {
            words = [options.word];
        }
        this._activeWords = words;
        this._build(clip);
        void this._mountSubtitle(clip);
    }

    /** Tear down DOM, revoke blob URLs, abort in-flight subtitle fetch. */
    close() {
        if (this._subtitleAbort !== null) {
            this._subtitleAbort.abort();
            this._subtitleAbort = null;
        }
        if (this._video !== null) {
            // Stop playback explicitly — orphaned <video> elements with
            // `src` still set keep the audio/video pipeline alive briefly.
            try {
                this._video.pause();
                this._video.removeAttribute('src');
                this._video.load();
            } catch {
                // ignore — element may already be detached
            }
            this._video = null;
        }
        if (this._overlay !== null) {
            const parent = this._overlay.parentNode;
            if (parent !== null) { parent.removeChild(this._overlay); }
            this._overlay = null;
        }
        document.removeEventListener('keydown', this._onEscapeBind);
    }

    // --- internals ---

    /** @param {PlayableClip} clip */
    _build(clip) {
        const overlay = document.createElement('div');
        overlay.className = OVERLAY_CLASS;
        overlay.tabIndex = -1;
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-label', 'Video example');
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) { this.close(); }
        });

        const dialog = document.createElement('div');
        dialog.className = 'entry-video-examples-modal';

        // "Open in new tab" — the reliable path to true fullscreen on hosts
        // (like google.com) that send `Permissions-Policy: fullscreen=()`,
        // which silently kills the in-iframe HTML5 controls fullscreen
        // button regardless of our iframe `allow="fullscreen"`. Instead of
        // opening the raw mp4 (which loses subtitles), we build a tiny HTML
        // page with the same `<video>` + `<track>` setup as the modal and
        // open THAT — full window, controls + captions, real fullscreen.
        if (typeof clip.clip_url === 'string' && clip.clip_url.length > 0) {
            const openBtn = document.createElement('button');
            openBtn.type = 'button';
            openBtn.className = 'entry-video-examples-modal-open';
            openBtn.title = 'Open in new tab (reliable fullscreen)';
            openBtn.setAttribute('aria-label', 'Open in new tab');
            openBtn.textContent = '↗';
            openBtn.addEventListener('click', () => {
                // Open the tab SYNCHRONOUSLY inside the user-gesture so
                // Chromium's pop-up blocker doesn't kick in once the async
                // fetch below completes and user-gesture has expired.
                // The empty-string URL gives us a blank-document tab whose
                // location we can navigate later from this opener.
                // `noopener` is dropped on purpose: with it set, window.open
                // returns null and we can't navigate the tab later.
                const win = window.open('about:blank', '_blank');
                void this._openInNewTab(clip, win);
            });
            dialog.appendChild(openBtn);
        }

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'entry-video-examples-modal-close';
        closeBtn.title = 'Close (Esc)';
        closeBtn.textContent = '×';
        closeBtn.addEventListener('click', () => { this.close(); });
        dialog.appendChild(closeBtn);

        const video = document.createElement('video');
        video.className = 'entry-video-examples-modal-video';
        video.controls = true;
        video.autoplay = true;
        video.preload = 'metadata';
        video.src = clip.clip_url;
        dialog.appendChild(video);
        this._video = video;

        // Visible subtitle text below the player as a fallback (and for clips
        // that arrive without a `subtitle_url`). Splits around the searched
        // word so the same gold highlight as the panel cards lands here too.
        if (typeof clip.subtitle_text === 'string' && clip.subtitle_text.length > 0) {
            const sub = document.createElement('div');
            sub.className = 'entry-video-examples-modal-subtitle';
            const parts = highlightCueParts(clip.subtitle_text, this._activeWords);
            for (const p of parts) {
                if (p.hl) {
                    const mark = document.createElement('mark');
                    mark.className = 'entry-video-examples-mark';
                    mark.textContent = p.t;
                    sub.appendChild(mark);
                } else {
                    sub.appendChild(document.createTextNode(p.t));
                }
            }
            dialog.appendChild(sub);
        }

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);
        this._overlay = overlay;
        document.addEventListener('keydown', this._onEscapeBind);
    }

    /**
     * Open a new browser tab with the video AND native time-synced subtitles.
     *
     * CSP context: the pre-opened tab is `about:blank` and inherits the
     * extension popup's CSP — `script-src 'self' 'wasm-unsafe-eval';
     * media-src *`. That CSP blocks both inline `<script>` and `data:`
     * media URLs (the spec note on `*` is explicit: it doesn't cover
     * `data:`, only network schemes + self's scheme). So:
     * - VTT is delivered via a `blob:` URL (matches self's scheme,
     * passes `media-src *`).
     * - No inline `<script>` in the written HTML — we call
     * `track.mode = 'showing'` from THIS function after
     * `document.close()`. CSP guards scripts that LOAD INTO the new
     * document; calls from the opener context aren't restricted.
     * @param {PlayableClip} clip
     * @param {?Window} win Pre-opened tab from the click handler (synchronous
     *   `window.open` call). We can't open it ourselves AFTER an awaited
     *   fetch — the user-gesture is gone and the popup blocker kicks in.
     */
    async _openInNewTab(clip, win) {
        const rawClipUrl = typeof clip.clip_url === 'string' ? clip.clip_url : '';
        // HTML-escape at the attribute boundary. The URL is controlled
        // today (hex cache-key), but it's server-supplied so we treat it
        // as untrusted at the interpolation point into a `<video src=...>`
        // attribute. Don't use encodeURI here — it would double-encode
        // existing percent-escapes (e.g. `%20` → `%2520`); the URL is
        // already a valid URL, we only need to neutralize chars that
        // would break the HTML attribute itself.
        const clipUrl = rawClipUrl
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        if (rawClipUrl.length === 0) {
            if (win !== null) {
                try { win.close(); } catch { /* tab already gone */ }
            }
            return;
        }

        // Fetch VTT in extension context, parse into cues. We feed cues
        // programmatically via track.addCue() from the opener context after
        // document.close — no blob/data URL, no <track src>, no CSP
        // boundary for the new tab to argue with.
        /** @type {?{start: number, end: number, text: string}[]} */
        let cues = null;
        if (typeof clip.subtitle_url === 'string' && clip.subtitle_url.length > 0) {
            try {
                const response = await fetch(clip.subtitle_url, {credentials: 'omit'});
                if (response.ok) {
                    const text = await response.text();
                    const vttText = isVttDocument(text) ? text : srtToVtt(text);
                    cues = parseVttCues(vttText);
                }
            } catch (e) {
                log.log(`[video-examples] open-in-tab subtitle fetch failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`);
            }
        }

        const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Video example</title>
<style>
  html,body{margin:0;background:#000;color:#eee;font-family:system-ui,sans-serif;height:100%;}
  body{display:flex;flex-direction:column;justify-content:center;align-items:center;}
  video{display:block;max-width:100vw;max-height:96vh;background:#000;}
  /* Gold highlight inside the native caption strip. ::cue(c.hl) matches
     the <c.hl>WORD</c> tags the opener wraps into each cue's text. */
  video::cue(c.hl){color:#e3b54a;font-weight:bold;background:transparent;
    text-decoration:underline;text-decoration-color:rgba(227,181,74,.6);}
</style></head>
<body>
<video id="v" controls autoplay src="${clipUrl}"></video>
</body></html>`;
        if (win === null) {
            window.open(rawClipUrl, '_blank');
            return;
        }
        try {
            win.document.open();
            // eslint-disable-next-line no-unsanitized/method
            win.document.write(html);
            win.document.close();
            // Wire captions from the OPENER. Cross-realm: use win.VTTCue
            // for the cue constructor so cues live in the new tab's realm
            // (otherwise `instanceof` checks the browser does internally
            // can misbehave). CSP only restricts inline scripts inside
            // the new doc; calls from this function aren't affected.
            const video = /** @type {?HTMLVideoElement} */ (win.document.getElementById('v'));
            if (video !== null && cues !== null && cues.length > 0) {
                const track = win.document.createElement('track');
                track.kind = 'subtitles';
                track.srclang = 'en';
                track.label = 'English';
                track.default = true;
                video.appendChild(track);
                const wrap = makeHighlightWrapper(this._activeWords);
                const tt = track.track;
                // Cross-realm VTTCue: pull the constructor off the new
                // tab's window so cues live in that realm. Cast through
                // unknown because lib.dom doesn't declare VTTCue on Window.
                const winAny = /** @type {{VTTCue: typeof VTTCue}} */ (/** @type {unknown} */ (win));
                const Cue = winAny.VTTCue;
                for (const c of cues) {
                    tt.addCue(new Cue(c.start, c.end, wrap(c.text)));
                }
                tt.mode = 'showing';
            }
            // Security hygiene: null out the popup's reference back to
            // the extension realm.
            try { win.opener = null; } catch { /* read-only in some browsers */ }
        } catch (e) {
            log.log(`[video-examples] open-in-tab document.write failed (${e instanceof Error ? e.message : String(e)}); falling back to raw mp4`);
            try { win.location.href = rawClipUrl; } catch { /* ignore */ }
        }
    }

    /**
     * Fetch subtitle text and feed parsed cues into a programmatic
     * `<track>` via `track.addCue(new VTTCue(...))`. Avoids the
     * `blob:`/`data:` cross-browser CSP minefield entirely — there's
     * no extra resource for the browser to fetch under media-src; the
     * track owns its cues in-memory. Non-fatal: any failure here leaves
     * the player without native captions — the inline `subtitle_text`
     * div under the video still shows the transcript.
     * @param {PlayableClip} clip
     */
    async _mountSubtitle(clip) {
        if (typeof clip.subtitle_url !== 'string' || clip.subtitle_url.length === 0) { return; }
        const video = this._video;
        if (video === null) { return; }

        const controller = new AbortController();
        this._subtitleAbort = controller;
        let text;
        try {
            const response = await fetch(clip.subtitle_url, {signal: controller.signal, credentials: 'omit'});
            if (!response.ok) { return; }
            text = await response.text();
        } catch (e) {
            if (!(e instanceof DOMException) || e.name !== 'AbortError') {
                log.log(`[video-examples] subtitle fetch failed (non-fatal): ${String(e)}`);
            }
            return;
        }
        // Abandon if modal was closed mid-fetch.
        if (this._subtitleAbort !== controller || video !== this._video || !video.isConnected) { return; }

        const vttText = isVttDocument(text) ? text : srtToVtt(text);
        const cues = parseVttCues(vttText);
        if (cues.length === 0) { return; }

        const track = document.createElement('track');
        track.kind = 'subtitles';
        track.srclang = 'en';
        track.label = 'English';
        track.default = true;
        // No `src` — we feed cues programmatically below. Browser doesn't
        // request anything under media-src, so blob/data CSP rules don't
        // matter at all.
        video.appendChild(track);

        // Wrap matched word(s) in <c.hl>…</c> inside each cue's text. The
        // `::cue(c.hl)` CSS rule paints them gold inside the native caption
        // strip. Cue tags are parsed by the browser when rendering — we just
        // need them present in the cue payload string.
        const wrap = makeHighlightWrapper(this._activeWords);
        const tt = track.track;
        for (const c of cues) {
            tt.addCue(new VTTCue(c.start, c.end, wrap(c.text)));
        }
        tt.mode = 'showing';
    }
}

/**
 * @param {string} text
 * @returns {boolean}
 */
function isVttDocument(text) {
    // The WEBVTT signature must be the very first non-BOM character sequence
    // per the spec; tolerate a leading UTF-8 BOM.
    const stripped = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
    return stripped.startsWith('WEBVTT');
}

/**
 * Convert SRT to VTT in-memory. The transform is the smallest one that the
 * HTML5 `<track>` parser actually requires: prepend the WEBVTT header and
 * swap the comma in HH:MM:SS,mmm timestamps for a dot. Cue payload (HTML
 * tags like `<i>`, line numbers, positioning) passes through untouched —
 * VTT is a superset.
 * @param {string} srt
 * @returns {string}
 */
function srtToVtt(srt) {
    const stripped = srt.charCodeAt(0) === 0xFEFF ? srt.slice(1) : srt;
    const normalised = stripped
        .replace(/\r\n/g, '\n')
        .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
    return `WEBVTT\n\n${normalised}`;
}

/**
 * Split a single cue's text into `{t, hl?}` parts around any of the searched
 * word forms. Same Unicode-aware regex the inline panel uses for its `<mark>`
 * highlight, extended to an alternation so dictionary lemma + inflected
 * surface forms (Yomitan deinflection chain) all light up.
 * Returns a one-element array (no match / empty words) so the runtime
 * renderer doesn't have to special-case it.
 * @param {string} text
 * @param {string[]} words
 * @returns {{t: string, hl?: boolean}[]}
 */
function highlightCueParts(text, words) {
    if (!Array.isArray(words) || words.length === 0) { return [{t: text}]; }
    // Longest-first so "people" wins over "person" when both could match a
    // single position (regex alternation picks left-to-right).
    const escapedAlts = words
        .filter((w) => typeof w === 'string' && w.length > 0)
        .sort((a, b) => b.length - a.length)
        .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (escapedAlts.length === 0) { return [{t: text}]; }
    let re;
    try {
        re = new RegExp(`(?<![\\p{L}\\p{N}])(${escapedAlts.join('|')})(?![\\p{L}\\p{N}])`, 'giu');
    } catch (e) {
        return [{t: text}];
    }
    /** @type {{t: string, hl?: boolean}[]} */
    const parts = [];
    let last = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
        if (m.index > last) { parts.push({t: text.slice(last, m.index)}); }
        parts.push({t: m[1], hl: true});
        last = m.index + m[1].length;
        // Guard against zero-width matches infinite-looping.
        if (m[0].length === 0) { re.lastIndex++; }
    }
    if (last < text.length) { parts.push({t: text.slice(last)}); }
    return parts.length > 0 ? parts : [{t: text}];
}

/**
 * Build a per-cue-text wrapper that escapes VTT-significant chars and wraps
 * matches in `<c.hl>WORD</c>` for the `::cue(c.hl)` rule. Used by the
 * addCue-based mount path (no need to serialise/re-parse a full VTT doc).
 *
 * Empty / invalid words → identity (returns text unchanged).
 * @param {string[]} words
 * @returns {(text: string) => string}
 */
function makeHighlightWrapper(words) {
    if (!Array.isArray(words) || words.length === 0) { return (t) => t; }
    const escapedAlts = words
        .filter((w) => typeof w === 'string' && w.length > 0)
        .sort((a, b) => b.length - a.length)
        .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (escapedAlts.length === 0) { return (t) => t; }
    /** @type {RegExp} */
    let re;
    try {
        re = new RegExp(`(?<![\\p{L}\\p{N}])(${escapedAlts.join('|')})(?![\\p{L}\\p{N}])`, 'giu');
    } catch (e) {
        return (t) => t;
    }
    return (text) => {
        const escaped = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        re.lastIndex = 0;
        return escaped.replace(re, '<c.hl>$1</c>');
    };
}

/**
 * Parse a VTT document into cue records — needed by the addCue-based mount
 * path (we feed cues programmatically; the browser never sees the raw VTT
 * text itself). Tolerates BOM, CRLF, and the short MM:SS.mmm form.
 * @param {string} vtt
 * @returns {{start: number, end: number, text: string}[]}
 */
function parseVttCues(vtt) {
    const stripped = vtt.charCodeAt(0) === 0xFEFF ? vtt.slice(1) : vtt;
    const normalised = stripped.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    /** @type {{start: number, end: number, text: string}[]} */
    const cues = [];
    const blocks = normalised.split(/\n\n+/);
    const tsRe = /(\d+):(\d{2}):(\d{2})[.,](\d{1,3})\s*-->\s*(\d+):(\d{2}):(\d{2})[.,](\d{1,3})/;
    const tsReShort = /(\d+):(\d{2})[.,](\d{1,3})\s*-->\s*(\d+):(\d{2})[.,](\d{1,3})/;
    for (const block of blocks) {
        const lines = block.split('\n').filter((l) => l.length > 0);
        let tsLine = null;
        let tsIdx = -1;
        for (let i = 0; i < lines.length; i++) {
            if (!lines[i].includes('-->')) { continue; }
            tsLine = lines[i];
            tsIdx = i;
            break;
        }
        if (tsLine === null || tsIdx < 0) { continue; }
        let m = tsRe.exec(tsLine);
        let start;
        let end;
        if (m !== null) {
            start = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
            end = Number(m[5]) * 3600 + Number(m[6]) * 60 + Number(m[7]) + Number(m[8]) / 1000;
        } else {
            m = tsReShort.exec(tsLine);
            if (m === null) { continue; }
            start = Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 1000;
            end = Number(m[4]) * 60 + Number(m[5]) + Number(m[6]) / 1000;
        }
        const rawText = lines.slice(tsIdx + 1).join('\n');
        // Strip pre-existing cue tags (we'll re-add our own <c.hl>) and
        // VTT timestamp anchors. Want plain visible text.
        const plain = rawText
            .replace(/<\d+:\d+:\d+[.,]\d+>/g, '')
            .replace(/<[^>]+>/g, '')
            .trim();
        if (plain.length === 0) { continue; }
        cues.push({start, end, text: plain});
    }
    return cues;
}
