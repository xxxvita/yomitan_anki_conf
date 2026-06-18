# Flib-club

Patched fork of [Yomitan](https://github.com/yomidevs/yomitan) tailored to the
`anki_conf` workflow: free-form phrase popup, per-page auto-tags on Anki notes,
a user-tag toggle bar inside the result popup, and a CheckWords button that
finds clipboard words you don't know yet against a local Anki-Conf service.

This repo carries upstream Yomitan unchanged where possible. Only the additions
listed below live on top.

## Added features

- **Phrase entry popup** (hotkey `Alt+Shift+A`) — opens a popup with editable
  _expression_ + _translate_ textareas and a one-click "Add to Anki" button. Saves
  a free-form term-type card, bypassing dictionary lookup.

- **Per-page auto-tags** — every Anki note saved from the popup automatically
  gets two tags derived from the host page URL:

  - **domain**: hostname (with subdomain except `www.`) + port; `.` and `:` → `_`;
    lowercased. `www.example.com` → `example_com`,
    `en.wikipedia.org` → `en_wikipedia_org`,
    `app.localhost:8777` → `app_localhost_8777`.
  - **endpoint**: full URL path, leading `/` stripped, internal `/` → `_`,
    lowercased. `/wiki/Article` → `wiki_article`. Empty path → no tag.
  - Characters outside `\p{L}\p{N}_-` (Unicode-aware) are replaced with `_`.

- **User-tag toggle bar** — in Settings → Tags, enter one tag per line and press
  Save. When non-empty, a toggle-button bar appears above the dictionary results
  in the popup; every pressed button is attached to the next saved/updated Anki
  note. Applies to term, kanji, and phrase cards alike.

## Build

```bash
npm ci                                  # once
npm run build                           # builds all targets into ./builds/
npm run build -- --target chrome        # single target
npm run build -- --all --version 1.2.3.4
```

Output zips: `yomitan-chrome.zip`, `yomitan-chrome-dev.zip`, `yomitan-edge.zip`,
`yomitan-firefox.zip`, `yomitan-firefox-dev.zip`.

## Releases

Push a tag matching `v*` (e.g. `v1.0.0`) → CI builds all five variants at that
version and uploads them to the configured Cloudflare R2 bucket. URLs are
written to the GitHub Release notes.

Required GitHub Secrets:
`R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
`R2_PUBLIC_BASE_URL`.

## Install (unsigned dev builds)

| Browser                                 | How                                                                                                                                               |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chrome / Opera / Brave / Vivaldi / Edge | `chrome://extensions` → Developer Mode → _Load unpacked_ → `./ext` (or unzipped release zip). Or launch with `--load-extension=/abs/path/to/ext`. |
| Firefox Developer Edition / Nightly     | `about:config` → `xpinstall.signatures.required = false` → open the firefox-dev XPI.                                                              |
| Firefox release / ESR                   | Sign via `web-ext sign --channel unlisted` first; signed XPI installs directly.                                                                   |

## License

GPL-3.0-or-later — see `LICENSE`. Upstream copyright remains intact in all
files that originated upstream.
