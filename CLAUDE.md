# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Yomitan is a Manifest V3 browser extension (Chrome/Firefox/Edge) providing a popup
dictionary for language learning. The repository is pure JavaScript with type checking
performed via TypeScript (`checkJs`) using ambient types in `types/ext/**/*.d.ts`
imported through `jsconfig.json`'s `paths` mapping (so `import('display').Foo` resolves
to `types/ext/display.d.ts`). Node >= 22 is required.

## Common Commands

```bash
npm ci                    # install — required after checkout
npm run build             # build all manifest variants into ./builds
npm run build -- --target chrome           # build a single target
npm run build -- --all --version 1.2.3.4   # release build with version
npm run build:libs        # rebuild bundled third-party libs in ext/lib

npm test                  # full pipeline (js+ts+css+html+unit+options+json+md+build dry-run)
npm run test:fast         # eslint + tsc + unit + JSON format (typical dev loop)
npm run test:unit -- path/to/file.test.js   # run a single vitest file
npm run test:unit -- -t "pattern"           # run tests matching a name
npx playwright test                          # playwright e2e (requires ./dictionaries checkout; see CONTRIBUTING.md)

npm run test:ts           # tsc --noEmit across main/dev/test/bench jsconfigs
npm run test:js           # eslint
npm run test:css          # stylelint
npm run test:html         # html-validate
npm run test:md:write     # prettier --write (fixes markdown)
npm run test:unit:write   # regenerate expected-output fixtures (dictionary/Anki format changes)
npm run anki:css-json:write   # regenerate Anki structured-content CSS JSON
npm run license-report:html   # regenerate ext/legal-npm.html (before releases)
```

## Development Loop

The `ext/` directory is a live, loadable unpacked Chrome extension — no build step is
required for most edits. After changing code:

- **Content script / frontend** (`ext/js/app`, `ext/js/display`, `ext/js/pages/**`, most
  CSS, HTML): reloads on page reload.
- **Service worker / backend** (`ext/js/background`, `ext/sw.js`): click the reload icon
  on the extension at `chrome://extensions`.
- **Manifest** (`ext/manifest.json`): run `npm run build` to regenerate from
  `dev/data/manifest-variants.json` — the committed `ext/manifest.json` is a build
  artifact but must exist for unpacked loading.

Firefox builds come from `./builds/yomitan-firefox-dev.zip` side-loaded via
`about:debugging`. Android/Kiwi flows exist via `build:serve:firefox-android` and
`build:serve:kiwi-browser`.

## Architecture

Yomitan runs as three cooperating contexts, wired together by an API-map message bus:

1. **Service worker (backend)** — `ext/sw.js` → `ext/js/background/background-main.js` →
   `backend.js`. Owns the dictionary database, options store, translator, Anki
   integration, MeCab, clipboard monitor. Uses an offscreen document
   (`ext/js/background/offscreen*.js`) for APIs unavailable in service workers.
2. **Content script (frontend)** — injected on all frames per `manifest.json`, entry
   `ext/js/app/content-script-wrapper.js` → `content-script-main.js` → `frontend.js`.
   Handles text scanning (`ext/js/language/text-scanner.js`), hotkeys, and hosts the
   popup via `popup.js` / `popup-proxy.js` / `popup-window.js` (`popup-factory.js`
   chooses the right variant per frame).
3. **Extension pages** — `settings.html`, `search.html`, `welcome.html`, `info.html`,
   `popup.html`, `template-renderer.html` (sandboxed), etc. Main files live under
   `ext/js/pages/` and `ext/js/display/`.

### Cross-context communication

- `ext/js/comm/api.js` (`API`) — frontend ↔ backend via `chrome.runtime.sendMessage`.
- `ext/js/comm/cross-frame-api.js` (`CrossFrameAPI`) — frame ↔ frame via `postMessage`
  with the handshake/routing in `frame-ancestry-handler.js`, `frame-client.js`,
  `frame-endpoint.js`, `frame-offset-forwarder.js`.
- `ext/js/core/api-map.js` (`createApiMap` / `invokeApiMapHandler`) — type-safe
  name-to-handler dispatch used by every message bus; matching `import('application').ApiMap`
  types define the contract.
- `ext/js/comm/yomitan-api.js` — public API exposed to outside web pages.
- `ext/js/comm/anki-connect.js` — HTTP client for AnkiConnect.
- `ext/js/comm/mecab.js` — native-messaging bridge to MeCab.

### Subsystems

- **Dictionary** (`ext/js/dictionary/`) — IndexedDB via Dexie. `dictionary-database.js`
  is the store; `dictionary-importer.js` parses dictionary zips; heavy work runs in
  web workers (`dictionary-worker.js`, `dictionary-database-worker-main.js`).
- **Translator / Language** (`ext/js/language/`) — per-language directories (`ja`, `zh`,
  `en`, …) contribute text processors, transforms, and reading normalizers through
  `language-descriptors.js`. `translator.js` coordinates dictionary lookup with the
  `multi-language-transformer.js`. See `docs/development/language-features.md` for the
  full language-authoring contract (descriptor fields, transforms, processors).
- **Display** (`ext/js/display/`) — renders search results. `display.js` is the shell;
  `display-generator.js` + `structured-content-generator.js` build DOM;
  `display-anki.js` drives Anki export; `display-audio.js` handles pronunciation audio;
  `query-parser.js` tokenizes scanned text.
- **Settings** (`ext/js/pages/settings/`) — one controller per section,
  `settings-controller.js` is the root. Options schema lives in
  `ext/data/schemas/options-schema.json`; migrations in `ext/js/data/options-util.js`
  are covered by `npm run test:unit:options`.
- **Anki integration** (`ext/js/data/anki-*.js` + `ext/js/comm/anki-connect.js`) —
  Handlebars templates in `ext/templates-*.html` and `docs/templates.md`.
- **Core utilities** (`ext/js/core/`) — `EventDispatcher`, `ExtensionError`, logging
  (`log.js`), JSON helpers. Keep cross-cutting primitives here.

### Type system

- `jsconfig.json` enables strict `checkJs`. Do not disable strictness flags.
- Types are declared in `types/ext/*.d.ts` and referenced as bare specifiers in
  JSDoc `import()` calls thanks to the `paths` mapping (`"*": ["./types/ext/*"]`).
- Vendored libs live in `ext/lib` (excluded from type checking) and are regenerated by
  `npm run build:libs`.
- A `test:ts` failure in only one of `main`/`dev`/`test`/`bench` usually means the
  shared type files changed — run each subproject's tsc to localize.

## Project Conventions

- License header (GPL-3.0-or-later block) is enforced by `eslint-plugin-header` on every
  JS/TS file. Keep it intact when editing and include it on new files.
- Modern ES modules only: `const`/`let`, `async`/`await`, arrow functions
  (per `CONTRIBUTING.md`). No CommonJS in `ext/`.
- Do not hand-edit `ext/manifest.json` or `ext/legal-npm.html` — both are generated
  (`npm run build`, `npm run license-report:html`).
- Commits should be signed (see `CONTRIBUTING.md` §Commit Signing). `husky` + `lint-staged`
  auto-format markdown on commit; other linters run in CI via `npm test`.
- Playwright tests expect a sibling `dictionaries/` clone of the repo's `dictionaries`
  branch — see `CONTRIBUTING.md` for the `git clone --branch dictionaries` step.
