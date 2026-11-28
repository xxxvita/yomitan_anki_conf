# Building Flib-club from source

This document is for AMO reviewers who rebuild the submitted Firefox extension.
It follows Mozilla's
[source code submission requirements](https://extensionworkshop.com/documentation/publish/source-code-submission/).

## Tested build environment

| Component | Version                              |
| --------- | ------------------------------------ |
| OS        | Linux. CI uses Ubuntu 24.04 (x86-64) |
| Node.js   | 22.x (CI), 24.x, 26.x                |
| npm       | The one bundled with Node            |
| Disk      | About 1 GB                           |

Node 24 needs no extra setup. It was tested on x86-64, not on ARM64; the only
native build dependency is esbuild, which has an ARM64 package in the lockfile.
All tools are open-source npm packages pinned by `package-lock.json`.

The build needs network access for `npm ci` and `npm run license-report:html`.
Without network the report still exits with 0, but `ext/legal-npm.html` then
differs from the submitted file.

To install Node, use <https://nodejs.org/en/download/> or
[nvm](https://github.com/nvm-sh/nvm) (`nvm install 24`).

## Build

From the root of the unzipped source archive, using the version you are
reviewing (here `0.6.2`, always written with 4 segments):

```bash
npm ci
npm run license-report:html
npm run build -- --target firefox --version 0.6.2.0
```

The AMO submission is `builds/yomitan-firefox.zip`.

Do not use `scripts/build-all.sh`: it also builds the dictionaries from private
source data, which the extension does not contain.

## Check the result

Compare the unpacked trees, not the zip files:

```bash
mkdir submitted rebuilt
unzip -q /path/to/submitted.zip -d submitted
unzip -q builds/yomitan-firefox.zip -d rebuilt
diff -r submitted rebuilt
```

No output means every file is identical. This was checked on v0.4.1: a build
from `git archive` on Node 24 and Node 26 matched the CI build on Node 22 in all 477 files.

## What the build does

- `npm ci` installs the exact dependencies from `package-lock.json`.
  `yomitan-handlebars` is a public GitHub dependency, pinned to a commit by the
  lockfile.
- `npm run license-report:html` regenerates `ext/legal-npm.html`.
- `npm run build`:
  - generates `ext/lib/`, which is not in the repository, from `node_modules`
    (`dev/build-libs.js`, esbuild) and builds the YouTube subtitle panel into
    `ext/lib/flib-youtube/` (see «The YouTube subtitle panel (beta)» below);
  - applies the `firefox` patches from `dev/data/manifest-variants.json` to the
    base manifest;
  - zips `ext/` into `builds/yomitan-firefox.zip`.

The `version` in `package.json` is `0.0.0` by design. The real version comes from
`--version`.

## The YouTube subtitle panel (beta)

`npm run build:libs` (also run by `npm run build`) calls
`dev/build-flib-youtube.js`. It bundles, with the same esbuild (0.25.1 in
`package-lock.json`) and the same Node.js as the rest of the build, the files
`ext/lib/flib-youtube/panel.js`, `bridge.js`, `keys.js` and `panel.css`. The fonts
are copied to `ext/lib/flib-youtube/fonts/`; the panel installs them at run time
from the extension's own URLs. `ext/lib/flib-youtube/` is git-ignored and
always built.
Each font family ships with its SIL OFL text there (`<Family>-OFL.txt`, from its
`@fontsource` package or `flib-youtube/licenses/`), and the bundles keep the
libraries' license comments at the end of each file (`legalComments: 'eof'`).

Sources:

- `vendor/flib-site/`: the public player code of flib.club, copied byte for
  byte at commit `8799b6c6f30a155f6af8ee1251a8fb156ea6d8ab`. `SOURCE.json` lists
  the SHA-256 of every file; `node dev/flib-site-sync.js --check` verifies them.
  Nobody edits this directory by hand.
- `flib-youtube/src/`: the layer that runs the copy on youtube.com (the page
  script, the key gate, the fixed set of commands, storage and `/api` through
  the background).

Tests, all without network:

```bash
npm run test:flib-site      # the copy against SOURCE.json and its own checks
npm run test:flib-youtube   # tsc and vitest of the layer
```

The offline stand (a real browser with the built extension on a local copy of a
YouTube page) needs Chrome for Testing in `~/.cache/ms-playwright`; see the header
of `playwright.flib-youtube.config.js`:

```bash
PW_DISABLE_TS_ESM=1 bwrap --dev-bind / / --unshare-net npx playwright test -c playwright.flib-youtube.config.js
```

## No obfuscation

The code is not obfuscated. Files under `ext/js/` are shipped as written.
`ext/lib/` holds third-party libraries bundled from `node_modules`; AMO needs
the source archive because of them.

## Source archive provenance

The archive is
`git archive --format=zip --prefix=flib-club-<version>/ v<version>` from
<https://github.com/xxxvita/yomitan_anki_conf>. To cross-check, clone that
repository at the same tag.
