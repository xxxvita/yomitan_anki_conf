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

/** A film clip already stored in Anki media, as it goes into the `flib_media` field. */
export type FlibMediaFieldFilm = {
    /** `flib-<sha256>.webm`; anything else drops the clip. */
    fileName: string;
    /** Window-relative WebVTT with `<c.hl>` cues; ''/null/header-only → no `<track>`. */
    vttText: string | null;
    title: string | null;
    year: number | null;
    /** Only `https://www.imdb.com/title/tt<digits>/?` becomes a link. */
    imdbUrl: string | null;
};

/** A YouTube example saved as a watch link. */
export type FlibMediaFieldYouTube = {
    ref: string;
    startMs: number | null;
    text: string | null;
    /** Highlight forms (see example-highlight-forms.js); found forms go into `<b>`. */
    words: string[];
};
