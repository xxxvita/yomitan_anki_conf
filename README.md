# Flib-club

**Browser companion for the AnkiConf workflow.** Word lookup + video-clip
examples pulled from a local Core service + one-click Anki cards with
auto-attached clips.

A focused fork of [Yomitan](https://github.com/yomidevs/yomitan). Not a
general-purpose popup dictionary &mdash; this exists to support a specific
research-driven language-learning workflow built around
[AnkiConf](https://github.com/xxxvita/anki_connect).

## What this fork adds on top of Yomitan

- **Test-Words** &mdash; scans a page and flags words that aren't yet in your
  Anki collection. One-click "mark as known" against the local Core
  lexicon.
- **Video-clip examples** &mdash; clicking the `Ex` button on a dictionary
  entry pulls real movie/TV scenes containing the searched word, with
  time-synced subtitles, from your local AnkiConf Core. Search-word
  highlighted gold inside the caption strip.
- **One-click Anki cards** with auto-attached video clips, stable IDs,
  custom note types, and a saved-examples panel (`F2` replay) that
  re-renders clips from the note's `data` field on subsequent hovers.
- **Per-page auto-tags on Anki notes** &mdash; derives a `domain` and
  `endpoint` tag from the host page URL, so cards stay sourced to where
  you learned them.
- **Phrase entry popup** (hotkey `Alt+Shift+A`) &mdash; free-form
  expression+translate textareas, one-click save, bypasses dictionary
  lookup.
- **User-tag toggle bar** &mdash; in Settings → Tags, enter one tag per line;
  toggle buttons appear above dictionary results, every pressed button
  attaches to the next saved card.

## Who this is for

Users of AnkiConf. If you don't run AnkiConf Core locally, Flib-club
still works as a popup dictionary (the Yomitan baseline) &mdash; but the
features above are gated on the Core. If you're not building this
specific Anki-driven workflow, you almost certainly want
[upstream Yomitan](https://github.com/yomidevs/yomitan).

## Architecture (one local service, one URL)

The extension talks to **one** user-configurable endpoint (default
`http://127.0.0.1:8777`). The AnkiConf Core service at that endpoint:

- Proxies the AnkiConnect protocol byte-for-byte to the real AnkiConnect
  at `127.0.0.1:8765` (no separate wiring needed in the browser).
- Adds endpoints for lexicon analysis, known-words, video-clip lookup
  and serving, subtitle (VTT) delivery, and per-clip caching.

So the extension only declares one host in Settings, and AMO/Chrome Web
Store disclosure is a single line.

## Build

Use the wrapper script &mdash; it handles npm install, version bumping, and
unpacks zips into `./builds/unpacked/yomitan-<variant>/`:

```bash
./scripts/build-all.sh 0.0.0.N         # build all variants at version
./scripts/build-all.sh 0.0.0.N --clean # wipe builds/ first
./scripts/build-all.sh --no-unpack     # zips only
```

Output zips: `yomitan-chrome.zip`, `yomitan-chrome-dev.zip`,
`yomitan-edge.zip`, `yomitan-firefox.zip`, `yomitan-firefox-dev.zip`.

`builds/cu` is a symlink to `builds/unpacked/yomitan-chrome-dev` &mdash;
Chrome's "Load unpacked" should point at it once and stay; each
`build-all.sh` run refreshes what's behind the symlink automatically.

## Diagnostic check

If something looks wrong in the browser, run:

```bash
./scripts/yomitan-check.sh                  # 30 checks across CSS/JS/build
./scripts/yomitan-check.sh --bump           # bump manifest + fingerprint
```

The script verifies that every source-of-truth pattern (CSS rules with
`!important`, SVG icons with `xmlns`, VTT highlight injection, the
unified URL fallback in backend, the `builds/cu` symlink, etc.) is
intact AND that every built artifact in `builds/unpacked/` matches the
source. Each commit's `BUILD_FINGERPRINT` is logged in the popup-iframe
DevTools console on first panel mount; if you see an older value than
the source, Chrome's chrome-extension:// asset cache is stale &mdash; close
all extension tabs, Reload from `chrome://extensions`, reopen.

## Install (unsigned dev builds)

| Browser                                 | How                                                                                                                                 |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Chrome / Opera / Brave / Vivaldi / Edge | `chrome://extensions` → Developer Mode → _Load unpacked_ → `./builds/cu`. Or launch with `--load-extension=/abs/path/to/builds/cu`. |
| Firefox Developer Edition / Nightly     | `about:config` → `xpinstall.signatures.required = false` → open the firefox-dev XPI.                                                |
| Firefox release / ESR                   | Sign via `web-ext sign --channel unlisted` first; signed XPI installs directly.                                                     |

## Releases

Push a tag matching `v*` (e.g. `v1.0.0`) → CI builds all five variants at
that version and uploads them to the configured Cloudflare R2 bucket.
URLs are written to the GitHub Release notes.

Required GitHub Secrets: `R2_ACCOUNT_ID`, `R2_BUCKET`,
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_BASE_URL`.

## Community / source

Issues, discussions, source: <https://github.com/xxxvita/yomitan_anki_conf>

## License

GPL-3.0-or-later &mdash; see `LICENSE`. Built on top of Yomitan; upstream
copyright remains intact in all files that originated upstream.
