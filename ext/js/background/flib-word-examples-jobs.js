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

import {createFlibError} from '../comm/flib-gateway-client.js';

/*
 * Задания word_examples, которые страница опрашивает, а не ждёт одним
 * сообщением.
 *
 * ⚠️ Зачем: одно сообщение держало ответ до конца бюджета задания (минуты),
 * упираясь в лимит события MV3 (5 мин). Здесь start возвращается сразу, а
 * каждый poll — короткое событие, которое ещё и продлевает жизнь воркера.
 * Если воркер всё-таки перезапустился, реестр пуст и poll отвечает
 * flib_job_not_found — страница показывает «повторите», а не висит.
 *
 * ⚠️ Брошенные задания (панель закрыли, popup исчез) не опрашиваются —
 * через abandonMs они отменяются, чтобы не жечь квоту шлюза.
 */

const DEFAULT_BUDGET_MS = 240000;
const DEFAULT_ABANDON_MS = 30000;
const DEFAULT_MAX_JOBS = 4;

/**
 * @typedef {object} JobEntry
 * @property {AbortController} controller
 * @property {?string} phase
 * @property {'running'|'done'|'failed'} state
 * @property {?import('flib-gateway').WordExamplesResult} result
 * @property {unknown} error
 * @property {number} lastSeenAt
 */

/**
 * @typedef {object} JobsDetails
 * @property {(words: string[], options: import('flib-gateway').WordExamplesJobOptions) => Promise<import('flib-gateway').WordExamplesResult>} run
 * @property {() => number} [now]
 * @property {number} [budgetMs]
 * @property {number} [abandonMs]
 * @property {number} [maxJobs]
 */

export class FlibWordExamplesJobs {
    /**
     * @param {JobsDetails} details
     */
    constructor({run, now, budgetMs, abandonMs, maxJobs}) {
        /** @type {JobsDetails['run']} */
        this._run = run;
        /** @type {() => number} */
        this._now = now ?? (() => Date.now());
        /** @type {number} */
        this._budgetMs = budgetMs ?? DEFAULT_BUDGET_MS;
        /** @type {number} */
        this._abandonMs = abandonMs ?? DEFAULT_ABANDON_MS;
        /** @type {number} */
        this._maxJobs = maxJobs ?? DEFAULT_MAX_JOBS;
        /** @type {Map<string, JobEntry>} */
        this._jobs = new Map();
        /** @type {number} */
        this._nextId = 1;
        /** @type {?ReturnType<typeof setInterval>} */
        this._sweepTimer = null;
    }

    /**
     * @param {string[]} words
     * @param {number} perWord
     * @returns {string}
     * @throws {Error} flib_too_many_jobs
     */
    start(words, perWord) {
        this._sweep();
        let running = 0;
        for (const job of this._jobs.values()) {
            if (job.state === 'running') { ++running; }
        }
        if (running >= this._maxJobs) { throw createFlibError('flib_too_many_jobs'); }

        const id = `wej-${this._nextId++}-${Math.floor(Math.random() * 1e9).toString(36)}`;
        /** @type {JobEntry} */
        const job = {
            controller: new AbortController(),
            phase: null,
            state: 'running',
            result: null,
            error: null,
            lastSeenAt: this._now(),
        };
        this._jobs.set(id, job);
        this._ensureSweepTimer();
        /** @type {Promise<import('flib-gateway').WordExamplesResult>} */
        let promise;
        try {
            promise = this._run(words, {
                perWord,
                budgetMs: this._budgetMs,
                signal: job.controller.signal,
                onPhase: (phase) => { job.phase = phase; },
            });
        } catch (e) {
            promise = Promise.reject(e);
        }
        promise.then(
            (result) => {
                job.state = 'done';
                job.result = result;
            },
            (error) => {
                job.state = 'failed';
                job.error = error;
            },
        );
        return id;
    }

    /**
     * Готовый результат или ошибка отдаются ОДИН раз и запись удаляется.
     * @param {string} id
     * @returns {import('flib-gateway-examples').WordExamplesPollResult}
     * @throws {unknown} ошибка задания или flib_job_not_found
     */
    poll(id) {
        // ⚠️ Сначала отметить опрос, потом чистить: иначе опрашивающий, чьи
        // таймеры придушил фон (>abandonMs), потерял бы СВОЁ задание.
        const job = this._jobs.get(id);
        if (typeof job !== 'undefined') { job.lastSeenAt = this._now(); }
        this._sweep();
        if (typeof job === 'undefined') { throw createFlibError('flib_job_not_found'); }
        switch (job.state) {
            case 'done':
                this._jobs.delete(id);
                return {done: true, result: /** @type {import('flib-gateway').WordExamplesResult} */ (job.result)};
            case 'failed':
                this._jobs.delete(id);
                throw job.error;
            default:
                return {done: false, phase: job.phase};
        }
    }

    /**
     * @param {string} id
     * @returns {boolean} false — задания нет (уже кончилось или не было).
     */
    cancel(id) {
        const job = this._jobs.get(id);
        if (typeof job === 'undefined') { return false; }
        this._jobs.delete(id);
        job.controller.abort();
        return true;
    }

    /** Отменяет и забывает задания, которые давно никто не опрашивал. */
    _sweep() {
        const now = this._now();
        for (const [id, job] of this._jobs) {
            if (now - job.lastSeenAt <= this._abandonMs) { continue; }
            this._jobs.delete(id);
            if (job.state === 'running') { job.controller.abort(); }
        }
        if (this._jobs.size === 0 && this._sweepTimer !== null) {
            clearInterval(this._sweepTimer);
            this._sweepTimer = null;
        }
    }

    /**
     * ⚠️ Без таймера брошенное задание (вкладку закрыли без cancel) жило бы до
     * следующего start/poll — то есть, возможно, весь бюджет, сжигая квоту.
     */
    _ensureSweepTimer() {
        if (this._sweepTimer !== null) { return; }
        this._sweepTimer = setInterval(() => { this._sweep(); }, this._abandonMs);
    }
}
