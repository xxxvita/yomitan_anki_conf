# flib-site

A byte-for-byte copy of the flib.club video player (`web/` of the site repository,
commit `8799b6c6f30a155f6af8ee1251a8fb156ea6d8ab`, see `SOURCE.json`).

**Do not edit anything here by hand.** The copy is changed only by
`dev/flib-site-sync.js`:

```bash
node dev/flib-site-sync.js --site <path to the site repo> --commit <sha>
node dev/flib-site-sync.js --site <path to the site repo> --commit <sha> --check
```

The set of files is computed by a machine: the esbuild metafile closure of
`web/src/pages/PlayerPage.tsx`, plus the site tests that import any file of that
closure, `vitest.setup.ts` and a fixed list of config, font and style files.
`SOURCE.json` records every file with its sha256; `test/flib-site-verbatim.test.js`
checks the copy against it. `TEST-BASELINE.json` is the site's own test result at
that commit (`--baseline <vitest json>`).

The two movie stills `web/src/site/img/clip-zootopia.png` and `clip-phm.png` are
replaced by single-colour placeholder PNGs of the same size (`replaced:
"placeholder"` in `SOURCE.json`).

Inside the extension this code is distributed under GPL-3.0-or-later. It is not
linted, type-checked or tested by the extension's own tooling.
