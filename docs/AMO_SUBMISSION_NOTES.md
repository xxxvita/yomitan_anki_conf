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

## Reviewer notes (paste verbatim into AMO "Notes to Reviewers")

Plain text. Approx. 2400 chars — fits AMO's ~3000-char field limit.
Copy everything from `Fork of Yomitan...` through the last line.

```
Fork of Yomitan (https://addons.mozilla.org/firefox/addon/yomitan/), already approved on AMO. Preserves all upstream code + attribution; adds AnkiConf-workflow features on top. Our gecko.id is "flib-club@xxxvita" (stable, not derived from upstream's UUID).
Repo: https://github.com/xxxvita/yomitan_anki_conf
Source archive root has BUILDING.md with tested env, install steps, reproducibility verification.

NETWORK
- ONE user-configurable local endpoint (default http://127.0.0.1:8777) = AnkiConf Core, user-installed. Proxies AnkiConnect at 127.0.0.1:8765; serves video clips + WebVTT subtitles.
- Yomitan upstream audio sources (Wikimedia / jisho.org / languagepod101), user-toggleable.
- No telemetry, no analytics, no remote endpoints we control.

PRIVACY
- gecko.data_collection_permissions = ["none"]. PRIVACY.md in repo root.

PERMISSIONS vs upstream Yomitan
- DROPPED nativeMessaging (removed MeCab + Yomitan API; migration _updateVersion77 disables both on existing profiles + chrome.permissions.remove on startup).
- Kept host_permissions <all_urls>, connect-src *, media-src * — same shape as upstream; needed for the user-configurable Anki service URL + user-installed dictionaries (Yomitan baseline).

CODE SAFETY
- No eval / new Function() / remote scripts in OUR code.
- ext/lib/ vendor (handlebars, linkedom, etc.) shipped verbatim from upstream Yomitan as pre-compiled blobs. Handlebars' Function() compiles bundled CSS templates only — no remote code path.
- Only WebAssembly: ext/lib/resvg.wasm (Yomitan, SVG rendering).

BUILD
- Unobfuscated: dev/build-libs.js has minify:false, sourcemap:true.
- Source archive = git archive of HEAD = v0.3.1 + 3 doc-only commits not affecting build output.

WEB-EXT LINT
0 errors, 18 warnings, 0 notices. Almost all inherited from upstream Yomitan (already AMO-approved): UNSAFE_VAR_ASSIGNMENT in ext/lib/ vendor blobs (handlebars / linkedom), 4x INCOMPATIBLE_API chrome.offscreen.* (feature-detected, Firefox skips), 2x ANDROID_INCOMPATIBLE_API permissions.request.
Our-code additions: 1x UNSAFE_VAR_ASSIGNMENT at js/display/video-examples-modal.js win.document.write (static HTML + ONE HTML-escaped clip URL; captions injected via opener DOM API after document.close(), NOT via template literal). 1x MANIFEST_UPDATE_URL — required for Unlisted self-distribution per https://extensionworkshop.com/documentation/manage/updating-your-extension/

CHANGES VS UPSTREAM YOMITAN
Rebrand to Flib-club. Test-Words controller. Video-Examples panel+modal (JS-driven DOM caption overlay over <video>). Phrase entry popup. Per-page auto-tags. User-tag toggle bar. Unified Anki service URL field. gecko.update_url for self-hosted auto-updates.

Full details in repo README.md + BUILDING.md.
```

---

## Version Release Notes (per-version field — public)

```
First version distributed via self-hosted Unlisted channel.

Includes Firefox auto-update infrastructure (browser_specific_settings.gecko.update_url)
pointing at a stable manifest on our R2 bucket. Future versions will be picked up
automatically by Firefox without manual reinstall.

Codebase since the Yomitan upstream baseline: Flib-club rebrand, single unified
"Anki service URL" field that talks to the local AnkiConf Core service (proxies
AnkiConnect byte-for-byte), JS-driven DOM caption overlay for video-clip examples
(replaces native <track>/::cue — Chromium/Firefox diverged on programmatic cue
styling), nativeMessaging permission dropped (out of scope for the AnkiConf
workflow), Telegram channel link in About.

No telemetry, no analytics, no remote endpoints under our control. The extension
is a Yomitan fork; all upstream features preserved.
```
