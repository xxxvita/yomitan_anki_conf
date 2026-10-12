# HANDOFF 2026-10-12 (gateway examples, tpk\_ key, Anki two routes) — 4 owner goals done and live-verified on branch `feat/gateway-examples` (NOT merged, NOT pushed); next: owner decisions on saving clips into Anki

Role: orchestrator. I dispatch implementer / reviewer subagents (Opus) and never write production code myself.
Canon in play: P8 (spec + ≥5 edge cases shown to the owner BEFORE code → tests first → adversarial audit →
apply HIGH/CRIT inline, MED → task list), D1–D4 (recall rakes first; enumerate state by grep; a field with no
reader = hole; hand the reviewer the load-bearing claim verbatim). Owner's standing rule: an INDEPENDENT Opus
review after EVERY code commit, and re-review after every fix round. Talk to the owner in Russian; code,
commit messages and this file in English.

> Dictionary-pipeline topic (anki_conf data → extension dictionary pair) stays in
> `HANDOFF-2026-10-05-dictionary-pipeline.md`; its §2.A (swap the desktop app's `dict_base.db`) was DONE on
> 2026-10-05 (see memory 3032). This file covers only the gateway-examples work that followed.
> Ignore `docs/HANDOFF.md` (untracked, not ours).

---

## 0. TL;DR — where we are

The owner set a `/goal` with 4 items (verbatim intent): (1) a place in the extension settings to enter the
user's `tpk_` gateway key; (2) show YouTube example pieces; (3) film-clip examples fetched from the Turmalin
gateway DIRECTLY with that key, plus an IMDb link; (4) add to Anki two ways — through anki_conf Core
(`127.0.0.1:8777`) when it runs, otherwise directly through AnkiConnect (`127.0.0.1:8765`).
All 4 are implemented on branch `feat/gateway-examples` (HEAD `4c01b838`, 31 commits ahead of local `main`,
nothing pushed) and were verified LIVE in Chromium 148 with the owner's key. Afterwards three owner-reported
polish bugs were fixed (fullscreen video reset, no subtitles in fullscreen, inflected forms not highlighted).
Every commit passed an independent review (last rounds: 0 CRIT / 0 HIGH). Full unit suite: 4930 passed,
46 skipped (re-run 2026-10-12, VERIFIED). OPEN: the owner must decide how film clips get saved into Anki
cards (§2), whether to merge/push the branch, and three xyzet chores (§2.C).

---

## 1. Proven conclusions / decisions

### 1.1 Gateway facts the extension relies on (VERIFIED live 2026-10-07 with the owner's key unless noted)

- Key format `^tpk_[0-9a-f]{32}$` (gateway `internal/auth/keys.go:15`). Header `Authorization: Bearer <key>`.
  Rights are per-key booleans: `allow_examples` (YouTube examples), `allow_route` (film search job),
  `allow_puzzle_movies` (clips). `GET /v1/me/access` lists capabilities (now incl. `examples`, gateway PR #339).
- **YouTube examples**: `POST https://cache.flib.club/v1/examples {word, kind:"youtube", limit:1..10}` → sync,
  ~0.6–0.7 s, `items[{source:"youtube", ref:<11-char video id>, start_ms, end_ms, text_en, text_ru:null,
thumbnail_url:null}]`, `empty_reason ∈ not_in_corpus|no_usable_examples|kind_not_served|null`. Served by the
  subtitle daemon (`examples_by_word`, live since 2026-10-07 00:10, gateway main `1d5cd350`); it matches by
  LEMMA ("went" finds "go" lines). `kind=film` is NOT served here (always `kind_not_served`). Re-checked
  2026-10-12: HTTP 200 (VERIFIED).
- **Film clips** = route job `word_examples` → token → clip:
  `POST /v1/route/jobs {}` → `{job_id, input_upload_url}`; PUT a zip containing `job.json`
  `{"type":"word_examples","word_examples_request":{"words":[…],"lang":"en","per_word":N,"kind":"puzzle_movies"}}`
  to the presigned URL WITHOUT Authorization, `Content-Type: application/zip`; `POST …/{id}/submit`; poll
  `GET …/{id}` until `done` → `results[{lemma, token:"clpb_…", clips[{order_index, subs[{rel_start_ms,
rel_end_ms,text}], trim_duration_sec, year, cefr, difficulty}], matched_forms, empty_reason}]`. Then
  `POST /v1/puzzle_movies/clips {token}` → clip ids; poll `GET /v1/puzzle_movies/clips/{id}` until `ready`
  (`duration_sec, lead_trim_sec, size_bytes, source?`); `GET …/{id}/data` (Bearer only, NO Range, not
  signable) = the whole MP4. Measured: search 5.9 s, ready clip 13.2 s, 10.6 s video, 6.8 MB.
  Needs the owner's route-provider daemon online (it runs on the owner's PC).
- **`source` on token clips** (gateway PR #337, deployed): ONLY `{title,title_ru,year,media_type,season,episode,
imdb_id,imdb_url}`, all optional (imdb set manually by an operator — often absent). Never slug/ids/timecodes
  (owner decision: relax the gateway/anki_conf «§7 token invariant» — clients never see catalog keys — only by
  the film's public identity). Example seen live: "28 Years Later: The Bone
  Temple" 2026, `https://www.imdb.com/title/tt32141377/`.
- **Clip ownership** (gateway PR #340, deployed per the gateway agent, NOT re-verified by me): a token clip is
  visible only to the key that redeemed it. The extension polls with the same key → compatible.
- CORS on every `/v1/*`: `Access-Control-Allow-Origin: *`, `Expose-Headers: Retry-After` (PR #337).

### 1.2 Design decisions (DECIDED)

- **Key + gateway URL storage**: NOT in `chrome.storage.local` options (content scripts can read/write that in
  MV3 — this was a CRIT). They live in an extension-origin-only IndexedDB `flib-secrets`, one global record
  (not per profile). APIs `flibSecretsGet` (returns `{hasKey, keyMasked:"tpk_…abcd", gatewayUrl,
migrationNote}`, never the full key) and `flibSecretsSet`, both only for extension-page senders
  (`sender.url` on our origin AND `sender.id === chrome.runtime.id`). Rejected: per-profile options + runtime
  redaction (does not stop direct storage access).
- **Migration** from old `options.flibService.personalKey/gatewayUrl`: options are blanked ONLY after the store
  write is confirmed (`_flibSecretsMigrated`); a gateway URL is migrated only if its host is `*.flib.club` or
  localhost (else default + a note). Rejected: blank-on-every-save (lost the key when IDB was broken).
- **Gateway URL**: empty = `https://cache.flib.club`; `https`/`wss` only, `http`/`ws` only for
  localhost/127.0.0.1/[::1]; all gateway fetches use `redirect:'error'` + per-request timeouts.
- **Examples source** (`decideExamplesSource`, `ext/js/display/anki-route-ui.js`): valid key → `gateway`
  (key beats Core — owner: «напрямую через ключ»); else Core alive → `core`; else unavailable message.
  On key/quota/service errors with Core alive, a «Показать через anki_conf» button falls back to Core.
- **Anki route** (`ext/js/comm/anki-route.js`): probe Core `GET {anki.server}/api/v1/health` (needs JSON
  `status` string + `service==="core"` or `version` ending `-core`) → `core`; else AnkiConnect `version` on
  `anki.server` itself → `direct` on it; else fall back to `127.0.0.1:8765` ONLY when `anki.server` is a
  loopback address; else `none`. `anki.enable=false` → `disabled` (no probes). Cache 30 s. `addNote` is NEVER
  retried (Yomitan always sends `allowDuplicate:true`, so a retry could duplicate); after a route switch the
  user sees «anki_conf остановлен — переключено на AnkiConnect, нажмите + ещё раз».
  ⚠️ `version` on 8777 is NOT proof Anki is alive: Core answers it from a fallback store (see §5).
- **YouTube player**: `youtube-nocookie` embed + always a «Открыть на YouTube» link. Embeds from
  `chrome-extension://` pages fail with Error 153 (no Referer) → a DNR session rule (id 900001,
  `ext/js/background/youtube-embed-referer.js`) sets `Referer: https://flib.club/` on `sub_frame` requests to
  `||www.youtube-nocookie.com/embed/` with `initiatorDomains=[our extension host]` only.
- **Content script never boots inside frames nested in our pages** (`ext/js/app/content-script-frame-guard.js`,
  `location.ancestorOrigins` contains our origin) — otherwise the YouTube iframe inside the popup started a
  Frontend that re-ran the search and wiped the panel. Firefox (no `ancestorOrigins`) additionally excludes
  `*://www.youtube-nocookie.com/embed/*` in `manifest-variants.json` (firefox variants ONLY — on Chrome it
  would disable scanning of third-party nocookie embeds).
- **Fullscreen of a video inside the popup**: root cause was frontend.js fullscreenchange → `_updatePopup` →
  `setOptionsContext` → display.js:756-758 `searchLast(true)` → re-render removed the `<video>` (~40 ms).
  Fix: skip `setOptionsContext` when the fullscreen element is ANY of this frame's popup containers
  (`PopupFactory.isPopupContainer`, WeakSet in popup.js), keep popup selection, `_staleParent` one-shot reset.
  ⚠️ An iframe reload / re-parenting was my first hypothesis and was WRONG (verified: same document).
- **Captions**: film clips get a `<track kind=subtitles>` blob WebVTT with `<c.hl>` highlights, `showing` in
  native fullscreen (overlay hidden), honours user-enabled CC. Highlighting uses
  `ext/js/display/example-highlight-forms.js` (regular -s/-ed/-ing incl. e-drop/doubling, 177 irregular verbs,
  no regular -ed for irregular verbs, ≤2-char words only via table, phrases: strict token order, ≥3 tokens
  inflect only the first) plus the gateway's `lemma`/`matched_forms`.

## 2. Open decisions / next work (OQ = owner must answer)

### 2.A OQ — saving film clips into Anki cards (owner proposal 2026-10-07, my analysis given, NO answer yet)

Owner's idea: do NOT stream (gateway holds ≤ ~20 clients; clips are 6–18 MB and get fully downloaded anyway);
instead pass the MP4 the popup ALREADY holds into Anki. My analysis (told to the owner):

- Works through standard AnkiConnect `storeMediaFile {filename, data:base64}` in BOTH routes (Core bridge
  proxies any action; no body-size limit found in `anki_conf/internal/modules/bridge` — NOT verified live
  with a ~24 MB base64 body). The extension already stores media this way (`injectAnkiNoteMedia` →
  `backend.js` `_anki.storeMediaFile`). Filename by content hash `flib-<sha256>.mp4` (+ `.vtt`) → dedup.
- OQ-1: how to show it in the card — (a, recommended) a `Video` field with
  `<video controls src="flib-….mp4#t=<lead>,<end>"><track src="flib-….vtt" default></video>` (plays only the
  window, with highlighted subs; must check Anki «Check Media» does not treat `<video src>` files as unused) vs
  (b) `[sound:flib-….mp4]` (Anki-native, plays the whole file in an external player, no highlight).
- OQ-2: trim via anki_conf when it runs (needs a NEW Core endpoint "bytes → ffmpeg trim → storeMediaFile";
  gateway files carry lead padding, once 19 s of a 40 s file) vs store untrimmed for now.
- Earlier alternative I proposed (owner did not choose it): a gateway "pinned clip" capability URL bound to the
  key for streaming from Anki. Owner explicitly prefers files because of gateway load.
- Also unanswered: OQ-3 put YouTube examples into cards now as plain `youtube.com/watch?v=…&t=…s` links?
- Gateway clips are currently NOT saveable (checkboxes hidden; note «Сохранение в карточку — только для
  примеров через anki_conf»). Core-collected clips still save the old way (data field v1 + Core `clips/persist`,
  replay only while Core runs).

### 2.B OQ — merge / push

Branch `feat/gateway-examples` not merged into `main`, nothing pushed (local `main` itself is 65 commits ahead
of `origin/main` — VERIFIED 2026-10-12 — also unpushed; the branch is 96 ahead of `origin/main`). Commits are unsigned (`%G?`=N); signing is
not configured on this machine though CONTRIBUTING.md asks for it. Ask the owner before merging/pushing.

### 2.C xyzet chores (asked the owner 2026-10-07, no answer)

1. AWG tunnels do not autostart after a reboot (no systemd units) — offer to add autostart for all tunnels +
   their policy routes.
2. Register workers in `pool.db` (youtube_find_channels) for the 2 new exits?
3. Old `/etc/amnezia/amneziawg/awgw*.conf` are mode 644 while containing VPN private keys → chmod 600?

### 2.D Backlog (mcp tasks #35, project `src`)

Firefox not live-tested (DNR modifyHeaders, `::cue(.hl)`, exclude_matches); generic popup reset when page
iframes lazy-load (root cause only fixed for our own frames); dedicated user key instead of the ADMIN key;
«Удалить ключ» without confirmation; dead `flibService` field in the options schema; anki_conf Core writes
notes directly into `collection.anki2` when Anki is down (reported to the anki_conf agent, not our repo);
minor highlight gaps (weaved/speeded, added for "ad", fee→feed); 2 equivalent-ish surviving mutants in
popup fullscreen tests; «Extension context invalidated» entries after extension Reload (benign — reload the tab).

## 3. Current system state (VERIFIED 2026-10-12 unless marked)

- Repo `/home/xxxvita/Work/yomitan_phrases/src`, checked-out branch `feat/gateway-examples` HEAD `4c01b838`,
  31 commits ahead of local `main` (`010e3bbe`). Tree clean except untracked `.claude/`, `docs/HANDOFF.md`
  (not ours); this handoff is committed on the branch right after `4c01b838`. Merged sub-branches kept: `feat/gateway-examples-p3`, `fix/flib-migration-loss`,
  `fix/youtube-embed-referer`. Worktree `.claude/worktrees/feat-russian-translation-column` still exists
  (makes plain `npm test`/vitest/eslint pick up its files — always run with `--exclude '.claude/**'`).
- `ext/manifest.json` (gitignored, generated) = version `0.3.1.0`, built for chrome with CSP
  `img-src … https://i.ytimg.com; frame-src https://www.youtube-nocookie.com https://www.youtube.com`.
  Owner loads `ext/` unpacked in Chromium (extension id `epejdgdldhcihkikkpalfolmkikdmjpb`); after Reload
  they must refresh open tabs.
- Tests: `npx vitest run --exclude '.claude/**'` → 87 files, 4930 passed, 46 skipped. `npm run test:ts`,
  `npx eslint ext/js test types/ext` clean (last verified by the implementer at 4c01b838).
- Gateway prod: `cache.flib.club` serves `/v1/examples` (HTTP 200 on 2026-10-12, VERIFIED); #337/#339/#340/#341
  deployed per the gateway agent (NOT re-verified). PR #342 (`source` for demo keys too) was pending the
  owner's merge — status UNKNOWN.
- Settings UI: section «Flib-club: сервер» (above Anki) with «Личный ключ (tpk\_…)» and «Адрес сервера
  (gateway)». The key was entered in the e2e test profiles only; whether the owner has entered it in their
  real profile is UNKNOWN.
- xyzet (`ssh xyzet`, address pinned in ~/.ssh/config — the domain is dead): 2 new AmneziaWG exits up since
  2026-10-07: `awgw11` (172.16.23.22, table 1011, exit 72.56.58.2) and `awgw12` (172.17.22.244, table 1012,
  exit 212.64.215.249). 8 distinct exit IPs total. NOT re-verified on 2026-10-12.

## 4. Access (secrets — paths only)

- Owner's gateway key: `~/.config/anki-connect-desktop/config.yaml`, field `asr_api_key` (it is the gateway
  ADMIN/bootstrap key `tpk_2f77…`; `compute_api_key` is NOT a tpk key). The owner allowed using it for live
  tests. Extract into a shell/node variable with a regex; NEVER print, log, screenshot or commit it.
- AWG configs for xyzet: `/home/xxxvita/Downloads/*.conf` (owner-supplied) and `/etc/amnezia/amneziawg/` on xyzet.
- Cloudflare R2 keys exist at `~/Work/English/services/turmalin_getaway/.keys/cloudflare-r2-s3.env` (owner sent
  the path once without a task; I did not open it). R2 credentials must never go into the extension.

## 5. Pitfalls / anti-instructions

- ⚠️ Don't store anything secret in `chrome.storage.local` options — content scripts can read/write it.
- ⚠️ Don't treat AnkiConnect `version` on 8777 as "Anki alive": Core answers from its fallback store, and its
  async bridge path WRITES notes straight into `collection.anki2` while Anki is down (anki_conf
  `bridge/module.go` ~801, `ankistore/actions.go:159-270`).
- ⚠️ Don't redirect a non-loopback `anki.server` to local 8765 (other collection + apiKey leak).
- ⚠️ Don't retry `addNote`.
- ⚠️ Playwright: a `page.mouse` click on the popup iframe in headless goes to the TOP document. Click inside
  the popup via `frame.locator('video').click({position:{x:w-39,y:h-46}})` (the fullscreen button moved from
  w-73 to w-39 once the `<track>` added a ⋮ menu).
- ⚠️ `git merge -F -` does not read stdin — write the message to a file. Chain dependent steps with `&&`.
- ⚠️ On xyzet never write routes into reserved tables 253/254/255 (254 = main took the box down in July);
  use ≥1000. New AWG ifaces: `Table = off`, strip `DNS =`, `set -o noclobber` before writing configs.
- ⚠️ Never `pkill -f`/`pgrep -f` with a bare pattern.
- ⚠️ The memory server was flaky on 2026-10-07 (two saves failed) — retry, and don't assume a save
  happened without its returned id.

## 6. Artifacts

- New modules: `ext/js/comm/flib-gateway-client.js`, `ext/js/data/flib-secret-store.js`,
  `ext/js/data/flib-service-config.js`, `ext/js/pages/settings/flib-service-controller.js`,
  `ext/js/comm/anki-route.js`, `ext/js/pages/settings/anki-route-status.js`,
  `ext/js/background/flib-word-examples-jobs.js`, `ext/js/background/flib-options-redaction.js`,
  `ext/js/background/youtube-embed-referer.js`, `ext/js/app/content-script-frame-guard.js`,
  `ext/js/core/abort-signal-util.js`, `ext/js/display/gateway-examples-{util,loader,panel}.js`,
  `ext/js/display/example-highlight-forms.js`, `ext/js/display/example-subtitle-track.js`.
- Tutorial `docs/system-design.html` (committed on main in `010e3bbe`; does NOT yet describe this branch) —
  published artifact https://claude.ai/artifact/VvXNuzbzNp8FBzCxmzC8p2.
- E2E scripts — ⚠️ GONE (the session scratchpad was cleaned; VERIFIED 2026-10-12 `ls` empty). They lived in:
  `/tmp/claude-1000/-home-xxxvita-Work-yomitan-phrases-src/7d1b7f1a-b8a0-408b-ad48-8576f317228b/scratchpad/e2e/`
  `run.mjs` (full flow), `fs.mjs` (fullscreen), `nested.mjs`, `subs.mjs`, `anki.mjs` (direct-route check),
  plus `film_smoke.py` one level up. Recreate from §1.1 (exact calls) and §5 (click coordinates) if needed.
- Screen recording analysed: `/home/xxxvita/2026-10-07 15-11-24.mkv` (fullscreen click at 5:04.8).

## 7. Memory (MCP)

3087 goal done + architecture (resume point; ⚠️ its «HEAD 309bd17e» is STALE — HEAD is 4c01b838) · 3075 key location/usage rules · 3073 extension↔anki_conf
dependency map · 3080 P3 start+poll / key redaction / build:libs trap (saved by a subagent) · 3098 xyzet exits ·
3032 dict_base swap done · 3037 tutorial (⚠️ its «НЕ закоммичен» is STALE — committed in 010e3bbe on main) · 3025/3005 dictionary pipeline (older topic) · errors 254 (git merge -F -).
3095 fullscreen root cause + fix (saved 2026-10-12 after two failed tries on 10-07).

## 8. NEXT STEP

Ask the owner (in Russian) for OQ-1/OQ-2/OQ-3 of §2.A; on an answer, write the P8 spec + ≥5 edge cases for
"store the popup's MP4 (+VTT) into Anki via storeMediaFile on +", show it, then dispatch an implementer.
