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
        /** @type {?string} */
        this._subtitleBlobUrl = null;
        /** @type {?AbortController} */
        this._subtitleAbort = null;
        /**
         * Searched word to highlight inside captions. Set by `open()`,
         * cleared on close. Empty string disables highlighting.
         * @type {string}
         */
        this._activeWord = '';
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
     * @param {{word?: string}} [options]
     */
    open(clip, options = {}) {
        // If another modal is up, swap atomically: close the old, open the new.
        this.close();
        this._activeWord = typeof options.word === 'string' ? options.word : '';
        this._build(clip);
        void this._mountSubtitle(clip);
    }

    /** Tear down DOM, revoke blob URLs, abort in-flight subtitle fetch. */
    close() {
        if (this._subtitleAbort !== null) {
            this._subtitleAbort.abort();
            this._subtitleAbort = null;
        }
        if (this._subtitleBlobUrl !== null) {
            URL.revokeObjectURL(this._subtitleBlobUrl);
            this._subtitleBlobUrl = null;
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
            openBtn.addEventListener('click', () => { void this._openInNewTab(clip); });
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
        // that arrive without a `subtitle_url`).
        if (typeof clip.subtitle_text === 'string' && clip.subtitle_text.length > 0) {
            const sub = document.createElement('div');
            sub.className = 'entry-video-examples-modal-subtitle';
            sub.textContent = clip.subtitle_text;
            dialog.appendChild(sub);
        }

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);
        this._overlay = overlay;
        document.addEventListener('keydown', this._onEscapeBind);
    }

    /**
     * Build a small HTML page that mirrors the modal player (video + track +
     * inline subtitle) and open it in a new browser tab via a blob URL. The
     * new tab is a normal top-level browsing context — no parent
     * Permissions-Policy interference, real fullscreen, native captions.
     *
     * Subtitle is fetched into an inline `data:text/vtt;base64,…` URL so it
     * survives across the blob-URL boundary without needing CORS headers.
     * Fails silently to the raw mp4 if subtitle fetch fails or no
     * subtitle_url is available.
     * @param {PlayableClip} clip
     */
    async _openInNewTab(clip) {
        const clipUrl = typeof clip.clip_url === 'string' ? clip.clip_url : '';
        if (clipUrl.length === 0) { return; }

        // Fetch the VTT text in the extension context (we have credentials
        // and direct loopback access here). We don't try to use it via
        // `<track>` in the new tab — that path is plagued by cross-origin
        // checks (data:/http boundary, CORS preflight on http VTT) that
        // silently disable the captions. Instead we serialise the cues
        // straight into the page and render them via a JS-driven overlay
        // div. Zero browser-side network for the captions.
        /** @type {string} */
        let cuesJson = '[]';
        if (typeof clip.subtitle_url === 'string' && clip.subtitle_url.length > 0) {
            try {
                const response = await fetch(clip.subtitle_url, {credentials: 'omit'});
                if (response.ok) {
                    const text = await response.text();
                    const vttText = isVttDocument(text) ? text : srtToVtt(text);
                    const cues = parseVttCues(vttText);
                    // Pre-render highlight: split each cue text around the
                    // searched-word match (same Unicode-aware regex the inline
                    // panel uses) and store as `{start, end, parts: [{t, hl?}]}`.
                    // The inline tab script just concatenates the parts and
                    // applies the `.hl` class — no regex at runtime, no HTML
                    // injection risk.
                    const rendered = cues.map((c) => ({
                        start: c.start,
                        end: c.end,
                        parts: highlightCueParts(c.text, this._activeWord),
                    }));
                    cuesJson = JSON.stringify(rendered);
                }
            } catch (e) {
                log.log(`[video-examples] open-in-tab subtitle fetch failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`);
            }
        }

        const subtitleText = typeof clip.subtitle_text === 'string' ? clip.subtitle_text : '';
        const escaped = subtitleText
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
        // JS-driven captions overlay: the player wraps the <video> in a
        // .stage container; an absolutely-positioned .cue div sits over the
        // bottom of the video and shows whichever VTT cue is active for the
        // current playback time. Cues are inlined as JSON — zero network
        // for captions, no CORS to fight.
        const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Video example</title>
<style>
  html,body{margin:0;background:#000;color:#eee;font-family:system-ui,sans-serif;height:100%;}
  body{display:flex;flex-direction:column;justify-content:center;align-items:center;}
  .stage{position:relative;display:inline-block;max-width:100vw;max-height:90vh;}
  video{display:block;max-width:100vw;max-height:90vh;background:#000;}
  .cue{position:absolute;left:50%;bottom:7%;transform:translateX(-50%);
    max-width:88%;padding:.35em .75em;border-radius:6px;
    background:rgba(0,0,0,.72);color:#fff;font-size:1.4em;line-height:1.3;
    text-align:center;text-shadow:0 1px 2px rgba(0,0,0,.5);
    pointer-events:none;opacity:0;transition:opacity 120ms linear;
    white-space:pre-wrap;}
  .cue.on{opacity:1;}
  .cue .hl{color:#e3b54a;font-weight:700;text-shadow:0 1px 2px rgba(0,0,0,.55);}
  .caption{padding:.6em 1em;font-size:1.05em;text-align:center;line-height:1.4;
    color:#cfd3da;}
  /* Fullscreen: cue overlay still lives over the video (the .stage
     becomes the fullscreened element via the JS hook below). */
  .stage:fullscreen{display:flex;align-items:center;justify-content:center;
    width:100vw;height:100vh;max-width:none;max-height:none;background:#000;}
  .stage:fullscreen video{max-width:100vw;max-height:100vh;}
</style></head>
<body>
<div class="stage" id="stage">
  <video id="v" controls autoplay src="${clipUrl}"></video>
  <div class="cue" id="cue"></div>
</div>
${subtitleText.length > 0 ? `<div class="caption">${escaped}</div>` : ''}
<script>
(function(){
  var v=document.getElementById('v');
  var cueEl=document.getElementById('cue');
  var stage=document.getElementById('stage');
  var cues=${cuesJson};
  function render(parts){
    while(cueEl.firstChild){cueEl.removeChild(cueEl.firstChild);}
    for(var i=0;i<parts.length;i++){
      var p=parts[i];
      if(p.hl){
        var span=document.createElement('span');
        span.className='hl';
        span.textContent=p.t;
        cueEl.appendChild(span);
      }else{
        cueEl.appendChild(document.createTextNode(p.t));
      }
    }
  }
  function update(){
    var t=v.currentTime;
    var active=null;
    for(var i=0;i<cues.length;i++){
      if(t>=cues[i].start&&t<cues[i].end){active=cues[i];break;}
    }
    if(active){render(active.parts);cueEl.classList.add('on');}
    else{cueEl.classList.remove('on');}
  }
  v.addEventListener('timeupdate',update);
  v.addEventListener('seeked',update);
  // Fullscreen the WHOLE stage (video + cue overlay) when the user clicks
  // the native fullscreen button — otherwise the overlay would stay
  // page-sized and the cue would float off-screen.
  v.addEventListener('webkitbeginfullscreen',function(){
    if(stage.requestFullscreen){stage.requestFullscreen();}
  });
  document.addEventListener('keydown',function(e){
    if(e.key==='f'||e.key==='F'){if(!document.fullscreenElement&&stage.requestFullscreen){stage.requestFullscreen();}}
  });
})();
</script>
</body></html>`;
        const blob = new Blob([html], {type: 'text/html'});
        const url = URL.createObjectURL(blob);
        const win = window.open(url, '_blank', 'noopener,noreferrer');
        if (win === null) {
            // Pop-up blocked — fall back to the raw mp4.
            window.open(clipUrl, '_blank', 'noopener,noreferrer');
        }
        // We deliberately leak this one blob URL. Revoking too early breaks
        // the new tab; revoking on unload is unreliable across tabs. Browser
        // GCs the blob when the originating extension page unloads.
    }

    /**
     * Fetch subtitle text, convert to VTT if needed, mount as a `<track>` via
     * Blob URL. Non-fatal: any failure here just leaves the player without
     * native captions — the inline `subtitle_text` div still shows the
     * transcript.
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
        const blob = new Blob([vttText], {type: 'text/vtt'});
        const url = URL.createObjectURL(blob);
        this._subtitleBlobUrl = url;

        const track = document.createElement('track');
        track.kind = 'subtitles';
        track.srclang = 'en';
        track.label = 'English';
        track.default = true;
        track.src = url;
        video.appendChild(track);
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
 * Split a single cue's text into `{t, hl?}` parts around the searched word.
 * Same Unicode-aware regex the inline panel uses for its `<mark>` highlight.
 * Returns a one-element array (no match / empty word) so the runtime
 * renderer doesn't have to special-case it.
 * @param {string} text
 * @param {string} word
 * @returns {{t: string, hl?: boolean}[]}
 */
function highlightCueParts(text, word) {
    if (typeof word !== 'string' || word.length === 0) { return [{t: text}]; }
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let re;
    try {
        re = new RegExp(`(?<![\\p{L}\\p{N}])(${escaped})(?![\\p{L}\\p{N}])`, 'giu');
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
 * Parse a VTT document into cue records the open-in-tab player can render
 * via a JS-driven overlay (instead of <track>, which is blocked by
 * data:/http cross-origin rules). Strips cue tags (`<c.foo>`, `<v X>`,
 * timestamp anchors) — we just want the visible plaintext.
 * @param {string} vtt
 * @returns {{start: number, end: number, text: string}[]}
 */
function parseVttCues(vtt) {
    const stripped = vtt.charCodeAt(0) === 0xFEFF ? vtt.slice(1) : vtt;
    const text = stripped.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    /** @type {{start: number, end: number, text: string}[]} */
    const cues = [];
    const blocks = text.split(/\n\n+/);
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
        const plain = rawText
            .replace(/<\d+:\d+:\d+[.,]\d+>/g, '')
            .replace(/<[^>]+>/g, '')
            .trim();
        if (plain.length === 0) { continue; }
        cues.push({start, end, text: plain});
    }
    return cues;
}
