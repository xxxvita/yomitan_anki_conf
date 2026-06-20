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
 * needed (Core may still serve `.srt` until C2 lands), parsed into cue
 * records, and rendered via a JS-driven overlay div positioned over the
 * video. Time-synced through the `timeupdate` event. The searched word is
 * highlighted gold via a child <span> — no native `<track>` / `::cue()`
 * dependency (browsers diverge on cue styling for programmatically-fed cues).
 */
export class VideoExamplesModal {
    constructor() {
        /** @type {?HTMLElement} */
        this._overlay = null;
        /** @type {?HTMLVideoElement} */
        this._video = null;
        /** @type {?HTMLDivElement} */
        this._cueEl = null;
        /** @type {?{start: number, end: number, parts: {t: string, hl?: boolean}[]}[]} */
        this._cuesRendered = null;
        /** @type {?() => void} */
        this._onTimeUpdate = null;
        /** @type {?() => void} */
        this._onFsChange = null;
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
            if (this._onTimeUpdate !== null) {
                this._video.removeEventListener('timeupdate', this._onTimeUpdate);
                this._video.removeEventListener('seeked', this._onTimeUpdate);
                this._onTimeUpdate = null;
            }
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
        this._cueEl = null;
        this._cuesRendered = null;
        if (this._onFsChange !== null) {
            document.removeEventListener('fullscreenchange', this._onFsChange);
            this._onFsChange = null;
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

        // Wrap video + caption overlay together so the overlay can be
        // absolutely-positioned against the video's box (not the dialog's).
        const videoWrap = document.createElement('div');
        videoWrap.className = 'entry-video-examples-modal-video-wrap';

        const video = document.createElement('video');
        video.className = 'entry-video-examples-modal-video';
        video.controls = true;
        video.autoplay = true;
        video.preload = 'metadata';
        video.src = clip.clip_url;
        // Chromium-only hint to drop the FS button from native controls.
        // Firefox ignores this attribute, so we ALSO listen for
        // fullscreenchange below to recover from video-only FS.
        video.setAttribute('controlslist', 'nofullscreen');
        videoWrap.appendChild(video);

        // JS-driven caption overlay. Native `::cue(c.hl)` / `::cue(.hl)`
        // styling doesn't apply to programmatically-added VTTCues in
        // Firefox (Chromium honors it; spec is ambiguous, behavior
        // diverged). So we render the caption ourselves, time-synced
        // via `timeupdate`, with full DOM control over the highlight.
        // `pointer-events: none` so video controls under it still work.
        const cueEl = document.createElement('div');
        cueEl.className = 'entry-video-examples-modal-cue';
        videoWrap.appendChild(cueEl);
        this._cueEl = cueEl;

        // Custom fullscreen button — required because the native fullscreen
        // button on the <video> element makes ONLY the video go fullscreen,
        // orphaning the cue overlay (which is a sibling of video). The
        // native button is hidden via CSS (Chromium) and the controlslist
        // attribute (also Chromium). Firefox honors neither — see
        // fullscreenchange listener below for the Firefox-safe fallback.
        const fsBtn = document.createElement('button');
        fsBtn.type = 'button';
        fsBtn.className = 'entry-video-examples-modal-fs';
        fsBtn.title = 'Fullscreen';
        fsBtn.setAttribute('aria-label', 'Fullscreen');
        fsBtn.textContent = '⛶';
        fsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (document.fullscreenElement !== null) {
                void document.exitFullscreen();
                return;
            }
            void videoWrap.requestFullscreen?.();
        });
        videoWrap.appendChild(fsBtn);

