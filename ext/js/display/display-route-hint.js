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
import {parseRoutePuzzleId} from '../data/flib-host.js';

/*
 * Событие маршрута hint_requested: слово открыто в popup на странице плеера
 * маршрута. Фильтр по вкладке и дедуп (12 ч на puzzle+type+lemma) делает
 * backend, поэтому здесь шлём на каждое подходящее обновление выдачи.
 * ⚠️ Вложенные попапы (depth > 0) событий не шлют. Результат вызова не влияет
 * на интерфейс; отказ только пишется в лог уровня log (без значка ошибки).
 */
export class DisplayRouteHint {
    /**
     * @param {import('./display.js').Display} display
     * @param {{api: import('../comm/api.js').API}} details
     */
    constructor(display, {api}) {
        /** @type {import('./display.js').Display} */
        this._display = display;
        /** @type {import('../comm/api.js').API} */
        this._api = api;
    }

    /** */
    prepare() {
        this._display.on('contentUpdateComplete', this._onContentUpdateComplete.bind(this));
    }

    /** */
    _onContentUpdateComplete() {
        try {
            const display = this._display;
            if (display.depth !== 0) { return; }
            if (parseRoutePuzzleId(display.getOptionsContext().url ?? '') === null) { return; }
            const entry = display.dictionaryEntries[display.selectedIndex] ?? display.dictionaryEntries[0];
            if (typeof entry === 'undefined' || entry.type !== 'term') { return; }
            const term = entry.headwords[0]?.term;
            if (typeof term !== 'string' || term.trim().length === 0) { return; }
            this._api.flibRecordEvent('hint_requested', [term]).catch((e) => {
                log.logGenericError(e, 'log');
            });
        } catch (e) {
            log.logGenericError(e, 'log');
        }
    }
}
