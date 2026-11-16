#!/usr/bin/env bash
# build-desktop.sh
#
# Builds the Snout Tauri desktop app.
#
# Usage:
#   ./scripts/build-desktop.sh                 # linux + windows
#   ./scripts/build-desktop.sh linux           # AppImage only
#   ./scripts/build-desktop.sh windows         # Windows NSIS .exe only
#   ./scripts/build-desktop.sh macos           # macOS .dmg only  (must run on macOS)
#   ./scripts/build-desktop.sh macos-universal # fat binary for Intel + Apple Silicon
#   ./scripts/build-desktop.sh all             # all three platforms
#
# ── Prerequisites ────────────────────────────────────────────────────────────
#
# All platforms:
#   cargo install tauri-cli --version "^2" --locked
#
# Linux (Arch):
#   pacman -S webkit2gtk-4.1 gtk3 libappindicator-gtk3 patchelf fuse2 squashfs-tools
#
# Windows cross-compile from Linux (Arch):
#   pacman -S mingw-w64-gcc nsis
#   rustup target add x86_64-pc-windows-gnu
#
# macOS (.dmg) — MUST run on a real Mac or a macOS CI runner.
#   Apple's SDK is not redistributable; OSXCross is not supported here.
#   On the Mac:
#     xcode-select --install
#     rustup target add aarch64-apple-darwin x86_64-apple-darwin
#     cargo install tauri-cli --version "^2" --locked
#   For notarisation set:
#     APPLE_SIGNING_IDENTITY, APPLE_ID, APPLE_PASSWORD, APPLE_TEAM_ID
#
# ── Outputs ──────────────────────────────────────────────────────────────────
#   release/Snout_*.AppImage
#   release/Snout_*-setup.exe
#   release/Snout_*.dmg

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

TARGET="${1:-linux+windows}"
TAURI_BUNDLE_DIR="$ROOT/src-tauri/target/release/bundle"

# ── helpers ──────────────────────────────────────────────────────────────────

log()  { printf '\033[1;34m▶\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m✘\033[0m %s\n' "$*" >&2; exit 1; }

