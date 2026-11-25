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

import css from 'css';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {parseJson} from '../dev/json.js';
import {messagesEn} from '../ext/js/i18n/messages-en.js';
import {messagesRu} from '../ext/js/i18n/messages-ru.js';
import {setUiLanguage} from '../ext/js/i18n/ui-language.js';
import {UserTagsController} from '../ext/js/pages/settings/user-tags-controller.js';
import {setupDomTest} from './fixtures/dom-test.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FLIB_ANCHORS = ['about-flib-club', 'flib-server', 'flib-dictionaries', 'flib-cards', 'flib-view'];
/** Узлы, чьи атрибуты страница обязана сохранить целиком. */
const PINNED_SELECTOR = ['input', 'textarea', 'select', 'button', 'label', 'a', '[id]', '[role]', '[data-i18n]', '[data-i18n-placeholder]', '[data-show-for-browser]', '[data-hide-for-browser]', '[data-show-for-os]'].map((selector) => `.content-center ${selector}`).join(',');
/** Единственные намеренные перемены в этих узлах: ключи заголовков и перевод раздела тегов. */
const MARKUP_CHANGES = new Map([
    ['a data-i18n=about.heading href=#about-flib-club', 'a data-i18n=settings.flibAbout href=#about-flib-club'],
    ['a data-i18n=settings.server href=#flib-server', 'a data-i18n=settings.flibKey href=#flib-server'],
    ['a href=#tags', 'a data-i18n=settings.tags href=#tags'],
    ['textarea class=user-tags-textarea id=user-tags-textarea placeholder=grammar vocab news rows=8 spellcheck=false', 'textarea class=user-tags-textarea data-i18n-placeholder=settings.tagsPlaceholder id=user-tags-textarea placeholder=grammar vocab news rows=8 spellcheck=false'],
    ['button class=default id=user-tags-save type=button', 'button class=default data-i18n=settings.tagsSave id=user-tags-save type=button'],
]);
const SCOPE = ':root[data-page-type=settings]';

/**
 * Страница до разделения на группы: снято с `git show main:ext/settings.html`.
 * Список закреплён: он растёт, только если у страницы появляются новые настройки.
 * @typedef {{ids: string[], controls: string[], markup: string[], advancedOnly: string[], debugOnly: string[], hidden: string[], sidebar: string[], sections: {[anchor: string]: string[]}}} SettingsPage
 */

/**
 * @param {string} name
 * @returns {string}
 */
function readText(name) {
    return fs.readFileSync(path.join(ROOT, name), 'utf8');
}

/**
 * @param {ParentNode} root
 * @param {string} selector
 * @returns {HTMLElement[]}
 */
function all(root, selector) {
    const nodes = /** @type {NodeListOf<HTMLElement>} */ (root.querySelectorAll(selector));
    return [...nodes];
}

/**
 * @param {?string|undefined} text
 * @returns {string}
 */
