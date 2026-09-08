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

import {afterAll, describe, expect, test} from 'vitest';
import {setupDomTest} from './fixtures/dom-test.js';
import {Popup} from '../ext/js/app/popup.js';

// ⚠️ jsdom не реализует ни layout, ни `window.visualViewport`, поэтому
// `_getViewport(...)` уходит в ветку `window.innerWidth/innerHeight`. Значения
// задаём явно: вьюпорт 1000×800 — это тот прямоугольник, относительно которого
// считаются ВСЕ ожидания ниже. Геометрия рамки тоже задаётся строками в
// `style`, а не измеряется, — измерять в jsdom нечего.
const env = await setupDomTest();
const {window, teardown} = env;
// @ts-expect-error - jsdom's innerWidth/innerHeight are writable at runtime; only their DOM lib types mark them read-only.
window.innerWidth = 1000;
// @ts-expect-error - jsdom's innerWidth/innerHeight are writable at runtime; only their DOM lib types mark them read-only.
window.innerHeight = 800;

// Тот же приём, что в test/popup-size-target.test.js: метод снимается с
// прототипа и вызывается через `.call(context, ...)` на голом объекте с теми
// полями, которых он реально касается, — вместо поднятия настоящего Popup со
// всем его графом (FrameClient, ThemeController, api). Приватные методы,
// которые он зовёт, тоже берутся с прототипа, то есть НАСТОЯЩИЕ: подделан
// здесь только сам объект-носитель, не поведение.
// eslint-disable-next-line @typescript-eslint/unbound-method
const setFrameSize = Popup.prototype.setFrameSize;

/**
 * @typedef {object} ClampContext
 * @property {import('../ext/js/app/popup.js').Popup} popup Носитель, на котором вызывается `setFrameSize`.
 * @property {HTMLIFrameElement} frame Настоящий iframe: `dataset` и `style` у него живые.
 * @property {CSSStyleDeclaration} style Неперехваченная ссылка на тот же `style` — для чтения в проверках.
 * @property {string[]} writes Имена свойств `style`, в которые код под тестом записал значение.
 */

/**
 * @param {object} details
 * @param {string} details.left Начальный `style.left`.
 * @param {string} details.top Начальный `style.top`.
 * @param {number} details.width Начальная ширина рамки в пикселях.
 * @param {number} details.height Начальная высота рамки в пикселях.
 * @param {boolean} [details.fullWidth] Режим `full-width`, в котором позицию трогать нельзя.
 * @returns {ClampContext}
 */
function createContext({left, top, width, height, fullWidth = false}) {
    const frame = window.document.createElement('iframe');
    /** @type {string[]} */
    const writes = [];
    const style = frame.style;
    // Прокси только НАБЛЮДАЕТ: значения кладутся в настоящий CSSStyleDeclaration,
    // с его же нормализацией. Нужен, чтобы отличить «поставили то же значение»
    // от «не писали вовсе» (кейс «уже помещается»).
    const trackedStyle = new Proxy(style, {
        set: (target, property, value) => {
            writes.push(String(property));
            return Reflect.set(target, property, value);
        },
    });
    Object.defineProperty(frame, 'style', {configurable: true, get: () => trackedStyle});
    style.left = left;
    style.top = top;
    style.width = `${width}px`;
    style.height = `${height}px`;
    // `_show` пишет эти флаги вместе с позицией; сдвиг не имеет права их менять.
    frame.dataset.after = 'true';
    frame.dataset.below = 'false';
    const context = {
        _frame: frame,
        _displayModeIsFullWidth: fullWidth,
        _scaleRelativeToVisualViewport: true,
        // eslint-disable-next-line no-underscore-dangle, @typescript-eslint/unbound-method
        _setFrameSize: Popup.prototype._setFrameSize,
        // eslint-disable-next-line no-underscore-dangle, @typescript-eslint/unbound-method
        _getViewport: Popup.prototype._getViewport,
        // eslint-disable-next-line no-underscore-dangle, @typescript-eslint/unbound-method
        _clampFrameToViewport: Popup.prototype._clampFrameToViewport,
    };
    return {
        popup: /** @type {import('../ext/js/app/popup.js').Popup} */ (/** @type {unknown} */ (context)),
        frame,
        style,
        writes,
    };
}

