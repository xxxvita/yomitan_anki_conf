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

import {highlightCueParts} from './example-highlight-forms.js';

/*
 * Субтитры в нативном полноэкранном режиме <video>.
 *
 * Подписи примеров рисуются JS-оверлеем (div поверх видео), а нативный
 * fullscreen показывает только сам <video> — оверлей пропадает. Поэтому к
 * видео добавляется <track kind="subtitles"> с VTT из тех же реплик:
 * пока видео встроено — mode='hidden' (виден оверлей), когда оно
 * fullscreenElement документа — mode='showing', а оверлей прячется.
 *
 * Найденные формы размечены `<c.hl>…</c>`; стиль — `::cue(.hl)` в display.css
 * (правила ::cue документа действуют на дорожки его <video>).
 *
 * ⚠️ VTT отдаётся blob:-URL (CSP попапа: `media-src * blob:`). Его
 * отзывает ВЛАДЕЛЕЦ вместе с blob-URL самого видео — здесь только создаём.
 */

/** @typedef {{start: number, end: number, text: string}} SubtitleCue */

/**
 * @typedef {object} SubtitleTrackHandle
 * @property {string} url blob:-URL VTT; отзывает вызывающий.
 * @property {() => void} dispose Перестать следить за fullscreen.
 */

/**
 * @param {number} sec
 * @returns {string} HH:MM:SS.mmm
 */
export function formatVttTime(sec) {
    const totalMs = Number.isFinite(sec) && sec > 0 ? Math.round(sec * 1000) : 0;
    const ms = totalMs % 1000;
    const totalSec = Math.floor(totalMs / 1000);
    const s = totalSec % 60;
    const m = Math.floor(totalSec / 60) % 60;
    const h = Math.floor(totalSec / 3600);
    const pad = (/** @type {number} */ v, /** @type {number} */ w) => String(v).padStart(w, '0');
    return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}.${pad(ms, 3)}`;
}

/**
 * Экранирование текста реплики VTT: &, <, > (заодно «-->» не закроет строку).
 * @param {string} text
 * @returns {string}
 */
export function escapeVttText(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * WebVTT из реплик; время — по шкале файла (как у оверлея).
 * @param {SubtitleCue[]} cues
 * @param {string[]} words Формы для подсветки (см. highlightCueParts).
 * @returns {string}
 */
export function buildHighlightedVtt(cues, words) {
    let vtt = 'WEBVTT\n\n';
    for (const cue of cues) {
        // Пустая строка внутри реплики закончила бы её раньше времени.
        const text = typeof cue.text === 'string' ? cue.text.replace(/\r\n?/g, '\n').replace(/\n\s*\n+/g, '\n').trim() : '';
        if (text.length === 0 || !Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.end <= cue.start) { continue; }
        const body = highlightCueParts(text, words)
            .map((p) => (p.hl === true ? `<c.hl>${escapeVttText(p.t)}</c>` : escapeVttText(p.t)))
            .join('');
        vtt += `${formatVttTime(cue.start)} --> ${formatVttTime(cue.end)}\n${body}\n\n`;
    }
    return vtt;
}

/**
 * Добавить к видео дорожку субтитров и переключать её с оверлеем по fullscreen.
 * @param {HTMLVideoElement} video
 * @param {{cues: SubtitleCue[], words: string[], overlay: ?HTMLElement}} options
 * @returns {?SubtitleTrackHandle} null — реплик нет, дорожка не нужна.
 */
export function attachSubtitleTrack(video, {cues, words, overlay}) {
    const vtt = buildHighlightedVtt(cues, words);
    if (vtt === 'WEBVTT\n\n') { return null; }
    const doc = video.ownerDocument;
    const url = URL.createObjectURL(new Blob([vtt], {type: 'text/vtt'}));
    const trackEl = doc.createElement('track');
    trackEl.kind = 'subtitles';
    trackEl.srclang = 'en';
    trackEl.label = 'English';
    trackEl.src = url;
    video.appendChild(trackEl);

    const update = () => {
        const fullscreen = doc.fullscreenElement === video;
        const track = /** @type {?TextTrack | undefined} */ (trackEl.track);
        if (typeof track === 'object' && track !== null) {
            const mode = fullscreen ? 'showing' : 'hidden';
            if (track.mode !== mode) { track.mode = mode; }
        }
        if (overlay !== null) { overlay.hidden = fullscreen; }
    };
    doc.addEventListener('fullscreenchange', update);
    update();
    return {
        url,
        dispose: () => { doc.removeEventListener('fullscreenchange', update); },
    };
}
