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

import {ExtensionError} from '../../core/extension-error.js';
import {FLIB_BUY_URL, FLIB_HELP_EMAIL} from '../../data/flib-host.js';
import {usageShare} from '../../data/flib-key-access.js';
import {getGatewayErrorCode} from '../../display/gateway-examples-util.js';
import {querySelectorNotNull} from '../../dom/query-selector.js';
import {getUiLanguage, translate, translatePlural} from '../../i18n/ui-language.js';

/** Шлюз отдаёт 8 знаков ключа. Прочее из чужого ответа на страницу не попадает. */
const KEY_PREFIX_PATTERN = /^tpk_[0-9a-f]{1,12}$/;
/** Лимит речи короче этого показывается в секундах: в минутах он превратился бы в «0 из 0». */
const MIN_LIMIT_IN_MINUTES_S = 600;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Неразрывный пробел: точка не начинает строку. */
const SEPARATOR = '\u00a0· ';

/** @type {Map<string, string>} */
const ERROR_TEXT = new Map([
    ['flib_key_invalid', 'settings.keyAccessInvalid'],
    ['flib_key_revoked', 'settings.keyAccessRevoked'],
    ['flib_key_expired', 'settings.keyAccessExpired'],
    ['flib_key_access_unsupported', 'settings.keyAccessUnsupported'],
    ['flib_key_changed', 'settings.keyAccessChanged'],
    ['flib_service_unavailable', 'settings.keyAccessDown'],
    ['flib_network', 'settings.keyAccessDown'],
    ['flib_timeout', 'settings.keyAccessDown'],
]);

/**
 * Права сверх прав самого расширения; остальные id не показываются.
 * @type {{ids: string[], label: string}[]}
 */
const OTHER_RIGHTS = [
    {ids: ['yt_shorts'], label: 'settings.keyRightShorts'},
    {ids: ['yt_video'], label: 'settings.keyRightVideo'},
    {ids: ['yt_long'], label: 'settings.keyRightLong'},
    {ids: ['puzzle_movies'], label: 'settings.keyRightCatalog'},
    {ids: ['chad'], label: 'settings.keyRightPronunciation'},
    {ids: ['lingq'], label: 'settings.keyRightListening'},
    {ids: ['elevenlabs_realtime', 'assemblyai'], label: 'settings.keyRightRecognition'},
    {ids: ['locker'], label: 'settings.keyRightLocker'},
];
/** Служебное право: человеку о нём не говорим. */
const HIDDEN_RIGHT_ID = 'beginner_kit_edit';

/** Ошибки самого ключа: прежние строки рядом с ними противоречили бы тексту. */
const KEY_ERRORS = new Set(['flib_key_missing', 'flib_key_invalid', 'flib_key_revoked', 'flib_key_expired', 'flib_key_changed']);

/**
 * @typedef {object} RightState
 * @property {boolean} usable
 * @property {boolean} permanent
 * @property {?string} until Последний день права, действующего или будущего; null — даты нет.
 * @property {?string} from Первый день будущего права; null — права не будет.
 */

/** @type {RightState} */
const NO_RIGHT = {usable: false, permanent: false, until: null, from: null};

/**
 * Лучшее из прав с этими id: действующее с самым поздним сроком, иначе ближайшее будущее.
 * @param {import('flib-gateway').KeyRight[]} rights
 * @param {string[]} ids
 * @returns {RightState}
 */
function pickRight(rights, ids) {
    const today = new Date().toISOString().substring(0, 10);
    const own = rights.filter(({id}) => ids.includes(id));
    const usable = own.filter((right) => right.usable);
    if (usable.length > 0) {
        // `permanent` раньше даты: у бессрочного права в validTo дата-заглушка шлюза.
        const permanent = usable.some((right) => right.permanent);
        const dates = usable.map(({validTo}) => validTo).filter((date) => date !== null).sort();
        const dated = !permanent && dates.length === usable.length;
        return {usable: true, permanent, until: dated ? dates[dates.length - 1] : null, from: null};
    }
    const [future] = own
        .map(({validFrom, validTo, permanent}) => ({usable: false, permanent, until: permanent ? null : validTo, from: validFrom ?? ''}))
        .filter(({from, until}) => from > today && (until === null || until >= from))
        .sort((a, b) => (a.from < b.from ? -1 : 1));
    return future ?? NO_RIGHT;
}

