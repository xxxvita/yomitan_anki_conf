# Deploying the bundled dictionary with a provisioning build

The builds in `./builds` ship **without** the dictionary (to keep the archives small).
The provisioning code is active: on a fresh install the welcome page auto-imports the
dictionary **if** it finds the zip at a fixed path inside the extension. You place that
zip when you deploy a build to a client.

## The one rule

The dictionary file must end up at this exact path inside the extension root:

```
data/provisioning/dictionaries/wty-en-en.zip
```

- The filename must be exactly `wty-en-en.zip` — it must match the entry in
  `data/provisioning/dictionaries.json`.
- The zip's internal `index.json` `title` must be `wty-en-en` (it is).
- The empty `data/provisioning/dictionaries/` folder already exists in every build, so the
  target directory is there after you unzip.

Source file: `wty-en-en.zip` (~111 MB), e.g. `/home/xxxvita/Downloads/wty-en-en.zip`.

## Per browser

### Chrome / Edge / Chrome-dev — load unpacked (the deployment path)

`yomitan-chrome.zip`, `yomitan-edge.zip`, `yomitan-chrome-dev.zip`.

```bash
# 1. unzip the build into a folder
unzip yomitan-chrome.zip -d yomitan-chrome

# 2. drop the dictionary into the fixed path
cp wty-en-en.zip yomitan-chrome/data/provisioning/dictionaries/wty-en-en.zip
```

Then in the browser: `chrome://extensions` (or `edge://extensions`) → enable **Developer
mode** → **Load unpacked** → select the `yomitan-chrome/` folder. On first load the welcome
page imports the dictionary with a progress bar.

> A packed Web-Store install (.crx) cannot be modified after the fact — this copy step only
> applies to **unpacked / sideloaded** installs, which is how the client build is deployed.

### Firefox — load unpacked folder (simplest)

`yomitan-firefox.zip` / `yomitan-firefox-dev.zip`.

```bash
unzip yomitan-firefox.zip -d yomitan-firefox
cp wty-en-en.zip yomitan-firefox/data/provisioning/dictionaries/wty-en-en.zip
```

Then `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → pick
`yomitan-firefox/manifest.json`.

### Firefox — keep it as one packed zip (signed / sideload)

If you must ship a single zip, inject the file into the archive at the exact internal path,
then sign/sideload:

```bash
mkdir -p stage/data/provisioning/dictionaries
cp wty-en-en.zip stage/data/provisioning/dictionaries/wty-en-en.zip
( cd stage && zip -r ../yomitan-firefox.zip data/provisioning/dictionaries/wty-en-en.zip )
rm -rf stage
```

(Add the file **before** signing. After signing the archive is sealed.)

### Firefox for Android — already a folder

`builds/yomitan-firefox-android/` is unpacked already:

```bash
cp wty-en-en.zip builds/yomitan-firefox-android/data/provisioning/dictionaries/wty-en-en.zip
```

Then run via `web-ext run --target=firefox-android -s ./builds/yomitan-firefox-android`.

## Verifying after deploy

After the copy, the zip should be inside the extension root:

```bash
ls -l yomitan-chrome/data/provisioning/dictionaries/wty-en-en.zip   # unpacked
# or, for a packed zip:
unzip -l yomitan-firefox.zip | grep dictionaries/wty-en-en.zip
```

First install → the welcome page shows dictionary-import progress → after it finishes,
lookups work and the Anki "+" is active (options were already seeded). A reload does not
re-import (the `provisioningDone` marker is set). If the zip is missing, the welcome page
skips the import silently and lookups stay empty until a dictionary is imported manually.
