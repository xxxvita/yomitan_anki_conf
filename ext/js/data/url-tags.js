/*
 * Copyright (C) 2024-2025  Yomitan Authors
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

const TAG_INVALID_CHARS = /[^\p{L}\p{N}_-]+/gu;

/**
 * Prefix prepended to every URL-derived tag so site/page tags are self-describing
 * and searchable in Anki (e.g. `webpage_app_chatcode_io`). Without it a bare host
 * tag is just an opaque string with no indication it came from a web page.
 */
const AUTO_TAG_PREFIX = 'webpage_';

/**
 * Replace any character not in [Unicode letter, digit, underscore, hyphen] with `_`,
 * collapse runs of `_`, trim leading/trailing `_`, lowercase.
 * @param {string} value
 * @returns {string}
 */
export function sanitizeTag(value) {
    if (typeof value !== 'string' || value.length === 0) { return ''; }
    let result = value.replace(TAG_INVALID_CHARS, '_');
    result = result.replace(/_+/g, '_');
    result = result.replace(/^_+|_+$/g, '');
    return result.toLowerCase();
}

/**
 * Parse `url` and produce a tag for the host. Hostname is lowercased; a leading
 * `www.` is stripped; the port (if any) is appended with `_`. Returns `null`
 * when the URL is not parseable or the host is empty.
 * @param {string} url
 * @returns {?string}
 */
export function computeDomainTag(url) {
    const parsed = tryParseUrl(url);
    if (parsed === null) { return null; }
    let host = parsed.hostname;
    if (host.length === 0) { return null; }
    if (host.startsWith('www.')) { host = host.slice(4); }
    const port = parsed.port;
    const raw = port.length > 0 ? `${host}_${port}` : host;
    const tag = sanitizeTag(raw);
    return tag.length > 0 ? tag : null;
}

/**
 * Parse `url` and produce a tag for the path (the "endpoint"). The leading `/`
 * is dropped; internal `/` become `_`; query/hash are ignored. Returns `null`
 * for the empty path or `/`.
 * @param {string} url
 * @returns {?string}
 */
export function computeEndpointTag(url) {
    const parsed = tryParseUrl(url);
    if (parsed === null) { return null; }
    const pathname = parsed.pathname;
    if (pathname.length === 0 || pathname === '/') { return null; }
    const trimmed = pathname.replace(/^\/+|\/+$/g, '');
    if (trimmed.length === 0) { return null; }
    const tag = sanitizeTag(trimmed.replace(/\//g, '_'));
    return tag.length > 0 ? tag : null;
}

/**
 * @param {string} url
 * @returns {string[]} Non-null tags suitable for an Anki note, each `webpage_`-prefixed (deduped, order: domain, endpoint).
 */
export function computeAutoTags(url) {
    /** @type {string[]} */
    const result = [];
    const domain = computeDomainTag(url);
    if (domain !== null) { result.push(AUTO_TAG_PREFIX + domain); }
    const endpoint = computeEndpointTag(url);
    if (endpoint !== null && endpoint !== domain) { result.push(AUTO_TAG_PREFIX + endpoint); }
    return result;
}

/**
 * @param {string} url
 * @returns {?URL}
 */
function tryParseUrl(url) {
    if (typeof url !== 'string' || url.length === 0) { return null; }
    try {
        return new URL(url);
    } catch (_error) {
        return null;
    }
}
