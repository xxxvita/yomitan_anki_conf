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

type CanAddNote = {canAdd: true};

type CannotAddNote = {canAdd: false, error: string};

export type CanAddResult = CanAddNote | CannotAddNote;

export type NetworkFailureResult = {
    /** Server now in use after re-resolving the route. */
    server: string;
    /** User-facing text for a non-retried call after a switch; null keeps the original message. */
    switchedMessage: string | null;
};

/**
 * Re-resolves the Anki route after a network-level failure on `failedServer`
 * (null when unknown).
 */
export type NetworkFailureHandler = (failedServer: string, action: string) => Promise<NetworkFailureResult | null>;

/** What a client and its `withoutFallback()` view share. */
export type ClientSettings = {
    enabled: boolean;
    server: string | null;
    apiKey: string | null;
    networkFailureHandler: NetworkFailureHandler | null;
    /** One per client: forgets the remote version that it checked. */
    onServerChange: (() => void)[];
};

/** What makes a view of a client. */
export type ViewDetails = {
    pinnedServer?: string | null;
    signal?: AbortSignal | null;
    /** The version check of the view that this one is made from. */
    checkedVersion?: {remote: number} | null;
    /** Without `X-Anki-No-Fallback`: Core with Anki closed may answer. */
    fallbackAllowed?: boolean;
};

/** Both sides of every card template of a note type, by template name. */
export type ModelTemplates = Record<string, {Front: string, Back: string}>;
