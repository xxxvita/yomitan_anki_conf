#!/usr/bin/env bash
# build-all.sh — build every browser variant + unpack each zip into a sibling
# folder so Chrome / Edge / Opera can use "Load unpacked" without re-zipping.
#
# Usage:
#   scripts/build-all.sh                # build with default version 0.0.0.0
#   scripts/build-all.sh 1.2.3          # build with explicit version (3-part
#                                       # forms are padded to 4-part for the
#                                       # Chrome manifest, e.g. 1.2.3 -> 1.2.3.0)
#   scripts/build-all.sh 1.2.3 --clean  # also wipe builds/ before building
#   scripts/build-all.sh --no-unpack    # skip the unpack step (just the zips)
#
# Reads nothing from the environment; writes only inside the repo's builds/.
#
# Exit codes:
#   0 — success
#   1 — bad arg / missing tool / build failure
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BUILDS_DIR="${REPO_ROOT}/builds"
UNPACK_DIR="${BUILDS_DIR}/unpacked"

VARIANTS=(chrome chrome-dev edge firefox firefox-dev)

VERSION=""
CLEAN=0
UNPACK=1
for arg in "$@"; do
    case "${arg}" in
        --clean)     CLEAN=1 ;;
        --no-unpack) UNPACK=0 ;;
        --help|-h)
            sed -n '2,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
        --*)
            echo "error: unknown flag: ${arg}" >&2
            exit 1
            ;;
        *)
            if [ -z "${VERSION}" ]; then
                VERSION="${arg}"
            else
                echo "error: unexpected positional argument: ${arg}" >&2
                exit 1
            fi
            ;;
    esac
done

cd "${REPO_ROOT}"

# Sanity: required tooling.
for tool in node npm unzip; do
    if ! command -v "${tool}" >/dev/null 2>&1; then
        echo "error: ${tool} is required but not found in PATH" >&2
        exit 1
    fi
done

if [ ! -d node_modules ]; then
    echo "==> node_modules missing — running npm ci"
    npm ci
fi

if [ "${CLEAN}" -eq 1 ]; then
    echo "==> Wiping ${BUILDS_DIR}"
    rm -rf "${BUILDS_DIR}"
fi
mkdir -p "${BUILDS_DIR}"

# Normalize version: Chrome manifest needs Major.Minor.Patch.Build (4 parts).
# Drop a leading "v" if user passed "v1.2.3".
NORMALIZED_VERSION=""
if [ -n "${VERSION}" ]; then
    NORMALIZED_VERSION="${VERSION#v}"
    DOTS="$(printf '%s' "${NORMALIZED_VERSION}" | tr -cd '.' | wc -c)"
    while [ "${DOTS}" -lt 3 ]; do
        NORMALIZED_VERSION="${NORMALIZED_VERSION}.0"
        DOTS=$((DOTS + 1))
    done
fi

echo "==> Building all variants ${NORMALIZED_VERSION:+at version ${NORMALIZED_VERSION}}"
if [ -n "${NORMALIZED_VERSION}" ]; then
    npm run build -- --all --version "${NORMALIZED_VERSION}"
else
    npm run build
fi

echo
echo "==> Built artifacts in ${BUILDS_DIR}:"
ls -la "${BUILDS_DIR}" | grep -E '\.zip$|firefox-android' || true

if [ "${UNPACK}" -eq 0 ]; then
    echo
    echo "Done. (--no-unpack: skipped extracting zips.)"
    exit 0
fi

# Unpack each variant zip into builds/unpacked/<variant>/ for Load-unpacked
# use in Chromium-family browsers (Chrome / Edge / Opera / Brave / Vivaldi)
# and side-loading in Firefox dev builds.
echo
echo "==> Unpacking zips into ${UNPACK_DIR}/"
mkdir -p "${UNPACK_DIR}"
for variant in "${VARIANTS[@]}"; do
    zip_path="${BUILDS_DIR}/yomitan-${variant}.zip"
    if [ ! -f "${zip_path}" ]; then
        echo "  - skip ${variant}: ${zip_path} not found"
        continue
    fi
    dest="${UNPACK_DIR}/yomitan-${variant}"
    rm -rf "${dest}"
    mkdir -p "${dest}"
    unzip -q -o "${zip_path}" -d "${dest}"
    echo "  - ${variant}: ${dest}"
done

echo
echo "Done."
echo
echo "Load-unpacked paths:"
for variant in "${VARIANTS[@]}"; do
    dest="${UNPACK_DIR}/yomitan-${variant}"
    if [ -d "${dest}" ]; then
        printf '  %-14s %s\n' "${variant}" "${dest}"
    fi
done
echo
echo "Tips:"
echo "  Chrome / Edge / Opera : chrome://extensions -> Developer Mode -> Load unpacked -> pick the path above"
echo "  Firefox (Dev/Nightly) : about:debugging#/runtime/this-firefox -> Load Temporary Add-on -> pick manifest.json inside the unpacked dir"
echo "  Or run from CLI: <browser> --load-extension=<path> (Chromium family only)"
