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
// Types of the copied site modules that the layer uses. The copy in vendor/ keeps only the
// files the bundle needs at runtime (type-only modules are absent), so tsc cannot follow the
// real files; declare here exactly what layer code imports, and nothing more.
declare module 'flib-site/pages/PlayerPage' {
    import type {ComponentType} from 'react';
    export const PlayerPage: ComponentType;
}
