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
     */
    open(clip) {
        // If another modal is up, swap atomically: close the old, open the new.
        this.close();
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

        let trackTag = '';
        if (typeof clip.subtitle_url === 'string' && clip.subtitle_url.length > 0) {
            try {
                const response = await fetch(clip.subtitle_url, {credentials: 'omit'});
                if (response.ok) {
                    const text = await response.text();
                    const vttText = isVttDocument(text) ? text : srtToVtt(text);
                    // base64 encode for inline data: URL — survives across
                    // the blob-HTML boundary without cross-origin headers.
                    const utf8 = new TextEncoder().encode(vttText);
                    let bin = '';
                    for (const b of utf8) { bin += String.fromCharCode(b); }
                    const trackUrl = `data:text/vtt;base64,${btoa(bin)}`;
                    trackTag = `<track default kind="subtitles" srclang="en" label="English" src="${trackUrl}">`;
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
        // `<track default>` is a hint, not a guarantee — Chrome auto-enables
        // a default track only when the user has captions globally on. A
        // tiny inline script forces every track to `showing` once the video
        // metadata loads, which is the only reliable way to surface our
        // single English track without nagging the user.
        const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Video example</title>
<style>
  html,body{margin:0;background:#000;color:#eee;font-family:system-ui,sans-serif;height:100%;}
  body{display:flex;flex-direction:column;justify-content:center;align-items:center;}
  video{max-width:100vw;max-height:90vh;background:#000;}
  .caption{padding:.6em 1em;font-size:1.05em;text-align:center;line-height:1.4;}
  ::cue{background:rgba(0,0,0,.7);color:#fff;}
</style></head>
<body>
<video id="v" controls autoplay src="${clipUrl}">${trackTag}</video>
${subtitleText.length > 0 ? `<div class="caption">${escaped}</div>` : ''}
<script>
(function(){
  var v=document.getElementById('v');
  function on(){for(var i=0;i<v.textTracks.length;i++){v.textTracks[i].mode='showing';}}
  v.addEventListener('loadedmetadata',on);
  v.textTracks.addEventListener&&v.textTracks.addEventListener('addtrack',on);
  on();
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
