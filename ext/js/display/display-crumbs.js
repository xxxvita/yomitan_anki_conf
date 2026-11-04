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

import {createIcon} from './flib-icons.js';

/*
 * Вложенная карточка Flib-club (макет flib-nest.jsx): шапка «google › search ›
 * engine» — слова родительских карточек и, жирным, текущее.
 *
 * Цепочка едет в HistoryState.crumbs: Display родителя отдаёт её своему
 * вложенному Frontend (Frontend.setCrumbsProvider), тот кладёт в состояние
 * содержимого дочернего попапа. Попап верхнего уровня crumbs не получает и
 * шапку не показывает. «Назад» по истории дочернего попапа восстанавливает
 * цепочку своей записи — она хранится в её состоянии.
 */

/** Звеньев в шапке не больше: длинная цепочка — последние. */
const MAX_CRUMBS = 6;
/** Длина звена в символах: длиннее — обрезается с «…». */
const MAX_CRUMB_LENGTH = 40;

/**
 * @param {unknown} value `HistoryState.crumbs` — из чужого кадра, проверяем.
 * @returns {string[]} Непустые строки, обрезанные; последние {@link MAX_CRUMBS}.
 */
export function sanitizeCrumbs(value) {
    if (!Array.isArray(value)) { return []; }
    /** @type {string[]} */
    const result = [];
    for (const item of value) {
        if (typeof item !== 'string') { continue; }
        const text = item.trim();
        if (text.length === 0) { continue; }
        result.push(text.length > MAX_CRUMB_LENGTH ? `${text.slice(0, MAX_CRUMB_LENGTH - 1)}…` : text);
    }
    return result.slice(-MAX_CRUMBS);
}

/**
 * @param {unknown} crumbs Цепочка текущей карточки.
 * @param {string} query Её слово.
 * @returns {string[]} Цепочка для дочерней карточки.
 */
export function nextCrumbs(crumbs, query) {
    return sanitizeCrumbs([...sanitizeCrumbs(crumbs), query]);
}

export class DisplayCrumbs {
    /**
     * @param {import('./display.js').Display} display
     */
    constructor(display) {
        /** @type {import('./display.js').Display} */
        this._display = display;
        /** @type {?HTMLElement} */
        this._header = null;
    }

    /** */
    prepare() {
        this._display.on('contentUpdateComplete', () => { this._render(); });
        this._display.on('contentClear', () => { this._remove(); });
    }

    /** */
    _render() {
        this._remove();
        const crumbs = sanitizeCrumbs(this._display.history.state?.crumbs);
        if (crumbs.length === 0) { return; }
        const inner = document.querySelector('.content-body-inner');
        if (inner === null) { return; }

        const header = document.createElement('nav');
        header.className = 'fc-nest-h';
        header.setAttribute('aria-label', 'Путь по словам');
        const words = [...crumbs, this._display.query.trim()].filter((w) => w.length > 0);
        for (const [i, word] of words.entries()) {
            if (i > 0) { header.appendChild(createIcon('chevR')); }
            const span = document.createElement('span');
            span.className = 'fc-crumb';
            span.textContent = word;
            if (i === words.length - 1) {
                span.classList.add('fc-cur');
                span.setAttribute('aria-current', 'page');
            }
            header.appendChild(span);
        }
        inner.prepend(header);
        this._header = header;
    }

    /** */
    _remove() {
        if (this._header === null) { return; }
        this._header.remove();
        this._header = null;
    }
}
