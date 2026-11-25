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

/*
 * The footer notifications lie over the results. In the phrase window the panel of examples ends there, with the button
 * that saves: an error must not cover the button that repeats the save. The stylesheet keeps the space free
 * (display.css), here its height is measured and the results are scrolled by what would still be covered.
 */

const HEIGHT_VARIABLE = '--footer-notifications-height';

export class FooterSpace {
    /**
     * @param {HTMLElement} footer The container of the notifications.
     * @param {HTMLElement} scrollElement The results.
     */
    constructor(footer, scrollElement) {
        /** @type {HTMLElement} */
        this._footer = footer;
        /** @type {HTMLElement} */
        this._scrollElement = scrollElement;
        /** @type {number} */
        this._height = 0;
    }

    /** */
    prepare() {
        if (typeof ResizeObserver !== 'function') { return; }
        new ResizeObserver(() => { this._update(); }).observe(this._footer);
    }

    // Private

    /** */
    _update() {
        const {height} = this._footer.getBoundingClientRect();
        const previous = this._height;
        if (height === previous) { return; }
        this._height = height;
        const foot = document.querySelector('.entry[data-type=phrase] .fc-xp-foot');
        const view = this._scrollElement.getBoundingClientRect();
        const before = foot?.getBoundingClientRect() ?? null;
        document.documentElement.style.setProperty(HEIGHT_VARIABLE, `${height}px`);
        // What the user has scrolled away from stays there.
        if (height < previous || foot === null || before === null || before.top >= view.bottom) { return; }
        // Where nothing has to be scrolled it has moved up by itself; a hidden one is at the top, of no height.
        const covered = foot.getBoundingClientRect().bottom - (view.bottom - height);
        if (covered > 0) { this._scrollElement.scrollTop += covered; }
    }
}
