#!/usr/bin/env zsh
# bundle-mkvpropedit.sh
#
# Copies mkvpropedit from Homebrew into src-tauri/ and bundles every
# non-system dylib it depends on (transitively) into src-tauri/mkvpropedit-libs/.
# Then rewrites all Homebrew-absolute load paths in the binary AND in each
# bundled dylib to the app-bundle-relative form:
#
#   @executable_path/../Resources/mkvpropedit-libs/<libname>
#
# Tauri places bundle.resources files at Contents/Resources/<relative-path>.
# Contents/MacOS/mkvpropedit resolves @executable_path as Contents/MacOS/,
# so ../Resources/ always points to the correct location at runtime.
#
# Invoked automatically by beforeBuildCommand in tauri.conf.json.
# Can also be run manually:  zsh scripts/bundle-mkvpropedit.sh

set -euo pipefail

SCRIPT_DIR="${0:A:h}"
ROOT="${SCRIPT_DIR:h}"
SIDECAR="$ROOT/src-tauri/mkvpropedit-aarch64-apple-darwin"
LIBS_DIR="$ROOT/src-tauri/mkvpropedit-libs"
RPATH="@executable_path/../Resources/mkvpropedit-libs"

echo "▸ bundle-mkvpropedit"

# ── 1. Copy fresh binary from Homebrew ───────────────────────────────────────
MKV_BIN="$(command -v mkvpropedit 2>/dev/null || true)"
if [[ -z "$MKV_BIN" ]]; then
  echo "  error: mkvpropedit not found. Install with: brew install mkvtoolnix" >&2
  exit 1
fi
echo "  binary  → $MKV_BIN"
# Remove any existing copy first — macOS marks signed binaries read-only.
rm -f "$SIDECAR"
cp "$MKV_BIN" "$SIDECAR"
chmod +w "$SIDECAR"

# ── 2. BFS over the dylib dependency graph ───────────────────────────────────
# Returns every /opt/homebrew/* load path listed in a binary or dylib.
homebrew_deps() {
  local file="$1"
  local file_dir
  file_dir="$(dirname "$file")"

  otool -L "$file" 2>/dev/null \
    | tail -n +2 \
    | awk '{print $1}' \
    | while IFS= read -r dep; do
        case "$dep" in
          /opt/homebrew/*)
            echo "$dep"
            ;;
          @loader_path/*)
            local resolved="${file_dir}/${dep#@loader_path/}"
            [[ -f "$resolved" ]] && echo "$resolved"
            ;;
        esac
      done
}

typeset -A SEEN   # original_path → dest_basename

typeset -a QUEUE
QUEUE=("$SIDECAR")

while (( ${#QUEUE[@]} > 0 )); do
  current="${QUEUE[1]}"
  QUEUE=("${QUEUE[@]:1}")   # shift

  while IFS= read -r dep; do
    [[ -z "$dep" ]] && continue
    if [[ -z "${SEEN[$dep]+x}" ]]; then
      SEEN[$dep]="$(basename "$dep")"
      QUEUE+=("$dep")
    fi
  done < <(homebrew_deps "$current")
done

echo "  found   → ${#SEEN[@]} Homebrew libs"
for src in "${(k)SEEN[@]}"; do
  printf "            %s\n" "$(basename "$src")"
done | sort

# ── 3. Copy dylibs ────────────────────────────────────────────────────────────
rm -rf "$LIBS_DIR"
mkdir -p "$LIBS_DIR"
for src in "${(k)SEEN[@]}"; do
  cp "$src" "$LIBS_DIR/${SEEN[$src]}"
  chmod +w "$LIBS_DIR/${SEEN[$src]}"
done

# ── 4. Rewrite every Homebrew load path in binary + dylibs ───────────────────
fix_file() {
  local file="$1"
  local is_dylib="${2:-false}"

  # Update the dylib's own install name (LC_ID_DYLIB).
  if [[ "$is_dylib" == "true" ]]; then
    install_name_tool -id "$RPATH/$(basename "$file")" "$file" 2>/dev/null || true
  fi

  # Rewrite each Homebrew path → bundled path.
  for src in "${(k)SEEN[@]}"; do
    install_name_tool \
      -change "$src" "$RPATH/${SEEN[$src]}" \
      "$file" 2>/dev/null || true
  done

  # Drop the Homebrew-absolute RPATH the binary ships with.
  install_name_tool -delete_rpath "/opt/homebrew/lib" "$file" 2>/dev/null || true
}

fix_file "$SIDECAR" false
for src in "${(k)SEEN[@]}"; do
  fix_file "$LIBS_DIR/${SEEN[$src]}" true
done

# ── 5. Verify no Homebrew paths remain ───────────────────────────────────────
remaining=$(otool -L "$SIDECAR" 2>/dev/null | grep -c '/opt/homebrew' || true)
if (( remaining > 0 )); then
  echo "  WARNING: $remaining Homebrew path(s) still in binary after rewrite:"
  otool -L "$SIDECAR" | grep '/opt/homebrew'
fi

# ── 6. Strip quarantine + re-sign ad-hoc ─────────────────────────────────────
#
# `install_name_tool` edits invalidate the original Homebrew code signatures.
# macOS treats a tampered-but-signed file as malicious and sends SIGKILL when
# any dylib is loaded — producing "exit None" in the Tauri error.
#
# Fix in two steps:
#   a) xattr -cr  — clears com.apple.quarantine (and all other xattrs) so
#                   Gatekeeper doesn't block execution outright.
#   b) codesign   — applies a fresh ad-hoc ("-") signature that satisfies the
#                   kernel's code-signing requirement without a Developer ID.
#                   Tauri's own signing step will later replace these if a
#                   certificate is configured.
#
# Note: `find -type f` (not -name "*.dylib") is intentional — QtCore ships
# without a .dylib extension and must be signed too.

echo "  signing → stripping quarantine and re-signing ad-hoc..."
xattr -cr "$LIBS_DIR" "$SIDECAR"
find "$LIBS_DIR" -type f -exec codesign --force --sign - {} \;
codesign --force --sign - "$SIDECAR"
echo "  signing → done"

total_size=$(du -sh "$LIBS_DIR" | cut -f1)
lib_count=$(ls "$LIBS_DIR" | wc -l | tr -d ' ')
echo "  bundled → $lib_count libs, $total_size  ($LIBS_DIR)"
