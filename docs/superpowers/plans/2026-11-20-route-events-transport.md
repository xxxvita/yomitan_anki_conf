# Route Events Transport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send `hint_requested` and `translation_opened` events from Flib-club route player pages to the gateway
(`POST /v1/route/external-events`), via a durable local outbox, with dedup, caps, pause and backoff.

**Architecture:**

- The popup records an event through the existing `flibRecordEvent` API.
- The service worker checks that the tab is a route player page (`/player?…&rp=`), builds an outbox record and stores
  it in IndexedDB `flib-events` v2 with a 12 h dedup.
- It then kicks a single-flight sender. The sender fetches a fresh `route_id`, posts batches of up to 50 and applies a
  fixed response table.

**Tech Stack:** Plain ES modules with JSDoc (strict checkJs), vitest + jsdom + fake-indexeddb, the existing `Database`
wrapper, and `FlibGatewayClient`.

**Spec:** `docs/superpowers/specs/2026-11-20-route-events-transport-design.md` (Russian, owner-approved). The server
contract is in its "Контракт сервера" section. Ground truth is gateway `turmalin_getaway` origin/main
`internal/routestate/events.go` (ValidateEvent) and `internal/server/route_state_handler.go`
(read with `git -C /home/xxxvita/Work/English/services/turmalin_getaway show origin/main:<path>`).

## Global Constraints

- NO `Co-Authored-By:` trailer and no other trailers in any commit (owner rule).
- GPL-3.0-or-later header on every new JS file. Russian string literals only in `ext/js/i18n/messages-*.js`. The
  literals `flib.club` and `flibooster.ru` only in `ext/js/data/flib-host.js` (invariant A25).
- Wire event fields are ONLY `event_id`, `type`, `puzzle_id`, `lemmas`, `subs_source`, `client_ts`. Never url, host,
  title or schema_version. On the wire `client_ts` is an RFC 3339 string (`new Date(ms).toISOString()`); in the
  outbox it is a number in ms.
- `event_id` = `ext:yomitan:<uuidv4 lowercase>`, matching `^[A-Za-z0-9._:-]{1,128}$`. Types are only
  `hint_requested` and `translation_opened`. `lemmas` is non-empty and lowercase. `subs_source` = `"yomitan_web"`.
- Route page = host flib.club or flibooster.ru (or a subdomain), path `/player`, non-empty `rp` query param.
  `puzzle_id` = `URLSearchParams.get('rp')`, decoded and otherwise unchanged.
- Dedup key `puzzle_id\0type\0lemma`, TTL 12 h (43 200 000 ms). Outbox cap 300 records, max age 7 days
  (604 800 000 ms). Batch size 50.
- Pause record in `chrome.storage.local` under `flibEventsPause` = `{until: number, keyFingerprint: string}`.
  The fingerprint is the first 16 hex chars of SHA-256(key). The key itself is never stored.
