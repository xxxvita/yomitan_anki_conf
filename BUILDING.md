# Building Flib-club from source

This document satisfies Mozilla's [source code submission
requirements](https://extensionworkshop.com/documentation/publish/source-code-submission/)
for AMO reviewers reproducing the submitted Firefox extension.

## Tested build environment

| Component  | Version                          | Notes                                                                                                                                                                                 |
| ---------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OS         | Linux (any modern distro), macOS | Tested on Arch/Manjaro 7.x kernel and Ubuntu 24.04 (CI). Should work on any POSIX system.                                                                                             |
| Node.js    | 22.x LTS (CI), 24-26.x           | Pin via `nvm install 22 && nvm use 22`. CI's `release.yml` uses `node-version: '22'`. Mozilla's reviewer default (Node 24.14.0) is compatible — `package.json` engines is `>=22.0.0`. |
| npm        | bundled with Node                | npm 10.x / 11.x. No separate install needed.                                                                                                                                          |
| git        | any 2.x                          | Only needed if reproducing from the GitHub repo rather than the uploaded source archive.                                                                                              |
| bash       | 4.x or 5.x                       | The wrapper scripts use `bash`. Available out-of-the-box on Linux/macOS.                                                                                                              |
| disk space | ≈ 1 GB                           | `node_modules` ≈ 700 MB, build output ≈ 80 MB.                                                                                                                                        |

No proprietary tools, no commercial dependencies, no web-based services
involved in the build. All tooling is open-source npm packages pinned by
`package-lock.json`.

## Install prerequisites

### Node.js + npm

Use the official Node.js installer for your OS, or a version manager.

- **nvm (recommended for reproducibility):**
  <https://github.com/nvm-sh/nvm#install--update-script>

  ```bash
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  nvm install 22
  nvm use 22
  ```

- **System package manager** (Ubuntu/Debian):
  <https://github.com/nodesource/distributions#nodejs>

  ```bash
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
  ```

- **Direct download:** <https://nodejs.org/en/download/>

### Verify

```bash
node --version    # v22.x.x
npm --version     # 10.x or 11.x
bash --version    # 4.x or 5.x
```

## Build

From the unzipped source archive root (`flib-club-0.3.1/`):

```bash
npm install                       # installs build-time deps from package-lock.json
./scripts/build-all.sh 0.3.1      # builds all browser variants at the given version
```

The `0.3.1` argument is the version string written into each variant's
`manifest.json`. The script pads to 4 segments (`0.3.1` → `0.3.1.0`) so
Chrome's manifest validator accepts it.

### Output

```
builds/
├── yomitan-chrome.zip          ← Chrome / Edge / Opera / Brave production
├── yomitan-chrome-dev.zip      ← Chromium dev-mode unpacked
├── yomitan-edge.zip            ← Microsoft Edge
├── yomitan-firefox.zip         ← Firefox production  ★ this is the AMO submission
├── yomitan-firefox-dev.zip     ← Firefox developer / temporary-addon
└── unpacked/                   ← same content, unzipped for `Load Unpacked` workflows
```

The Firefox AMO submission is `builds/yomitan-firefox.zip`.

## Reproducibility

The build is **content-deterministic**: rebuilding from the same source
with the same Node version produces byte-identical file contents inside
the zip. The zip file itself may differ across runs due to embedded
filesystem timestamps (this is a general property of `.zip` containers,
not a per-extension issue). Reviewers comparing the unzipped trees with
`diff -r` will see no content differences. Verified locally:

```bash
./scripts/build-all.sh 0.3.1
sha256sum builds/yomitan-firefox.zip > /tmp/a
./scripts/build-all.sh 0.3.1
sha256sum builds/yomitan-firefox.zip > /tmp/b
# /tmp/a and /tmp/b: differ (timestamps embedded in zip header)

unzip -q ~/Downloads/yomitan-firefox-v0.3.1.zip -d /tmp/submitted/
unzip -q builds/yomitan-firefox.zip            -d /tmp/rebuilt/
diff -r /tmp/submitted /tmp/rebuilt
# (no output → all file contents byte-identical)
```

## What the build does

1. **`npm install`** — installs dev dependencies (esbuild, stylelint,
   vitest, etc.) declared in `package.json`, pinned by `package-lock.json`.

2. **`scripts/build-all.sh <version>`** — wrapper that:

   - Normalises the version to 4 segments
   - Invokes `npm run build -- --all --version <version>`
   - The `build` script (`dev/build.js`) runs:
     - **esbuild** bundles JS modules for the popup, content script,
       background, etc. `dev/build-libs.js` sets `minify: false` and
       `sourcemap: true`. No code minification, no obfuscation.
     - **`dev/manifest-util.js`** reads the base manifest from
       `dev/data/manifest-variants.json` and applies per-variant JSON
       patches (e.g. for Firefox: set `browser_specific_settings.gecko`,
       remove `permissions.offscreen`).
     - Files are zipped into `builds/yomitan-<variant>.zip`.

3. **Unpacking** — `build-all.sh` then unzips each variant into
   `builds/unpacked/yomitan-<variant>/` for local browser testing
   (`Load Unpacked` / `about:debugging`).

No code generation, no template engines for the source code itself.
Vendor libraries (`handlebars`, `linkedom`, etc.) under `ext/lib/` are
shipped verbatim from upstream Yomitan as pre-compiled vendor blobs —
their build is documented in upstream Yomitan's repo.

Handlebars' use of the `Function` constructor (which `web-ext lint`
flags as a dynamic-code warning) is for compiling user-installed
dictionary CSS templates that ship bundled inside the extension —
no remote source, no eval of network-fetched code. Yomitan's
established AMO-approved pattern.

The `package.json` `version` field is `0.0.0` by design — the
real version comes from `--version <X>` passed to `npm run build`
and is injected into each variant's `manifest.json` at build time
(see `scripts/build-all.sh`).

The `yomitan-handlebars` git dependency in `package.json` is a
deliberately pinned commit on a public GitHub repo, inherited from
upstream Yomitan. It's not on npm but the lockfile pins the exact
commit; reproducibility is preserved.

## No-obfuscation statement

This extension is not obfuscated. `minify: false` in
`dev/build-libs.js`, `sourcemap: true`, identifiers preserved, comments
preserved. The submitted `.zip` content matches the source tree
file-for-file (modulo the per-variant manifest patches above and the
esbuild bundle output, which preserves module structure).

## Source archive provenance

The uploaded source archive is `git archive --format=zip --prefix=flib-club-<version>/ v<version>`
from <https://github.com/xxxvita/yomitan_anki_conf>. Reviewers can
cross-check by cloning that repo at the matching tag and running the
build instructions above.
