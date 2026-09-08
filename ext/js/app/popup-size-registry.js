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
 * Пересчитывает БАЗУ — размер попапа «без требований владельцев» — по тому,
 * что фрейм показывает сейчас.
 *
 * ⚠️ Сравнение ПООСЕВОЕ и идёт против `applied` — размера, который арбитр сам
 * в последний раз выставил. Смысл: если ось совпала с нашей же последней
 * записью, значит с тех пор её никто не трогал и база по ней остаётся
 * прежней; если разошлась — фрейм переставил КТО-ТО ДРУГОЙ, и новое значение
 * и есть новая база по этой оси.
 *
 * ⚠️ «Кто-то другой» — не абстракция, а два ежедневных случая:
 *
 * 1. `popup._show()` при КАЖДОЙ выдаче заново ставит размер фрейма
 *    (`popup.js`, `_getPosition` -> `_setFrameSize`), поджимая его под место,
 *    оставшееся над/под словом. Слово внизу короткого окна даёт, например,
 *    высоту 120. Захваченная ОДИН РАЗ база (как было раньше) после этого
 *    навсегда прижимала попап к 120 на каждом следующем слове: колонка
 *    просит `minHeight: 0`, и высота схлопывалась в `max(база, 0)`.
 * 2. Ручное перетаскивание уголка (`display-resizer.js`): выбранный
 *    пользователем размер обязан стать базой, иначе первый же запрос
 *    владельца отматывал бы его назад.
 *
 * ⚠️ Пооcевое, а не «оставить ось в покое, если её никто не просит»:
 * последнее сохранило бы попап раздутым по высоте после снятия владельца,
 * который эту высоту и просил (Ru(1000,0) + Ex(820,900), сняли Ex — высота
 * обязана вернуться к базе, а не остаться 900).
 * @param {{base: ?{width: number, height: number}, current: {width: number, height: number}, applied: ?{width: number, height: number}}} details
 * @returns {{width: number, height: number}}
 */
export function reconcileBaseSize({base, current, applied}) {
    if (base === null || applied === null) {
        return {width: current.width, height: current.height};
    }
    // ⚠️ СРАВНЕНИЕ ТОЧНОЕ, И ЭТО МОЛЧАЛИВАЯ ЗАВИСИМОСТЬ ОТ CSS. `current`
    // приходит из `popup.getFrameSize()` = `offsetWidth/offsetHeight`
    // (`popup.js`), а `applied` — из того, что мы записали в `style.width/
    // height`. Совпадают эти два числа только потому, что
    // `iframe.yomitan-popup` объявлен `box-sizing: border-box` при рамке
    // `1em` (`ext/css/popup-outer.css`, правило `iframe.yomitan-popup`):
    // рамка входит внутрь заданной ширины, и `offsetWidth` равен ей.
    //
    // Смените там `box-sizing` на `content-box` (или уберите его) — и
    // `offsetWidth` станет больше заданного на толщину рамки. Тогда ЛЮБАЯ ось
    // на КАЖДОМ применении читается как «переставлена кем-то другим», база
    // ползёт вверх до раздутого размера, и снятие последнего владельца НИКОГДА
    // не возвращает попап к исходному размеру. Ни один тест этого не поймает:
    // в jsdom геометрии нет, а здесь сравниваются просто числа.
    return {
        width: current.width === applied.width ? base.width : current.width,
        height: current.height === applied.height ? base.height : current.height,
    };
}

/**
 * Размер, который надо применить.
 *
 * ⚠️ Считается от БАЗЫ, а не от текущего размера фрейма. Иначе при снятии
 * одного из двух владельцев попап остался бы раздутым под требование снятого:
 * Ru(1000) + Ex(820), сняли Ru -> цель 820, но max(текущие 1000, 820) = 1000.
 * База при этом обязана быть СВЕЖЕЙ — её пересчитывает `reconcileBaseSize`.
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
