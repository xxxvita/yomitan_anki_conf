#!/usr/bin/env bash
# Verify locally-produced release assets and mirror them to the public R2
# bucket. Called by .github/workflows/publish-assets.yml, where the R2
# credentials live as GitHub secrets; the developer machine has none.
#
# Usage:
#   r2-publish-release-assets.sh dictionaries <dict-REVISION> <assets-dir>
#   r2-publish-release-assets.sh firefox-xpi  <vX.Y.Z> <assets-dir> <firefox-updates.json from the tag>
#   r2-publish-release-assets.sh cors
#
# Required env:
#   R2_BUCKET, R2_ENDPOINT_URL, R2_PUBLIC_BASE_URL
#   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY (read by the aws cli)
# Optional env:
#   DRY_RUN=1   verify everything, print the uploads instead of running them,
#               and skip the network check of the published firefox-updates.json.
#
# Every check runs before the first upload. Upload order is chosen so a
# public manifest never points at a file that is not there yet:
#   dictionaries: both zips + build.json, then dictionaries/latest.json.
#   firefox-xpi:  versioned XPI, floating latest XPI, then firefox-updates.json.

set -euo pipefail

CACHE_IMMUTABLE='public, max-age=31536000, immutable'
CACHE_SHORT='public, max-age=300'

die() {
    echo "::error::$*" >&2
    exit 1
}

require_env() {
    local var
    for var in "$@"; do
        # Only the variable NAME is ever printed, never its value.
        [ -n "${!var:-}" ] || die "missing env var: ${var}"
    done
}

# r2_put <file> <key> <content-type> <cache-control> [sha256]
# With a sha256 the object also carries it as x-amz-meta-sha256.
r2_put() {
    local file="$1" key="$2" type="$3" cache="$4" sha="${5:-}"
    local meta=()
    [ -z "$sha" ] || meta=(--metadata "sha256=${sha}")
    echo "upload ${file} -> ${key} (${type}; ${cache}${sha:+; sha256 ${sha}})"
    if [ "${DRY_RUN:-}" = 1 ]; then
        return 0
    fi
    aws s3 cp "$file" "s3://${R2_BUCKET}/${key}" \
        --endpoint-url "$R2_ENDPOINT_URL" \
        --content-type "$type" \
        --cache-control "$cache" \
        "${meta[@]}" \
        --no-progress
}

sha256_of() {
    sha256sum "$1" | awk '{print $1}'
}

# assert_immutable_ok <key> <sha256>
# An immutable key may be re-uploaded only with identical bytes: CDNs and
# browsers cache it for a year, so different bytes under the same URL would
# never reach some clients. The comparison uses the x-amz-meta-sha256 we set
# on upload, NOT the ETag: aws s3 cp uploads files over 8 MB as multipart,
# and a multipart ETag is not the MD5 of the object. An object without the
# metadata (uploaded by hand) is downloaded and hashed instead.
assert_immutable_ok() {
    local key="$1" sha="$2" head err remote
    if [ "${DRY_RUN:-}" = 1 ]; then
        echo "dry run: skip existence check of ${key}"
        return 0
    fi
    err="$(mktemp)"
    if head="$(aws s3api head-object --bucket "$R2_BUCKET" --key "$key" \
        --endpoint-url "$R2_ENDPOINT_URL" --output json 2>"$err")"; then
        remote="$(jq -r '.Metadata.sha256 // empty' <<<"$head")"
        if [ -z "$remote" ]; then
            remote="$(aws s3 cp "s3://${R2_BUCKET}/${key}" - --endpoint-url "$R2_ENDPOINT_URL" --no-progress \
                | sha256sum | awk '{print $1}')" || die "could not download ${key} to hash it"
        fi
        [ "$remote" = "$sha" ] \
            || die "${key} already exists with sha256 ${remote}, not ${sha}. Immutable objects must not change; publish a new revision or version."
        echo "${key} already exists with the same sha256; re-uploading"
    elif grep -qE '\(404\) when calling the HeadObject operation|NoSuchKey' "$err"; then
        :
    else
        cat "$err" >&2
        die "could not check whether ${key} exists"
    fi
    rm -f "$err"
}