- Pauses and backoff (amended after plan review; Task 4's amendment table is authoritative):
  - `404` (any code): 1 h pause. `409 route_not_started` and `route_id === null`: 10 min pause.
  - `429`: `Retry-After` seconds (clamped 1..3600), else 60 s.
  - 5xx, network, timeout and unexpected 4xx: backoff 30 s, doubling, capped at 30 min.
  - `401`: pause until the key changes. `403`: 6 h pause for the same key.
- `route_id` is cached in sender memory for 10 min; refreshed from a stale 409.
- Nested popups (`display.depth > 0`) never record events.
- No new manifest permissions.
- vitest runs with `--exclude '.claude/**' --exclude 'node_modules/**' --exclude 'test/playwright/**'`. Run
  `test:ts:main`, `test:ts:dev` and `test:ts:test` separately.

## Review Focus

1. **A popup on a NON-route page** (any site, flib.club home, `/player` without `rp`) must produce no record and no
   network request. Owned by Task 1 (URL parser) and Task 5 (backend gate).
2. **The service worker dies mid-flush.** Records stay in the outbox (deletion happens only after a response), and the
   next start sends them again with the SAME `event_id`. Owned by Tasks 2 and 4.
3. **The user changes the key while paused for `401`.** The new key sends at once. Owned by Task 4.
4. **The same word hovered 10 times in one video** gives one `hint_requested`. A different video, or 12 h later, gives
   a new one. Owned by Task 2.
5. **A server answer with `rejected` entries** removes exactly those ids and keeps nothing stuck. Owned by Task 4.

---

### Task 1: Hosts, route-page parser, event envelope v2

**Files:**

- Modify: `ext/js/data/flib-host.js`, `ext/js/data/flib-event-envelope.js`, `types/ext/flib-events.d.ts`
- Test: `test/flib-host.test.js`, `test/flib-event-envelope.test.js`

**Interfaces (Produces):**

- `isFlibHost(url)` also accepts `flibooster.ru` and its subdomains (trailing-dot rule as today).
- `parseRoutePuzzleId(url: string): ?string` in `flib-host.js`. It returns the decoded `rp` when the host is a flib
  host, `pathname === '/player'` (a trailing `/` is allowed) and `rp` is non-empty after trim; otherwise null. It
  never throws.
- `flib-event-envelope.js`:
  - `FlibEventType = 'hint_requested' | 'translation_opened'`; `isFlibEventType(value)`.
  - `FLIB_ROUTE_EVENT_ID_PREFIX = 'ext:yomitan:'`, `FLIB_SUBS_SOURCE = 'yomitan_web'`.
  - `buildOutboxRecord({type, lemmas, puzzleId, now, uuid}): ?FlibOutboxRecord`:
    - `event_id = prefix + uuid.toLowerCase()`, `client_ts = created_at = now`;
    - lemmas go through the existing `normalizeLemmas`;
    - returns null for an unknown type, empty lemmas, an empty `puzzleId`, a `puzzleId` with control characters
      (`/[\u0000-\u001f\u007f]/`), or an `event_id` that fails `^[A-Za-z0-9._:-]{1,128}$`.
  - `outboxDedupKey(puzzleId, type, lemma): string` → `` `${puzzleId}\0${type}\0${lemma}` ``.
  - `toWireEvent(record): {event_id, type, puzzle_id, lemmas, subs_source, client_ts}`.
  - REMOVE `buildEvent`, `dedupKey`, `stripUrlFragment` and `FLIB_EVENT_SCHEMA_VERSION` once their last users go
    (Tasks 2 and 5). In this task, keep them exported so the tree stays green.
- `types/ext/flib-events.d.ts`: `FlibOutboxRecord = {event_id: string, type: FlibEventType, puzzle_id: string,
lemmas: string[], client_ts: number, created_at: number}` and `FlibWireEvent`. Keep the old `FlibEvent` type until
  Task 5 removes its users.

- [ ] **Step 1: Failing tests.**
  - `isFlibHost`: true for `https://flibooster.ru/x`, `https://www.flibooster.ru/x` and `https://flibooster.ru./x`;
    false for `https://notflibooster.ru/` and `https://flibooster.ru.evil.com/`.
  - `parseRoutePuzzleId`:
    - `https://flib.club/player?v=abc&rp=youtube%3A%3AdQw4w9WgXcQ` → `'youtube::dQw4w9WgXcQ'`;
    - flibooster.ru → same;
    - `/player/` → ok;
    - `/player?v=abc` → null; `/player?rp=` and `/player?rp=%20` → null; `/watch?rp=x` → null;
    - `https://example.com/player?rp=x` → null; `'not a url'` → null.
  - `buildOutboxRecord`:
    - a valid input gives exact fields;
    - `'Give Up'` → lemmas `['give up']`;
    - unknown type, `[]` lemmas, `puzzleId '\u0001'` and `puzzleId ''` → null;
    - `uuid 'ABC'` → `event_id 'ext:yomitan:abc'`.
  - `toWireEvent`: keys exactly `event_id, type, puzzle_id, lemmas, subs_source, client_ts`, and
    `subs_source === 'yomitan_web'`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the two test files plus `test:ts:main` and `test:ts:test` → PASS.
- [ ] **Step 5:** Commit `feat(events): route player detection and the external event envelope`.

**Amendments after the independent plan review (2026-11-20, binding; they override the text above where they conflict):**

- **C1 `client_ts`:** the gateway parses `client_ts` as an RFC 3339 STRING (`events.go` envelopeTS → `time.Parse(time.RFC3339Nano)`) and silently drops a number. Keep `client_ts` in ms in the outbox record; `toWireEvent` emits `client_ts: new Date(record.client_ts).toISOString()`. Test: the wire value matches `/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/`.
- **H1 types:** do NOT narrow the existing `FlibEventType` in this task (it is `flibRecordEvent`'s param type, and display-anki still passes `word_added_to_dict`). Add NEW `FlibRouteEventType = 'hint_requested' | 'translation_opened'` and `isFlibRouteEventType(value)`; `buildOutboxRecord` uses them. Leave the old type, `isFlibEventType`, `buildEvent` etc. untouched; Task 5 deletes the old ones.
- **M1 `puzzle_id`:** reject `/[\u0000-\u001f\u007f-\u009f]/` (C0 + DEL + C1) and values over 512 UTF-8 bytes (`new TextEncoder().encode(p).length > 512`), mirroring the gateway's ValidPuzzleID (types.go:219-229). Tests for both (incl. exactly 512 bytes → ok).

---

### Task 2: Outbox database v2

**Files:**

- Modify: `ext/js/data/flib-events-database.js`
- Test: `test/flib-events-database.test.js` (rewrite to the new API; keep the fake-indexeddb setup and `rawConnection`
  helper style)

**Interfaces (Produces):** `FlibEventsDatabase`

- `FLIB_EVENTS_DB_VERSION = 2`.
- `FLIB_OUTBOX_MAX_RECORDS = 300`, `FLIB_OUTBOX_MAX_AGE_MS = 604800000`, `FLIB_DEDUP_TTL_MS = 43200000`.
- `constructor({maxRecords?, maxAgeMs?, dedupTtlMs?})`.
- `prepare()`:
  - version 1 = the old stores (kept in the version list so the upgrade path exists);
  - version 2 deletes stores `events` and `dedup`, then creates `outbox` (keyPath `event_id`, index `created_at`)
    and `dedup` (keyPath `key`, index `ts`).
  - Check how `ext/js/data/database.js` `_upgrade` applies versions. If it cannot delete a store, add the minimal
    support there with a test.
- `isUsable` as today.
- `recordEvent(record: FlibOutboxRecord, now: number): Promise<boolean>`. One readwrite transaction over `outbox` +
  `dedup`:
  - delete dedup keys with `ts < now - dedupTtlMs`;
  - if ANY lemma's key `outboxDedupKey(puzzle_id, type, lemma)` exists → false, write nothing;
  - else add the keys (`ts = now`) and the record;
  - then delete outbox records with `created_at < now - maxAgeMs`;
  - then delete the oldest by `created_at` until count ≤ maxRecords, never the record just written;
  - resolve on transaction complete; reject with the real error on abort (do NOT use `transaction.onerror` with
    `transaction.error`: it is null during error bubbling; see the Task 2 lesson from the sentence cache).
- `listOutbox(limit: number): Promise<FlibOutboxRecord[]>` — oldest first by `created_at`.
- `deleteOutbox(eventIds: string[]): Promise<void>`.
- `countOutbox(): Promise<number>`.

- [ ] **Step 1: Failing tests** (use `vi.spyOn(Date, 'now')` or explicit `now`; never fake timers with fake-indexeddb).
  - record then list → the record;
  - same puzzle+type+lemma within 12 h → false and count 1;
  - after 12 h + 1 ms → true;
  - another puzzle → true;
  - another type → true;
  - a multi-lemma record is blocked if any lemma key exists;
  - cap: `maxRecords: 3`, 4 records → the oldest is gone and the newest is kept;
  - age: a record older than `maxAgeMs` is removed on the next write;
  - `deleteOutbox` removes only the given ids; `listOutbox(2)` returns the 2 oldest;
  - **upgrade:** pre-create DB `flib-events` v1 with the old stores and a row, open v2 → `outbox` empty, old store
    gone, no throw;
  - an abort gives a non-null rejection reason (unique-index trick as in `test/flib-sentence-cache.test.js`).
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implement. Rewrite the file's header comment: O-7 is revisited, the age and count caps now apply
      because a sender exists.
- [ ] **Step 4:** Tests + `test:ts:main` + `test:ts:test` → PASS. `backend.js` and `test/flib-record-event.test.js`
      may break on the old API: adapt them MINIMALLY so the tree stays green (Task 5 finishes the backend). Name each
      adaptation in the report.
- [ ] **Step 5:** Commit `feat(events): outbox store v2 with 12 h dedup and 300/7-day caps`.

**Amendments after the independent plan review (2026-11-20, binding; they override the text above where they conflict):**

- **M4 dedup lifetime:** dedup keys are removed ONLY by TTL. `deleteOutbox` and the caps never touch `dedup` (do NOT port the old orphan-key sweep from `_rotate`). Test: record → `deleteOutbox([id])` → record the same triple within 12 h → false.
- **L1 store deletion:** `ext/js/data/database.js` `_upgrade` can only create stores. Add `deleteStores?: string[]` to `StructureDefinition` (`types/ext/database.d.ts`), applied BEFORE `stores` in the same version entry and guarded by `db.objectStoreNames.contains`, with a unit test in the database tests. Version 2 = `{version: 2, deleteStores: ['events', 'dedup'], stores: {outbox…, dedup…}}`; the version-1 entry is not needed (the upgrade runs for `oldVersion < 2`). Add `ext/js/data/database.js` and `types/ext/database.d.ts` to this task's files.

---

### Task 3: Gateway client calls

**Files:**

- Modify: `ext/js/comm/flib-gateway-client.js`, `types/ext/flib-gateway.d.ts`
- Test: `test/flib-gateway-client.test.js`

**Interfaces (Produces):**

- `getRouteId({signal}?): Promise<?string>`:
  - `GET /v1/route/state` with no query;
  - returns `body.route_id` when it is a string matching the uuid shape, `null` when `route_id` is null or absent;
  - errors go through the existing mapping (`flib_key_missing` / `flib_key_invalid` / `flib_forbidden` /
    `flib_rate_limited` / `flib_http_error` / `flib_network` / `flib_timeout`).
- `postExternalEvents(routeId: string, events: FlibWireEvent[], {signal}?): Promise<ExternalEventsResult>`. It never
  throws for HTTP statuses:
  - `{kind: 'ok', accepted: number, duplicates: number, rejectedIds: string[]}` on 200;
  - `{kind: 'http', status: number, error: ?string, routeId: ?string, retryAfterSec: ?number}` for any non-2xx.
    `error` comes from the body's `error` string. `routeId` comes from the body (409 `stale_route` puts it in
    `route_id`; read the exact place from the gateway `routeStateError` code). `retryAfterSec` comes from the
    `Retry-After` header (integer seconds).
  - It throws only `flib_key_missing` / `flib_key_invalid` (no or a malformed local key, before sending),
    `flib_network` and `flib_timeout`.
- Types: `ExternalEventsResult` in `types/ext/flib-gateway.d.ts`.

- [ ] **Step 1: Failing tests** with a fake fetch, in the style of the existing gateway-client tests.
  - `getRouteId` → the uuid, null, and 401 → `flib_key_invalid`.
  - `postExternalEvents`:
    - 200 with rejected → `rejectedIds`;
    - 409 `{"error":"stale_route","route_id":"<uuid>"}` → `routeId`;
    - 429 with `Retry-After: 7` → 7;
    - 404 `feature_disabled`;
    - 413;
    - 500;
    - a network failure → throws `flib_network`;
    - the request body is exactly `{"route_id": …, "events": […]}`, with the `Authorization: Bearer` header.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implement. Reuse `_send` and the response-JSON helpers; do not duplicate key handling.
- [ ] **Step 4:** Tests + tsc → PASS.
- [ ] **Step 5:** Commit `feat(events): gateway client for route_id and external events`.

**Amendments after the independent plan review (2026-11-20, binding; they override the text above where they conflict):**

- **H2 raw responses:** `_send` throws on `!response.ok` and `_createHttpError` consumes the body. Split `_send` into `_fetchWithKey(method, path, options) → {response, timeout}` (key, signal, fetch, transport errors; NO status check) and keep `_send` = `_fetchWithKey` + the existing status check (behaviour unchanged for all current callers). `postExternalEvents` uses `_fetchWithKey` and parses the body for every status.
- **Error field:** the gateway sends `{error, code}`; for some answers `error` is a human sentence (403 from routeAuthKey: `error` = "route_forbidden: …", `code` = `route_forbidden`). The result's `error` field = `body.code` if it is a string, else `body.error`. Rename nothing else.
- **M2 fixtures:** a disabled route axis answers `404 {"error":"not_found","code":"not_found"}` (not `feature_disabled`); use that fixture.
- **L3:** `getRouteId` with a present but non-uuid `route_id` → throw `flib_bad_response`. `postExternalEvents` with a 200 whose body is not JSON → `{kind: 'http', status: 200, error: 'bad_response', routeId: null, retryAfterSec: null}` (the sender keeps and backs off). Clamp `retryAfterSec` to [1, 3600].

---

### Task 4: Sender

**Files:**

- Create: `ext/js/background/flib-events-sender.js`
- Test: `test/flib-events-sender.test.js`

**Interfaces:**

- Consumes:
  - Task 2: `listOutbox`, `deleteOutbox`;
  - Task 3: `getRouteId`, `postExternalEvents`;
  - Task 1: `toWireEvent`.
- Produces: `class FlibEventsSender`.
  - `constructor({getDatabase: () => Promise<FlibEventsDatabase>, gateway: Pick<FlibGatewayClient,
'getRouteId'|'postExternalEvents'>, getKey: () => Promise<string>, storage: {get(key), set(obj)}, now: () =>
number, setTimer: (fn, ms) => unknown, clearTimer: (handle) => void, log: {log, error}})`.
  - `flush(): Promise<void>`:
    - single flight: a call while one runs sets a "run again" flag instead of running in parallel;
    - never rejects: all errors are logged.
- Constants: `FLIB_EVENTS_BATCH = 50`, `FLIB_EVENTS_PAUSE_MS = 3600000`, `FLIB_EVENTS_BACKOFF_MIN_MS = 30000`,
  `FLIB_EVENTS_BACKOFF_MAX_MS = 1800000`, `FLIB_EVENTS_RATE_DEFAULT_MS = 60000`.

`flush` algorithm (spec §10-12):

1. Read and normalize the key (`normalizeFlibPersonalKey`); empty or invalid → return.
2. Fingerprint = SHA-256 hex prefix 16 (`crypto.subtle`).
3. A pause in storage with `keyFingerprint === fp && until > now()` → return. A pause for another fingerprint is
   ignored and cleared.
4. `listOutbox(50)`; empty → return.
5. `getRouteId()`:
   - null → 1 h pause;
   - `flib_key_invalid` / `flib_forbidden` → key pause;
   - other errors → backoff.
6. `postExternalEvents(routeId, records.map(toWireEvent))` and apply the table:
   - ok → delete accepted, duplicates and rejected ids. The response does not list accepted ids, so delete the whole
     sent batch on 200; log `rejected` reasons. Reset the backoff and loop to step 4.
   - 400 → delete the batch and log "our bug".
   - 401/403 → key pause (`until: Number.MAX_SAFE_INTEGER`), keep the batch.
   - 404 → 1 h pause, keep.
   - 409 `stale_route` with a `routeId` → retry the same batch ONCE with it. A second 409 → 1 h pause.
   - 409 `route_not_started` → 1 h pause, keep.
   - 413 → split in half and send each half (recursively, down to 1 event; a single-event 413 → delete it and log).
   - 429 → pause `retryAfterSec*1000` or 60 s, keep.
   - ≥500, `flib_network`, `flib_timeout` → keep; schedule `setTimer(flush, backoff)`, where backoff doubles from
     30 s to max 30 min (in memory).

- [ ] **Step 1: Failing tests** with fake db, gateway, storage and timer (no IndexedDB). One test per table row, plus:
  - single flight: two concurrent `flush()` calls → one `postExternalEvents` in flight, then a second run;
  - key change clears the pause (Review Focus 3);
  - no key → zero gateway calls;
  - a pause for the same key → zero calls;
  - 200 with `rejected` → those ids deleted and the batch fully deleted (Review Focus 5);
  - 120 records → three batches of 50, 50, 20 in order;
  - 5xx → `setTimer` called with 30000, then 60000 on the next failure; success resets it;
  - errors thrown by `getDatabase` → logged, no rejection.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Tests + tsc + eslint → PASS.
- [ ] **Step 5:** Commit `feat(events): outbox sender with pause, backoff and the response table`.

**Amendments after the independent plan review (2026-11-20, binding; they override the text above where they conflict):**

Replace the response table with this one (controller rulings on H3, M2, M2b, M3, L2):

| Result                                                                                                  | Action                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| ok (200)                                                                                                | delete the whole sent batch; log `rejected` reasons; reset backoff; next batch                                                            |
| http 400 with `error === 'bad_request'`                                                                 | delete the batch, log "our bug"                                                                                                           |
| http 413                                                                                                | delete the batch, log (a 50-event batch cannot exceed the 4 MiB body limit; per-event size errors come inside a 200) — NO split recursion |
| http 401                                                                                                | key pause (`until: Number.MAX_SAFE_INTEGER`, same fingerprint) — keep                                                                     |
| http 403                                                                                                | 6 h pause (21 600 000 ms), same fingerprint — keep (allow_route can come back on the same key after a purchase)                           |
| http 404 (any code)                                                                                     | 1 h pause — keep                                                                                                                          |
| http 409 `stale_route` with routeId                                                                     | update the cached route_id, retry the same batch ONCE; a second 409 → 10 min pause                                                        |
| http 409 `route_not_started`                                                                            | drop the cached route_id; 10 min pause — keep                                                                                             |
| http 429                                                                                                | pause `retryAfterSec*1000` (clamped) or 60 s — keep                                                                                       |
| any other 4xx (408, 411, 400 non-`bad_request`, 405, 499 …) and status 200 with `error: 'bad_response'` | keep; backoff                                                                                                                             |
| ≥500, `flib_network`, `flib_timeout`                                                                    | keep; backoff 30 s doubling to 30 min                                                                                                     |

- `getRouteId()` returning null → 10 min pause (not 1 h). `getRouteId` errors: `flib_key_invalid` → key pause; `flib_forbidden` → 6 h pause; others → backoff.
- **M3 route_id cache:** cache `route_id` in sender memory for 10 min (600 000 ms); refresh from `GET /v1/route/state` only when absent or expired; update from a stale 409; drop on `route_not_started`. (The state response can be MiBs; fetching it per event is wasteful.)
- **L5 single flight:** a `flush()` call while one runs sets ONE "run again" flag; after the run finishes, at most one extra run. Test: five concurrent calls → exactly two runs.
- Constants change: `FLIB_EVENTS_PAUSE_MS` → split into `FLIB_EVENTS_PAUSE_404_MS = 3600000`, `FLIB_EVENTS_PAUSE_403_MS = 21600000`, `FLIB_EVENTS_PAUSE_NO_ROUTE_MS = 600000`, `FLIB_EVENTS_ROUTE_ID_TTL_MS = 600000`.
- Update the tests to cover every row above (incl. 403 → 6 h then sends again after expiry with the same key; 400 non-bad_request → kept).

---

### Task 5: Backend wiring and recording

**Files:**

- Modify: `ext/js/background/backend.js`:
  - `_onApiFlibRecordEvent` ~1547;
  - the constructor (create the sender);
  - startup (kick a flush).
- Modify: `types/ext/api.d.ts` (the `flibRecordEvent` type param union), `ext/js/comm/api.js` if its JSDoc names
  types.
- Modify: `ext/js/display/display-anki.js` (remove the two `flibRecordEvent('word_added_to_dict', …)` calls ~1716,
  ~3065).
- Modify: `ext/js/data/flib-event-envelope.js`, `types/ext/flib-events.d.ts` (drop `buildEvent`, `dedupKey`,
  `stripUrlFragment`, `FLIB_EVENT_SCHEMA_VERSION` and `FlibEvent` if unused now).
- Test: `test/flib-record-event.test.js` (rewrite), plus any display-anki test asserting the removed call.

**Behaviour:**

- `_onApiFlibRecordEvent({type, lemmas}, sender)`:
  - resolves the tab URL as today (`pickSenderUrl`, then the `_getTabUrl` fallback);
  - `puzzleId = parseRoutePuzzleId(url)`; null → return false;
  - `buildOutboxRecord({type, lemmas, puzzleId, now: Date.now(), uuid: crypto.randomUUID()})`; null → false;
  - `database.recordEvent(record, now)`; true → `void this._flibEventsSender.flush()`;
  - returns the boolean;
  - DB errors are logged and return false (as today).
- The sender is created once in the constructor with:
  - `getDatabase: () => this._getFlibEventsDatabase()`;
  - `gateway: this._flibGateway`;
  - `getKey: async () => (await this._getFlibSecrets()).personalKey`;
  - `storage: chrome.storage.local` (promise API);
  - real timers and `log`.
- Kick one `flush()` after the backend finishes preparing (find the existing post-prepare hook; never block startup
  on it).

- [ ] **Step 1: Failing tests** (fake context in the style of `test/flib-pos-backend.test.js`).
  - a route URL plus a valid type → `recordEvent` called with a record whose `puzzle_id` comes from `rp`, and
    `flush` called;
  - a non-route flib URL → false, no `recordEvent`;
  - `example.com` → false;
  - a dedup false → no flush;
  - an unknown type `word_added_to_dict` → false;
  - a DB rejection → false, logged;
  - display-anki no longer calls `flibRecordEvent`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Focused tests + the FULL unit suite (paste EXIT) + tsc ×3 + eslint on changed files → PASS.
- [ ] **Step 5:** Commit `feat(events): record route-page events into the outbox and send them`.

**Amendments after the independent plan review (2026-11-20, binding; they override the text above where they conflict):**

- **H1 cleanup:** this task deletes the old `FlibEventType`/`isFlibEventType`/`buildEvent`/`dedupKey`/`stripUrlFragment`/`FLIB_EVENT_SCHEMA_VERSION`/`FlibEvent` and makes `flibRecordEvent`'s type param `FlibRouteEventType`.
- **M7 removed-event fallout:** rewrite `test/anki-add-event.test.js` (lines ~151-313, ~479-491) into a "never calls flibRecordEvent" check or delete the obsolete cases; change `test/display-anki-flib-media.test.js:258` to `expect(ctx.api.flibRecordEvent).not.toHaveBeenCalled()`; remove `pickAddedLemma` (display-translation.js ~59) and its import in display-anki.js ~44 plus its tests (~21-36 of anki-add-event.test.js) — it has no other reader. Add these files to the task.
- **M5 nested translation_opened (controller ruling, matches the spec non-goal "no events from nested popups"):** in `display-translation.js` `_revealCell`, call `flibRecordEvent` only when `this._display.depth === 0`. Test: depth 1 reveal → no call; depth 0 → one call. Add `ext/js/display/display-translation.js` and its test file to this task.

---

### Task 6: Popup `hint_requested` trigger

**Files:**

- Create: `ext/js/display/display-route-hint.js`
- Modify: `ext/js/display/popup-main.js` (construct and `prepare()` it next to `DisplayPosHint`)
- Test: `test/display-route-hint.test.js`

**Interfaces:** `class DisplayRouteHint`

- `constructor(display, {api})`.
- `prepare()` subscribes to `contentUpdateComplete`.

On each `contentUpdateComplete`, the trigger fires only when ALL of these hold:

- `display.depth === 0`;
- `parseRoutePuzzleId(display.getOptionsContext().url ?? '') !== null`;
- the selected entry (`dictionaryEntries[selectedIndex] ?? [0]`) is `type === 'term'`;
- `headwords[0].term` is non-empty after trim.

Then it calls `void api.flibRecordEvent('hint_requested', [term])` once per content update. A rejection is caught and
logged at level `log` (no badge). It never throws.

- [ ] **Step 1: Failing tests** with a FakeDisplay (copy the pattern from `test/display-pos-hint.test.js`).
  - a route URL plus a term entry → one call `('hint_requested', ['book'])`;
  - a non-route URL → zero calls;
  - depth 1 → zero calls;
  - no entries / a kanji entry → zero calls;
  - two updates → two calls (dedup is the backend's job);
  - an api rejection → no unhandled rejection.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implement and wire it.
- [ ] **Step 4:** Tests + tsc + eslint → PASS.
- [ ] **Step 5:** Commit `feat(events): popup reports hint_requested on route player pages`.

**Amendments after the independent plan review (2026-11-20, binding; they override the text above where they conflict):**

- **M6 frame check (do this FIRST, read-only):** find where the route player's subtitle text lives on flib.club `/player` by reading the site source (repo x2-2/flib.club; look for a local clone under /home/xxxvita/Work, e.g. `find /home/xxxvita/Work -maxdepth 3 -name PlayerPage.tsx`), not by hitting the live site. If the subtitles render in the TOP document, `display.getOptionsContext().url` is the route URL and the plan stands. If they render inside a cross-origin iframe, report DONE_WITH_CONCERNS with the evidence before implementing (the controller rules on a fallback). Record the finding in the report.

---

### Task 7: Docs, full suite, live check

**Files:**

- Modify: `PRIVACY.md`, `docs/AMO_SUBMISSION_NOTES.md`

- [ ] **Step 1: PRIVACY.** Add a section «Route events — `cache.flib.club` (the same Flib server)»:

  - **What is sent:** the route video id, the looked-up word in dictionary form, the event type (English definition
    shown or Russian translation opened), the event time and your key.
  - **When:** only on the route player page of flib.club / flibooster.ru.
  - **Why:** your route takes looked-up words into account.
  - **Local storage:** up to 300 unsent events, no older than 7 days; removed with the extension data.

  Update the "What is stored on your computer" list, "In short" and the Russian summary. Do not claim more than the
  code does.

- [ ] **Step 2: AMO notes.** Add the same facts to the listing data notes and the reviewer data notes.
- [ ] **Step 3: Full suite and tsc ×3; paste the EXIT codes.**
- [ ] **Step 4: Live check** in Playwright Chromium with the unpacked `ext/`. Reuse
      `/tmp/claude-1000/-home-xxxvita-Work-yomitan-phrases-src/a3b16ef6-2e96-439f-bacf-749838aab82a/scratchpad/task5/live.mjs`.
      Put new artifacts in `…/scratchpad/events-live/`.
  - **Setup:**
    - serve a local page at `https://flib.club/player?v=x&rp=youtube%3A%3Atest123` via `page.route` (fulfill
      locally; never hit the real site);
    - point the gateway URL at a stub on 127.0.0.1;
    - the stub implements `GET /v1/route/state` → `{"route_id":"<uuid>"}` and `POST /v1/route/external-events` →
      200 and logs bodies.
  - **Checks:**
    - (a) hover a word → the stub receives one batch with a `hint_requested` event: `puzzle_id 'youtube::test123'`,
      lemma lowercase, fields exactly the wire set;
    - (b) hover the same word again → no new event;
    - (c) reveal a blurred translation → a `translation_opened` event;
    - (d) the same page without `rp` → no request;
    - (e) the stub answers 500 once → the event is kept and resent with the same `event_id`.
  - Block every non-local host.
- [ ] **Step 5:** Commit `docs(privacy): route events sent from the route player page`.

**Amendments after the independent plan review (2026-11-20, binding; they override the text above where they conflict):**

- **L4:** the PRIVACY heading says «Route events — the Flib server» (the gateway URL is configurable), not `cache.flib.club`. Mention that an event is tied to the route video open in the tab at the moment of the event.
- **Live check addition:** (f) a reveal inside a nested popup on the route page → no event.
