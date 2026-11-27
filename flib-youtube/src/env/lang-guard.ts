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
// <html lang> belongs to YouTube. The copied player/i18n.ts writes `document.documentElement.lang`
// at import and on every setLocale() (i18n.ts:226,246). The guard watches the attribute and puts
// YouTube's value back after each write of the copy; a change by YouTube itself is remembered and
// kept.
//
// Telling the two apart: the copy only ever writes its current locale. A new value equal to
// `isOurs(value)` (the layer passes "equals the copy's getLocale()") is the copy's write; anything
// else is YouTube's. Known limit: YouTube switching its own lang to exactly the copy's locale
// ('ru'/'en') at the same time is taken for the copy's write and reverted once.

export type LangGuardOptions = {
    /** YouTube's value, read before the copy was evaluated (null: no attribute). */
    initial: string | null,
    isOurs: (value: string | null) => boolean,
};

/**
 * @returns Stops the guard.
 */
export function installLangGuard(doc: Document, {initial, isOurs}: LangGuardOptions): () => void {
    const html = doc.documentElement;
    let youtube = initial;
    const check = () => {
        const value = html.getAttribute('lang');
        if (value === youtube) { return; }
        if (!isOurs(value)) {
            youtube = value;
            return;
        }
        if (youtube === null) {
            html.removeAttribute('lang');
        } else {
            html.setAttribute('lang', youtube);
        }
    };
    const view = doc.defaultView;
    if (view === null) { return () => { /* no window: nothing to guard */ }; }
    const observer = new view.MutationObserver(check);
    observer.observe(html, {attributes: true, attributeFilter: ['lang']});
    // The copy's import-time write happened before the guard existed.
    check();
    return () => { observer.disconnect(); };
}
