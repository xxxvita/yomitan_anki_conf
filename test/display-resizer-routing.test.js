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

import {describe, expect, test, vi} from 'vitest';
import {DisplayResizer} from '../ext/js/display/display-resizer.js';

// Same technique as test/popup-size-target.test.js: pull the method off the
// prototype and invoke it with `.call(context, ...)` against a plain object
// carrying only the fields it actually touches.
// eslint-disable-next-line no-underscore-dangle, @typescript-eslint/unbound-method
const updateFrameSize = DisplayResizer.prototype._updateFrameSize;

/**
 * @param {?string} [parentPopupId]
 * @returns {{context: object, invokeContentOrigin: import('vitest').Mock, invokeParentFrame: import('vitest').Mock}}
 */
function createContext(parentPopupId = 'popup-1') {
    const invokeContentOrigin = vi.fn().mockResolvedValue(void 0);
    const invokeParentFrame = vi.fn().mockResolvedValue(void 0);
    const context = {
        _display: {
            parentPopupId,
            invokeContentOrigin,
            invokeParentFrame,
        },
        _handle: {getBoundingClientRect: () => ({width: 16, height: 16})},
        _startOffset: {x: 100, y: 100},
        _startSize: {width: 400, height: 250},
    };
    return {context, invokeContentOrigin, invokeParentFrame};
}

describe('DisplayResizer#_updateFrameSize — маршрутизация', () => {
    test('размер уходит в КАДР-ИСТОЧНИК КОНТЕНТА, а не в родительский кадр', async () => {
        // ⚠️ Дефект, который тут ловится, — не «размер не поставился», а
        // «поставился не тому». Реестр размера, база и последний применённый
        // размер живут в том же фронтенде, куда шлют требования `Ru` и `Ex`, а
        // это `invokeContentOrigin`. `invokeParentFrame` ведёт в кадр, где был
        // создан объект попапа: у вложенного попапа это кадр РОДИТЕЛЬСКОГО
        // попапа (перетащили один — поехал другой), а при
        // `showIframePopupsInRootFrame` — корневой кадр, где состояния арбитра
        // для этого попапа нет вовсе. Тест, проверяющий только «физический
        // размер выставлен», обе эти поломки пропустил бы: он зелен при любом
        // из двух адресатов.
        const {context, invokeContentOrigin, invokeParentFrame} = createContext();

        await updateFrameSize.call(context, 300, 200);

        expect(invokeContentOrigin).toHaveBeenCalledTimes(1);
        expect(invokeContentOrigin).toHaveBeenCalledWith('frontendSetPopupSize', {width: 600, height: 350});
        expect(invokeParentFrame).not.toHaveBeenCalled();
    });

    test('без родительского попапа (отдельное окно, страница поиска) не шлётся ничего', async () => {
        const {context, invokeContentOrigin, invokeParentFrame} = createContext(null);

        await updateFrameSize.call(context, 300, 200);

        expect(invokeContentOrigin).not.toHaveBeenCalled();
        expect(invokeParentFrame).not.toHaveBeenCalled();
    });
});