require_cmd() {
    command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

# ── Tauri CLI ────────────────────────────────────────────────────────────────

require_cmd cargo
require_cmd node
require_cmd npm

if command -v cargo-tauri >/dev/null 2>&1; then
    TAURI="cargo-tauri"
elif cargo tauri --version >/dev/null 2>&1; then
    TAURI="cargo tauri"
else
    log "Tauri CLI not found — installing (takes a few minutes)..."
    cargo install tauri-cli --version "^2" --locked
    TAURI="cargo tauri"
fi

# ── frontend + tests ─────────────────────────────────────────────────────────

log "Installing npm dependencies..."
npm ci --prefer-offline 2>/dev/null || npm install

log "Building frontend (Vite)..."
npm run build

log "Running Rust unit tests..."
(cd src-tauri && cargo test)

# ── Linux AppImage ────────────────────────────────────────────────────────────

build_linux() {
    log "Building Linux AppImage..."
    $TAURI build --bundles appimage 2>&1 | tee /tmp/tauri-linux-build.log

    APPIMAGE=$(find "$TAURI_BUNDLE_DIR/appimage" -name "*.AppImage" 2>/dev/null | head -1)
    [[ -n "$APPIMAGE" ]] || die "AppImage not found. See /tmp/tauri-linux-build.log"

    mkdir -p "$ROOT/release"
    cp "$APPIMAGE" "$ROOT/release/"
    ok "Linux AppImage → release/$(basename "$APPIMAGE")"
}

# ── Windows NSIS .exe ─────────────────────────────────────────────────────────

build_windows() {
    log "Building Windows NSIS installer..."

    # NOTE: The resulting .exe is unsigned by default.
    # Windows SmartScreen will warn on install without a code-signing certificate.
    # To sign, set TAURI_SIGNING_PRIVATE_KEY and TAURI_SIGNING_PRIVATE_KEY_PASSWORD
    # before running this script.
    # See: https://tauri.app/distribute/sign/windows/

    if ! rustup target list --installed | grep -q "x86_64-pc-windows-gnu"; then
        log "Adding Windows GNU target..."
        rustup target add x86_64-pc-windows-gnu
    fi

    command -v x86_64-w64-mingw32-gcc >/dev/null 2>&1 \
        || die "mingw-w64-gcc not installed. Run: pacman -S mingw-w64-gcc"

    command -v makensis >/dev/null 2>&1 \
        || die "NSIS not installed. Run: pacman -S nsis"

    CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER=x86_64-w64-mingw32-gcc \
        $TAURI build --target x86_64-pc-windows-gnu --bundles nsis 2>&1 \
        | tee /tmp/tauri-windows-build.log

    EXE=$(find "$ROOT/src-tauri/target/x86_64-pc-windows-gnu/release/bundle/nsis" \
              -name "*.exe" 2>/dev/null | head -1)
    [[ -n "$EXE" ]] || die "Windows installer not found. See /tmp/tauri-windows-build.log"

    mkdir -p "$ROOT/release"
    cp "$EXE" "$ROOT/release/"
    ok "Windows installer → release/$(basename "$EXE")"
}

# ── macOS .dmg ────────────────────────────────────────────────────────────────
#
# This function MUST run on macOS. Cross-compiling macOS binaries from Linux
# is blocked by Apple's SDK license. Use GitHub Actions macos-latest runner
# or a real Mac.

build_macos() {
    [[ "$(uname)" == "Darwin" ]] \
        || die "macOS builds must run on macOS. Use a Mac or a macOS CI runner."

    log "Building macOS DMG (native arm64)..."

    if ! rustup target list --installed | grep -q "aarch64-apple-darwin"; then
        log "Adding aarch64-apple-darwin target..."
        rustup target add aarch64-apple-darwin
    fi

    # NOTE: The .dmg will be unsigned without an Apple Developer certificate.
    # Gatekeeper will block unsigned apps. To sign + notarise, set:
    #   APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
    #   APPLE_ID, APPLE_PASSWORD (app-specific), APPLE_TEAM_ID
    # See: https://tauri.app/distribute/sign/macos/

    $TAURI build --target aarch64-apple-darwin --bundles dmg 2>&1 \
        | tee /tmp/tauri-macos-build.log

    DMG=$(find "$ROOT/src-tauri/target/aarch64-apple-darwin/release/bundle/dmg" \
              -name "*.dmg" 2>/dev/null | head -1)
    [[ -n "$DMG" ]] || die "DMG not found. See /tmp/tauri-macos-build.log"

    mkdir -p "$ROOT/release"
    cp "$DMG" "$ROOT/release/"
    ok "macOS DMG → release/$(basename "$DMG")"
}

build_macos_universal() {
    [[ "$(uname)" == "Darwin" ]] \
        || die "macOS builds must run on macOS. Use a Mac or a macOS CI runner."

    log "Building macOS Universal Binary (Intel + Apple Silicon)..."

    for arch in aarch64-apple-darwin x86_64-apple-darwin; do
        if ! rustup target list --installed | grep -q "$arch"; then
            log "Adding $arch..."
            rustup target add "$arch"
        fi
    done

    # Build both arches then let Tauri stitch them into a universal .app + .dmg.
    $TAURI build --target universal-apple-darwin --bundles dmg 2>&1 \
        | tee /tmp/tauri-macos-universal-build.log

    DMG=$(find "$ROOT/src-tauri/target/universal-apple-darwin/release/bundle/dmg" \
              -name "*.dmg" 2>/dev/null | head -1)
    [[ -n "$DMG" ]] || die "Universal DMG not found. See /tmp/tauri-macos-universal-build.log"

    mkdir -p "$ROOT/release"
    cp "$DMG" "$ROOT/release/"
    ok "macOS Universal DMG → release/$(basename "$DMG")"
}

# ── dispatch ──────────────────────────────────────────────────────────────────

case "$TARGET" in
    linux)            build_linux ;;
    windows)          build_windows ;;
    macos)            build_macos ;;
    macos-universal)  build_macos_universal ;;
    linux+windows|both) build_linux; build_windows ;;
    all)              build_linux; build_windows; build_macos_universal ;;
    *) die "Unknown target '$TARGET'. Use: linux | windows | macos | macos-universal | all" ;;
esac

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Build complete. Artefacts in ./release/"
ls -lh "$ROOT/release/" 2>/dev/null || true
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
