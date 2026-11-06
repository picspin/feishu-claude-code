#!/usr/bin/env bash
# Build, codesign, notarize, and staple a Dardanus DMG for direct distribution.
#
# Required env (or pass flags):
#   APPLE_ID              Apple ID email for notarytool
#   APPLE_TEAM_ID         10-char Team ID
#   APPLE_APP_PASSWORD    app-specific password (or use keychain profile)
#   CODESIGN_IDENTITY     e.g. "Developer ID Application: Name (TEAMID)"
#
# Optional:
#   NOTARY_PROFILE        keychain profile name for `xcrun notarytool --keychain-profile`
#   SKIP_NOTARIZE=1       build + sign only
#   SKIP_BUILD=1          reuse existing bundle
#
# Example:
#   export CODESIGN_IDENTITY="Developer ID Application: Hilbert (XXXXXXXXXX)"
#   export APPLE_ID="you@example.com"
#   export APPLE_TEAM_ID="XXXXXXXXXX"
#   export APPLE_APP_PASSWORD="xxxx-xxxx-xxxx-xxxx"
#   ./scripts/release-dmg.sh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CRAB_DIR="${ROOT_DIR}/crab-pet"
TAURI_DIR="${CRAB_DIR}/src-tauri"
ENTITLEMENTS="${TAURI_DIR}/entitlements/app.entitlements"
PRODUCT_NAME="Dardanus"
BUNDLE_ID_DEFAULT="com.hilbert.dardanus"

log() { printf '==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "missing command: $1"
}

resolve_app_path() {
  local app
  app="$(find "${TAURI_DIR}/target/release/bundle/macos" -maxdepth 1 -name "${PRODUCT_NAME}.app" -print -quit 2>/dev/null || true)"
  if [[ -z "${app}" ]]; then
    app="$(find "${TAURI_DIR}/target/release/bundle/macos" -maxdepth 1 -name "*.app" -print -quit 2>/dev/null || true)"
  fi
  [[ -n "${app}" && -d "${app}" ]] || die "could not find built .app under target/release/bundle/macos"
  printf '%s\n' "${app}"
}

resolve_dmg_path() {
  local dmg
  dmg="$(find "${TAURI_DIR}/target/release/bundle/dmg" -maxdepth 1 -name "*.dmg" -print -quit 2>/dev/null || true)"
  [[ -n "${dmg}" && -f "${dmg}" ]] || die "could not find built .dmg under target/release/bundle/dmg"
  printf '%s\n' "${dmg}"
}

export PATH="${HOME}/.cargo/bin:${HOME}/.rustup/toolchains/stable-aarch64-apple-darwin/bin:${PATH}"
if command -v xcrun >/dev/null 2>&1; then
  export CC="$(xcrun -f clang 2>/dev/null || printf clang)"
  export CXX="$(xcrun -f clang++ 2>/dev/null || printf clang++)"
  export CARGO_TARGET_AARCH64_APPLE_DARWIN_LINKER="$(xcrun -f clang 2>/dev/null || printf clang)"
fi

require_cmd npm
require_cmd xcrun
require_cmd codesign
require_cmd ditto

IDENTITY="${CODESIGN_IDENTITY:-${1:-}}"
[[ -n "${IDENTITY}" ]] || die "set CODESIGN_IDENTITY or pass identity as first argument"

if [[ ! -f "${ENTITLEMENTS}" ]]; then
  die "entitlements not found: ${ENTITLEMENTS}"
fi

cd "${CRAB_DIR}"

if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  log "install npm deps"
  npm install
  log "build frontend + tauri release bundle"
  npm run tauri -- build
else
  log "SKIP_BUILD=1 — reusing existing bundle"
fi

APP_PATH="$(resolve_app_path)"
log "app: ${APP_PATH}"

log "codesign nested frameworks/helpers (deep, runtime, hardened)"
codesign --force --deep --options runtime \
  --entitlements "${ENTITLEMENTS}" \
  --sign "${IDENTITY}" \
  "${APP_PATH}"

log "verify signature"
codesign --verify --deep --strict --verbose=2 "${APP_PATH}"
spctl --assess --type execute --verbose=4 "${APP_PATH}" || true

DMG_PATH="$(resolve_dmg_path)"
log "dmg: ${DMG_PATH}"

# Re-sign DMG contents are already signed with the .app; still sign the DMG container if needed.
# Tauri-produced DMG may need re-signing of the app before packaging; we rebuild DMG from signed app when hdiutil is available.
SIGNED_STAGING="${TAURI_DIR}/target/release/bundle/dmg-signed"
rm -rf "${SIGNED_STAGING}"
mkdir -p "${SIGNED_STAGING}"
VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "${APP_PATH}/Contents/Info.plist" 2>/dev/null || echo "0.1.0")"
OUT_DMG="${SIGNED_STAGING}/${PRODUCT_NAME}_${VERSION}_signed.dmg"

log "create fresh DMG from signed app → ${OUT_DMG}"
ditto "${APP_PATH}" "${SIGNED_STAGING}/${PRODUCT_NAME}.app"
hdiutil create -volname "${PRODUCT_NAME}" -srcfolder "${SIGNED_STAGING}/${PRODUCT_NAME}.app" -ov -format UDZO "${OUT_DMG}"

if [[ "${SKIP_NOTARIZE:-0}" == "1" ]]; then
  log "SKIP_NOTARIZE=1 — signed DMG at ${OUT_DMG}"
  exit 0
fi

require_cmd xcrun

if [[ -n "${NOTARY_PROFILE:-}" ]]; then
  log "submit notarization with keychain profile ${NOTARY_PROFILE}"
  xcrun notarytool submit "${OUT_DMG}" --keychain-profile "${NOTARY_PROFILE}" --wait
else
  [[ -n "${APPLE_ID:-}" ]] || die "set APPLE_ID or NOTARY_PROFILE"
  [[ -n "${APPLE_TEAM_ID:-}" ]] || die "set APPLE_TEAM_ID or NOTARY_PROFILE"
  [[ -n "${APPLE_APP_PASSWORD:-}" ]] || die "set APPLE_APP_PASSWORD or NOTARY_PROFILE"
  log "submit notarization as ${APPLE_ID} / team ${APPLE_TEAM_ID}"
  xcrun notarytool submit "${OUT_DMG}" \
    --apple-id "${APPLE_ID}" \
    --team-id "${APPLE_TEAM_ID}" \
    --password "${APPLE_APP_PASSWORD}" \
    --wait
fi

log "staple ticket"
xcrun stapler staple "${OUT_DMG}"
xcrun stapler validate "${OUT_DMG}"

log "done"
log "  signed+notarized DMG: ${OUT_DMG}"
log "  app bundle id default: ${BUNDLE_ID_DEFAULT}"
log "  gatekeeper check: spctl --assess --type open --context context:primary-signature -v \"${OUT_DMG}\""