/**
 * Строка, которой нужны оба права.
 * @param {RightState} a
 * @param {RightState} b
 * @returns {RightState}
 */
function requireBoth(a, b) {
    const permanent = a.permanent && b.permanent;
    const until = [a.until, b.until].filter((date) => date !== null).sort()[0] ?? null;
    if (a.usable && b.usable) { return {usable: true, permanent, until, from: null}; }
    const missing = [a, b].filter(({usable}) => !usable).map(({from}) => from);
    const dates = missing.filter((date) => date !== null).sort();
    const from = dates.length === missing.length ? dates[dates.length - 1] : null;
    // Одно кончится раньше, чем начнётся другое: вместе их не будет.
    if (from === null || (until !== null && until < from)) { return NO_RIGHT; }
    return {usable: false, permanent, until, from};
}

/**
 * @param {?string} expiresAt `null` — ключ бессрочный, `''` — о сроке нет данных.
 * @returns {?number} Миг, когда ключ перестаёт действовать; дата без времени — до конца этого дня.
 */
function getKeyEnd(expiresAt) {
    if (expiresAt === null || expiresAt === '') { return null; }
    return Date.parse(expiresAt) + (expiresAt.includes('T') ? 0 : DAY_MS);
}

/**
 * @param {number} keyEnd
 * @returns {string} Последний день, в который ключ действует целиком; 23:59:59 — это конец дня.
 */
function getLastWholeDay(keyEnd) {
    return new Date(keyEnd + 1000 - DAY_MS).toISOString().substring(0, 10);
}

/**
 * @param {string} date
 * @returns {string} «31.12.2026»; по-английски месяц словом: 12/05 читают по-разному.
 */
