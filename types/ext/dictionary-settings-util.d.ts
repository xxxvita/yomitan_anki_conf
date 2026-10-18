/*
 * Copyright (C) 2025  Yomitan Authors
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

import type * as Settings from './settings';

/** What an import asks the backend to do with the profiles' settings (applyDictionarySettingsReconcile). */
export type DictionarySettingsReconcile = {
    title: string;
    styles: string;
    /** `null`: a new dictionary. Otherwise the entry (and index) to restore per profile id. */
    preferred: {[profileId: string]: {entry: Settings.DictionaryOptions, index: number}} | null;
    /** Profiles whose default entry is enabled (the profile being edited on the importing page). */
    enabledProfileIds: string[];
    setMainDictionaryIfEmpty: boolean;
};
