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

import {afterAll, describe, expect, test, vi} from 'vitest';
import {setupDomTest} from './fixtures/dom-test.js';
import {Frontend} from '../ext/js/app/frontend.js';
import {PopupSizeRegistry} from '../ext/js/app/popup-size-registry.js';

// _applyPopupSizeTarget reads window.innerWidth/innerHeight to compute caps.
// Set them generously so none of the scenarios below are cap-limited — the
// caps themselves are already covered by popup-size-registry.test.js.
const env = await setupDomTest();
const {window, teardown} = env;
// @ts-expect-error - jsdom's innerWidth/innerHeight are writable at runtime; only their DOM lib types mark them read-only.
window.innerWidth = 2000;
// @ts-expect-error - jsdom's innerWidth/innerHeight are writable at runtime; only their DOM lib types mark them read-only.
window.innerHeight = 2000;

// Same technique as test/backend-mecab-parse.test.js: pull the handlers off
// the prototype and invoke them with `.call(context, ...)` against a plain
// object carrying only the fields/methods they actually touch, instead of
// standing up a full Frontend (text-scanner/popup-factory dependency graph).
// eslint-disable-next-line no-underscore-dangle, @typescript-eslint/unbound-method
const requestPopupSize = Frontend.prototype._onApiRequestPopupSize;
// eslint-disable-next-line no-underscore-dangle, @typescript-eslint/unbound-method
const fitPopupForViewport = Frontend.prototype._onApiFitPopupForViewport;
// eslint-disable-next-line no-underscore-dangle, @typescript-eslint/unbound-method
const applyPopupSizeTarget = Frontend.prototype._applyPopupSizeTarget;
// eslint-disable-next-line no-underscore-dangle, @typescript-eslint/unbound-method
const releasePopupSize = Frontend.prototype._onApiReleasePopupSize;
// eslint-disable-next-line no-underscore-dangle, @typescript-eslint/unbound-method
const setPopupSize = Frontend.prototype._onApiSetPopupSize;

/**
 * @param {Array<{width: number, height: number, valid: boolean}>} frameSizeSequence
 *   One entry per expected `getFrameSize` call, mirroring what the popup
 *   would actually report after each preceding `setFrameSize`.
 * @returns {{context: object, registry: PopupSizeRegistry, setFrameSize: import('vitest').Mock}}
 */
function createContext(frameSizeSequence) {
    const getFrameSize = vi.fn();
    for (const size of frameSizeSequence) {
        getFrameSize.mockResolvedValueOnce(size);
    }
    const setFrameSize = vi.fn().mockResolvedValue(void 0);
    const registry = new PopupSizeRegistry();
    // Only `_onApiFitPopupForViewport` reads `container` (to reposition the
    // popup); a real jsdom element satisfies its `instanceof HTMLElement`
    // guard, and its default (zeroed) `getBoundingClientRect` is fine since
    // these tests don't assert on the repositioning math.
    const container = window.document.createElement('div');
    const context = {
        _popup: {getFrameSize, setFrameSize, container},
        _popupSizeRegistry: registry,
        _popupOriginalSize: null,
        _popupAppliedSize: null,
        _applyPopupSizeTarget: applyPopupSizeTarget,
    };
    return {context, registry, setFrameSize};
}