function squash(text) {
    return (text ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Подпись элемента без переносов и без data-flib: с ней сравниваются списки.
 * @param {HTMLElement} node
 * @returns {string}
 */
function describeNode(node) {
    const controls = all(node, '[data-setting],[data-permissions-setting],[id]').map(({dataset, id}) => dataset.setting ?? dataset.permissionsSetting ?? id);
    const label = squash(node.querySelector('.settings-item-label')?.textContent);
    return [`${node.localName}.${[...node.classList].join('.')}`, node.id, node.getAttribute('href') ?? '', node.dataset.modalAction ?? '', label, controls.join(',')].join('|');
}

/**
 * @param {Element} node
 * @returns {string}
 */
function describeControl(node) {
    return [node.localName, ...[...node.attributes].map(({name, value}) => `${name}=${squash(value)}`).sort()].join(' ');
}

/**
 * Настройки раздела: подписи верхних пунктов от его заголовка до следующего.
 * @param {Document} document
 * @returns {{[anchor: string]: string[]}}
 */
function describeSections(document) {
    /** @type {{[anchor: string]: string[]}} */
    const sections = {};
    let anchor = '';
    for (const node of document.querySelectorAll('.content-center h2, .content-center .settings-group>.settings-item')) {
        if (node.localName === 'h2') {
            anchor = node.id;
            sections[anchor] = [];
        } else if (anchor !== '') {
            sections[anchor].push(squash(node.querySelector('.settings-item-label, textarea, .user-tags-actions, p')?.textContent));
        }
    }
    return sections;
}

/**
 * @param {Document} document
 * @returns {SettingsPage}
 */
function describePage(document) {
    const list = (/** @type {string} */ selector) => all(document, selector);
    return {
        ids: list('[id]').map(({id}) => id).sort(),
        controls: list('[data-setting],[data-permissions-setting],[data-modal-action]').map(describeControl).sort(),
        markup: list(PINNED_SELECTOR).map(describeControl).sort(),
        advancedOnly: list('.advanced-only').map(describeNode).sort(),
        debugOnly: list('.debug-only').map(describeNode).sort(),
        hidden: list('[hidden]:not(body)').map(describeNode).sort(),
        sidebar: list('.sidebar-body>a').map((node) => node.getAttribute('href') ?? ''),
        sections: describeSections(document),
    };
}

const html = readText('ext/settings.html');
const {document: page} = new JSDOM(html).window;
/** @type {SettingsPage} */
const base = parseJson(readText('test/data/settings-structure-base.json'));
const current = describePage(page);

/**
 * @param {string} selector
 * @param {ParentNode} [root]
 * @returns {HTMLElement}
 * @throws {Error}
 */
function get(selector, root = page) {
    const [node] = all(root, selector);
    if (typeof node === 'undefined') { throw new Error(`Not found: ${selector}`); }
    return node;
}

/**
 * @param {Element} a
 * @param {Element} b
 * @returns {boolean}
 */
function isBefore(a, b) {
    return (a.compareDocumentPosition(b) & a.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

/**
 * Находится ли элемент между заголовками двух разделов.
 * @param {Element} node
 * @param {string} start
 * @param {string} end
 * @returns {boolean}
 */
function isBetween(node, start, end) {
    return isBefore(get(`h2#${start}`), node) && isBefore(node, get(`h2#${end}`));
}

describe('ничего не потеряно при переносе', () => {
    test('каждый id прежней страницы на месте, и ни один не повторяется', () => {
        expect(new Set(current.ids).size).toBe(current.ids.length);
        expect(base.ids.filter((id) => !current.ids.includes(id))).toStrictEqual([]);
        expect(base.ids.length).toBeGreaterThan(50);
    });

    test('каждая настройка на месте ровно один раз, с теми же атрибутами', () => {
        expect(current.controls).toStrictEqual(base.controls);
        expect(base.controls.length).toBeGreaterThan(100);
    });

    test('атрибуты полей, подписей, ссылок и узлов с id те же', () => {
        const rest = [...current.markup];
        const lost = [];
        // Таких ссылок «Info…» на странице пять, и переведена только одна: у тегов.
        const toggle = 'a class=more-toggle more-only heading-link-light data-parent-distance=3 tabindex=0';
        const expected = base.markup.map((item) => MARKUP_CHANGES.get(item) ?? item);
        expected[expected.indexOf(toggle)] = 'a class=more-toggle more-only heading-link-light data-i18n=settings.tagsInfo data-parent-distance=3 tabindex=0';
        for (const item of expected) {
            const index = rest.indexOf(item);
            if (index === -1) {
                lost.push(item);
            } else {
                rest.splice(index, 1);
            }
        }
        expect(lost).toStrictEqual([]);
        expect(base.markup.length).toBeGreaterThan(300);
        for (const item of MARKUP_CHANGES.keys()) { expect(base.markup, item).toContain(item); }
    });

    test('пункты advanced-only и debug-only те же', () => {
        expect(current.advancedOnly).toStrictEqual(base.advancedOnly);
        expect(current.debugOnly).toStrictEqual(base.debugOnly);
    });

    test('всё, что было скрыто, скрыто и теперь', () => {
        expect(base.hidden.filter((item) => !current.hidden.includes(item))).toStrictEqual([]);
        for (const [setting, comment] of [['general.enableYomitanApi', 'Yomitan API toggle hidden'], ['parsing.enableMecabParser', 'MeCab parser toggle hidden']]) {
            const item = get(`[data-permissions-setting="${setting}"]`).closest('.settings-item.advanced-only');
            expect(item?.hasAttribute('hidden'), setting).toBe(true);
            let previous = /** @type {?Node} */ (item?.previousSibling ?? null);
            while (previous?.nodeType === 3) { previous = previous.previousSibling; }
            expect(previous?.nodeType, setting).toBe(8);
            expect(previous?.nodeValue).toContain(comment);
        }
    });
});

describe('боковое меню', () => {
    const children = [...get('.sidebar-body').children];

    test('группа Flib-club с пятью якорями, затем Yomitan с прежними пунктами в прежнем порядке', () => {
        expect(children.map((node) => (node.localName === 'a' ? node.getAttribute('href') : `${node.localName}.${node.className} ${node.textContent}`))).toStrictEqual([
            'div.outline-group Flib-club',
            ...FLIB_ANCHORS.map((id) => `#${id}`),
            'div.outline-group Yomitan',
            ...base.sidebar.filter((href) => href !== '#flib-server'),
        ]);
    });

    test('порядок пунктов совпадает с порядком разделов', () => {
        const anchors = children.filter(({localName}) => localName === 'a').map((node) => (node.getAttribute('href') ?? '').slice(1));
        expect([...page.querySelectorAll('.content-center h2')].map(({id}) => id).filter((id) => anchors.includes(id))).toStrictEqual(anchors);
    });

    test('подпись пункта и заголовок раздела из одного ключа', () => {
        for (const id of FLIB_ANCHORS) {
            const key = get(`.sidebar-body a[href="#${id}"] [data-i18n]`).dataset.i18n;
            expect(get(`h2#${id}>a[href="#${id}"]`).dataset.i18n).toBe(key);
            expect(messagesRu[key ?? '']).toEqual(expect.any(String));
        }
    });
});

describe('разделы Flib-club', () => {
    test('каждый пункт в своём разделе', () => {
        for (const [selector, start, end] of [
            ['#flib-personal-key-input', 'flib-server', 'flib-dictionaries'],
            ['#flib-gateway-url-input', 'flib-server', 'flib-dictionaries'],
            ['#flib-dictionaries-provisioning', 'flib-dictionaries', 'flib-cards'],
            ['[data-setting="flibService.enrichCards"]', 'flib-cards', 'tags'],
            ['#flib-enrich-cards-options [data-setting="flibService.createReverseCard"]', 'flib-cards', 'tags'],
            ['#flib-enrich-cards-options [data-setting="flibService.createPhrasesCard"]', 'flib-cards', 'tags'],
            ['#user-tags-textarea', 'tags', 'flib-view'],
            ['[data-setting="general.uiLanguage"]', 'flib-view', 'profile'],
            ['[data-setting="flibTranslation.blur"]', 'flib-view', 'profile'],
        ]) {
            expect(isBetween(get(selector), start, end), selector).toBe(true);
        }
        expect(isBetween(get('h2#tags'), 'flib-cards', 'flib-view')).toBe(true);
    });

    test('разделы Yomitan сохранили остальное в прежнем порядке', () => {
        const moved = new Set(['Язык интерфейса · Interface language', 'Flib dictionaries (EN–EN + EN–RU)', 'Blurred translation']);
        for (const [anchor, labels] of Object.entries(base.sections)) {
            if (FLIB_ANCHORS.includes(anchor) || anchor === 'tags') { continue; }
            expect(current.sections[anchor], anchor).toStrictEqual(labels.filter((label) => !moved.has(label)));
        }
        expect(Object.keys(current.sections).filter((id) => !FLIB_ANCHORS.includes(id) && id !== 'tags')).toStrictEqual(Object.keys(base.sections).filter((id) => !FLIB_ANCHORS.includes(id) && id !== 'tags'));
    });

    test('первый пункт группы без черты сверху: пустых и вложенных групп нет', () => {
        for (const group of page.querySelectorAll('.settings-group[data-flib]')) {
            expect(group.firstElementChild?.matches('.settings-item')).toBe(true);
            expect(group.querySelector('.settings-group')).toBeNull();
        }
        expect(page.querySelector('#flib-dictionaries-provisioning')?.parentElement?.children).toHaveLength(1);
    });

    test('«Подробнее» тегов раскрывает своё пояснение', () => {
        const toggle = get('.more-toggle', /** @type {Element} */ (get('h2#tags').closest('.heading-container')));
        let container = /** @type {Element} */ (toggle);
        for (let i = Number(toggle.dataset.parentDistance); i > 0; --i) { container = /** @type {Element} */ (container.parentElement); }
        expect(container.querySelectorAll('h2')).toHaveLength(1);
        expect(container.querySelector('h2')?.id).toBe('tags');
        expect(container.querySelectorAll('.more')).toHaveLength(1);
        expect(container.querySelector('.settings-group')).toBeNull();
    });

    test('видны без Advanced', () => {
        for (const id of FLIB_ANCHORS) { expect(get(`h2#${id}`).closest('.advanced-only,.debug-only,[hidden]:not(body)'), id).toBeNull(); }
        for (const group of page.querySelectorAll('.settings-group[data-flib]')) {
            expect(group.querySelector('.advanced-only,.debug-only')).toBeNull();
            expect(group.closest('.advanced-only,.debug-only,[hidden]:not(body)')).toBeNull();
        }
    });

    test('уведомление о долгой загрузке стоит выше разделов', () => {
        const notification = get('.page-loading-stalled-notification');
        expect(isBefore(get('.content-center>h1'), notification)).toBe(true);
        expect(isBefore(notification, get('h2#about-flib-club'))).toBe(true);
        expect(notification.dataset.flib).toBeUndefined();
    });
});

describe('ссылки на установку словарей', () => {
    test.each(['ext/popup.html', 'ext/search.html'])('%s: «Словари не установлены» ведёт к кнопке установки', (name) => {
        const {document: other} = new JSDOM(readText(name)).window;
        const links = all(other, '#no-dictionaries a');
        expect(links.map((node) => node.getAttribute('href'))).toStrictEqual(['/settings.html#flib-dictionaries-provisioning']);
        expect(readText('ext/js/display/display-translation.js')).toContain('\'/settings.html#flib-dictionaries-provisioning\'');
        expect(get('#flib-dictionaries-provisioning').querySelector('#flib-dictionaries-button')).not.toBeNull();
    });

    test('ссылки на раздел словарей Yomitan из его руководства прежние', () => {
        const {document: guide} = new JSDOM(readText('ext/quick-start-guide.html')).window;
        expect(all(guide, 'a[href="/settings.html#dictionaries"]')).toHaveLength(2);
    });
});

describe('метка data-flib', () => {
    test('у пунктов меню, заголовков и групп наших разделов', () => {
        expect([...page.querySelectorAll('.sidebar [data-flib]')].map((node) => node.getAttribute('href') ?? node.textContent)).toStrictEqual(['Flib-club', ...FLIB_ANCHORS.map((id) => `#${id}`)]);
        expect([...page.querySelectorAll('.heading-container[data-flib] h2')].map(({id}) => id)).toStrictEqual(['about-flib-club', 'flib-server', 'flib-dictionaries', 'flib-cards', 'tags', 'flib-view']);
        const groups = all(page, '.content-center .settings-group:not(.page-loading-stalled-notification)').filter((node) => isBefore(node, get('h2#profile')));
        expect(groups).toHaveLength(6);
        expect(groups.filter(({dataset}) => typeof dataset.flib === 'undefined')).toStrictEqual([]);
    });

    test('и у трёх наших пунктов в разделах Yomitan', () => {
        const items = [...page.querySelectorAll('.settings-item[data-flib]')];
        expect(items.map((node) => get('[data-i18n]', node).dataset.i18n)).toStrictEqual(['settings.contextMenu', 'settings.groupingTitle', 'settings.ankiUrlHint']);
        expect(items[2].contains(get('[data-setting="anki.server"]'))).toBe(true);
        expect(items[2].contains(get('[data-i18n="settings.ankiMore4"]'))).toBe(true);
        for (const node of page.querySelectorAll('[data-flib]')) {
            expect(node.matches('.outline-group,.outline-item,.heading-container,.settings-group,.settings-item'), node.className).toBe(true);
        }
    });
});

describe('тексты', () => {
    test('каждый ключ data-i18n есть в обоих языках', () => {
        const keys = [...html.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)].map((match) => match[1]);
        expect(keys.length).toBeGreaterThan(50);
        expect(keys.filter((key) => !Object.hasOwn(messagesRu, key) || !Object.hasOwn(messagesEn, key))).toStrictEqual([]);
    });

    test('английский текст разметки совпадает с переводом', () => {
        const nodes = all(page, '[data-i18n]');
        expect(nodes.length).toBeGreaterThan(50);
        for (const node of nodes) {
            expect(node.textContent).toBe(messagesEn[node.dataset.i18n ?? '']);
        }
        for (const node of /** @type {(HTMLInputElement|HTMLTextAreaElement)[]} */ (all(page, '[data-i18n-placeholder]'))) {
            expect(node.placeholder).toBe(messagesEn[node.dataset.i18nPlaceholder ?? '']);
        }
    });

    test('в разделах Flib-club нет непереведённого текста, кроме имён', () => {
        const names = new Set(['Язык интерфейса · Interface language', 'Auto', 'Русский', 'English', 'flib.club', 'GitHub', 'Yomitan', '(GPL-3.0).', 'help@flib.club', 'partners@flib.club', '·']);
        /** @type {string[]} */
        const found = [];
        const blocks = [...page.querySelectorAll('.heading-container[data-flib],.settings-group[data-flib]'), get('.heading-description', /** @type {Element} */ (get('h2#tags').closest('.heading-container')?.parentElement))];
        for (const block of blocks) {
            const walker = page.createTreeWalker(block, 4);
            for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
                const text = squash(node.nodeValue);
                if (/\p{L}/u.test(text) && !names.has(text) && node.parentElement?.closest('[data-i18n],code') === null) { found.push(text); }
            }
        }
        expect(found).toStrictEqual([]);
    });

    test('заголовки групп меню не переводятся, старых ключей больше нет', () => {
        for (const {dataset} of all(page, '.outline-group')) { expect(dataset.i18n).toBeUndefined(); }
        for (const key of ['about.heading', 'settings.server']) { expect(Object.hasOwn(messagesRu, key), key).toBe(false); }
        expect(FLIB_ANCHORS.map((id) => messagesRu[get(`h2#${id}>a`).dataset.i18n ?? ''])).toStrictEqual(['О Flib-club', 'Ключ и права', 'Словари Flib', 'Карточки Anki', 'Вид карточки']);
    });

    test('тексты тегов говорят о настоящих метках и не называют плагин Yomitan', () => {
        const keys = Object.keys(messagesRu).filter((key) => key.startsWith('settings.tags'));
        expect(keys.length).toBeGreaterThan(6);
        for (const key of keys) { expect(JSON.stringify([messagesRu[key], messagesEn[key]])).not.toContain('Yomitan'); }
        const about = get('.heading-description', /** @type {Element} */ (get('h2#tags').closest('.heading-container')?.parentElement));
        expect([...about.querySelectorAll('code')].map(({textContent}) => textContent)).toStrictEqual(['webpage_example_com', 'webpage_wiki_article']);
    });
});

describe('UserTagsController', () => {
    /** @type {Awaited<ReturnType<typeof setupDomTest>>} */
    let env;
    beforeEach(async () => { env = await setupDomTest(path.join(ROOT, 'ext/settings.html')); });
    afterEach(async () => {
        vi.useRealTimers();
        setUiLanguage('ru');
        await env.teardown(global);
    });

    test.each([['ru', 'Сохранено'], ['en', 'Saved']])('сообщение о сохранении на языке %s', async (language, expected) => {
        setUiLanguage(/** @type {import('ui-language').UiLanguage} */ (language));
        const setProfileSetting = vi.fn(async () => {});
        const controller = new UserTagsController(/** @type {import('../ext/js/pages/settings/settings-controller.js').SettingsController} */ (/** @type {unknown} */ ({
            on: () => {},
            getOptions: async () => ({anki: {userTags: ['a']}}),
            setProfileSetting,
        })));
        await controller.prepare();
        const textarea = /** @type {HTMLTextAreaElement} */ (document.querySelector('#user-tags-textarea'));
        expect(textarea.value).toBe('a');
        textarea.value = ' b \n\nc';
        vi.useFakeTimers();
        /** @type {HTMLButtonElement} */ (document.querySelector('#user-tags-save')).click();
        await vi.advanceTimersByTimeAsync(0);
        expect(setProfileSetting).toHaveBeenCalledWith('anki.userTags', ['b', 'c']);
        const status = /** @type {HTMLElement} */ (document.querySelector('#user-tags-status'));
        expect(status.textContent).toBe(expected);
        expect(status.hidden).toBe(false);
        await vi.advanceTimersByTimeAsync(2000);
        expect(status.hidden).toBe(true);
    });
});

describe('settings.css', () => {
    /**
     * @param {string} name
     * @returns {{selectors: string[], declarations: {[property: string]: string}}[]}
     */
    function readRules(name) {
        /** @type {{selectors: string[], declarations: {[property: string]: string}}[]} */
        const output = [];
        const visit = (/** @type {import('css').Node[]} */ nodes) => {
            for (const node of nodes) {
                const {type} = node;
                if (type === 'media' || type === 'supports') { visit(/** @type {import('css').Media} */ (node).rules ?? []); }
                if (type !== 'rule') { continue; }
                const {selectors = [], declarations = []} = /** @type {import('css').Rule} */ (node);
                /** @type {{[property: string]: string}} */
                const values = {};
                for (const declaration of declarations) {
                    const {property, value} = /** @type {import('css').Declaration} */ (declaration);
                    if (typeof property === 'string' && typeof value === 'string') { values[property] = value; }
                }
                output.push({selectors, declarations: values});
            }
        };
        visit(css.parse(readText(name)).stylesheet?.rules ?? []);
        return output;
    }

    const rules = readRules('ext/css/settings.css');
    const isOurs = (/** @type {{selectors: string[], declarations: {[property: string]: string}}} */ {selectors, declarations}) => (
        selectors.some((selector) => /data-flib|outline-group|data-page-type/.test(selector)) ||
        Object.entries(declarations).some(([property, value]) => property.startsWith('--flib-') || value.includes('--flib-'))
    );

    test('цвета равны цветам карточки в обеих темах', () => {
        const card = readRules('ext/css/flib-card.css');
        for (const [theme, scope, cardScope] of [['light', SCOPE, ':root'], ['dark', `${SCOPE}[data-theme=dark]`, ':root[data-theme=dark]']]) {
            const ours = rules.find(({selectors}) => selectors.join(',') === scope)?.declarations ?? {};
            const theirs = card.find(({selectors, declarations}) => selectors.join(',') === cardScope && '--fc-acc' in declarations)?.declarations ?? {};
            expect([ours['--flib-accent'], ours['--flib-accent-soft']], theme).toStrictEqual([theirs['--fc-acc'], theirs['--fc-acc-soft']]);
            expect(ours['--flib-accent'], theme).toMatch(/^#/);
        }
    });

    test('наши правила действуют только на странице настроек', () => {
        const ours = rules.filter((rule) => isOurs(rule));
        expect(ours.length).toBeGreaterThan(5);
        expect(ours.flatMap(({selectors}) => selectors).filter((selector) => !selector.startsWith(SCOPE))).toStrictEqual([]);
        for (const property of ['--flib-accent', '--flib-accent-soft']) {
            expect(ours.some(({declarations}) => Object.values(declarations).some((value) => value.includes(`var(${property})`))), property).toBe(true);
        }
        for (const part of ['.heading-container[data-flib]', '.settings-group[data-flib]', '.settings-item[data-flib]', '.outline-group[data-flib]', '.outline-item[data-flib]']) {
            expect(ours.some(({selectors}) => selectors.some((selector) => selector.includes(part))), part).toBe(true);
        }
    });

    test('фокус с клавиатуры виден на пунктах меню', () => {
        const selector = `${SCOPE} .outline-item[data-flib]:focus-visible`;
        const found = rules.filter(({selectors}) => selectors.includes(selector));
        expect(found).toHaveLength(1);
        expect(found[0].declarations).toStrictEqual({'outline': '2px solid var(--flib-accent)', 'outline-offset': '-2px'});
        // .button:focus из material.css снимает outline; наше правило весит больше его селектора.
        const button = readRules('ext/css/material.css').filter(({selectors, declarations}) => selectors.includes('.button:focus') && declarations.outline === 'none');
        expect(button).toHaveLength(1);
        expect(readText('ext/settings.html').indexOf('/css/settings.css')).toBeGreaterThan(readText('ext/settings.html').indexOf('/css/material.css'));
    });

    test('ссылка зелёного заголовка при наведении остаётся зелёной', () => {
        const found = rules.filter(({selectors}) => selectors.includes(`${SCOPE} .heading-container[data-flib] h2 a:hover`));
        expect(found).toHaveLength(1);
        expect(found[0].declarations).toStrictEqual({'color': 'var(--flib-accent)', 'text-decoration': 'underline'});
    });

    test('другие страницы с settings.css этой метки не несут', () => {
        expect(page.documentElement.dataset.pageType).toBe('settings');
        const others = fs.readdirSync(path.join(ROOT, 'ext')).filter((name) => name.endsWith('.html') && name !== 'settings.html');
        expect(others).toContain('welcome.html');
        for (const name of others) {
            expect(readText(`ext/${name}`), name).not.toMatch(/data-page-type="settings"|data-flib[\s>=]|outline-group/);
        }
    });

    test('у welcome.html свои копии id', () => {
        const {document: welcome} = new JSDOM(readText('ext/welcome.html')).window;
        for (const id of ['flib-dictionaries-provisioning', 'flib-dictionaries-status', 'flib-dictionaries-progress', 'flib-dictionaries-button']) {
            expect(welcome.querySelectorAll(`#${id}`), id).toHaveLength(1);
        }
        expect(welcome.querySelector('#flib-dictionaries-provisioning')?.hasAttribute('hidden')).toBe(true);
    });
});
