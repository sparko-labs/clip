#!/usr/bin/env bash
set -euo pipefail

TARGET="${TARGET:-aarch64-apple-darwin}"
SIGN="${SIGN_BUILDS:-false}"
VERSION="$(./scripts/ci/release-version.sh)"
BUNDLE="apps/desktop-gpui/target/${TARGET}/release/bundle"
OUT="release-assets"
KEYCHAIN_PATH="${HOME}/.cap-ci/build-${CI_JOB_ID:-local}.keychain-db"
KEYCHAIN_PASSWORD="$(uuidgen)"

# shellcheck source=scripts/ci/desktop-env.sh
source ./scripts/ci/desktop-env.sh

cleanup() {
	security delete-keychain "$KEYCHAIN_PATH" 2>/dev/null || true
	rm -f "${API_KEY_PATH:-}" 2>/dev/null || true
}
trap cleanup EXIT

node --test scripts/prepare-gpui-dependency.test.mjs scripts/build-macos-packages.test.mjs \
	scripts/bundle-gpui.test.mjs scripts/finalize-macos-packages.test.mjs

rustup target add "$TARGET"
node scripts/ci/stamp-version.mjs "$VERSION"
write_dotenv "$VERSION" "$TARGET"

if [[ "$SIGN" == "true" ]]; then
	: "${APPLE_CERTIFICATE:?}" "${APPLE_CERTIFICATE_PASSWORD:?}" "${APPLE_SIGNING_IDENTITY:?}"
	: "${APPLE_API_ISSUER:?}" "${APPLE_API_KEY:?}" "${APPLE_API_KEY_FILE:?}"
	mkdir -p "$(dirname "$KEYCHAIN_PATH")"
	API_KEY_PATH="$(mktemp -t cap-api-key).p8"
	printf '%s' "$APPLE_API_KEY_FILE" > "$API_KEY_PATH"
	export APPLE_API_KEY_PATH="$API_KEY_PATH"
	CERT_FILE="$(mktemp -t cap-cert).p12"
	printf '%s' "$APPLE_CERTIFICATE" | base64 --decode > "$CERT_FILE"
	security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
	security set-keychain-settings -lut 21600 "$KEYCHAIN_PATH"
	security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
	security import "$CERT_FILE" -k "$KEYCHAIN_PATH" -P "$APPLE_CERTIFICATE_PASSWORD" \
		-T /usr/bin/codesign -T /usr/bin/security
	rm -f "$CERT_FILE"
	security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
	security list-keychains -d user -s "$KEYCHAIN_PATH" login.keychain-db
	security find-identity -v -p codesigning "$KEYCHAIN_PATH"
	export APPLE_KEYCHAIN="$KEYCHAIN_PATH"
else
	unset APPLE_CERTIFICATE APPLE_CERTIFICATE_PASSWORD APPLE_SIGNING_IDENTITY \
		APPLE_API_ISSUER APPLE_API_KEY APPLE_API_KEY_FILE APPLE_API_KEY_PATH
fi

: "${TAURI_SIGNING_PRIVATE_KEY:?The updater signing key is required to produce updater artifacts}"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"

bun install --frozen-lockfile
RUST_TARGET_TRIPLE="$TARGET" bun run cap-setup

CARGO_PROFILE_RELEASE_DEBUG=0 CARGO_PROFILE_RELEASE_STRIP=symbols \
	./scripts/build-desktop-binaries.sh "$TARGET"

if [[ "$SIGN" == "true" ]]; then
	PIGZ_VERSION=2.8
	PIGZ_SHA256=eb872b4f0e1f0ebe59c9f7bd8c506c4204893ba6a8492de31df416f0d5170fd0
	PIGZ_DIR="${HOME}/.cap-ci/pigz-${PIGZ_VERSION}"
	if [[ ! -x "$PIGZ_DIR/pigz" ]]; then
		mkdir -p "$PIGZ_DIR"
		curl -fsSL --retry 3 -o "$PIGZ_DIR/pigz.tar.gz" "https://zlib.net/pigz/pigz-${PIGZ_VERSION}.tar.gz"
		echo "${PIGZ_SHA256}  ${PIGZ_DIR}/pigz.tar.gz" | shasum -a 256 -c -
		tar -xzf "$PIGZ_DIR/pigz.tar.gz" -C "$PIGZ_DIR" --strip-components=1
		make -C "$PIGZ_DIR" CC=cc
	fi
	export PATH="$PIGZ_DIR:$PATH"
fi

node scripts/bundle-gpui.mjs "$TARGET" --bundles app,dmg
if [[ "$SIGN" == "true" ]]; then
	node scripts/finalize-macos-packages.mjs "$BUNDLE"
fi

APP="$(find "$BUNDLE/macos" -maxdepth 1 -name '*.app' -print -quit)"
DMG="$(find "$BUNDLE/dmg" -maxdepth 1 -name '*.dmg' -print -quit)"
[[ -n "$APP" && -n "$DMG" ]]

if [[ "$SIGN" == "true" ]]; then
	codesign --verify --deep --strict "$APP"
	spctl --assess --type execute "$APP"
	xcrun stapler validate "$APP"
	codesign --verify "$DMG"
	xcrun notarytool submit "$DMG" --key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY" \
		--issuer "$APPLE_API_ISSUER" --wait --timeout 20m
	xcrun stapler staple "$DMG"
	xcrun stapler validate "$DMG"
	spctl --assess --type open --context context:primary-signature "$DMG"
fi

PLATFORM="darwin-${TARGET%%-*}"
rm -rf "$OUT/$PLATFORM" "$OUT/dmg"
mkdir -p "$OUT/$PLATFORM" "$OUT/dmg"
ARCHIVE="$(find "$BUNDLE/macos" -maxdepth 1 -name '*.app.tar.gz' -print -quit)"
[[ -s "$ARCHIVE" && -s "$ARCHIVE.sig" ]]
cp "$ARCHIVE" "$ARCHIVE.sig" "$OUT/$PLATFORM/"
cp "$DMG" "$OUT/dmg/"
