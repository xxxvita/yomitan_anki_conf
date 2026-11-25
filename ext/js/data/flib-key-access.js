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
 * Разбор ответа `GET /v1/me/access` — права и расход личного ключа.
 *
 * ⚠️ Адрес шлюза меняется в настройках, поэтому тело — чужие данные: проходит
 * только перечисленное в модели, поле неверного типа значит «нет данных».
 */

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
/** Шлюз отдаёт 8 знаков; потолок не даёт странице получить ключ целиком (36 знаков). */
const KEY_PREFIX_MAX_LENGTH = 16;
const RIGHT_ID_MAX_LENGTH = 64;

/**
 * @param {unknown} value
 * @returns {?Record<string, unknown>}
 */
function asRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ?
        /** @type {Record<string, unknown>} */ (value) :
        null;
}

/**
 * @param {unknown} value
 * @returns {?number} Конечное неотрицательное число (`-0` → `0`) или `null`.
 */
function parseAmount(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.abs(value) : null;
}

/**
 * ⚠️ Не голый Date.parse: он снисходителен («key 1» — это 2001 год) и
 * переносит 31 февраля на март.
 * @param {unknown} value
 * @returns {value is string}
 */
function isDateString(value) {
    if (typeof value !== 'string' || !DATE_PATTERN.test(value)) { return false; }
    const time = Date.parse(`${value}T00:00:00Z`);
    return !Number.isNaN(time) && new Date(time).toISOString().startsWith(value);
}

/**
 * @param {unknown} value
 * @returns {value is string}
 */
function isTimestampString(value) {
    return typeof value === 'string' && TIMESTAMP_PATTERN.test(value) && isDateString(value.substring(0, 10)) && !Number.isNaN(Date.parse(value));
}

/**
 * @param {unknown} value
 * @returns {?string} `null` — срока нет; `''` — срок есть, но не читается (это НЕ «бессрочно»).
 */
function parseExpiresAt(value) {
    if (typeof value === 'undefined' || value === null) { return null; }
    return isTimestampString(value) || isDateString(value) ? value : '';
}

/**
 * @param {unknown} value
 * @returns {?import('flib-gateway').KeyRight}
 */
function parseRight(value) {
    const right = asRecord(value);
    if (right === null || typeof right.capability !== 'string' || right.capability === '' || right.capability.length > RIGHT_ID_MAX_LENGTH) { return null; }
    const usable = typeof right.usable_now === 'undefined' ? right.active_now : right.usable_now;
    return {
        id: right.capability,
        usable: usable === true,
        permanent: right.permanent === true,
        validFrom: isDateString(right.valid_from) ? right.valid_from : null,
        validTo: isDateString(right.valid_to) ? right.valid_to : null,
    };
}

/**
 * ⚠️ Отсутствующий `limit` — не `null`: шлюз шлёт `null` явно, а «поля нет»
 * нельзя показать как «без лимита».
 * @param {?Record<string, unknown>} section
 * @param {string} usedName
 * @param {string} limitName
 * @returns {?import('flib-gateway').KeyUsage}
 */
function parseUsage(section, usedName, limitName) {
    if (section === null) { return null; }
    const {[limitName]: rawLimit, exempt} = section;
    const used = parseAmount(section[usedName]);
    const limit = parseAmount(rawLimit);
    if (used === null || (limit === null && rawLimit !== null)) { return null; }
    if (typeof exempt !== 'undefined' && typeof exempt !== 'boolean') { return null; }
    const unlimited = limit === null || exempt === true;
    return {used, limit: unlimited ? null : limit, unlimited};
}

/**
 * @param {?Record<string, unknown>} gpt
 * @returns {import('flib-gateway').KeyAccess['gptTokens']}
 */
function parseTokens(gpt) {
    if (gpt === null) { return null; }
    const input = parseAmount(gpt.input_tokens);
    const output = parseAmount(gpt.output_tokens);
    return input !== null && output !== null ? {input, output} : null;
}

/**
 * @param {unknown} value
 * @returns {import('flib-gateway').KeyAccess['examplesQuota']}
 */
function parseExamplesQuota(value) {
    const quota = parseUsage(asRecord(value), 'used', 'limit');
    return quota === null ? null : {used: quota.used, limit: quota.limit};
}

/**
 * @param {unknown} body Разобранный JSON ответа.
 * @returns {?import('flib-gateway').KeyAccess} `null` — тело не по этому контракту.
 */
export function parseKeyAccess(body) {
    const root = asRecord(body);
    if (root === null || !Array.isArray(root.capabilities)) { return null; }
    const {key_prefix: keyPrefix, el_limits: rawLimits} = root;
    const limits = asRecord(rawLimits);
    const gpt = asRecord(limits?.gpt);
    /** @type {import('flib-gateway').KeyRight[]} */
    const rights = [];
    for (const value of /** @type {unknown[]} */ (root.capabilities)) {
        const right = parseRight(value);
        if (right !== null) { rights.push(right); }
    }
    return {
        keyPrefix: typeof keyPrefix === 'string' && keyPrefix !== '' && keyPrefix.length <= KEY_PREFIX_MAX_LENGTH ? keyPrefix : null,
        expiresAt: parseExpiresAt(root.key_expires_at),
        // Нет поля — старый шлюз: ограничиваем, как тестовый ключ.
        demo: root.demo !== false,
        rights,
        gpt: parseUsage(gpt, 'used_microusd', 'limit_microusd'),
        tts: parseUsage(asRecord(limits?.tts), 'used', 'limit'),
        stt: parseUsage(asRecord(limits?.stt), 'used', 'limit'),
        resetsAt: isTimestampString(limits?.resets_at) ? limits.resets_at : null,
        gptTokens: parseTokens(gpt),
        examplesQuota: parseExamplesQuota(root.examples_quota),
    };
}

/**
 * Доля расхода в целых процентах: потраченное — вниз, остаток — до 100.
 * @param {import('flib-gateway').KeyUsage} usage
 * @returns {?import('flib-gateway').KeyUsageShare} `null` — лимита нет, доли тоже.
 */
export function usageShare({used, limit, unlimited}) {
    if (unlimited || limit === null) { return null; }
    if (used >= limit) { return {spentPercent: 100, leftPercent: 0, underOne: false, exhausted: true}; }
    // Сначала умножение: 29 / 100 * 100 — это 28.999…, а 29 * 100 / 100 — ровно 29.
    const scaled = used * 100;
    const percent = Number.isFinite(scaled) ? scaled / limit : used / (limit / 100);
    const spentPercent = Math.max(0, Math.min(99, Math.floor(percent)));
    return {spentPercent, leftPercent: 100 - spentPercent, underOne: used > 0 && percent < 1, exhausted: false};
}
