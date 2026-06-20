# AMO Submission Notes — Flib-club

Paste the relevant sections into the appropriate fields on
<https://addons.mozilla.org/developers/addon/submit/>.

---

## Listing description (public, shown to end users)

**Short summary (≤150 chars):**

> Browser companion for the AnkiConf workflow: word lookup, video-clip
> examples from a local Core service, one-click Anki cards.

**Full description:**

> Flib-club is a focused fork of [Yomitan](https://addons.mozilla.org/firefox/addon/yomitan/)
> built for users of **AnkiConf** — an open-source local service that
> turns Anki into a research-driven language-learning tool.
>
> **What this fork adds on top of Yomitan:**
>
> - **Test-Words** — scans a page and flags words you don't yet have in
>   your Anki collection. One-click "mark as known" against the local
>   Core lexicon.
> - **Video-clip examples** — clicking the `Ex` button on a dictionary
>   entry pulls real movie/TV scenes containing the searched word, with
>   time-synced subtitles, from your local AnkiConf Core service.
> - **One-click Anki cards** with auto-attached video clips and per-page
>   source tags.
> - **Phrase entry popup** for free-form expression+translation cards.
>
> **Who this is for:** users of AnkiConf. Without AnkiConf Core running
> locally on your machine, Flib-club still works as a popup dictionary
> (the Yomitan baseline) — but the unique features above will be
> inactive. If you're not building this specific Anki-driven workflow,
> you almost certainly want
> [upstream Yomitan](https://addons.mozilla.org/firefox/addon/yomitan/).
>
> Source code, AnkiConf Core, and community:
> <https://github.com/xxxvita/yomitan_anki_conf>
> Telegram: <https://t.me/flibclcub>
>
> Built on top of Yomitan (GPL-3.0). All upstream Yomitan features are
> preserved.

---

## Reviewer notes (private, only the AMO review team sees this)

> ### What this is
>
> Flib-club is a fork of Yomitan (addon ID
> `{649ee756-89d8-4eb5-a3df-c1ea2d4f7e85}` on AMO) with extra features
> for users of AnkiConf — a separately-distributed open-source local
> service. Yomitan is already approved on AMO; this fork preserves all
> of Yomitan's source/functionality and adds a small, well-scoped set
> of additions on top.
>
> The fork's GitHub repository (source, build pipeline, issue tracker):
> <https://github.com/xxxvita/yomitan_anki_conf>
>
> ### Network requests
>
> The extension contacts **one** user-configurable local endpoint
> (default `http://127.0.0.1:8777`). This is the optional AnkiConf Core
> service the user installs separately. AnkiConf Core proxies the
> AnkiConnect protocol byte-for-byte to the real AnkiConnect at
> `127.0.0.1:8765`, so one URL covers both Anki integration and video-
> example lookup. Users who only have plain AnkiConnect (no Core) can
> point this field at `127.0.0.1:8765` directly; video-example features
> will be inactive but Anki card creation still works.
>
> Plus the audio sources Yomitan upstream already ships (Wikimedia,
> jisho.org, languagepod101) for pronunciation playback when the user
> looks up a word. Those are user-toggleable in Settings → Audio.
>
> No telemetry. No analytics. No remote endpoints we control.
>
> ### Privacy
>
> The `data_collection_permissions` field declares `"none"` (see
> manifest.json). The fork ships an explicit `PRIVACY.md` in the
> repository root.
>
> ### Why broad CSP / host_permissions
>
> - `host_permissions: ["<all_urls>"]` — same as upstream Yomitan. The
>   extension needs content-script access to scan text on whatever page
>   the user is reading.
> - `connect-src *` in CSP — user-configurable dictionary download URLs
>   (Yomitan's existing feature; users add their own dictionary feeds)
>   plus the user-configurable Anki service URL.
> - `media-src *` in CSP — the user-configurable Anki service hosts
>   video clip MP4s and WebVTT subtitle tracks; their URL is whatever
>   the user typed into Settings.
>
> ### Permissions we explicitly DO NOT request
>
> - **`nativeMessaging`** — upstream Yomitan ships this for optional
>   MeCab (Japanese morphological analyzer) and Yomitan API
>   integrations. Both are out of scope for Flib-club's English-focused
>   AnkiConf workflow, so we dropped the permission entirely. A
>   migration (`_updateVersion77` in `ext/js/data/options-util.js`)
>   force-disables `parsing.enableMecabParser` and
>   `general.enableYomitanApi` on every existing profile, and the
>   backend calls `chrome.permissions.remove({permissions:
['nativeMessaging']})` on startup for legacy users who had once
>   granted it.
>
> ### No remote code execution
>
> No `eval`, no `new Function()`, no `setTimeout(string, …)`, no
> dynamic `<script src=…>` injection, no remote module imports. The
> only WebAssembly is `lib/resvg.wasm` bundled in the extension
> (Yomitan upstream uses it for SVG icon rendering).
>
> ### Build is unobfuscated
>
> `dev/build-libs.js` has `minify: false` and `sourcemap: true`. The
> uploaded source-code archive matches the build output one-to-one.
> Build command: `./scripts/build-all.sh <version>` (see `README.md`).
>
> ### What changed vs. upstream Yomitan
>
> Compact list (commits live in our GitHub):
>
> - **Branding** — name "Yomitan" → "Flib-club"; icons; "About
>   Flib-club" block at the top of Settings + Welcome page; description
>   string. Acknowledgement of upstream Yomitan is preserved in
>   user-facing UI, README, and `LICENSE`.
> - **Test-Words controller + UI** — new toolbar above results, modal
>   checklist, talks to AnkiConf Core endpoints
>   `/api/v1/lexicon/known-words` and `/api/v1/lexicon/analyze`.
> - **Video-Examples panel + modal** — `Ex` button next to dictionary
>   entries; orchestrator polls `/api/v1/lexicon/collect-examples/*`;
>   modal player with `<track>` subtitles and word-highlighted captions
>   via VTT cue tag injection; "open in new tab" option for fullscreen
>   playback.
> - **Phrase entry popup** with one-click Anki save.
> - **Per-page auto-tags on Anki notes** derived from host URL.
> - **User-tag toggle bar** above dictionary results.
> - **Unified Anki service URL** — collapsed two prior config fields
>   into one user-facing field; backend retains both schema fields for
>   backward compat (`anki.confServer` falls back to `anki.server`).
> - **AMO compliance**: dropped `nativeMessaging`, migration
>   `_updateVersion77`, Firefox manifest variant lists author
>   "xxxvita / Flib-club" matching homepage_url.
>
> ### Testing
>
> Static analysis: `./scripts/yomitan-check.sh` runs 30 checks across
> source + built artifacts (CSS rules with `!important`, SVG icons
> with `xmlns`, VTT highlight injection, build-artifact-vs-source
> fingerprint match, etc.). Each commit's `BUILD_FINGERPRINT` is
> logged in the popup-iframe DevTools console on first panel mount —
> useful for reviewer verification that what's running matches the
> source.
