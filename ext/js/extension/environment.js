/*
 * Copyright (C) 2023-2025  Yomitan Authors
 * Copyright (C) 2020-2022  Yomichan Authors
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

export class Environment {
    constructor() {
        /** @type {?import('environment').Info} */
        this._cachedEnvironmentInfo = null;
    }

    /**
     * @returns {Promise<void>}
     */
    async prepare() {
        this._cachedEnvironmentInfo = await this._loadEnvironmentInfo();
    }

    /**
     * @returns {import('environment').Info}
     * @throws {Error}
     */
    getInfo() {
        if (this._cachedEnvironmentInfo === null) { throw new Error('Not prepared'); }
        return this._cachedEnvironmentInfo;
    }

    /**
     * @returns {Promise<import('environment').Info>}
     */
    async _loadEnvironmentInfo() {
        const os = await this._getOperatingSystem();
        const browser = await this._getBrowser(os);

        return {
            browser,
            platform: {os},
        };
    }

    /**
     * @returns {Promise<import('environment').OperatingSystem>}
     */
    async _getOperatingSystem() {
        try {
            const {os} = await this._getPlatformInfo();
            if (typeof os === 'string') {
                return os;
            }
        } catch (e) {
            // NOP
        }
        return 'unknown';
    }

    /**
     * @returns {Promise<chrome.runtime.PlatformInfo>}
     */
    _getPlatformInfo() {
        return new Promise((resolve, reject) => {
            chrome.runtime.getPlatformInfo((result) => {
                const error = chrome.runtime.lastError;
                if (error) {
                    reject(error);
                } else {
                    resolve(result);
                }
            });
        });
    }

    /**
     * @param {import('environment').OperatingSystem} os
     * @returns {Promise<import('environment').Browser>}
     */
    async _getBrowser(os) {
        let extensionUrl = '';
        try {
            extensionUrl = chrome.runtime.getURL('/');
        } catch (e) {
            // NOP
        }
        return detectBrowser({
            extensionUrl,
            userAgent: typeof navigator.userAgent === 'string' ? navigator.userAgent : '',
            vendor: typeof navigator.vendor === 'string' ? navigator.vendor : '',
            hasBrowserGlobal: typeof browser !== 'undefined',
            os,
        });
    }
}

/**
 * @typedef {object} BrowserSignals
 * @property {string} extensionUrl `chrome.runtime.getURL('/')`, or '' when unavailable.
 * @property {string} userAgent
 * @property {string} vendor
 * @property {boolean} hasBrowserGlobal Whether a `browser` global exists.
 * @property {import('environment').OperatingSystem} os
 */

/**
 * Firefox by its user agent.
 * @param {string} userAgent
 * @returns {boolean}
 */
export function isFirefoxUserAgent(userAgent) {
    return /\bFirefox\/\d/.test(userAgent);
}

/**
 * ⚠️ A `browser` global no longer means Firefox: Chromium (148 at least) exposes one to
 * extension pages, which made Chrome report "firefox" (the welcome page then showed the
 * Firefox data-transmission modal, which swallowed every click). Firefox is recognised by its
 * moz-extension:// URL, or by its user agent when the URL is unavailable; Safari still needs
 * the `browser` global plus an Apple vendor.
 * @param {BrowserSignals} signals
 * @returns {import('environment').Browser}
 */
export function detectBrowser({extensionUrl, userAgent, vendor, hasBrowserGlobal, os}) {
    if (extensionUrl.startsWith('ms-browser-extension://')) { return 'edge-legacy'; }
    if (/\bEdge?\//.test(userAgent)) { return 'edge'; }
    if (extensionUrl.startsWith('moz-extension://') || isFirefoxUserAgent(userAgent)) {
        return os === 'android' ? 'firefox-mobile' : 'firefox';
    }
    if (hasBrowserGlobal && vendor.includes('Apple') && !userAgent.includes('CriOS') && !userAgent.includes('FxiOS')) {
        return 'safari';
    }
    return 'chrome';
}
