#!/usr/bin/env bash
set -euo pipefail

TARGET="${TARGET:-x86_64-pc-windows-msvc}"
SIGN="${SIGN_BUILDS:-false}"
VERSION="$(./scripts/ci/release-version.sh)"
BUNDLE="apps/desktop-gpui/target/${TARGET}/release/bundle"
OUT="release-assets"

# shellcheck source=scripts/ci/desktop-env.sh
source ./scripts/ci/desktop-env.sh

node --test scripts/prepare-gpui-dependency.test.mjs scripts/bundle-gpui.test.mjs

rustup target add "$TARGET"
node scripts/ci/stamp-version.mjs "$VERSION"
write_dotenv "$VERSION" "$TARGET"

: "${TAURI_SIGNING_PRIVATE_KEY:?The updater signing key is required to produce updater artifacts}"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"

bun install --frozen-lockfile
RUST_TARGET_TRIPLE="$TARGET" bun run cap-setup

CARGO_PROFILE_RELEASE_DEBUG=0 CARGO_PROFILE_RELEASE_STRIP=symbols \
	./scripts/build-desktop-binaries.sh "$TARGET"

node scripts/bundle-gpui.mjs "$TARGET" --no-bundle

if [[ "$SIGN" == "true" ]]; then
	pwsh -NoProfile -File scripts/windows-release-signing.ps1 \
		-Operation Stage -Target "$TARGET" -WorkspaceRoot "$PWD"
	rm -rf signed-windows-payload
	cp -R "target/${TARGET}/release/windows-signing/payload" signed-windows-payload
	pwsh -NoProfile -File scripts/ci/sign-windows.ps1 -Path signed-windows-payload
	pwsh -NoProfile -File scripts/windows-release-signing.ps1 \
		-Operation Restore -Target "$TARGET" -WorkspaceRoot "$PWD"
fi

node scripts/bundle-gpui.mjs "$TARGET" --skip-build --bundles nsis

INSTALLER="$(find "$BUNDLE/nsis" -maxdepth 1 -name '*.exe' -print -quit)"
[[ -s "$INSTALLER" ]]

if [[ "$SIGN" == "true" ]]; then
	pwsh -NoProfile -File scripts/ci/sign-windows.ps1 -Path "$INSTALLER"
	pwsh -NoProfile -File scripts/windows-release-signing.ps1 \
		-Operation VerifyInstaller -Target "$TARGET" -WorkspaceRoot "$PWD" \
		-InstallerPath "$INSTALLER"
fi

rm -f "${INSTALLER}.sig"
(cd apps/desktop && bun run tauri signer sign \
	-k "$TAURI_SIGNING_PRIVATE_KEY" -p "$TAURI_SIGNING_PRIVATE_KEY_PASSWORD" \
	"$(cd .. && cd .. && pwd)/${INSTALLER}")
[[ -s "${INSTALLER}.sig" ]]

PLATFORM="windows-${TARGET%%-*}"
rm -rf "$OUT/$PLATFORM"
mkdir -p "$OUT/$PLATFORM"
cp "$INSTALLER" "${INSTALLER}.sig" "$OUT/$PLATFORM/"
