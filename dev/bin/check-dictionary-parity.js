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

// npm run check:dictionary-parity -- --reference <export.db> [--dict <dict_base.db>] [--journal <enrich.db>]
//
// Сверяет русские статьи нашего порта с выгрузкой Go-кода anki_conf, сделанной
// ИЗ ТЕХ ЖЕ dict_base.db и enrich.db. Код выхода 1 при любом расхождении.
// Не входит в npm test: в CI нет данных anki_conf.

import {parseArgs} from 'node:util';
import {buildRussianRows} from '../dictionary-pair/enrich-transform.js';
import {compareRussianRows, readReferenceRows} from '../dictionary-pair/parity.js';
import {DICT_ENV, JOURNAL_ENV, openReadOnlyDatabase, resolveSourcePaths} from '../dictionary-pair/sources.js';

/**
 * @throws {Error}
 */
function main() {
    const {values} = parseArgs({
        options: {
            reference: {type: 'string'},
            dict: {type: 'string'},
            journal: {type: 'string'},
        },
    });
    if (typeof values.reference !== 'string') {
        throw new Error('нужен --reference <путь к выгрузке lexicon-dict-enrich -export>');
    }
    const {dictPath, journalPath} = resolveSourcePaths(values, process.env);
    const reference = openReadOnlyDatabase(values.reference, 'эталонная выгрузка', '--reference');
    const dict = openReadOnlyDatabase(dictPath, 'словарь dict_base.db', `--dict или ${DICT_ENV}`);
    const journal = openReadOnlyDatabase(journalPath, 'журнал enrich.db', `--journal или ${JOURNAL_ENV}`);

    const started = Date.now();
    const {rows, stats} = buildRussianRows(dict, journal);
    const report = compareRussianRows(readReferenceRows(reference), rows);
    const seconds = ((Date.now() - started) / 1000).toFixed(1);

    console.log(JSON.stringify({sources: {reference: values.reference, dictPath, journalPath}, transform: stats, parity: report, seconds}, null, 2));
    const mismatches = Object.values(report.classes).reduce((sum, count) => sum + count, 0);
    if (mismatches > 0) {
        console.error(`ПАРИТЕТ НАРУШЕН: ${mismatches} расхождений (${JSON.stringify(report.classes)})`);
        process.exitCode = 1;
        return;
    }
    console.error(`паритет точный: ${report.equal} русских статей совпали с эталоном`);
}

try {
    main();
} catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
}