# --- dictionaries -----------------------------------------------------------

publish_dictionaries() {
    local tag="$1" dir="$2"
    [[ "$tag" =~ ^dict-([0-9]+-[0-9]+-[0-9a-f]{12})$ ]] \
        || die "tag '${tag}' is not dict-<rows>-<maxRowid>-<12 hex>"
    local rev="${BASH_REMATCH[1]}"

    # English (host) first, Russian second: this is also the order in latest.json.
    local files=(wty-en-en.zip flibooster-en-ru.zip)
    local f
    for f in "${files[@]}" build.json; do
        [ -f "${dir}/${f}" ] || die "release ${tag} has no asset ${f}"
    done

    local entries='[]' zip_rev title sha size
    for f in "${files[@]}"; do
        local index
        index="$(unzip -p "${dir}/${f}" index.json)" || die "${f}: no index.json inside"
        zip_rev="$(jq -r '.revision // empty' <<<"$index")"
        title="$(jq -r '.title // empty' <<<"$index")"
        [ "$zip_rev" = "$rev" ] \
            || die "${f}: index.json revision '${zip_rev}' differs from tag revision '${rev}'"
        # A swapped or renamed file would otherwise publish under the wrong name.
        [ "$title" = "${f%.zip}" ] || die "${f}: index.json title '${title}' does not match the file name"
        sha="$(sha256_of "${dir}/${f}")"
        size="$(stat -c '%s' "${dir}/${f}")"
        entries="$(jq \
            --arg title "$title" \
            --arg file "$f" \
            --arg url "${R2_PUBLIC_BASE_URL}/dictionaries/${rev}/${f}" \
            --argjson size "$size" \
            --arg sha "$sha" \
            '. + [{title: $title, file: $file, url: $url, size: $size, sha256: $sha}]' \
            <<<"$entries")"
    done

    # build.json must describe exactly these two zips.
    local build="${dir}/build.json"
    [ "$(jq -r '.revision // empty' "$build")" = "$rev" ] || die "build.json revision differs from ${rev}"
    [ "$(jq -r '.host.file // empty' "$build")" = wty-en-en.zip ] || die "build.json host.file is not wty-en-en.zip"
    [ "$(jq -r '.translation.file // empty' "$build")" = flibooster-en-ru.zip ] || die "build.json translation.file is not flibooster-en-ru.zip"
    [ "$(jq -r '.host.sha256 // empty' "$build")" = "$(sha256_of "${dir}/wty-en-en.zip")" ] \
        || die "wty-en-en.zip sha256 differs from build.json host.sha256"
    [ "$(jq -r '.translation.sha256 // empty' "$build")" = "$(sha256_of "${dir}/flibooster-en-ru.zip")" ] \
        || die "flibooster-en-ru.zip sha256 differs from build.json translation.sha256"

    local latest
    latest="$(mktemp)"
    jq -n \
        --arg rev "$rev" \
        --arg published_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        --argjson dictionaries "$entries" \
        '{schema: 1, revision: $rev, published_at: $published_at, dictionaries: $dictionaries}' \
        >"$latest"
    echo "--- dictionaries/latest.json ---"
    cat "$latest"

    for f in "${files[@]}"; do
        assert_immutable_ok "dictionaries/${rev}/${f}" "$(sha256_of "${dir}/${f}")"
    done
    for f in "${files[@]}"; do
        r2_put "${dir}/${f}" "dictionaries/${rev}/${f}" application/zip "$CACHE_IMMUTABLE" "$(sha256_of "${dir}/${f}")"
    done
    # build.json may change for the same revision (it is not part of it).
    # Short cache: it can be replaced, so it is not immutable.
    r2_put "$build" "dictionaries/${rev}/build.json" application/json "$CACHE_SHORT"
    # LAST: only now do both zips exist at the URLs the manifest names.
    r2_put "$latest" dictionaries/latest.json application/json "$CACHE_SHORT"
    rm -f "$latest"
}

