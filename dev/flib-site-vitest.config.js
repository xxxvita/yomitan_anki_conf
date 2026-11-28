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

/*
 * Wrapper around vendor/flib-site/web/vitest.config.ts, which is a verbatim copy and must not
 * be edited. The copied config is used unchanged; the only addition is that vite/vitest caches
 * go to FLIB_SITE_CACHE_DIR instead of vendor/flib-site/web/node_modules.
 */

import {mergeConfig} from 'vitest/config';
// @ts-expect-error - the copied config is TypeScript; the dev project does not import .ts
import siteConfig from '../vendor/flib-site/web/vitest.config.ts';

export default mergeConfig(siteConfig, {cacheDir: process.env.FLIB_SITE_CACHE_DIR});