describe('Frontend#_applyPopupSizeTarget', () => {
    afterAll(() => teardown(global));

    test('releasing one of two owners shrinks to the remaining owner\'s target, computed from the captured base — not the current frame size', async () => {
        const {context, registry, setFrameSize} = createContext([
            {width: 400, height: 250, valid: true}, // pre-expansion baseline — captured on the first apply
            {width: 820, height: 900, valid: true}, // popup after video-examples alone was applied
            {width: 1000, height: 900, valid: true}, // popup after translation-column also applied
        ]);

        await requestPopupSize.call(context, {owner: 'video-examples', minWidth: 820, minHeight: 900});
        await requestPopupSize.call(context, {owner: 'translation-column', minWidth: 1000, minHeight: 0});
        setFrameSize.mockClear();

        // Release straight on the registry plus a bare _applyPopupSizeTarget
        // call is the minimal reproduction of what _onApiReleasePopupSize
        // does, without hiding the assertion behind another layer.
        registry.release('translation-column');
        const result = await applyPopupSizeTarget.call(context);

        // If the current frame size (1000×900, already inflated by the
        // released owner) were used as the base instead of the captured
        // pre-expansion size (400×250), computeAppliedSize would return
        // 1000×900 again — identical to what getFrameSize just reported —
        // and setFrameSize would never fire. Exactly one call to the real
        // target (820×900) is the signal that the base, not the current
        // size, drove the computation.
        expect(setFrameSize).toHaveBeenCalledTimes(1);
        expect(setFrameSize).toHaveBeenCalledWith(820, 900);
        expect(result).toEqual({width: 820, height: 900, valid: true});
    });

    test('a viewport-fit height requirement (video-examples modal) survives a later request from another owner', async () => {
        // Regression: frontendFitPopupForViewport used to resize the popup
        // directly, bypassing the registry entirely. A later request from
        // any owner then recomputed from the captured base as if the fit
        // had never happened, silently shrinking the popup out from under
        // a still-open modal.
        const {context, setFrameSize} = createContext([
            {width: 400, height: 250, valid: true}, // pre-expansion baseline
            {width: 820, height: 900, valid: true}, // after video-examples panel mounted
            {width: 820, height: 900, valid: true}, // _onApiFitPopupForViewport's own getFrameSize read
            {width: 820, height: 970, valid: true}, // after the viewport-fit requirement was applied
        ]);

        await requestPopupSize.call(context, {owner: 'video-examples', minWidth: 820, minHeight: 900});
        await fitPopupForViewport.call(context, {minHeight: 970});
        setFrameSize.mockClear();

        // A second video-examples panel mounts and re-asserts the same
        // requirement it already holds — this is exactly the re-request
        // display-anki.js issues once per mount-batch.
        const result = await requestPopupSize.call(context, {owner: 'video-examples', minWidth: 820, minHeight: 900});

        // The modal's 970px requirement must still win: nothing should
        // shrink the popup back down to video-examples' own 900px floor.
        expect(setFrameSize).not.toHaveBeenCalled();
        expect(result).toEqual({width: 820, height: 970, valid: true});
    });

    test('A22 целиком: снятие одного владельца сжимает до требования второго, снятие последнего ВОЗВРАЩАЕТ исходный размер', async () => {
        // ⚠️ Релиз идёт через настоящий _onApiReleasePopupSize, а не через
        // registry.release + голый _applyPopupSizeTarget: без этого путь
        // «обработчик релиза вообще зовёт применение» остаётся непроверенным —
        // обработчик, переставший звать _applyPopupSizeTarget, был зелёным.
        const {context, setFrameSize} = createContext([
            {width: 400, height: 250, valid: true}, // размер до всякого расширения
            {width: 820, height: 900, valid: true}, // после Ex
            {width: 1000, height: 900, valid: true}, // после Ru
            {width: 820, height: 900, valid: true}, // после снятия Ru
        ]);

        await requestPopupSize.call(context, {owner: 'video-examples', minWidth: 820, minHeight: 900});
        await requestPopupSize.call(context, {owner: 'translation-column', minWidth: 1000, minHeight: 0});
        setFrameSize.mockClear();

        await releasePopupSize.call(context, {owner: 'translation-column'});
        expect(setFrameSize).toHaveBeenCalledTimes(1);
        expect(setFrameSize).toHaveBeenLastCalledWith(820, 900);

        await releasePopupSize.call(context, {owner: 'video-examples'});
        // Владельцев не осталось — попап обязан вернуться к 400×250.
        expect(setFrameSize).toHaveBeenCalledTimes(2);
        expect(setFrameSize).toHaveBeenLastCalledWith(400, 250);
    });

    test('A22, другое направление: снят владелец, просивший ВЫСОТУ — высота возвращается к базе, ширина живого владельца держится', async () => {
        // ⚠️ Это та самая строка, на которой стоит весь выбор семантики.
        // Предлагавшееся «ось, которую никто не просит, оставить в покое»
        // даёт здесь 1000×900: высота остаётся раздутой под требование уже
        // СНЯТОГО владельца. Поосевое освежение базы даёт 1000×250 — попап
        // держит ширину колонки и возвращает высоту к своей.
        const {context, setFrameSize} = createContext([
            {width: 400, height: 250, valid: true}, // до расширения
            {width: 820, height: 900, valid: true}, // после Ex
            {width: 1000, height: 900, valid: true}, // после Ru
        ]);

        await requestPopupSize.call(context, {owner: 'video-examples', minWidth: 820, minHeight: 900});
        await requestPopupSize.call(context, {owner: 'translation-column', minWidth: 1000, minHeight: 0});
        setFrameSize.mockClear();

        await releasePopupSize.call(context, {owner: 'video-examples'});

        expect(setFrameSize).toHaveBeenCalledTimes(1);
        expect(setFrameSize).toHaveBeenCalledWith(1000, 250);
    });

    test('высота следующей выдачи НЕ прибивается к базе, захваченной на первом слове', async () => {
        // ⚠️ Дефект, который тут ловится: база снималась ОДИН раз, а колонка
        // просит minHeight: 0, так что высота схлопывалась в max(база, 0).
        // Первое слово внизу короткого окна давало базу высотой 120
        // (_getConstrainedPositionBinary поджал попап под остаток места) — и
        // КАЖДОЕ следующее слово попап снова сплющивало до 120, хотя
        // popup._show уже вернул ему нормальные 250.
        const {context, setFrameSize} = createContext([
            {width: 400, height: 120, valid: true}, // слово внизу короткого окна
            {width: 800, height: 250, valid: true}, // popup._show на следующем слове вернул высоту
        ]);

        await requestPopupSize.call(context, {owner: 'translation-column', minWidth: 800, minHeight: 0});
        expect(setFrameSize).toHaveBeenLastCalledWith(800, 120);
        setFrameSize.mockClear();

        // Та же выдача, следующее слово: колонка перезапрашивает размер.
        const result = await requestPopupSize.call(context, {owner: 'translation-column', minWidth: 800, minHeight: 0});

        expect(result).toEqual({width: 800, height: 250, valid: true});
        expect(setFrameSize).not.toHaveBeenCalled();
    });

    test('размер, выставленный руками, переживает пересчёт арбитра и становится тем, к чему попап возвращается', async () => {
        // ⚠️ Дефект, который тут ловится: display-resizer писал размер
        // напрямую в popupFactorySetFrameSize, мимо арбитра. Арбитр про этот
        // размер не знал и первым же пересчётом (открылась панель примеров)
        // отматывал его к своей вычисленной величине.
        const {context, setFrameSize} = createContext([
            {width: 400, height: 250, valid: true}, // до расширения
            {width: 1200, height: 600, valid: true}, // после перетаскивания уголка
            {width: 1200, height: 900, valid: true}, // после требования панели примеров
            {width: 1200, height: 900, valid: true}, // после снятия колонки
        ]);

        await requestPopupSize.call(context, {owner: 'translation-column', minWidth: 800, minHeight: 0});
        await setPopupSize.call(context, {width: 1200, height: 600});
        expect(setFrameSize).toHaveBeenLastCalledWith(1200, 600);
        setFrameSize.mockClear();

        // Панель примеров требует 820×900 — ширину, выбранную руками, это
        // требование обязано не трогать (1200 > 820), а не откатывать её к
        // захваченным когда-то 400.
        const result = await requestPopupSize.call(context, {owner: 'video-examples', minWidth: 820, minHeight: 900});
        expect(result).toEqual({width: 1200, height: 900, valid: true});

        // И возвращаться попап обязан к РУЧНОМУ размеру, а не к тому, что
        // было базой до перетаскивания.
        setFrameSize.mockClear();
        await releasePopupSize.call(context, {owner: 'translation-column'});
        await releasePopupSize.call(context, {owner: 'video-examples'});
        expect(setFrameSize).toHaveBeenLastCalledWith(1200, 600);
    });

    test('перетаскивание РОВНО в тот размер, который арбитр уже выставил, всё равно становится базой', async () => {
        // ⚠️ Именно этот случай отличает «резизер сообщает о своём размере»
        // от «арбитр сам догадается по расхождению»: догадка работает, только
        // пока перетащенный размер отличается от последнего применённого. Если
        // пользователь дотянул уголок ровно до него, расхождения нет, и без
        // явного сообщения арбитр считал бы базой всё ещё дораздвижные 400 —
        // и вернул бы попап туда, отменив осознанный выбор пользователя.
        const {context, setFrameSize} = createContext([
            {width: 400, height: 250, valid: true}, // до расширения
            {width: 800, height: 250, valid: true}, // после перетаскивания
        ]);

        await requestPopupSize.call(context, {owner: 'translation-column', minWidth: 800, minHeight: 0});
        await setPopupSize.call(context, {width: 800, height: 250});
        setFrameSize.mockClear();

        await releasePopupSize.call(context, {owner: 'translation-column'});

        // Владельцев не осталось — попап возвращается к базе. База теперь та,
        // что выбрана руками, поэтому менять нечего.
        expect(setFrameSize).not.toHaveBeenCalled();
    });
});
