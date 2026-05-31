# Self-provisioning build Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make this fork's build come up pre-configured on a fresh install — seed Yomitan options from a bundled file and auto-import a bundled dictionary on the welcome page — with zero effect on builds that lack the provisioning assets.

**Architecture:** Two independent units. Unit A: `OptionsUtil.load()` seeds options from `ext/data/provisioning/default-options.json` (via a small testable fetch helper) only when storage is empty. Unit B: the welcome page, on first run, imports dictionaries listed in `ext/data/provisioning/dictionaries.json` by reusing the existing `importDictionaryFromUrl` flow, gated by a `provisioningDone` marker. The dictionary zip is injected at build time (gitignored); the JSON assets are committed.

**Tech Stack:** Vanilla ES modules, JSDoc + TypeScript `checkJs`, Vitest, MV3 extension. Spec: `docs/superpowers/specs/2026-05-31-self-provisioning-build-design.md`.

---

## File Structure

- **Create (committed)** `ext/data/provisioning/default-options.json` — seeded options (export's `options`, dictionaries emptied).
- **Create (committed)** `ext/data/provisioning/dictionaries.json` — manifest `[{file, title}]`.
- **Modify** `.gitignore` — ignore `ext/data/provisioning/dictionaries/*.zip` (build-time injected).
- **Create** `ext/js/data/provisioning-options.js` — pure `fetchProvisionedDefaultOptions(fetchImpl, getUrl)`.
- **Modify** `ext/js/data/options-util.js` — fresh-install branch calls the helper.
- **Create** `ext/js/pages/common/provisioning-controller.js` — pure `computeDictionariesToImport(...)` + `runDictionaryProvisioning(...)` runner.
- **Modify** `ext/js/pages/welcome-main.js` — invoke the runner after controllers are prepared.
- **Test** `test/provisioning-options.test.js`, `test/provisioning-controller.test.js`.

---

## Task 1: Provisioning assets + gitignore

**Files:**

- Create: `ext/data/provisioning/default-options.json`
- Create: `ext/data/provisioning/dictionaries.json`
- Modify: `.gitignore`

- [ ] **Step 1: Generate `default-options.json` from the Chrome export (dictionaries emptied)**

Run exactly:

```bash
node -e '
const fs = require("fs");
const src = "/home/xxxvita/Work/English/services/anki_conf_deploy/turmalin_build/temp/yomitan-settings-2026-05-31-15-44-50.json";
const d = JSON.parse(fs.readFileSync(src, "utf8"));
const o = d.options;
if (!o || !Array.isArray(o.profiles)) { throw new Error("export has no options.profiles"); }
for (const p of o.profiles) { p.options.dictionaries = []; }
fs.mkdirSync("ext/data/provisioning", {recursive: true});
fs.writeFileSync("ext/data/provisioning/default-options.json", JSON.stringify(o, null, 4) + "\n");
console.log("version:", o.version, "profiles:", o.profiles.length);
'
```

Expected stdout: `version: 75 profiles: 1`.

- [ ] **Step 2: Assert the asset matches the build schema version (edge case #3)**

Run:

```bash
node -e '
const fs = require("fs");
const o = JSON.parse(fs.readFileSync("ext/data/provisioning/default-options.json", "utf8"));
const s = fs.readFileSync("ext/js/data/options-util.js", "utf8");
const buildVersion = [...s.matchAll(/^\s+this\._updateVersion(\d+),/gm)].map((m) => +m[1]).reduce((a, b) => Math.max(a, b), 0);
if (o.version !== buildVersion) { throw new Error(`bundle version ${o.version} != build schema ${buildVersion}`); }
for (const p of o.profiles) { if (p.options.dictionaries.length !== 0) { throw new Error("dictionaries not emptied"); } }
console.log("OK: version", o.version, "dictionaries emptied");
'
```

Expected: `OK: version 75 dictionaries emptied`.

- [ ] **Step 3: Create `ext/data/provisioning/dictionaries.json`**

```json
[{ "file": "wty-en-en.zip", "title": "wty-en-en" }]
```

- [ ] **Step 4: Add the zip glob to `.gitignore`**

Append this line to `.gitignore`:

```
ext/data/provisioning/dictionaries/*.zip
```

- [ ] **Step 5: Verify lint accepts the JSON assets**

Run: `npx eslint 'ext/data/provisioning/*.json'`
Expected: exit 0 (no output). If eslint reformats, re-run until clean.

- [ ] **Step 6: Commit**

```bash
git add ext/data/provisioning/default-options.json ext/data/provisioning/dictionaries.json .gitignore
git commit -m "feat(provisioning): bundled default options + dictionary manifest"
```

---

## Task 2: `fetchProvisionedDefaultOptions` pure helper (TDD)

**Files:**

- Create: `ext/js/data/provisioning-options.js`
- Test: `test/provisioning-options.test.js`

- [ ] **Step 1: Write the failing test `test/provisioning-options.test.js`**

```javascript
/*
 * Copyright (C) 2025  Yomitan Authors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { describe, expect, test, vi } from "vitest";
import { fetchProvisionedDefaultOptions } from "../ext/js/data/provisioning-options.js";

const getUrl = (path) => `chrome-extension://x/${path}`;

describe("fetchProvisionedDefaultOptions", () => {
  test("returns parsed options when the asset exists", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      text: async () => '{"version":75,"profiles":[]}',
    }));
    const result = await fetchProvisionedDefaultOptions(fetchImpl, getUrl);
    expect(result).toEqual({ version: 75, profiles: [] });
    expect(fetchImpl).toHaveBeenCalledWith(
      "chrome-extension://x/data/provisioning/default-options.json",
    );
  });
  test("returns null on non-ok response (asset absent)", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, text: async () => "" }));
    expect(await fetchProvisionedDefaultOptions(fetchImpl, getUrl)).toBeNull();
  });
  test("returns null when fetch throws", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ERR_FILE_NOT_FOUND");
    });
    expect(await fetchProvisionedDefaultOptions(fetchImpl, getUrl)).toBeNull();
  });
  test("returns null on malformed JSON", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      text: async () => "not json",
    }));
    expect(await fetchProvisionedDefaultOptions(fetchImpl, getUrl)).toBeNull();
  });
  test("returns null when payload is not an object", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, text: async () => "42" }));
    expect(await fetchProvisionedDefaultOptions(fetchImpl, getUrl)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/provisioning-options.test.js`
Expected: FAIL — cannot resolve `../ext/js/data/provisioning-options.js`.

- [ ] **Step 3: Implement `ext/js/data/provisioning-options.js`**

```javascript
/*
 * Copyright (C) 2025  Yomitan Authors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { parseJson } from "../core/json.js";

/**
 * Path (relative to the extension root) of the bundled seed options.
 */
const PROVISIONED_OPTIONS_PATH = "data/provisioning/default-options.json";

/**
 * Fetch the bundled provisioning options, if the build includes them. Returns the raw
 * parsed object (NOT migrated/validated — the caller runs it through OptionsUtil.update),
 * or null when the asset is absent or unreadable. Never throws.
 * @param {(input: string) => Promise<{ok: boolean, text: () => Promise<string>}>} fetchImpl
 * @param {(path: string) => string} getUrl
 * @returns {Promise<?import('settings').Options>}
 */
export async function fetchProvisionedDefaultOptions(fetchImpl, getUrl) {
  try {
    const response = await fetchImpl(getUrl(PROVISIONED_OPTIONS_PATH));
    if (!response.ok) {
      return null;
    }
    const text = await response.text();
    const parsed = parseJson(text);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return null;
    }
    return /** @type {import('settings').Options} */ (parsed);
  } catch (e) {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/provisioning-options.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Run lint/types and commit**

Run: `npm run test:fast`
Expected: PASS.

```bash
git add ext/js/data/provisioning-options.js test/provisioning-options.test.js
git commit -m "feat(provisioning): fetchProvisionedDefaultOptions helper + tests"
```

---

## Task 3: Seed options on fresh install (Unit A)

**Files:**

- Modify: `ext/js/data/options-util.js` (import + `load()` else-branch, ~116-145)

- [ ] **Step 1: Add the import**

Near the other `./` imports at the top of `ext/js/data/options-util.js`, add:

```javascript
import { fetchProvisionedDefaultOptions } from "./provisioning-options.js";
```

- [ ] **Step 2: Change the fresh-install branch of `load()`**

Replace this exact block:

```javascript
if (typeof options !== "undefined") {
  options = await this.update(options);
  await this.save(options);
} else {
  options = this.getDefault();
}

return options;
```

with:

```javascript
if (typeof options !== "undefined") {
  options = await this.update(options);
  await this.save(options);
} else {
  const provisioned = await fetchProvisionedDefaultOptions(fetch, (path) =>
    chrome.runtime.getURL(path),
  );
  if (provisioned !== null) {
    options = await this.update(provisioned);
    await this.save(options);
  } else {
    options = this.getDefault();
  }
}

return options;
```

- [ ] **Step 3: Run lint/types/tests**

Run: `npm run test:fast`
Expected: PASS. (`this.update()` already validates the seeded options against the schema; existing options-util tests still pass.)

- [ ] **Step 4: Commit**

```bash
git add ext/js/data/options-util.js
git commit -m "feat(provisioning): seed options from bundle on fresh install"
```

---

## Task 4: `computeDictionariesToImport` pure decision (TDD)

**Files:**

- Create: `ext/js/pages/common/provisioning-controller.js` (pure function only in this task)
- Test: `test/provisioning-controller.test.js`

- [ ] **Step 1: Write the failing test `test/provisioning-controller.test.js`**

```javascript
/*
 * Copyright (C) 2025  Yomitan Authors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { describe, expect, test } from "vitest";
import { computeDictionariesToImport } from "../ext/js/pages/common/provisioning-controller.js";

const manifest = [
  { file: "a.zip", title: "A" },
  { file: "b.zip", title: "B" },
];

describe("computeDictionariesToImport", () => {
  test("returns nothing when already provisioned", () => {
    expect(computeDictionariesToImport(manifest, new Set(), true)).toEqual([]);
  });
  test("returns all entries when none imported", () => {
    expect(computeDictionariesToImport(manifest, new Set(), false)).toEqual(
      manifest,
    );
  });
  test("drops entries whose title is already imported", () => {
    expect(
      computeDictionariesToImport(manifest, new Set(["A"]), false),
    ).toEqual([{ file: "b.zip", title: "B" }]);
  });
  test("returns empty when all titles already imported", () => {
    expect(
      computeDictionariesToImport(manifest, new Set(["A", "B"]), false),
    ).toEqual([]);
  });
  test("tolerates a non-array manifest", () => {
    expect(computeDictionariesToImport(null, new Set(), false)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/provisioning-controller.test.js`
Expected: FAIL — cannot resolve the module.

- [ ] **Step 3: Implement the pure function in `ext/js/pages/common/provisioning-controller.js`**

```javascript
/*
 * Copyright (C) 2025  Yomitan Authors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * @typedef {{file: string, title: string}} ProvisioningDictionaryEntry
 */

/**
 * Decide which bundled dictionaries still need importing.
 * @param {unknown} manifest Parsed dictionaries.json (expected: ProvisioningDictionaryEntry[]).
 * @param {Set<string>} importedTitles Titles already present in the dictionary DB.
 * @param {boolean} provisioningDone Whether provisioning already completed once.
 * @returns {ProvisioningDictionaryEntry[]}
 */
export function computeDictionariesToImport(
  manifest,
  importedTitles,
  provisioningDone,
) {
  if (provisioningDone || !Array.isArray(manifest)) {
    return [];
  }
  return manifest.filter((entry) => !importedTitles.has(entry.title));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/provisioning-controller.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add ext/js/pages/common/provisioning-controller.js test/provisioning-controller.test.js
git commit -m "feat(provisioning): computeDictionariesToImport decision + tests"
```

---

## Task 5: Dictionary auto-import runner + welcome wiring (Unit B)

**Files:**

- Modify: `ext/js/pages/common/provisioning-controller.js` (add the runner)
- Modify: `ext/js/pages/welcome-main.js` (invoke the runner)

- [ ] **Step 1: Add the runner to `provisioning-controller.js`**

Append these two functions (after `computeDictionariesToImport`):

```javascript
/**
 * @param {string} key
 * @returns {Promise<boolean>}
 */
function getProvisioningDone(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get([key], (store) => {
      resolve(store[key] === true);
    });
  });
}

/**
 * Run first-install dictionary provisioning: import any bundled dictionaries listed in
 * data/provisioning/dictionaries.json that are not yet present, reusing the existing
 * import-from-URL flow. Sets the `provisioningDone` marker once every manifest title is
 * present. Inert (returns early) when the manifest is absent or all zips are missing
 * (e.g. a build without the injected zip). Never throws.
 * @param {import('../settings/settings-controller.js').SettingsController} settingsController
 * @param {import('../../application.js').Application} application
 * @param {(path: string) => string} getUrl
 * @returns {Promise<void>}
 */
export async function runDictionaryProvisioning(
  settingsController,
  application,
  getUrl,
) {
  const markerKey = "provisioningDone";
  try {
    if (await getProvisioningDone(markerKey)) {
      return;
    }

    let manifest;
    try {
      const response = await fetch(
        getUrl("data/provisioning/dictionaries.json"),
      );
      if (!response.ok) {
        return;
      }
      manifest = JSON.parse(await response.text());
    } catch (e) {
      return;
    }

    const info = await application.api.getDictionaryInfo();
    const importedTitles = new Set(info.map((entry) => entry.title));
    const toImport = computeDictionariesToImport(
      manifest,
      importedTitles,
      false,
    );

    for (const entry of toImport) {
      const url = getUrl(`data/provisioning/dictionaries/${entry.file}`);
      try {
        const head = await fetch(url);
        if (!head.ok) {
          continue;
        }
      } catch (e) {
        // Zip not present in this build (e.g. dev build); skip silently.
        continue;
      }
      await new Promise((resolve) => {
        settingsController.trigger("importDictionaryFromUrl", {
          url,
          profilesDictionarySettings: null,
          onImportDone: () => {
            resolve();
          },
        });
      });
    }

    const infoAfter = await application.api.getDictionaryInfo();
    const titlesAfter = new Set(infoAfter.map((entry) => entry.title));
    if (
      Array.isArray(manifest) &&
      manifest.length > 0 &&
      manifest.every((entry) => titlesAfter.has(entry.title))
    ) {
      await new Promise((resolve) => {
        chrome.storage.local.set({ [markerKey]: true }, () => {
          resolve();
        });
      });
    }
  } catch (e) {
    log.error(e);
  }
}
```

- [ ] **Step 2: Add the `log` import to `provisioning-controller.js`**

At the top of the file (below the license header), add:

```javascript
import { log } from "../../core/log.js";
```

- [ ] **Step 3: Wire the runner into `welcome-main.js`**

Add the import near the other `./` imports:

```javascript
import { runDictionaryProvisioning } from "./common/provisioning-controller.js";
```

Then, inside the `Application.main` callback, replace this exact final block:

```javascript
await Promise.all(preparePromises);

document.documentElement.dataset.loaded = "true";
```

with:

```javascript
await Promise.all(preparePromises);

void runDictionaryProvisioning(settingsController, application, (path) =>
  chrome.runtime.getURL(path),
);

document.documentElement.dataset.loaded = "true";
```

- [ ] **Step 4: Run lint/types/tests**

Run: `npm run test:fast`
Expected: PASS. (tsc must accept `profilesDictionarySettings: null` and `onImportDone` — both are nullable in `types/ext/settings-controller.d.ts`.)

- [ ] **Step 5: Commit**

```bash
git add ext/js/pages/common/provisioning-controller.js ext/js/pages/welcome-main.js
git commit -m "feat(provisioning): auto-import bundled dictionary on welcome (first run)"
```

---

## Task 6: Verification + build-pipeline note

**Files:**

- Modify: `docs/superpowers/specs/2026-05-31-self-provisioning-build-design.md` (append a short "Build pipeline" note) — or a deploy doc if the project has one.

- [ ] **Step 1: Full fast pipeline**

Run: `npm run test:fast`
Expected: PASS (eslint, tsc on all jsconfigs, all unit tests incl. the two new files, JSON format).

- [ ] **Step 2: Document the pipeline requirement**

Append to the spec's "Files touched" section (or the deploy README) this note:

```markdown
## Build pipeline (turmalin)

Before packaging:

1. Drop the dictionary zip(s) named in `ext/data/provisioning/dictionaries.json` into
   `ext/data/provisioning/dictionaries/` (gitignored).
2. Re-run the version assert from Task 1 Step 2 so the bundled options match the build's
   schema version. Fail the build if it does not.
```

- [ ] **Step 3: Manual end-to-end matrix**

With the dictionary zip placed in `ext/data/provisioning/dictionaries/wty-en-en.zip`, load the unpacked extension into a clean Chrome profile and verify:

| Scenario                                             | Expected                                                                   |
| ---------------------------------------------------- | -------------------------------------------------------------------------- |
| Fresh install                                        | welcome page opens; status footer shows dictionary import progress         |
| After import                                         | Settings → Anki shows the seeded card formats (Anki "+" active on lookups) |
| Lookup a word                                        | definitions appear (dictionary present, enabled, no duplicate entry)       |
| Reload extension / reopen welcome                    | no re-import, no settings reset (`provisioningDone` set)                   |
| Build with the zip removed (dev)                     | welcome runs, skips import silently, no error toast                        |
| Build with `ext/data/provisioning/` removed entirely | byte-for-byte upstream behavior (schema defaults)                          |

- [ ] **Step 4: Commit any doc changes**

```bash
git add docs/superpowers/specs/2026-05-31-self-provisioning-build-design.md
git commit -m "docs(provisioning): build-pipeline note for dictionary zip injection"
```

---

## Notes for the implementer

- `OptionsUtil` runs in the service worker; `fetch` and `chrome.runtime.getURL` are available there. The bundled JSON is fetched from the extension's own origin — no `web_accessible_resources` entry needed (welcome.html and the SW are same-origin with packaged resources).
- The seeded options have empty `dictionaries` arrays on purpose: Unit B's import path (`_addDictionarySettings`) registers the dictionary, and it pushes unconditionally — pre-seeding the entry would create a duplicate.
- `onImportDone` fires in the importer's `finally` (success OR failure); the runner therefore re-queries `getDictionaryInfo()` and only sets the marker when every manifest title is actually present.
- Do not pre-read the zip body in the existence check — reading `response.ok` does not buffer the body; a missing packaged resource makes `fetch` reject (caught → skip).
- These changes are unrelated to the phrase-popup work already on this branch.