describe('Popup#setFrameSize keeps the frame inside the viewport', () => {
    afterAll(() => teardown(global));

    test('рост вправо за край вьюпорта сдвигает рамку влево, пока она не влезет целиком', async () => {
        // Слово у правого края: рамка стоит на left=700 шириной 300 (ровно до
        // края 1000). Нажатие Ru расширяет её до 400 — правый край уехал бы на
        // 1100, то есть 100px попапа (с кнопками Ru/CheckWords) оказались бы за
        // экраном. Без сдвига left так и остался бы 700px.
        const {popup, style, writes} = createContext({left: '700px', top: '100px', width: 300, height: 200});

        await setFrameSize.call(popup, 400, 200);

        expect(style.left).toBe('600px');
        expect(Number.parseFloat(style.left) + 400).toBeLessThanOrEqual(1000);
        expect(style.top).toBe('100px');
        expect(writes).toContain('left');
    });

    test('рост вниз за нижний край вьюпорта поднимает рамку вверх', async () => {
        // Тот же механизм по второй оси: 700 + 300 = 1000 > 800.
        const {popup, style} = createContext({left: '100px', top: '700px', width: 300, height: 60});

        await setFrameSize.call(popup, 300, 300);

        expect(style.top).toBe('500px');
        expect(Number.parseFloat(style.top) + 300).toBeLessThanOrEqual(800);
        expect(style.left).toBe('100px');
    });

    test('если новый размер помещается, позиция не переписывается ВООБЩЕ', async () => {
        // Сжатие при снятии Ru: 100+300=400 и 100+200=300 — обе границы с
        // запасом. Любая безусловная запись left/top здесь — это видимый рывок
        // попапа вбок при закрытии колонки, поэтому проверяем не «значение то
        // же», а «записи не было».
        const {popup, style, writes} = createContext({left: '100px', top: '100px', width: 900, height: 700});

        await setFrameSize.call(popup, 300, 200);

        expect(writes).toEqual(['width', 'height']);
        expect(style.left).toBe('100px');
        expect(style.top).toBe('100px');
    });

    test('рамка больше вьюпорта прижимается к левому/верхнему краю, а не уезжает в минус', async () => {
        // Ручное перетаскивание размера потолком в 96% не ограничено. Наивное
        // `left = viewport.right - width` дало бы -200px, спрятав начало
        // контента (полосу с кнопками) за левым краем экрана.
        const {popup, style} = createContext({left: '400px', top: '300px', width: 300, height: 200});

        await setFrameSize.call(popup, 1200, 900);

        expect(style.left).toBe('0px');
        expect(style.top).toBe('0px');
    });

    test('в режиме full-width позиция не трогается', async () => {
        // `_show` в full-width сам ставит left = viewport.left и высоту/верх по
        // своим правилам; подтягивание рамки «внутрь» здесь дралось бы с ним.
        // Высота 900 при вьюпорте 800 — обычный режим сдвинул бы top c 100 на 0.
        const {popup, style, writes} = createContext({left: '0px', top: '100px', width: 1000, height: 400, fullWidth: true});

        await setFrameSize.call(popup, 1000, 900);

        expect(writes).toEqual(['width', 'height']);
        expect(style.top).toBe('100px');
        expect(style.left).toBe('0px');
    });

    test('флаги after/below сдвиг не переключает', async () => {
        const {popup, frame} = createContext({left: '700px', top: '700px', width: 300, height: 60});

        await setFrameSize.call(popup, 400, 300);

        expect(frame.dataset.after).toBe('true');
        expect(frame.dataset.below).toBe('false');
    });

    test('границы берутся из _getViewport, а не из window.innerWidth', async () => {
        // Под зумом браузера визуальный вьюпорт уже окна. Если сдвиг посчитать
        // по innerWidth (1000), рамка 500+300=800 «поместится» и не сдвинется, —
        // и на экране всё равно вылезет за правый край видимой области (600).
        const visualViewport = {offsetLeft: 0, offsetTop: 0, width: 600, height: 400, scale: 1};
        Object.defineProperty(window, 'visualViewport', {configurable: true, value: visualViewport});
        try {
            const {popup, style} = createContext({left: '500px', top: '100px', width: 100, height: 100});

            await setFrameSize.call(popup, 300, 100);

            expect(style.left).toBe('300px');
        } finally {
            Reflect.deleteProperty(window, 'visualViewport');
        }
    });
});
