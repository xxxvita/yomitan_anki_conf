/*
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

import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
import {describe, expect, test, vi} from 'vitest';
import {parseJson} from '../ext/js/core/json.js';
import {FLIB_YOUTUBE_EMBED_REFERER} from '../ext/js/data/flib-host.js';
import {
    YOUTUBE_EMBED_REFERER_RULE_ID,
    createYouTubeEmbedRefererRule,
    registerYouTubeEmbedRefererRule,
} from '../ext/js/background/youtube-embed-referer.js';

const extRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'ext');

/**
 * Мок chrome.declarativeNetRequest с настоящей семантикой сессионных правил:
 * removeRuleIds применяется до addRules, повтор id в addRules — ошибка.
 * @returns {{dnr: {updateSessionRules: import('vitest').Mock}, rules: Map<number, unknown>}}
 */
function createDnrMock() {
    /** @type {Map<number, unknown>} */
    const rules = new Map();
    const updateSessionRules = vi.fn(async (/** @type {{removeRuleIds?: number[], addRules?: {id: number}[]}} */ {removeRuleIds = [], addRules = []}) => {
        for (const id of removeRuleIds) { rules.delete(id); }
        for (const rule of addRules) {
            if (rules.has(rule.id)) { throw new Error(`Rule with id ${rule.id} does not have a unique ID.`); }
            rules.set(rule.id, rule);
        }
    });
    return {dnr: {updateSessionRules}, rules};
}

describe('createYouTubeEmbedRefererRule', () => {
    test('rule shape: only sub_frame embeds of youtube-nocookie, only from our origin, sets Referer', () => {
        expect(createYouTubeEmbedRefererRule('abcdefghijklmnopabcdefghijklmnop')).toStrictEqual({
            id: YOUTUBE_EMBED_REFERER_RULE_ID,
            priority: 1,
            condition: {
                urlFilter: '||www.youtube-nocookie.com/embed/',
                resourceTypes: ['sub_frame'],
                initiatorDomains: ['abcdefghijklmnopabcdefghijklmnop'],
            },
            action: {
                type: 'modifyHeaders',
                requestHeaders: [{header: 'Referer', operation: 'set', value: FLIB_YOUTUBE_EMBED_REFERER}],
            },
        });
    });

    test('Referer is an https origin with a trailing slash (what YouTube accepts)', () => {
        expect(FLIB_YOUTUBE_EMBED_REFERER).toMatch(/^https:\/\/[a-z0-9.-]+\/$/);
    });
});

