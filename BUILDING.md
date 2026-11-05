# Building Flib-club from source

This document is for AMO reviewers who rebuild the submitted Firefox extension.
It follows Mozilla's
[source code submission requirements](https://extensionworkshop.com/documentation/publish/source-code-submission/).

## Tested build environment

| Component | Version                              |
| --------- | ------------------------------------ |
| OS        | Linux. CI uses Ubuntu 24.04 (x86-64) |
| Node.js   | 22.x (CI) or 24.x                    |
| npm       | The one bundled with Node            |
| Disk      | About 1 GB                           |

The default reviewer environment (Node 24, npm 11) works, no version change is
needed. All tools are open-source npm packages pinned by `package-lock.json`.
The build needs network access for `npm ci` only.

To install Node, use <https://nodejs.org/en/download/> or
[nvm](https://github.com/nvm-sh/nvm) (`nvm install 24`).

## Build

From the root of the unzipped source archive, using the version you are
reviewing (here `0.4.2`, always written with 4 segments):

```bash
npm ci
npm run license-report:html
npm run build -- --target firefox --version 0.4.2.0
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
from `git archive` on Node 24 matched the CI build on Node 22 in all 477 files.

## What the build does

- `npm ci` installs the exact dependencies from `package-lock.json`.
  `yomitan-handlebars` is a public GitHub dependency, pinned to a commit by the
  lockfile.
- `npm run license-report:html` regenerates `ext/legal-npm.html`.
- `npm run build`:
  - generates `ext/lib/`, which is not in the repository, from `node_modules`
    (`dev/build-libs.js`, esbuild);
  - applies the `firefox` patches from `dev/data/manifest-variants.json` to the
    base manifest;
  - zips `ext/` into `builds/yomitan-firefox.zip`.

The `version` in `package.json` is `0.0.0` by design. The real version comes from
`--version`.

## No obfuscation

The code is not obfuscated. Files under `ext/js/` are shipped as written.
`ext/lib/` holds third-party libraries bundled from `node_modules`; AMO needs
the source archive because of them.

## Source archive provenance

The archive is
`git archive --format=zip --prefix=flib-club-<version>/ v<version>` from
<https://github.com/xxxvita/yomitan_anki_conf>. To cross-check, clone that
repository at the same tag.
