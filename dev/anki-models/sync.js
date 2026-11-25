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
 * Пишет ext/data/flib-anki-models.json (СГЕНЕРИРОВАННЫЙ, руками не править)
 * из dev/data/anki-models/*.json —
 * дословных копий anki_conf internal/ankimodels/models/*.json.
 *
 * Обновить копии и модуль:
 *   for m in "Yomitan Card Type" ReverseDeck Phrases; do
 *     git -C <anki_conf> show "<commit>:internal/ankimodels/models/$m.json" > "dev/data/anki-models/$m.json"; done
 *   node dev/anki-models/sync.js "anki_conf <commit>"
 *
 * history/<тип>-<коммит>.json — дословные копии прежних канонических версий. От них в
 * модуль идут только отпечатки «Card 1» (`previous`): по ним расширение узнаёт тип,
 * который пользователь не правил. ⚠️ Версия, которая была выпущена и меняется, переносится
 * в history ДО обновления копии, иначе её тип будет принят за правленый.
 */

import {readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {parseJson} from '../../ext/js/core/json.js';
import {hashModelContent} from '../../ext/js/data/flib-anki-models.js';
import {modelRevision, stampRevMarker} from './revision.js';

const source = process.argv[2];
if (typeof source !== 'string' || source === '') {
    throw new Error('usage: node dev/anki-models/sync.js "anki_conf <commit>"');
}
const dir = new URL('../data/anki-models/', import.meta.url);
const historyDir = new URL('history/', dir);

/**
 * @param {URL} directory
 * @returns {import('./revision.js').SourceModel[]}
 */
function readModels(directory) {
    const files = readdirSync(directory).filter((name) => name.endsWith('.json')).sort();
    return files.map((file) => /** @type {import('./revision.js').SourceModel} */ (parseJson(readFileSync(new URL(file, directory), 'utf8'))));
}

/**
 * @param {string[]} texts
 * @returns {Promise<string[]>}
 */
async function hashAll(texts) {
    return [...new Set(await Promise.all(texts.map(hashModelContent)))];
}

/**
 * @param {import('./revision.js').SourceModel[]} revisions
 * @returns {Promise<import('flib-anki-models').FlibAnkiModelPrevious>}
 */
async function hashHistory(revisions) {
    return {
        front: await hashAll(revisions.map(({templates}) => templates['Card 1'].Front)),
        back: await hashAll(revisions.map(({templates}) => templates['Card 1'].Back)),
        css: await hashAll(revisions.map(({css}) => css)),
    };
}

/** @type {Map<string, import('./revision.js').SourceModel[]>} */
const history = new Map();
for (const model of readModels(historyDir)) {
    history.set(model.name, [...(history.get(model.name) ?? []), model]);
}

const models = await Promise.all(readModels(dir).map(async (model) => {
    const names = Object.keys(model.templates).sort();
    const previous = history.get(model.name);
    history.delete(model.name);
    return {
        name: model.name,
        fields: model.fields,
        css: stampRevMarker(model.css, modelRevision(model)),
        isCloze: model.isCloze === true,
        cardTemplates: names.map((name) => ({Name: name, Front: model.templates[name].Front, Back: model.templates[name].Back})),
        ...(typeof previous === 'undefined' ? {} : {previous: await hashHistory(previous)}),
    };
}));
if (history.size > 0) { throw new Error(`history of unknown models: ${[...history.keys()].join(', ')}`); }
models.sort((a, b) => (a.name < b.name ? -1 : (a.name > b.name ? 1 : 0)));

/** @type {{source: string, models: object[]}} */
const data = {source, models};
writeFileSync(new URL('../../ext/data/flib-anki-models.json', import.meta.url), `${JSON.stringify(data, null, 4)}\n`);
console.log(`wrote ${models.length} models from ${source}`);
