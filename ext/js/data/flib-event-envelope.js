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

/** Версия формата записи. Растёт при несовместимом изменении полей. */
export const FLIB_EVENT_SCHEMA_VERSION = 1;

/**
 * ⚠️ Нормализация обязательна: заголовки статей приезжают в словарном
 * регистре, а резолв на стороне шлюза — точным совпадением, без лемматизации.
 * Без неё разъедутся и ключ дедупа, и будущий резолв.
 *
 * ⚠️ Одного `trim()` НЕ хватает: заголовок может приехать с двойным пробелом
 * («figure  out») или с неразрывным/экзотическим пробелом внутри — из вёрстки
 * страницы или из правки поля выражения руками. Такая лемма не совпадёт ни с
 * точным резолвом на шлюзе, ни с ключом дедупа своего же чистого двойника, и
 * та же пара «слово+страница» пролезет вторым событием. Поэтому ЛЮБОЙ пробег
 * пробельных (`\s` покрывает U+00A0, U+2000–U+200A, U+202F, U+205F, U+3000,
 * U+FEFF) схлопывается в один обычный пробел ДО обрезки и опускания регистра.
 * @param {unknown} lemmas
 * @returns {string[]}
 */
export function normalizeLemmas(lemmas) {
    if (!Array.isArray(lemmas)) {
        return [];
    }
    /** @type {string[]} */
    const result = [];
    const seen = new Set();
    for (const raw of lemmas) {
        if (typeof raw !== 'string') {
            continue;
        }
        const lemma = raw.replace(/\s+/gu, ' ').trim().toLowerCase();
        if (lemma.length === 0 || seen.has(lemma)) {
            continue;
        }
        seen.add(lemma);
        result.push(lemma);
    }
    return result;
}

/**
 * Снимает фрагмент (`#…`) с адреса.
 *
 * ⚠️ Фрагмент выкидывается ровно по той же причине, по которой нормализуется
 * лемма: он входит в ключ дедупа (§6.1), а на читалке `flib.club` номер
 * страницы живёт именно во фрагменте — `…/read/1#p=7` и `…/read/1#p=8` дали бы
 * два разных ключа для одного слова на одной странице, и защита от потока
 * повторов, ради которой ключ и заводится, перестала бы работать.
 *
 * ⚠️ Режется текстом, а не через `new URL`: конверт не должен становиться новым
 * путём отказа — на негодной строке функция обязана вернуть её же, а не бросить
 * (негодный адрес отсеет `buildEvent` ниже). `#` без процентного кодирования
 * всегда начинает фрагмент, поэтому позиции первого `#` достаточно.
 * @param {string} url
 * @returns {string}
 */
export function stripUrlFragment(url) {
    if (typeof url !== 'string') {
        return '';
    }
    const index = url.indexOf('#');
    return index === -1 ? url : url.slice(0, index);
}

/**
 * ⚠️ Ключ включает URL: то же слово на другой странице — ВТОРОЕ свидетельство,
 * и глушить его нельзя.
 * @param {string} url
 * @param {import('flib-events').FlibEventType} type
 * @param {string} lemma
 * @returns {string}
 */
export function dedupKey(url, type, lemma) {
    return `${url}\0${type}\0${lemma}`;
}

/**
 * Известные виды событий.
 *
 * ⚠️ ЗАПИСАНЫ КЛЮЧАМИ ОБЪЕКТА, А НЕ ЭЛЕМЕНТАМИ МАССИВА, и это единственная
 * причина такой формы. `Record<FlibEventType, true>` заставляет tsc проверить
 * ПОЛНОТУ в обе стороны: и лишний вид — ошибка типов, и **пропущенный** —
 * тоже. Массив `ReadonlyArray<FlibEventType>` (как было) ловил только первое:
 * выпади отсюда `word_added_to_dict`, и `buildEvent` начал бы молча отбрасывать
 * законное событие — без единой ошибки типов и без единого красного теста,
 * потому что проверка ниже читает ровно этот список.
 * @type {Record<import('flib-events').FlibEventType, true>}
 */
const FLIB_EVENT_TYPES = {
    translation_opened: true,
    word_added_to_dict: true,
};

/**
 * ⚠️ Проверка в РАНТАЙМЕ, хотя поле типизировано: типизация — это обещание
 * вызывающего, а конверт обязан быть последним рубежом. Сегодня до него
 * добирается только код расширения, так что это защита в глубину; но
 * незнакомый вид, записанный в очередь, шлюз позже прочитать не сможет, а
 * удалить из очереди уже отправленное — некому.
 * @param {unknown} value
 * @returns {value is import('flib-events').FlibEventType}
 */
export function isFlibEventType(value) {
    return typeof value === 'string' && Object.hasOwn(FLIB_EVENT_TYPES, value);
}

/**
 * @param {{type: import('flib-events').FlibEventType, lemmas: unknown, url: string, ts: number, eventId: string}} details
 * @returns {?import('flib-events').FlibEvent}
 */
export function buildEvent({type, lemmas, url, ts, eventId}) {
    if (!isFlibEventType(type)) {
        return null;
    }
    const normalized = normalizeLemmas(lemmas);
    if (normalized.length === 0) {
        return null;
    }
    // ⚠️ Нормализованный адрес попадает И в конверт, И в ключ дедупа (ключ
    // строится из `event.url`): расходиться им нельзя.
    const normalizedUrl = stripUrlFragment(url);
    let host;
    try {
        host = new URL(normalizedUrl).hostname.toLowerCase().replace(/\.$/, '');
    } catch (e) {
        return null;
    }
    if (host.length === 0) {
        return null;
    }
    return {
        event_id: eventId,
        type,
        lemmas: normalized,
        host,
        url: normalizedUrl,
        ts,
        schema_version: FLIB_EVENT_SCHEMA_VERSION,
    };
}