function formatShortDate(date) {
    const language = getUiLanguage();
    /** @type {Intl.DateTimeFormatOptions} */
    const options = language === 'ru' ?
        {day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC'} :
        {day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'};
    return new Intl.DateTimeFormat(language, options).format(new Date(date));
}

/**
 * @param {string} date
 * @returns {string} «1 декабря 2026»: без хвоста после года, который добавляет русский формат.
 */
function formatLongDate(date) {
    const parts = new Intl.DateTimeFormat(getUiLanguage(), {day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'}).formatToParts(new Date(date));
    return parts.slice(0, parts.findIndex(({type}) => type === 'year') + 1).map(({value}) => value).join('');
}

/**
 * @param {string} date
 * @returns {string}
 */
function formatDayAndMonth(date) {
    return new Intl.DateTimeFormat(getUiLanguage(), {day: 'numeric', month: 'long', timeZone: 'UTC'}).format(new Date(date));
}

/**
 * @param {number} value
 * @returns {number} Целое вниз; потолок — чтобы чужое число не растянуло страницу.
 */
function toWhole(value) {
    return Math.floor(Math.min(value, Number.MAX_SAFE_INTEGER));
}

/**
 * @param {number} value
 * @returns {string}
 */
function formatWhole(value) {
    return new Intl.NumberFormat(getUiLanguage()).format(toWhole(value));
}

/**
 * @param {?import('flib-gateway').KeyUsage} usage
 * @returns {boolean}
 */
function isExhausted(usage) {
    return usage !== null && usageShare(usage)?.exhausted === true;
}

/**
 * Срок показывается, только если он раньше срока ключа.
 * @param {RightState} right
 * @param {?string} expiresAt `null` — ключ бессрочный, `''` — о сроке ключа нет данных.
 * @returns {?string}
 */
function describeTerm({permanent, until}, expiresAt) {
    if (until === null) { return permanent && expiresAt === '' ? translate('settings.keyAccessForever') : null; }
    const keyEnd = getKeyEnd(expiresAt);
    return keyEnd === null || until < getLastWholeDay(keyEnd) ? translate('settings.keyNoteUntil', {date: formatLongDate(until)}) : null;
}

/**
 * @param {RightState} right
 * @param {?string} expiresAt
 * @returns {?string} `null` — права не будет, или ключ кончится раньше.
 */
function describeStart({from}, expiresAt) {
    if (from === null) { return null; }
    const keyEnd = getKeyEnd(expiresAt);
    return keyEnd === null || Date.parse(from) < keyEnd ? translate('settings.keyNoteFrom', {date: formatLongDate(from)}) : null;
}

/**
 * @param {RightState} right
 * @param {?string} expiresAt
 * @returns {string[]}
 */
function describeDates(right, expiresAt) {
    const note = right.usable ? describeTerm(right, expiresAt) : describeStart(right, expiresAt);
    return note === null ? [] : [note];
}

/**
 * @param {import('flib-gateway').KeyAccess} access
 * @returns {{label: string, ok: boolean, notes: string[]}[]}
 */
function describeRights({rights, demo, expiresAt, gpt, tts, examplesQuota}) {
    const examples = pickRight(rights, ['examples']);
    const route = pickRight(rights, ['route']);
    const films = requireBoth(route, pickRight(rights, ['puzzle_movies']));
    const noExamplesLeft = examples.usable && examplesQuota !== null && isExhausted({...examplesQuota, unlimited: examplesQuota.limit === null});
    const noGptLeft = isExhausted(gpt);
    const noTtsLeft = isExhausted(tts);
    return [
        {
            label: translate('settings.keyRightExamples'),
            ok: examples.usable && !noExamplesLeft,
            notes: noExamplesLeft ? [translate('settings.keyNoteExamples')] : describeDates(examples, expiresAt),
        },
        {
            label: translate('settings.keyRightFilms'),
            ok: films.usable,
            notes: [...(films.usable && demo ? [translate('settings.keyNoteLimited')] : []), ...describeDates(films, expiresAt)],
        },
        {
            label: translate('settings.keyRightUnderstandable'),
            ok: route.usable && !demo,
            notes: demo ? [] : describeDates(route, expiresAt),
        },
        {
            label: translate('settings.keyRightCards'),
            ok: !noGptLeft,
            notes: noGptLeft ? [translate('settings.keyNoteGpt')] : [],
        },
        {
            label: translate('settings.keyRightSpeech'),
            ok: !noTtsLeft,
            notes: noTtsLeft ? [translate('settings.keyNoteTts')] : [],
        },
    ];
}

/**
 * @param {import('flib-gateway').KeyAccess} access
 * @returns {string[]}
 */
function describeOtherRights({rights, expiresAt}) {
    /** @type {string[]} */
    const output = [];
    for (const {ids, label} of OTHER_RIGHTS) {
        const right = pickRight(rights, ids);
        const [note] = describeDates(right, expiresAt);
        if (!right.usable && typeof note === 'undefined') { continue; }
        output.push(typeof note === 'string' ? `${translate(label)} (${note})` : translate(label));
    }
    return output;
}

/**
 * @param {import('flib-gateway').KeyUsageShare} share
 * @returns {string}
 */
function describeSpent({spentPercent, underOne, exhausted}) {
    if (exhausted) { return translate('settings.keyUsageExhausted'); }
    return underOne ? translate('settings.keyUsageSpentLittle') : translate('settings.keyUsageSpent', {spent: spentPercent});
}

/**
 * Потрачено и осталось одной строкой — общее у трёх видов расхода.
 * @param {?import('flib-gateway').KeyUsage} usage
 * @param {(share: import('flib-gateway').KeyUsageShare, limit: number) => string} describe
 * @returns {string}
 */
function describeUsage(usage, describe) {
    if (usage === null) { return translate('settings.keyUsageNoData'); }
    const share = usageShare(usage);
    return share === null || usage.limit === null ? translate('settings.keyUsageUnlimited') : describe(share, usage.limit);
}

/**
 * Деньги не показываются: только доля.
 * @param {import('flib-gateway').KeyAccess} access
 * @returns {string}
 */
function describeGpt({gpt, gptTokens}) {
    const text = describeUsage(gpt, (share) => {
        const spent = describeSpent(share);
        if (share.exhausted) { return spent; }
        const left = share.underOne ? translate('settings.keyUsageLeftMost') : translate('settings.keyUsageLeftPercent', {left: share.leftPercent});
        return `${spent}, ${left}`;
    });
    if (gptTokens === null) { return text; }
    const tokens = toWhole(gptTokens.input + gptTokens.output);
    return `${text}${SEPARATOR}${translatePlural('settings.keyUsageTokens', tokens, {tokens: formatWhole(tokens)})}`;
}

/**
 * @param {string} amount
 * @param {import('flib-gateway').KeyUsageShare} share
 * @param {number} left
 * @returns {string}
 */
function addLeft(amount, {exhausted}, left) {
    if (exhausted) { return `${amount}, ${translate('settings.keyUsageExhausted')}`; }
    // Округлённые вниз числа могли совпасть, но лимит ещё не исчерпан: нуля здесь не бывает.
    const leftText = left > 0 ? formatWhole(left) : translate('settings.keyUsageUnderOne');
    return `${amount}, ${translate('settings.keyUsageLeft', {left: leftText})}`;
}

/**
 * @param {import('flib-gateway').KeyAccess} access
 * @returns {string}
 */
function describeTts({tts}) {
    return describeUsage(tts, (share, limit) => {
        const used = toWhole(tts?.used ?? 0);
        const amount = translatePlural('settings.keyUsageChars', toWhole(limit), {used: formatWhole(used), limit: formatWhole(limit)});
        return addLeft(amount, share, toWhole(limit) - used);
    });
}

/**
 * @param {import('flib-gateway').KeyAccess} access
 * @returns {string}
 */
function describeStt({stt}) {
    return describeUsage(stt, (share, limitSeconds) => {
        const usedSeconds = stt?.used ?? 0;
        if (limitSeconds < MIN_LIMIT_IN_MINUTES_S) {
            const amount = translate('settings.keyUsageSeconds', {used: formatWhole(usedSeconds), limit: formatWhole(limitSeconds)});
            return addLeft(amount, share, toWhole(limitSeconds) - toWhole(usedSeconds));
        }
        const limit = toWhole(limitSeconds / 60);
        const used = toWhole(usedSeconds / 60);
        const underOne = usedSeconds > 0 && used === 0;
        const amount = translate('settings.keyUsageMinutes', {used: underOne ? translate('settings.keyUsageUnderOne') : formatWhole(used), limit: formatWhole(limit)});
        return addLeft(amount, share, limit - (underOne ? 1 : used));
    });
}

/**
 * @param {string} name
 * @param {string} className
 * @param {string} [text]
 * @returns {HTMLElement}
 */
function createNode(name, className, text) {
    const node = document.createElement(name);
    node.className = className;
    if (typeof text === 'string') { node.textContent = text; }
    return node;
}

/**
 * @param {string} text
 * @param {string} href
 * @returns {HTMLAnchorElement}
 */
function createLink(text, href) {
    const node = document.createElement('a');
    node.textContent = text;
    node.href = href;
    if (!href.startsWith('mailto:')) {
        node.target = '_blank';
        node.rel = 'noopener noreferrer';
    }
    return node;
}

/**
 * @param {{label: string, ok: boolean, notes: string[]}} details
 * @returns {HTMLElement}
 */
function createRightNode({label, ok, notes}) {
    const node = createNode('li', 'flib-key-right');
    const mark = createNode('span', `flib-key-mark ${ok ? 'yes' : 'no'}`, ok ? '✓' : '✗');
    mark.setAttribute('role', 'img');
    mark.setAttribute('aria-label', ok ? translate('settings.keyRightYes') : translate('settings.keyRightNo'));
    const text = createNode('span', '', label);
    if (notes.length > 0) { text.append(createNode('span', 'flib-key-note', ` — ${notes.join(SEPARATOR)}`)); }
    node.append(mark, ' ', text);
    return node;
}

/**
 * @param {string} label
 * @param {?import('flib-gateway').KeyUsage} usage
 * @param {string} text
 * @returns {HTMLElement}
 */
function createUsageNode(label, usage, text) {
    const node = createNode('div', 'flib-key-usage-row');
    node.append(createNode('span', 'flib-key-usage-label', label), ' ');
    const share = usage === null ? null : usageShare(usage);
    if (share !== null) {
        const bar = createNode('span', share.exhausted ? 'flib-key-bar exhausted' : 'flib-key-bar');
        bar.setAttribute('role', 'img');
        bar.setAttribute('aria-label', translate('settings.keyUsageBar', {label, text: describeSpent(share)}));
        const fill = document.createElement('span');
        fill.style.width = `${share.underOne ? 1 : share.spentPercent}%`;
        bar.append(fill);
        node.append(bar, ' ');
    }
    node.append(createNode('span', 'flib-key-usage-text', text));
    return node;
}

/**
 * @param {import('flib-gateway').KeyAccess} access
 * @returns {HTMLElement[]}
 */
function createAccessNodes(access) {
    const {gpt, tts, stt, examplesQuota, resetsAt} = access;
    const rights = createNode('ul', 'flib-key-rights');
    rights.append(...describeRights(access).map(createRightNode));
    const nodes = [rights];
    const other = describeOtherRights(access);
    if (other.length > 0) { nodes.push(createNode('div', 'flib-key-other', translate('settings.keyAccessOther', {list: other.join(SEPARATOR)}))); }
    const usage = createNode('div', 'flib-key-usage');
    usage.append(
        createUsageNode(translate('settings.keyUsageGpt'), gpt, describeGpt(access)),
        createUsageNode(translate('settings.keyUsageTts'), tts, describeTts(access)),
        createUsageNode(translate('settings.keyUsageStt'), stt, describeStt(access)),
    );
    nodes.push(usage);
    if (examplesQuota !== null) {
        const {used, limit} = examplesQuota;
        const parts = [limit === null ? translate('settings.keyUsageExamplesUnlimited') : translate('settings.keyUsageExamples', {used: formatWhole(used), limit: formatWhole(limit)})];
        if (isExhausted({used, limit, unlimited: limit === null})) { parts.push(translate('settings.keyUsageExhausted')); }
        nodes.push(createNode('div', 'flib-key-quota', parts.join(', ')));
    }
    const foot = [translate('settings.keyAccessPrograms')];
    if (resetsAt !== null) { foot.unshift(translate('settings.keyUsageResets', {date: formatDayAndMonth(resetsAt)})); }
    nodes.push(createNode('div', 'flib-key-foot settings-item-description', foot.join(' ')));
    return nodes;
}

/**
 * @param {unknown} error
 * @returns {?import('flib-gateway').KeyAccessIdentity} `null` — ошибка не называет ключа, с которым получена.
 */
function getErrorIdentity(error) {
    if (!(error instanceof ExtensionError) || typeof error.data !== 'object' || error.data === null) { return null; }
    const {keyMasked, gatewayUrl, changed} = /** @type {Record<string, unknown>} */ (error.data);
    if (typeof gatewayUrl !== 'string' || (typeof keyMasked !== 'string' && keyMasked !== null)) { return null; }
    return {keyMasked, gatewayUrl, changed: changed === true};
}

/**
 * Панель «Права ключа и расход» под полем ключа.
 *
 * Запрос уходит при открытии страницы, после записи ключа или адреса, по
 * «Обновить» и при возврате на вкладку или в окно, если ключ или адрес стали
 * другими. Таймера нет, ответ нигде не хранится.
 *
 * ⚠️ Данные одного ключа никогда не показываются у другого. Любая новая
 * загрузка поднимает счётчик, и поздний ответ прежней выбрасывается. Чей
 * ответ, говорит сам ответ (и ошибка): фоновая часть могла повторить запрос
 * уже с новым ключом, и перечитать маску после ответа мало — ключ могли
 * вернуть. Прежние строки остаются только при «Обновить», если их ключ
 * подтверждён ошибкой; сбой, который ключа не называет, их убирает.
 */
export class FlibKeyAccessController {
    /**
     * @param {import('./settings-controller.js').SettingsController} settingsController
     */
    constructor(settingsController) {
        /** @type {import('./settings-controller.js').SettingsController} */
        this._settingsController = settingsController;
        /** @type {import('../../comm/api.js').API} */
        this._api = settingsController.application.api;
        /** @type {HTMLElement} */
        this._panel = querySelectorNotNull(document, '#flib-key-access');
        /** @type {HTMLElement} */
        this._summaryNode = querySelectorNotNull(document, '#flib-key-access-summary');
        /** @type {HTMLElement} */
        this._stateNode = querySelectorNotNull(document, '#flib-key-access-state');
        /** @type {HTMLElement} */
        this._bodyNode = querySelectorNotNull(document, '#flib-key-access-body');
        /** @type {HTMLButtonElement} */
        this._refreshButton = querySelectorNotNull(document, '#flib-key-access-refresh');
        /** @type {number} */
        this._generation = 0;
        /** @type {'loading'|'ready'|'empty'|'error'} */
        this._state = 'loading';
        /** @type {?string} Текст и код, которые сейчас в строке состояния: одно и то же не объявляется дважды. */
        this._stateSignature = null;
        /** @type {boolean} Нажатие «Обновить» отобрало у кнопки фокус, и его надо вернуть. */
        this._focusWanted = false;
        /** @type {?string} Код ошибки последней загрузки; читается только в состоянии `error`. */
        this._errorCode = null;
        /** @type {?import('flib-gateway').KeyAccess} */
        this._access = null;
        /** @type {?import('flib-secret-store').FlibSecretsIdentity} Чей ответ на экране (или в пути); null — неизвестно. */
        this._source = null;
    }

    /** Ответа не ждёт: иначе сервер задерживал бы всю страницу. */
    prepare() {
        this._refreshButton.addEventListener('click', this._onRefreshClick.bind(this), false);
        // Фокус — для двух окон рядом и для карточки предпросмотра на этой же странице: вкладка всё время видна.
        const onReturn = this._onReturn.bind(this);
        document.addEventListener('visibilitychange', onReturn, false);
        window.addEventListener('focus', onReturn, false);
        this._settingsController.on('flibSecretsChanged', this._onSecretsChanged.bind(this));
        this._settingsController.on('uiLanguageChanged', this._render.bind(this));
        void this._load(false);
    }

    // Private

    /** */
    _onSecretsChanged() {
        void this._load(false);
    }

    /** */
    _onRefreshClick() {
        this._focusWanted = document.activeElement === this._refreshButton;
        void this._load(true);
    }

    /** Ключ могли сменить в карточке или в другой вкладке настроек. */
    async _onReturn() {
        if (document.visibilityState !== 'visible') { return; }
        const generation = this._generation;
        let secrets;
        try {
            secrets = await this._api.flibSecretsGet();
        } catch (e) {
            return;
        }
        // Загрузка, начатая за это время, прочитала ключ сама.
        if (generation !== this._generation || this._isSameSource(secrets)) { return; }
        void this._load(false);
    }

    /**
     * @param {import('flib-secret-store').FlibSecretsIdentity} identity
     * @returns {boolean}
     */
    _isSameSource({keyMasked, gatewayUrl}) {
        return this._source !== null && this._source.keyMasked === keyMasked && this._source.gatewayUrl === gatewayUrl;
    }

    /**
     * @param {boolean} keepData Оставить прежние данные до ответа (если ключ и адрес прежние).
     */
    async _load(keepData) {
        const generation = ++this._generation;
        if (!keepData) { this._access = null; }
        this._setState('loading');
        let asked = false;
        try {
            const {keyMasked, gatewayUrl} = await this._api.flibSecretsGet();
            if (generation !== this._generation) { return; }
            const expected = {keyMasked, gatewayUrl};
            if (keyMasked === null || !this._isSameSource(expected)) { this._access = null; }
            this._source = expected;
            if (keyMasked === null) {
                this._setState('empty');
                return;
            }
            this._render();
            asked = true;
            const answer = await this._api.flibKeyAccess(expected);
            if (generation !== this._generation) { return; }
            this._source = {keyMasked: answer.keyMasked, gatewayUrl: answer.gatewayUrl};
            this._access = answer.access;
            this._setState('ready');
        } catch (e) {
            if (generation !== this._generation) { return; }
            this._onLoadError(e, asked);
        }
    }

    /**
     * @param {unknown} error
     * @param {boolean} asked Дошло ли до запроса прав: тогда `_source` — то, что прочитано перед ним.
     */
    _onLoadError(error, asked) {
        const code = getGatewayErrorCode(error);
        const identity = getErrorIdentity(error);
        const dropData = identity === null || identity.changed || !this._isSameSource(identity) || KEY_ERRORS.has(code ?? '');
        if (dropData) { this._access = null; }
        if (identity !== null) { this._source = {keyMasked: identity.keyMasked, gatewayUrl: identity.gatewayUrl}; }
        // Ответа нет ни для какого ключа: возврат на вкладку запросит снова.
        if (!asked || code === 'flib_key_changed') { this._source = null; }
        this._setState(code === 'flib_key_missing' ? 'empty' : 'error', code);
    }

    /**
     * @param {'loading'|'ready'|'empty'|'error'} state
     * @param {?string} [errorCode]
     */
    _setState(state, errorCode = null) {
        this._state = state;
        this._errorCode = errorCode;
        this._render();
    }

    /** */
    _render() {
        const access = this._access;
        this._panel.dataset.state = this._state;
        this._renderState();
        this._summaryNode.textContent = access === null ? '' : this._describeKey(access);
        this._bodyNode.replaceChildren(...(access === null ? [] : createAccessNodes(access)));
        this._refreshButton.disabled = this._state === 'loading';
        this._restoreFocus();
    }

    /** Строка состояния читается вслух при каждой перемене, поэтому меняется только вместе с текстом или кодом. */
    _renderState() {
        const nodes = this._createStateNodes();
        const text = nodes.map((node) => (typeof node === 'string' ? node : node.textContent)).join('');
        const signature = `${this._errorCode ?? ''} ${text}`;
        if (signature === this._stateSignature) { return; }
        this._stateSignature = signature;
        this._stateNode.replaceChildren(...nodes);
    }

    /** Погашенная кнопка теряет фокус: он возвращается, если не ушёл сам. */
    _restoreFocus() {
        if (!this._focusWanted || this._refreshButton.disabled) { return; }
        this._focusWanted = false;
        if (document.activeElement === document.body) { this._refreshButton.focus(); }
    }

    /**
     * @param {import('flib-gateway').KeyAccess} access
     * @returns {string}
     */
    _describeKey({keyPrefix, expiresAt}) {
        const key = keyPrefix !== null && KEY_PREFIX_PATTERN.test(keyPrefix) ? translate('settings.keyAccessKey', {prefix: keyPrefix}) : translate('settings.keyAccessKeyPlain');
        return `${key}${SEPARATOR}${this._describeKeyTerm(expiresAt)}`;
    }

    /**
     * @param {?string} expiresAt
     * @returns {string}
     */
    _describeKeyTerm(expiresAt) {
        switch (expiresAt) {
            case null: return translate('settings.keyAccessForever');
            // Срок есть, но не читается: это не «бессрочно».
            case '': return translate('settings.keyAccessTermUnknown');
            default: return translate('settings.keyAccessUntil', {date: formatShortDate(expiresAt)});
        }
    }

    /**
     * @returns {(Node|string)[]}
     */
    _createStateNodes() {
        switch (this._state) {
            case 'loading': return [translate('settings.keyAccessLoading')];
            case 'empty': return [translate('settings.keyAccessMissing')];
            case 'error': return this._createErrorNodes();
            default: {
                const hasRights = this._access !== null && this._access.rights.some(({id, usable}) => usable && id !== HIDDEN_RIGHT_ID);
                return hasRights ? [] : [translate('settings.keyAccessNoRights')];
            }
        }
    }

    /**
     * @returns {(Node|string)[]}
     */
    _createErrorNodes() {
        const code = this._errorCode ?? '';
        const nodes = [createNode('span', 'danger-text', translate(ERROR_TEXT.get(code) ?? 'settings.keyAccessFailed'))];
        if (code === 'flib_key_expired') { nodes.push(createLink(translate('settings.keyAccessRenew'), FLIB_BUY_URL)); }
        if (code === 'flib_key_revoked') { nodes.push(createLink(FLIB_HELP_EMAIL, `mailto:${FLIB_HELP_EMAIL}`)); }
        if (this._access !== null) { nodes.push(createNode('span', '', translate('settings.keyAccessStale'))); }
        return nodes.flatMap((node, index) => (index === 0 ? [node] : [' ', node]));
    }
}
