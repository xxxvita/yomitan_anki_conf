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
// Names the layer puts into YouTube's page. dev/build-flib-youtube.js scopes the copy's CSS to the
// same two ids (SCOPE / PORTAL there); chrome.storage keys of the copy carry the prefix.
export const CONTAINER_ID = 'flib-yt-root';
export const PORTALS_ID = 'flib-yt-portals';
export const STORAGE_PREFIX = 'flibYt:';
