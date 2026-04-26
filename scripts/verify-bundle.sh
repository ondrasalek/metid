#!/usr/bin/env zsh
# verify-bundle.sh — sanity-check the macOS bundle's signing + entitlements.
#
# What this checks (all read-only — modifies nothing):
#   • Bundle ID written into the Info.plist
#   • Code signature summary (identifier, authority, format, hardened-runtime flags)
#   • All entitlements baked into the signed binary
#   • TCC usage description strings present in Info.plist (without these,
#     macOS silently denies access — no prompt ever appears)
#
# Usage:
#   zsh scripts/verify-bundle.sh                              # default path
#   zsh scripts/verify-bundle.sh /Applications/metid.app      # installed app
#
# Run AFTER `npm run tauri build`.

set -euo pipefail

APP="${1:-src-tauri/target/release/bundle/macos/metid.app}"
echo "▸ verify-bundle: $APP"

if [[ ! -d "$APP" ]]; then
  echo "  error: app bundle not found at $APP" >&2
  echo "  build it first:  npm run tauri build" >&2
  exit 1
fi

INFO_PLIST="$APP/Contents/Info.plist"
BUNDLE_ID="$(plutil -extract CFBundleIdentifier raw -o - "$INFO_PLIST")"

echo
echo "── Bundle identifier ─────────────────────────────────────────────"
echo "  $BUNDLE_ID"

echo
echo "── Code signature ────────────────────────────────────────────────"
codesign -dvv "$APP" 2>&1 | grep -E '^(Identifier|Authority|TeamIdentifier|Format|Sealed|CodeDirectory|Signature)'

echo
echo "── Entitlements ──────────────────────────────────────────────────"
if codesign -d --entitlements :- "$APP" 2>/dev/null; then
  : # printed above
else
  echo "  (no entitlements found — Entitlements.plist may not have been wired into bundle.macOS)"
fi

echo
echo "── TCC usage descriptions in Info.plist ──────────────────────────"
echo "  (these strings are what macOS shows in the permission prompt — without"
echo "   them macOS silently denies access with no prompt and no Settings entry)"
echo
for key in \
    NSNetworkVolumesUsageDescription \
    NSRemovableVolumesUsageDescription \
    NSDesktopFolderUsageDescription \
    NSDocumentsFolderUsageDescription \
    NSDownloadsFolderUsageDescription \
  ; do
  val="$(plutil -extract "$key" raw -o - "$INFO_PLIST" 2>/dev/null || true)"
  if [[ -n "$val" ]]; then
    printf "  ✓ %s\n      %s\n" "$key" "$val"
  else
    printf "  ✗ %s   (missing)\n" "$key"
  fi
done

echo
echo "── Stale TCC entries ─────────────────────────────────────────────"
echo "  If macOS has cached an old grant tied to a previous ad-hoc signature"
echo "  of this bundle ID, clear it with:"
echo
echo "      tccutil reset All $BUNDLE_ID"
echo
echo "  Or per-service (more conservative):"
echo "      tccutil reset SystemPolicyAllFiles         $BUNDLE_ID  # Full Disk Access"
echo "      tccutil reset SystemPolicyNetworkVolumes   $BUNDLE_ID  # /Volumes/ network"
echo "      tccutil reset SystemPolicyRemovableVolumes $BUNDLE_ID  # /Volumes/ USB/SD"
echo "      tccutil reset SystemPolicyDesktopFolder    $BUNDLE_ID"
echo "      tccutil reset SystemPolicyDocumentsFolder  $BUNDLE_ID"
echo "      tccutil reset SystemPolicyDownloadsFolder  $BUNDLE_ID"
echo
echo "  Then relaunch the app — first protected access pops a fresh prompt."

echo
echo "✓ done"