        // Firefox-safe recovery: if anything (e.g. the native FS button in
        // Firefox) puts the BARE video into fullscreen, the overlay disappears.
        // Catch that the moment it happens, exit, then re-enter on the wrap.
        // Brief visual flash but the highlight stays attached.
        const onFsChange = () => {
            if (document.fullscreenElement === video) {
                void document.exitFullscreen().then(() => {
                    // Modal may have been closed between exit-FS and the
                    // promise resolving. Refuse to re-enter FS on a
                    // detached wrap (spec says requestFullscreen rejects
                    // anyway; this is defense-in-depth).
                    if (this._onFsChange === null || !videoWrap.isConnected) { return; }
                    void videoWrap.requestFullscreen?.();
                });
            }
        };
        document.addEventListener('fullscreenchange', onFsChange);
        this._onFsChange = onFsChange;

        dialog.appendChild(videoWrap);
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
  .wrap{position:relative;display:inline-block;line-height:0;}
  video{display:block;max-width:100vw;max-height:96vh;background:#000;}
  /* max() lifts the overlay above native controls on short videos. */
  .cue{position:absolute;left:50%;bottom:max(48px,8%);transform:translateX(-50%);
    max-width:88%;padding:.3em .7em;background:rgba(0,0,0,.72);color:#fff;
    font-size:1.15em;line-height:1.35;text-align:center;
    text-shadow:0 1px 2px rgba(0,0,0,.5);border-radius:4px;
    pointer-events:none;opacity:0;transition:opacity 100ms linear;z-index:2;
    white-space:pre-wrap;font-family:system-ui,sans-serif;}
  .cue.on{opacity:1;}
  .cue .hl{color:#e3b54a;font-weight:bold;text-decoration:underline;
    text-decoration-color:rgba(227,181,74,.6);
    text-shadow:0 1px 2px rgba(0,0,0,.55);}
  /* Hide native FS button — see modal CSS comment for the rationale. */
  video::-webkit-media-controls-fullscreen-button{display:none;}
  .fs{position:absolute;right:14px;bottom:14px;width:34px;height:34px;
    display:grid;place-items:center;padding:0;
    border:1px solid rgba(255,255,255,.22);border-radius:6px;
    background:rgba(20,22,27,.65);color:rgba(255,255,255,.92);
    font-size:1.15em;line-height:1;cursor:pointer;z-index:3;
    transition:background .15s linear;font-family:system-ui,sans-serif;}
  .fs:hover{background:rgba(40,44,52,.9);}
  .wrap:fullscreen{display:flex;align-items:center;justify-content:center;
    width:100vw;height:100vh;background:#000;}
  .wrap:fullscreen video{max-width:100vw;max-height:100vh;}
</style></head>
<body>
<div class="wrap" id="wrap">
  <video id="v" controls autoplay controlslist="nofullscreen" src="${clipUrl}"></video>
  <div class="cue" id="cue"></div>
  <button class="fs" id="fs" title="Fullscreen" aria-label="Fullscreen">⛶</button>
</div>
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
            // Wire JS-driven caption overlay from the OPENER. CSP forbids
            // inline scripts in the new doc; calls from THIS function
            // (which lives in the popup-iframe context) aren't affected.
            const video = /** @type {?HTMLVideoElement} */ (win.document.getElementById('v'));
            const cueEl = /** @type {?HTMLDivElement} */ (win.document.getElementById('cue'));
            if (video !== null && cueEl !== null && cues !== null && cues.length > 0) {
                const rendered = cues.map((c) => ({
                    start: c.start,
                    end: c.end,
                    parts: highlightCueParts(c.text, this._activeWords),
                }));
                const renderActive = () => {
                    if (win.closed) { return; }
                    const t = video.currentTime;
                    /** @type {?{parts: {t: string, hl?: boolean}[]}} */
                    let active = null;
                    for (const r of rendered) {
                        if (t >= r.start && t < r.end) {
                            active = r;
                            break;
                        }
                    }
                    if (active === null) {
                        cueEl.classList.remove('on');
                        return;
                    }
                    const key = active.parts.map((p) => (p.hl === true ? `*${p.t}*` : p.t)).join('');
                    if (cueEl.dataset.key !== key) {
                        cueEl.dataset.key = key;
                        while (cueEl.firstChild !== null) { cueEl.removeChild(cueEl.firstChild); }
                        for (const p of active.parts) {
                            if (p.hl === true) {
                                const span = win.document.createElement('span');
                                span.className = 'hl';
                                span.textContent = p.t;
                                cueEl.appendChild(span);
                            } else {
                                cueEl.appendChild(win.document.createTextNode(p.t));
                            }
                        }
                    }
                    cueEl.classList.add('on');
                };
                video.addEventListener('timeupdate', renderActive);
                video.addEventListener('seeked', renderActive);
                renderActive();
            }
            // Custom fullscreen — operate on .wrap so the overlay stays
            // attached. Native FS button hidden via CSS (Chromium) and
            // controlslist attribute (also Chromium). Firefox: see
            // fullscreenchange listener below for the safe recovery path.
            const wrap = win.document.getElementById('wrap');
            const fsBtn = win.document.getElementById('fs');
            if (wrap !== null && fsBtn !== null && video !== null) {
                fsBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (win.document.fullscreenElement !== null) {
                        void win.document.exitFullscreen();
                        return;
                    }
                    void wrap.requestFullscreen?.();
                });
                // Firefox-safe recovery: native FS button on bare video
                // → exit, re-enter on wrap. Brief flash but overlay stays.
                win.document.addEventListener('fullscreenchange', () => {
                    if (win.closed) { return; }
                    if (win.document.fullscreenElement === video) {
                        void win.document.exitFullscreen().then(() => {
                            // Tab may have closed between exit-FS resolve
                            // and this callback; same defense-in-depth as
                            // the in-popup path.
                            if (win.closed || !wrap.isConnected) { return; }
                            void wrap.requestFullscreen?.();
                        });
                    }
                });
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
        if (cues.length === 0 || this._cueEl === null) { return; }

        // Pre-render each cue's text into highlight parts. Browser's
        // ::cue() pseudo-element styling for programmatically-added cues
        // is unreliable across browsers (Chromium honors it for cue-tag
        // class form, Firefox ignores both forms). Render via DOM
        // ourselves — full control, no spec-corner-case dependency.
        const rendered = cues.map((c) => ({
            start: c.start,
            end: c.end,
            parts: highlightCueParts(c.text, this._activeWords),
        }));
        this._cuesRendered = rendered;
        const cueEl = this._cueEl;

        const renderActive = () => {
            if (this._cuesRendered === null || this._cueEl !== cueEl) { return; }
            const t = video.currentTime;
            /** @type {?{parts: {t: string, hl?: boolean}[]}} */
            let active = null;
            for (const r of this._cuesRendered) {
                if (t >= r.start && t < r.end) {
                    active = r;
                    break;
                }
            }
            if (active === null) {
                cueEl.classList.remove('on');
                return;
            }
            // Replace contents only if changed — avoid DOM churn on
            // every timeupdate tick (4Hz typical).
            const key = active.parts.map((p) => (p.hl === true ? `*${p.t}*` : p.t)).join('');
            if (cueEl.dataset.key !== key) {
                cueEl.dataset.key = key;
                while (cueEl.firstChild !== null) { cueEl.removeChild(cueEl.firstChild); }
                for (const p of active.parts) {
                    if (p.hl === true) {
                        const span = document.createElement('span');
                        span.className = 'entry-video-examples-modal-cue-hl';
                        span.textContent = p.t;
                        cueEl.appendChild(span);
                    } else {
                        cueEl.appendChild(document.createTextNode(p.t));
                    }
                }
            }
            cueEl.classList.add('on');
        };

        this._onTimeUpdate = renderActive;
        video.addEventListener('timeupdate', renderActive);
        video.addEventListener('seeked', renderActive);
        // Render immediately in case video already past the first cue.
        renderActive();
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
