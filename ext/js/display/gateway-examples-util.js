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
 * Чистые помощники панели примеров шлюза Flib (YouTube + нарезки фильмов).
 * Без DOM и без сети — всё, что решает «что показать», живёт здесь и
 * покрыто тестами; панель только раскладывает результат по элементам.
 */

/** Сколько карточек YouTube показываем максимум. */
export const YOUTUBE_SECTION_MAX_ITEMS = 6;

/**
 * id ролика YouTube. ⚠️ Подставляется в адрес iframe/ссылки/картинки —
 * проверка обязательна перед ЛЮБЫМ построением адреса.
 */
const YOUTUBE_REF_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const IMDB_URL_PREFIX = 'https://www.imdb.com/title/';
const ERROR_CODE_SHAPE = /^[a-z][a-z0-9_]{0,63}$/;

/**
 * @param {unknown} ref
 * @returns {ref is string}
 */
export function isValidYouTubeRef(ref) {
    return typeof ref === 'string' && YOUTUBE_REF_PATTERN.test(ref);
}

/**
 * @param {?number} ms
 * @returns {number}
 */
function floorSeconds(ms) {
    return typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
}

/**
 * @param {string} ref
 * @param {?number} startMs
 * @param {?number} endMs
 * @returns {?string}
 */
export function buildYouTubeEmbedUrl(ref, startMs, endMs) {
    if (!isValidYouTubeRef(ref)) { return null; }
    const start = floorSeconds(startMs);
    let query = `start=${start}`;
    if (typeof endMs === 'number' && Number.isFinite(endMs)) {
        const end = Math.ceil(endMs / 1000);
        if (end > start) { query += `&end=${end}`; }
    }
    return `https://www.youtube-nocookie.com/embed/${ref}?${query}&autoplay=1&rel=0`;
}

/**
 * @param {string} ref
 * @param {?number} startMs
 * @returns {?string}
 */
export function buildYouTubeWatchUrl(ref, startMs) {
    if (!isValidYouTubeRef(ref)) { return null; }
    return `https://www.youtube.com/watch?v=${ref}&t=${floorSeconds(startMs)}s`;
}

/**
 * @param {string} ref
 * @returns {?string}
 */
export function buildYouTubeThumbUrl(ref) {
    if (!isValidYouTubeRef(ref)) { return null; }
    return `https://i.ytimg.com/vi/${ref}/mqdefault.jpg`;
}

/**
 * Только YouTube-элементы с корректным ref, не больше {@link YOUTUBE_SECTION_MAX_ITEMS}.
 * @param {import('flib-gateway').ExampleItem[]} items
 * @returns {import('flib-gateway').ExampleItem[]}
 */
export function sanitizeYouTubeItems(items) {
    if (!Array.isArray(items)) { return []; }
    return items
        .filter((item) => item !== null && typeof item === 'object' && item.source === 'youtube' && isValidYouTubeRef(item.ref))
        .slice(0, YOUTUBE_SECTION_MAX_ITEMS);
}

/**
 * @param {number} ms
 * @returns {string}
 */
function formatClock(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const ss = s < 10 ? `0${s}` : `${s}`;
    if (h > 0) { return `${h}:${m < 10 ? '0' : ''}${m}:${ss}`; }
    return `${m}:${ss}`;
}

/**
 * @param {?number} startMs
 * @param {?number} endMs
 * @returns {string} '' — времени нет.
 */
export function formatTimeRange(startMs, endMs) {
    const hasStart = typeof startMs === 'number' && Number.isFinite(startMs);
    const hasEnd = typeof endMs === 'number' && Number.isFinite(endMs);
    if (!hasStart) { return ''; }
    return hasEnd ? `${formatClock(startMs)}–${formatClock(/** @type {number} */ (endMs))}` : formatClock(startMs);
}

/**
 * Ссылка уходит в интерфейс кликабельной: только https://www.imdb.com/title/….
 * @param {unknown} url
 * @returns {url is string}
 */
export function isSafeImdbUrl(url) {
    return typeof url === 'string' && url.startsWith(IMDB_URL_PREFIX);
}

/**
 * «Название (год)», для сериала — «, сезон N, серия M». null — названия нет.
 * @param {import('flib-gateway').ClipSource | undefined} source
 * @returns {?string}
 */
export function formatSourceTitle(source) {
    if (typeof source !== 'object' || source === null) { return null; }
    const title = typeof source.title === 'string' && source.title.length > 0 ?
source.title :
        (typeof source.title_ru === 'string' && source.title_ru.length > 0 ? source.title_ru : null);
    if (title === null) { return null; }
    let text = typeof source.year === 'number' ? `${title} (${source.year})` : title;
    if (typeof source.season === 'number' && typeof source.episode === 'number') {
        text += `, сезон ${source.season}, серия ${source.episode}`;
    }
    return text;
}

/**
 * Окно воспроизведения внутри НЕобрезанного файла клипа.
 * Повторяет anki_conf npBuildTokenClips: head = max(0, lead_trim_sec),
 * keep = min(trim_duration_sec, duration_sec - head).
 * @param {{lead_trim_sec: ?number, duration_sec: ?number}} info
 * @param {?number} trimDurationSec
 * @returns {{start: number, end: ?number}} end null — до конца файла.
 */
