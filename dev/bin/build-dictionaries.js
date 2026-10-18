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

// npm run build:dictionaries [-- --ru-source dict|journal] [--dict <dict_base.db>] [--journal <enrich.db>] [--out <dir>]
// npm run build:dictionaries -- --verify <builds/dictionaries/<revision>>
//
// Собирает пару wty-en-en.zip + flibooster-en-ru.zip из ДАННЫХ anki_conf, не
// вызывая код anki_conf. Русская сторона по умолчанию — готовые строки
// flibooster-en-ru из dict_base.db (--ru-source dict), журнал enrich.db тогда
// не открывается; --ru-source journal — прежняя сборка из журнала. Источники
// открываются только на чтение. Пути: флаг > переменная окружения
// (FLIB_DICT_BASE_DB, FLIB_ENRICH_JOURNAL) > машинно-зависимое умолчание.
// Не входит в npm test: в CI нет данных anki_conf.

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {parseJson} from '../json.js';
import {buildDictionaryPair} from '../dictionary-pair/pair-builder.js';
import {verifyPairZips} from '../dictionary-pair/pair-verify.js';
import {DICT_ENV, JOURNAL_ENV, parseRuSource, resolveSourcePaths} from '../dictionary-pair/sources.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT = path.join(dirname, '..', '..', 'builds', 'dictionaries');

const HELP = `Usage:
  npm run build:dictionaries [-- --ru-source dict|journal] [--dict <dict_base.db>] [--journal <enrich.db>] [--out <dir>]
  npm run build:dictionaries -- --verify <builds/dictionaries/<revision>>

Builds wty-en-en.zip + flibooster-en-ru.zip into <out>/<revision>/.

Options:
  --ru-source <dict|journal>
                   where the Russian side comes from (default: dict)
                   dict    — the flibooster-en-ru rows of dict_base.db, as is,
                             orphans included; the journal is not opened
                   journal — the enrich.db translation journal through the
                             port of anki_conf's export transform
  --dict <path>    dict_base.db (env ${DICT_ENV})
  --journal <path> enrich.db journal, journal mode only (env ${JOURNAL_ENV})
  --out <dir>      output root (default: builds/dictionaries)
  --verify <dir>   check a built directory's zips only
  --help           show this text

dict mode reads dict_base.db through a backup snapshot in $TMPDIR (a full
copy, ~1.9 GB for the live database); point TMPDIR at a disk directory if
/tmp is RAM.
`;

/**
 * @param {string} directory
 */
async function verifyDirectory(directory) {
    // Сироты допустимы, только если каталог собран из dict_base.db (build.json.ruSource).
    // Нет build.json или поля — старая сборка из журнала: строгая проверка.
    let allowOrphans = false;
    const buildJsonPath = path.join(directory, 'build.json');
    if (fs.existsSync(buildJsonPath)) {
        /** @type {unknown} */
        const buildJson = parseJson(fs.readFileSync(buildJsonPath, 'utf8'));
        allowOrphans = typeof buildJson === 'object' && buildJson !== null && 'ruSource' in buildJson && buildJson.ruSource === 'dict';
    }
    const report = await verifyPairZips(
        fs.readFileSync(path.join(directory, 'wty-en-en.zip')),
        fs.readFileSync(path.join(directory, 'flibooster-en-ru.zip')),
        {allowOrphans},
    );
    console.log(JSON.stringify(report, null, 2));
}

/** */
async function main() {
    const {values} = parseArgs({
        options: {
            'ru-source': {type: 'string'},
            'dict': {type: 'string'},
            'journal': {type: 'string'},
            'out': {type: 'string'},
            'verify': {type: 'string'},
            'help': {type: 'boolean'},
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
    // До любого открытия источников: опечатка в режиме — отказ сразу.
    const ruSource = parseRuSource(values['ru-source']);
    const {dictPath, journalPath} = resolveSourcePaths(values, process.env);
    const outRoot = path.resolve(values.out ?? DEFAULT_OUT);
    console.error(`русский:  ${ruSource === 'dict' ? 'dict_base.db (flibooster-en-ru)' : 'журнал'}\nсловарь: ${dictPath}${ruSource === 'journal' ? `\nжурнал:  ${journalPath}` : ''}\nвыход:   ${outRoot}`);
    const started = Date.now();
    const result = await buildDictionaryPair({dictPath, journalPath: ruSource === 'journal' ? journalPath : void 0, outRoot, ruSource});
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    const {host, translation, transform, staleAuthoredTranslations, untranslatedAuthored} = /** @type {{host: Record<string, unknown>, translation: Record<string, unknown>, transform?: Record<string, unknown>, staleAuthoredTranslations?: {skipped: number, file: string}, untranslatedAuthored?: {expressions: number, file: string}}} */ (result.buildJson);
    const maxRssMb = Math.round(process.resourceUsage().maxRSS / 1024);
    console.log(JSON.stringify({status: result.status, revision: result.revision, ruSource, directory: result.directory, host, translation, transform, staleAuthoredTranslations, untranslatedAuthored, seconds, maxRssMb}, null, 2));
    if (typeof staleAuthoredTranslations !== 'undefined' && typeof untranslatedAuthored !== 'undefined') {
        // Не молчать: владелец должен видеть, сколько сочинённых статей осталось без русского.
        console.error(
            `сочинённые статьи без русского: устаревших переводов пропущено ${staleAuthoredTranslations.skipped} (${path.join(result.directory, staleAuthoredTranslations.file)}), ` +
            `без перевода ${untranslatedAuthored.expressions} (${path.join(result.directory, untranslatedAuthored.file)})`,
        );
    } else {
        console.error(`русских строк ${String(translation.rows)} из ${String(translation.sourceRows)} в dict_base.db, из них сирот ${String(translation.orphanStamps)}`);
    }
}

try {
    await main();
} catch (e) {
    console.error(`build:dictionaries: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
}
