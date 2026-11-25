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

import {addFullscreenChangeEventListener, getFullscreenElement} from '../dom/document-util.js';

/** Сколько после выхода ждать прежнего окна (мс): с запасом на анимацию выхода. */
export const SETTLE_TIMEOUT = 1500;

/**
 * Окно страницы: те же поля, что у `window`, поэтому `Popup._getViewport`
 * читает снимок и живое окно одинаково.
 * @typedef {object} Viewport
 * @property {number} innerWidth
 * @property {number} innerHeight
 * @property {?{offsetLeft: number, offsetTop: number, width: number, height: number, scale: number}} [visualViewport]
 */

/**
 * Полный экран нашего popup и ожидание после него закончились.
 * @typedef {(viewportIsBack: boolean) => void} SettledListener
 */

/**
 * Контейнеры (iframe или shadow-хост) всех popup этого документа — любой
 * глубины. Нужен, чтобы popup не переносил свой контейнер, когда полноэкранным
 * стал контейнер ДРУГОГО нашего popup: у закрытого shadow-хоста `.shadowRoot`
 * равен null, и _getFrameParentElement вернул бы чужой хост как нового
 * родителя (перенос = перезагрузка iframe → _resetFrame).
 * @type {WeakSet<Element>}
 */
const popupContainers = new WeakSet();

/**
 * @param {Element} container
 */
export function registerPopupContainer(container) {
    popupContainers.add(container);
}

/**
 * @param {?Element} element
 * @returns {boolean}
 */
export function isPopupContainerElement(element) {
    return element !== null && popupContainers.has(element);
}

/**
 * Видео внутри popup во весь экран: окно страницы меняет размер туда и
 * обратно, а iframe popup на это время равен экрану. Ни то ни другое не должно
 * попасть в место и размер popup. Сторож знает, идёт ли «наш» полный экран или
 * ожидание прежнего окна после него, и помнит окно до входа.
 *
 * Порядок событий не важен — состояние пересчитывается при каждом обращении;
 * нужно лишь, чтобы элемент был назначен до первого resize входа (так в обоих
 * браузерах).
 * Замеры (элемент — document.fullscreenElement):
 * - Chromium 1228, вход: resize (элемент уже наш) → fullscreenchange → resize;
 *   выход: resize (элемента нет, промежуточный размер) → fullscreenchange →
 *   resize (прежнее окно).
 * - Firefox 151, вход: resize (элемент наш) → fullscreenchange; выход:
 *   fullscreenchange при окне МЕНЬШЕ прежнего → resize → resize.
 *
 * ⚠️ Ожидание после выхода всегда длится SETTLE_TIMEOUT, а не кончается при
 * первом совпадении размера: перестановку вызывает ТОТ ЖЕ resize, который окно
 * вернул, и её асинхронная цепочка (а у прокси из других фреймов — сообщение)
 * доходит до popup уже после совпадения.
 */
export class PopupFullscreenGuard {
    constructor() {
        /** @type {'idle'|'fullscreen'|'settling'} */
        this._phase = 'idle';
        /** @type {?Viewport} Последнее окно без нашего полного экрана. */
        this._steady = null;
        /** @type {?Viewport} Окно до входа; не null, пока фаза не idle. */
        this._before = null;
        /** @type {?import('core').Timeout} */
        this._timer = null;
        /** @type {Set<SettledListener>} */
        this._listeners = new Set();
        /** @type {boolean} */
        this._prepared = false;
    }

    /** */
    prepare() {
        if (this._prepared) { return; }
        this._prepared = true;
        const update = this._update.bind(this);
        window.addEventListener('resize', update, true);
        addFullscreenChangeEventListener(update);
        update();
    }

    /**
     * @param {SettledListener} listener
     */
    addListener(listener) {
        this._listeners.add(listener);
    }

    /**
     * Идёт полный экран контейнера нашего popup или ожидание прежнего окна.
     * @returns {boolean}
     */
    isActive() {
        this._update();
        return this._phase !== 'idle';
    }

    /**
     * Окно, в котором popup стоит: до полного экрана, пока он (или ожидание
     * после него) идёт; иначе — живое.
     * @returns {Viewport}
     */
    getViewport() {
        this._update();
        return this._before ?? window;
    }

    /**
     * Ожидание ещё идёт, но окно уже то, что было до входа.
     * @returns {boolean}
     */
    isViewportBack() {
        this._update();
        return this._phase === 'settling' && this._before !== null && this._isSameViewport(this._before, this._getSnapshot());
    }

    /**
     * @param {Element} container
     * @returns {boolean}
     */
    isFullscreen(container) {
        return getFullscreenElement() === container;
    }

    // Private

    /**
     * @returns {void}
     */
    _update() {
        if (isPopupContainerElement(getFullscreenElement())) {
            this._clearTimer();
            if (this._phase === 'idle') { this._before = this._steady ?? this._getSnapshot(); }
            this._phase = 'fullscreen';
        } else if (this._phase === 'fullscreen') {
            this._phase = 'settling';
            this._timer = setTimeout(this._settle.bind(this), SETTLE_TIMEOUT);
        } else if (this._phase === 'idle') {
            this._steady = this._getSnapshot();
        }
    }

    /**
     * @returns {void}
     */
    _settle() {
        this._update();
        if (this._phase !== 'settling') { return; }
        const before = this._before;
        this._timer = null;
        this._phase = 'idle';
        this._before = null;
        this._steady = this._getSnapshot();
        const viewportIsBack = before !== null && this._isSameViewport(before, this._steady);
        for (const listener of this._listeners) {
            listener(viewportIsBack);
        }
    }

    /**
     * @returns {void}
     */
    _clearTimer() {
        if (this._timer === null) { return; }
        clearTimeout(this._timer);
        this._timer = null;
    }

    /**
     * Размер окна и положение видимой области (зум пальцами сдвигает её без
     * смены размера окна). Её ширина и высота не сравниваются: на них влияют
     * полосы прокрутки.
     * @param {Viewport} a
     * @param {Viewport} b
     * @returns {boolean}
     */
    _isSameViewport(a, b) {
        return (
            a.innerWidth === b.innerWidth &&
            a.innerHeight === b.innerHeight &&
            a.visualViewport?.scale === b.visualViewport?.scale &&
            a.visualViewport?.offsetLeft === b.visualViewport?.offsetLeft &&
            a.visualViewport?.offsetTop === b.visualViewport?.offsetTop
        );
    }

    /**
     * @returns {Viewport}
     */
    _getSnapshot() {
        const {innerWidth, innerHeight, visualViewport} = window;
        if (typeof visualViewport === 'undefined' || visualViewport === null) {
            return {innerWidth, innerHeight, visualViewport: null};
        }
        const {offsetLeft, offsetTop, width, height, scale} = visualViewport;
        return {innerWidth, innerHeight, visualViewport: {offsetLeft, offsetTop, width, height, scale}};
    }
}

/** Один на документ: контейнеры popup всех глубин и их фронтенды — здесь же. */
export const popupFullscreenGuard = new PopupFullscreenGuard();