export function computeClipWindow(info, trimDurationSec) {
    const lead = typeof info.lead_trim_sec === 'number' && Number.isFinite(info.lead_trim_sec) ? info.lead_trim_sec : 0;
    const start = Math.max(0, lead);
    const duration = typeof info.duration_sec === 'number' && Number.isFinite(info.duration_sec) && info.duration_sec > 0 ? info.duration_sec : null;
    /** @type {?number} */
    let end = typeof trimDurationSec === 'number' && Number.isFinite(trimDurationSec) && trimDurationSec > 0 ? start + trimDurationSec : duration;
    if (end !== null && duration !== null) { end = Math.min(end, duration); }
    if (end !== null && end <= start) { end = null; }
    return {start, end};
}

/**
 * Субтитры клипа → реплики во времени файла. `rel_*_ms` отсчитаны от начала
 * ОБРЕЗАННОГО клипа (anki_conf writeClipSRT пишет их к уже обрезанному mp4),
 * поэтому к ним прибавляется начало окна.
 * @param {import('flib-gateway').WordExampleSub[]} subs
 * @param {number} startSec
 * @returns {{start: number, end: number, text: string}[]}
 */
export function subsToCues(subs, startSec) {
    if (!Array.isArray(subs)) { return []; }
    /** @type {{start: number, end: number, text: string}[]} */
    const cues = [];
    for (const sub of subs) {
        if (typeof sub !== 'object' || sub === null) { continue; }
        const text = typeof sub.text === 'string' ? sub.text.trim() : '';
        if (text.length === 0 || sub.rel_end_ms <= sub.rel_start_ms) { continue; }
        cues.push({
            start: Math.round((startSec + sub.rel_start_ms / 1000) * 1000) / 1000,
            end: Math.round((startSec + sub.rel_end_ms / 1000) * 1000) / 1000,
            text,
        });
    }
    return cues;
}

/**
 * Код ошибки шлюза: `data.code` (переживает сообщения), иначе сообщение,
 * если оно само похоже на код.
 * @param {unknown} error
 * @returns {?string}
 */
export function getGatewayErrorCode(error) {
    if (!(error instanceof Error)) { return null; }
    const data = /** @type {{data?: unknown}} */ (error).data;
    if (typeof data === 'object' && data !== null) {
        const code = /** @type {{code?: unknown}} */ (data).code;
        if (typeof code === 'string' && code.length > 0) { return code; }
    }
    return ERROR_CODE_SHAPE.test(error.message) ? error.message : null;
}

/** @type {Readonly<Record<string, string>>} */
const ERROR_TEXT = Object.freeze({
    flib_key_missing: 'Не указан личный ключ (Настройки → Flib-club: сервер)',
    flib_key_invalid: 'Личный ключ не принят сервером — проверьте его в настройках',
    flib_forbidden: 'Ваш ключ не даёт доступа к примерам',
    examples_forbidden: 'Ваш ключ не даёт доступа к примерам',
    examples_quota_exhausted: 'Лимит примеров на сегодня исчерпан',
    flib_rate_limited: 'Слишком много запросов — подождите немного и повторите',
    flib_network: 'Нет связи с сервером Flib-club',
    flib_job_failed: 'Сервер не смог подобрать нарезки',
    flib_job_timeout: 'Сервер не успел подобрать нарезки — попробуйте позже',
    flib_job_not_found: 'Поиск нарезок прервался (расширение перезапустилось) — повторите',
    flib_too_many_jobs: 'Слишком много одновременных поисков — дождитесь, пока закончатся текущие',
    flib_clip_not_ready: 'Фрагмент ещё нарезается — попробуйте чуть позже',
    flib_clip_timeout: 'Фрагмент слишком долго нарезается — попробуйте позже',
    flib_clip_failed: 'Не удалось нарезать этот фрагмент',
    flib_clip_too_large: 'Фрагмент слишком большой для показа',
    flib_word_empty: 'Пустое слово — искать нечего',
    flib_word_too_long: 'Слишком длинный запрос для поиска примеров',
    flib_bad_response: 'Сервер прислал непонятный ответ',
});

/**
 * @param {?string} code
 * @param {'youtube'|'films'} section
 * @returns {string}
 */
export function describeGatewayError(code, section) {
    if (code === 'flib_service_unavailable') {
        return section === 'youtube' ?
            'Сервис примеров YouTube временно недоступен' :
            'Сервис нарезок временно недоступен (сервер подбора не в сети)';
    }
    if (typeof code === 'string') {
        if (Object.hasOwn(ERROR_TEXT, code)) { return ERROR_TEXT[code]; }
        if (code.startsWith('demo_')) { return 'Демо-доступ: лимит исчерпан или функция недоступна'; }
    }
    return section === 'youtube' ? 'Не удалось получить примеры YouTube' : 'Не удалось получить нарезки из фильмов';
}

/**
 * @param {?string} reason
 * @param {'youtube'|'films'} section
 * @returns {string}
 */
export function describeEmptyReason(reason, section) {
    switch (reason) {
        case 'not_in_corpus':
            return section === 'youtube' ? 'Этого слова нет в корпусе YouTube-примеров' : 'Этого слова нет в корпусе фильмов';
        case 'no_usable_examples':
            return 'Подходящих примеров не нашлось';
        case 'kind_not_served':
            return 'Этот вид примеров сервер пока не выдаёт';
        default:
            return 'Примеров не нашлось';
    }
}

/**
 * @param {string} base64
 * @param {string} contentType
 * @returns {Blob}
 */
export function base64ToBlob(base64, contentType) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; ++i) { bytes[i] = binary.charCodeAt(i); }
    return new Blob([bytes], {type: contentType});
}
