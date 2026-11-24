# Flib-club

**An English-Russian popup dictionary for the browser.** Hover over an English
word to see its meanings, a Russian translation of each meaning and whole
phrases. Watch the word spoken in short video clips and save it to Anki in one
click.

Flib-club is a fork of [Yomitan](https://github.com/yomidevs/yomitan) made for
the [Flib-club](https://flib.club) project.

## Install

- **Chrome** and other Chromium browsers:
  [Chrome Web Store](https://chromewebstore.google.com/detail/flib-club/lnlehlopldabanpkngijoaajfghmpflo)
- **Firefox:** [addons.mozilla.org](https://addons.mozilla.org/firefox/addon/flib-club/)

On first start the extension downloads its two dictionaries by itself.

## What it does

- **Popup dictionary.** English definitions from Wiktionary, a Russian
  translation for each meaning, and phrases. The Russian translation can stay
  blurred until you click it, so you try to remember first. On flib.club it is
  always blurred.
- **Video examples.** Short clips from YouTube and films where the word is
  spoken, with subtitles. They need a personal key: our
  [Telegram bot](https://t.me/flibclub_bot) gives out a free trial key with 50
  requests to YouTube examples. Film examples need a paid key. «Открыть в плеере»
  on a YouTube example opens the video on flib.club; with a route on the Flib
  site, «С учётом моих знаний» and «Понятные» (full key only) show on the
  thumbnail what percent of the fragment or of the video you understand. You can
  enter the key in Settings or right in the card when the examples ask for it.
- **Anki cards in one click.** A translation, an example, audio and the clips
  you ticked go into the card. This needs Anki with the
  [AnkiConnect](https://ankiweb.net/shared/info/2055492159) add-on. Cards get
  tags from the page address, and your own tags can be toggled above the
  results.
- **Word check.** Copy text and see which words in it are new to you.
- **Interface in Russian or English,** chosen in Settings.

The optional Flibooster desktop app adds a precise word check, its own example
collection and saved clips. Without it the word check uses simple rules. When
Flibooster is not running and the Anki address in Settings is on this computer,
the extension switches to AnkiConnect by itself.

What the extension sends and where is described in the
[privacy policy](PRIVACY.md).

## Contact

- Support: <help@flib.club>
- Partnership: <partners@flib.club>
- Telegram channel: <https://t.me/flibclub>
- Bugs and ideas: [GitHub issues](https://github.com/xxxvita/yomitan_anki_conf/issues)

## Support the project

Like Flib-club? You can thank the author on [Boosty](https://boosty.to/worldin/donate).

![QR code for donations on Boosty](ext/images/donate-qr.png)

## Кратко по-русски

Flib-club — англо-русский всплывающий словарь для браузера. Наведите на
английское слово и увидите значения, перевод каждого значения на русский и
фразы. Видеопримеры из YouTube и фильмов открываются личным ключом: бесплатный
тестовый ключ с 50 запросами к примерам из YouTube выдаёт
[Telegram-бот](https://t.me/flibclub_bot), примеры из фильмов — по платному
ключу. Карточки Anki сохраняются в один клик, нужны Anki и AnkiConnect.

Установить: [Chrome](https://chromewebstore.google.com/detail/flib-club/lnlehlopldabanpkngijoaajfghmpflo),
[Firefox](https://addons.mozilla.org/firefox/addon/flib-club/). Поддержка:
<help@flib.club>, сотрудничество: <partners@flib.club>.

## For developers

### Build

**For AMO reviewers reproducing the submitted Firefox extension:** see
**[BUILDING.md](BUILDING.md)** &mdash; covers tested OS / Node / npm
versions, prerequisite install links, the exact build commands, output
mapping (which zip = which submission), reproducibility verification,
and the no-obfuscation/no-minification stance.

Quick path for contributors &mdash; use the wrapper script (it handles
npm install, version bumping, and unpacks zips into
`./builds/unpacked/yomitan-<variant>/`):

```bash
./scripts/build-all.sh 0.3.1           # build all variants at given version
./scripts/build-all.sh 0.3.1 --clean   # wipe builds/ first
./scripts/build-all.sh --no-unpack     # zips only (default version 0.0.0.0)
```

Pass 3-part (`0.3.1` → padded to `0.3.1.0`) or 4-part (`0.3.1.0`)
versions; both work.

Output zips include `yomitan-chrome.zip` and `yomitan-firefox.zip`, the
files submitted to the stores, plus dev variants.

`builds/cu` is a symlink to `builds/unpacked/yomitan-chrome-dev` &mdash;
Chrome's "Load unpacked" should point at it once and stay; each
`build-all.sh` run refreshes what's behind the symlink automatically.

### Dictionary pair (EN/RU)

The extension pairs `wty-en-en` with `flibooster-en-ru`. Both zips are built
here from anki_conf's `dict_base.db` (its English rows and its
`flibooster-en-ru` rows, as they are); anki_conf's code is not run. The path is
required: `--dict <path>` or `FLIB_DICT_BASE_DB` (the flag wins). There is no
default on purpose: the desktop app's live database can be older than the
dictionary already published, and a build from it would roll users back.

```bash
npm run build:dictionaries -- --dict <dict_base.db>   # → builds/dictionaries/<revision>/
FLIB_DICT_BASE_DB=<dict_base.db> npm run build:dictionaries
npm run build:dictionaries -- --verify builds/dictionaries/<revision>
npm run build:dictionaries -- --help
```

`scripts/build-all.sh` runs it too, passing `--dict "$FLIB_DICT_BASE_DB"`, and
fails if that variable is unset or the pair build fails (`--no-dictionaries`
skips it). It is not part of `npm test`. See
[docs/development/dictionary-pair.md](docs/development/dictionary-pair.md).

### Diagnostic check

If something looks wrong in the browser, run:

```bash
./scripts/yomitan-check.sh                  # checks across CSS/JS/build
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

### Load an unpacked build

| Browser                             | How                                                                                                                                 |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Chrome / Opera / Brave / Vivaldi    | `chrome://extensions` → Developer Mode → _Load unpacked_ → `./builds/cu`. Or launch with `--load-extension=/abs/path/to/builds/cu`. |
| Firefox Developer Edition / Nightly | `about:config` → `xpinstall.signatures.required = false` → open the firefox-dev XPI.                                                |

### Releases

Push a tag matching `v*` (e.g. `v0.4.3`) → CI builds all variants at that
version, uploads them to the Cloudflare R2 bucket, writes `latest.json` and
creates the GitHub Release. The store packages are submitted to the Chrome Web
Store and addons.mozilla.org by hand.

Required GitHub Secrets: `R2_ACCOUNT_ID`, `R2_BUCKET`,
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_BASE_URL`.

## License

GPL-3.0-or-later &mdash; see `LICENSE`. Built on top of Yomitan; upstream
copyright remains intact in all files that originated upstream.

The dictionaries `wty-en-en` and `flibooster-en-ru` are a separate work. They
contain text from [Wiktionary](https://en.wiktionary.org/) by Wiktionary
contributors, obtained through [Kaikki](https://kaikki.org/) and
[wty](https://github.com/daxida/wty). That text was converted, filtered, edited
and translated into Russian, and is distributed under
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Quotes from video
subtitles in entries added by Flibooster are not covered by this license. They
belong to their rights holders.
