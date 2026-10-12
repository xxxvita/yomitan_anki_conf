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

/**
 * Only the subset the clip transcoder needs (MP4 in, WebM out, Conversion with trim),
 * so esbuild can tree-shake the rest of the toolkit out of ext/lib/mediabunny.js.
 */
export {
    ALL_FORMATS,
    BlobSource,
    BufferSource,
    BufferTarget,
    Conversion,
    Input,
    Output,
    Quality,
    WebMOutputFormat,
} from 'mediabunny';
