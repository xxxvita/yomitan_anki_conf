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

// npm run build:dictionaries -- --dict <dict_base.db> [--out <dir>]
// npm run build:dictionaries -- --verify <builds/dictionaries/<revision>>
//
// Собирает пару wty-en-en.zip + flibooster-en-ru.zip из dict_base.db anki_conf,
// не вызывая код anki_conf: обе стороны — строки базы как есть. База
// открывается только на чтение. Путь обязателен: флаг --dict важнее переменной
// FLIB_DICT_BASE_DB; умолчания нет намеренно (sources.js). Не входит в
// npm test: в CI нет данных anki_conf.

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {parseJson} from '../json.js';
import {buildDictionaryPair} from '../dictionary-pair/pair-builder.js';
import {verifyPairZips} from '../dictionary-pair/pair-verify.js';
import {DICT_ENV, resolveSourcePaths} from '../dictionary-pair/sources.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT = path.join(dirname, '..', '..', 'builds', 'dictionaries');

const HELP = `Usage:
  npm run build:dictionaries -- --dict <dict_base.db> [--out <dir>]
  npm run build:dictionaries -- --verify <builds/dictionaries/<revision>>

Builds wty-en-en.zip + flibooster-en-ru.zip into <out>/<revision>/ from
dict_base.db: the English rows and the flibooster-en-ru rows, as is, orphans
included.

Options:
  --dict <path>    dict_base.db; required unless env ${DICT_ENV} is set
                   (the flag wins). There is no default path on purpose: the
                   desktop app's live database can be older than the
                   dictionary already published.
  --out <dir>      output root (default: builds/dictionaries)
  --verify <dir>   check a built directory's zips only (no --dict needed)
  --help           show this text

The build reads dict_base.db through a backup snapshot in $TMPDIR (a full
copy, ~1.9 GB for the live database); point TMPDIR at a disk directory if
/tmp is RAM.
`;

/**
 * @param {string} directory
 */
async function verifyDirectory(directory) {
    // Сироты допустимы, только если каталог собран из dict_base.db (build.json.ruSource).
    // Нет build.json или поля — каталог прежней сборки из журнала enrich.db: строгая проверка.
    /** @type {{ruSource?: unknown, host?: {rows?: unknown}, translation?: {rows?: unknown, orphanStamps?: unknown}}|null} */
    let buildJson = null;
    const buildJsonPath = path.join(directory, 'build.json');
    if (fs.existsSync(buildJsonPath)) {
        buildJson = parseJson(fs.readFileSync(buildJsonPath, 'utf8'));
    }
    const allowOrphans = buildJson !== null && buildJson.ruSource === 'dict';
    const report = await verifyPairZips(
        fs.readFileSync(path.join(directory, 'wty-en-en.zip')),
        fs.readFileSync(path.join(directory, 'flibooster-en-ru.zip')),
        {allowOrphans},
    );
    if (buildJson !== null) {
        // Сверка zip с отчётом сборки: подменённый или чужой zip в каталоге — провал.
        /** @type {string[]} */
        const mismatches = [];
        /** @type {[string, unknown, number][]} */
        const checks = [
            ['host.rows', buildJson.host?.rows, report.host.rows],
            ['translation.rows', buildJson.translation?.rows, report.translation.rows],
            // В каталогах прежней сборки из журнала поля нет: там сирот быть не может (П3).
            ['translation.orphanStamps', buildJson.translation?.orphanStamps ?? 0, report.orphanStamps],
        ];
        for (const [field, expected, actual] of checks) {
            if (expected !== actual) { mismatches.push(`${field}: в build.json ${JSON.stringify(expected)}, в zip ${actual}`); }
        }
        if (mismatches.length > 0) {
            throw new Error(`zip расходятся с build.json:\n  ${mismatches.join('\n  ')}`);
        }
    }
    console.log(JSON.stringify(report, null, 2));
}

/** */
async function main() {
    const {values} = parseArgs({
        options: {
            dict: {type: 'string'},
            out: {type: 'string'},
            verify: {type: 'string'},
            help: {type: 'boolean'},
        },
    });
    if (values.help === true) {
        console.log(HELP);
        return;
    }
    if (typeof values.verify === 'string') {
        await verifyDirectory(values.verify);
        return;
    }
    // До любого открытия источника: нет пути — отказ сразу, без умолчания.
    const {dictPath} = resolveSourcePaths(values, process.env);
    const outRoot = path.resolve(values.out ?? DEFAULT_OUT);
    console.error(`словарь: ${dictPath}\nвыход:   ${outRoot}`);
    const started = Date.now();
    const result = await buildDictionaryPair({dictPath, outRoot});
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    const {ruSource, host, translation} = /** @type {{ruSource: unknown, host: Record<string, unknown>, translation: Record<string, unknown>}} */ (result.buildJson);
    const maxRssMb = Math.round(process.resourceUsage().maxRSS / 1024);
    console.log(JSON.stringify({status: result.status, revision: result.revision, ruSource, directory: result.directory, host, translation, seconds, maxRssMb}, null, 2));
    console.error(`русских строк ${String(translation.rows)} из ${String(translation.sourceRows)} в dict_base.db, из них сирот ${String(translation.orphanStamps)}`);
}

try {
    await main();
} catch (e) {
    console.error(`build:dictionaries: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
}
