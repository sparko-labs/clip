#!/usr/bin/env bash
set -euo pipefail

TARGET="${TARGET:-x86_64-unknown-linux-gnu}"
VERSION="$(./scripts/ci/release-version.sh)"
BUNDLE="apps/desktop-gpui/target/${TARGET}/release/bundle"
OUT="release-assets"

# shellcheck source=scripts/ci/desktop-env.sh
source ./scripts/ci/desktop-env.sh

rustup target add "$TARGET"
node scripts/ci/stamp-version.mjs "$VERSION"
write_dotenv "$VERSION" "$TARGET"

: "${TAURI_SIGNING_PRIVATE_KEY:?The updater signing key is required to produce updater artifacts}"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"

bun install --frozen-lockfile
RUST_TARGET_TRIPLE="$TARGET" bun run cap-setup

CARGO_PROFILE_RELEASE_DEBUG=0 CARGO_PROFILE_RELEASE_STRIP=symbols \
	./scripts/build-desktop-binaries.sh "$TARGET"

export LD_LIBRARY_PATH="${PWD}/apps/desktop-gpui/target/${TARGET}/release:${PWD}/target/native-deps/lib:${LD_LIBRARY_PATH:-}"
node scripts/build-linux-packages.mjs "$TARGET" --verbose

DEB="$(find "$BUNDLE/deb" -name '*.deb' -print -quit)"
APPIMAGE="$(find "$BUNDLE/appimage" -name '*.AppImage' -print -quit)"
[[ -s "$DEB" && -s "$DEB.sig" && -s "$APPIMAGE" && -s "$APPIMAGE.sig" ]]

ARCH="${TARGET%%-*}"
for kind in deb appimage; do
	mkdir -p "$OUT/linux-${ARCH}-${kind}"
done
cp "$DEB" "$DEB.sig" "$OUT/linux-${ARCH}-deb/"
cp "$APPIMAGE" "$APPIMAGE.sig" "$OUT/linux-${ARCH}-appimage/"