# --- firefox-xpi ------------------------------------------------------------

publish_firefox_xpi() {
    local tag="$1" dir="$2" updates="$3"
    [[ "$tag" =~ ^v([0-9]+\.[0-9]+\.[0-9]+)$ ]] || die "tag '${tag}' is not vX.Y.Z"
    local ver="${BASH_REMATCH[1]}"
    local manifest_ver="${ver}.0"
    local key="releases/v${ver}/yomitan-firefox.xpi"
    local url="${R2_PUBLIC_BASE_URL}/${key}"

    local xpis=()
    shopt -s nullglob
    xpis=("${dir}"/*.xpi)
    shopt -u nullglob
    [ "${#xpis[@]}" -eq 1 ] || die "release ${tag} must carry exactly one .xpi asset, found ${#xpis[@]}"
    local xpi="${xpis[0]}"

    local names
    names="$(unzip -Z1 "$xpi")" || die "${xpi}: not a zip archive"
    grep -qxF -e META-INF/mozilla.rsa -e META-INF/cose.sig <<<"$names" \
        || die "${xpi}: not signed (no META-INF/mozilla.rsa or META-INF/cose.sig). Upload the AMO-signed .xpi, not the CI zip."

    local manifest xpi_ver addon_id
    manifest="$(unzip -p "$xpi" manifest.json)" || die "${xpi}: no manifest.json"
    xpi_ver="$(jq -r '.version // empty' <<<"$manifest")"
    addon_id="$(jq -r '.browser_specific_settings.gecko.id // empty' <<<"$manifest")"
    [ "$xpi_ver" = "$manifest_ver" ] || die "${xpi}: manifest version '${xpi_ver}' is not ${manifest_ver}"

    # Same contract as scripts/firefox-publish-signed.sh, but exact: this
    # addon id has an entry for this version whose update_link is our URL.
    [ -f "$updates" ] || die "firefox-updates.json from ${tag} not found"
    jq -e --arg id "$addon_id" '.addons | has($id)' "$updates" >/dev/null \
        || die "firefox-updates.json at ${tag} has no addon '${addon_id}' (the XPI's gecko id; firefox-dev build uploaded by mistake?)"
    local links
    links="$(jq -r --arg id "$addon_id" --arg v "$manifest_ver" \
        '.addons[$id].updates[] | select(.version == $v) | .update_link' "$updates")"
    [ -n "$links" ] || die "firefox-updates.json at ${tag} has no updates[] entry for ${manifest_ver}. Bump it, commit, and retag."
    [ "$links" = "$url" ] || die "firefox-updates.json at ${tag}: update_link for ${manifest_ver} is not ${url}"

    # Rollback guard: the published manifest must not lose a version that is
    # live today (e.g. running this for an old tag after a newer release).
    if [ "${DRY_RUN:-}" != 1 ]; then
        local published code
        published="$(mktemp)"
        code="$(curl -sS -o "$published" -w '%{http_code}' "${R2_PUBLIC_BASE_URL}/releases/firefox-updates.json")" \
            || die "could not fetch the published firefox-updates.json"
        if [ "$code" = 200 ]; then
            jq -e '.addons | type == "object"' "$published" >/dev/null 2>&1 \
                || die "the published ${R2_PUBLIC_BASE_URL}/releases/firefox-updates.json is not valid JSON with an .addons object; inspect it before overwriting"
            local missing
            missing="$(jq -r -n --slurpfile old "$published" --slurpfile new "$updates" --arg id "$addon_id" \
                '($new[0].addons[$id].updates | map(.version)) as $keep
                 | ($old[0].addons[$id].updates // [])[] | .version | select(. as $v | $keep | index($v) | not)')"
            [ -z "$missing" ] || die "firefox-updates.json at ${tag} drops published version(s): ${missing//$'\n'/ }. Publish from the newest tag."
        elif [ "$code" != 404 ]; then
            die "published firefox-updates.json returned HTTP ${code}"
        fi
        rm -f "$published"
    fi

    # The floating copy follows the newest version only.
    local newest
    newest="$(jq -r --arg id "$addon_id" '.addons[$id].updates[].version' "$updates" | sort -V | tail -n 1)"

    local xpi_sha
    xpi_sha="$(sha256_of "$xpi")"
    echo "signed XPI ${xpi}: version ${xpi_ver}, id ${addon_id}, sha256 ${xpi_sha}"
    assert_immutable_ok "$key" "$xpi_sha"
    r2_put "$xpi" "$key" application/x-xpinstall "$CACHE_IMMUTABLE" "$xpi_sha"
    if [ "$newest" = "$manifest_ver" ]; then
        r2_put "$xpi" releases/latest/yomitan-firefox.xpi application/x-xpinstall "$CACHE_SHORT"
    else
        echo "::notice::${manifest_ver} is not the newest version in firefox-updates.json (${newest}); releases/latest/yomitan-firefox.xpi left unchanged"
    fi
    # LAST: Firefox installs follow update_link as soon as they see the entry.
    r2_put "$updates" releases/firefox-updates.json application/json "$CACHE_SHORT"
}

# --- cors -------------------------------------------------------------------

apply_cors() {
    local config err
    config="$(mktemp)"
    err="$(mktemp)"
    # Public, read-only, no credentials: a wildcard origin makes browsers
    # refuse credentialed requests anyway.
    cat >"$config" <<'JSON'
{
  "CORSRules": [
    {
      "AllowedOrigins": ["*"],
      "AllowedMethods": ["GET", "HEAD"],
      "AllowedHeaders": ["*"],
      "ExposeHeaders": ["Content-Length", "Content-Type", "ETag", "Last-Modified"],
      "MaxAgeSeconds": 86400
    }
  ]
}
JSON
    echo "apply bucket CORS: GET/HEAD from any origin"
    if [ "${DRY_RUN:-}" = 1 ]; then
        cat "$config"
        return 0
    fi
    if aws s3api put-bucket-cors \
        --bucket "$R2_BUCKET" \
        --endpoint-url "$R2_ENDPOINT_URL" \
        --cors-configuration "file://${config}" 2>"$err"; then
        aws s3api get-bucket-cors --bucket "$R2_BUCKET" --endpoint-url "$R2_ENDPOINT_URL"
    elif grep -qE 'AccessDenied|Unauthorized|Forbidden|\(403\)' "$err"; then
        cat "$err" >&2
        local msg='The R2 token may not change bucket settings (AccessDenied). Set CORS by hand: Cloudflare dashboard -> R2 -> bucket -> Settings -> CORS Policy, allowing GET and HEAD from origin * (see docs/development/releasing.md). Assets are unaffected.'
        echo "::warning::${msg}"
        if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
            printf '### Bucket CORS was NOT applied\n\n%s\n' "$msg" >>"$GITHUB_STEP_SUMMARY"
        fi
    else
        cat "$err" >&2
        die "put-bucket-cors failed"
    fi
    rm -f "$config" "$err"
}

# --- main -------------------------------------------------------------------

main() {
    [ "$#" -ge 1 ] || die "usage: $0 dictionaries|firefox-xpi|cors ..."
    local kind="$1"
    shift
    require_env R2_BUCKET R2_ENDPOINT_URL R2_PUBLIC_BASE_URL
    if [ "${DRY_RUN:-}" != 1 ]; then
        require_env AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
    fi
    R2_PUBLIC_BASE_URL="${R2_PUBLIC_BASE_URL%/}"
    case "$kind" in
        dictionaries)
            [ "$#" -eq 2 ] || die "usage: $0 dictionaries <tag> <assets-dir>"
            publish_dictionaries "$1" "$2"
            ;;
        firefox-xpi)
            [ "$#" -eq 3 ] || die "usage: $0 firefox-xpi <tag> <assets-dir> <firefox-updates.json>"
            publish_firefox_xpi "$1" "$2" "$3"
            ;;
        cors)
            apply_cors
            ;;
        *)
            die "unknown kind '${kind}'"
            ;;
    esac
}

main "$@"
