# Releasing

The R2 credentials exist only as GitHub secrets. Anything built on a developer
machine reaches the public bucket the same way:

1. attach the files to a GitHub Release;
2. run the **Publish release assets to R2** workflow
   (`.github/workflows/publish-assets.yml`).

The workflow checks the files first and uploads nothing if a check fails. The
upload logic is in `scripts/r2-publish-release-assets.sh`. Run it with
`DRY_RUN=1` to see the checks and the planned uploads without credentials.

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

It uploads `dictionaries/<revision>/{wty-en-en.zip, flibooster-en-ru.zip, build.json}`
with a one-year immutable cache. Only after that does it write
`dictionaries/latest.json` (5-minute cache):

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

`build.json` is published as is. It holds the source paths of the owner's
machine, and it is already public as a release asset.

## Firefox XPI

1. Add an entry to `releases/firefox-updates.json` for the new version: the
   4-segment version (`0.4.0.0`) and
   `update_link` = `<R2 public base>/releases/v0.4.0/yomitan-firefox.xpi`.
   Keep the older entries. Commit it **before** tagging: the workflow reads the
   file from the tag.
2. Tag and push `v0.4.0`. `release.yml` builds all variants, uploads the
   unsigned zips to R2 and creates the GitHub Release `v0.4.0`.
3. Upload `yomitan-firefox.zip` to AMO as **unlisted**, then download the signed
   `.xpi`.
4. Wait until `release.yml` has finished. It deletes and recreates the release
   when a tag is re-pushed, which also drops uploaded assets. Then attach the
   XPI: `gh release upload v0.4.0 ~/Downloads/flib-club-0.4.0.xpi`.
5. Run the workflow:
   `gh workflow run publish-assets.yml -f kind=firefox-xpi -f tag=v0.4.0`.

The workflow checks that:

- the release carries exactly one `*.xpi`;
- the XPI is signed (it has `META-INF/mozilla.rsa` or `META-INF/cose.sig`);
- its `manifest.json` version is the tag padded to 4 segments;
- its gecko id has an entry for that version in the tag's
  `firefox-updates.json`, with exactly the expected `update_link`;
- that `firefox-updates.json` keeps every version in the published manifest
  (no rollback from an old tag).

It then uploads, in this order:

1. `releases/v<ver>/yomitan-firefox.xpi` (immutable);
2. `releases/latest/yomitan-firefox.xpi` (5-minute cache; the website links to
   it), but only if this is the newest version in the manifest;
3. `releases/firefox-updates.json` (5-minute cache), last.

### Who publishes `firefox-updates.json`

Only the XPI publish does: this workflow, or the local script below.
`release.yml` no longer uploads it. A tag push only has the unsigned zip, so
publishing the manifest then would send Firefox installs to an `update_link`
that does not exist until the signed XPI is uploaded.

With local R2 credentials, `scripts/firefox-publish-signed.sh <ver> <xpi>`
still works. It uploads the same three objects, but it reads
`firefox-updates.json` from the working tree rather than from the tag.

## Bucket CORS

On Firefox, extension pages fetch `latest.json` and the zips cross-origin. Run
the workflow once with `kind=cors` (the tag is ignored). It sets the bucket
policy to: GET and HEAD from any origin, no credentials.

If the R2 token cannot change bucket settings, the run logs an AccessDenied
warning and still succeeds. Then set the policy by hand: Cloudflare dashboard →
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
