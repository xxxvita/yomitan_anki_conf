# Releasing

The R2 credentials exist only as GitHub secrets. Anything built on a developer
machine reaches the public bucket the same way:

1. attach the files to a GitHub Release;
2. run the **Publish release assets to R2** workflow
   (`.github/workflows/publish-assets.yml`).

The workflow checks the files first and uploads nothing if a check fails.

Rules that apply to every run:

- **The workflow must be on the default branch.** `gh workflow run` only finds
  a `workflow_dispatch` workflow that exists on `main`. So merge the branch that
  adds or changes `publish-assets.yml` into `main` first (see step 0 below).
- **Never create the release as a draft.** The workflow runs with
  `contents: read`, and that token cannot see draft releases, so
  `gh release download` fails. Use `--prerelease` instead if the release
  should not look final.

## Checking locally (DRY_RUN)

The upload logic is in `scripts/r2-publish-release-assets.sh`. With
`DRY_RUN=1` it runs every check and prints the planned uploads. It needs no
credentials and makes no network calls (it skips the existence check of
immutable objects and the rollback check against the published
`firefox-updates.json`). The three R2 variables must still be set, because the
URLs written into the manifests come from them:

```bash
export DRY_RUN=1 R2_BUCKET=dry-run R2_ENDPOINT_URL=https://dry-run.invalid \
  R2_PUBLIC_BASE_URL=https://pub-5cf47e052a1b41d0ad8c4ddf5fc03c1e.r2.dev
REV=2125428-2008035-f45589d9b800
scripts/r2-publish-release-assets.sh dictionaries "dict-$REV" "builds/dictionaries/$REV"
# a directory holding exactly one signed .xpi:
scripts/r2-publish-release-assets.sh firefox-xpi v0.4.0 ~/xpi-dir releases/firefox-updates.json
scripts/r2-publish-release-assets.sh cors
```

## Step 0: merge, then tag

1. Merge the branch with the workflow (and the `firefox-updates.json` entry for
   the new version) into `main`.
2. Only then tag `v0.4.0` on `main`. A tag made before the merge carries the old
   `firefox-updates.json`, and the Firefox publish refuses it.

## State on 2026-10-18

- The live `releases/firefox-updates.json` advertises `0.3.1.0`, but its
  `update_link` (`releases/v0.3.1/yomitan-firefox.xpi`) returns 404. Installed
  Firefox copies fail that update silently until an XPI is published.
- `releases/latest/yomitan-firefox.xpi`, which the website links to, returns
  404 until the first `kind=firefox-xpi` publish.
- `dictionaries/latest.json` returns 404 until the first `kind=dictionaries`
  publish.

## Dictionaries

1. Build the pair: `npm run build:dictionaries`. The output is
   `builds/dictionaries/<revision>/` (see [dictionary-pair.md](dictionary-pair.md)).
2. Create a release whose tag is `dict-<revision>` with the three files:

   ```bash
   REV=2125428-2008035-f45589d9b800
   D=builds/dictionaries/$REV
   gh release create "dict-$REV" --prerelease --title "Dictionaries $REV" \
     --notes "Dictionary pair $REV" \
     "$D/wty-en-en.zip" "$D/flibooster-en-ru.zip" "$D/build.json"
   ```

3. Run the workflow:
   `gh workflow run publish-assets.yml -f kind=dictionaries -f tag="dict-$REV"`.

The workflow checks that:

- both zips' `index.json` hold the same revision as the tag;
- each `index.json` title matches its file name;
- `build.json` holds the same revision and the sha256 of both zips.

It uploads `dictionaries/<revision>/{wty-en-en.zip, flibooster-en-ru.zip}`
with a one-year immutable cache, and `build.json` beside them with a 5-minute
cache: `build.json` is not part of the revision and may be replaced.

- A zip is never overwritten with different bytes. If the key already exists,
  its sha256 must match, or the run fails before any upload.
- The sha256 comes from the `x-amz-meta-sha256` metadata set on upload, not
  from the ETag: files over 8 MB go up as multipart, and a multipart ETag is not
  an MD5 of the object. An object without that metadata is downloaded and
  hashed.

Only after that does it write `dictionaries/latest.json` (5-minute cache):

```json
{
  "schema": 1,
  "revision": "<rev>",
  "published_at": "<iso utc>",
  "dictionaries": [
    {
      "title": "wty-en-en",
      "file": "wty-en-en.zip",
      "url": "…",
      "size": 0,
      "sha256": "…"
    },
    {
      "title": "flibooster-en-ru",
      "file": "flibooster-en-ru.zip",
      "url": "…",
      "size": 0,
      "sha256": "…"
    }
  ]
}
```

`latest.json` always follows the last run. Running the workflow for an older
`dict-*` tag rolls the dictionaries back.