describe('registerYouTubeEmbedRefererRule', () => {
    test('registers one rule scoped to the host of our extension base URL', async () => {
        const {dnr, rules} = createDnrMock();
        const result = await registerYouTubeEmbedRefererRule({dnr, extensionBaseUrl: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/'});
        expect(result).toBe('registered');
        expect([...rules.keys()]).toStrictEqual([YOUTUBE_EMBED_REFERER_RULE_ID]);
        expect(dnr.updateSessionRules).toHaveBeenCalledWith({
            removeRuleIds: [YOUTUBE_EMBED_REFERER_RULE_ID],
            addRules: [createYouTubeEmbedRefererRule('abcdefghijklmnopabcdefghijklmnop')],
        });
    });

    test('Firefox: initiator is the moz-extension UUID host, not the add-on id', async () => {
        const {dnr, rules} = createDnrMock();
        await registerYouTubeEmbedRefererRule({dnr, extensionBaseUrl: 'moz-extension://1b2c3d4e-0000-4000-8000-123456789abc/'});
        const rule = /** @type {{condition: {initiatorDomains: string[]}}} */ (rules.get(YOUTUBE_EMBED_REFERER_RULE_ID));
        expect(rule.condition.initiatorDomains).toStrictEqual(['1b2c3d4e-0000-4000-8000-123456789abc']);
    });

    test('idempotent across service-worker restarts: session rules survive, the second run replaces, not duplicates', async () => {
        const {dnr, rules} = createDnrMock();
        const details = {dnr, extensionBaseUrl: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/'};
        expect(await registerYouTubeEmbedRefererRule(details)).toBe('registered');
        expect(await registerYouTubeEmbedRefererRule(details)).toBe('registered');
        expect(await registerYouTubeEmbedRefererRule(details)).toBe('registered');
        expect(rules.size).toBe(1);
        expect(dnr.updateSessionRules).toHaveBeenCalledTimes(3);
    });

    test('no DNR session rules (old Firefox, tests) → unsupported, no throw', async () => {
        expect(await registerYouTubeEmbedRefererRule({dnr: null, extensionBaseUrl: 'chrome-extension://abc/'})).toBe('unsupported');
        expect(await registerYouTubeEmbedRefererRule({dnr: /** @type {never} */ ({}), extensionBaseUrl: 'chrome-extension://abc/'})).toBe('unsupported');
    });

    test('no usable extension origin → unsupported: an empty initiator would match every page', async () => {
        const {dnr} = createDnrMock();
        for (const extensionBaseUrl of ['', 'not a url', 'https://example.com/', 'chrome-extension:///']) {
            expect(await registerYouTubeEmbedRefererRule({dnr, extensionBaseUrl})).toBe('unsupported');
        }
        expect(dnr.updateSessionRules).not.toHaveBeenCalled();
    });

    test('DNR rejects (e.g. modifyHeaders unsupported) → failed, logged, no throw', async () => {
        const dnr = {updateSessionRules: vi.fn(async () => { throw new Error('Invalid action type'); })};
        const onError = vi.fn();
        expect(await registerYouTubeEmbedRefererRule({dnr, extensionBaseUrl: 'chrome-extension://abc/', onError})).toBe('failed');
        expect(onError).toHaveBeenCalledTimes(1);
    });
});

describe('backend wiring', () => {
    test('registered right AFTER RequestBuilder.prepare(), which wipes all session rules', () => {
        const code = fs.readFileSync(path.join(extRoot, 'js', 'background', 'backend.js'), {encoding: 'utf8'});
        // Сразу следующей строкой в том же методе: так вызов не уедет ни до
        // очистки, ни в другую функцию незамеченным.
        expect(code).toMatch(/\n( +)await this\._requestBuilder\.prepare\(\);\n\1await registerYouTubeEmbedRefererRule\(/);
        expect(code.split('registerYouTubeEmbedRefererRule(').length - 1).toBe(1);
    });

    test('every shipped manifest variant keeps declarativeNetRequest and <all_urls>', () => {
        // ext/manifest.json — артефакт сборки (в CI его нет), поэтому читаем
        // исходник вариантов и проходим цепочку inherit + modifications.
        /** @type {{manifest: {permissions: string[], host_permissions: string[]}, variants: {name: string, inherit?: string, modifications?: {action: string, path: string[], item?: string, items?: string[]}[]}[]}} */
        const data = parseJson(fs.readFileSync(path.join(extRoot, '..', 'dev', 'data', 'manifest-variants.json'), {encoding: 'utf8'}));
        const byName = new Map(data.variants.map((v) => [v.name, v]));
        /**
         * @param {string} name
         * @param {string} key
         * @returns {string[]}
         * @throws {Error} Неизвестный вариант.
         */
        const resolve = (name, key) => {
            const variant = byName.get(name);
            if (typeof variant === 'undefined') { throw new Error(`no variant ${name}`); }
            /** @type {string[]} */
            let list = typeof variant.inherit === 'string' ? resolve(variant.inherit, key) : [...(/** @type {Record<string, string[]>} */ (/** @type {unknown} */ (data.manifest)))[key]];
            for (const m of variant.modifications ?? []) {
                if (m.path.length !== 1 || m.path[0] !== key) { continue; }
                if (m.action === 'remove') { list = list.filter((x) => x !== m.item); }
                if (m.action === 'add') { list = [...list, ...(m.items ?? [])]; }
            }
            return list;
        };
        for (const name of ['chrome', 'chrome-dev', 'firefox', 'firefox-dev', 'firefox-android', 'edge']) {
            expect(resolve(name, 'permissions')).toContain('declarativeNetRequest');
            expect(resolve(name, 'host_permissions')).toContain('<all_urls>');
        }
    });
});
