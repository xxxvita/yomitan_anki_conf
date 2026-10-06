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
 * core   — anki_conf Core отвечает на /api/v1/health; AnkiConnect-вызовы идут через него.
 * direct — Core не отвечает (или пользователь сам указал 8765), AnkiConnect жив.
 * none   — никто не ответил; ankiServer = исходный адрес, ошибки прежние.
 */
export type AnkiRouteMode = 'core' | 'direct' | 'none';

export type AnkiRoute = {
    mode: AnkiRouteMode;
    /** Куда слать AnkiConnect-протокол. */
    ankiServer: string;
    /** База anki_conf Core для Core-only функций; null — Core недоступен. */
    coreBase: string | null;
    /** Момент проверки (ms, часы резолвера). */
    checkedAt: number;
};