`build.json` is published as the builder wrote it; it is public anyway as a
release asset.

## Firefox XPI

Since v0.4.2 Firefox is **listed on AMO**. AMO hosts the add-on and updates it,
so the manifest has no `update_url`: AMO rejects a listed version that has one
(`MANIFEST_UPDATE_URL`). Each version needs a new AMO submission.

R2 now serves only one purpose: it moves copies installed before v0.4.2 onto
AMO. Those copies still read `firefox-updates.json`, and a version without
`update_url` then updates from AMO.

1. Add an entry to `releases/firefox-updates.json` for the new version: the
   4-segment version (`0.4.2.0`),
   `update_link` = `<R2 public base>/releases/v0.4.2/yomitan-firefox.xpi` and
   the same `strict_min_version` as the manifest. Keep the older entries.
   Commit it **before** tagging: the workflow reads the file from the tag.
2. Lint before tagging, in listed mode, so a rejected build does not use up a
   version number: `npx addons-linter builds/yomitan-firefox.zip` must report
   0 errors.
3. Tag and push `v0.4.2`. `release.yml` builds all variants, uploads the
   unsigned zips to R2 and creates the GitHub Release `v0.4.2`.
4. Make the source archive:
   `git archive --format=zip --prefix=flib-club-0.4.2/ -o flib-club-0.4.2-source.zip v0.4.2`.
5. On AMO open the add-on's own page, **Upload New Version**, **On this site**.
   Upload `yomitan-firefox.zip` and the source archive. Texts for the form are in
   [AMO_SUBMISSION_NOTES.md](../AMO_SUBMISSION_NOTES.md).
6. Download the signed `.xpi` from the version's page on AMO.
7. Wait until `release.yml` has finished. It deletes and recreates the release
   when a tag is re-pushed, which also drops uploaded assets. Then attach the
   XPI: `gh release upload v0.4.2 ~/Downloads/flib-club-0.4.2.xpi -R xxxvita/yomitan_anki_conf`.
8. Run the workflow:
   `gh workflow run publish-assets.yml -R xxxvita/yomitan_anki_conf --ref main -f kind=firefox-xpi -f tag=v0.4.2`.

Publish versions from oldest to newest. The rollback check compares the tag's
`firefox-updates.json` with the published one. So once v0.4.2 is published, an
older tag can no longer be published, because its file lacks `0.4.2.0`.

An entry whose XPI was never published (`0.4.0.0`, if AMO did not sign it in
time) is harmless for Firefox 140 and later, which take the newest compatible
version. Firefox 115–139 would pick that entry, get a 404 and stay on the
installed version without any message.

The workflow checks that:

- the release carries exactly one `*.xpi`;
- the XPI is signed (it has `META-INF/mozilla.rsa` or `META-INF/cose.sig`);
- its `manifest.json` version is the tag padded to 4 segments;
- its gecko id has an entry for that version in the tag's
  `firefox-updates.json`, with exactly the expected `update_link`;
- that `firefox-updates.json` keeps every version in the published manifest
  (no rollback from an old tag).

It then uploads, in this order:

1. `releases/v<ver>/yomitan-firefox.xpi` (immutable, with `x-amz-meta-sha256`;
   like the dictionary zips, it is never overwritten with different bytes);
2. `releases/latest/yomitan-firefox.xpi` (5-minute cache; the website links to
   it), but only if this is the newest version in the manifest;
3. `releases/firefox-updates.json` (5-minute cache), last.

### Who publishes `firefox-updates.json`

Only the XPI publish does: this workflow, or the local script below.
`release.yml` no longer uploads it. A tag push only has the unsigned zip, so
publishing the manifest then would send Firefox installs to an `update_link`
that does not exist until the signed XPI is uploaded.

With local R2 credentials, `scripts/firefox-publish-signed.sh <ver> <xpi>`
still works. It calls `r2-publish-release-assets.sh firefox-xpi`, so it runs
the same checks and uploads the same three objects. The one difference: it
reads `firefox-updates.json` from the working tree rather than from the tag.

## Bucket CORS

On Firefox, extension pages fetch `latest.json` and the zips cross-origin.
**Run the workflow with `kind=cors` before releasing the extension version that
downloads dictionaries**; otherwise that version's downloads fail in Firefox.
The tag is ignored. The run sets the bucket policy to: GET and HEAD from any
origin, no credentials.

If the R2 token cannot change bucket settings, the run logs an AccessDenied
warning, also shown in the run's summary, and still succeeds. Then set the policy by hand: Cloudflare dashboard →
R2 → the bucket → Settings → CORS Policy:

```json
[
  {
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": [
      "Content-Length",
      "Content-Type",
      "ETag",
      "Last-Modified"
    ],
    "MaxAgeSeconds": 86400
  }
]
```
