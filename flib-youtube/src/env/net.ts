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
// Network for the copied site. The build `define`s bare `fetch` -> __flibYtFetch and
// `navigator.sendBeacon` -> __flibYtSendBeacon over the whole bundle, layer code included, so this
// module never uses bare `fetch`: the real one arrives as the `realFetch` parameter.
//
// Rules (the background side, ext/js/background/flib-youtube-proxy.js, repeats and enforces them):
// - relative `/api/...` -> message to the background -> a real Response built from the answer;
// - `/api/telemetry/events` and sendBeacon -> 204 / true, nothing leaves the page;
// - body: string or null go as is; a Blob is read as text; any other body type (FormData, streams,
//   buffers...) is answered with 400 here, without a message (the site only sends JSON strings);
// - everything else (absolute URLs, protocol-relative) -> realFetch untouched;
// - AbortSignal: abort before the answer rejects with AbortError; the background call is not cancelled;
// - status 0 from the background (or a failed send) = network error -> TypeError, like real fetch.

export type ProxyRequest = {
    action: 'flibYoutubeFetch';
    path: string;
    method: string;
    headers: Record<string, string>;
    body: string | null;
};

export type ProxyResponse = {
    status: number;
    statusText: string;
    headers: Array<[string, string]>;
    body: string;
};

const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

function isProxied(url: string): boolean {
    return url.startsWith('/api/');
}

function pathnameOf(url: string): string {
    return url.split(/[?#]/, 1)[0];
}

function abortError(): DOMException {
    return new DOMException('The operation was aborted.', 'AbortError');
}

function emptyResponse(status: number, statusText: string): Response {
    return new Response(null, {status, statusText});
}

function headersToRecord(init: HeadersInit | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    new Headers(init).forEach((value, key) => { out[key] = value; });
    return out;
}

export function createFlibFetch(
    send: (msg: ProxyRequest) => Promise<ProxyResponse>,
    realFetch: typeof fetch,
): typeof fetch {
    return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = typeof input === 'string' ? input : null;
        if (url === null || !isProxied(url)) {
            return realFetch(input, init);
        }
        const signal = init?.signal ?? null;
        if (signal?.aborted) { throw abortError(); }
        if (pathnameOf(url) === '/api/telemetry/events') {
            return emptyResponse(204, 'No Content');
        }
        const rawBody = init?.body;
        let body: string | null;
        if (rawBody === undefined || rawBody === null) {
            body = null;
        } else if (typeof rawBody === 'string') {
            body = rawBody;
        } else if (rawBody instanceof Blob) {
            body = await rawBody.text();
        } else {
            return emptyResponse(400, 'Bad Request');
        }
        const msg: ProxyRequest = {
            action: 'flibYoutubeFetch',
            path: url,
            method: (init?.method ?? 'GET').toUpperCase(),
            headers: headersToRecord(init?.headers),
            body,
        };
        const pending = send(msg);
        const answer = await new Promise<ProxyResponse>((resolve, reject) => {
            const onAbort = () => { reject(abortError()); };
            signal?.addEventListener('abort', onAbort, {once: true});
            pending.then(
                (value) => { signal?.removeEventListener('abort', onAbort); resolve(value); },
                () => { signal?.removeEventListener('abort', onAbort); reject(new TypeError('Failed to fetch')); },
            );
        });
        if (!answer || answer.status < 200 || answer.status > 599) {
            throw new TypeError('Failed to fetch');
        }
        return new Response(NULL_BODY_STATUSES.has(answer.status) ? null : answer.body, {
            status: answer.status,
            statusText: answer.statusText,
            headers: answer.headers,
        });
    };
}

export function createFlibSendBeacon(): (url: string | URL, data?: BodyInit | null) => boolean {
    return () => true;
}
