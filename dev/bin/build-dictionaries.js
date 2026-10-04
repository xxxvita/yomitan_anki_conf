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

// npm run build:dictionaries [-- --dict <dict_base.db>] [--journal <enrich.db>] [--out <dir>]
// npm run build:dictionaries -- --verify <builds/dictionaries/<revision>>
//
// Собирает пару wty-en-en.zip + flibooster-en-ru.zip из ДАННЫХ anki_conf
// (dict_base.db и журнал enrich.db), не вызывая код anki_conf. Источники
// открываются только на чтение. Пути: флаг > переменная окружения
// (FLIB_DICT_BASE_DB, FLIB_ENRICH_JOURNAL) > машинно-зависимое умолчание.
// Не входит в npm test: в CI нет данных anki_conf.

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {buildDictionaryPair} from '../dictionary-pair/pair-builder.js';
import {verifyPairZips} from '../dictionary-pair/pair-verify.js';
import {resolveSourcePaths} from '../dictionary-pair/sources.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT = path.join(dirname, '..', '..', 'builds', 'dictionaries');

/**
 * @param {string} directory
 */
async function verifyDirectory(directory) {
    const report = await verifyPairZips(
        fs.readFileSync(path.join(directory, 'wty-en-en.zip')),
        fs.readFileSync(path.join(directory, 'flibooster-en-ru.zip')),
    );
    console.log(JSON.stringify(report, null, 2));
}

/** */
async function main() {
    const {values} = parseArgs({
        options: {
            dict: {type: 'string'},
            journal: {type: 'string'},
            out: {type: 'string'},
            verify: {type: 'string'},
        },
    });
    if (typeof values.verify === 'string') {
        await verifyDirectory(values.verify);
        return;
    }
    const {dictPath, journalPath} = resolveSourcePaths(values, process.env);
    const outRoot = path.resolve(values.out ?? DEFAULT_OUT);
    console.error(`словарь: ${dictPath}\nжурнал:  ${journalPath}\nвыход:   ${outRoot}`);
    const started = Date.now();
    const result = await buildDictionaryPair({dictPath, journalPath, outRoot});
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    const {host, translation, transform} = /** @type {{host: Record<string, unknown>, translation: Record<string, unknown>, transform: Record<string, unknown>}} */ (result.buildJson);
    const maxRssMb = Math.round(process.resourceUsage().maxRSS / 1024);
    console.log(JSON.stringify({status: result.status, revision: result.revision, directory: result.directory, host, translation, transform, seconds, maxRssMb}, null, 2));
}

try {
    await main();
} catch (e) {
    console.error(`build:dictionaries: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
}
