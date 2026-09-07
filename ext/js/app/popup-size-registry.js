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

/**
 * Арбитр размера попапа. Потребителей несколько (панель примеров, колонка
 * перевода), а iframe один: без арбитра закрытие одной панели схлопывало бы
 * попап под живой другой.
 */
export class PopupSizeRegistry {
    constructor() {
        /** @type {Map<string, {minWidth: number, minHeight: number}>} */
        this._owners = new Map();
    }

    /** @returns {number} */
    get size() {
        return this._owners.size;
    }

    /**
     * @param {string} owner
     * @param {number} minWidth
     * @param {number} minHeight
     */
    request(owner, minWidth, minHeight) {
        this._owners.set(owner, {minWidth, minHeight});
    }

    /** @param {string} owner */
    release(owner) {
        this._owners.delete(owner);
    }

    /**
     * Максимум по каждой оси независимо: широкая колонка и высокая панель
     * должны уживаться, а не вытеснять друг друга.
     * @returns {?{minWidth: number, minHeight: number}}
     */
    target() {
        if (this._owners.size === 0) {
            return null;
        }
        let minWidth = 0;
        let minHeight = 0;
        for (const requirement of this._owners.values()) {
            if (requirement.minWidth > minWidth) {
                minWidth = requirement.minWidth;
            }
            if (requirement.minHeight > minHeight) {
                minHeight = requirement.minHeight;
            }
        }
        return {minWidth, minHeight};
    }
}

/**
 * Размер, который надо применить.
 *
 * ⚠️ Считается от БАЗЫ, а не от текущего размера фрейма. Иначе при снятии
 * одного из двух владельцев попап остался бы раздутым под требование снятого:
 * Ru(1000) + Ex(820), сняли Ru -> цель 820, но max(текущие 1000, 820) = 1000.
 * @param {{base: {width: number, height: number}, target: ?{minWidth: number, minHeight: number}, caps: {width: number, height: number}}} details
 * @returns {{width: number, height: number}}
 */
export function computeAppliedSize({base, target, caps}) {
    if (target === null) {
        return {width: base.width, height: base.height};
    }
    return {
        width: Math.max(base.width, Math.min(target.minWidth, caps.width)),
        height: Math.max(base.height, Math.min(target.minHeight, caps.height)),
    };
}
