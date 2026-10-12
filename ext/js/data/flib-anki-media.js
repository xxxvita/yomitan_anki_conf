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

/*
 * Gateway film clips stored in Anki (docs/gateway-clips-to-anki-spec.md):
 * the note field that holds them and the checks the backend applies before
 * `storeMediaFile`. Pure: shared by the backend (T2) and the display (T3).
 */

/** Field of "Yomitan Card Type" that holds the clips/links HTML; appended by the bootstrap. */
export const FLIB_MEDIA_FIELD_NAME = 'flib_media';

/** `flib-<sha256 hex>.webm` — nothing else may be written into the media folder by this API. */
export const FLIB_MEDIA_FILE_NAME_PATTERN = /^flib-[0-9a-f]{64}\.webm$/;

/** 20 MB of base64 characters (≈ 15 MB of WebM). */
export const FLIB_MEDIA_MAX_BASE64_LENGTH = 20 * 1024 * 1024;

/** Standard base64, padded: groups of 4, at most two `=` at the very end. */
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Why `flibStoreAnkiMedia` must refuse these arguments, or null when they are acceptable.
 * @param {unknown} fileName
 * @param {unknown} base64
 * @returns {?('flib_media_bad_name'|'flib_media_bad_data'|'flib_media_too_large')}
 */
export function getFlibAnkiMediaErrorCode(fileName, base64) {
    if (typeof fileName !== 'string' || !FLIB_MEDIA_FILE_NAME_PATTERN.test(fileName)) { return 'flib_media_bad_name'; }
    if (typeof base64 !== 'string' || base64.length === 0) { return 'flib_media_bad_data'; }
    // Size first: never run the pattern over an oversized string.
    if (base64.length > FLIB_MEDIA_MAX_BASE64_LENGTH) { return 'flib_media_too_large'; }
    if (base64.length % 4 !== 0 || !BASE64_PATTERN.test(base64)) { return 'flib_media_bad_data'; }
    return null;
}
